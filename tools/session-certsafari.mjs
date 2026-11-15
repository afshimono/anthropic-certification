#!/usr/bin/env node
/**
 * Watch a CertSafari practice sitting.
 *
 *   node tools/session-certsafari.mjs [--exam CCDV-F|CCAR-F] [--url <url>] [--idle 15]
 *
 * You drive everything — log in, clear the Cloudflare check, pick the quiz
 * settings, answer. This process only reads the page, once a second, and writes
 * every snapshot to `data/raw/<ts>-certsafari.jsonl` before trying to interpret
 * any of it. That ordering matters: their in-quiz DOM is not something we have
 * seen before, so the raw timeline is the real artefact and the parsed attempt
 * is a derived opinion we can redo offline with `--reparse`.
 *
 * Finishes when the results screen appears, when you close the browser, or
 * after `--idle` minutes with no page changes.
 */
import path from 'node:path';
import { spawn } from 'node:child_process';
import { appendFile, readFile, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';
import { open, detectGate, banner } from './lib/browser.mjs';
import { ROOT } from './lib/store.mjs';
import * as cs from './lib/extract-certsafari.mjs';
import { subskill, classify, domain, mapExternalQuestion, mapArchitectQuestion, EXAMS, DEFAULT_EXAM } from './lib/blueprint.mjs';
import { saveAttempt, paths, stamp, ensureDirs } from './lib/store.mjs';
import { buildReport } from './report.mjs';

const argv = process.argv.slice(2);
const flag = (n, d = null) => { const i = argv.indexOf(`--${n}`); return i >= 0 ? (argv[i + 1] ?? true) : d; };

const EXAM_CODE = String(flag('exam', DEFAULT_EXAM)).toUpperCase();
if (!EXAMS[EXAM_CODE]) {
  console.error(`unknown --exam "${EXAM_CODE}". Known: ${Object.keys(EXAMS).join(', ')}`);
  process.exit(1);
}
const URL_DEFAULT = EXAMS[EXAM_CODE].certsafariUrl;
const IDLE_MIN = Number(flag('idle', 15));

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

/**
 * Attach to a real Google Chrome instead of launching Playwright's Chromium.
 *
 * Why: Playwright's browser reports `navigator.webdriver = true` and carries an
 * automation fingerprint, so Cloudflare Turnstile fails the challenge no matter
 * who clicks it — the signal is the browser, not the behaviour. A Chrome the
 * user starts themselves does not set that flag, and attaching over the
 * DevTools protocol does not change it, so the challenge sees what it actually
 * is: an ordinary browser driven by a person.
 *
 * We deliberately pass no anti-detection or automation-hiding flags. The only
 * non-default argument is the debugging port we read through, plus a dedicated
 * profile so the user's own Chrome profile is never touched.
 */
async function attachToChrome(port, url) {
  const endpoint = `http://127.0.0.1:${port}`;
  const alive = async () => {
    try {
      const r = await fetch(`${endpoint}/json/version`, { signal: AbortSignal.timeout(1200) });
      return r.ok;
    } catch { return false; }
  };

  if (!(await alive())) {
    const profile = path.join(ROOT, '.chrome-profile');
    console.log(`▸ starting Chrome on port ${port} (profile: .chrome-profile)`);
    spawn(CHROME, [
      `--remote-debugging-port=${port}`,
      `--user-data-dir=${profile}`,
      '--no-first-run',
      '--no-default-browser-check',
      url,
    ], { detached: true, stdio: 'ignore' }).unref();

    for (let i = 0; i < 40 && !(await alive()); i++) await new Promise((r) => setTimeout(r, 500));
    if (!(await alive())) throw new Error(`Chrome did not expose ${endpoint} — is it installed at ${CHROME}?`);
  } else {
    console.log(`▸ found Chrome already listening on ${endpoint}`);
  }

  // Playwright needs at least one page target, otherwise attaching fails with
  // "Browser context management is not supported" — a running Chrome with every
  // tab closed looks contextless to it. Give it a tab to hold on to.
  try {
    const list = await (await fetch(`${endpoint}/json/list`, { signal: AbortSignal.timeout(2000) })).json();
    if (!list.some((t) => t.type === 'page')) {
      console.log('▸ no tabs open in that Chrome — opening one');
      await fetch(`${endpoint}/json/new?${encodeURIComponent(url)}`, { method: 'PUT' }).catch(() => {});
      await new Promise((r) => setTimeout(r, 1200));
    }
  } catch { /* fall through and let connect report the real problem */ }

  const browser = await chromium.connectOverCDP(endpoint);
  const ctx = browser.contexts()[0] ?? (await browser.newContext());
  let page = ctx.pages().find((p) => !p.isClosed()) ?? (await ctx.newPage());
  if (!/certsafari/.test(page.url())) {
    const existing = ctx.pages().find((p) => /certsafari/.test(p.url()));
    if (existing) page = existing;
    else await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 90000 }).catch(() => {});
  }
  // Never close the user's browser on exit; just let go of it.
  return { ctx, page, cleanup: () => browser.close().catch(() => {}) };
}

