/**
 * Official CCDV-F blueprint (Anthropic Exam Guide v1.0, July 2026).
 * Weights are Anthropic's own per-sub-skill figures and sum to 100.
 * Source: https://claudecertificationguide.com/ccdv-f
 *
 * Every attempt we record is ultimately projected onto these 25 sub-skills,
 * so study time can be spent where weight x weakness is highest.
 */
export const EXAM = {
  code: 'CCDV-F',
  name: 'Claude Certified Developer (Foundations)',
  items: 53,
  minutes: 120,
  passScaled: 720,
  scale: [100, 1000],
};

export const BLUEPRINT = [
  {
    id: 'D1', name: 'Agents and Workflows', weight: 14.7,
    subskills: [
      { id: '1.1', name: 'Agent Architecture', weight: 4.5 },
      { id: '1.2', name: 'Agent Construction with Claude', weight: 5.3 },
      { id: '1.3', name: 'Agent Patterns and Frameworks', weight: 4.9 },
    ],
  },
  {
    id: 'D2', name: 'Applications and Integration', weight: 33.1,
    subskills: [
      { id: '2.1', name: 'Understanding Requirements', weight: 3.4 },
      { id: '2.2', name: 'Systems Life Cycle', weight: 2.8 },
      { id: '2.3', name: 'Claude API Mechanics', weight: 6.8 },
      { id: '2.4', name: 'Software Engineering Foundations', weight: 7.4 },
      { id: '2.5', name: 'Claude Application Design', weight: 8.6 },
      { id: '2.6', name: 'Configuration Management', weight: 4.1 },
    ],
  },
  {
    id: 'D3', name: 'Claude Code', weight: 3.1,
    subskills: [{ id: '3.1', name: 'Claude Code Operation', weight: 3.1 }],
  },
  {
    id: 'D4', name: 'Eval, Testing, and Debugging', weight: 2.6,
    subskills: [{ id: '4.1', name: 'Debugging and Error Handling', weight: 2.6 }],
  },
  {
    id: 'D5', name: 'Model Selection and Optimisation', weight: 16.8,
    subskills: [
      { id: '5.1', name: 'LLM Fundamentals', weight: 5.2 },
      { id: '5.2', name: 'Technical Fundamentals', weight: 6.1 },
      { id: '5.3', name: 'Model Selection and Trade-offs', weight: 2.7 },
      { id: '5.4', name: 'Cost and Token Management', weight: 2.8 },
    ],
  },
  {
    id: 'D6', name: 'Prompt and Context Engineering', weight: 11.0,
    subskills: [
      { id: '6.1', name: 'Context Engineering', weight: 3.8 },
      { id: '6.2', name: 'Prompt Engineering', weight: 4.6 },
      { id: '6.3', name: 'Output Handling', weight: 2.6 },
    ],
  },
  {
    id: 'D7', name: 'Security and Safety', weight: 8.1,
    subskills: [
      { id: '7.1', name: 'AI Application Security', weight: 3.2 },
      { id: '7.2', name: 'Guardrails and Safe Deployment', weight: 2.3 },
      { id: '7.3', name: 'Claude Hooks', weight: 1.0 },
      { id: '7.4', name: 'Identity, Secrets, and Key Management', weight: 1.6 },
    ],
  },
  {
    id: 'D8', name: 'Tools and MCPs', weight: 10.6,
    subskills: [
      { id: '8.1', name: 'Tool Implementation', weight: 4.4 },
      { id: '8.2', name: 'MCP Server Development', weight: 2.1 },
      { id: '8.3', name: 'Agentic Customisation', weight: 4.1 },
    ],
  },
];

const flatten = (bp) =>
  bp.flatMap((d) => d.subskills.map((s) => ({ ...s, domainId: d.id, domainName: d.name, domainWeight: d.weight })));

export const SUBSKILLS = flatten(BLUEPRINT);

/**
 * Official CCAR-F blueprint (Anthropic Exam Guide v1.0, effective July 2026).
 * Domain weights are Anthropic's. Task-statement names are the 30 published on
 * claudecertificationguide.com/architect-foundations and CertSafari.
 *
 * Anthropic publishes NO per-task-statement weight for CCAR-F, so each task
 * carries its domain's weight split evenly. That keeps the domain totals exact
 * and the impact ranking honest at domain level, but two tasks in one domain
 * always tie on weight -- rank within a domain by miss rate, not by weight.
 */
