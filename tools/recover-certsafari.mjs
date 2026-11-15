#!/usr/bin/env node
/**
 * Rebuild a CertSafari sitting from its raw timeline.
 *
 *   node tools/recover-certsafari.mjs data/raw/<ts>-certsafari.jsonl [--missed 1,2,4] [--exam CCAR-F]
 *
 * The exam is read from the timeline's quiz URL (…/architect… => CCAR-F) unless --exam is given.
 *
 * Why this exists: in Timed mode nothing is revealed during the quiz, so the
 * only record of per-question correctness is the red/green grid on the results
 * screen. Newer snapshots capture that grid directly; for sittings recorded
 * before that, pass the missed numbers with --missed (read off the results
 * screenshot). Everything else — stems, options, and each question's exact
 * `Subdomain X.Y` label — comes from the timeline text.
 */
import path from 'node:path';
import { readFile } from 'node:fs/promises';
import * as cs from './lib/extract-certsafari.mjs';
import { subskill, labelOf, mapArchitectQuestion, EXAMS, DEFAULT_EXAM } from './lib/blueprint.mjs';
import { saveAttempt } from './lib/store.mjs';
import { buildReport } from './report.mjs';

const argv = process.argv.slice(2);
const flag = (n, d = null) => { const i = argv.indexOf(`--${n}`); return i >= 0 ? (argv[i + 1] ?? true) : d; };
const file = argv.find((a) => !a.startsWith('--'));

if (!file) {
  console.error('usage: node tools/recover-certsafari.mjs <timeline.jsonl> [--missed 1,2,4]');
  process.exit(1);
}

const missedFlag = flag('missed');
const missedSet = missedFlag
  ? new Set(String(missedFlag).split(',').map((s) => Number(s.trim())).filter(Number.isFinite))
  : null;

const raw = (await readFile(path.resolve(file), 'utf8')).trim().split('\n');
const snaps = [];
for (const line of raw) {
  try { const o = JSON.parse(line); if (!o.event) snaps.push(o); } catch { /* skip */ }
}
console.log(`read ${snaps.length} snapshots from ${path.basename(file)}`);

const EXAM_CODE = String(flag('exam', snaps.some((s) => /architect/i.test(s.url ?? '')) ? 'CCAR-F' : DEFAULT_EXAM)).toUpperCase();
if (!EXAMS[EXAM_CODE]) { console.error(`unknown --exam "${EXAM_CODE}"`); process.exit(1); }
console.log(`exam: ${EXAM_CODE}`);

// ── questions, keyed by their own position in the quiz ──────────────────────
const byNumber = new Map();
for (const s of snaps) {
  const q = cs.parseSnapshot(s);
  if (!q || !q.stem || !q.options.length) continue;
  const prev = byNumber.get(q.number);
  // Last complete capture wins. Advancing a question re-renders the header
  // before the body, so the first snapshot under a new number can still hold
  // the *previous* question's text. Preferring the longest capture picks that
  // stale copy; preferring the latest settles on the real one.
  if (!prev) byNumber.set(q.number, { ...q, firstSeen: s.at, lastSeen: s.at, captures: 1 });
  // Keep a selection once seen: the last snapshot of a question may be captured
  // mid-transition, after the controls have reset.
  else byNumber.set(q.number, { ...q, chosen: q.chosen ?? prev.chosen, firstSeen: prev.firstSeen, lastSeen: s.at, captures: prev.captures + 1, seen: prev.seen });
  (byNumber.get(q.number).seen ??= []).push({ stem: q.stem, chosen: q.chosen });
}
// That stale first snapshot carries the previous question's *selection* too,
// with Continue enabled, so a kept selection only counts if it was seen beside
// this question's own (final) stem. 2026-09-26: Q47 and Q49 recorded Q46's and
// Q48's answers this way.
for (const q of byNumber.values()) {
  q.chosen = q.seen.filter((x) => x.stem === q.stem && x.chosen).at(-1)?.chosen ?? null;
  q.options = q.options.map((o) => ({ ...o, chosen: (q.chosen ?? '').includes(o.letter) }));
}
const numbers = [...byNumber.keys()].sort((a, b) => a - b);
const declaredTotal = byNumber.get(numbers[0])?.total ?? numbers.length;
console.log(`recovered ${numbers.length} of ${declaredTotal} questions` +
  `${numbers.length < declaredTotal ? ` (missing: ${Array.from({ length: declaredTotal }, (_, i) => i + 1).filter((n) => !byNumber.has(n)).join(', ')})` : ''}`);

