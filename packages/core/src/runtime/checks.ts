/**
 * Reality Check evaluator.
 *
 * For each `check` in the program:
 *   1. Build the override map from the check's `when` inputs (a fresh
 *      simulation of the entire model with those constants pinned).
 *   2. Run `simulate(program, { overrides })`.
 *   3. Walk the recorded series and evaluate the assertion at each step
 *      (or at the step closest to `at t = N`), tracking the first failure.
 *   4. Return a structured pass/fail result per check.
 *
 * Failure semantics:
 *   - `always`: any single step where the assertion is false → FAIL.
 *   - `at t=N`: only the recorded step closest to N is evaluated.
 *
 * Note: assertions are evaluated against the *recorded* state, not against
 * solver substeps. This matches what the user sees in plots and is the only
 * surface a check can sensibly target.
 */

import { evalExpr } from '../ir/evaluator.js';
import type { CheckIR, CheckOp, CompiledExpr, CompiledProgram } from '../ir/program.js';
import { simulate, type SimulateOptions } from './simulate.js';

export interface CheckRunOptions {
  /** Solver to use (forwarded to `simulate`). Defaults to RK4. */
  readonly solver?: SimulateOptions['solver'];
}

export interface CheckPass {
  readonly name: string;
  readonly status: 'pass';
  /** Last evaluation: useful when the user wants to see the margin of safety. */
  readonly lastValue: { lhs: number; rhs: number; t: number };
}

export interface CheckFail {
  readonly name: string;
  readonly status: 'fail';
  /** First step where the assertion failed. */
  readonly failedAt: { lhs: number; rhs: number; t: number; step: number };
}

export interface CheckErr {
  readonly name: string;
  readonly status: 'error';
  readonly message: string;
}

export type CheckResult = CheckPass | CheckFail | CheckErr;

export function runChecks(
  program: CompiledProgram,
  options: CheckRunOptions = {},
): CheckResult[] {
  const out: CheckResult[] = [];
  for (const check of program.checks) {
    out.push(runOne(program, check, options));
  }
  return out;
}

function runOne(
  program: CompiledProgram,
  check: CheckIR,
  options: CheckRunOptions,
): CheckResult {
  // 1. Build the override map. We need numeric values, so each input.expr is
  //    evaluated against the program's BASE constants (no overrides yet —
  //    chain dependencies between check inputs aren't supported in v1).
  const overrides: Record<string, number> = {};
  try {
    const baseConsts = evalBaseConstants(program);
    const stack = new Float64Array(maxStack(program));
    for (const inp of check.inputs) {
      const v = evalExpr(
        inp.expr,
        { constants: baseConsts, stocks: new Float64Array(program.stockCount), calcs: new Float64Array(program.calcCount), time: program.time.startTime, maps: program.maps },
        stack,
      );
      overrides[inp.fqn] = v;
    }
  } catch (err) {
    return { name: check.name, status: 'error', message: `input evaluation failed: ${err instanceof Error ? err.message : String(err)}` };
  }

  // 2. Simulate with these overrides.
  let result;
  try {
    const simOpts: SimulateOptions = { overrides };
    if (options.solver !== undefined) (simOpts as { solver?: SimulateOptions['solver'] }).solver = options.solver;
    result = simulate(program, simOpts);
  } catch (err) {
    return { name: check.name, status: 'error', message: `simulation failed: ${err instanceof Error ? err.message : String(err)}` };
  }
  if (result.abortedAt !== undefined) {
    return { name: check.name, status: 'error', message: `simulation aborted at step ${result.abortedAt}` };
  }

  // 3. Walk and evaluate.
  const stack = new Float64Array(maxStack(program));
  const stocks = new Float64Array(program.stockCount);
  const calcs = new Float64Array(program.calcCount);
  const constants = new Float64Array(program.constantCount);
  // Re-init constants once with the overrides so the lhs/rhs evaluator sees
  // the exact same constant values as the simulation did.
  initConstantsWithOverrides(program, overrides, constants, stack);

  const time = result.time;
  const stockSlotByFqn = new Map(program.stocks.map((s) => [s.fqn, s.slot] as const));
  const calcSlotByFqn = new Map(program.calcs.map((c) => [c.fqn, c.slot] as const));

  const indicesToCheck =
    check.temporal.kind === 'always'
      ? range(time.length)
      : [closestIndex(time, check.temporal.t)];

  let lastSnapshot: { lhs: number; rhs: number; t: number } | null = null;

  for (const i of indicesToCheck) {
    // Refill stocks / calcs at this recorded index from result series.
    for (const s of program.stocks) {
      const slot = stockSlotByFqn.get(s.fqn);
      const series = result.stocks[s.fqn];
      if (slot !== undefined && series) stocks[slot] = series[i] ?? 0;
    }
    for (const c of program.calcs) {
      const slot = calcSlotByFqn.get(c.fqn);
      const series = result.calcs[c.fqn];
      if (slot !== undefined && series) calcs[slot] = series[i] ?? 0;
    }
    const t = time[i] ?? 0;
    const ctx = { constants, stocks, calcs, time: t, maps: program.maps };
    const lhs = evalExpr(check.lhs, ctx, stack);
    const rhs = evalExpr(check.rhs, ctx, stack);
    lastSnapshot = { lhs, rhs, t };
    if (!compare(lhs, check.op, rhs)) {
      return {
        name: check.name,
        status: 'fail',
        failedAt: { lhs, rhs, t, step: i },
      };
    }
  }

  if (!lastSnapshot) {
    // No recorded steps to check — degenerate but treat as pass.
    return { name: check.name, status: 'pass', lastValue: { lhs: 0, rhs: 0, t: 0 } };
  }
  return { name: check.name, status: 'pass', lastValue: lastSnapshot };
}

