import test from 'node:test';
import assert from 'node:assert/strict';
import { parseResults, parseCurrentQuestion, isResultsPage, isInExam } from './lib/extract-ccg.mjs';
import { mapCcarQuestion, BLUEPRINT, SUBSKILLS } from './lib/blueprint.mjs';

/**
 * Fixture copied from a real sitting on claudecertificationguide.com
 * (innerText of the results screen with SHOW DETAIL expanded). If the site
 * changes its layout, this test is what tells us.
 */
const FIXTURE = `RESULTS
Exam Results
406 / 1000
NOT PASSED
11 of 28 correct (39%) · Pass mark: 720
Domain Breakdown
D1
Agentic Architecture & Orchestration
4/6(67%)+180pts
D2
Tool Design & MCP Integration
1/5(20%)+36pts
D3
Claude Code Configuration & Workflows
1/6(17%)+33pts
D4
Prompt Engineering & Structured Output
2/6(33%)+67pts
D5
Context Management & Reliability
3/5(60%)+90pts

HOW SCORING WORKS

Each domain's percentage correct is multiplied by its weight and scaled to 1000 points.

HIDE DETAIL
TAKE ANOTHER EXAM
Question-by-Question Review
ALL 28
CORRECT 8
INCORRECT 20
SKIPPED 0
Q01
·
D3
3.5 ITERATIVE-REFINEMENT / TEST-DRIVEN
q-3-5-009
·
Code Generation with Claude Code
INCORRECT

A developer asks Claude Code to implement a rate limiter. Each iteration looks plausible, but edge cases keep surfacing. Which workflow change gives the iteration loop an objective target?

A

Use the interview pattern so Claude asks clarifying questions before each iteration

The interview pattern surfaces unknown requirements before implementation.(your answer)

B

Describe all the edge cases in more precise prose in a single detailed message

More precise prose still relies on the model interpreting descriptions consistently.

C

Switch to plan mode so the architecture is agreed before any implementation begins

Plan mode helps choose an approach for large or ambiguous changes.

D

Write the test suite first, then iterate by sharing the failing test output

Test-driven iteration turns vague review comments into an objective, repeatable target.(correct answer)

WHERE THIS COMES FROM

Lesson 3.5: Iterative Refinement Techniques (Technique hierarchy)
Anthropic: Claude Code Best Practices↗
Q02
·
D2
2.1 TOOL-DESIGN / MCP
q-2-1-004
·
Internal Tooling Platform
CORRECT

A team exposes 40 internal endpoints to Claude. Which tool surface reduces selection errors?

A

Expose all 40 endpoints as individual tools

Large flat tool surfaces increase selection errors.

B

Group related endpoints behind fewer, well-described tools

Consolidating reduces the decision space the model faces.(your answer)(correct answer)

C

Expose a single passthrough tool that accepts a raw URL

This removes the schema that helps the model call correctly.

WHERE THIS COMES FROM

Lesson 2.1: Tool Design Principles
Q03
·
D5
5.1 CONTEXT-WINDOW-MANAGEMENT / PROGRESSIVE-SUMMARISATION
q-5-1-009
SKIPPED

A docs team processes a large codebase, summarising each module and discarding source. Docs for module 21 reference stale class names. What caused this?

A

The agent's context window overflowed

The team explicitly manages context by summarising.

B

Progressive summarisation lost the rename detail

Progressive summarisation is lossy.(correct answer)

WHERE THIS COMES FROM

Lesson 5.1: Context Window Management (Progressive summarisation)
`;

test('detects page type', () => {
  assert.equal(isResultsPage(FIXTURE), true);
  assert.equal(isInExam(FIXTURE), false);
  assert.equal(isInExam('QUESTION 03 OF 28\nCONTEXT MANAGEMENT & RELIABILITY'), true);
});

test('parses the score header', () => {
  const { score } = parseResults(FIXTURE);
  assert.equal(score.scaled, 406);
  assert.equal(score.passed, false);
  assert.equal(score.correct, 11);
  assert.equal(score.total, 28);
  assert.equal(score.percent, 39);
  assert.equal(score.passMark, 720);
});

test('parses the domain breakdown', () => {
  const { domains } = parseResults(FIXTURE);
  assert.equal(domains.length, 5);
  assert.deepEqual(domains[1], {
    id: 'D2', name: 'Tool Design & MCP Integration',
    correct: 1, total: 5, percent: 20, points: 36,
  });
});