/** Resolve a blueprint sub-skill for a captured question. */
function attribute(q) {
  const t = q.taxonomy ?? {};
  if (t.subskillId && subskill(t.subskillId, EXAM_CODE)) return { subskillId: t.subskillId, mapping: 'labelled' };
  const text = `${q.stem ?? ''} ${q.options.map((o) => o.text).join(' ')}`;
  if (EXAM_CODE !== DEFAULT_EXAM) {
    const dn = t.domainId && domain(t.domainId, EXAM_CODE)?.name;
    const m = mapArchitectQuestion({ domainName: dn, text });
    return { subskillId: m.subskillId, mapping: m.subskillId ? m.confidence : 'none' };
  }
  if (t.domainId && domain(t.domainId)) {
    const m = mapExternalQuestion({ domainName: domain(t.domainId).name, text });
    return { subskillId: m.subskillId, mapping: m.confidence };
  }
  const loose = classify(text);
  return { subskillId: loose, mapping: loose ? 'keyword' : 'none' };
}

async function main() {
  if (argv.includes('--reparse')) return reparse(flag('reparse'));

  await ensureDirs();
  const startedAt = new Date().toISOString();
  const base = `${stamp(new Date(startedAt))}-certsafari`;
  const timeline = path.join(paths.raw, `${base}.jsonl`);
  const url = flag('url', URL_DEFAULT);

  banner([
    '▶  CERTSAFARI SESSION — you drive, I watch',
    '',
    '   1. Log in (a fresh Chrome profile, so this is a one-off)',
    '   2. Start the quiz — Turnstile should pass now; I never touch it',
    '   3. Answer at your own pace',
    '',
    `   Timeline: data/raw/${base}.jsonl`,
    '   I finish when the results screen appears or you close the tab.',
  ]);

  // --attach uses your real Chrome (needed for Turnstile); otherwise Playwright's.
  const useChrome = !argv.includes('--playwright');
  let ctx, page, cleanup;
  if (useChrome) {
    // 9333, not 9222: the user's everyday Chrome already exposes 9222 to another
    // CDP client, and Playwright cannot manage a browser someone else holds.
    ({ ctx, page, cleanup } = await attachToChrome(Number(flag('port', 9333)), url));
  } else {
    ({ ctx, page } = await open());
    cleanup = () => ctx.close().catch(() => {});
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 90000 }).catch((e) => {
      console.warn(`! navigation warning: ${e.message}`);
    });
  }

  /**
   * Diagnostics. A dead button or a timer that never starts is almost always a
   * JS exception or a rejected request, and neither shows up in a DOM snapshot.
   * These go into the same timeline so a broken sitting is still explainable.
   */
  const note = async (kind, detail) => {
    await appendFile(timeline, JSON.stringify({ at: new Date().toISOString(), event: kind, ...detail }) + '\n');
    if (kind !== 'console') console.log(`  ! ${kind}: ${detail.summary ?? ''}`);
  };
  const watchPage = (p) => {
    if (p.__watched) return;
    p.__watched = true;
    p.on('console', (m) => {
      if (m.type() !== 'error' && m.type() !== 'warning') return;
      note('console', { level: m.type(), text: m.text().slice(0, 500), summary: m.text().slice(0, 120) });
    });
    p.on('pageerror', (e) => note('pageerror', { message: e.message.slice(0, 500), summary: e.message.slice(0, 120) }));
    p.on('requestfailed', (r) => note('requestfailed', {
      url: r.url().slice(0, 200), failure: r.failure()?.errorText, summary: `${r.failure()?.errorText} ${r.url().slice(0, 90)}`,
    }));
    p.on('response', (r) => {
      if (r.status() < 400) return;
      note('httperror', { url: r.url().slice(0, 200), status: r.status(), summary: `${r.status()} ${r.url().slice(0, 90)}` });
    });
  };
  ctx.on('page', watchPage);
  for (const p of ctx.pages()) watchPage(p);

  const seen = new Map();          // questionKey -> record
  const order = [];                // keys in the order first seen
  let lastText = '';
  let lastChange = Date.now();
  let closed = false;
  let gateAnnounced = false;
  ctx.on('close', () => { closed = true; });
  page.on('close', () => { closed = true; });

  for (;;) {
    if (closed) { console.log('\n▸ browser closed — wrapping up'); break; }
    await new Promise((r) => setTimeout(r, 1100));
    if (Date.now() - lastChange > IDLE_MIN * 60000) {
      console.log(`\n▸ no changes for ${IDLE_MIN} min — wrapping up`);
      break;
    }

    // Always prefer the newest page: they may open the quiz in a new tab.
    const pages = ctx.pages().filter((p) => !p.isClosed());
    if (!pages.length) { closed = true; continue; }
    // Prefer a CertSafari tab if one exists, so an unrelated tab in front does
    // not make us think the sitting ended.
    const active = pages.find((p) => /certsafari/.test(p.url())) ?? pages.at(-1);
    watchPage(active);

    let snap;
    try {
      snap = await active.evaluate(cs.SNAPSHOT_FN);
    } catch { continue; }                       // mid-navigation; try again

    // Selecting an option changes no text, so the key must include the controls
    // and Continue — keyed on text alone, 2026-09-26 recorded 15 of 53 answers.
    const key = snap.text + JSON.stringify([
      (snap.options ?? []).map((o) => `${o.dataState}${o.ariaChecked}${o.checked}`),
      (snap.buttons ?? []).map((b) => b.disabled),
    ]);
    if (key === lastText) continue;             // nothing changed
    lastText = key;
    lastChange = Date.now();
    await appendFile(timeline, JSON.stringify(snap) + '\n');

    const gate = await detectGate(active);
    if (gate) {
      if (!gateAnnounced) {
        banner(['⏸  OVER TO YOU', `   ${gate}`, '   Clear it in the browser; I keep watching and never click it.']);
        gateAnnounced = true;
      }
      continue;
    }
    gateAnnounced = false;

    // parseSnapshot reads the question from the page text and the selected
    // option from the radio controls. The older parseQuestion derived options
    // from the DOM by array index, which lost the real A)/B) letters — and
    // captured no selection at all while option capture was broken.
    const q = cs.parseSnapshot(snap);
    if (q && cs.looksLikeQuiz(snap) && q.stem && q.options.length >= 2) {
      const key = cs.questionKey(q);
      const prev = seen.get(key);
      if (!prev) {
        order.push(key);
        seen.set(key, { ...q, firstSeen: snap.at, lastSeen: snap.at, number: order.length });
        process.stdout.write(`  Q${String(order.length).padStart(2, '0')}` +
          `${q.index ? `/${q.total}` : ''}  ${q.options.length} options  ${(q.stem ?? '').slice(0, 58)}…\n`);
      } else {
        // Keep the richest version: the revealed state supersedes the blank one.
        seen.set(key, {
          ...prev,
          ...q,
          number: prev.number,
          firstSeen: prev.firstSeen,
          lastSeen: snap.at,
          chosen: q.chosen ?? prev.chosen,
          answer: q.answer ?? prev.answer,
          correct: q.correct ?? prev.correct,
          siteExplanation: q.siteExplanation ?? prev.siteExplanation,
        });
        if (q.revealed && !prev.revealed) {
          process.stdout.write(`      ↳ revealed: ${q.correct === true ? 'correct' : q.correct === false ? 'incorrect' : 'unclear'}` +
            `${q.chosen ? ` (chose ${q.chosen}${q.answer ? `, answer ${q.answer}` : ''})` : ''}\n`);
        }
      }
    }

    if (cs.isFinished(snap.text) && order.length) {
      console.log('\n▸ results screen detected');
      await active.screenshot({ path: path.join(paths.raw, `${base}.png`), fullPage: true }).catch(() => {});
      await writeFile(path.join(paths.raw, `${base}-results.txt`), snap.bodyText ?? snap.text);
      lastText = '__done__';
      await new Promise((r) => setTimeout(r, 2500));
      break;
    }
  }

  await finalize({ startedAt, url, base, timeline, records: order.map((k) => seen.get(k)) });
  await cleanup?.();
  process.exit(0);
}

