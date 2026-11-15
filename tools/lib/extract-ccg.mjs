/**
 * Extractors for claudecertificationguide.com.
 *
 * The exam UI is Tailwind-only -- no stable class names, no data-testid, no
 * network payload we can read. What it does have is a very regular *text*
 * layout, so everything below parses `innerText` against anchors that are
 * part of the visible content ("QUESTION 01 OF 28", "WHERE THIS COMES FROM",
 * "(correct answer)"). That survives restyling, which selectors would not.
 *
 * Every parser is total: it never throws on unexpected input, it reports what
 * it could not read via `warnings` and keeps the raw text for re-parsing.
 */

const LETTERS = ['A', 'B', 'C', 'D', 'E'];
const clean = (s) => s.replace(/ /g, ' ').replace(/[ \t]+\n/g, '\n').trim();

/** True when the page is showing the graded results screen. */
export const isResultsPage = (text) => /Exam Results/i.test(text) && /Domain Breakdown/i.test(text);

/** True when an exam is in progress. */
export const isInExam = (text) => /QUESTION\s+\d+\s+OF\s+\d+/i.test(text);

/** Parse the score header: "406 / 1000", "NOT PASSED", "11 of 28 correct (39%)". */
export function parseScore(text) {
  const t = clean(text);
  const scaled = t.match(/(\d{2,4})\s*\/\s*1000/);
  const passed = /\bNOT PASSED\b/i.test(t) ? false : /\bPASSED\b/i.test(t) ? true : null;
  const tally = t.match(/(\d+)\s+of\s+(\d+)\s+correct\s*\((\d+)%\)/i);
  const mark = t.match(/Pass mark:\s*(\d+)/i);
  return {
    scaled: scaled ? Number(scaled[1]) : null,
    passed,
    correct: tally ? Number(tally[1]) : null,
    total: tally ? Number(tally[2]) : null,
    percent: tally ? Number(tally[3]) : null,
    passMark: mark ? Number(mark[1]) : 720,
  };
}

/**
 * Parse the "Domain Breakdown" block, whose rows read:
 *   D2 / Tool Design & MCP Integration / 1/5(20%)+36pts
 */
export function parseDomainBreakdown(text) {
  const t = clean(text);
  const start = t.indexOf('Domain Breakdown');
  if (start < 0) return [];
  const chunk = t.slice(start, t.search(/HOW SCORING WORKS/i) > start ? t.search(/HOW SCORING WORKS/i) : start + 2000);
  const lines = chunk.split('\n').map((l) => l.trim()).filter(Boolean);
  const rows = [];
  for (let i = 0; i < lines.length; i++) {
    if (!/^D\d$/.test(lines[i])) continue;
    const id = lines[i];
    // name and stats may share a line or be split across the next two
    const rest = lines.slice(i + 1, i + 4).join(' ');
    const m = rest.match(/(\d+)\s*\/\s*(\d+)\s*\((\d+)%\)\s*\+?(-?\d+)pts/);
    const name = (lines[i + 1] || '').replace(/\d+\s*\/\s*\d+.*$/, '').trim();
    rows.push({
      id,
      name,
      correct: m ? Number(m[1]) : null,
      total: m ? Number(m[2]) : null,
      percent: m ? Number(m[3]) : null,
      points: m ? Number(m[4]) : null,
    });
  }
  return rows;
}

/**
 * Parse the per-question review that appears after clicking SHOW DETAIL.
 * One block per question, e.g.
 *
 *   Q01 · D3
 *   3.5 ITERATIVE-REFINEMENT / TEST-DRIVEN
 *   q-3-5-009 · Code Generation with Claude Code
 *   INCORRECT
 *   <stem>
 *   A
 *   <option text>
 *   <rationale>(your answer)
 *   ...
 *   WHERE THIS COMES FROM
 *   Lesson 3.5: ... / Anthropic: ...
 */
