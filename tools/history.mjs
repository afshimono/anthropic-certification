#!/usr/bin/env node
/**
 * Rebuild the cumulative record and the study plan from every recorded sitting.
 *
 *   node tools/history.mjs
 *
 * Writes:
 *   HISTORY.md          human-readable ledger: one row per sitting, plus trends
 *   STUDY-PLAN.md       what to study next, ranked, with the next drill's shape
 *   data/history.json   machine-readable time series
 *
 * Runs automatically at the end of every sitting; safe to run by hand any time.
 */
import path from 'node:path';
import { writeFile } from 'node:fs/promises';
import { loadAttempts, paths, ROOT, writeJson } from './lib/store.mjs';
import { EXAMS, DEFAULT_EXAM } from './lib/blueprint.mjs';
import { buildHistory, standing, studyNotes, project, nextDrill, pct } from './lib/history.mjs';

const day = (iso) => (iso ? iso.slice(0, 10) : '—');
const mmss = (ms) => (ms == null ? '—' : `${Math.floor(ms / 60000)}:${String(Math.round((ms % 60000) / 1000)).padStart(2, '0')}`);
const ARROW = { up: '▲', down: '▼', flat: '→' };
const bar = (acc) => (acc == null ? '' : '█'.repeat(Math.round(acc * 10)) + '·'.repeat(10 - Math.round(acc * 10)));

/** Output filenames: CCDV-F keeps its original names, other exams get a suffix. */
export const outputs = (exam) => {
  const sfx = exam === DEFAULT_EXAM ? '' : `-${exam}`;
  return { history: `HISTORY${sfx}.md`, plan: `STUDY-PLAN${sfx}.md`, json: `data/history${sfx.toLowerCase()}.json` };
};

export async function writeHistory(attempts = null) {
  const all = attempts ?? (await loadAttempts());
  const result = {};
  for (const exam of Object.keys(EXAMS)) result[exam] = await writeExamHistory(all, exam);
  return result[DEFAULT_EXAM];
}

async function writeExamHistory(all, exam) {
  const cfg = EXAMS[exam];
  const out = outputs(exam);
  const history = buildHistory(all, exam);
  const rows = standing(history, exam);
  const notes = await studyNotes(exam);
  const proj = project(rows);

  await writeJson(path.join(ROOT, out.json), {
    exam,
    updatedAt: new Date().toISOString(),
    projection: proj,
    sittings: history.sittings,
    series: history.series,
    standing: rows.map(({ trend, ...r }) => ({ ...r, trendDelta: trend?.delta ?? null })),
  });

  await writeFile(path.join(ROOT, out.history), ledger(history, rows, proj, cfg));
  await writeFile(path.join(ROOT, out.plan), plan(history, rows, proj, notes, cfg));
  return { history, rows, proj };
}