const ARCH_DOMAINS = [
  ['D1', 'Agentic Architecture & Orchestration', 27, [
    'Agentic Loops', 'Multi-Agent Orchestration', 'Subagent Invocation and Context Passing',
    'Workflow Enforcement and Handoff', 'Agent SDK Hooks', 'Task Decomposition Strategies',
    'Session State and Resumption']],
  ['D2', 'Tool Design & MCP Integration', 18, [
    'Tool Interface Design', 'Structured Error Responses', 'Tool Distribution & Tool Choice',
    'MCP Server Integration', 'Built-in Tools']],
  ['D3', 'Claude Code Configuration & Workflows', 20, [
    'CLAUDE.md Hierarchy, Scoping, and Modular Organisation', 'Custom Slash Commands and Skills',
    'Path-Specific Rules for Conditional Convention Loading', 'Plan Mode vs Direct Execution',
    'Iterative Refinement Techniques', 'CI/CD Integration']],
  ['D4', 'Prompt Engineering & Structured Output', 20, [
    'System Prompts with Explicit Criteria', 'Few-Shot Prompting', 'Structured Output with Tool Use',
    'Validation, Retry, and Feedback Loops', 'Batch Processing Strategies', 'Multi-Instance and Multi-Pass Review']],
  ['D5', 'Context Management & Reliability', 15, [
    'Context Window Management', 'Escalation & Ambiguity Resolution',
    'Error Propagation in Multi-Agent Systems', 'Codebase Exploration & Context Degradation',
    'Human Review & Confidence Calibration', 'Information Provenance & Multi-Source Synthesis']],
];

export const ARCH_BLUEPRINT = ARCH_DOMAINS.map(([id, name, weight, tasks]) => ({
  id, name, weight,
  subskills: tasks.map((t, i) => ({
    id: `${id.slice(1)}.${i + 1}`, name: t, weight: +(weight / tasks.length).toFixed(2), weightEstimated: true,
  })),
}));
export const ARCH_SUBSKILLS = flatten(ARCH_BLUEPRINT);

/**
 * Exams the harness can track. Sub-skill ids are only unique *within* an exam
 * (both have a 1.1), so every lookup takes the exam code and an attempt belongs
 * to the exam in its `targetExam` -- a mapped Architect mock therefore still
 * counts toward CCDV-F, while a CertSafari CCAR-F sitting counts toward CCAR-F.
 */
export const EXAMS = {
  'CCDV-F': {
    ...EXAM, slug: 'ccdv-f', blueprint: BLUEPRINT, subskills: SUBSKILLS,
    certsafariUrl: 'https://www.certsafari.com/anthropic/claude-developer-foundations',
  },
  'CCAR-F': {
    code: 'CCAR-F', name: 'Claude Certified Architect (Foundations)', items: 60, minutes: 120,
    passScaled: 720, scale: [100, 1000], slug: 'ccar-f', blueprint: ARCH_BLUEPRINT, subskills: ARCH_SUBSKILLS,
    certsafariUrl: 'https://www.certsafari.com/anthropic/claude-certified-architect-foundations',
  },
};
export const DEFAULT_EXAM = 'CCDV-F';
export const examConfig = (code = DEFAULT_EXAM) => EXAMS[code] ?? EXAMS[DEFAULT_EXAM];
/** The exam an attempt counts toward. */
export const examOfAttempt = (a) => (EXAMS[a?.targetExam] ? a.targetExam : DEFAULT_EXAM);

export const subskill = (id, exam = DEFAULT_EXAM) => examConfig(exam).subskills.find((s) => s.id === id);
export const domain = (id, exam = DEFAULT_EXAM) => examConfig(exam).blueprint.find((d) => d.id === id);

export const labelOf = (id, exam = DEFAULT_EXAM) => {
  if (!id) return 'sub-skill not attributed';
  const s = subskill(id, exam);
  return s ? `${s.id} ${s.name}` : id;
};

