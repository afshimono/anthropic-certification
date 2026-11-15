#!/usr/bin/env node
/**
 * Local mock-exam server.
 *
 * The published CCDV-F bank does not exist yet, so the exams under
 * mocks/exams/*.json are ones we write. This serves them through an exam
 * harness that mirrors the live site's sitting (timer, navigator, flagging,
 * per-question review with rationales) and supports multiple-response items,
 * which the real CCDV-F uses and the Architect mock does not.
 *
 * On submit the harness POSTs a fully-formed attempt, so local sittings need
 * no DOM scraping at all.
 *
 *   node tools/serve.mjs            # serve only, prints the URL
 */
import http from 'node:http';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { paths, ROOT, saveAttempt } from './lib/store.mjs';
import { SUBSKILLS } from './lib/blueprint.mjs';

const ENGINE = path.join(ROOT, 'mocks/engine');

const send = (res, code, body, type = 'text/plain; charset=utf-8') => {
  res.writeHead(code, { 'content-type': type, 'cache-control': 'no-store' });
  res.end(body);
};

export async function listExams() {
  try {
    return (await readdir(paths.exams)).filter((f) => f.endsWith('.json')).map((f) => f.replace(/\.json$/, ''));
  } catch {
    return [];
  }
}

export async function startMockServer({ port = 0 } = {}) {
  let resolveAttempt;
  const attemptPromise = new Promise((r) => { resolveAttempt = r; });

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    try {
      if (req.method === 'GET' && url.pathname === '/') {
        const ids = await listExams();
        return send(res, 200,
          `<meta charset=utf-8><body style="font:16px system-ui;background:#111;color:#eee;padding:3rem">
           <h1>Local CCDV-F mocks</h1><ul>${ids.map((i) => `<li><a style="color:#d97757" href="/exam/${i}">${i}</a></li>`).join('')}</ul>
           ${ids.length ? '' : '<p>No exams in <code>mocks/exams/</code> yet.</p>'}</body>`,
          'text/html; charset=utf-8');
      }

      if (req.method === 'GET' && url.pathname === '/blueprint') {
        return send(res, 200, JSON.stringify(SUBSKILLS), 'application/json');
      }

      let m = url.pathname.match(/^\/exam\/([\w.-]+)\/data$/);
      if (req.method === 'GET' && m) {
        const raw = await readFile(path.join(paths.exams, `${m[1]}.json`), 'utf8');
        return send(res, 200, raw, 'application/json');
      }

      m = url.pathname.match(/^\/exam\/([\w.-]+)$/);
      if (req.method === 'GET' && m) {
        const html = await readFile(path.join(ENGINE, 'index.html'), 'utf8');
        return send(res, 200, html.replace('__EXAM_ID__', m[1]), 'text/html; charset=utf-8');
      }

      if (req.method === 'POST' && url.pathname === '/attempt') {
        const chunks = [];
        for await (const c of req) chunks.push(c);
        const attempt = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        const file = await saveAttempt(attempt);
        console.log(`\n▸ attempt saved: ${path.relative(process.cwd(), file)}`);
        resolveAttempt(attempt);
        return send(res, 200, JSON.stringify({ ok: true }), 'application/json');
      }

      send(res, 404, 'not found');
    } catch (e) {
      console.error('! server error:', e.message);
      send(res, 500, e.message);
    }
  });

  await new Promise((r) => server.listen(port, '127.0.0.1', r));
  const origin = `http://127.0.0.1:${server.address().port}`;
  return {
    origin,
    server,
    waitForAttempt: () => attemptPromise,
    close: () => server.close(),
  };
}

if (import.meta.filename === process.argv[1]) {
  const s = await startMockServer({ port: 4321 });
  const ids = await listExams();
  console.log(`▸ mock server: ${s.origin}`);
  for (const id of ids) console.log(`   ${s.origin}/exam/${id}`);
  if (!ids.length) console.log('   (no exams yet — ask me to write one into mocks/exams/)');
}