test('parses each reviewed question', () => {
  const { questions } = parseResults(FIXTURE);
  assert.equal(questions.length, 3);

  const [q1, q2, q3] = questions;

  assert.equal(q1.number, 1);
  assert.equal(q1.questionId, 'q-3-5-009');
  assert.equal(q1.ccarDomain, 'D3');
  assert.equal(q1.tags, '3.5 ITERATIVE-REFINEMENT / TEST-DRIVEN');
  assert.equal(q1.scenario, 'Code Generation with Claude Code');
  assert.equal(q1.correct, false);
  assert.equal(q1.chosen, 'A');
  assert.equal(q1.answer, 'D');
  assert.equal(q1.options.length, 4);
  assert.match(q1.stem, /^A developer asks Claude Code/);
  assert.match(q1.options[0].rationale, /surfaces unknown requirements/);
  assert.ok(!/\(your answer\)/.test(q1.options[0].rationale), 'markers stripped from rationale');
  assert.deepEqual(q1.refs, [
    'Lesson 3.5: Iterative Refinement Techniques (Technique hierarchy)',
    'Anthropic: Claude Code Best Practices',
  ]);

  // Correct answer: the same option is both chosen and correct.
  assert.equal(q2.correct, true);
  assert.equal(q2.chosen, 'B');
  assert.equal(q2.answer, 'B');
  assert.equal(q2.options.length, 3, 'handles three-option items');
  assert.equal(q2.scenario, 'Internal Tooling Platform');

  // Skipped: correct answer known, nothing chosen.
  assert.equal(q3.skipped, true);
  assert.equal(q3.chosen, null);
  assert.equal(q3.answer, 'B');
  assert.equal(q3.scenario, null, 'no scenario line present');
});

test('reports a mismatch between the tally and the parsed questions', () => {
  const { warnings } = parseResults(FIXTURE);
  assert.ok(warnings.some((w) => /score says 28 questions, parsed 3/.test(w)), warnings.join('; '));
});

test('parses the in-flight question header', () => {
  const q = parseCurrentQuestion(
    'TIME REMAINING:\n55:56\nQUESTION 01 OF 28\nCONTEXT MANAGEMENT & RELIABILITY\nFLAG\n' +
    'A contract extraction system reports 96% overall accuracy and the team plans to auto-approve.',
  );
  assert.equal(q.number, 1);
  assert.equal(q.total, 28);
  assert.equal(q.domainLabel, 'CONTEXT MANAGEMENT & RELIABILITY');
  assert.equal(q.timeRemaining, '55:56');
  assert.match(q.stem, /contract extraction/);
});

test('maps CCAR-F questions onto CCDV-F sub-skills', () => {
  const tool = mapCcarQuestion({ ccarDomain: 'D2', tags: '2.1 TOOL-DESIGN / MCP', stem: 'MCP server' });
  assert.equal(tool.subskillId, '8.2');
  assert.equal(tool.confidence, 'high');

  // Keyword lands outside the mapped domain -> flagged as low confidence.
  const odd = mapCcarQuestion({ ccarDomain: 'D2', tags: '', stem: 'api key rotation and secrets' });
  assert.equal(odd.subskillId, '7.4');
  assert.equal(odd.confidence, 'low');

  // No keyword at all -> falls back to the domain's first candidate.
  const bare = mapCcarQuestion({ ccarDomain: 'D1', tags: '', stem: 'zzz nothing matches here' });
  assert.equal(bare.confidence, 'domain-only');
  assert.equal(bare.subskillId, '1.1');
});

test('blueprint weights are internally consistent', () => {
  const total = BLUEPRINT.reduce((s, d) => s + d.weight, 0);
  assert.ok(Math.abs(total - 100) < 0.05, `domain weights sum to ${total}`);
  for (const d of BLUEPRINT) {
    const sub = d.subskills.reduce((s, x) => s + x.weight, 0);
    assert.ok(Math.abs(sub - d.weight) < 0.35, `${d.id} sub-skills sum to ${sub}, domain says ${d.weight}`);
  }
  assert.equal(SUBSKILLS.length, 25, 'blueprint has 25 sub-skills');
});

// ── external bank import ────────────────────────────────────────────────────

