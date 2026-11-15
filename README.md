# claude-dev-certificate

Practice harness and performance tracker for Anthropic's Foundations
certifications:

- **CCDV-F** — Claude Certified Developer (Foundations): 53 items, 120 min,
  pass at 720/1000, multiple-choice *and* multiple-response.
- **CCAR-F** — Claude Certified Architect (Foundations): 5 domains, 30 task
  statements.

You sit mock exams; this records every question, answer and rationale, projects
your results onto the official blueprint, and tells you what to study next in
order of what it costs you on the real exam.

## Using it with Claude Code

This repo is built to be driven from Claude Code. [CLAUDE.md](CLAUDE.md) is
loaded automatically and teaches Claude the workflow, so you talk to it in plain
language rather than remembering commands. Run `claude` in this directory and say:

| You say | What Claude does |
|---|---|
| **"start a session"** | Asks which surface (local drill, CertSafari, or live mock), then launches it and leaves it alone |
| **"start a CCAR-F session"** | Runs `npm run session:architect` |
| **"what should I study next?"** | Reads `STUDY-PLAN.md` (or the `-CCAR-F` one) and works the ranked table |
| **"how am I trending?"** | Reads `HISTORY.md` for movement across sittings |
| **"review my last sitting"** | Writes `reviews/<date>-<source>.md` in the required format (see below) |
| **"write notes on my weak spots"** | Writes or extends `study/<id>-<slug>.md` per weak sub-skill |
| **"make me a drill on my top gaps"** | Authors a new `mocks/exams/ccdv-f-*.json`, including multiple-response items |

Things Claude will always do, so you don't need to ask:

- **Never answer for you.** The browser is yours; the tooling only reads the page.
- **Hand over on any gate** (Cloudflare, login wall) and resume when you've solved it.
- **Review in a fixed shape:** ✅/❌ in every heading, an at-a-glance grid, and per
  miss the full question, the answer you gave, the correct answer, an
  explanation including the misconception behind your pick, and doc references.
- **Build reviews from `data/attempts/`**, not from memory of the sitting.
- **Check the `claude-api` skill** before writing notes that touch API mechanics.

## Prerequisites

