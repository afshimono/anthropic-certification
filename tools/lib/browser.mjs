import { chromium } from 'playwright';
import readline from 'node:readline';
import { paths } from './store.mjs';

/**
 * A headed browser on a persistent profile. You drive it; the tooling only
 * watches. That keeps logins and any bot-check cookies alive between sittings
 * and means we never automate past a challenge -- see `waitForHuman`.
 */
export async function open({ headless = false } = {}) {
  const ctx = await chromium.launchPersistentContext(paths.profile, {
    headless,
    viewport: null,
    args: ['--window-size=1440,960'],
  });
  const page = ctx.pages()[0] ?? (await ctx.newPage());
  return { ctx, page };
}

const GATES = [
  [/just a moment/i, 'Cloudflare interstitial'],
  [/verifying (you are human|with cloudflare)/i, 'Cloudflare Turnstile'],
  [/checking your browser/i, 'Cloudflare browser check'],
  [/complete the security check|are you a robot|i'?m not a robot/i, 'CAPTCHA'],
  [/enable javascript and cookies to continue/i, 'Cloudflare JS check'],
  [/(sign|log) ?in to continue|please (sign|log) ?in/i, 'login required'],
];

/**
 * Detect a human-only gate. Returns a reason string, or null when clear.
 * Both page text and any challenge iframe are checked, because Turnstile
 * renders inside a cross-origin frame that contributes no innerText.
 */
export async function detectGate(page) {
  try {
    const text = await page.evaluate(() => document.body?.innerText ?? '').catch(() => '');
    for (const [re, reason] of GATES) if (re.test(text)) return reason;
    const frames = page.frames().map((f) => f.url());
    if (frames.some((u) => /challenges\.cloudflare\.com|recaptcha|hcaptcha/.test(u))) {
      // A Turnstile frame is often present but already solved; only treat a
      // visibly pending widget as a gate.
      const pending = await page
        .evaluate(() => /verifying|checking/i.test(document.body?.innerText ?? ''))
        .catch(() => false);
      if (pending) return 'Cloudflare Turnstile (pending)';
    }
    return null;
  } catch {
    return null;
  }
}

const banner = (lines) => {
  const w = Math.max(...lines.map((l) => l.length)) + 2;
  console.log('\n' + '━'.repeat(w));
  for (const l of lines) console.log(' ' + l);
  console.log('━'.repeat(w) + '\n');
};

/**
 * Hand control to the human: print a banner, then continue as soon as either
 * the gate clears on its own or Enter is pressed. Resolves to how it ended.
 */
export function waitForHuman(page, { reason = 'action needed', autoClear = true } = {}) {
  banner([
    '⏸  OVER TO YOU IN THE BROWSER',
    `   Reason: ${reason}`,
    '   Solve it in the window (and log in if asked).',
    '   I continue automatically once it clears — or press Enter here.',
  ]);

  return new Promise((resolve) => {
    let done = false;
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    const finish = (how) => {
      if (done) return;
      done = true;
      clearInterval(timer);
      rl.close();
      console.log(how === 'enter' ? '▶  continuing (you said so)\n' : '▶  gate cleared, continuing\n');
      resolve(how);
    };
    rl.on('line', () => finish('enter'));
    const timer = setInterval(async () => {
      if (!autoClear || done) return;
      if (!(await detectGate(page))) finish('cleared');
    }, 2000);
  });
}

/** Navigate, then pause for the human if a challenge or login wall appears. */
export async function gotoWithHandover(page, url) {
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 90000 }).catch((e) => {
    console.warn(`! navigation warning: ${e.message}`);
  });
  await page.waitForTimeout(2500);
  const gate = await detectGate(page);
  if (gate) await waitForHuman(page, { reason: gate });
  return page;
}

/** Ask a yes/no question on the terminal. */
export function ask(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => rl.question(question, (a) => { rl.close(); resolve(a.trim()); }));
}

export { banner };