test('maps external questions inside their stated domain', async () => {
  const { mapExternalQuestion, classifyRanked } = await import('./lib/blueprint.mjs');

  // A D2 question about batching: the cost rule (5.4) ranks first globally, but
  // 5.4 is in D5, so the in-domain winner must be a D2 sub-skill.
  const ranked = classifyRanked('nightly batch job, cost is tight, message batches api');
  assert.equal(ranked[0], '5.4', 'cost rule still ranks first globally');
  const batch = mapExternalQuestion({
    domainName: 'Applications and Integration',
    text: 'nightly batch job, cost is tight, message batches api custom_id',
  });
  assert.equal(batch.domainId, 'D2');
  assert.equal(batch.subskillId, '2.3', 'lands on API mechanics, not cost');
  assert.equal(batch.confidence, 'high');

  // US spelling of the domain name resolves.
  assert.equal(
    mapExternalQuestion({ domainName: 'Model Selection and Optimization', text: 'which model' }).domainId,
    'D5',
  );

  // Nothing matches inside the domain -> heaviest sub-skill, flagged.
  const bare = mapExternalQuestion({ domainName: 'Security and Safety', text: 'zzz unmatched text' });
  assert.equal(bare.subskillId, '7.1', 'falls back to the domain-heaviest');
  assert.equal(bare.confidence, 'domain-only');

  // Unknown domain name falls back to a loose global classification.
  const loose = mapExternalQuestion({ domainName: 'Not A Real Domain', text: 'prompt injection in retrieved text' });
  assert.equal(loose.subskillId, '7.1');
  assert.equal(loose.confidence, 'low');
});

test('imported exams are well-formed and runnable', async () => {
  const { readdir, readFile } = await import('node:fs/promises');
  const { subskill } = await import('./lib/blueprint.mjs');
  const { paths } = await import('./lib/store.mjs');

  const files = (await readdir(paths.exams)).filter((f) => f.startsWith('ext-') && f.endsWith('.json'));
  assert.ok(files.length >= 4, `expected imported exams, found ${files.length}`);

  let total = 0;
  for (const f of files) {
    const exam = JSON.parse(await readFile(`${paths.exams}/${f}`, 'utf8'));
    assert.ok(exam.attribution?.license === 'MIT', `${f} records its licence`);
    assert.ok(exam.questions.length > 0, `${f} has questions`);
    for (const q of exam.questions) {
      total++;
      assert.ok(subskill(q.subskill), `${q.id}: "${q.subskill}" is a real sub-skill`);
      assert.ok(q.stem?.length > 10, `${q.id}: has a stem`);
      const right = q.options.filter((o) => o.correct);
      assert.equal(right.length, q.selectCount, `${q.id}: selectCount matches correct options`);
      assert.ok(right.every((o) => o.rationale), `${q.id}: correct option carries a rationale`);
      assert.ok(q.options.every((o) => /^[A-E]$/.test(o.letter)), `${q.id}: option letters valid`);
      assert.ok(q.refs?.some((r) => /MIT/.test(r)), `${q.id}: carries attribution`);
    }
  }
  assert.equal(total, 80, 'all 80 developer-foundations questions imported');
});

// ── certsafari: the answer given must be recorded ───────────────────────────

/**
 * Built from the real markup captured on 2026-09-19: each choice is a <label>
 * wrapping a <button role="radio"> that carries the state and the full option
 * text in its `value`, with the visible text in a sibling div. An earlier
 * filter matched neither element and silently recorded no selection.
 */
const CS_SNAP = {
  at: '2026-09-19T23:43:37.000Z',
  text: [
    'Exit Quiz', 'Toggle theme',
    'Anthropic Claude Certified Developer – Foundations (CCDV-F)',
    '100m', 'Question 28 of 50', 'Mark',
    'Subdomain 5.3: Model Selection and Tradeoffs',
    'After migrating from Opus 4.6 to Opus 4.8, an application starts hitting stop_reason: "max_tokens" more often.',
    'A) Opus 4.8 requires a beta header to unlock the full 128k output limit',
    'B) Opus 4.8 has a smaller output token ceiling than Opus 4.6',
    'C) Opus 4.8 uses a new tokenizer that produces roughly 30% more tokens',
    'D) Opus 4.8 charges for thinking tokens twice',
    'Report', 'Note', 'Continue',
  ].join('\n'),
  buttons: [{ text: 'Continue' }, { text: 'Mark' }],
  options: [
    { text: 'A) Opus 4.8 requires a beta header to unlock the full 128k output limit', role: 'radio', ariaChecked: 'false', dataState: 'unchecked', checked: null, cls: '' },
    { text: 'B) Opus 4.8 has a smaller output token ceiling than Opus 4.6', role: 'radio', ariaChecked: 'true', dataState: 'checked', checked: null, cls: '' },
    { text: 'C) Opus 4.8 uses a new tokenizer that produces roughly 30% more tokens', role: 'radio', ariaChecked: 'false', dataState: 'unchecked', checked: null, cls: '' },
    { text: 'D) Opus 4.8 charges for thinking tokens twice', role: 'radio', ariaChecked: 'false', dataState: 'unchecked', checked: null, cls: '' },
  ],
};