| Need | Why |
|---|---|
| **Node.js 20.11 or newer** (includes npm) | Runs all the tooling. Install from [nodejs.org](https://nodejs.org) or a version manager such as `nvm`/`fnm`; check with `node -v`. |
| **Playwright's Chromium** | Serves and observes local mocks and the live mock. Installed by the command below. |
| **Google Chrome** | Required for CertSafari sittings (`session:certsafari`, `session:architect`). The tool attaches to your own Chrome so Cloudflare sees an ordinary browser. **macOS only for now:** the path `/Applications/Google Chrome.app/...` is hard-coded in `tools/session-certsafari.mjs`. Local mocks and the live mock don't need it. |
| **[Claude Code](https://code.claude.com/docs)** | Optional, but it drives the prompt workflow above. The repo works without it via the npm scripts. |

No API key or other language runtime is needed; everything is Node.

## Quick start (without Claude)

```bash
npm install
npx playwright install chromium   # once

npm run session -- --mock ext-developer-mock-1   # 15-question CCDV-F mock
npm run session -- --mock ccdv-f-drill-01        # our drill (has multiple-response)
npm run session                                  # live mock on claudecertificationguide.com
npm run session:certsafari                       # CertSafari, CCDV-F (default)
npm run session:architect                        # CertSafari, CCAR-F
npm run stats                                    # readiness dashboard
npm run stats -- --exam CCAR-F
```

A browser window opens and **you** take the exam. The tool watches the page — it
never answers for you. CertSafari sittings attach to your own Google Chrome so
Cloudflare sees an ordinary browser; if a gate appears the run pauses until you
clear it.

If a session ends badly, nothing is lost: raw snapshots are saved first.

```bash
node tools/session-certsafari.mjs --reparse data/raw/<ts>-certsafari.jsonl
node tools/recover-certsafari.mjs data/raw/<ts>-certsafari.jsonl [--missed 1,2,4]
node tools/harvest-certsafari.mjs --want 4,6,12 --into data/attempts/<file>.json
```

### Practice surfaces

| Surface | Notes |
|---|---|
| `mocks/exams/ccdv-f-*.json` | Ours. Served in a clone of the live exam UI; the only surface with **multiple-response** items |
| `mocks/exams/ext-*.json` | 80 imported CCDV-F questions from [Amey Thakur's CLAUDE-CERTIFICATIONS](https://github.com/Amey-Thakur/CLAUDE-CERTIFICATIONS) (MIT, see [ATTRIBUTION](mocks/exams/ATTRIBUTION.md)): `ext-developer-practice` (35) and `ext-developer-mock-1/2/3` (15 each) |
| CertSafari | Central live surface for both exams |
| `claudecertificationguide.com/mock-exam` | Live mock, but it is the **Architect** exam; results are mapped onto CCDV-F with every mapping flagged |

## What gets kept

On submit the tool captures the per-question review and writes:

| File | |
|---|---|
| `data/attempts/<ts>.json` | every question, option, rationale, your choice, timings — the source of truth |
| `data/raw/<ts>.*` | the results screen as displayed, text and screenshot |
| `reports/<ts>.md` | that sitting in full |
| `HISTORY.md` / `HISTORY-CCAR-F.md` | the ledger: one row per sitting, sub-skill trends, domain rollup |
| `STUDY-PLAN.md` / `STUDY-PLAN-CCAR-F.md` | what to study next, ranked; blind spots; the next drill's shape |
| `data/history.json` / `data/history-ccar-f.json` | time series, for Claude to read |

The ledger and plan files are regenerated after every sitting, so don't hand-edit
them. Everything except `data/attempts/` is derived and can be rebuilt:

```bash
npm run report -- --all   # rebuild every per-sitting report
npm run history           # rebuild the ledger and plan
```

### Personal data stays local

`.gitignore` excludes `data/attempts/`, `data/raw/`, `reports/`, `reviews/` and
`study/`, plus the browser profile (`.exam-profile/`), so your results and notes
are never pushed. `HISTORY*.md`, `STUDY-PLAN*.md` and `data/history*.json` are
**not** ignored yet and contain your scores — add them before the first push if
you don't want them public.

## What the reports tell you

- Scaled score against the 720 pass mark, and pace per question against the
  exam's 2:00 budget.
- Accuracy per sub-skill, ranked by **impact** = exam weight × miss rate. For
  CCDV-F, 2.5 Claude Application Design is 8.6% of the exam and 7.3 Claude Hooks
  is 1.0%, so they are not worth equal study time. Anthropic publishes no
  per-task weights for CCAR-F, so each domain's weight is split evenly; rank by
  miss rate within a domain.
- Every missed question in full, with both rationales and sources.
- Sub-skills you have not been tested on (blind spots — unmeasured risk, not
  strength).
- **Not improving**: gaps that are flat or falling across sittings, which means
  re-reading isn't working and the approach should change.
- The composition of the next drill.

Sub-skill ids are scoped by exam (both have a `1.1`); an attempt counts toward
its target exam.

## Layout

| Path | |
|---|---|
| `data/attempts/` | one JSON per sitting — the source of truth (gitignored) |
| `data/raw/` | raw page text, screenshots and CertSafari timelines (gitignored) |
| `reports/`, `reviews/` | per-sitting reports and written reviews (gitignored) |
| `study/`, `study/ccar-f/` | notes per weak sub-skill, with references (gitignored) |
| `mocks/exams/` | question sets — `ccdv-f-*` ours, `ext-*` imported |
| `mocks/engine/` | exam UI clone |
| `tools/` | session capture, parsers, reporting, blueprint |

Run `npm test` for parser, blueprint, mapping and imported-exam integrity tests.
Exam facts, blueprint weights, the review format and authoring rules for new
mocks are in [CLAUDE.md](CLAUDE.md).
