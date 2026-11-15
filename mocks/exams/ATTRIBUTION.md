# Attribution for imported exams

Exam files prefixed `ext-` are **not ours**. They are imported verbatim by
`tools/import-bank.mjs` from:

> **CLAUDE-CERTIFICATIONS** — https://github.com/Amey-Thakur/CLAUDE-CERTIFICATIONS
> Copyright (c) 2026 Amey Thakur — MIT Licence
> Imported from `developer-foundations/` and `question-bank.json`, September 2026.

80 CCDV-F questions across four sets (`practice`, `mock-1`, `mock-2`, `mock-3`).
Each imported question also carries the attribution in its own `refs`, so it
shows on the review screen and in any report that quotes it.

Files authored by us (`ccdv-f-*.json`) are unaffected by this notice.

## What we changed on import

The upstream schema differs from ours in two ways, both handled in the importer
rather than by editing the source:

1. **One rationale per question → one per option.** Upstream rationales often
   explain the distractors inline (`"... max_tokens (B) does not change
   per-token pricing"`). Those clauses are split out and attached to the option
   they name; the remainder stays on the correct answer. No text is discarded.
2. **Domain label → blueprint sub-skill.** Upstream tags each question with one
   of the eight official CCDV-F domains but no sub-skill. `mapExternalQuestion`
   resolves one by keyword within that domain, so attribution *between* domains
   is the author's and exact, while attribution *within* a domain is ours and
   indicative. Roughly a third fall back to the domain's heaviest sub-skill.

Question and option text itself is imported unmodified.

## MIT Licence

```
MIT License

Copyright (c) 2026 Amey Thakur

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## Accuracy note

These 80 questions were audited before import for facts that have changed across
the 2025–26 Claude API (deprecated parameters, removed prefill, renamed output
config, model IDs, pricing). **None were found** — the set is deliberately
written at a conceptual level and avoids exact parameter trivia, which is what
makes it durable. Ten questions touch version-sensitive territory and were each
reviewed individually.

That audit does not extend to any *future* re-import. Re-run the check if the
upstream bank is updated.