export function parseQuestionReview(text) {
  const t = clean(text);
  const warnings = [];
  const from = t.search(/Question-by-Question Review/i);
  const body = from >= 0 ? t.slice(from) : t;

  // Split on lone "Qnn" lines, keeping the marker.
  const parts = body.split(/\n(?=Q\d{2}\s*$)/m).slice(1);
  if (!parts.length) warnings.push('no question blocks found');

  const questions = parts.map((block) => {
    const lines = block.split('\n').map((l) => l.trim());
    const number = Number((lines[0] || '').replace(/\D/g, '')) || null;

    const ccarDomain = lines.find((l) => /^D\d$/.test(l)) ?? null;
    const tags = lines.find((l) => /^\d+\.\d+\s+[A-Z0-9][A-Z0-9-]*(\s*\/\s*[A-Z0-9-]+)*$/.test(l)) ?? null;
    const questionId = lines.find((l) => /^q-[\dA-Za-z-]+$/.test(l)) ?? null;
    const statusIdx = lines.findIndex((l) => /^(CORRECT|INCORRECT|SKIPPED)$/i.test(l));
    const status = statusIdx >= 0 ? lines[statusIdx].toUpperCase() : null;
    if (!status) warnings.push(`Q${number}: no status marker`);

    // Scenario title: the first real line after the question id, skipping the
    // "·" separators the layout puts between inline chips. Absent on some items,
    // in which case the status follows straight away.
    let scenario = null;
    if (questionId) {
      for (let i = lines.indexOf(questionId) + 1; i < lines.length; i++) {
        const l = lines[i].trim();
        if (!l || l === '·') continue;
        if (!/^(CORRECT|INCORRECT|SKIPPED)$/i.test(l)) scenario = l;
        break;
      }
    }

    // Stem: everything between the status line and the first lone option letter.
    const firstOpt = lines.findIndex((l, i) => i > statusIdx && /^[A-E]$/.test(l));
    const stem = clean(lines.slice(statusIdx + 1, firstOpt > 0 ? firstOpt : undefined).join('\n'));

    // Options: slice between consecutive lone letters, stopping at the refs block.
    const refsIdx = lines.findIndex((l) => /^WHERE THIS COMES FROM$/i.test(l));
    const bounds = [];
    for (let i = firstOpt; i > 0 && i < lines.length; i++) {
      if (/^[A-E]$/.test(lines[i]) && (refsIdx < 0 || i < refsIdx)) bounds.push(i);
    }
    const options = bounds.map((startLine, k) => {
      const endLine = bounds[k + 1] ?? (refsIdx > 0 ? refsIdx : lines.length);
      const seg = lines.slice(startLine + 1, endLine).filter(Boolean);
      const letter = lines[startLine];
      const chosen = seg.some((l) => /\(your answer\)/i.test(l));
      const correct = seg.some((l) => /\(correct answer\)/i.test(l));
      const paras = seg.map((l) => l.replace(/\((your|correct) answer\)/gi, '').trim()).filter(Boolean);
      return {
        letter,
        text: paras[0] ?? '',
        rationale: clean(paras.slice(1).join('\n')),
        chosen,
        correct,
      };
    });

    const refs = refsIdx > 0
      ? lines.slice(refsIdx + 1).filter((l) => l && !/^Q\d{2}$/.test(l)).map((l) => l.replace(/↗$/, '').trim())
      : [];

    const chosenOpt = options.find((o) => o.chosen);
    const correctOpt = options.find((o) => o.correct);
    if (status === 'INCORRECT' && !correctOpt) warnings.push(`Q${number}: no correct answer marked`);

    return {
      number,
      questionId,
      ccarDomain,
      tags,
      scenario,
      status,
      correct: status === 'CORRECT',
      skipped: status === 'SKIPPED',
      stem,
      options,
      chosen: chosenOpt?.letter ?? null,
      answer: correctOpt?.letter ?? null,
      correctRationale: correctOpt?.rationale ?? null,
      chosenRationale: chosenOpt?.rationale ?? null,
      refs,
      raw: block,
    };
  });

  return { questions, warnings: [...new Set(warnings)] };
}

/** Parse the live question currently on screen (used for in-flight tracking). */
export function parseCurrentQuestion(text) {
  const t = clean(text);
  const m = t.match(/QUESTION\s+(\d+)\s+OF\s+(\d+)/i);
  if (!m) return null;
  const after = t.slice(t.indexOf(m[0]) + m[0].length);
  const lines = after.split('\n').map((l) => l.trim()).filter(Boolean);
  const domainLine = lines[0] && /^[A-Z][A-Z &/-]+$/.test(lines[0]) ? lines[0] : null;
  const timer = t.match(/(\d{1,2}:\d{2})/);
  const stem = lines.find((l) => l.length > 60) ?? null;
  return {
    number: Number(m[1]),
    total: Number(m[2]),
    domainLabel: domainLine,
    stem,
    timeRemaining: timer ? timer[1] : null,
  };
}

/** Full results extraction, from the raw page text of the detail view. */
export function parseResults(text) {
  const score = parseScore(text);
  const domains = parseDomainBreakdown(text);
  const { questions, warnings } = parseQuestionReview(text);
  if (score.total && questions.length && score.total !== questions.length) {
    warnings.push(`score says ${score.total} questions, parsed ${questions.length}`);
  }
  return { score, domains, questions, warnings };
}

export { LETTERS };
