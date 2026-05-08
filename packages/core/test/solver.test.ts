/**
 * Numerical correctness suite — the spinal column of PR 7.
 *
 * Each test compares a simulation against a known closed-form solution
 * (or invariant) on a problem that exercises a different aspect of the
 * solver: scalar growth/decay, nonlinear logistic, two-stock coupling
 * (oscillator), and a non-closed-form invariant (Lotka-Volterra).
 *
 * The order-of-convergence test is the catch-all: it runs the same problem
 * at multiple time steps, fits log-error vs log-dt, and asserts the slope
 * matches the theoretical method order. A bug that produces "approximately
 * correct" results at one dt will fail this — solver order is the strongest
 * single signal of numerical correctness.
 */

import { describe, expect, it } from 'vitest';

import { build } from '../src/api/build.js';
import { simulate } from '../src/runtime/simulate.js';

// ────────────────────────────────────────────────────────────────────────────
// Helpers

function maxAbsError(numeric: Float64Array, exact: (t: number) => number, time: Float64Array): number {
  let m = 0;
  for (let i = 0; i < time.length; i++) {
    const e = Math.abs(numeric[i]! - exact(time[i]!));
    if (e > m) m = e;
  }
  return m;
}

/**
 * Fit log(error) vs log(dt) by ordinary least squares.
 * Returns the slope (estimated convergence order).
 */
function fitOrder(dts: number[], errs: number[]): number {
  const n = dts.length;
  const x = dts.map((d) => Math.log(d));
  const y = errs.map((e) => Math.log(e));
  const xbar = x.reduce((a, b) => a + b, 0) / n;
  const ybar = y.reduce((a, b) => a + b, 0) / n;
  let num = 0;
  let den = 0;
  for (let i = 0; i < n; i++) {
    num += (x[i]! - xbar) * (y[i]! - ybar);
    den += (x[i]! - xbar) ** 2;
  }
  return num / den;
}

// ────────────────────────────────────────────────────────────────────────────
// Solver smoke