test('certsafari: records the answer given, with the real option letters', async () => {
  const cs = await import('./lib/extract-certsafari.mjs');
  const q = cs.parseSnapshot(CS_SNAP);

  assert.equal(q.number, 28);
  assert.equal(q.total, 50);
  assert.equal(q.subskillId, '5.3', 'exact sub-skill comes from their own label');
  assert.equal(q.options.length, 4);
  assert.deepEqual(q.options.map((o) => o.letter), ['A', 'B', 'C', 'D']);
  assert.match(q.stem, /^After migrating from Opus 4\.6/);
  assert.ok(q.sawControls, 'radio controls were seen');
  assert.equal(q.chosen, 'B', 'the selected option is recorded');
  assert.equal(q.options.find((o) => o.letter === 'B').chosen, true);
  assert.equal(q.options.find((o) => o.letter === 'C').chosen, false);
});

test('certsafari: a selection beside a disabled Continue is the previous question\'s', async () => {
  // 2026-09-26: the first snapshot of Q17 still showed Q16's B checked with
  // Continue disabled, and B was recorded as the answer to Q17.
  const cs = await import('./lib/extract-certsafari.mjs');
  const q = cs.parseSnapshot({ ...CS_SNAP, buttons: [{ text: 'Continue', disabled: true }, { text: 'Mark' }] });
  assert.equal(q.chosen, null, 'leftover selection is not recorded');
  assert.equal(q.staleSelection, true);
  assert.equal(cs.parseSnapshot(CS_SNAP).chosen, 'B', 'an enabled Continue still records it');
});

test('certsafari: the pre-submit screen yields no question capture', async () => {
  const cs = await import('./lib/extract-certsafari.mjs');
  const text = CS_SNAP.text.replace('Mark', 'Mark\nReview before you submit\nOpen any question to review your answers. Submit when you are ready');
  assert.equal(cs.parseSnapshot({ ...CS_SNAP, text }), null);
});

test('certsafari: no controls captured means no invented answer', async () => {
  const cs = await import('./lib/extract-certsafari.mjs');
  const q = cs.parseSnapshot({ ...CS_SNAP, options: [] });
  assert.equal(q.chosen, null, 'chosen stays null rather than guessing');
  assert.equal(q.sawControls, false);
  assert.equal(q.options.length, 4, 'options still parsed from the text');
});

test('certsafari: the overview page is not mistaken for a quiz', async () => {
  const cs = await import('./lib/extract-certsafari.mjs');
  assert.equal(cs.parseSnapshot({ text: 'Exam Topics & Skills Assessed\nSubdomain 1.1: Agent Architecture', options: [] }), null);
});