/**
 * The live mock on claudecertificationguide.com is the CCAR-F (Architect)
 * exam, which uses five different domains. We map its results onto the CCDV-F
 * blueprint so both surfaces feed one picture. The mapping is approximate by
 * nature -- reports label anything routed through it as `mapped`.
 */
export const CCARF_DOMAINS = {
  D1: { name: 'Agentic Architecture & Orchestration', weight: 27, ccdv: ['1.1', '1.2', '1.3'] },
  D2: { name: 'Tool Design & MCP Integration', weight: 18, ccdv: ['8.1', '8.2', '8.3'] },
  D3: { name: 'Claude Code Configuration & Workflows', weight: 20, ccdv: ['3.1', '2.6'] },
  D4: { name: 'Prompt Engineering & Structured Output', weight: 20, ccdv: ['6.2', '6.3'] },
  D5: { name: 'Context Management & Reliability', weight: 15, ccdv: ['6.1', '4.1'] },
};

/**
 * Keyword -> sub-skill rules, most specific first. Used to refine a CCAR-F
 * domain into a CCDV-F sub-skill using the question's lesson tags and stem,
 * and to classify any free-text question that carries no explicit tag.
 */
const RULES = [
  // Most specific first. `classifyRanked` returns every match in this order, and
  // `mapExternalQuestion` picks the first one inside the stated domain — so a
  // rule firing "wrongly" for another domain is harmless, and broad patterns are
  // safe to include late.
  [/\bmcp\b|model context protocol|stdio transport|resource template/i, '8.2'],
  [/tool[_ ]?use|tool schema|input_schema|tool definition|tool description|custom tool|built-?in tool|tool result|parallel tool|tool selection|tool surface/i, '8.1'],
  [/\bskill\b|slash command|claude\.md|permission mode|settings\.json|agentic customis|subagent config/i, '8.3'],
  [/claude code|\bcli\b|terminal|plan mode|worktree/i, '3.1'],
  [/prompt cach|cache_control|token count|\bcost\b|pricing|cheaper|budget|spend|50% (of the )?(cost|discount)/i, '5.4'],
  [/haiku|sonnet|opus|model selection|most capable model|larger model|latency budget|trade-?off|which model/i, '5.3'],
  [/temperature|top_p|sampling|tokeni[sz]|embedding|attention|context window (size|limit)|token.{0,12}unit/i, '5.2'],
  [/hallucinat|probabilistic|non-?determinis|llm fundamental|next[- ]token|why (do|does).{0,20}model/i, '5.1'],
  [/prompt injection|jailbreak|exfiltrat|sanitis|sanitiz|owasp|untrusted (content|input|data)|hidden text|injected/i, '7.1'],
  [/guardrail|moderation|least privilege|approval (pattern|dialog)|confirmation dialog|dangerous (operation|action)|refusal|safe deployment|red team/i, '7.2'],
  [/pre-?tool-?use|post-?tool-?use|\bhooks?\b/i, '7.3'],
  [/api key|secret|credential|oauth|\biam\b|rotation|vault|\bpii\b/i, '7.4'],
  [/context (window is|nearly full|bloat|drift|rot)|prune|compact|summaris|summariz|progressive|scratchpad|persistent facts|carried forward|isolate subtask/i, '6.1'],
  [/few[- ]shot|worked example|chain of thought|xml tag|system prompt|prefill|role prompt|prompt engineering|instruction/i, '6.2'],
  [/structured output|json schema|output format|\bparse\b|parseable|stop_sequence|validate (the )?(result|output)|malformed/i, '6.3'],
  [/retry|backoff|429|529|rate limit|error handling|\bdebug|\btrace|overloaded|regression suite|\bassert\b|silently (skip|swallow)/i, '4.1'],
  [/messages api|stop_reason|end_turn|streaming|\bsse\b|system parameter|max_tokens|stop reason|api mechanic|message batches|batch(es)? api|custom_id|stateless|conversation (state|history)|content block|vision/i, '2.3'],
  [/requirement|stakeholder|acceptance criteria|success metric|scope of the/i, '2.1'],
  [/life ?cycle|ci\/cd|deploy|rollout|staging|pin (the )?model|version pinning|upgrade/i, '2.2'],
  [/config(uration|ure)?\b|environment variable|feature flag|\.env\b/i, '2.6'],
  [/idempoten|queue|webhook|\bscal(e|ing|ability)|cach(e|ing) layer|database|microservice|try (block|\/ ?catch)|swallow/i, '2.4'],
  [/orchestrat|supervisor|manager|multi-?agent|subagent|delegat|handoff|router|agent pattern/i, '1.3'],
  [/agent sdk|agent loop|harness|managed agent|build(ing)? an agent|langgraph|pydantic|strands/i, '1.2'],
  [/agent(ic)? (architecture|design)|workflow (versus|vs\.?) agent|when to use an agent|known in advance|autonom/i, '1.1'],
  [/\brag\b|retriev|vector|chunk|pipeline|application design|classif|enrich|summaris(e|ing) (a|the|vendor)/i, '2.5'],
];

