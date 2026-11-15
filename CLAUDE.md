# CCDV-F study harness

This repo is a study harness for people preparing for Anthropic's Foundations
certifications. "The user" below means whoever is studying with it.

**CCDV-F — Claude Certified Developer (Foundations)** (Anthropic Exam Guide v1.0,
July 2026): 53 items, 120 minutes, scaled 100–1000, pass at 720, multiple-choice
*and multiple-response*.

This repo exists to answer one question after every practice sitting: **what
should be studied next, and why.** It records every question and answer, projects
performance onto the official 25-sub-skill blueprint, writes a report, and holds
the study notes that follow from it.

## The two practice surfaces

| Surface | What it is | Status |
|---|---|---|
| `claudecertificationguide.com/mock-exam` | Live mock — but it is the **Architect (CCAR-F)** exam, five different domains | Free, no login, no bot gate. Results are mapped onto the CCDV-F blueprint and every mapped sub-skill is flagged in the report. |
| `mocks/exams/ccdv-f-*.json` | **CCDV-F mocks we author**, served in a clone of the live exam UI | The primary CCDV-F surface. `claudecertificationguide.com/ccdv-f` is the official blueprint but its prep track is "coming soon" — there is no CCDV-F question bank to scrape. |
| `mocks/exams/ext-*.json` | **80 imported CCDV-F questions** from [Amey Thakur's CLAUDE-CERTIFICATIONS](https://github.com/Amey-Thakur/CLAUDE-CERTIFICATIONS) (MIT), in four sets | Audited before import; no stale API facts. All single-answer, four-option. See `mocks/exams/ATTRIBUTION.md`. |

Our own exams are the only surface that exercises **multiple-response** items —
the imported bank has none and the Architect mock has none — so keep writing
them into `mocks/exams/`.

Re-import or import another track with:

```bash
node tools/import-bank.mjs <path>/question-bank.json --exam developer-foundations
```

If the upstream bank is ever updated, **re-run the accuracy audit** before
trusting it (`ATTRIBUTION.md` records what was checked and why).

## Two exams are tracked

The harness supports both **CCDV-F** (above) and **CCAR-F — Claude Certified Architect
(Foundations)**: 5 domains, 30 task statements (blueprint in `tools/lib/blueprint.mjs`,
`ARCH_BLUEPRINT`). The user may be studying either or both; ask which if it isn't clear.
CertSafari is the central surface for both.

- Sub-skill ids are **scoped by exam** (both have a `1.1`). An attempt counts toward its
  `targetExam`; a legacy *mapped* Architect mock therefore still feeds CCDV-F.
- CCAR-F sitting: `npm run session:architect` (= `session-certsafari.mjs --exam CCAR-F`).
- CCAR-F outputs sit beside the CCDV-F ones: `HISTORY-CCAR-F.md`, `STUDY-PLAN-CCAR-F.md`,
  `data/history-ccar-f.json`. Notes go in `study/ccar-f/<id>-<slug>.md`; start from
  `study/ccar-f/00-blueprint-and-carryover.md`. Reviews: `reviews/<date>-certsafari-ccar-f.md`.
- Anthropic publishes **no per-task weights** for CCAR-F; the harness splits each domain's
  weight evenly, so within a domain rank by miss rate rather than `impact`.
- `npm run stats -- --exam CCAR-F` for the terminal dashboard.
- The review format and the "build from `data/attempts/` first" rule below apply unchanged.

## When the user says "start a session"

1. Ask which surface, unless they said: local drill (`--mock <id>`) or live mock.
2. Run it and leave it alone:
   ```bash
   npm run session                      # live CCAR-F mock
   npm run session -- --mock ccdv-f-drill-01
   ```
3. **Never answer questions on their behalf.** The browser is theirs; the tooling
   only reads the DOM. Auto-answering would poison the only data this repo has.
4. **Hand over on any gate.** Cloudflare Turnstile, an interstitial, or a login
   wall pauses the run and prints a banner — the user solves it in the window and
   the session resumes. Do not try to click through a bot check.
5. The session ends by itself: it captures the results screen (expanding
   `SHOW DETAIL`), saves the attempt, and writes the report.

## The record

Every sitting is kept, at four levels of detail. All of it is derived from
`data/attempts/` except the attempts themselves, so any of it can be rebuilt
with `npm run report -- --all` and `npm run history`.

| File | |
|---|---|
| `data/attempts/<ts>.json` | **source of truth** — every question, option, rationale, choice, timing |
| `data/raw/<ts>.txt` / `.png` | the results screen exactly as displayed, text and full-page screenshot |
| `reports/<ts>.md` | that one sitting in full: score, misses with both rationales, gaps |
| `HISTORY.md` | the ledger — one row per sitting, sub-skill trends, domain rollup |
| `STUDY-PLAN.md` | what to do next: ranked gaps, blind spots, next drill's shape |
| `data/history.json` | machine-readable time series, for reading in-session |

`HISTORY.md` and `STUDY-PLAN.md` are regenerated after every sitting — never edit
them by hand, the next sitting will overwrite it. Read `STUDY-PLAN.md` first when
the user asks what to study; read `HISTORY.md` when the question is about
movement over time.

## Review format — required, every time

Each sitting gets `reviews/<date>-<source>.md`. This shape is a deliberate
requirement of the project, so don't improvise a different one:

- **`✅` / `❌` in every question heading**, and an at-a-glance grid of all
  questions near the top, so misses are scannable without reading the file.
- **Per missed question, in this order:**
  1. the **question** — full stem, quoted, plus every option verbatim, with the
     correct one(s) marked `✅`
  2. **the answer they gave**
  3. **the correct answer**
  4. an **explanation** — why the right answer is right, *and* the specific
     misconception in the tempting distractor
  5. **reference material** when available: prefer official docs
     (`code.claude.com/docs`, `docs.claude.com`), Anthropic engineering posts,
     the MCP spec
- Never invent the answer they gave. If it wasn't captured, say so and say why.
- Quote the docs verbatim for anything version-sensitive, and **verify before
  writing** — see the warning below.

**Build the question blocks from `data/attempts/` first, then write the prose
against those blocks.** Never write an explanation from an earlier listing or
from memory of the sitting. This has already gone wrong once: recovery
re-numbered several questions after a staleness fix, and two write-ups ended up
explaining the *neighbouring* question — including one the user had actually
answered correctly. Before publishing a review, cross-check each section against
the attempt:

```bash
node -e "
const fs=require('fs');
const md=fs.readFileSync('reviews/<file>.md','utf8');
const f=fs.readdirSync('data/attempts').find(x=>x.includes('<source>'));
const a=JSON.parse(fs.readFileSync('data/attempts/'+f));
for(const s of md.split(/^(?=## ❌ Q)/m).slice(1)){
  const n=Number(s.match(/^## ❌ Q(\d+)/)[1]);
  const item=a.questions.find(x=>x.number===n);
  const quoted=s.match(/^> (.+)$/m)[1];
  if(!item.stem.startsWith(quoted.slice(0,60))) console.log('MISMATCH Q'+n);
}"
```

## After every session — the part that matters

1. Read the new file in `reports/`, then `STUDY-PLAN.md`. Work the ranked table,
   which is ordered by `impact` = exam weight × miss rate, not by raw miss count.
   A miss in 2.5 Claude Application Design (8.6% of the exam) outranks three
   misses in 7.3 Claude Hooks (1.0%).
   - Treat the plan's **Not improving** section as the real signal: a gap that is
     flat or falling across sittings means the notes did not land, so change
     approach rather than re-explaining.
   - Check `Sittings` before trusting a trend — one question per sitting swings
     the full ±100pp.
2. For each weak sub-skill, write or extend `study/<subskill-id>-<slug>.md`:
   - what the question actually tested, and the specific misconception behind the
     wrong answer that was chosen — not a generic summary of the topic;
   - the correct rule, stated so it transfers to a differently-worded item;
   - references, real and checked. Prefer `docs.claude.com`, Anthropic
     engineering posts, and the MCP spec.
   - **Load the `claude-api` skill before writing anything that touches API
     mechanics, models, pricing, caching, tool use, or agents.** Several of these
     shapes changed in 2025–2026; a stale prior will teach the wrong answer.
3. Append to the same file on later sittings rather than starting a new one, so
   repeat misses are visible as repeats.
4. Offer a fresh local drill targeting the top gaps (see below).

## Writing a new local mock

One JSON file per exam in `mocks/exams/<id>.json`; `mocks/exams/ccdv-f-drill-01.json`
is the reference. Rules that keep the data honest:

- `subskill` must be a real blueprint id from `tools/lib/blueprint.mjs` — it is
  what the whole reporting chain keys on.
- **Every** option needs a `rationale`, including the correct one. The rationale
  is the study material; a question without it teaches nothing on review.
- Weight question counts toward the blueprint. D2 is 33.1% of the exam and D3 is
  3.1% — drills should reflect that, not spread evenly.
- Set `selectCount: 2` for multiple-response items and include some; the real
  exam states how many responses to select.
- Distractors must be plausible and specific. The best ones encode a real
  misconception (a deprecated parameter, a misplaced field, an off-by-one in an
  API contract), so a miss is diagnostic.
- Verify facts against the `claude-api` skill before writing, then run
  `npm run serve` and read the exam once yourself.

## Commands

```bash
npm run session     # start a sitting (see flags above)
npm run serve       # serve local mocks without capture (authoring/preview)
npm run stats       # readiness dashboard: per-sub-skill accuracy + projection
npm run report      # rebuild the report for the last attempt (--all for every one)
npm run history     # rebuild HISTORY.md, STUDY-PLAN.md and data/history.json
npm test            # parser, blueprint, mapping and imported-exam integrity tests
node tools/import-bank.mjs <bank.json> [--exam <id>] [--dry]
```

Available sittings: `ccdv-f-drill-01` (10, ours, has multiple-response),
`ext-developer-practice` (35), `ext-developer-mock-1/2/3` (15 each).

## Layout

```
tools/session.mjs        observe a sitting, capture, save, report
tools/serve.mjs          local mock server; receives attempts over HTTP
tools/report.mjs         attempt -> markdown report; refreshes the derived files
tools/history.mjs        cumulative ledger + study plan across all sittings
tools/lib/history.mjs    time series, trends, staleness, next-drill composition
tools/stats.mjs          terminal readiness dashboard
tools/lib/blueprint.mjs  official CCDV-F blueprint + CCAR-F mapping + classifier
tools/lib/extract-ccg.mjs  text parsers for the live site
tools/import-bank.mjs    import an external question bank into runnable mocks
tools/lib/browser.mjs    persistent headed browser + gate handover
mocks/engine/index.html  exam UI clone (timer, navigator, flagging, review)
mocks/exams/*.json       our CCDV-F question sets
data/attempts/*.json     one file per sitting, the source of truth
data/raw/                results screen as displayed: text + screenshot
data/history.json        time series across sittings
reports/*.md             one report per sitting
HISTORY.md               the ledger across all sittings (generated)
STUDY-PLAN.md            ranked gaps and next drill (generated)
study/*.md               notes per weak sub-skill, written by Claude
```

## Conventions

- `data/attempts/*.json` is the source of truth. Reports and `performance.json`
  are derived and safe to regenerate; never hand-edit an attempt.
- The live site is Tailwind-only — no stable selectors, no readable payload — so
  `extract-ccg.mjs` parses visible text against content anchors
  (`QUESTION 01 OF 28`, `(correct answer)`, `WHERE THIS COMES FROM`). Restyling
  will not break it; changing that wording will. `tools/extract.test.mjs` holds a
  real captured fixture and is what catches it.
- Every live sitting also saves raw text and a screenshot under `data/raw/`, so a
  parser bug never costs a sitting — re-run `npm run report` after fixing.
- Parsers must stay total: report unknowns via `warnings`, never throw. A crash
  after a 56-minute exam loses real work.
- `.exam-profile/` holds the browser profile (logins, bot-check cookies) and is
  gitignored. Do not delete it casually — it is why gates stay solved.