async function finalize({ startedAt, url, base, timeline, records }) {
  // A sitting only counts if something was actually attempted. Saving an
  // attempt built from stray page text would put fiction into HISTORY.md and
  // STUDY-PLAN.md, which is worse than recording nothing.
  const attempted = records.filter((r) => r.chosen || r.correct != null);
  if (!records.length || !attempted.length) {
    banner([
      '⚠  NO SITTING RECORDED',
      `   ${records.length ? `${records.length} question-like block(s) seen, none answered.` : 'No questions captured.'}`,
      '   Nothing was written to your record — deliberately.',
      '',
      `   The raw timeline is saved: data/raw/${path.basename(timeline)}`,
      '   Tell me and I will read it, fix the extractor, then re-parse:',
      `   node tools/session-certsafari.mjs --reparse data/raw/${path.basename(timeline)}`,
    ]);
    return;
  }

  const questions = records.map((q) => {
    const attr = attribute(q);
    return {
      number: q.number,
      questionId: null,
      subskillId: attr.subskillId,
      mapping: attr.mapping,
      tags: q.taxonomy?.subskillId ?? q.taxonomy?.domainId ?? null,
      stem: q.stem,
      status: q.correct === true ? 'CORRECT' : q.correct === false ? 'INCORRECT' : 'UNRESOLVED',
      correct: q.correct === true,
      skipped: !q.chosen,
      unresolved: q.correct == null,
      options: q.options.map((o) => ({
        letter: o.letter, text: o.text, rationale: null,
        chosen: !!o.chosen, correct: o.signal === 'correct',
      })),
      chosen: q.chosen,
      answer: q.answer,
      siteExplanation: q.siteExplanation,
      refs: [`certsafari.com — ${EXAMS[EXAM_CODE].name} practice bank`],
      timeMs: new Date(q.lastSeen) - new Date(q.firstSeen),
    };
  });

  const resolved = questions.filter((q) => !q.unresolved);
  const nCorrect = resolved.filter((q) => q.correct).length;
  const unresolved = questions.length - resolved.length;

  const attempt = {
    source: 'certsafari',
    examCode: EXAM_CODE,
    targetExam: EXAM_CODE,
    mapped: false,
    url,
    startedAt,
    finishedAt: new Date().toISOString(),
    score: {
      scaled: resolved.length ? Math.round((nCorrect / resolved.length) * 1000) : null,
      passed: resolved.length ? (nCorrect / resolved.length) * 1000 >= 720 : null,
      correct: nCorrect,
      total: resolved.length,
      percent: resolved.length ? Math.round((nCorrect / resolved.length) * 100) : null,
      passMark: EXAMS[EXAM_CODE].passScaled,
    },
    nativeDomains: [],
    questions,
    warnings: unresolved
      ? [`${unresolved} of ${questions.length} questions had no readable correctness signal — ` +
         `excluded from the score. Re-parse after the extractor is calibrated.`]
      : [],
    rawFile: `data/raw/${path.basename(timeline)}`,
  };

  const file = await saveAttempt(attempt);
  banner([
    '✔  SITTING RECORDED',
    `   Resolved: ${nCorrect}/${resolved.length} correct` + (unresolved ? `  (${unresolved} unresolved)` : ''),
    `   Attempt:  ${path.relative(process.cwd(), file)}`,
    `   Timeline: ${attempt.rawFile}`,
  ]);
  if (unresolved) console.log(`  note: ${attempt.warnings[0]}\n`);
  if (unresolved === questions.length) {
    console.log('  Timed mode shows no verdicts live. Delete the empty attempt above, then recover from the results grid:');
    console.log(`    node tools/recover-certsafari.mjs data/raw/${path.basename(timeline)}\n`);
  }

  const report = await buildReport(attempt);
  console.log(`▸ report written:  ${path.relative(process.cwd(), report)}`);
  console.log('▸ record updated:  HISTORY.md, STUDY-PLAN.md\n');
  console.log('Next: tell me "review my certsafari session" — I will read the timeline,');
  console.log('write my own explanation for everything you missed, and save it to reviews/.\n');
}

