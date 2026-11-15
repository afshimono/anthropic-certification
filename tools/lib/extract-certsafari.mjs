/**
 * Observation for certsafari.com.
 *
 * Unlike the guide site, this one is behind Cloudflare Turnstile and a login,
 * so we never drive it — the human does, and this only reads. And unlike the
 * guide site, its in-quiz DOM is unknown to us until a real sitting happens,
 * so the strategy is:
 *
 *   snapshot generously -> persist every snapshot -> parse from the snapshot
 *
 * Parsing is therefore always re-runnable offline against `data/raw/*.jsonl`.
 * If the heuristics below misread a sitting, we fix them and re-parse; the
 * sitting is never lost. That is the whole design constraint.
 */

const CORRECTISH = /(^|[\s_-])(correct|success|right|valid)([\s_-]|$)/i;
const WRONGISH = /(^|[\s_-])(incorrect|wrong|destructive|error|danger|fail)([\s_-]|$)/i;

/**
 * Read the page into a plain object. Runs in the browser, so it must stay
 * self-contained. Captures more than we need on purpose — colour and class
 * signals let us infer correctness after the fact without knowing their DOM.
 */
export const SNAPSHOT_FN = () => {
  const vis = (el) => {
    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) return false;
    const s = getComputedStyle(el);
    return s.visibility !== 'hidden' && s.display !== 'none' && Number(s.opacity) > 0.05;
  };
  const txt = (el) => (el.innerText ?? el.textContent ?? '').trim();

  /**
   * Anchor on the control itself, never on its container.
   *
   * CertSafari renders each choice as
   *   <label for="option-0">
   *     <button role="radio" aria-checked data-state value="A) ..."></button>
   *     <div><span>A) ...</span></div>
   *   </label>
   * so the button holds the state but no text, while the label holds the text
   * but contains a button. An earlier filter here required "has text AND
   * contains no button", which matched neither and silently captured zero
   * options — losing which answer was selected. Read state from the control and
   * text from its `value` attribute or the enclosing label.
   */
  const options = [...document.querySelectorAll(
    '[role=radio],[role=checkbox],input[type=radio],input[type=checkbox]',
  )].filter(vis).map((el) => {
    const host = el.closest('label') ?? el.parentElement ?? el;
    const s = getComputedStyle(host);
    // Radio options carry the full option text in `value`; checkbox options
    // (multiple-response items) carry the HTML default "on", so preferring
    // `value` unconditionally threw the text away and lost the letter prefix.
    const v = (el.getAttribute('value') ?? '').trim();
    const label = txt(host);
    return {
      text: (v && v !== 'on' ? v : label || v).trim().slice(0, 1200),
      tag: el.tagName.toLowerCase(),
      role: el.getAttribute('role'),
      id: el.id || null,
      cls: `${el.className?.toString?.() ?? ''} ${host.className?.toString?.() ?? ''}`.slice(0, 300),
      dataState: el.getAttribute('data-state'),
      ariaChecked: el.getAttribute('aria-checked'),
      checked: el.matches('input') ? !!el.checked : null,
      disabled: el.hasAttribute('disabled') || el.getAttribute('aria-disabled') === 'true',
      bg: s.backgroundColor,
      border: s.borderColor,
      color: s.color,
    };
  });

  const buttons = [...document.querySelectorAll('button,[role=button],a[href]')]
    .filter(vis).map((b) => ({ text: txt(b).slice(0, 80), disabled: b.hasAttribute('disabled') }))
    .filter((b) => b.text);

  // The results screen's question overview is a grid of numbered pills, green
  // for correct and red for incorrect. Their text is too short to survive the
  // option filter above, so capture them separately with their colours — this
  // is the only machine-readable record of per-question correctness in Timed
  // mode, where nothing is revealed during the quiz.
  const grid = [...document.querySelectorAll('button,[role=button],div,span')]
    .filter((el) => vis(el) && /^\d{1,3}$/.test(txt(el)) && el.children.length <= 1)
    .map((el) => {
      const s = getComputedStyle(el);
      return { n: Number(txt(el)), bg: s.backgroundColor, color: s.color, cls: el.className?.toString?.().slice(0, 120) ?? '' };
    });

  return {
    at: new Date().toISOString(),
    url: location.href,
    title: document.title,
    text: (document.querySelector('main') ?? document.body).innerText,
    bodyText: document.body.innerText.slice(0, 20000),
    options,
    buttons,
    grid,
    // Kept small but enough to rebuild selectors from if the heuristics fail.
    html: (() => {
      const all = [...document.querySelectorAll('div,section,article,form')].filter(vis);
      const withOpts = all.filter((e) => e.querySelectorAll('[role=radio],input[type=radio],[data-radix-collection-item]').length >= 2);
      const smallest = withOpts.sort((a, b) => a.innerHTML.length - b.innerHTML.length)[0];
      return (smallest ?? document.querySelector('main') ?? document.body).outerHTML.slice(0, 12000);
    })(),
  };
};