test('certsafari: multiple-response answers are recorded', async () => {
  const cs = await import('./lib/extract-certsafari.mjs');
  // Checkbox options carry value="on" rather than the option text, so the
  // letter has to come from the positional id. Real shape from 2026-09-20.
  const snap = {
    text: [
      'Question 47 of 53', 'Subdomain 7.1: AI Application Security',
      'Which of these statements about that evaluation order are accurate? (Select all that apply.)',
      'Incorrect',
      'A) In dontAsk mode, a request that reaches canUseTool is approved', 'Explanation', 'Incorrect: it is denied.',
      'B) The canUseTool callback is the final step', 'Explanation', 'Correct: it is the final fallback.',
      'C) Deny rules are checked before the permission mode', 'Explanation', 'Correct: deny precedes the mode.',
      'D) Allow rules are checked before the permission mode', 'Explanation', 'Incorrect: they come after.',
      'E) Hooks run first and can deny under bypassPermissions', 'Explanation', 'Correct: hooks run first.',
      'Close',
    ].join('\n'),
    options: [
      { id: 'option-0', role: 'checkbox', text: 'on', ariaChecked: 'false', dataState: 'unchecked' },
      { id: 'option-1', role: 'checkbox', text: 'on', ariaChecked: 'true', dataState: 'checked' },
      { id: 'option-2', role: 'checkbox', text: 'on', ariaChecked: 'true', dataState: 'checked' },
      { id: 'option-3', role: 'checkbox', text: 'on', ariaChecked: 'true', dataState: 'checked' },
      { id: 'option-4', role: 'checkbox', text: 'on', ariaChecked: 'false', dataState: 'unchecked' },
    ],
  };

  const r = cs.parseReviewPanel(snap);
  assert.equal(r.chosen, 'BCD', 'checkbox selections map to letters by positional id');
  assert.equal(r.answer, 'BCE', 'verdict words identify the correct set');
  assert.equal(r.selectCount, 3);
  assert.equal(r.subskillId, '7.1');

  // The colon form of the verdict must parse as well as the period form.
  assert.equal(cs.parseReviewPanel({
    text: 'Question 1 of 2\nSubdomain 4.1: Debugging\nPick one\nA) first\nExplanation\nCorrect: because.\nB) second\nExplanation\nIncorrect: no.\nClose',
    options: [],
  }).answer, 'A');

  // Positional fallback helper.
  assert.equal(cs.letterOfControl({ text: 'C) something' }), 'C');
  assert.equal(cs.letterOfControl({ text: 'on', id: 'option-3' }), 'D');
  assert.equal(cs.letterOfControl({ text: 'on' }, 4), 'E');
  assert.equal(cs.letterOfControl({ text: 'on' }), null, 'no guessing without a position');
});

/**
 * The pre-submit review screen must never end a sitting.
 *
 * On 2026-09-23 it did: `isFinished` matched "review your answers" in
 * "Open any question to review your answers", so the observer wrapped up while
 * the quiz was still open, saved a 53-question attempt with zero correctness,
 * and pushed that into HISTORY.md. Both strings below are verbatim from
 * data/raw/ — the pre-submit screen and a real results screen.
 */
test('certsafari: the pre-submit review screen is not the end of the sitting', async () => {
  const cs = await import('./lib/extract-certsafari.mjs');

  const preSubmit = [
    'Back', 'Toggle theme', 'Review before you submit',
    'Open any question to review your answers. Submit when you are ready — then you will see your score and explanations.',
    '1', '2', '3', 'Submit quiz',
  ].join('\n');
  assert.equal(cs.isFinished(preSubmit), false, 'still open: Submit quiz is on screen');

  const inQuizReview = [
    'Question 32 of 53', 'Your selections — scoring stays hidden until you submit the quiz.',
    'Subdomain 1.3: Agent Patterns and Frameworks', 'A) one', 'B) two', 'Close',
  ].join('\n');
  assert.equal(cs.isFinished(inQuizReview), false, 'reviewing one answer mid-quiz is not finishing');

  const results = [
    'Back to Certificate', 'Toggle theme', '75%', 'Quiz Complete',
    'You answered 40 out of 53 questions correctly',
    'Question overview', 'Green is correct, red is incorrect. Tap a number to review explanations.',
  ].join('\n');
  assert.equal(cs.isFinished(results), true, 'the scored screen is the end');
  assert.deepEqual(cs.parseScore(results), { correct: 40, total: 53, percent: 75 });
});

/**
 * The results grid's verdict pills, and the decoy that broke them.
 *
 * Verbatim fills from data/raw/ on 2026-09-23: the scored screen uses opaque
 * emerald/destructive pills, while the pre-submit screen tints every answered
 * question `rgba(20, 189, 169, 0.15)`. That teal passes a naive "green means
 * correct" test, which scored a 43/53 sitting as 53/53.
 */
test('certsafari: only the scored grid yields verdicts', async () => {
  const cs = await import('./lib/extract-certsafari.mjs');

  const scored = cs.parseGrid([
    { n: 1, bg: 'rgb(5, 150, 105)', cls: 'h-11 w-11 rounded-full bg-emerald-600 text-white' },
    { n: 2, bg: 'rgb(5, 150, 105)', cls: 'h-11 w-11 rounded-full bg-emerald-600 text-white' },
    { n: 3, bg: 'rgb(239, 67, 67)', cls: 'h-11 w-11 rounded-full bg-destructive text-destructive-foreground' },
    // The "43" and "53" of "You answered 43 out of 53" are also numbered nodes.
    { n: 43, bg: 'rgba(0, 0, 0, 0)', cls: 'font-semibold text-foreground' },
  ]);
  assert.deepEqual([...scored.entries()], [[1, true], [2, true], [3, false]]);

  const preSubmit = cs.parseGrid([
    { n: 1, bg: 'rgba(20, 189, 169, 0.15)', cls: 'h-11 w-11 rounded-full border' },
    { n: 2, bg: 'rgba(20, 189, 169, 0.15)', cls: 'h-11 w-11 rounded-full border' },
  ]);
  assert.equal(preSubmit.size, 0, 'an "answered" tint is not a verdict');
});

