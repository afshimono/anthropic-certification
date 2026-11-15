#!/usr/bin/env node
/**
 * Turn a recorded attempt into a markdown report, and refresh the rolling
 * performance file.
 *
 *   node tools/report.mjs            # re-report the most recent attempt
 *   node tools/report.mjs --all      # re-report every attempt
 */
import path from 'node:path';
import { writeFile } from 'node:fs/promises';
import { DEFAULT_EXAM, examConfig, examOfAttempt, labelOf } from './lib/blueprint.mjs';
import { loadAttempts, paths, stamp, slug, writeJson } from './lib/store.mjs';

const pct = (n, d) => (d ? Math.round((n / d) * 100) : null);
const mmss = (ms) => (ms == null ? '—' : `${Math.floor(ms / 60000)}:${String(Math.round((ms % 60000) / 1000)).padStart(2, '0')}`);

/** Roll a list of attempts up to per-sub-skill counters. */
export function tally(attempts, exam = DEFAULT_EXAM) {
  attempts = attempts.filter((a) => examOfAttempt(a) === exam);
  const bySub = new Map(examConfig(exam).subskills.map((s) => [s.id, { ...s, correct: 0, total: 0, skipped: 0, misses: [] }]));
  for (const a of attempts) {
    for (const q of a.questions ?? []) {
      const row = bySub.get(q.subskillId);
      if (!row) continue;
      row.total++;
      if (q.correct) row.correct++;
      if (q.skipped) row.skipped++;
      if (!q.correct) row.misses.push({ attempt: a.source, date: a.startedAt, q });
    }
  }
  return [...bySub.values()].map((r) => {
    const accuracy = r.total ? r.correct / r.total : null;
    // What a point of weakness is actually worth on the real exam.
    const impact = r.total ? +(r.weight * (1 - accuracy)).toFixed(2) : null;
    return { ...r, accuracy, impact };
  });
}

/** Sub-skills worth studying next: highest exam weight x observed miss rate. */
export const studyQueue = (rows) =>
  rows.filter((r) => r.total > 0 && r.accuracy < 1)
    .sort((a, b) => b.impact - a.impact || b.weight - a.weight);

/** Weighted-by-blueprint estimate of a scaled score, from observed accuracy. */
export function projectScaled(rows) {
  const seen = rows.filter((r) => r.total > 0);
  if (!seen.length) return null;
  const w = seen.reduce((s, r) => s + r.weight, 0);
  const got = seen.reduce((s, r) => s + r.weight * r.accuracy, 0);
  return { scaled: Math.round((got / w) * 1000), coverage: +((w / 100) * 100).toFixed(1) };
}

function missBlock(q, i, exam = DEFAULT_EXAM) {
  const chosen = q.options?.find((o) => o.letter === q.chosen);
  const right = q.options?.find((o) => o.letter === q.answer);
  const L = [];
  // Only surface the mapping when it is genuinely uncertain. `labelled` is the
  // strongest of all — the source site tagged the question with the blueprint
  // sub-skill itself; `native` means our own exam declared it; `high` means a
  // keyword confirmed it inside the right domain.
  const uncertain = q.mapping && !['labelled', 'native', 'high', 'manual'].includes(q.mapping);
  L.push(`#### ❌ ${i}. ${q.skipped ? 'Skipped' : 'Missed'} — ${labelOf(q.subskillId, exam)}${uncertain ? ` _(mapping: ${q.mapping})_` : ''}`);
  L.push('');
  if (q.questionId || q.tags) L.push(`\`${[q.questionId, q.tags].filter(Boolean).join('` · `')}\``);
  if (q.scenario) L.push(`*Scenario: ${q.scenario}*`);
  L.push('');
  L.push(`> ${q.stem?.replace(/\n+/g, '\n> ') ?? '(stem not captured)'}`);
  L.push('');
  if (q.skipped) {
    L.push('**You skipped this.**');
  } else if (chosen) {
    L.push(`**You chose ${chosen.letter}:** ${chosen.text}`);
    if (chosen.rationale) L.push(`\n*Why it is wrong:* ${chosen.rationale}`);
  }
  L.push('');
  if (right) {
    L.push(`**Correct answer ${right.letter}:** ${right.text}`);
    if (right.rationale) L.push(`\n*Why it is right:* ${right.rationale}`);
  }
  if (q.refs?.length) {
    L.push('');
    L.push('**Where this comes from:**');
    for (const r of q.refs) L.push(`- ${r}`);
  }
  if (q.timeMs) L.push(`\n*Time on question: ${mmss(q.timeMs)}*`);
  L.push('');
  return L.join('\n');
}