/**
 * Is this page actually a quiz in progress?
 *
 * Without this guard the overview page's "Exam Topics & Skills Assessed" prose
 * parses as a question — its subdomain descriptions are long paragraphs sitting
 * near clickable elements. Require real evidence of a quiz: a progress counter,
 * a select-N instruction, a quiz control, or genuine radio semantics.
 */
export function looksLikeQuiz(snap) {
  const t = snap.text ?? '';
  if (/exam topics & skills assessed|start practicing|question bank created/i.test(t)) return false;
  const hasProgress = parseProgress(t).index != null;
  const hasInstruction = /select\s+(one|all|the|\d)|choose\s+(one|the)/i.test(t);
  const hasControl = (snap.buttons ?? []).some((b) =>
    /^(submit|check answer|next question|next|finish quiz|reveal)/i.test(b.text));
  const realRadios = (snap.options ?? []).filter((o) =>
    o.role === 'radio' || o.role === 'checkbox' || o.checked !== null || o.dataState).length >= 2;
  return hasProgress || hasInstruction || hasControl || realRadios;
}

/** Progress like "Question 3 of 10" or a bare "3 / 10". */
export function parseProgress(text) {
  const m = text.match(/question\s+(\d+)\s*(?:of|\/)\s*(\d+)/i) ?? text.match(/\b(\d{1,3})\s*\/\s*(\d{1,3})\b/);
  if (!m) return { index: null, total: null };
  const index = Number(m[1]); const total = Number(m[2]);
  return total >= index && total <= 200 ? { index, total } : { index: null, total: null };
}

/**
 * Blueprint attribution. CertSafari labels questions with the official domain
 * and subdomain names, so when a subdomain is on screen we get an exact
 * sub-skill id — far better than our keyword mapping.
 */
export function parseTaxonomy(text) {
  const sub = text.match(/subdomain\s+(\d\.\d)/i);
  if (sub) return { subskillId: sub[1], source: 'labelled' };
  const dom = text.match(/domain\s+(\d)\s*[:.]/i);
  if (dom) return { domainId: `D${dom[1]}`, source: 'domain-label' };
  return { source: 'none' };
}

/**
 * The pre-submit review screen, which is *not* the end of the sitting.
 *
 * CertSafari shows "Review before you submit — Open any question to review
 * your answers. Submit when you are ready" with every question still editable.
 * An earlier `isFinished` matched `review your answers` there, so the observer
 * declared the sitting over and exited while it was still open and unscored —
 * costing a full 53-question sitting's correctness data. Never treat a page
 * that is still offering to submit as finished.
 */
const PRE_SUBMIT = /review\s+before\s+you\s+submit|submit\s+quiz|submit\s+when\s+you\s+are\s+ready|until\s+you\s+submit/i;

/** Has the quiz reached the scored results screen? */
export const isFinished = (text) =>
  !PRE_SUBMIT.test(text)
  && (/(quiz|practice)\s+(complete|finished|summary)/i.test(text)
    || /you\s+answered\s+\d+\s+out\s+of\s+\d+/i.test(text)
    || /your\s+(score|results)|you\s+scored/i.test(text))
  && !/select\s+(one|all|the)/i.test(text);