// ── correctness: prefer a captured grid, fall back to --missed ──────────────
let verdicts = new Map();
let verdictSource = 'none';
for (const s of snaps) {
  if (!s.grid?.length) continue;
  // Only the scored screen's grid means anything. The pre-submit review screen
  // renders an identical pill grid for "answered", so reading a grid without
  // this guard scores every answered question correct.
  if (!cs.isFinished(s.bodyText ?? s.text ?? '')) continue;
  const g = cs.parseGrid(s.grid);
  if (g.size > verdicts.size) { verdicts = g; verdictSource = 'results grid'; }
}
if (verdicts.size < declaredTotal && missedSet) {
  verdicts = new Map(Array.from({ length: declaredTotal }, (_, i) => [i + 1, !missedSet.has(i + 1)]));
  verdictSource = '--missed (read from the results screenshot)';
}
console.log(`correctness source: ${verdictSource}` +
  (verdicts.size ? ` — ${[...verdicts.values()].filter(Boolean).length}/${verdicts.size} correct` : ''));

// ── results screen, for the score and the domain table ─────────────────────
let results = null;
for (const s of snaps) {
  const r = cs.parseResultsScreen(s.bodyText ?? s.text);
  if (r && (r.total || r.domains.length)) results = r;
}
if (results) {
  console.log(`results screen: ${results.correct}/${results.total} (${results.percent}%), ` +
    `${results.domains.length} domains`);
}

// Side files beside the timeline (optional): the site's own domain grouping, and
// a per-question task assignment. Timed mode hides the Subdomain label, so the
// domain comes from the results screen's "By domain" view and the task from
// judgement constrained to that domain. See the files' own `note` fields.
const side = async (suffix) => {
  try { return JSON.parse(await readFile(path.resolve(file).replace(/\.jsonl$/, `-${suffix}.json`), 'utf8')); }
  catch { return null; }
};
const domainFile = await side('domains');
const taskFile = await side('tasks');
// The post-quiz review panels (…-review.json): per question, the panel text and
// which option cards were marked correct / wrong. This is the site's own answer
// key and subdomain label, so it outranks everything inferred above.
const reviewFile = await side('review');
function parseReview(entry) {
  if (!entry?.text || !entry.marks?.length) return null;
  const sub = entry.text.match(/Subdomain\s+(\d\.\d)/i)?.[1] ?? null;
  const body = entry.text.slice(entry.text.search(/\n\s*[A]\) /));
  const parts = [...body.split(/\n(?=[A-D]\) )/)].map((c) => {
    const m = c.match(/^([A-D])\) ([\s\S]*?)\nExplanation\n([\s\S]*?)(?:\nSave\b[\s\S]*)?$/);
    return m ? { letter: m[1], text: m[2].trim(), rationale: m[3].trim() } : null;
  }).filter(Boolean);
  const right = entry.marks.find((m) => m.success)?.letter ?? null;
  const wrong = entry.marks.find((m) => m.destructive)?.letter ?? null;
  return { sub, parts, right, wrong };
}
const domainOf = (n) => Object.entries(domainFile ?? {}).find(([k, v]) => /^D\d$/.test(k) && v.includes(n))?.[0] ?? null;

// ── assemble ───────────────────────────────────────────────────────────────
const questions = numbers.map((n) => {
  const q = byNumber.get(n);
  const verdict = verdicts.get(n);
  const known = subskill(q.subskillId, EXAM_CODE);
  // Timed mode shows no Subdomain label. For CCAR-F fall back to keywords so the
  // sitting still lands on the blueprint; it is flagged `keyword` and checked
  // against the site's own per-domain totals below.
  const rev = parseReview(reviewFile?.[n]);
  const dom = domainOf(n);
  // Answer given: a right answer is the marked-correct card; a wrong one is the
  // card the site flags destructive. Falls back to the captured radio state.
  const chosenLetter = rev ? (verdict === true ? rev.right : rev.wrong ?? q.chosen) : q.chosen;
  const manual = taskFile?.tasks?.[n];
  const manualOk = manual && subskill(manual, EXAM_CODE) && (!dom || manual.split('.')[0] === dom.slice(1));
  if (manual && !manualOk) console.warn(`! Q${n}: task ${manual} is not inside the site's domain ${dom} — ignored`);
  const guess = !known && !manualOk && EXAM_CODE !== DEFAULT_EXAM
    ? mapArchitectQuestion({ text: `${q.stem} ${q.options.map((o) => o.text).join(' ')}`,
        domainName: dom ? EXAMS[EXAM_CODE].blueprint.find((d) => d.id === dom)?.name : null }) : null;
  const guessId = manualOk ? manual : guess?.subskillId ?? null;
  return {
    number: n,
    questionId: null,
    subskillId: rev?.sub && subskill(rev.sub, EXAM_CODE) ? rev.sub : known ? q.subskillId : guessId,
    mapping: known || (rev?.sub && subskill(rev.sub, EXAM_CODE)) ? 'labelled' : manualOk ? 'manual' : guessId ? 'keyword' : 'none',
    domainId: dom,
    tags: q.subskillName ? `${q.subskillId} ${q.subskillName}` : null,
    stem: q.stem,
    status: verdict === true ? 'CORRECT' : verdict === false ? 'INCORRECT' : 'UNRESOLVED',
    correct: verdict === true,
    skipped: false,
    unresolved: verdict == null,
    // `chosen` comes from the radio controls when the snapshot captured them.
    // The correct letter is never revealed in Timed mode, so it stays null
    // rather than being guessed.
    options: q.options.map((o) => ({
      letter: o.letter, text: o.text,
      rationale: rev?.parts.find((p) => p.letter === o.letter)?.rationale ?? null,
      chosen: (chosenLetter ?? '').includes(o.letter),
      correct: rev ? rev.right === o.letter : false,
    })),
    chosen: chosenLetter ?? null,
    answer: rev?.right ?? null,
    marked: q.marked,
    refs: [`certsafari.com — ${EXAM_CODE} practice bank (Timed mode)`],
    timeMs: Math.max(0, new Date(q.lastSeen) - new Date(q.firstSeen)),
  };
});

