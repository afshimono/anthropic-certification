/**
 * The cumulative record across every sitting.
 *
 * `data/attempts/*.json` stays the source of truth; everything here is derived
 * and rebuilt from scratch on each run, so it can never drift or double-count
 * when a report is regenerated.
 */
import { readdir } from 'node:fs/promises';
import { BLUEPRINT, DEFAULT_EXAM, examConfig, examOfAttempt } from './blueprint.mjs';
import { paths } from './store.mjs';

const pct = (c, t) => (t ? Math.round((c / t) * 100) : null);

/** One row per sitting, plus a per-sub-skill time series. */
export function buildHistory(attempts, exam = DEFAULT_EXAM) {
  const sorted = attempts.filter((a) => examOfAttempt(a) === exam).sort((a, b) => (a.startedAt ?? '').localeCompare(b.startedAt ?? ''));

  const sittings = sorted.map((a) => {
    const qs = a.questions ?? [];
    const times = qs.map((q) => q.timeMs).filter((t) => t > 0);
    const bySub = {};
    for (const q of qs) {
      if (!q.subskillId) continue;
      (bySub[q.subskillId] ??= { correct: 0, total: 0 });
      bySub[q.subskillId].total++;
      if (q.correct) bySub[q.subskillId].correct++;
    }
    return {
      at: a.startedAt,
      source: a.source,
      examCode: a.examCode ?? null,
      mapped: !!a.mapped,
      scaled: a.score?.scaled ?? null,
      passed: a.score?.passed ?? null,
      correct: a.score?.correct ?? null,
      total: a.score?.total ?? null,
      percent: a.score?.percent ?? null,
      avgMs: times.length ? Math.round(times.reduce((s, t) => s + t, 0) / times.length) : null,
      subskills: bySub,
      report: a.startedAt ? `reports/${a.startedAt.replace(/\.\d+Z$/, 'Z').replace(/:/g, '-')}-*` : null,
    };
  });

  // Per-sub-skill series: one entry per sitting that touched it.
  const series = {};
  for (const s of examConfig(exam).subskills) series[s.id] = [];
  for (const sit of sittings) {
    for (const [id, v] of Object.entries(sit.subskills)) {
      series[id]?.push({ at: sit.at, source: sit.source, ...v, percent: pct(v.correct, v.total) });
    }
  }

  return { sittings, series };
}

/**
 * Per-sub-skill standing: lifetime accuracy, how it is moving, and how stale it
 * is. `trend` compares the most recent sitting against everything before it, so
 * it only appears once a sub-skill has been seen twice.
 */
export function standing(history, exam = DEFAULT_EXAM) {
  return examConfig(exam).subskills.map((s) => {
    const runs = history.series[s.id] ?? [];
    const correct = runs.reduce((a, r) => a + r.correct, 0);
    const total = runs.reduce((a, r) => a + r.total, 0);
    const accuracy = total ? correct / total : null;
    const impact = total ? +(s.weight * (1 - accuracy)).toFixed(2) : null;

    let trend = null;
    if (runs.length > 1) {
      const last = runs.at(-1);
      const prior = runs.slice(0, -1);
      const pc = prior.reduce((a, r) => a + r.correct, 0) / prior.reduce((a, r) => a + r.total, 0);
      const lc = last.correct / last.total;
      const delta = Math.round((lc - pc) * 100);
      trend = { delta, dir: delta > 5 ? 'up' : delta < -5 ? 'down' : 'flat' };
    }

    return {
      ...s, correct, total, accuracy, impact, trend,
      sittings: runs.length,
      lastSeen: runs.at(-1)?.at ?? null,
    };
  });
}

/** Where an exam's per-sub-skill study notes live. */
export const studyDir = (exam = DEFAULT_EXAM) =>
  exam === DEFAULT_EXAM ? paths.study : `${paths.study}/${examConfig(exam).slug}`;

/** Which sub-skills already have study notes written for them. */
export async function studyNotes(exam = DEFAULT_EXAM) {
  // CCDV-F notes live in study/; CCAR-F ids collide with them, so they get a subfolder.
  const dir = studyDir(exam);
  let files = [];
  try {
    files = (await readdir(dir)).filter((f) => f.endsWith('.md'));
  } catch { /* study dir not created yet */ }
  const map = {};
  for (const s of examConfig(exam).subskills) {
    const hit = files.find((f) => f.startsWith(`${s.id}-`) || f.startsWith(`${s.id.replace('.', '-')}-`));
    if (hit) map[s.id] = hit;
  }
  return map;
}

/** Blueprint-weighted projection over the sub-skills actually covered. */
export function project(rows) {
  const seen = rows.filter((r) => r.total > 0);
  if (!seen.length) return null;
  const w = seen.reduce((s, r) => s + r.weight, 0);
  const got = seen.reduce((s, r) => s + r.weight * r.accuracy, 0);
  return { scaled: Math.round((got / w) * 1000), coverageWeight: +w.toFixed(1), covered: seen.length };
}

/**
 * Composition for the next drill: spend questions where exam weight x weakness
 * is highest, and reserve a few for sub-skills never yet tested, since an
 * untested sub-skill is unmeasured risk rather than known strength.
 */
export function nextDrill(rows, size = 12) {
  const weak = rows.filter((r) => r.total > 0 && r.accuracy < 1).sort((a, b) => b.impact - a.impact);
  const blind = rows.filter((r) => r.total === 0).sort((a, b) => b.weight - a.weight);

  const plan = [];
  const blindSlots = Math.min(blind.length, Math.round(size * 0.3));
  const weakSlots = size - blindSlots;

  const wTotal = weak.reduce((s, r) => s + r.impact, 0) || 1;
  let used = 0;
  for (const r of weak) {
    const n = Math.max(1, Math.round((r.impact / wTotal) * weakSlots));
    if (used + n > weakSlots) break;
    plan.push({ id: r.id, name: r.name, questions: n, why: `impact ${r.impact}` });
    used += n;
  }
  for (const r of blind.slice(0, blindSlots)) {
    plan.push({ id: r.id, name: r.name, questions: 1, why: `never tested · ${r.weight}% of exam` });
  }
  return plan;
}

export { pct, BLUEPRINT };
