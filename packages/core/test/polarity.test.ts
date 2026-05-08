/**
 * Polarity inference tests.
 *
 * Verifies that `inferPolarities` produces the expected polarity per source
 * variable for a representative set of expressions.
 */

import { describe, expect, it } from 'vitest';

import { parse } from '../src/api/parse.js';
import { inferPolarities, type Polarity } from '../src/semantic/polarity.js';
import { resolve } from '../src/semantic/resolver.js';
import type { CalcStmt } from '../src/syntax/ast.js';

/**
 * Helper: define a constant `K` and a stock `A` and `B`, then a calc whose RHS
 * is the expression we want to test. Returns the polarity per source name.
 */
function polaritiesOf(rhs: string): Map<string, Polarity> {
  const src = [
    'constant K = 2',
    'constant Neg = -3',
    'stock A = 0',
    'stock B = 0',
    `calc Target = ${rhs}`,
    '',
  ].join('\n');
  const { ast, diagnostics: parseDiags } = parse(src);
  expect(parseDiags).toEqual([]);
  const r = resolve(ast);
  expect(r.diagnostics).toEqual([]);
  const target = ast.body.find(
    (s) => s.kind === 'Calc' && (s as CalcStmt).name === 'Target',
  ) as CalcStmt;
  const map = inferPolarities(target.expr, r.resolvedRefs);
  // Convert id -> name for assertion convenience
  const result = new Map<string, Polarity>();
  for (const [id, p] of map) {
    const sym = r.table.byId(id)!;
    result.set(sym.fqn, p);
  }
  return result;
}

describe('polarity — basic rules', () => {
  it('Ref(x) → +', () => {
    expect(polaritiesOf('A')).toEqual(new Map([['A', '+']]));
  });

  it('Unary(-, x) → -', () => {
    expect(polaritiesOf('-A')).toEqual(new Map([['A', '-']]));
  });

  it('a + b → both +', () => {
    const p = polaritiesOf('A + B');
    expect(p.get('A')).toBe('+');
    expect(p.get('B')).toBe('+');
  });

  it('a - b → +/-', () => {
    const p = polaritiesOf('A - B');
    expect(p.get('A')).toBe('+');
    expect(p.get('B')).toBe('-');
  });
});

describe('polarity — multiplication and division by literal', () => {
  it('positive literal * variable → +', () => {
    const p = polaritiesOf('2 * A');
    expect(p.get('A')).toBe('+');
  });

  it('negative literal * variable → -', () => {
    const p = polaritiesOf('-3 * A');
    expect(p.get('A')).toBe('-');
  });

  it('variable / positive literal → +', () => {
    const p = polaritiesOf('A / 2');
    expect(p.get('A')).toBe('+');
  });

  it('positive literal / variable → - (variable in denominator flips)', () => {
    const p = polaritiesOf('2 / A');
    expect(p.get('A')).toBe('-');
  });

  it('two non-constant operands → ?', () => {
    const p = polaritiesOf('A * B');
    expect(p.get('A')).toBe('?');
    expect(p.get('B')).toBe('?');
  });

  // TODO PR 5: when the IR pipeline evaluates constants, polarity should also
  // accept Refs to compile-time-resolvable constants. Until then, K*A returns ?.
  it('Ref-to-constant * variable currently degrades to ? (refined in PR 5)', () => {
    const p = polaritiesOf('K * A');
    expect(p.get('A')).toBe('?');
  });
});

describe('polarity — function calls', () => {
  it('exp(x) is monotone increasing → +', () => {
    expect(polaritiesOf('exp(A)').get('A')).toBe('+');
  });

  it('sqrt(x) is monotone increasing → +', () => {
    expect(polaritiesOf('sqrt(A)').get('A')).toBe('+');
  });

  it('min(a, b) → ? (we do not track piecewise behavior)', () => {
    const p = polaritiesOf('min(A, B)');
    expect(p.get('A')).toBe('?');
    expect(p.get('B')).toBe('?');
  });

  it('exp(-A) → -', () => {
    expect(polaritiesOf('exp(-A)').get('A')).toBe('-');
  });
});

describe('polarity — conflict resolution', () => {
  it('a appearing with both + and - polarity merges to ?', () => {
    // A * K + Neg * A = some_const * A but we don't constant-fold;
    // however A appears once with + and once with -. Expected: ?.
    const p = polaritiesOf('K * A + Neg * A');
    expect(p.get('A')).toBe('?');
  });

  it('a appearing twice with same polarity stays +', () => {
    const p = polaritiesOf('A + 2 * A');
    expect(p.get('A')).toBe('+');
  });
});