// Cross-check keyword attribution against the site's own per-domain totals.
if (results?.domains?.length && questions.some((q) => q.mapping === 'keyword')) {
  console.log('\ndomain check (keyword attribution vs site):');
  for (const d of results.domains) {
    const mine = questions.filter((q) => q.subskillId?.split('.')[0] === d.id.slice(1));
    console.log(`  ${d.id}  site ${d.correct}/${d.total}   keyword ${mine.filter((q) => q.correct).length}/${mine.length}`);
  }
}

const resolved = questions.filter((q) => !q.unresolved);
const nCorrect = resolved.filter((q) => q.correct).length;

const attempt = {
  source: 'certsafari',
  examCode: EXAM_CODE,
  targetExam: EXAM_CODE,
  mapped: false,
  url: EXAMS[EXAM_CODE].certsafariUrl,
  startedAt: byNumber.get(numbers[0])?.firstSeen ?? new Date().toISOString(),
  finishedAt: byNumber.get(numbers.at(-1))?.lastSeen ?? new Date().toISOString(),
  mode: 'timed',
  score: {
    // Trust the site's own tally when we have it; ours is a cross-check.
    scaled: results?.total ? Math.round((results.correct / results.total) * 1000)
      : resolved.length ? Math.round((nCorrect / resolved.length) * 1000) : null,
    passed: results?.total ? (results.correct / results.total) * 1000 >= 720 : null,
    correct: results?.correct ?? nCorrect,
    total: results?.total ?? resolved.length,
    percent: results?.percent ?? (resolved.length ? Math.round((nCorrect / resolved.length) * 100) : null),
    passMark: EXAMS[EXAM_CODE].passScaled,
  },
  nativeDomains: results?.domains ?? [],
  questions,
  warnings: [
    ...(questions.length < declaredTotal
      ? [`recovered ${questions.length} of ${declaredTotal} question texts from the timeline`] : []),
    ...(verdictSource.startsWith('--missed')
      ? ['per-question correctness came from the results screenshot, not the DOM'] : []),
    ...(reviewFile ? [] : ['no post-quiz review capture: correct answers and rationales are not recorded']),
    ...(questions.some((q) => q.chosen) ? [] :
      ['the answer given was not captured: this timeline predates radio-control capture']),
  ],
  rawFile: file.replace(/^.*?(data\/raw\/)/, '$1'),
  recovered: true,
};

const out = await saveAttempt(attempt);
console.log(`\n▸ attempt saved: ${path.relative(process.cwd(), out)}`);

const report = await buildReport(attempt);
console.log(`▸ report written: ${path.relative(process.cwd(), report)}`);

// Sub-skill picture, which is the point of the exercise.
const bySub = {};
for (const q of questions) {
  if (!q.subskillId) continue;
  (bySub[q.subskillId] ??= { c: 0, t: 0 });
  bySub[q.subskillId].t++;
  if (q.correct) bySub[q.subskillId].c++;
}
console.log('\nper sub-skill (exact, from their own labels):');
for (const [id, v] of Object.entries(bySub).sort((a, b) => (a[1].c / a[1].t) - (b[1].c / b[1].t))) {
  console.log(`  ${v.c}/${v.t}  ${String(Math.round((v.c / v.t) * 100)).padStart(3)}%  ${labelOf(id, EXAM_CODE)}`);
}
const missed = questions.filter((q) => q.status === 'INCORRECT');
console.log(`\nmissed ${missed.length}: ${missed.map((q) => `Q${q.number} (${q.subskillId ?? '?'})`).join(', ')}`);
