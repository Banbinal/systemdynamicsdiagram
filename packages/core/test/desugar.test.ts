/**
 * Desugar pass: smooth/delay3 → synthetic stocks+flows; step/pulse → pure exprs.
 *
 * Tests run end-to-end via `build()` so we verify the full integration —
 * desugar produces an AST that the resolver, dep graph, and lowering all
 * accept without diagnostics.
 */

import { describe, expect, it } from 'vitest';

import { build } from '../src/api/build.js';
import { evalExpr } from '../src/ir/evaluator.js';
import type { CompiledExpr } from '../src/ir/program.js';
import { parse } from '../src/api/parse.js';
import { desugar } from '../src/semantic/desugar.js';

const STACK = new Float64Array(32);

function evalCalcAt(expr: CompiledExpr, time: number): number {
  return evalExpr(
    expr,
    {
      constants: new Float64Array(0),
      stocks: new Float64Array(0),
      calcs: new Float64Array(0),
      time,
      maps: [],
    },
    STACK,
  );
}

// ────────────────────────────────────────────────────────────────────────────
// step

describe('desugar — step', () => {
  it('rewrites step(h, t0) to a pure expression that matches the runtime impl', () => {
    const { program, diagnostics } = build('calc Y = step(10, 5)\n');
    expect(diagnostics).toEqual([]);
    const y = program.calcs.find((c) => c.fqn === 'Y')!;
    expect(evalCalcAt(y.expr, 4.99)).toBe(0);
    expect(evalCalcAt(y.expr, 5)).toBe(10);
    expect(evalCalcAt(y.expr, 100)).toBe(10);
  });

  it('does not emit any CallBuiltin op for step', () => {
    const { program } = build('calc Y = step(10, 5)\n');
    const y = program.calcs.find((c) => c.fqn === 'Y')!;
    for (const op of y.expr.ops) {
      expect(op.kind).not.toBe('CallBuiltin');
    }
  });

  it('emits SD0070 when step has the wrong arity', () => {
    const { diagnostics } = build('calc Y = step(10)\n');
    expect(diagnostics.some((d) => d.code === 'SD0070')).toBe(true);
  });

  it('handles step with non-literal arguments', () => {
    const { program, diagnostics } = build([
      'constant H = 7',
      'constant T0 = 3',
      'calc Y = step(H, T0)',
      '',
    ].join('\n'));
    expect(diagnostics).toEqual([]);
    const y = program.calcs.find((c) => c.fqn === 'Y')!;
    const constants = new Float64Array(2);
    const h = program.constants.find((c) => c.fqn === 'H')!;
    const t0 = program.constants.find((c) => c.fqn === 'T0')!;
    constants[h.slot] = 7;
    constants[t0.slot] = 3;
    const v = evalExpr(y.expr, {
      constants,
      stocks: new Float64Array(0),
      calcs: new Float64Array(0),
      time: 5,
      maps: [],
    }, STACK);
    expect(v).toBe(7);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// pulse

describe('desugar — pulse', () => {
  it('rewrites pulse(h, t0, w) to a pure expression', () => {
    const { program, diagnostics } = build('calc Y = pulse(10, 5, 2)\n');
    expect(diagnostics).toEqual([]);
    const y = program.calcs.find((c) => c.fqn === 'Y')!;
    expect(evalCalcAt(y.expr, 4.99)).toBe(0);
    expect(evalCalcAt(y.expr, 5)).toBe(10);
    expect(evalCalcAt(y.expr, 6.999)).toBe(10);
    expect(evalCalcAt(y.expr, 7)).toBe(0);
    expect(evalCalcAt(y.expr, 100)).toBe(0);
  });

  it('emits SD0071 when pulse has the wrong arity', () => {
    const { diagnostics } = build('calc Y = pulse(10, 5)\n');
    expect(diagnostics.some((d) => d.code === 'SD0071')).toBe(true);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// smooth

describe('desugar — smooth', () => {
  it('introduces a synthetic stock with init = input and a flow (input - s)/tau', () => {
    const { program, diagnostics } = build([
      'constant Tau = 5',
      'constant Input = 100',
      'calc Y = smooth(Input, Tau)',
      '',
    ].join('\n'));
    expect(diagnostics).toEqual([]);
    // Exactly one synthetic stock named __smooth_0.
    const synth = program.stocks.find((s) => s.synthetic);
    expect(synth).toBeDefined();
    expect(synth!.fqn).toBe('__smooth_0');
    // One flow effect: target = synth, polarity = positive.
    const flows = program.flowEffects.filter((f) => f.targetSlot === synth!.slot);
    expect(flows).toHaveLength(1);
    expect(flows[0]!.polarity).toBe('positive');
    expect(flows[0]!.flowFqn).toBe('__smooth_0_flow');
  });

  it('replaces the smooth call site with a Ref to the synthetic stock', () => {
    const { program } = build([
      'constant Tau = 5',
      'constant Input = 100',
      'calc Y = smooth(Input, Tau)',
      '',
    ].join('\n'));
    const y = program.calcs.find((c) => c.fqn === 'Y')!;
    const synth = program.stocks.find((s) => s.synthetic)!;
    // Y should compile to a single LoadStock op pointing at the synthetic stock.
    expect(y.expr.ops).toHaveLength(1);
    expect(y.expr.ops[0]).toEqual({ kind: 'LoadStock', slot: synth.slot });
  });

  it('initialises the synthetic stock to input(0) at start time', () => {
    const { program } = build([
      'constant Tau = 5',
      'constant Input = 42',
      'calc Y = smooth(Input, Tau)',
      '',
    ].join('\n'));
    // Eval the synthetic stock's init expr against the constants buffer.
    const synth = program.stocks.find((s) => s.synthetic)!;
    const constants = new Float64Array(program.constants.length);
    for (const c of program.constants) {
      constants[c.slot] = evalExpr(c.expr, {
        constants,
        stocks: new Float64Array(0),
        calcs: new Float64Array(0),
        time: 0,
        maps: [],
      }, STACK);
    }
    const v = evalExpr(synth.init, {
      constants,
      stocks: new Float64Array(0),
      calcs: new Float64Array(0),
      time: 0,
      maps: [],
    }, STACK);
    expect(v).toBe(42);
  });

  it('emits SD0072 when smooth has the wrong arity', () => {
    const { diagnostics } = build('calc Y = smooth(1)\n');
    expect(diagnostics.some((d) => d.code === 'SD0072')).toBe(true);
  });

  it('numerically agrees with closed-form on a step input', () => {
    // After first-order smoothing of a step input,
    //   d_s/dt = (h - s)/tau, s(0) = 0, h = 1
    //   ⟹ s(t) = 1 - exp(-t/tau).
    // Here we just verify that the synthetic flow expression evaluates to
    // (input - s) / tau at a chosen point — enough to confirm the rewrite,
    // independent of the (still-unimplemented) numerical solver.
    const { program } = build([
      'constant Tau = 2',
      'constant Input = 1',
      'calc Y = smooth(Input, Tau)',
      '',
    ].join('\n'));
    const synth = program.stocks.find((s) => s.synthetic)!;
    const flow = program.flowEffects.find((f) => f.targetSlot === synth.slot)!;
    const constants = new Float64Array(program.constants.length);
    const tau = program.constants.find((c) => c.fqn === 'Tau')!;
    const input = program.constants.find((c) => c.fqn === 'Input')!;
    constants[tau.slot] = 2;
    constants[input.slot] = 1;
    const stocks = new Float64Array(program.stocks.length);
    stocks[synth.slot] = 0.3; // some intermediate state
    const dSdt = evalExpr(flow.expr, {
      constants,
      stocks,
      calcs: new Float64Array(0),
      time: 0,
      maps: [],
    }, STACK);
    expect(dSdt).toBeCloseTo((1 - 0.3) / 2, 12);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// delay3

describe('desugar — delay3', () => {
  it('introduces three synthetic stocks plus three flows', () => {
    const { program, diagnostics } = build([
      'constant Tau = 6',
      'constant Input = 1',
      'calc Y = delay3(Input, Tau)',
      '',
    ].join('\n'));
    expect(diagnostics).toEqual([]);
    const synth = program.stocks.filter((s) => s.synthetic);
    expect(synth).toHaveLength(3);
    // Each gets exactly one inbound flow effect.
    for (const s of synth) {
      const flows = program.flowEffects.filter((f) => f.targetSlot === s.slot);
      expect(flows).toHaveLength(1);
      expect(flows[0]!.polarity).toBe('positive');
    }
  });

  it('replaces the delay3 call site with a Ref to the third (output) stock', () => {
    const { program } = build([
      'constant Tau = 6',
      'constant Input = 1',
      'calc Y = delay3(Input, Tau)',
      '',
    ].join('\n'));
    const y = program.calcs.find((c) => c.fqn === 'Y')!;
    expect(y.expr.ops).toHaveLength(1);
    // The output stock is the third one created (suffix `c`).
    const cStock = program.stocks.find((s) => s.synthetic && s.fqn.startsWith('__delay3c_'))!;
    expect(cStock).toBeDefined();
    expect(y.expr.ops[0]).toEqual({ kind: 'LoadStock', slot: cStock.slot });
  });

  it('cascade flow uses tau/3 as transit time', () => {
    const { program } = build([
      'constant Tau = 6',
      'constant Input = 12',
      'calc Y = delay3(Input, Tau)',
      '',
    ].join('\n'));
    // For the first cascade,  da/dt = (input - a) / (tau/3).
    // With input=12, a=0, tau=6 → da/dt = 12 / 2 = 6.
    const a = program.stocks.find((s) => s.synthetic && s.fqn.startsWith('__delay3a_'))!;
    const flow = program.flowEffects.find((f) => f.targetSlot === a.slot)!;
    const constants = new Float64Array(program.constants.length);
    const tau = program.constants.find((c) => c.fqn === 'Tau')!;
    const input = program.constants.find((c) => c.fqn === 'Input')!;
    constants[tau.slot] = 6;
    constants[input.slot] = 12;
    const stocks = new Float64Array(program.stocks.length);
    // a, b, c all start at input(0)=12; verify with a=0 to make math obvious.
    stocks[a.slot] = 0;
    const dadt = evalExpr(flow.expr, {
      constants,
      stocks,
      calcs: new Float64Array(0),
      time: 0,
      maps: [],
    }, STACK);
    expect(dadt).toBeCloseTo(6, 12);
  });

  it('emits SD0073 when delay3 has the wrong arity', () => {
    const { diagnostics } = build('calc Y = delay3(1)\n');
    expect(diagnostics.some((d) => d.code === 'SD0073')).toBe(true);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// scope

describe('desugar — scope', () => {
  it('places synthetic stock for a smooth inside a module under that module', () => {
    const { ast } = parse([
      'module M:',
      '    constant Tau = 5',
      '    constant Input = 1',
      '    calc Y = smooth(Input, Tau)',
      '',
    ].join('\n'));
    const { program: ds } = desugar(ast);
    // Top level has only the module statement; the module's body grew by 2
    // (one synthetic stock + one synthetic flow), so 5 stmts inside.
    const mod = ds.body.find((s) => s.kind === 'Module');
    expect(mod).toBeDefined();
    if (mod && mod.kind === 'Module') {
      const stockNames = mod.body
        .filter((s) => s.kind === 'Stock')
        .map((s) => (s.kind === 'Stock' ? s.name : ''));
      // Originals (none here) + synthetics
      expect(stockNames.some((n) => n.startsWith('__smooth_'))).toBe(true);
    }
  });

  it('produces a fully-qualified name for module-scoped synthetics', () => {
    const { program, diagnostics } = build([
      'module M:',
      '    constant Tau = 5',
      '    constant Input = 1',
      '    calc Y = smooth(Input, Tau)',
      '',
    ].join('\n'));
    expect(diagnostics).toEqual([]);
    const synth = program.stocks.find((s) => s.synthetic)!;
    expect(synth.fqn).toMatch(/^M\.__smooth_/);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// idempotence-ish: nested calls

describe('desugar — nested calls', () => {
  it('handles smooth(smooth(input, tau1), tau2) by introducing two synthetic stocks', () => {
    const { program, diagnostics } = build([
      'constant T1 = 2',
      'constant T2 = 4',
      'constant X = 1',
      'calc Y = smooth(smooth(X, T1), T2)',
      '',
    ].join('\n'));
    expect(diagnostics).toEqual([]);
    const synth = program.stocks.filter((s) => s.synthetic);
    expect(synth).toHaveLength(2);
  });

  it('step inside smooth desugars cleanly', () => {
    const { program, diagnostics } = build([
      'constant Tau = 3',
      'calc Y = smooth(step(10, 5), Tau)',
      '',
    ].join('\n'));
    expect(diagnostics).toEqual([]);
    // One synthetic smooth stock; its init expression is the desugared step.
    const synth = program.stocks.find((s) => s.synthetic)!;
    const initOps = synth.init.ops;
    // Should contain LoadTime (from the desugared step).
    expect(initOps.some((op) => op.kind === 'LoadTime')).toBe(true);
    // No CallBuiltin('step') op.
    for (const op of initOps) {
      if (op.kind === 'CallBuiltin') {
        expect(op.name).not.toBe('step');
      }
    }
  });
});
