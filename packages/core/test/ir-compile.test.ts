/**
 * Full compile pipeline: parse → resolve → topo → lower → assemble.
 *
 * These exercise the assembly step (slots, scenarios, sweeps, limits, plots,
 * influences) and double-check end-to-end correctness on small but
 * representative programs.
 */

import { describe, expect, it } from 'vitest';

import { build } from '../src/api/build.js';
import { evalExpr } from '../src/ir/evaluator.js';

const STACK = new Float64Array(32);

describe('compile — slot assignment', () => {
  it('assigns dense indices to constants in topo order', () => {
    const { program } = build('constant A = 1\nconstant B = A + 1\nconstant C = B + 1\n');
    // A must be slot 0 (no deps), then B, then C.
    const a = program.constants.find((c) => c.fqn === 'A')!;
    const b = program.constants.find((c) => c.fqn === 'B')!;
    const c = program.constants.find((c) => c.fqn === 'C')!;
    expect(a.slot).toBe(0);
    expect(b.slot).toBe(1);
    expect(c.slot).toBe(2);
  });

  it('assigns dense indices to stocks in declaration order', () => {
    const { program } = build('stock A = 0\nstock B = 0\nstock C = 0\n');
    expect(program.stocks.map((s) => s.slot)).toEqual([0, 1, 2]);
    expect(program.stocks.map((s) => s.fqn)).toEqual(['A', 'B', 'C']);
  });

  it('assigns calc slots in topo order', () => {
    const { program } = build('calc B = A * 2\ncalc A = 1\ncalc C = A + B\n');
    const order = program.calcs.map((c) => c.fqn);
    // A must come before B (B depends on A); C must come last.
    expect(order.indexOf('A')).toBeLessThan(order.indexOf('B'));
    expect(order.indexOf('B')).toBeLessThan(order.indexOf('C'));
  });
});

describe('compile — scenarios, sweeps, limits, plots', () => {
  const src = [
    'constant Birth = 0.03',
    'constant Death = 0.01',
    'stock Population = 1000',
    'flow Births:',
    '    Population * Birth -+> Population',
    'flow Deaths:',
    '    Population * Death --> Population',
    'scenario HighBirth:',
    '    constant Birth = 0.05',
    '    stock Population = 2000',
    'sweep Birth = [0.02, 0.03, 0.04]',
    'plot Population',
    'limit Population min = 0 max = 10000',
    '',
  ].join('\n');

  it('captures a scenario with constant and stock overrides', () => {
    const { program, diagnostics } = build(src);
    expect(diagnostics).toEqual([]);
    expect(program.scenarios).toHaveLength(1);
    const sc = program.scenarios[0]!;
    expect(sc.name).toBe('HighBirth');
    expect(sc.constantOverrides).toHaveLength(1);
    expect(sc.stockOverrides).toHaveLength(1);
  });

  it('captures a sweep with three values', () => {
    const { program } = build(src);
    expect(program.sweeps).toHaveLength(1);
    const sw = program.sweeps[0]!;
    expect(sw.target).toBe('Birth');
    expect(Array.from(sw.values)).toEqual([0.02, 0.03, 0.04]);
  });

  it('captures plot targets as FQNs', () => {
    const { program } = build(src);
    expect(program.plotTargets).toEqual(['Population']);
  });

  it('captures limits with min and max', () => {
    const { program } = build(src);
    expect(program.limits).toHaveLength(1);
    const lim = program.limits[0]!;
    expect(lim.fqn).toBe('Population');
    expect(lim.min).toBe(0);
    expect(lim.max).toBe(10000);
  });

  it('records the two flow effects with their polarity and target slot', () => {
    const { program } = build(src);
    expect(program.flowEffects).toHaveLength(2);
    const popSlot = program.stocks.find((s) => s.fqn === 'Population')!.slot;
    for (const e of program.flowEffects) {
      expect(e.targetSlot).toBe(popSlot);
    }
    const polarities = program.flowEffects.map((e) => e.polarity).sort();
    expect(polarities).toEqual(['negative', 'positive']);
  });
});

describe('compile — influences from polarity', () => {
  it('produces an influence per (source, target) for each calc/flow', () => {
    const { program } = build('constant K = 2\ncalc D = K * 3\n');
    const k = program.symbols.byFqn('K')!;
    const d = program.symbols.byFqn('D')!;
    const inf = program.influences.find(
      (i) => i.source === k.id && i.target === d.id,
    );
    expect(inf).toBeDefined();
    expect(inf!.polarity).toBe('+');
  });

  it('flips the polarity sign of a negative-flow effect', () => {
    // Use a literal multiplier so polarity inference produces a definite `+`
    // for Death (rather than `?` from two non-constant operands).
    const src = [
      'constant Death = 0.01',
      'stock Pop = 100',
      'flow Deaths:',
      '    Death * 5 --> Pop',
      '',
    ].join('\n');
    const { program } = build(src);
    const death = program.symbols.byFqn('Death')!;
    const pop = program.symbols.byFqn('Pop')!;
    const inf = program.influences.find(
      (i) => i.source === death.id && i.target === pop.id,
    );
    // Polarity of (Death * 5) w.r.t. Death is `+`; the flow is `-->` (negative),
    // so the final influence flips to `-`.
    expect(inf?.polarity).toBe('-');
  });
});