/**
 * Domain names as third-party banks label them, mapped to blueprint ids.
 * Accepts both spellings of "Optimisation" and is matched case-insensitively.
 */
export const DOMAIN_BY_NAME = {
  'agents and workflows': 'D1',
  'applications and integration': 'D2',
  'claude code': 'D3',
  'eval, testing, and debugging': 'D4',
  'eval testing and debugging': 'D4',
  'model selection and optimization': 'D5',
  'model selection and optimisation': 'D5',
  'prompt and context engineering': 'D6',
  'security and safety': 'D7',
  'tools and mcps': 'D8',
};

/** Fallback sub-skill per domain: the heaviest, so an unclassified question
 *  lands where that domain's mass actually is. */
const DOMAIN_DEFAULT = Object.fromEntries(
  BLUEPRINT.map((d) => [d.id, [...d.subskills].sort((a, b) => b.weight - a.weight)[0].id]),
);

/**
 * Resolve a sub-skill for an externally-sourced question that carries a domain
 * name but no sub-skill. Keyword hits are constrained to that domain, so a
 * question about caching inside "Applications and Integration" cannot be
 * misfiled under Cost and Token Management.
 */
export function mapExternalQuestion({ domainName, text = '' }) {
  const domainId = DOMAIN_BY_NAME[String(domainName ?? '').trim().toLowerCase()] ?? null;
  if (!domainId) {
    const loose = classify(text);
    return { subskillId: loose, domainId: loose ? subskill(loose)?.domainId : null, confidence: loose ? 'low' : 'none' };
  }
  const inDomain = domain(domainId).subskills.map((s) => s.id);
  // Take the highest-priority keyword match that falls *inside* the stated
  // domain, rather than the globally-first match. A D2 question about batching
  // hits the cost rule first, but "2.5 Claude Application Design" is the honest
  // home for it; only fall back to the domain default when nothing matches.
  const hit = classifyRanked(text).find((id) => inDomain.includes(id));
  if (hit) return { subskillId: hit, domainId, confidence: 'high' };
  return { subskillId: DOMAIN_DEFAULT[domainId], domainId, confidence: 'domain-only' };
}

/** Best-effort sub-skill for arbitrary text. Returns null when nothing matches. */
export function classify(text) {
  return classifyRanked(text)[0] ?? null;
}

/** Every matching sub-skill, in rule priority order, de-duplicated. */
export function classifyRanked(text) {
  if (!text) return [];
  const out = [];
  for (const [re, id] of RULES) if (re.test(text) && !out.includes(id)) out.push(id);
  return out;
}

/**
 * Resolve a CCDV-F sub-skill for a question captured from the CCAR-F mock.
 * Prefers a keyword hit that stays inside the mapped domain's candidates,
 * then any keyword hit, then the domain's first candidate.
 */
export function mapCcarQuestion({ ccarDomain, tags = '', stem = '' }) {
  const cands = CCARF_DOMAINS[ccarDomain]?.ccdv ?? [];
  const hit = classify(`${tags} ${stem}`);
  if (hit && cands.includes(hit)) return { subskillId: hit, confidence: 'high' };
  if (hit) return { subskillId: hit, confidence: 'low' };
  return { subskillId: cands[0] ?? null, confidence: cands.length ? 'domain-only' : 'none' };
}

/**
 * CCAR-F fallback attribution for a captured question that carries no sub-skill
 * label. CertSafari normally labels them (`mapping: 'labelled'`), so this is a
 * safety net. Keyword hits are confined to the stated domain when one is known.
 */