describe('solver — smoke', () => {
  it('runs RK4 on an empty program with default time config', () => {
    const { program } = build('StartTime = 0\nEndTime = 5\nTimeStep = 1\n');
    const r = simulate(program);
    expect(r.time.length).toBe(6);
    expect(Array.from(r.time)).toEqual([0, 1, 2, 3, 4, 5]);
    expect(r.diagnostics).toEqual([]);
  });

  it('records initial values at t=startTime', () => {
    const { program } = build([
      'StartTime = 0',
      'EndTime = 2',
      'TimeStep = 1',
      'stock X = 42',
      '',
    ].join('\n'));
    const r = simulate(program);
    expect(r.stocks.X![0]).toBe(42);
  });

  it('decimates output via recordEvery', () => {
    const { program } = build([
      'StartTime = 0',
      'EndTime = 10',
      'TimeStep = 1',
      '',
    ].join('\n'));
    const r = simulate(program, { recordEvery: 2 });
    // steps 0,2,4,6,8,10 → 6 points.
    expect(Array.from(r.time)).toEqual([0, 2, 4, 6, 8, 10]);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// Exponential growth: dx/dt = k·x, x(0)=x0 → x(t) = x0·exp(k·t)

describe('numerical — exponential growth', () => {
  const src = [
    'StartTime = 0',
    'EndTime = 10',
    'TimeStep = 0.01',
    'constant K = 0.1',
    'stock X = 1',
    'flow Growth:',
    '    X * K -+> X',
    '',
  ].join('\n');
  const exact = (t: number) => Math.exp(0.1 * t);

  it('RK4 reaches < 1e-9 error at dt=0.01', () => {
    const { program, diagnostics } = build(src);
    expect(diagnostics).toEqual([]);
    const r = simulate(program, { solver: 'rk4' });
    expect(maxAbsError(r.stocks.X!, exact, r.time)).toBeLessThan(1e-9);
  });

  it('Euler is much less accurate at the same dt', () => {
    const { program } = build(src);
    const r = simulate(program, { solver: 'euler' });
    const err = maxAbsError(r.stocks.X!, exact, r.time);
    // Euler with dt=0.01 over t=10 produces ~percent-level error on this problem.
    expect(err).toBeGreaterThan(1e-4);
    expect(err).toBeLessThan(0.1);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// Logistic: dx/dt = r·x·(1 - x/K) → x(t) = K / (1 + ((K-x0)/x0)·exp(-r·t))

describe('numerical — logistic growth', () => {
  it('RK4 matches the closed form to < 1e-8 at dt=0.01', () => {
    const src = [
      'StartTime = 0',
      'EndTime = 20',
      'TimeStep = 0.01',
      'constant R = 0.5',
      'constant Cap = 100',
      'stock X = 1',
      'flow Growth:',
      '    R * X * (1 - X / Cap) -+> X',
      '',
    ].join('\n');
    const { program, diagnostics } = build(src);
    expect(diagnostics).toEqual([]);
    const r = simulate(program, { solver: 'rk4' });
    const x0 = 1;
    const K = 100;
    const rate = 0.5;
    const exact = (t: number) => K / (1 + ((K - x0) / x0) * Math.exp(-rate * t));
    expect(maxAbsError(r.stocks.X!, exact, r.time)).toBeLessThan(1e-8);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// Damped harmonic oscillator: two stocks (position, velocity).
//   dx/dt = v
//   dv/dt = -ω²·x - 2ζω·v
// For ζ < 1, the closed form is an exponentially damped sinusoid.

describe('numerical — damped harmonic oscillator', () => {
  it('two coupled stocks track the analytic solution to < 1e-6', () => {
    // ω = 1, ζ = 0.1 → underdamped.
    const src = [
      'StartTime = 0',
      'EndTime = 20',
      'TimeStep = 0.01',
      'constant Omega2 = 1',           // ω²
      'constant TwoZetaOmega = 0.2',   // 2ζω
      'stock X = 1',                   // x(0) = 1
      'stock V = 0',                   // v(0) = 0
      'flow PositionFlow:',
      '    V -+> X',
      'flow VelocityFlow:',
      '    Omega2 * X + TwoZetaOmega * V --> V',
      '',
    ].join('\n');
    const { program, diagnostics } = build(src);
    expect(diagnostics).toEqual([]);
    const r = simulate(program, { solver: 'rk4' });

    // Exact solution: ω_d = ω·sqrt(1 - ζ²), x(t) = exp(-ζω t)·(cos(ω_d t) + (ζω/ω_d) sin(ω_d t))
    const omega = 1;
    const zeta = 0.1;
    const wd = omega * Math.sqrt(1 - zeta * zeta);
    const exactX = (t: number) =>
      Math.exp(-zeta * omega * t) * (Math.cos(wd * t) + ((zeta * omega) / wd) * Math.sin(wd * t));

    expect(maxAbsError(r.stocks.X!, exactX, r.time)).toBeLessThan(1e-6);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// Lotka-Volterra: no closed form. Conserved invariant V = δx − γ ln x + βy − α ln y.

describe('numerical — Lotka-Volterra', () => {
  it('preserves the conserved invariant to < 1e-3 over t∈[0,50] with RK4', () => {
    // α=1.1, β=0.4, γ=0.4, δ=0.1
    //   dx/dt =  α·x − β·x·y     (prey)
    //   dy/dt = −γ·y + δ·x·y     (predator)
    const src = [
      'StartTime = 0',
      'EndTime = 50',
      'TimeStep = 0.01',
      'constant Alpha = 1.1',
      'constant Beta = 0.4',
      'constant Gamma = 0.4',
      'constant Delta = 0.1',
      'stock Prey = 10',
      'stock Pred = 5',
      'flow PreyBirth:',
      '    Alpha * Prey -+> Prey',
      'flow PreyDeath:',
      '    Beta * Prey * Pred --> Prey',
      'flow PredDeath:',
      '    Gamma * Pred --> Pred',
      'flow PredBirth:',
      '    Delta * Prey * Pred -+> Pred',
      '',
    ].join('\n');
    const { program, diagnostics } = build(src);
    expect(diagnostics).toEqual([]);
    const r = simulate(program, { solver: 'rk4' });

    // V(x, y) = δ·x − γ·ln x + β·y − α·ln y
    const V = (x: number, y: number): number =>
      0.1 * x - 0.4 * Math.log(x) + 0.4 * y - 1.1 * Math.log(y);

    const x = r.stocks.Prey!;
    const y = r.stocks.Pred!;
    const v0 = V(x[0]!, y[0]!);
    let maxDrift = 0;
    for (let i = 1; i < x.length; i++) {
      const drift = Math.abs(V(x[i]!, y[i]!) - v0);
      if (drift > maxDrift) maxDrift = drift;
    }
    expect(maxDrift).toBeLessThan(1e-3);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// Order-of-convergence test — the strongest correctness signal.

describe('numerical — order of convergence', () => {
  function exponentialErrorAt(dt: number, solverName: 'rk4' | 'euler'): number {
    const src = [
      'StartTime = 0',
      `EndTime = 1`,
      `TimeStep = ${dt}`,
      'constant K = 1',
      'stock X = 1',
      'flow Growth:',
      '    X * K -+> X',
      '',
    ].join('\n');
    const { program } = build(src);
    const r = simulate(program, { solver: solverName });
    // Compare X(t=EndTime=1) against e^1 = exp(1).
    const last = r.stocks.X!;
    return Math.abs(last[last.length - 1]! - Math.E);
  }

  it('RK4 has empirical order ≈ 4 (slope ∈ [3.8, 4.2])', () => {
    const dts = [0.1, 0.05, 0.025, 0.0125];
    const errs = dts.map((dt) => exponentialErrorAt(dt, 'rk4'));
    // Sanity: errors must shrink monotonically.
    for (let i = 1; i < errs.length; i++) expect(errs[i]).toBeLessThan(errs[i - 1]!);
    const order = fitOrder(dts, errs);
    expect(order).toBeGreaterThan(3.8);
    expect(order).toBeLessThan(4.2);
  });

  it('Euler has empirical order ≈ 1 (slope ∈ [0.9, 1.1])', () => {
    const dts = [0.1, 0.05, 0.025, 0.0125];
    const errs = dts.map((dt) => exponentialErrorAt(dt, 'euler'));
    for (let i = 1; i < errs.length; i++) expect(errs[i]).toBeLessThan(errs[i - 1]!);
    const order = fitOrder(dts, errs);
    expect(order).toBeGreaterThan(0.9);
    expect(order).toBeLessThan(1.1);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// Calc evaluation during simulation

describe('numerical — calcs', () => {
  it('records the calc series and uses calcs in flow expressions', () => {
    const src = [
      'StartTime = 0',
      'EndTime = 5',
      'TimeStep = 1',
      'stock X = 100',
      'calc Half = X / 2',
      // Each step, decrement X by `Half/100` so the trajectory is a slow decay.
      'flow Drain:',
      '    Half / 100 --> X',
      '',
    ].join('\n');
    const { program, diagnostics } = build(src);
    expect(diagnostics).toEqual([]);
    const r = simulate(program);
    // calc series exists and matches X/2 at each recorded step.
    expect(r.calcs.Half).toBeDefined();
    for (let i = 0; i < r.time.length; i++) {
      expect(r.calcs.Half![i]).toBeCloseTo(r.stocks.X![i]! / 2, 12);
    }
  });
});

// ────────────────────────────────────────────────────────────────────────────
// NaN policy

describe('numerical — NaN policy', () => {
  it('aborts when a stock becomes non-finite, with SD0080 and partial series', () => {
    // Division by zero at t=0 → NaN immediately.
    const src = [
      'StartTime = 0',
      'EndTime = 5',
      'TimeStep = 1',
      'stock X = 0',
      'calc Bad = 1 / X',     // 1/0 = Infinity at t=0
      'flow Diverge:',
      '    Bad -+> X',
      '',
    ].join('\n');
    const { program, diagnostics } = build(src);
    expect(diagnostics).toEqual([]);
    const r = simulate(program);
    expect(r.diagnostics.some((d) => d.code === 'SD0080')).toBe(true);
    expect(r.abortedAt).toBeDefined();
  });

  it('does not abort on valid simulations', () => {
    const src = [
      'StartTime = 0',
      'EndTime = 1',
      'TimeStep = 0.1',
      'stock X = 1',
      'flow F:',
      '    X -+> X',
      '',
    ].join('\n');
    const { program } = build(src);
    const r = simulate(program);
    expect(r.abortedAt).toBeUndefined();
    expect(r.diagnostics).toEqual([]);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// User overrides

describe('numerical — overrides', () => {
  it('per-call constant overrides take effect after init', () => {
    const src = [
      'StartTime = 0',
      'EndTime = 1',
      'TimeStep = 1',
      'constant K = 1',
      'stock X = K',
      '',
    ].join('\n');
    const { program } = build(src);
    const r = simulate(program, { overrides: { K: 7 } });
    // X.init = K, evaluated against the constants table — but overrides are
    // applied AFTER constant init, so X sees the overridden value.
    expect(r.stocks.X![0]).toBe(7);
  });
});