function ledger(history, rows, proj, cfg) {
  const { blueprint: BLUEPRINT, subskills: SUBSKILLS } = cfg;
  const L = [];
  L.push(`# Sitting history — ${cfg.code}`);
  L.push('');
  L.push('_Derived from `data/attempts/`. Rebuilt after every sitting — do not edit by hand._');
  L.push('');

  if (!history.sittings.length) {
    L.push('No sittings recorded yet. Run `npm run session`.');
    L.push('');
    return L.join('\n');
  }

  L.push('## Every sitting');
  L.push('');
  L.push('| # | Date | Source | Score | Result | Correct | Avg/question |');
  L.push('|---|---|---|---|---|---|---|');
  history.sittings.forEach((s, i) => {
    L.push(`| ${i + 1} | ${day(s.at)} | \`${s.source}\`${s.mapped ? ' *(mapped)*' : ''} | ` +
      `${s.scaled ?? '—'} | ${s.passed === true ? '✅' : s.passed === false ? '❌' : '—'} | ` +
      `${s.correct ?? '—'}/${s.total ?? '—'} | ${mmss(s.avgMs)} |`);
  });
  L.push('');
  if (history.sittings.some((s) => s.mapped)) {
    L.push(`*(mapped)* = the Architect (CCAR-F) mock, projected onto the ${cfg.code} blueprint.`);
    L.push('');
  }

  const scores = history.sittings.filter((s) => s.scaled != null);
  if (scores.length > 1) {
    const first = scores[0], last = scores.at(-1);
    const d = last.scaled - first.scaled;
    L.push(`**Score movement:** ${first.scaled} → ${last.scaled} ` +
      `(${d >= 0 ? '+' : ''}${d} across ${scores.length} scored sittings). ` +
      `Pass mark is 720; latest is ${last.scaled >= 720 ? 'at or above it' : `${720 - last.scaled} short`}.`);
    L.push('');
  }

  L.push('## Sub-skill standing');
  L.push('');
  L.push('`Trend` compares the latest sitting against every earlier one, so it appears');
  L.push('only once a sub-skill has come up twice. Read it alongside `Sittings`: a');
  L.push('sub-skill seen once per sitting swings the full ±100pp on a single question,');
  L.push('so only the ones with several questions behind them carry much signal.');
  L.push('');
  if (SUBSKILLS.some((x) => x.weightEstimated)) {
    L.push(`> ${cfg.code} publishes domain weights only. Each task statement carries its domain's weight`);
    L.push('> split evenly, so within a domain rank by miss rate, not weight.');
    L.push('');
  }
  L.push('| Sub-skill | Weight | Lifetime | | Sittings | Trend | Last seen |');
  L.push('|---|---|---|---|---|---|---|');
  for (const d of BLUEPRINT) {
    for (const r of rows.filter((x) => x.domainId === d.id)) {
      L.push(`| ${r.id} ${r.name} | ${r.weight}% | ` +
        (r.total ? `${r.correct}/${r.total} (${pct(r.correct, r.total)}%)` : '—') + ' | ' +
        `\`${bar(r.accuracy)}\` | ${r.sittings || '—'} | ` +
        `${r.trend ? `${ARROW[r.trend.dir]} ${r.trend.delta >= 0 ? '+' : ''}${r.trend.delta}pp` : '—'} | ` +
        `${day(r.lastSeen)} |`);
    }
  }
  L.push('');

  L.push('## Domain rollup');
  L.push('');
  L.push('| Domain | Weight | Lifetime | Covered sub-skills |');
  L.push('|---|---|---|---|');
  for (const d of BLUEPRINT) {
    const rs = rows.filter((r) => r.domainId === d.id);
    const seen = rs.filter((r) => r.total > 0);
    const c = seen.reduce((s, r) => s + r.correct, 0);
    const t = seen.reduce((s, r) => s + r.total, 0);
    L.push(`| ${d.id} ${d.name} | ${d.weight}% | ${t ? `${c}/${t} (${pct(c, t)}%)` : '—'} | ${seen.length}/${rs.length} |`);
  }
  L.push('');
  if (proj) {
    L.push(`**Projection:** ~${proj.scaled} / 1000, over ${proj.covered}/${SUBSKILLS.length} sub-skills ` +
      `covering ${proj.coverageWeight}% of exam weight. Sub-skills never tested are excluded, so this is ` +
      `a read on what has been measured — not on the whole exam.`);
    L.push('');
  }
  return L.join('\n');
}

