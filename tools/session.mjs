#!/usr/bin/env node
/**
 * Start a study session.
 *
 *   node tools/session.mjs                      # live mock (CCAR-F, mapped to CCDV-F)
 *   node tools/session.mjs --mock <exam-id>     # local CCDV-F mock from mocks/exams
 *   node tools/session.mjs --url <url>          # any page on the guide site
 *
 * You sit the exam yourself in the window that opens. This process watches the
 * page, records pacing, and when the results screen appears it opens the
 * per-question detail, captures everything, saves the attempt and writes the
 * report. If a Cloudflare check or login wall shows up, it stops and hands the
 * browser to you.
 */
import { open, gotoWithHandover, detectGate, waitForHuman, banner } from './lib/browser.mjs';
import * as ccg from './lib/extract-ccg.mjs';
import { mapCcarQuestion, classify } from './lib/blueprint.mjs';
import { saveAttempt, saveRaw, stamp, slug, paths } from './lib/store.mjs';
import { buildReport } from './report.mjs';
import { startMockServer } from './serve.mjs';
import path from 'node:path';

const argv = process.argv.slice(2);
const flag = (name, dflt = null) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? (argv[i + 1] ?? true) : dflt;
};

const LIVE_URL = 'https://claudecertificationguide.com/mock-exam/start';

async function main() {
  const mockId = flag('mock');
  const explicitUrl = flag('url');
  let server = null;
  let url = explicitUrl ?? LIVE_URL;
  let source = 'ccg-live-mock';

  if (mockId) {
    server = await startMockServer({ port: Number(flag('port', 0)) });
    url = `${server.origin}/exam/${mockId}`;
    source = `local-mock:${mockId}`;
    console.log(`▸ local mock server on ${server.origin}`);
  }

  banner([
    '▶  STUDY SESSION',
    `   Source: ${source}`,
    `   URL:    ${url}`,
    '   Sit the exam in the browser window. I am watching, not clicking.',
    '   Ctrl-C here aborts without saving.',
  ]);

  // --headless exists for smoke-testing the pipeline; a real sitting needs the window.
  const { ctx, page } = await open({ headless: argv.includes('--headless') });
  await gotoWithHandover(page, url);

  const startedAt = new Date().toISOString();
  const pacing = new Map();   // question number -> ms on screen
  let current = null;
  let last = Date.now();
  let seenExam = false;

  // Local mocks report their own results over HTTP, which is exact; the live
  // site is read from the DOM.
  if (server) {
    const attempt = await server.waitForAttempt();
    // Keep the results screen as it was shown, same as for live sittings.
    await page.waitForTimeout(1200);
    const base = `${stamp(new Date(attempt.startedAt))}-${slug(source)}`;
    const shown = await page.evaluate(() => document.body.innerText).catch(() => null);
    if (shown) {
      await saveRaw(`${base}.txt`, shown);
      attempt.rawFile = `data/raw/${base}.txt`;
    }
    await page.screenshot({ path: path.join(paths.raw, `${base}.png`), fullPage: true }).catch(() => {});
    await finish(attempt, ctx, server);
    return;
  }

  console.log('▸ watching for the results screen…\n');
  for (;;) {
    await page.waitForTimeout(1500);
    let text = '';
    try {
      text = await page.evaluate(() => document.body?.innerText ?? '');
    } catch {
      continue; // mid-navigation
    }

    const gate = await detectGate(page);
    if (gate) { await waitForHuman(page, { reason: gate }); continue; }

    if (ccg.isInExam(text)) {
      seenExam = true;
      const q = ccg.parseCurrentQuestion(text);
      if (q && q.number !== current) {
        const now = Date.now();
        if (current != null) pacing.set(current, (pacing.get(current) ?? 0) + (now - last));
        last = now;
        current = q.number;
        process.stdout.write(`  Q${String(q.number).padStart(2, '0')}/${q.total}` +
          `${q.timeRemaining ? ` · ${q.timeRemaining} left` : ''}${q.domainLabel ? ` · ${q.domainLabel}` : ''}\n`);
      }
    }

    if (ccg.isResultsPage(text)) {
      if (current != null) pacing.set(current, (pacing.get(current) ?? 0) + (Date.now() - last));
      console.log('\n▸ results detected — opening per-question detail');

      // Expand the review if it is collapsed.
      await page.evaluate(() => {
        const b = [...document.querySelectorAll('button')].find((e) => /show detail/i.test(e.innerText));
        if (b) b.click();
      }).catch(() => {});
      await page.waitForTimeout(3500);

      const full = await page.evaluate(() => document.body.innerText);
      const base = `${stamp(new Date(startedAt))}-${slug(source)}`;
      await saveRaw(`${base}.txt`, full);
      await page.screenshot({ path: path.join(paths.raw, `${base}.png`), fullPage: true }).catch(() => {});

      const parsed = ccg.parseResults(full);
      if (!parsed.questions.length) {
        console.warn('! could not parse any questions; raw text is saved so nothing is lost.');
      }

      const questions = parsed.questions.map((q) => {
        const m = mapCcarQuestion({ ccarDomain: q.ccarDomain, tags: q.tags, stem: q.stem });
        return { ...q, subskillId: m.subskillId, mapping: m.confidence, timeMs: pacing.get(q.number) ?? null };
      });

      const attempt = {
        source,
        examCode: 'CCAR-F',
        targetExam: 'CCDV-F',
        mapped: true,
        url,
        startedAt,
        finishedAt: new Date().toISOString(),
        score: parsed.score,
        nativeDomains: parsed.domains,
        questions,
        warnings: parsed.warnings,
        rawFile: `data/raw/${base}.txt`,
      };
      await finish(attempt, ctx, server);
      return;
    }

    if (!seenExam && !ccg.isInExam(text) && /Choose Your Sitting/i.test(text)) {
      // Landing page: nothing to do but wait for the user to start.
    }
  }
}

async function finish(attempt, ctx, server) {
  const file = await saveAttempt(attempt);
  const s = attempt.score ?? {};
  banner([
    '✔  SITTING RECORDED',
    `   Score: ${s.scaled ?? '?'} / 1000${s.passed === false ? ' (not passed)' : s.passed ? ' (passed)' : ''}`,
    `   Correct: ${s.correct ?? '?'} of ${s.total ?? '?'}`,
    `   Attempt: ${path.relative(process.cwd(), file)}`,
  ]);
  if (attempt.warnings?.length) {
    console.log('  parser notes: ' + attempt.warnings.join('; '));
  }

  const report = await buildReport(attempt);
  console.log(`▸ report written:  ${path.relative(process.cwd(), report)}`);
  console.log('▸ record updated:  HISTORY.md, STUDY-PLAN.md\n');
  console.log('Next: tell me "review my last session" and I will read the report,');
  console.log('then write study notes for each gap into study/.\n');

  await ctx.close().catch(() => {});
  server?.close();
  process.exit(0);
}

main().catch((e) => {
  console.error('\n✖ session failed:', e.message);
  process.exit(1);
});