export async function buildReport(attempt, allAttempts = null) {
  const history = allAttempts ?? (await loadAttempts());
  const exam = examOfAttempt(attempt);
  const { blueprint: BLUEPRINT, subskills: SUBSKILLS } = examConfig(exam);
  const rowsThis = tally([attempt], exam);
  const rowsAll = tally(history.length ? history : [attempt], exam);

  const s = attempt.score ?? {};
  const date = new Date(attempt.startedAt);
  const base = `${stamp(date)}-${slug(attempt.source)}`;
  const file = path.join(paths.reports, `${base}.md`);

  const misses = (attempt.questions ?? []).filter((q) => !q.correct);
  const times = (attempt.questions ?? []).map((q) => q.timeMs).filter(Boolean);
  const avg = times.length ? times.reduce((a, b) => a + b, 0) / times.length : null;
  const proj = projectScaled(rowsAll);
  const queue = studyQueue(rowsThis).slice(0, 8);

  const L = [];
  L.push(`# Session report — ${date.toISOString().slice(0, 16).replace('T', ' ')}`);
  L.push('');
  L.push(`| | |`);
  L.push(`|---|---|`);
  L.push(`| Source | \`${attempt.source}\` |`);
  L.push(`| Exam sat | ${attempt.examCode ?? '—'}${attempt.mapped ? ` (mapped onto ${attempt.targetExam})` : ''} |`);
  L.push(`| Score | **${s.scaled ?? '—'} / 1000** · pass mark ${s.passMark ?? 720} |`);
  L.push(`| Result | ${s.passed === true ? '✅ passed' : s.passed === false ? '❌ not passed' : '—'} |`);
  L.push(`| Correct | ${s.correct ?? '—'} of ${s.total ?? '—'} (${s.percent ?? '—'}%) |`);
  L.push(`| Avg time / question | ${mmss(avg)} ${avg && avg > 120000 ? '⚠️ over the 2:00 exam pace' : ''} |`);
  L.push('');

  if (attempt.mapped) {
    L.push('> This sitting was the Architect (CCAR-F) mock — the closest live proxy while the');
    L.push(`> ${exam} bank is unpublished. Its five domains are mapped onto the ${exam} blueprint,`);
    L.push('> so sub-skill attribution is indicative, not exact. Questions whose mapping is');
    L.push('> uncertain are flagged inline.');
    L.push('');
  }

  if (attempt.nativeDomains?.length) {
    L.push('## Domain breakdown as the site reported it');
    L.push('');
    L.push('| Domain | Correct | % |');
    L.push('|---|---|---|');
    for (const d of attempt.nativeDomains) {
      L.push(`| ${d.id} ${d.name} | ${d.correct ?? '?'}/${d.total ?? '?'} | ${d.percent ?? '?'}% |`);
    }
    L.push('');
  }

  L.push(`## This sitting, against the ${exam} blueprint`);
  L.push('');
  L.push('`Impact` = exam weight × miss rate. It is the number of blueprint points this');
  L.push('weakness is costing you, so the queue below is ordered by it.');
  L.push('');
  L.push('| Sub-skill | Weight | Correct | Accuracy | Impact |');
  L.push('|---|---|---|---|---|');
  for (const r of rowsThis.filter((r) => r.total > 0).sort((a, b) => b.impact - a.impact)) {
    L.push(`| ${r.id} ${r.name} | ${r.weight}% | ${r.correct}/${r.total} | ${pct(r.correct, r.total)}% | ${r.impact} |`);
  }
  const untested = rowsThis.filter((r) => r.total === 0);
  L.push('');
  if (untested.length) {
    L.push(`**Not touched this sitting (${untested.length} of ${SUBSKILLS.length}):** ` +
      untested.map((r) => `${r.id}`).join(', ') + '.');
    L.push('');
  }

  L.push('## What to study next');
  L.push('');
  if (!queue.length) {
    L.push('Nothing missed this sitting. Widen coverage instead — see the untested list above.');
  } else {
    L.push('| # | Sub-skill | Weight | Missed | Impact |');
    L.push('|---|---|---|---|---|');
    queue.forEach((r, i) => {
      L.push(`| ${i + 1} | ${r.id} ${r.name} | ${r.weight}% | ${r.total - r.correct}/${r.total} | ${r.impact} |`);
    });
  }
  L.push('');

  // At-a-glance grid, so a long sitting can be scanned without reading it all.
  const numbered = (attempt.questions ?? []).filter((q) => q.number).sort((a, b) => a.number - b.number);
  if (numbered.length > 8) {
    const width = 10;
    L.push('## All questions at a glance');
    L.push('');
    L.push('Only the ❌ ones are written up below.');
    L.push('');
    L.push(`| ${Array(width).fill(' ').join(' | ')} |`);
    L.push(`|${Array(width).fill('---').join('|')}|`);
    const mark = (q) => (q.unresolved ? `· ${q.number}` : q.correct ? `✅ ${q.number}` : `❌ ${q.number}`);
    for (let i = 0; i < numbered.length; i += width) {
      const row = numbered.slice(i, i + width).map(mark);
      while (row.length < width) row.push('');
      L.push(`| ${row.join(' | ')} |`);
    }
    L.push('');
  }

  L.push('## What went wrong, question by question');
  L.push('');
  if (!misses.length) L.push('_Clean sheet._');
  misses.forEach((q, i) => L.push(missBlock(q, i + 1, exam)));

  L.push('## Rolling position across all sittings');
  L.push('');
  if (proj) {
    L.push(`Blueprint-weighted projection from everything recorded so far: **~${proj.scaled} / 1000** ` +
      `(pass mark 720), over sub-skills covering ${proj.coverage}% of exam weight.`);
    L.push('');
  }
  L.push('| Domain | Correct | Accuracy |');
  L.push('|---|---|---|');
  for (const d of BLUEPRINT) {
    const rows = rowsAll.filter((r) => r.domainId === d.id && r.total > 0);
    const c = rows.reduce((s, r) => s + r.correct, 0);
    const t = rows.reduce((s, r) => s + r.total, 0);
    L.push(`| ${d.id} ${d.name} (${d.weight}%) | ${t ? `${c}/${t}` : '—'} | ${t ? `${pct(c, t)}%` : '—'} |`);
  }
  L.push('');
  L.push(`Raw capture: \`${attempt.rawFile ?? '—'}\``);
  if (attempt.warnings?.length) {
    L.push('');
    L.push('Parser notes: ' + attempt.warnings.join('; '));
  }
  L.push('');

  await writeFile(file, L.join('\n'));

  // Refresh the rolling performance file that /stats and I read.
  await writeJson(paths.performance, {
    updatedAt: new Date().toISOString(),
    attempts: history.length,
    projection: projectScaled(rowsAll),
    subskills: rowsAll.map(({ misses, ...r }) => ({ ...r, missCount: misses.length })),
  });

  // Refresh the cumulative ledger and study plan.
  const { writeHistory } = await import('./history.mjs');
  await writeHistory(history.length ? history : [attempt]);

  return file;
}

if (import.meta.filename === process.argv[1]) {
  const attempts = await loadAttempts();
  if (!attempts.length) {
    console.error('No attempts recorded yet. Run: npm run session');
    process.exit(1);
  }
  const targets = process.argv.includes('--all') ? attempts : [attempts.at(-1)];
  for (const a of targets) console.log('wrote', await buildReport(a, attempts));
}