function plan(history, rows, proj, notes, cfg) {
  const { subskills: SUBSKILLS } = cfg;
  const notesDir = cfg.code === DEFAULT_EXAM ? 'study' : `study/${cfg.slug}`;
  const L = [];
  L.push(`# Study plan — ${cfg.code}`);
  L.push('');
  L.push('_Regenerated after every sitting from `data/attempts/`. Ranked by `impact`');
  L.push('= exam weight × miss rate — the blueprint points a weakness is costing._');
  L.push('');

  if (!history.sittings.length) {
    L.push(cfg.code === DEFAULT_EXAM
      ? 'No sittings recorded yet. Run `npm run session -- --mock ccdv-f-drill-01`.'
      : `No ${cfg.code} sittings recorded yet. Run \`npm run session:certsafari -- --exam ${cfg.code}\`.`);
    L.push('');
    return L.join('\n');
  }

  if (proj) {
    const gap = 720 - proj.scaled;
    L.push(`**Where you stand:** ~${proj.scaled} / 1000 projected — ` +
      (gap > 0 ? `**${gap} points short** of the 720 pass mark.` : `**${-gap} points clear** of the 720 pass mark.`));
    L.push('');
    L.push(`Measured across ${proj.covered} of ${SUBSKILLS.length} sub-skills ` +
      `(${proj.coverageWeight}% of exam weight). ${100 - proj.coverageWeight > 0 ? `The remaining ${(100 - proj.coverageWeight).toFixed(1)}% is untested.` : ''}`);
    L.push('');
  }

  const weak = rows.filter((r) => r.total > 0 && r.accuracy < 1).sort((a, b) => b.impact - a.impact);
  L.push('## 1. Fix these first');
  L.push('');
  if (!weak.length) {
    L.push('Nothing missed so far. Priority shifts to coverage — see the blind spots below.');
  } else {
    L.push('| # | Sub-skill | Weight | Accuracy | Impact | Trend | Notes |');
    L.push('|---|---|---|---|---|---|---|');
    weak.forEach((r, i) => {
      L.push(`| ${i + 1} | ${r.id} ${r.name} | ${r.weight}% | ${pct(r.correct, r.total)}% (${r.correct}/${r.total}) | ` +
        `**${r.impact}** | ${r.trend ? `${ARROW[r.trend.dir]} ${r.trend.delta >= 0 ? '+' : ''}${r.trend.delta}pp` : '—'} | ` +
        `${notes[r.id] ? `[notes](${notesDir}/${notes[r.id]})` : '— none yet'} |`);
    });
  }
  L.push('');

  const repeat = weak.filter((r) => r.sittings > 1 && r.trend && r.trend.dir !== 'up');
  if (repeat.length) {
    L.push('### Not improving');
    L.push('');
    L.push('Seen more than once and still flat or falling — re-reading the notes is not working,');
    L.push('so these want a different angle: write the code, or drill the exact distinction.');
    L.push('');
    for (const r of repeat) L.push(`- **${r.id} ${r.name}** — ${pct(r.correct, r.total)}% over ${r.sittings} sittings, last ${day(r.lastSeen)}`);
    L.push('');
  }

  const blind = rows.filter((r) => r.total === 0).sort((a, b) => b.weight - a.weight);
  L.push('## 2. Blind spots');
  L.push('');
  if (!blind.length) {
    L.push('Every sub-skill has been tested at least once.');
  } else {
    L.push(`${blind.length} sub-skills have never come up, worth ` +
      `**${blind.reduce((s, r) => s + r.weight, 0).toFixed(1)}%** of the exam. Unmeasured, not safe:`);
    L.push('');
    L.push('| Sub-skill | Weight |');
    L.push('|---|---|');
    for (const r of blind) L.push(`| ${r.id} ${r.name} | ${r.weight}% |`);
  }
  L.push('');

  L.push('## 3. Next drill');
  L.push('');
  const drill = nextDrill(rows, 12);
  if (!drill.length) {
    L.push('No sittings to plan from yet.');
  } else {
    L.push('A 12-question set weighted to where it pays. Ask Claude: *"write me the next drill"*.');
    L.push('');
    L.push('| Sub-skill | Questions | Why |');
    L.push('|---|---|---|');
    for (const d of drill) L.push(`| ${d.id} ${d.name} | ${d.questions} | ${d.why} |`);
  }
  L.push('');

  const missing = weak.filter((r) => !notes[r.id]);
  if (missing.length) {
    L.push('## 4. Study notes still to write');
    L.push('');
    for (const r of missing) L.push(`- \`study/${r.id}-*.md\` — ${r.name} (impact ${r.impact})`);
    L.push('');
  }

  const paced = history.sittings.filter((s) => s.avgMs);
  if (paced.length) {
    const slow = paced.filter((s) => s.avgMs > 120000);
    L.push('## Pacing');
    L.push('');
    L.push(`Latest sitting averaged ${mmss(paced.at(-1).avgMs)} per question against the exam's 2:00 budget` +
      (slow.length ? `; ${slow.length} of ${paced.length} sittings ran over.` : '.'));
    L.push('');
  }

  return L.join('\n');
}

if (import.meta.filename === process.argv[1]) {
  const all = await loadAttempts();
  for (const exam of Object.keys(EXAMS)) {
    const { history, proj } = await writeExamHistory(all, exam);
    const o = outputs(exam);
    console.log(`▸ ${exam}: ${history.sittings.length} sitting(s)` +
      (proj ? `, projection ~${proj.scaled}/1000 over ${proj.coverageWeight}% of exam weight` : '') +
      ` → ${o.history}, ${o.plan}, ${o.json}`);
  }
}