/** Did the page reveal whether the answer was right? */
export const isRevealed = (snap) =>
  /\b(correct|incorrect)\b/i.test(snap.text) && /explanation|why|rationale/i.test(snap.text)
  || snap.options.some((o) => CORRECTISH.test(o.cls) || WRONGISH.test(o.cls));

/** Score line on the results screen, e.g. "8 / 10 (80%)". */
export function parseScore(text) {
  const frac = text.match(/\b(\d{1,3})\s*(?:\/|out of)\s*(\d{1,3})\b/);
  const pc = text.match(/\b(\d{1,3})\s*%/);
  if (!frac && !pc) return null;
  const correct = frac ? Number(frac[1]) : null;
  const total = frac ? Number(frac[2]) : null;
  return {
    correct, total,
    percent: pc ? Number(pc[1]) : (total ? Math.round((correct / total) * 100) : null),
  };
}

/**
 * Their quiz renders options as plain "A) ..." lines, and labels each question
 * with its exact blueprint sub-skill ("Subdomain 7.3: Claude Hooks"). Parsing
 * the text is both simpler and far more durable than matching their DOM, which
 * is how we read the other site too.
 */
export function parseQuestionText(text) {
  const t = (text ?? '').replace(/ /g, ' ');
  const lines = t.split('\n').map((l) => l.trim());

  const qi = lines.findIndex((l) => /^question\s+\d+\s+of\s+\d+$/i.test(l));
  if (qi < 0) return null;
  const [, num, total] = lines[qi].match(/question\s+(\d+)\s+of\s+(\d+)/i);

  const subLine = lines.find((l) => /^subdomain\s+\d\.\d\s*:/i.test(l));
  const sub = subLine?.match(/^subdomain\s+(\d\.\d)\s*:\s*(.+)$/i);

  // Options are the "A) ..." lines; the stem is what sits between the
  // subdomain label (or question header) and the first option.
  const optIdx = lines.findIndex((l, i) => i > qi && /^[A-H]\)\s+\S/.test(l));
  const options = [];
  if (optIdx > 0) {
    for (let i = optIdx; i < lines.length; i++) {
      const m = lines[i].match(/^([A-H])\)\s+(.*)$/);
      if (m) options.push({ letter: m[1], text: m[2].trim() });
      // Footer controls end the option list. `close`, `save` and the panel's
      // prev/next buttons belong here too: on the review screen the last
      // option's text was absorbing "Close".
      else if (options.length && /^(report|note|continue|submit|next|mark|exit quiz|close|save|previous question|next question)$/i.test(lines[i])) break;
      else if (options.length && lines[i]) options[options.length - 1].text += ' ' + lines[i];
    }
  }

  const stemStart = subLine ? lines.indexOf(subLine) + 1 : qi + 1;
  const stem = lines.slice(stemStart, optIdx > 0 ? optIdx : stemStart + 1)
    .filter((l) => l && !/^(mark|report|note|continue)$/i.test(l))
    .join(' ').trim() || null;

  const timer = t.match(/^\s*(\d+m(?:\s*\d+s)?|\d{1,2}:\d{2})\s*$/m);

  return {
    number: Number(num),
    total: Number(total),
    subskillId: sub?.[1] ?? null,
    subskillName: sub?.[2]?.trim() ?? null,
    stem,
    options,
    timeRemaining: timer?.[1] ?? null,
    marked: lines.includes('Mark'),
  };
}

/**
 * Full read of one snapshot: question structure from the text, selection state
 * from the radio controls, matched up by their "A)" / "B)" prefix. This is what
 * records the answer actually given, which the text alone never shows.
 */
