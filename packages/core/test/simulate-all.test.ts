/**
 * PR 8: scenarios, sweeps, limits, simulateAll cartesian product.
 *
 * `simulate()` is now scenario-aware and limit-aware; `simulateAll()`
 * enumerates (Base ∪ scenarios) × cartesian-product(sweeps) and labels
 * each variation deterministically.
 */

import { describe, expect, it } from 'vitest';

import { build } from '../src/api/build.js';
import { simulate, simulateAll } from '../src/runtime/simulate.js';

// ────────────────────────────────────────────────────────────────────────────
// Scenarios

describe('scenarios — constant overrides', () => {
  const src = [
    'StartTime = 0',
    'EndTime = 1',
    'TimeStep = 1',
    'constant Rate = 0.1',
    'stock X = 100',
    'flow F:',
    '    X * Rate -+> X',
    'scenario Fast:',
    '    constant Rate = 0.5',
    '',
  ].join('\n');

  it('Base case uses the default Rate', () => {
    const { program } = build(src);
    const r = simulate(program);
    // dx/dt = 0.1 * 100 = 10; after RK4 step from 100 with dt=1: ~110.5...
    // We only care that the answer differs from the Fast scenario.
    expect(r.stocks.X![1]).toBeGreaterThan(110);
    expect(r.stocks.X![1]).toBeLessThan(111);
  });

  it('Fast scenario applies Rate=0.5 — visibly faster growth', () => {
    const { program } = build(src);
    const r = simulate(program, { scenarioName: 'Fast' });
    // dx/dt = 0.5 * 100 = 50; ends near 165 after dt=1 (RK4).
    expect(r.stocks.X![1]).toBeGreaterThan(160);
  });

  it('emits SD0082 on an unknown scenario name', () => {
    const { program } = build(src);
    const r = simulate(program, { scenarioName: 'Nope' });
    expect(r.diagnostics.some((d) => d.code === 'SD0082')).toBe(true);
  });
});

describe('scenarios — stock overrides', () => {
  it('stock override takes effect at t=0', () => {
    const src = [
      'StartTime = 0',
      'EndTime = 0',
      'TimeStep = 1',
      'stock X = 1',
      'scenario Big:',
      '    stock X = 999',
      '',
    ].join('\n');
    const { program } = build(src);
    const r = simulate(program, { scenarioName: 'Big' });
    expect(r.stocks.X![0]).toBe(999);
  });
});

