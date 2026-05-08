/**
 * Simulation entry point.
 *
 * Owns the state buffers (constants/stocks/calcs Float64Arrays), drives the
 * solver in a tight loop, and records a decimated time series keyed by FQN.
 *
 * Pipeline:
 *   1. Allocate constant/stock/calc buffers sized from the CompiledProgram.
 *   2. Initialise constants in topo order (CompiledProgram.constants is sorted).
 *      Apply user `overrides` after init, so callers can override any constant
 *      regardless of its dependence chain.
 *   3. Initialise stocks by evaluating each `init` expression.
 *   4. Build the closure `derivs(t, state, out)`:
 *        - Re-evaluates calcs against the temporary `state` (RK4 substeps need
 *          calcs computed at the substep state, not at the start-of-step state).
 *        - Sums signed flow effects per stock target into `out`.
 *   5. Allocate scratch (k1..k4, tmp) sized to stocks.length.
 *   6. Loop: at each integer step, recompute calcs at the canonical `(t, stocks)`
 *      pair, NaN-check, record (every Nth), then solver.step → t += dt.
 *
 * NaN policy: as soon as any stock or calc becomes non-finite (NaN or ±Inf),
 * emit SD0080, set `abortedAt`, and return the partial series collected so far.
 * NaN is never a sentinel for "not computed" — the topological order guarantees
 * every value is either real or known-bad.
 *
 * Stable error codes:
 *   SD0080  non-finite value during simulation (NaN/Inf)
 *   SD0081  unknown solver name
 *   SD0082  unknown scenario name
 *   SD0083  variation cap exceeded (simulateAll truncated)
 */

import type { Diagnostic } from '../diagnostics/diagnostic.js';
import { EMPTY_RANGE } from '../diagnostics/source.js';
import { evalExpr } from '../ir/evaluator.js';
import type { CompiledExpr, CompiledProgram, LimitIR, ScenarioIR } from '../ir/program.js';
import type { DerivativeFn, Solver, StepScratch } from './solver.js';
import { EulerSolver } from './solvers/euler.js';
import { RK4Solver } from './solvers/rk4.js';

export interface SimulateOptions {
  /** Solver to use. Defaults to `'rk4'`. */
  readonly solver?: 'rk4' | 'euler' | Solver;
  /** Apply this scenario's overrides (must be defined in the program). */
  readonly scenarioName?: string | null;
  /** Per-constant value overrides keyed by FQN. Applied after constant init. */
  readonly overrides?: Readonly<Record<string, number>>;
  /** Record every Nth step (default 1). Useful for fine `dt` + long horizons. */
  readonly recordEvery?: number;
}

export interface SimulationResult {
  /** Time at each recorded step. */
  readonly time: Float64Array;
  /** Stock series keyed by FQN. */
  readonly stocks: Readonly<Record<string, Float64Array>>;
  /** Calc series keyed by FQN. */
  readonly calcs: Readonly<Record<string, Float64Array>>;
  /** Diagnostics produced during simulation (e.g. NaN aborts). */
  readonly diagnostics: readonly Diagnostic[];
  /** If the simulation aborted (e.g. NaN), the step index at which it stopped. */
  readonly abortedAt?: number;
}

export interface SimulateAllOptions {
  readonly solver?: SimulateOptions['solver'];
  readonly recordEvery?: number;
  /** Cap on total variations (scenarios × sweep cartesian product). Default 64. */
  readonly maxVariations?: number;
}

export interface VariationResult {
  readonly label: string;
  readonly scenarioName: string | null;
  readonly sweepValues: Readonly<Record<string, number>>;
  readonly result: SimulationResult;
}