/** Re-parse a saved timeline after the extractor has been improved. */
async function reparse(file) {
  const lines = (await readFile(file, 'utf8')).trim().split('\n');
  console.log(`re-parsing ${lines.length} snapshots from ${file}`);
  const seen = new Map(); const order = [];
  for (const line of lines) {
    let snap; try { snap = JSON.parse(line); } catch { continue; }
    const q = cs.parseSnapshot(snap);
    if (!q || !q.stem || q.options.length < 2) continue;
    const key = cs.questionKey(q);
    const prev = seen.get(key);
    if (!prev) { order.push(key); seen.set(key, { ...q, firstSeen: snap.at, lastSeen: snap.at, number: order.length }); }
    else seen.set(key, {
      ...prev, ...q, number: prev.number, firstSeen: prev.firstSeen, lastSeen: snap.at,
      chosen: q.chosen ?? prev.chosen, answer: q.answer ?? prev.answer,
      correct: q.correct ?? prev.correct, siteExplanation: q.siteExplanation ?? prev.siteExplanation,
    });
  }
  const records = order.map((k) => seen.get(k));
  console.log(`found ${records.length} questions; ` +
    `${records.filter((r) => r.correct != null).length} with a correctness signal`);
  await finalize({
    startedAt: records[0]?.firstSeen ?? new Date().toISOString(),
    url: records[0]?.url ?? URL_DEFAULT,
    base: path.basename(file, '.jsonl'),
    timeline: file,
    records,
  });
  process.exit(0);
}

main().catch((e) => { console.error('\n✖ session failed:', e.message, '\n', e.stack); process.exit(1); });