export function parseSnapshot(snap) {
  // The pre-submit screen pairs a question number with text and controls that
  // are not that question's — 2026-09-26 it recorded D against Q47 (answer C).
  if (PRE_SUBMIT.test(snap?.text ?? '')) return null;
  const q = parseQuestionText(snap?.text);
  if (!q) return null;

  const picked = new Map();
  const controls = snap.options ?? [];
  controls.forEach((o, i) => {
    // Checkbox controls on multiple-response items carry no letter of their own
    // — `value` is the HTML default "on" — so fall back to the positional id,
    // exactly as parseReviewPanel does. Matching on text alone made the answer
    // given on a select-all item depend on the label text being captured.
    const letter = letterOfControl(o, i);
    if (!letter) return;
    const chosen = o.ariaChecked === 'true' || o.dataState === 'checked' || o.dataState === 'on' || o.checked === true;
    // A later control for the same letter only matters if it is the chosen one.
    if (chosen || !picked.has(letter)) picked.set(letter, chosen);
  });

  // Advancing a question re-renders the text before the controls reset, so the
  // first snapshot under a new number can show the *previous* question's
  // selection. A real selection always enables Continue; a checked control
  // beside a disabled Continue is that leftover state, not an answer.
  const cont = (snap.buttons ?? []).find((b) => (b.text ?? '').trim() === 'Continue');
  const stale = cont?.disabled === true;
  if (stale) for (const k of picked.keys()) picked.set(k, false);

  q.options = q.options.map((o) => ({ ...o, chosen: picked.has(o.letter) ? picked.get(o.letter) : null }));
  q.chosen = q.options.filter((o) => o.chosen).map((o) => o.letter).join('') || null;
  q.sawControls = picked.size > 0;
  q.staleSelection = stale;
  return q;
}

const LETTERS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'];

/**
 * Which option letter a captured control belongs to.
 *
 * Radio controls carry "A) ..." in their text. Checkbox controls (used for
 * multiple-response items) do not — their `value` is the HTML default "on" —
 * so fall back to the positional id CertSafari assigns, `option-0` upward.
 * Without this fallback the answer given on every select-all item was lost.
 */
export function letterOfControl(o, index = null) {
  const fromText = (o?.text ?? '').match(/^([A-H])\)/);
  if (fromText) return fromText[1];
  const fromId = (o?.id ?? '').match(/option-(\d+)$/);
  if (fromId) return LETTERS[Number(fromId[1])] ?? null;
  return index != null ? LETTERS[index] ?? null : null;
}

/**
 * Parse a per-question review panel, as reached by tapping a number on the
 * results screen with every option's explanation accordion expanded.
 *
 * Layout:
 *   Subdomain 5.2: Technical Fundamentals
 *   <stem>
 *   Incorrect
 *   A) <option text>
 *   Explanation
 *   Correct. <why>            <- the verdict word identifies the answer
 *   B) <option text>
 *   Explanation
 *   Incorrect. <why>
 *   ...
 *
 * The selected option is not in the text — it comes from the radio controls in
 * `snap.options` — so both are read here. Returns `partial: true` when some
 * accordions never rendered, which happens and must not be papered over.
 */
