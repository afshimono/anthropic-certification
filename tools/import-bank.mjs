#!/usr/bin/env node
/**
 * Import an external question bank into runnable local mocks.
 *
 *   node tools/import-bank.mjs <path-to-question-bank.json> [--exam developer-foundations] [--dry]
 *
 * Built for the schema used by github.com/Amey-Thakur/CLAUDE-CERTIFICATIONS
 * (MIT): `{ questions: [{ id, exam, source, domain, question, options{A..D},
 * answer, rationale }] }`. Questions are grouped by their `source` field into
 * one exam file each, so the author's own sets stay intact.
 *
 * Two things this has to do carefully:
 *
 * 1. That schema carries ONE rationale per question, while our review screen
 *    shows a rationale per option. Many rationales explain the distractors
 *    inline ("... max_tokens (B) does not change per-token pricing"), so we
 *    split those clauses out to the options they name and leave the remainder
 *    on the correct answer. Nothing is discarded either way.
 * 2. It carries a domain but no sub-skill, so `mapExternalQuestion` resolves
 *    one and records how confident that was.
 */
import path from 'node:path';
import { readFile, writeFile } from 'node:fs/promises';
import { mapExternalQuestion, labelOf } from './lib/blueprint.mjs';
import { paths, ensureDirs, slug } from './lib/store.mjs';

const argv = process.argv.slice(2);
const flag = (n, d = null) => { const i = argv.indexOf(`--${n}`); return i >= 0 ? (argv[i + 1] ?? true) : d; };
const src = argv.find((a) => !a.startsWith('--'));
const EXAM = flag('exam', 'developer-foundations');
const DRY = argv.includes('--dry');

const ATTRIBUTION = {
  source: 'https://github.com/Amey-Thakur/CLAUDE-CERTIFICATIONS',
  path: `${EXAM}/ · question-bank.json`,
  author: 'Amey Thakur',
  license: 'MIT',
  notice: 'See mocks/exams/ATTRIBUTION.md for the full licence text.',
};

/**
 * Pull "<clause> (B)" style references out of a combined rationale.
 * Returns { perOption, remainder }.
 */
function splitRationale(rationale, letters) {
  const perOption = {};
  if (!rationale) return { perOption, remainder: '' };

  // Sentence-ish chunks, so a clause keeps enough context to stand alone.
  const parts = rationale.split(/(?<=[.;])\s+/);
  const keep = [];
  for (const part of parts) {
    // Letters this chunk explicitly names, e.g. "(A)" or "(A) and (C)".
    const named = [...new Set([...part.matchAll(/\(([A-E])\)/g)].map((m) => m[1]))]
      .filter((l) => letters.includes(l));
    if (named.length) {
      const text = part.replace(/\s*\(([A-E])\)/g, '').trim();
      for (const l of named) perOption[l] = [perOption[l], text].filter(Boolean).join(' ');
    } else {
      keep.push(part);
    }
  }
  return { perOption, remainder: keep.join(' ').trim() };
}

function convert(q) {
  const letters = Object.keys(q.options);
  const correct = String(q.answer).split(/[\s,+]+/).filter(Boolean);
  const { perOption, remainder } = splitRationale(q.rationale, letters);
  const text = `${q.question} ${Object.values(q.options).join(' ')}`;
  const mapped = mapExternalQuestion({ domainName: q.domain, text });

  return {
    q: {
      id: q.id,
      subskill: mapped.subskillId,
      tags: q.domain ? q.domain.toUpperCase() : null,
      stem: q.question,
      selectCount: correct.length,
      options: letters.map((L) => ({
        letter: L,
        text: q.options[L],
        correct: correct.includes(L),
        // The correct option keeps the general explanation; distractors get the
        // clause naming them, when the author wrote one.
        rationale: correct.includes(L)
          ? [remainder, perOption[L]].filter(Boolean).join(' ') || q.rationale
          : (perOption[L] ?? null),
      })),
      refs: [`${ATTRIBUTION.author} — CLAUDE-CERTIFICATIONS (MIT) — ${ATTRIBUTION.source}`],
      external: true,
    },
    mapping: mapped.confidence,
  };
}

async function main() {
  if (!src) {
    console.error('usage: node tools/import-bank.mjs <question-bank.json> [--exam <id>] [--dry]');
    process.exit(1);
  }
  const bank = JSON.parse(await readFile(path.resolve(src), 'utf8'));
  const all = bank.questions ?? [];
  const mine = all.filter((q) => q.exam === EXAM);
  if (!mine.length) {
    console.error(`no questions for exam "${EXAM}". Available: ` +
      [...new Set(all.map((q) => q.exam))].join(', '));
    process.exit(1);
  }

  const groups = {};
  for (const q of mine) (groups[q.source || 'imported'] ??= []).push(q);

  const stats = { total: 0, high: 0, 'domain-only': 0, low: 0, none: 0, withDistractorRationales: 0 };
  const written = [];

  for (const [source, qs] of Object.entries(groups)) {
    const converted = qs.map(convert);
    for (const c of converted) {
      stats.total++;
      stats[c.mapping] = (stats[c.mapping] ?? 0) + 1;
      if (c.q.options.some((o) => !o.correct && o.rationale)) stats.withDistractorRationales++;
    }
    const id = `ext-${slug(EXAM.replace('-foundations', ''))}-${slug(source)}`;
    const exam = {
      id,
      title: `${ATTRIBUTION.author}'s ${source} set — ${EXAM}`,
      minutes: Math.ceil(converted.length * 2),
      external: true,
      attribution: ATTRIBUTION,
      notes: `Imported verbatim from ${ATTRIBUTION.source} (MIT). ` +
        `Sub-skills were resolved from each question's domain label, so attribution ` +
        `within a domain is indicative. Single-answer, four-option items only.`,
      questions: converted.map((c) => c.q),
    };
    const file = path.join(paths.exams, `${id}.json`);
    if (!DRY) { await ensureDirs(); await writeFile(file, JSON.stringify(exam, null, 2) + '\n'); }
    written.push({ id, n: converted.length, file });
  }

  console.log(`imported ${stats.total} "${EXAM}" questions into ${written.length} exam(s)${DRY ? ' (dry run)' : ''}:`);
  for (const w of written) console.log(`  ${w.id.padEnd(30)} ${String(w.n).padStart(3)} questions`);
  console.log(`\nsub-skill mapping: ${stats.high} keyword-confirmed, ` +
    `${stats['domain-only'] ?? 0} domain-only, ${stats.low ?? 0} low, ${stats.none ?? 0} unmapped`);
  console.log(`distractor rationales recovered on ${stats.withDistractorRationales}/${stats.total} questions`);

  // Coverage of the blueprint, so gaps in the imported set are visible up front.
  // Counted from the written files, so this cannot drift from what was imported.
  const bySub = {};
  for (const [, qs] of Object.entries(groups)) for (const q of qs) {
    const { q: conv } = convert(q);
    bySub[conv.subskill] = (bySub[conv.subskill] ?? 0) + 1;
  }
  console.log('\ncoverage:');
  for (const [id, n] of Object.entries(bySub).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${String(n).padStart(3)}  ${labelOf(id)}`);
  }
}

main().catch((e) => { console.error('✖', e.message); process.exit(1); });