describe('compile — time config and title', () => {
  it('parses time config keys', () => {
    const { program } = build('StartTime = 1\nEndTime = 50\nTimeStep = 0.5\n');
    expect(program.time.startTime).toBe(1);
    expect(program.time.endTime).toBe(50);
    expect(program.time.timeStep).toBe(0.5);
  });

  it('defaults time config when absent', () => {
    const { program } = build('# nothing\n');
    expect(program.time.startTime).toBe(0);
    expect(program.time.endTime).toBe(10);
    expect(program.time.timeStep).toBe(1);
  });

  it('captures the title', () => {
    const { program } = build('title "My Model"\n');
    expect(program.title).toBe('My Model');
  });
});

describe('compile — end-to-end evaluation', () => {
  it('compiled constant expr evaluates against a constants buffer', () => {
    const { program, diagnostics } = build('constant A = 2\nconstant B = A * 3 + 1\n');
    expect(diagnostics).toEqual([]);
    // Initialise the constants buffer manually; A first, B second per topo order.
    const buf = new Float64Array(2);
    const a = program.constants.find((c) => c.fqn === 'A')!;
    const b = program.constants.find((c) => c.fqn === 'B')!;

    buf[a.slot] = evalExpr(a.expr, {
      constants: buf,
      stocks: new Float64Array(0),
      calcs: new Float64Array(0),
      time: 0,
      maps: [],
    }, STACK);
    buf[b.slot] = evalExpr(b.expr, {
      constants: buf,
      stocks: new Float64Array(0),
      calcs: new Float64Array(0),
      time: 0,
      maps: [],
    }, STACK);

    expect(buf[a.slot]).toBe(2);
    expect(buf[b.slot]).toBe(7);
  });

  it('flow effect expression evaluates against constants + stocks', () => {
    const { program, diagnostics } = build([
      'constant Rate = 0.1',
      'stock Pop = 100',
      'flow Births:',
      '    Pop * Rate -+> Pop',
      '',
    ].join('\n'));
    expect(diagnostics).toEqual([]);

    // Initialise constants[Rate] = 0.1, stocks[Pop] = 100, then evaluate the flow.
    const constants = new Float64Array(1);
    const stocks = new Float64Array(1);
    const rate = program.constants.find((c) => c.fqn === 'Rate')!;
    const pop = program.stocks.find((s) => s.fqn === 'Pop')!;
    constants[rate.slot] = 0.1;
    stocks[pop.slot] = 100;

    const eff = program.flowEffects[0]!;
    const v = evalExpr(eff.expr, {
      constants,
      stocks,
      calcs: new Float64Array(0),
      time: 0,
      maps: [],
    }, STACK);
    expect(v).toBeCloseTo(10, 12);
  });

  it('map lookup expression interpolates against the program map', () => {
    const src = [
      'map M: linear',
      '    (0, 0)',
      '    (1, 10)',
      '    (2, 20)',
      'calc Y = M(1.5)',
      '',
    ].join('\n');
    const { program, diagnostics } = build(src);
    expect(diagnostics).toEqual([]);
    const y = program.calcs.find((c) => c.fqn === 'Y')!;
    const v = evalExpr(y.expr, {
      constants: new Float64Array(0),
      stocks: new Float64Array(0),
      calcs: new Float64Array(0),
      time: 0,
      maps: program.maps,
    }, STACK);
    expect(v).toBe(15);
  });

  it('time-aware step builtin lowers and evaluates correctly', () => {
    const { program, diagnostics } = build('calc Y = step(10, 5)\n');
    expect(diagnostics).toEqual([]);
    const y = program.calcs.find((c) => c.fqn === 'Y')!;
    const evalAt = (t: number): number =>
      evalExpr(y.expr, {
        constants: new Float64Array(0),
        stocks: new Float64Array(0),
        calcs: new Float64Array(0),
        time: t,
        maps: [],
      }, STACK);
    expect(evalAt(4)).toBe(0);
    expect(evalAt(5)).toBe(10);
    expect(evalAt(100)).toBe(10);
  });
});

describe('compile — error propagation', () => {
  it('passes through resolver diagnostics', () => {
    const { diagnostics } = build('calc X = NoSuch + 1\n');
    expect(diagnostics.some((d) => d.code === 'SD0041')).toBe(true);
  });

  it('emits SD0050 on a calc cycle', () => {
    const { diagnostics } = build('calc A = B\ncalc B = A\n');
    expect(diagnostics.some((d) => d.code === 'SD0050')).toBe(true);
  });
});