export function parseReviewPanel(snap) {
  const text = (snap?.text ?? '').replace(/ /g, ' ');
  const start = text.search(/Subdomain\s+\d\.\d\s*:/);
  if (start < 0) return null;
  const panel = text.slice(start);
  const lines = panel.split('\n').map((l) => l.trim());

  const sub = lines[0].match(/^Subdomain\s+(\d\.\d)\s*:\s*(.+)$/);
  const firstOpt = lines.findIndex((l) => /^[A-H]\)\s+\S/.test(l));
  const status = lines.find((l) => /^(correct|incorrect)$/i.test(l))?.toUpperCase() ?? null;

  const stem = lines.slice(1, firstOpt > 0 ? firstOpt : 2)
    .filter((l) => l && !/^(correct|incorrect)$/i.test(l)
      && !/^review the explanations/i.test(l))
    .join(' ').trim() || null;

  // One block per option, ending at the next option letter or the panel footer.
  const FOOTER = /^(save|note|report|previous question|next question|close)$/i;
  const bounds = [];
  for (let i = firstOpt; i > 0 && i < lines.length; i++) {
    if (/^[A-H]\)\s+\S/.test(lines[i])) bounds.push(i);
  }
  const options = bounds.map((from, k) => {
    const to = bounds[k + 1] ?? lines.findIndex((l, i) => i > from && FOOTER.test(l));
    const seg = lines.slice(from, to > from ? to : lines.length);
    const letter = seg[0][0];
    // option text may wrap before the "Explanation" marker
    const exIdx = seg.findIndex((l) => /^explanation$/i.test(l));
    const optText = seg.slice(0, exIdx > 0 ? exIdx : 1).join(' ').replace(/^[A-H]\)\s*/, '').trim();
    const body = exIdx > 0 ? seg.slice(exIdx + 1).filter((l) => l && !FOOTER.test(l)).join(' ').trim() : '';
    // Their explanations usually open with the verdict, but the bank is not
    // consistent about the word or the punctuation. Seen in real captures:
    //   "Correct. ..."   single-answer items
    //   "Correct: ..."   select-all items
    //   "Correct — ..." / "Wrong — ..."   em dash, and "Wrong" for "Incorrect"
    // Accepting only [.:] scored four panels as unexplained on 2026-09-23.
    // Some items carry no verdict word at all; those stay null on purpose —
    // never guess a correct answer from the prose.
    const VERDICT = /^(correct|incorrect|wrong)\s*[.:—–-]\s*/i;
    const opener = body.match(VERDICT);
    const verdict = opener ? /^correct/i.test(opener[1]) : null;
    return {
      letter,
      text: optText,
      explanation: body.replace(VERDICT, '').trim() || null,
      correct: verdict === true,
      verdictKnown: verdict !== null,
    };
  });

  const picked = new Set();
  for (const o of snap.options ?? []) {
    const letter = letterOfControl(o);
    if (!letter) continue;
    if (o.ariaChecked === 'true' || o.dataState === 'checked' || o.checked === true) picked.add(letter);
  }

  const known = options.filter((o) => o.verdictKnown).length;
  return {
    subskillId: sub?.[1] ?? null,
    subskillName: sub?.[2]?.trim() ?? null,
    status,
    stem,
    options: options.map((o) => ({ ...o, chosen: picked.has(o.letter) })),
    chosen: [...picked].sort().join('') || null,
    answer: options.filter((o) => o.correct).map((o) => o.letter).join('') || null,
    selectCount: options.filter((o) => o.correct).length || null,
    partial: known < options.length,
    verdictsKnown: known,
  };
}

/**
 * Per-question correctness from the results grid's red/green pills.
 *
 * Only the *scored* grid carries verdicts. The pre-submit review screen shows
 * the same 1..53 pills tinted `rgba(20, 189, 169, 0.15)` to mean "answered",
 * and a plain green test reads that teal as correct — on 2026-09-23 it turned a
 * 43/53 sitting into 53/53. So a cell counts only when its fill is opaque:
 * the real verdict pills are solid `rgb(5, 150, 105)` (emerald, correct) and
 * `rgb(239, 67, 67)` (destructive, incorrect). Tailwind's class names are
 * checked first and the colour is the fallback, since either can be restyled.
 */
export function parseGrid(grid = []) {
  const out = new Map();
  for (const cell of grid) {
    if (!Number.isFinite(cell.n) || cell.n < 1 || cell.n > 200) continue;

    let verdict = null;
    if (/bg-(emerald|green)/i.test(cell.cls ?? '')) verdict = true;
    else if (/bg-(destructive|red|rose)/i.test(cell.cls ?? '')) verdict = false;
    else {
      const nums = (cell.bg?.match(/[\d.]+/g) ?? []).map(Number);
      const [r, g, b] = nums;
      const alpha = nums.length > 3 ? nums[3] : 1;
      if (r == null || alpha < 0.5) continue;       // transparent tint: not a verdict
      if (g > r + 20 && g > b) verdict = true;      // green pill  -> correct
      else if (r > g + 20 && r > b) verdict = false; // red pill   -> incorrect
    }
    if (verdict !== null && !out.has(cell.n)) out.set(cell.n, verdict);
  }
  return out;
}

