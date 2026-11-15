import test from 'node:test';
import assert from 'node:assert/strict';
import { EXAMS, ARCH_BLUEPRINT, ARCH_SUBSKILLS, subskill, examOfAttempt, mapArchitectQuestion } from './lib/blueprint.mjs';

test('CCAR-F blueprint: 5 domains, 30 task statements, weights sum to 100', () => {
  assert.equal(ARCH_BLUEPRINT.length, 5);
  assert.equal(ARCH_SUBSKILLS.length, 30);
  const total = ARCH_BLUEPRINT.reduce((s, d) => s + d.weight, 0);
  assert.equal(total, 100);
  for (const d of ARCH_BLUEPRINT) {
    const sum = d.subskills.reduce((s, x) => s + x.weight, 0);
    assert.ok(Math.abs(sum - d.weight) < 0.1, `${d.id} task weights sum to the domain weight`);
  }
});

test('sub-skill ids are scoped by exam, not global', () => {
  assert.equal(subskill('1.1', 'CCDV-F').name, 'Agent Architecture');
  assert.equal(subskill('1.1', 'CCAR-F').name, 'Agentic Loops');
  assert.deepEqual(Object.keys(EXAMS), ['CCDV-F', 'CCAR-F']);
});

test('an attempt counts toward its targetExam; mapped Architect mocks stay on CCDV-F', () => {
  assert.equal(examOfAttempt({ targetExam: 'CCAR-F' }), 'CCAR-F');
  assert.equal(examOfAttempt({ examCode: 'CCAR-F', targetExam: 'CCDV-F', mapped: true }), 'CCDV-F');
  assert.equal(examOfAttempt({}), 'CCDV-F');
});

test('architect fallback classifier stays inside the stated domain', () => {
  const m = mapArchitectQuestion({ domainName: 'Tool Design & MCP Integration', text: 'set tool_choice to force a specific tool' });
  assert.equal(m.subskillId, '2.3');
  assert.equal(m.domainId, 'D2');
  assert.equal(mapArchitectQuestion({ text: 'unrelated cooking question' }).subskillId, null);
});
