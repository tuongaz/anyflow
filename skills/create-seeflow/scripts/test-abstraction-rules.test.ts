/**
 * Contract tests for the `seeflow-node-planner` sub-agent's abstraction rules.
 *
 * Fixtures live in `./abstraction-rule-fixtures.ts` (a non-test module) so a
 * future LLM-eval harness can import them. This file asserts the contract
 * itself stays well-formed: every fixture has a valid brief, the expected
 * outcome is internally consistent, and the rule semantics (collapse vs.
 * exception) are honoured. No LLM is invoked.
 *
 * When the planner sub-agent prompt or this contract drifts, fixtures or
 * assertions update together — the failing test pinpoints which side moved.
 */
import { describe, expect, it } from 'bun:test';
import { abstractionRuleFixtures } from './abstraction-rule-fixtures';

const KEBAB_CASE = /^[a-z][a-z0-9-]*$/;

describe('abstraction-rule fixtures (planner contract)', () => {
  it('exports at least three fixtures', () => {
    expect(abstractionRuleFixtures.length).toBeGreaterThanOrEqual(3);
  });

  it('covers every documented collapse rule and every exception', () => {
    const rules = new Set(abstractionRuleFixtures.map((f) => f.rule));
    expect(rules.has('collapse-temporal-workflow')).toBe(true);
    expect(rules.has('collapse-microservice-routes')).toBe(true);
    expect(rules.has('exception-1-independently-meaningful-pipeline')).toBe(true);
    expect(rules.has('exception-2-fan-out-distinct-consumers')).toBe(true);
    expect(rules.has('exception-3-choice-branch')).toBe(true);
  });

  it.each(abstractionRuleFixtures)('$name: brief is well-formed', (fixture) => {
    const { contextBrief } = fixture;
    expect(contextBrief.userIntent.length).toBeGreaterThan(0);
    expect(contextBrief.audienceFraming.length).toBeGreaterThan(0);
    expect(contextBrief.scope.rootEntities.length).toBeGreaterThan(0);
    expect(contextBrief.codePointers.length).toBeGreaterThan(0);
    for (const ptr of contextBrief.codePointers) {
      expect(ptr.path.length).toBeGreaterThan(0);
      expect(ptr.why.length).toBeGreaterThan(0);
    }
  });

  it.each(abstractionRuleFixtures)(
    '$name: expected node names are unique and non-empty',
    (fixture) => {
      const { nodeNames } = fixture.expected;
      expect(nodeNames.length).toBe(fixture.expected.nodeCount);
      expect(nodeNames.length).toBeGreaterThanOrEqual(1);
      expect(new Set(nodeNames).size).toBe(nodeNames.length);
      for (const name of nodeNames) {
        expect(name.length).toBeGreaterThan(0);
      }
    },
  );

  it.each(abstractionRuleFixtures)('$name: triggerNodeName appears in nodeNames', (fixture) => {
    expect(fixture.expected.nodeNames).toContain(fixture.expected.triggerNodeName);
  });

  it.each(abstractionRuleFixtures)(
    '$name: no expected node name overlaps with outOfScope',
    (fixture) => {
      const outOfScopeLower = fixture.contextBrief.scope.outOfScope.map((s) => s.toLowerCase());
      for (const name of fixture.expected.nodeNames) {
        expect(outOfScopeLower).not.toContain(name.toLowerCase());
      }
    },
  );

  it.each(abstractionRuleFixtures)('$name: rationaleNotes is documented', (fixture) => {
    expect(fixture.expected.rationaleNotes.length).toBeGreaterThan(20);
  });
});

/**
 * Sanity-check the abstraction-rule outcomes themselves. Collapse rules must
 * shrink (or hold) the count of rootEntities; exception rules must produce at
 * least 2 nodes. Catches a future edit that accidentally lets a "12 routes →
 * 12 nodes" fixture slip in.
 */
describe('abstraction-rule fixtures: rule semantics', () => {
  it.each(abstractionRuleFixtures.filter((f) => f.rule.startsWith('collapse-')))(
    'collapse rule: $name -> expected nodeCount <= rootEntities.length',
    (fixture) => {
      expect(fixture.expected.nodeCount).toBeLessThanOrEqual(
        fixture.contextBrief.scope.rootEntities.length,
      );
    },
  );

  it.each(abstractionRuleFixtures.filter((f) => f.rule.startsWith('exception-')))(
    'exception rule: $name -> expected nodeCount >= 2',
    (fixture) => {
      expect(fixture.expected.nodeCount).toBeGreaterThanOrEqual(2);
    },
  );
});

/**
 * Export-shape smoke: each fixture has a non-empty unique name and a trigger
 * that can be slug-derived without producing an empty / non-kebab string. The
 * future LLM eval harness will rely on `slug` derivability when wiring to a
 * real planner response.
 */
describe('abstraction-rule fixtures: export shape', () => {
  it('fixture names are unique', () => {
    const names = abstractionRuleFixtures.map((f) => f.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it('slug-shape (derived) is kebab-case-friendly', () => {
    for (const fixture of abstractionRuleFixtures) {
      const slug = fixture.expected.triggerNodeName
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/(^-|-$)/g, '');
      expect(slug).toMatch(KEBAB_CASE);
    }
  });
});