export function simulate(
  program: CompiledProgram,
  options: SimulateOptions = {},
): SimulationResult {
  const recordEvery = Math.max(1, options.recordEvery ?? 1);
  const solverArg = options.solver ?? 'rk4';
  const solver = pickSolver(solverArg);

  const { startTime, endTime, timeStep: dt } = program.time;
  const numIntervals = Math.max(0, Math.round((endTime - startTime) / dt));

  // ─── Buffers ─────────────────────────────────────────────────────────
  const constants = new Float64Array(program.constantCount);
  const stocks = new Float64Array(program.stockCount);
  const calcs = new Float64Array(program.calcCount);
  const stepStack = new Float64Array(maxStackSize(program));
  const maps = program.maps;

  const diagnostics: Diagnostic[] = [];

  // Resolve scenario (if requested). Unknown name → SD0082, run as Base.
  const scenario = resolveScenario(program, options.scenarioName, diagnostics);

  // ─── Init constants (in topo order) ──────────────────────────────────
  for (const c of program.constants) {
    constants[c.slot] = evalExpr(
      c.expr,
      { constants, stocks, calcs, time: startTime, maps },
      stepStack,
    );
  }

  // Apply per-call overrides (raw values — used by simulateAll for sweeps).
  // Plan: (1) sweep / per-call overrides → (2) scenario constants → (3) scenario stocks.
  if (options.overrides) {
    for (const [fqn, value] of Object.entries(options.overrides)) {
      const c = program.constants.find((x) => x.fqn === fqn);
      if (c) constants[c.slot] = value;
    }
  }

  // Scenario constant overrides — applied in slot (= topological) order so
  // a later override may reference an earlier one through the constants table.
  if (scenario) {
    const sortedConsts = [...scenario.constantOverrides].sort((a, b) => a.slot - b.slot);
    for (const ov of sortedConsts) {
      constants[ov.slot] = evalExpr(
        ov.expr,
        { constants, stocks, calcs, time: startTime, maps },
        stepStack,
      );
    }
  }

  // ─── Init stocks (against the now-overridden constants table) ───────
  for (const s of program.stocks) {
    stocks[s.slot] = evalExpr(
      s.init,
      { constants, stocks, calcs, time: startTime, maps },
      stepStack,
    );
  }

  // Scenario stock overrides — applied after default init, in slot order.
  if (scenario) {
    const sortedStocks = [...scenario.stockOverrides].sort((a, b) => a.slot - b.slot);
    for (const ov of sortedStocks) {
      stocks[ov.slot] = evalExpr(
        ov.expr,
        { constants, stocks, calcs, time: startTime, maps },
        stepStack,
      );
    }
  }

  // Apply limits to the initial state too — guards against an init expression
  // that lands outside the declared bounds.
  applyLimits(stocks, program.limits);

  // ─── Output series ───────────────────────────────────────────────────
  const recordedCount = Math.floor(numIntervals / recordEvery) + 1;
  const time = new Float64Array(recordedCount);
  const stockSeries: Record<string, Float64Array> = {};
  const calcSeries: Record<string, Float64Array> = {};
  for (const s of program.stocks) stockSeries[s.fqn] = new Float64Array(recordedCount);
  for (const c of program.calcs) calcSeries[c.fqn] = new Float64Array(recordedCount);

  // ─── Solver scratch ──────────────────────────────────────────────────
  const n = stocks.length;
  const scratch: StepScratch = {
    k1: new Float64Array(n),
    k2: new Float64Array(n),
    k3: new Float64Array(n),
    k4: new Float64Array(n),
    tmp: new Float64Array(n),
  };

  // ─── Derivative closure ──────────────────────────────────────────────
  // `state` is the stocks vector at the current substep (may differ from
  // `stocks` during RK4's k2/k3/k4). We re-evaluate calcs against `state`,
  // then sum signed flow contributions into `out`.
  const derivs: DerivativeFn = (t, state, out) => {
    evalCalcsInto(program, constants, state, calcs, t, stepStack);
    out.fill(0);
    for (const eff of program.flowEffects) {
      const v = evalExpr(
        eff.expr,
        { constants, stocks: state, calcs, time: t, maps },
        stepStack,
      );
      if (eff.polarity === 'positive') {
        out[eff.targetSlot] = out[eff.targetSlot]! + v;
      } else {
        out[eff.targetSlot] = out[eff.targetSlot]! - v;
      }
    }
  };

  // ─── Main loop ───────────────────────────────────────────────────────
  let recordedIdx = 0;
  let abortedAt: number | undefined;

  // Step 0 — initial snapshot.
  evalCalcsInto(program, constants, stocks, calcs, startTime, stepStack);
  if (!checkFinite(stocks, calcs)) {
    diagnostics.push(nanDiagnostic(0, startTime));
    abortedAt = 0;
  } else {
    record(time, stockSeries, calcSeries, program, stocks, calcs, startTime, recordedIdx);
    recordedIdx++;
  }

  if (abortedAt === undefined) {
    for (let step = 1; step <= numIntervals; step++) {
      const t = startTime + (step - 1) * dt;
      solver.step({ t, dt, state: stocks, derivs, scratch });
      const newT = startTime + step * dt;

      // Post-step clamping: limits apply to the new stock state before
      // calcs are recomputed against it.
      applyLimits(stocks, program.limits);

      evalCalcsInto(program, constants, stocks, calcs, newT, stepStack);

      if (!checkFinite(stocks, calcs)) {
        diagnostics.push(nanDiagnostic(step, newT));
        abortedAt = step;
        break;
      }

      if (step % recordEvery === 0) {
        record(time, stockSeries, calcSeries, program, stocks, calcs, newT, recordedIdx);
        recordedIdx++;
      }
    }
  }

  // Trim if aborted early — we only filled `recordedIdx` rows.
  const finalTime = recordedIdx === recordedCount ? time : time.slice(0, recordedIdx);
  const finalStocks = trimSeries(stockSeries, recordedIdx, recordedCount);
  const finalCalcs = trimSeries(calcSeries, recordedIdx, recordedCount);

  return {
    time: finalTime,
    stocks: finalStocks,
    calcs: finalCalcs,
    diagnostics,
    ...(abortedAt !== undefined ? { abortedAt } : {}),
  };
}