// ── Helpers ────────────────────────────────────────────────────────────────

function compare(a: number, op: CheckOp, b: number): boolean {
  switch (op) {
    case '>=': return a >= b;
    case '<=': return a <= b;
    case '>': return a > b;
    case '<': return a < b;
    case '==': return a === b;
    case '!=': return a !== b;
  }
}

function range(n: number): number[] {
  const out = new Array<number>(n);
  for (let i = 0; i < n; i++) out[i] = i;
  return out;
}

function closestIndex(time: Float64Array, target: number): number {
  if (time.length === 0) return 0;
  let bestIdx = 0;
  let bestDiff = Math.abs((time[0] ?? 0) - target);
  for (let i = 1; i < time.length; i++) {
    const d = Math.abs((time[i] ?? 0) - target);
    if (d < bestDiff) {
      bestDiff = d;
      bestIdx = i;
    }
  }
  return bestIdx;
}

function maxStack(program: CompiledProgram): number {
  let m = 1;
  const consider = (e: CompiledExpr) => { if (e.maxStack > m) m = e.maxStack; };
  for (const c of program.constants) consider(c.expr);
  for (const s of program.stocks) consider(s.init);
  for (const c of program.calcs) consider(c.expr);
  for (const eff of program.flowEffects) consider(eff.expr);
  for (const ck of program.checks) {
    consider(ck.lhs);
    consider(ck.rhs);
    for (const inp of ck.inputs) consider(inp.expr);
  }
  return m;
}

function evalBaseConstants(program: CompiledProgram): Float64Array {
  const constants = new Float64Array(program.constantCount);
  const stocks = new Float64Array(program.stockCount);
  const calcs = new Float64Array(program.calcCount);
  const stack = new Float64Array(maxStack(program));
  for (const c of program.constants) {
    constants[c.slot] = evalExpr(
      c.expr,
      { constants, stocks, calcs, time: program.time.startTime, maps: program.maps },
      stack,
    );
  }
  return constants;
}

function initConstantsWithOverrides(
  program: CompiledProgram,
  overrides: Record<string, number>,
  out: Float64Array,
  stack: Float64Array,
): void {
  const stocks = new Float64Array(program.stockCount);
  const calcs = new Float64Array(program.calcCount);
  for (const c of program.constants) {
    out[c.slot] = evalExpr(
      c.expr,
      { constants: out, stocks, calcs, time: program.time.startTime, maps: program.maps },
      stack,
    );
  }
  for (const [fqn, v] of Object.entries(overrides)) {
    const c = program.constants.find((x) => x.fqn === fqn);
    if (c) out[c.slot] = v;
  }
}
