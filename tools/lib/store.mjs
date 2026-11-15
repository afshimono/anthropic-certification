import { readFile, writeFile, mkdir, readdir } from 'node:fs/promises';
import path from 'node:path';

export const ROOT = path.resolve(import.meta.dirname, '../..');
export const paths = {
  attempts: path.join(ROOT, 'data/attempts'),
  raw: path.join(ROOT, 'data/raw'),
  performance: path.join(ROOT, 'data/performance.json'),
  reports: path.join(ROOT, 'reports'),
  study: path.join(ROOT, 'study'),
  profile: path.join(ROOT, '.exam-profile'),
  exams: path.join(ROOT, 'mocks/exams'),
};

export const stamp = (d = new Date()) =>
  d.toISOString().replace(/\.\d+Z$/, 'Z').replace(/[:]/g, '-');

export const slug = (s) =>
  String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60);

export async function ensureDirs() {
  for (const p of [paths.attempts, paths.raw, paths.reports, paths.study, paths.exams]) {
    await mkdir(p, { recursive: true });
  }
}

export async function saveAttempt(attempt) {
  await ensureDirs();
  const file = path.join(paths.attempts, `${stamp(new Date(attempt.startedAt))}-${slug(attempt.source)}.json`);
  await writeFile(file, JSON.stringify(attempt, null, 2) + '\n');
  return file;
}

/** Raw page text/screenshots are kept so a parsing bug never costs us a sitting. */
export async function saveRaw(name, content) {
  await ensureDirs();
  const file = path.join(paths.raw, name);
  await writeFile(file, content);
  return file;
}

export async function loadAttempts() {
  await ensureDirs();
  const files = (await readdir(paths.attempts)).filter((f) => f.endsWith('.json')).sort();
  const out = [];
  for (const f of files) {
    try {
      out.push({ _file: f, ...JSON.parse(await readFile(path.join(paths.attempts, f), 'utf8')) });
    } catch (e) {
      console.warn(`! skipping unreadable attempt ${f}: ${e.message}`);
    }
  }
  return out;
}

export async function readJson(file, fallback = null) {
  try {
    return JSON.parse(await readFile(file, 'utf8'));
  } catch {
    return fallback;
  }
}

export const writeJson = (file, data) => writeFile(file, JSON.stringify(data, null, 2) + '\n');