/**
 * Enumerate (scenarios ∪ Base) × cartesian-product(sweeps) and run each.
 *
 * Order:
 *   - If `program.scenarios` is empty, use a single null "Base" scenario.
 *   - For each scenario (or Base), enumerate the cartesian product of all
 *     sweep value lists. Each sweep contributes a Record<FQN, number> entry.
 *   - Total variations = scenarios.length × Π sweep[i].values.length.
 *   - If total > maxVariations, only the first maxVariations are run and
 *     SD0083 is emitted on every truncated VariationResult so callers can
 *     surface it without inspecting only the first.
 *
 * Labels follow `${scenarioName} (${sweepKey1=v1, sweepKey2=v2})` or the
 * special `(Base)` suffix when no sweep contributes a value.
 */
export function simulateAll(
  program: CompiledProgram,
  options: SimulateAllOptions = {},
): VariationResult[] {
  const max = options.maxVariations ?? 64;

  const scenarios: (ScenarioIR | null)[] =
    program.scenarios.length === 0 ? [null] : [null, ...program.scenarios];

  const sweepCombos = cartesianSweeps(program);

  const totalRequested = scenarios.length * sweepCombos.length;
  const totalToRun = Math.min(totalRequested, max);
  const truncated = totalRequested > max;

  const results: VariationResult[] = [];
  let count = 0;
  outer: for (const scenario of scenarios) {
    for (const combo of sweepCombos) {
      if (count >= totalToRun) break outer;
      const overrides: Record<string, number> = {};
      for (const [fqn, value] of combo) overrides[fqn] = value;

      const result = simulate(program, {
        ...(options.solver !== undefined ? { solver: options.solver } : {}),
        ...(options.recordEvery !== undefined ? { recordEvery: options.recordEvery } : {}),
        ...(scenario ? { scenarioName: scenario.name } : {}),
        overrides,
      });

      results.push({
        label: makeLabel(scenario?.name ?? null, overrides),
        scenarioName: scenario?.name ?? null,
        sweepValues: overrides,
        result,
      });
      count++;
    }
  }

  if (truncated) {
    const diag: Diagnostic = {
      severity: 'warning',
      code: 'SD0083',
      message: `Variation cap reached: ran ${totalToRun} of ${totalRequested}; raise maxVariations to run all.`,
      range: EMPTY_RANGE,
    };
    return results.map((r) => ({
      ...r,
      result: {
        ...r.result,
        diagnostics: [...r.result.diagnostics, diag],
      },
    }));
  }

  return results;
}

/**
 * Build the cartesian product of all program sweeps. Each entry is an array
 * of [FQN, value] pairs, one per sweep, in declaration order. Empty sweeps
 * collapse to a single empty combo (= Base, no overrides).
 */
function cartesianSweeps(program: CompiledProgram): ReadonlyArray<ReadonlyArray<readonly [string, number]>> {
  if (program.sweeps.length === 0) return [[]];
  let combos: Array<Array<readonly [string, number]>> = [[]];
  for (const sw of program.sweeps) {
    const next: Array<Array<readonly [string, number]>> = [];
    for (const combo of combos) {
      for (let i = 0; i < sw.values.length; i++) {
        next.push([...combo, [sw.target, sw.values[i]!]]);
      }
    }
    combos = next;
  }
  return combos;
}