/**
 * Six-option items must not lose their sixth option.
 *
 * CertSafari's select-3 questions run A) to F), but every option-letter regex
 * here was `[A-E]`. F) therefore never started a new option: its text was
 * appended to E), and an F selection was dropped. On 2026-09-23 that recorded
 * Q43 as "BC" when the answer given was "BCF".
 */
test('certsafari: a sixth option is parsed and can be selected', async () => {
  const cs = await import('./lib/extract-certsafari.mjs');

  const snap = {
    text: [
      'Question 43 of 53', 'Subdomain 8.2: MCP Server Development',
      'Which three capability categories does the MCP specification define for servers? (Select all that apply.)',
      'Select 3 answers',
      'A) Middleware', 'B) Webhooks', 'C) Endpoints', 'D) Tools', 'E) Prompts', 'F) Resources',
      'Close',
    ].join('\n'),
    options: [
      { id: 'option-0', role: 'checkbox', text: 'on', ariaChecked: 'false', dataState: 'unchecked' },
      { id: 'option-1', role: 'checkbox', text: 'on', ariaChecked: 'true', dataState: 'checked' },
      { id: 'option-2', role: 'checkbox', text: 'on', ariaChecked: 'true', dataState: 'checked' },
      { id: 'option-3', role: 'checkbox', text: 'on', ariaChecked: 'false', dataState: 'unchecked' },
      { id: 'option-4', role: 'checkbox', text: 'on', ariaChecked: 'false', dataState: 'unchecked' },
      { id: 'option-5', role: 'checkbox', text: 'on', ariaChecked: 'true', dataState: 'checked' },
    ],
  };

  const q = cs.parseSnapshot(snap);
  assert.equal(q.options.length, 6, 'all six options parsed');
  assert.deepEqual(q.options.map((o) => o.letter), ['A', 'B', 'C', 'D', 'E', 'F']);
  assert.equal(q.options.find((o) => o.letter === 'E').text, 'Prompts', 'E does not swallow F');
  assert.equal(q.options.find((o) => o.letter === 'F').text, 'Resources');
  assert.equal(q.chosen, 'BCF', 'a selected sixth option is recorded');
});

/**
 * Verdict openers vary across the bank.
 *
 * Real captures from 2026-09-23 use "Correct." and "Correct:" but also
 * "Correct — " / "Wrong — " with an em dash. Accepting only [.:] left four
 * harvested panels reporting 0-1 explained options and no correct answer.
 * Items with no verdict word must stay unknown rather than being guessed.
 */
test('certsafari: verdict openers — period, colon, em dash, and "Wrong"', async () => {
  const cs = await import('./lib/extract-certsafari.mjs');
  const panel = (body) => cs.parseReviewPanel({
    text: [
      'Question 32 of 53', 'Subdomain 1.3: Agent Patterns and Frameworks', 'Pick one',
      'A) first option', 'Explanation', body.a,
      'B) second option', 'Explanation', body.b,
      'Close',
    ].join('\n'),
    options: [],
  });

  const dash = panel({ a: 'Wrong — the memory tool is not a replacement.', b: 'Correct — compaction is recommended.' });
  assert.equal(dash.answer, 'B', 'em-dash verdicts are read');
  assert.equal(dash.verdictsKnown, 2);
  assert.equal(dash.options[0].explanation, 'the memory tool is not a replacement.', 'the verdict word is stripped');

  const period = panel({ a: 'Correct. because reasons.', b: 'Incorrect. no.' });
  assert.equal(period.answer, 'A');

  const colon = panel({ a: 'Incorrect: nope.', b: 'Correct: yes.' });
  assert.equal(colon.answer, 'B');

  // No verdict word anywhere: report unknown, never infer from the prose.
  const bare = panel({
    a: 'The text editor tool creates and edits text files.',
    b: 'The computer use tool controls interfaces by taking screenshots, directly matching the requirement.',
  });
  assert.equal(bare.answer, null, 'no verdict word means no answer is claimed');
  assert.equal(bare.verdictsKnown, 0);
  assert.equal(bare.partial, true);
});
