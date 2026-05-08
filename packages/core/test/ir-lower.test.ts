/**
 * AST → IR lowering: ops shape, slot indices, error codes.
 */

import { describe, expect, it } from 'vitest';

import { build } from '../src/api/build.js';

describe('lower — Refs and built-ins', () => {
  it('lowers literal expressions to PushNum', () => {
    const { program, diagnostics } = build('constant K = 42\n');
    expect(diagnostics).toEqual([]);
    const k = program.constants.find((c) => c.fqn === 'K')!;
    expect(k.expr.ops).toEqual([{ kind: 'PushNum', value: 42 }]);
  });

  it('lowers a constant ref to LoadConstant', () => {
    const { program, diagnostics } = build('constant A = 1\nconstant B = A + 1\n');
    expect(diagnostics).toEqual([]);
    const b = program.constants.find((c) => c.fqn === 'B')!;
    expect(b.expr.ops[0]).toEqual({ kind: 'LoadConstant', slot: 0 });
  });

  it('lowers a stock ref inside a calc to LoadStock', () => {
    const { program, diagnostics } = build('stock S = 0\ncalc D = S * 2\n');
    expect(diagnostics).toEqual([]);
    const d = program.calcs.find((c) => c.fqn === 'D')!;
    expect(d.expr.ops[0]).toEqual({ kind: 'LoadStock', slot: 0 });
  });

  it('lowers `time` ref to LoadTime', () => {
    const { program, diagnostics } = build('calc T = time * 2\n');
    expect(diagnostics).toEqual([]);
    const t = program.calcs.find((c) => c.fqn === 'T')!;
    expect(t.expr.ops[0]).toEqual({ kind: 'LoadTime' });
  });

  it('lowers a built-in call to CallBuiltin', () => {
    const { program, diagnostics } = build('calc Y = sqrt(2)\n');
    expect(diagnostics).toEqual([]);
    const y = program.calcs.find((c) => c.fqn === 'Y')!;
    const last = y.expr.ops[y.expr.ops.length - 1]!;
    expect(last).toEqual({ kind: 'CallBuiltin', name: 'sqrt', argc: 1 });
  });

  it('emits SD0060 on builtin arity mismatch', () => {
    const { diagnostics } = build('calc Y = sqrt(1, 2)\n');
    expect(diagnostics.some((d) => d.code === 'SD0060')).toBe(true);
  });

  it('does not surface SD0061 on smooth — PR 6 desugars it before lowering', () => {
    const { diagnostics } = build('calc Y = smooth(1, 2)\n');
    // The pre-resolve desugar pass replaces smooth(input, tau) with a synthetic
    // stock + flow before resolve runs, so by the time we lower no CallBuiltin
    // for smooth survives.
    expect(diagnostics.some((d) => d.code === 'SD0061')).toBe(false);
    expect(diagnostics).toEqual([]);
  });

  it('emits SD0062 when a builtin is referenced as a value', () => {
    const { diagnostics } = build('calc Y = sin\n');
    // `sin` is a builtin — must be called.
    expect(diagnostics.some((d) => d.code === 'SD0062')).toBe(true);
  });
});

describe('lower — maps', () => {
  const mapSrc = [
    'map MyMap: linear',
    '    (0, 0)',
    '    (1, 10)',
    '    (2, 30)',
    'calc Y = MyMap(0.5)',
    '',
  ].join('\n');

  it('lowers MapName(x) to MapLookup', () => {
    const { program, diagnostics } = build(mapSrc);
    expect(diagnostics).toEqual([]);
    const y = program.calcs.find((c) => c.fqn === 'Y')!;
    const last = y.expr.ops[y.expr.ops.length - 1]!;
    expect(last.kind).toBe('MapLookup');
    if (last.kind === 'MapLookup') {
      expect(last.mapIndex).toBe(0);
    }
  });

  it('builds a MapData with the correct interpolation tag', () => {
    const { program } = build(mapSrc);
    expect(program.maps).toHaveLength(1);
    const m = program.maps[0]!;
    expect(m.fqn).toBe('MyMap');
    expect(m.interpolation).toBe('linear');
    expect(Array.from(m.xs)).toEqual([0, 1, 2]);
    expect(Array.from(m.ys)).toEqual([0, 10, 30]);
  });

  it('precomputes y2 for spline maps', () => {
    const src = [
      'map S: spline',
      '    (0, 0)',
      '    (1, 1)',
      '    (2, 4)',
      '    (3, 9)',
      'calc Y = S(1.5)',
      '',
    ].join('\n');
    const { program } = build(src);
    expect(program.maps[0]!.y2).toBeDefined();
    expect(program.maps[0]!.y2!.length).toBe(4);
  });

  it('emits SD0060 on map called with wrong arg count', () => {
    const src = [
      'map M: linear',
      '    (0, 0)',
      '    (1, 1)',
      'calc Y = M(0.5, 0.5)',
      '',
    ].join('\n');
    const { diagnostics } = build(src);
    expect(diagnostics.some((d) => d.code === 'SD0060')).toBe(true);
  });
});

describe('lower — maxStack', () => {
  it('records stack depth needed for a deeply nested expression', () => {
    const { program } = build('calc Y = (1 + 2) * (3 + 4)\n');
    const y = program.calcs.find((c) => c.fqn === 'Y')!;
    expect(y.expr.maxStack).toBeGreaterThanOrEqual(2);
  });

  it('records depth of a multi-arg builtin call', () => {
    const { program } = build('calc Y = max(min(1, 2), max(3, 4))\n');
    const y = program.calcs.find((c) => c.fqn === 'Y')!;
    expect(y.expr.maxStack).toBeGreaterThanOrEqual(2);
  });
});