const ARCH_RULES = [
  [/stop_reason|agentic loop|tool_use.{0,20}end_turn|loop (termination|until)/i, '1.1'],
  [/coordinator|hub-and-spoke|multi-?agent|orchestrat/i, '1.2'],
  [/\btask tool\b|subagent|allowedTools|spawn|parallel (task|subagent)/i, '1.3'],
  [/handoff|prerequisite|programmatic enforcement|workflow enforcement|escalation summary/i, '1.4'],
  [/posttooluse|pretooluse|agent sdk hook|normaliz|intercept/i, '1.5'],
  [/decompos|prompt chaining|dynamic decomposition|adaptive/i, '1.6'],
  [/--resume|fork_session|session (state|resum|fork)|named session/i, '1.7'],
  [/tool description|tool interface|overlapping tools|tool names?\b/i, '2.1'],
  [/isError|error category|retryable|structured error|access failure|empty result/i, '2.2'],
  [/tool_choice|forced tool|too many tools|scoped (tool|access)|distribut/i, '2.3'],
  [/\.mcp\.json|\bmcp\b|mcp resource|env(ironment)? variable expansion/i, '2.4'],
  [/\bgrep\b|\bglob\b|\bedit\b tool|\bread\b tool|built-?in tool/i, '2.5'],
  [/claude\.md|@import|\.claude\/rules|user-level|project-level|\/memory/i, '3.1'],
  [/slash command|\.claude\/commands|skill\.md|context: ?fork|allowed-tools|argument-hint/i, '3.2'],
  [/paths:|glob pattern|path-specific|conditional (rule|convention)/i, '3.3'],
  [/plan mode|direct execution|monolithic|architectur(al|e) decision/i, '3.4'],
  [/iterative refinement|test-driven|interview pattern|input[- ]output example/i, '3.5'],
  [/ci\/cd|\bci\b|-p flag|--print|output-format|json-schema|non-interactive|pipeline/i, '3.6'],
  [/explicit criteria|false positive|severity criteria|precision/i, '4.1'],
  [/few-?shot|worked example|ambiguous case/i, '4.2'],
  [/tool_use.{0,30}schema|json schema|structured output|nullable|enum|required field/i, '4.3'],
  [/validation|retry|semantic error|schema error|feedback loop|pydantic/i, '4.4'],
  [/batch|custom_id|sla|24-hour|50%/i, '4.5'],
  [/multi-pass|independent (review|instance)|self-review|per-file|cross-file/i, '4.6'],
  [/context window|progressive summar|lost in the middle|case facts|trim|tool output (size|bloat)/i, '5.1'],
  [/escalat|ambiguity|clarif|customer (request|asks)|policy gap/i, '5.2'],
  [/error propagation|partial result|coverage annotation|local recovery|timeout/i, '5.3'],
  [/scratchpad|exploration|context degradation|crash recovery|manifest|\/compact/i, '5.4'],
  [/human review|confidence|calibrat|stratified|sampling|accuracy by (segment|type)/i, '5.5'],
  [/provenance|claim-source|citation|conflicting (source|stat)|publication date|attribution/i, '5.6'],
];

const ARCH_DOMAIN_BY_NAME = Object.fromEntries(ARCH_BLUEPRINT.map((d) => [d.name.toLowerCase(), d.id]));

export function mapArchitectQuestion({ domainName, text = '' }) {
  const domainId = ARCH_DOMAIN_BY_NAME[String(domainName ?? '').trim().toLowerCase()] ?? null;
  const ranked = ARCH_RULES.filter(([re]) => re.test(text)).map(([, id]) => id);
  if (domainId) {
    const inDomain = ARCH_BLUEPRINT.find((d) => d.id === domainId).subskills.map((s) => s.id);
    const hit = ranked.find((id) => inDomain.includes(id));
    if (hit) return { subskillId: hit, domainId, confidence: 'high' };
    return { subskillId: inDomain[0], domainId, confidence: 'domain-only' };
  }
  const loose = ranked[0] ?? null;
  return { subskillId: loose, domainId: loose ? loose.split('.')[0].replace(/^/, 'D') : null, confidence: loose ? 'low' : 'none' };
}
