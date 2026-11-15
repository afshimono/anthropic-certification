#!/usr/bin/env node
/**
 * Where you stand right now, across every recorded sitting.
 *   node tools/stats.mjs
 */
import { loadAttempts } from './lib/store.mjs';
import { examConfig, examOfAttempt, DEFAULT_EXAM } from './lib/blueprint.mjs';
import { tally, studyQueue, projectScaled } from './report.mjs';

const flagI = process.argv.indexOf('--exam');
const EXAM_CODE = flagI >= 0 ? process.argv[flagI + 1] : DEFAULT_EXAM;
const { blueprint: BLUEPRINT, subskills: SUBSKILLS } = examConfig(EXAM_CODE);
const attempts = (await loadAttempts()).filter((a) => examOfAttempt(a) === EXAM_CODE);
if (!attempts.length) {
  console.log(`No ${EXAM_CODE} sittings recorded yet. Run: npm run session`);
  process.exit(0);
}

const rows = tally(attempts, EXAM_CODE);
const proj = projectScaled(rows);
const covered = rows.filter((r) => r.total > 0);
const bar = (acc) => {
  const n = Math.round((acc ?? 0) * 20);
  return '█'.repeat(n) + '·'.repeat(20 - n);
};

console.log(`\n${EXAM_CODE} readiness — ${attempts.length} sitting(s), ` +
  `${attempts.reduce((s, a) => s + (a.questions?.length ?? 0), 0)} questions answered\n`);
if (proj) {
  const verdict = proj.scaled >= 720 ? 'above' : 'below';
  console.log(`  Projected scaled score: ${proj.scaled} / 1000  (${verdict} the 720 pass mark)`);
  console.log(`  Blueprint coverage:     ${covered.length}/${SUBSKILLS.length} sub-skills ` +
    `= ${proj.coverage}% of exam weight\n`);
}

for (const d of BLUEPRINT) {
  const rs = rows.filter((r) => r.domainId === d.id);
  const seen = rs.filter((r) => r.total > 0);
  const c = seen.reduce((s, r) => s + r.correct, 0);
  const t = seen.reduce((s, r) => s + r.total, 0);
  const acc = t ? c / t : null;
  console.log(`${d.id} ${d.name}  ${String(d.weight).padStart(5)}%   ` +
    (t ? `${bar(acc)} ${String(Math.round(acc * 100)).padStart(3)}%  (${c}/${t})` : '— not covered yet'));
  for (const r of rs) {
    const a = r.total ? r.correct / r.total : null;
    console.log(`   ${r.id.padEnd(4)} ${r.name.padEnd(36)} ${String(r.weight).padStart(4)}%  ` +
      (r.total ? `${String(Math.round(a * 100)).padStart(3)}% (${r.correct}/${r.total})${r.impact > 1 ? `  impact ${r.impact}` : ''}` : '—'));
  }
  console.log('');
}

const queue = studyQueue(rows).slice(0, 6);
if (queue.length) {
  console.log('Study next (exam weight × miss rate):');
  queue.forEach((r, i) => console.log(`  ${i + 1}. ${r.id} ${r.name} — impact ${r.impact}, ` +
    `${r.total - r.correct}/${r.total} missed`));
  console.log('');
}
