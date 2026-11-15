#!/usr/bin/env node
/**
 * Harvest explanations from a finished CertSafari results screen.
 *
 *   node tools/harvest-certsafari.mjs --want 4,6,12 [--into <attempt.json>]
 *   node tools/harvest-certsafari.mjs --want 1-53 --from data/raw/<ts>-certsafari-harvest.jsonl --into <attempt.json>
 *
 * Why this is separate from the session observer: that observer exits a couple
 * of seconds after the score appears, which is right for ending a sitting but
 * means the per-question explanations — only reachable by tapping each pill on
 * the results screen — are never captured. Reviews need them: they are the
 * correct answer and the site's own reasoning about every distractor.
 *
 * You do the tapping. This only reads the page, records every snapshot to
 * `data/raw/<ts>-certsafari-harvest.jsonl`, and prints which of the wanted
 * questions it still needs. It stops when it has them all, when the tab closes,
 * or after `--idle` minutes without a change.
 *
 * With `--into`, the harvested answers and per-option explanations are merged
 * into an existing attempt and its report is rebuilt. Nothing else is touched:
 * correctness still comes from the results grid, never from this pass.
 */
import path from 'node:path';
import { appendFile, readFile, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';
import * as cs from './lib/extract-certsafari.mjs';
import { paths, stamp, ensureDirs } from './lib/store.mjs';
import { banner } from './lib/browser.mjs';
import { buildReport } from './report.mjs';

const argv = process.argv.slice(2);
const flag = (n, d = null) => { const i = argv.indexOf(`--${n}`); return i >= 0 ? (argv[i + 1] ?? true) : d; };

// "4,6,12" or "1-53"; blanks (a trailing comma) are dropped, not read as Q0.
const want = String(flag('want', '')).split(',').map((s) => s.trim()).filter(Boolean).flatMap((s) => {
  const [a, b] = s.split('-').map(Number);
  return b ? Array.from({ length: b - a + 1 }, (_, i) => a + i) : [a];
}).filter((n) => Number.isInteger(n) && n > 0);
const into = flag('into');
const IDLE_MIN = Number(flag('idle', 20));
const PORT = Number(flag('port', 9333));
const DRIVE = argv.includes('--drive');
const FROM = flag('from');

/**
 * The one place in this repo that clicks.
 *
 * Everything else only reads the DOM, deliberately: a sitting must be the
 * user's own work, and auto-answering would poison the only data we have. This
 * mode is narrowly exempt because it runs *after* submission, on a scored
 * results screen where the answers are locked — it expands read-only
 * explanation panels and cannot change a response or a score.
 *
 * The exemption is enforced, not just documented:
 *   - every click is preceded by a "Quiz Complete" assertion, so this can never
 *     run against a sitting in progress;
 *   - the only elements clicked are the numbered question pills, accordion
 *     triggers whose label is exactly "Explanation", and "Close".
 * Navigation, "New Quiz", "To certificate" and anything else are never touched.
 */
const SCORED = /Quiz Complete/i;

async function assertScored(page, why) {
  const ok = await page.evaluate(() => /Quiz Complete/i.test(document.body.innerText));
  if (!ok) throw new Error(`refusing to click — not on the scored results screen (${why})`);
}

/** Open question `n`'s review panel and expand every option's explanation. */
async function openPanel(page, n) {
  await assertScored(page, `before opening Q${n}`);
  const clicked = await page.evaluate((num) => {
    const pill = [...document.querySelectorAll('button')].find(
      (e) => (e.innerText ?? '').trim() === String(num) && /rounded-full/.test(e.className ?? ''),
    );
    if (!pill) return false;
    pill.click();
    return true;
  }, n);
  if (!clicked) return { opened: false, selectionMoved: false };

  await page.waitForFunction(
    (num) => new RegExp(`Question\\s+${num}\\s+of\\s+\\d+`).test(document.body.innerText),
    n, { timeout: 8000 },
  ).catch(() => {});

  // Each option's rationale sits behind its own "Explanation" accordion. Expand
  // them all, re-querying between clicks because the list re-renders — and keep
  // going while any remain collapsed rather than stopping at the first miss: a
  // trigger scrolled out of view can ignore a click, which on 2026-09-23 left
  // four panels with 0-1 of their explanations open.
  const collapsed = () => page.evaluate(() => [...document.querySelectorAll('[aria-expanded="false"]')]
    .filter((e) => (e.innerText ?? '').trim() === 'Explanation').length);

  /**
   * Expanding an explanation also moves the radio.
   *
   * Each accordion trigger sits inside the <label> that wraps its option's
   * radio, so a click on the trigger selects that option as a side effect. On
   * 2026-09-23 this left every driven panel showing the *last* option as the
   * answer given. It does not re-grade anything — the quiz is already scored —
   * but it means a driven panel's selection state is worthless afterwards.
   *
   * So: selections are read only from the pre-submit timeline, never from here.
   * We snapshot the state before touching anything and report any drift, and
   * `chosen` is stripped from every driven panel below.
   */
  const checkedIds = () => page.evaluate(() => [...document.querySelectorAll('[role=radio],[role=checkbox]')]
    .filter((e) => e.getAttribute('aria-checked') === 'true' || e.getAttribute('data-state') === 'checked')
    .map((e) => e.id).filter(Boolean).sort().join(','));
  const before = await checkedIds();

  for (let pass = 0; pass < 24; pass++) {
    const left = await collapsed();
    if (!left) break;
    await page.evaluate(() => {
      const trigger = [...document.querySelectorAll('[aria-expanded="false"]')]
        .find((e) => (e.innerText ?? '').trim() === 'Explanation');
      if (!trigger) return;
      trigger.scrollIntoView({ block: 'center' });
      trigger.click();
    });
    await new Promise((r) => setTimeout(r, 450));
  }
  await new Promise((r) => setTimeout(r, 600));
  const after = await checkedIds();
  return { opened: true, selectionMoved: before !== after };
}

async function closePanel(page) {
  await page.evaluate(() => {
    const btn = [...document.querySelectorAll('button')].find((e) => (e.innerText ?? '').trim() === 'Close');
    if (btn) btn.click();
  });
  await new Promise((r) => setTimeout(r, 500));
}

/**
 * Which question is this panel about?
 *
 * The open panel repeats "Question N of M" above the subdomain label, so the
 * number is read from the raw page text rather than from the parsed panel —
 * parseReviewPanel deliberately knows nothing about numbering.
 */
const panelNumber = (text) => {
  const m = (text ?? '').match(/Question\s+(\d+)\s+of\s+(\d+)/i);
  return m ? Number(m[1]) : null;
};

async function main() {
  if (!want.length) {
    console.error('usage: node tools/harvest-certsafari.mjs --want 4,6,12 [--into data/attempts/<f>.json]');
    process.exit(1);
  }
  if (FROM) return replay(FROM);
  await ensureDirs();
  const base = `${stamp(new Date())}-certsafari-harvest`;
  const timeline = path.join(paths.raw, `${base}.jsonl`);

  const browser = await chromium.connectOverCDP(`http://127.0.0.1:${PORT}`);
  const ctx = browser.contexts()[0];
  const pageOf = () => ctx.pages().filter((p) => !p.isClosed()).find((p) => /certsafari/.test(p.url()));
  if (!pageOf()) throw new Error('no CertSafari tab open on that Chrome');

  banner(DRIVE ? [
    '▶  HARVESTING EXPLANATIONS — driving the scored results screen',
    '',
    `   Needed: ${want.join(', ')}`,
    '   Clicking only question pills, "Explanation" accordions and "Close",',
    '   and only while "Quiz Complete" is on screen. Answers are already locked.',
    '',
    `   Timeline: data/raw/${base}.jsonl`,
  ] : [
    '▶  HARVESTING EXPLANATIONS — you tap, I read',
    '',
    `   Needed: ${want.join(', ')}`,
    '   On the results screen, tap each of those numbers, let the panel render,',
    '   then close it and move to the next. I never click anything.',
    '',
    `   Timeline: data/raw/${base}.jsonl`,
  ]);

  const got = new Map();

  const moved = new Set();
  if (DRIVE) {
    const page = pageOf();
    await assertScored(page, 'startup');
    for (const n of want) {
      let panel = null;
      for (let attempt = 1; attempt <= 2 && !panel; attempt++) {
        const { opened, selectionMoved } = await openPanel(page, n);
        if (!opened) { console.log(`  ✖ Q${n}  no pill found`); break; }
        if (selectionMoved) moved.add(n);
        const snap = await page.evaluate(cs.SNAPSHOT_FN);
        await appendFile(timeline, JSON.stringify(snap) + '\n');
        if (panelNumber(snap.text) !== n) {
          console.log(`  ~ Q${n}  panel showed ${panelNumber(snap.text) ?? 'nothing'}, retrying`);
          await closePanel(page);
          continue;
        }
        try { panel = cs.parseReviewPanel(snap); } catch { panel = null; }
        if (panel && !panel.options.length) panel = null;
      }
      if (panel) {
        // Never carry a selection out of a driven panel: expanding the
        // explanations moved the radios. The answer given comes from the
        // pre-submit timeline, which nothing here has touched.
        panel.chosen = null;
        got.set(n, panel);
        console.log(`  ${panel.partial ? '~' : '✔'} Q${n}  answer ${panel.answer ?? '?'}  ` +
          `(${panel.verdictsKnown}/${panel.options.length} options explained)` +
          `${panel.status ? `  site says ${panel.status}` : ''}`);
      } else if (panel === null) {
        console.log(`  ✖ Q${n}  panel did not parse`);
      }
      await closePanel(page);
    }
  } else {
  let lastText = '';
  let lastChange = Date.now();

  for (;;) {
    const page = pageOf();
    if (!page) { console.log('\n▸ tab closed — wrapping up'); break; }
    if (Date.now() - lastChange > IDLE_MIN * 60000) {
      console.log(`\n▸ no changes for ${IDLE_MIN} min — wrapping up`);
      break;
    }
    await new Promise((r) => setTimeout(r, 900));

    let snap;
    try { snap = await page.evaluate(cs.SNAPSHOT_FN); } catch { continue; }
    if (snap.text === lastText) continue;
    lastText = snap.text;
    lastChange = Date.now();
    await appendFile(timeline, JSON.stringify(snap) + '\n');

    const n = panelNumber(snap.text);
    if (!n || !want.includes(n)) continue;

    let panel;
    try { panel = cs.parseReviewPanel(snap); } catch { continue; }
    if (!panel || !panel.options.length) continue;

    // Keep the richest capture: panels stream in, so an early snapshot can hold
    // the options with none of their explanations yet.
    const prev = got.get(n);
    if (!prev || panel.verdictsKnown > prev.verdictsKnown) {
      got.set(n, panel);
      const mark = panel.partial ? '~' : '✔';
      console.log(`  ${mark} Q${n}  answer ${panel.answer ?? '?'}  ` +
        `(${panel.verdictsKnown}/${panel.options.length} options explained)` +
        `${panel.chosen ? `  you chose ${panel.chosen}` : ''}`);
    }

    const complete = want.filter((w) => got.get(w) && !got.get(w).partial);
    if (complete.length === want.length) {
      console.log('\n▸ every wanted question captured in full');
      break;
    }
  }
  }

  await browser.close().catch(() => {});

  const missing = want.filter((w) => !got.has(w));
  const partial = want.filter((w) => got.get(w)?.partial);
  banner([
    '✔  HARVEST DONE',
    `   Captured: ${[...got.keys()].sort((a, b) => a - b).join(', ') || 'none'}`,
    ...(partial.length ? [`   Partial:  ${partial.join(', ')} — no verdict word on every option; answer not claimed`] : []),
    ...(moved.size ? [
      `   Note:     expanding Q${[...moved].join(', Q')} also moved those panels' radios`,
      '             (score already final; selections read from the pre-submit timeline)',
    ] : []),
    ...(missing.length ? [`   Missing:  ${missing.join(', ')} — never opened`] : []),
    `   Timeline: data/raw/${base}.jsonl`,
  ]);

  await mergeInto(got, partial, missing);
}

/**
 * Rebuild from a saved harvest timeline, no browser. Used when the attempt is
 * re-derived (e.g. after a parser fix) and the results screen is long gone.
 * Keeps the richest panel per question, and never a selection — see --drive.
 */
async function replay(file) {
  const got = new Map();
  for (const line of (await readFile(path.resolve(file), 'utf8')).trim().split('\n')) {
    let snap;
    try { snap = JSON.parse(line); } catch { continue; }
    const n = panelNumber(snap.text);
    if (!n || !want.includes(n)) continue;
    let panel;
    try { panel = cs.parseReviewPanel(snap); } catch { continue; }
    if (!panel?.options.length) continue;
    panel.chosen = null;
    const prev = got.get(n);
    if (!prev || panel.verdictsKnown > prev.verdictsKnown) got.set(n, panel);
  }
  const missing = want.filter((w) => !got.has(w));
  const partial = want.filter((w) => got.get(w)?.partial);
  console.log(`replayed ${path.basename(file)}: ${got.size} panels` +
    `${partial.length ? `, partial ${partial.join(',')}` : ''}${missing.length ? `, missing ${missing.join(',')}` : ''}`);
  await mergeInto(got, partial, missing);
}

async function mergeInto(got, partial, missing) {
  if (!into) return;
  if (!got.size) { console.log('nothing harvested; attempt left untouched'); return; }

  const file = path.resolve(into);
  const attempt = JSON.parse(await readFile(file, 'utf8'));
  let touched = 0;
  const superseded = [];
  for (const q of attempt.questions) {
    const panel = got.get(q.number);
    if (!panel) continue;
    q.answer = panel.answer ?? q.answer;
    q.selectCount = panel.selectCount ?? q.selectCount ?? null;
    q.siteStatus = panel.status ?? null;
    // Match on letter: the harvested panel and the attempt were parsed from the
    // same page, but never assume the option order survived.
    for (const opt of q.options) {
      const h = panel.options.find((o) => o.letter === opt.letter);
      if (!h) continue;
      opt.rationale = h.explanation ?? opt.rationale;
      opt.correct = h.correct;
    }
    // The observer can miss a changed answer (2026-09-26: Q49 recorded A, the
    // grid scored it correct with answer C). A choice the key and the grid
    // together contradict was superseded — drop it rather than show it.
    if (q.chosen && q.answer && !q.unresolved && (q.chosen === q.answer) !== (q.status === 'CORRECT')) {
      superseded.push(`Q${q.number} (${q.chosen})`);
      q.chosen = null;
      for (const opt of q.options) opt.chosen = false;
    }
    touched++;
  }
  attempt.warnings = [
    ...(attempt.warnings ?? []).filter((w) => !/explanation/i.test(w)),
    `answers and per-option explanations harvested for ${touched} question(s) from the results screen`,
    ...(partial.length ? [`Q${partial.join(', Q')}: not every option had a rendered explanation`] : []),
    ...(missing.length ? [`Q${missing.join(', Q')}: no explanation captured — correct answer unknown from the site`] : []),
    ...(superseded.length ? [`${superseded.join(', ')}: recorded choice contradicts the site's key and verdict — changed later, dropped`] : []),
  ];
  await writeFile(file, JSON.stringify(attempt, null, 2) + '\n');
  console.log(`▸ merged into ${path.relative(process.cwd(), file)} (${touched} questions)`);
  const report = await buildReport(attempt);
  console.log(`▸ report rebuilt: ${path.relative(process.cwd(), report)}`);
}

main().catch((e) => { console.error('\n✖ harvest failed:', e.message, '\n', e.stack); process.exit(1); });