function makeLabel(scenarioName: string | null, overrides: Record<string, number>): string {
  const sce = scenarioName ?? 'Base';
  const entries = Object.entries(overrides);
  const sweep = entries.length === 0
    ? '(Base)'
    : `(${entries.map(([k, v]) => `${k}=${v}`).join(', ')})`;
  return `${sce} ${sweep}`;
}

// ────────────────────────────────────────────────────────────────────────────
// Internals

function pickSolver(arg: SimulateOptions['solver']): Solver {
  if (typeof arg === 'object' && arg !== null) return arg;
  if (arg === 'euler') return EulerSolver;
  if (arg === 'rk4' || arg === undefined) return RK4Solver;
  throw new Error(`SD0081: unknown solver '${String(arg)}'`);
}

function maxStackSize(program: CompiledProgram): number {
  let m = 1;
  const consider = (e: CompiledExpr): void => {
    if (e.maxStack > m) m = e.maxStack;
  };
  for (const c of program.constants) consider(c.expr);
  for (const s of program.stocks) consider(s.init);
  for (const c of program.calcs) consider(c.expr);
  for (const e of program.flowEffects) consider(e.expr);
  return m;
}

/**
 * Fill the calcs buffer by evaluating every calc expr in topological order.
 * Calcs are guaranteed to be sorted in `program.calcs`, so a forward sweep is
 * sufficient.
 */
function evalCalcsInto(
  program: CompiledProgram,
  constants: Float64Array,
  state: Float64Array,
  calcs: Float64Array,
  t: number,
  stack: Float64Array,
): void {
  const ctx = { constants, stocks: state, calcs, time: t, maps: program.maps };
  for (const c of program.calcs) {
    calcs[c.slot] = evalExpr(c.expr, ctx, stack);
  }
}

function checkFinite(stocks: Float64Array, calcs: Float64Array): boolean {
  for (let i = 0; i < stocks.length; i++) {
    if (!Number.isFinite(stocks[i]!)) return false;
  }
  for (let i = 0; i < calcs.length; i++) {
    if (!Number.isFinite(calcs[i]!)) return false;
  }
  return true;
}

function nanDiagnostic(step: number, t: number): Diagnostic {
  return {
    severity: 'error',
    code: 'SD0080',
    message: `Non-finite value (NaN or Inf) detected at step ${step} (t=${t}); simulation aborted.`,
    range: EMPTY_RANGE,
  };
}

function record(
  time: Float64Array,
  stockSeries: Record<string, Float64Array>,
  calcSeries: Record<string, Float64Array>,
  program: CompiledProgram,
  stocks: Float64Array,
  calcs: Float64Array,
  t: number,
  idx: number,
): void {
  time[idx] = t;
  for (const s of program.stocks) stockSeries[s.fqn]![idx] = stocks[s.slot]!;
  for (const c of program.calcs) calcSeries[c.fqn]![idx] = calcs[c.slot]!;
}

function trimSeries(
  series: Record<string, Float64Array>,
  filled: number,
  total: number,
): Record<string, Float64Array> {
  if (filled === total) return series;
  const out: Record<string, Float64Array> = {};
  for (const [k, v] of Object.entries(series)) out[k] = v.slice(0, filled);
  return out;
}

function resolveScenario(
  program: CompiledProgram,
  name: string | null | undefined,
  diagnostics: Diagnostic[],
): ScenarioIR | null {
  if (name === undefined || name === null) return null;
  const found = program.scenarios.find((s) => s.name === name);
  if (found) return found;
  diagnostics.push({
    severity: 'error',
    code: 'SD0082',
    message: `Unknown scenario '${name}'; running base case.`,
    range: EMPTY_RANGE,
  });
  return null;
}

function applyLimits(stocks: Float64Array, limits: readonly LimitIR[]): void {
  for (const lim of limits) {
    const v = stocks[lim.slot]!;
    if (lim.min !== undefined && v < lim.min) {
      stocks[lim.slot] = lim.min;
      continue;
    }
    if (lim.max !== undefined && v > lim.max) {
      stocks[lim.slot] = lim.max;
    }
  }
}