/** Results screen: overall score plus the per-domain table. */
export function parseResultsScreen(text) {
  const t = text ?? '';
  const tally = t.match(/answered\s+(\d+)\s+out of\s+(\d+)\s+questions correctly/i);
  const pc = t.match(/(\d{1,3})\s*%/);
  const domains = [...t.matchAll(/Domain\s+(\d)\s*:\s*([^\n]+?)\s*\n\s*(\d+)\s*\/\s*(\d+)\s*\((\d+)%\)/g)]
    .map((m) => ({ id: `D${m[1]}`, name: m[2].trim(), correct: Number(m[3]), total: Number(m[4]), percent: Number(m[5]) }));
  if (!tally && !domains.length) return null;
  return {
    correct: tally ? Number(tally[1]) : null,
    total: tally ? Number(tally[2]) : null,
    percent: pc ? Number(pc[1]) : null,
    domains,
  };
}

const rgb = (s) => (s?.match(/\d+/g) ?? []).slice(0, 3).map(Number);
/** Green-ish / red-ish tinting, used as a correctness signal of last resort. */
function tint(o) {
  for (const v of [o.bg, o.border]) {
    const [r, g, b] = rgb(v);
    if (r == null) continue;
    if (g > r + 18 && g > b + 8) return 'correct';
    if (r > g + 18 && r > b + 8) return 'wrong';
  }
  return null;
}

const selected = (o) =>
  o.checked === true || o.ariaChecked === 'true' || o.dataState === 'checked' || o.dataState === 'on'
  || /\bselected\b|\bdata-selected\b/i.test(o.cls);

/**
 * Turn one snapshot into a question record. `correct` is left null when the
 * page has not revealed the answer, or when we genuinely cannot tell — never
 * guessed, because a wrong correctness value silently corrupts the study plan.
 */
export function parseQuestion(snap) {
  const text = snap.text ?? '';
  const { index, total } = parseProgress(text);

  // De-duplicate option texts, keep the most specific element per text.
  const seen = new Map();
  for (const o of snap.options) {
    const key = o.text.replace(/\s+/g, ' ').trim();
    const prev = seen.get(key);
    const better = !prev || (o.role ?? '') !== '' || o.checked !== null;
    if (better) seen.set(key, o);
  }
  let options = [...seen.values()];

  // Drop obvious chrome that slipped through the visibility filter.
  options = options.filter((o) => !/^(start quiz|submit|next|previous|finish|save|report|feedback|donate|close|cancel)$/i.test(o.text));

  const letters = ['A', 'B', 'C', 'D', 'E', 'F'];
  const parsed = options.slice(0, 6).map((o, i) => ({
    letter: letters[i],
    text: o.text,
    chosen: selected(o),
    signal: CORRECTISH.test(o.cls) ? 'correct' : WRONGISH.test(o.cls) ? 'wrong' : tint(o),
  }));

  // The stem: the longest paragraph above the options that is not an option.
  const optTexts = new Set(parsed.map((p) => p.text));
  const stem = text.split('\n').map((l) => l.trim())
    .filter((l) => l.length > 40 && !optTexts.has(l))
    .sort((a, b) => b.length - a.length)[0] ?? null;

  const explanation = (() => {
    const m = text.match(/(?:explanation|why this is correct|rationale)\s*:?\s*\n?([\s\S]{20,2000}?)(?:\n{2,}|$)/i);
    return m ? m[1].trim() : null;
  })();

  const revealed = isRevealed(snap);
  const correctOpt = parsed.find((p) => p.signal === 'correct');
  const chosen = parsed.filter((p) => p.chosen);
  const correct = !revealed ? null
    : correctOpt ? chosen.length > 0 && chosen.every((c) => c.signal === 'correct')
    : /\bcorrect\b/i.test(text) && !/\bincorrect\b/i.test(text) ? true
    : /\bincorrect\b/i.test(text) ? false
    : null;

  return {
    index, total, stem,
    options: parsed,
    chosen: chosen.map((c) => c.letter).join('') || null,
    answer: correctOpt?.letter ?? null,
    siteExplanation: explanation,
    taxonomy: parseTaxonomy(text),
    revealed,
    correct,
    url: snap.url,
  };
}

/** Stable identity for a question, so re-renders are not counted twice. */
export const questionKey = (q) =>
  (q.stem ?? '').replace(/\s+/g, ' ').slice(0, 160).toLowerCase() || `idx:${q.index}`;

export { CORRECTISH, WRONGISH };