describe('scenarios — order of application', () => {
  it('per-call overrides apply BEFORE scenario constant overrides', () => {
    // The plan: (1) sweep / per-call overrides → (2) scenario constants → (3) scenario stocks.
    // So if both override the same constant, the scenario wins.
    const src = [
      'StartTime = 0',
      'EndTime = 0',
      'TimeStep = 1',
      'constant Rate = 1',
      'stock X = Rate',
      'scenario Big:',
      '    constant Rate = 100',
      '',
    ].join('\n');
    const { program } = build(src);
    const r = simulate(program, {
      scenarioName: 'Big',
      overrides: { Rate: 5 }, // per-call override → 5
    });
    // Scenario wins over per-call override → Rate = 100; stock X.init = Rate → 100.
    expect(r.stocks.X![0]).toBe(100);
  });

  it('scenario constant override is visible to stock init expressions', () => {
    const src = [
      'StartTime = 0',
      'EndTime = 0',
      'TimeStep = 1',
      'constant Rate = 1',
      'stock X = Rate * 10',
      'scenario Big:',
      '    constant Rate = 5',
      '',
    ].join('\n');
    const { program } = build(src);
    const r = simulate(program, { scenarioName: 'Big' });
    // Constant override applies before stock init → X starts at 5*10=50.
    expect(r.stocks.X![0]).toBe(50);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// Limits

describe('limits — post-step clamping', () => {
  it('clamps a stock that would otherwise drop below the floor', () => {
    const src = [
      'StartTime = 0',
      'EndTime = 5',
      'TimeStep = 1',
      'stock X = 10',
      'flow Drain:',
      '    100 --> X',         // -100/step would normally drive X to -390
      'limit X min = 0',
      '',
    ].join('\n');
    const { program } = build(src);
    const r = simulate(program);
    for (let i = 0; i < r.time.length; i++) {
      expect(r.stocks.X![i]).toBeGreaterThanOrEqual(0);
    }
    // Final value must be at the floor (limit).
    expect(r.stocks.X![r.time.length - 1]).toBe(0);
  });

  it('clamps a stock that would otherwise overshoot the ceiling', () => {
    const src = [
      'StartTime = 0',
      'EndTime = 5',
      'TimeStep = 1',
      'stock X = 10',
      'flow Grow:',
      '    100 -+> X',
      'limit X max = 50',
      '',
    ].join('\n');
    const { program } = build(src);
    const r = simulate(program);
    for (let i = 0; i < r.time.length; i++) {
      expect(r.stocks.X![i]).toBeLessThanOrEqual(50);
    }
    expect(r.stocks.X![r.time.length - 1]).toBe(50);
  });

  it('applies both min and max limits', () => {
    const src = [
      'StartTime = 0',
      'EndTime = 1',
      'TimeStep = 1',
      'stock X = 50',
      'flow Drain:',
      '    100 --> X',
      'limit X min = 10 max = 90',
      '',
    ].join('\n');
    const { program } = build(src);
    const r = simulate(program);
    expect(r.stocks.X![1]).toBeGreaterThanOrEqual(10);
    expect(r.stocks.X![1]).toBeLessThanOrEqual(90);
  });

  it('does not clamp a stock without a limit', () => {
    const src = [
      'StartTime = 0',
      'EndTime = 1',
      'TimeStep = 1',
      'stock X = 1',
      'stock Y = 1',
      'flow F1:',
      '    100 -+> X',
      'flow F2:',
      '    100 -+> Y',
      'limit X max = 5',
      '',
    ].join('\n');
    const { program } = build(src);
    const r = simulate(program);
    expect(r.stocks.X![1]).toBeLessThanOrEqual(5);
    expect(r.stocks.Y![1]).toBeGreaterThan(50); // unbounded
  });
});

// ────────────────────────────────────────────────────────────────────────────
// simulateAll

describe('simulateAll — scenarios × sweeps cartesian product', () => {
  it('runs Base only when no scenarios and no sweeps are declared', () => {
    const { program } = build('stock X = 1\n');
    const v = simulateAll(program);
    expect(v).toHaveLength(1);
    expect(v[0]!.scenarioName).toBeNull();
    expect(v[0]!.label).toBe('Base (Base)');
  });

  it('enumerates each scenario plus the implicit Base', () => {
    const src = [
      'stock X = 1',
      'scenario A:',
      '    stock X = 10',
      'scenario B:',
      '    stock X = 100',
      '',
    ].join('\n');
    const { program } = build(src);
    const v = simulateAll(program);
    expect(v).toHaveLength(3);
    expect(v.map((r) => r.scenarioName)).toEqual([null, 'A', 'B']);
    expect(v[0]!.result.stocks.X![0]).toBe(1);
    expect(v[1]!.result.stocks.X![0]).toBe(10);
    expect(v[2]!.result.stocks.X![0]).toBe(100);
  });

  it('expands sweeps into multiple variations', () => {
    const src = [
      'constant K = 1',
      'stock X = K',
      'sweep K = [1, 2, 3]',
      '',
    ].join('\n');
    const { program } = build(src);
    const v = simulateAll(program);
    // Base × 3 sweep values → 3 variations.
    expect(v).toHaveLength(3);
    expect(v.map((r) => r.sweepValues.K)).toEqual([1, 2, 3]);
    expect(v.map((r) => r.result.stocks.X![0])).toEqual([1, 2, 3]);
  });

  it('builds a full cartesian product across sweeps and scenarios', () => {
    const src = [
      'constant A = 0',
      'constant B = 0',
      'stock X = A + B',
      'sweep A = [1, 2]',
      'sweep B = [10, 20]',
      'scenario Hi:',
      '    stock X = 999',
      '',
    ].join('\n');
    const { program } = build(src);
    const v = simulateAll(program);
    // (Base, Hi) × (A in {1,2}) × (B in {10,20}) = 8 variations.
    expect(v).toHaveLength(8);
    // Exactly one variation per (scenario, A, B).
    const seen = new Set<string>();
    for (const r of v) {
      const key = `${r.scenarioName}|${r.sweepValues.A}|${r.sweepValues.B}`;
      expect(seen.has(key)).toBe(false);
      seen.add(key);
    }
  });

  it('caps total variations at maxVariations and emits SD0083', () => {
    const src = [
      'constant K = 1',
      'stock X = K',
      'sweep K = [1, 2, 3, 4, 5, 6, 7, 8]',
      '',
    ].join('\n');
    const { program } = build(src);
    const v = simulateAll(program, { maxVariations: 3 });
    expect(v).toHaveLength(3);
    for (const r of v) {
      expect(r.result.diagnostics.some((d) => d.code === 'SD0083')).toBe(true);
    }
  });

  it('produces deterministic, human-readable labels', () => {
    const src = [
      'constant K = 1',
      'stock X = K',
      'sweep K = [1, 2]',
      'scenario Hi:',
      '    constant K = 100',
      '',
    ].join('\n');
    const { program } = build(src);
    const v = simulateAll(program);
    // Order: (Base, Hi) × (1, 2). Labels include both scenario and sweep values.
    expect(v.map((r) => r.label)).toEqual([
      'Base (K=1)',
      'Base (K=2)',
      'Hi (K=1)',
      'Hi (K=2)',
    ]);
  });
});
