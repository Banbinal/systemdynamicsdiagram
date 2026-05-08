/**
 * Parameter calibration via the Nelder-Mead simplex algorithm.
 *
 * The cost function is the root-mean-square error between the simulated
 * series and the model's `reference` declarations, evaluated at each
 * reference's declared time points (linearly interpolated from the
 * recorded steps). Multiple reference modes are aggregated into a single
 * scalar cost.
 *
 * Bounds are enforced by clamping each parameter to [low, high] before every
 * cost evaluation. This is the simplest approach — a transform-based
 * (logit) bound enforcement would be more rigorous but adds complexity for
 * little gain on typical SD parameter ranges.
 *
 * Convergence: stop when the simplex shrinks below an absolute tolerance,
 * OR when `maxIterations` is reached. Returns whichever is reached first.
 */

import type { CompiledProgram } from '../ir/program.js';
import { simulate, type SimulateOptions } from './simulate.js';

export interface CalibrationOptions {
  readonly solver?: SimulateOptions['solver'];
  /** Hard cap on simplex evaluations. Default 400. */
  readonly maxIterations?: number;
  /** Relative tolerance for simplex shrinkage. Default 1e-4. */
  readonly tolerance?: number;
}

export interface CalibrationParamResult {
  readonly fqn: string;
  readonly initial: number;
  readonly fitted: number;
  readonly low: number;
  readonly high: number;
}

export interface CalibrationOk {
  readonly status: 'ok';
  readonly initialCost: number; // RMSE before fitting
  readonly finalCost: number;   // RMSE after fitting
  readonly iterations: number;
  readonly params: readonly CalibrationParamResult[];
}

export interface CalibrationErr {
  readonly status: 'error';
  readonly message: string;
}

export type CalibrationResult = CalibrationOk | CalibrationErr;

export function runCalibration(
  program: CompiledProgram,
  options: CalibrationOptions = {},
): CalibrationResult {
  if (!program.calibration || program.calibration.params.length === 0) {
    return { status: 'error', message: 'No calibrate block declared.' };
  }
  if (program.references.length === 0) {
    return {
      status: 'error',
      message: 'No reference modes to calibrate against — declare `reference` blocks first.',
    };
  }

  const params = program.calibration.params;

  // Initial vector: each constant's compiled default value (read off the
  // base simulation's constant evaluation by running once with no overrides
  // and inspecting the FQN's literal expression — easiest path is a short
  // probing run).
  const initial: number[] = [];
  for (const p of params) {
    const c = program.constants.find((x) => x.fqn === p.fqn);
    if (!c) {
      return { status: 'error', message: `Calibration target '${p.fqn}' has no constant entry.` };
    }
    // Try const-fold: a single PushNum op is the literal default. Fallback
    // to the midpoint of the bounds otherwise.
    const op = c.expr.ops[0];
    const literal = c.expr.ops.length === 1 && op && op.kind === 'PushNum' ? op.value : null;
    initial.push(literal ?? (p.low + p.high) / 2);
  }

  const cost = (x: number[]): number => costAt(program, params, x, options);
  const initialCost = cost(initial);

  const { x: fitted, cost: finalCost, iterations } = nelderMead(
    cost,
    initial,
    params.map((p) => ({ low: p.low, high: p.high })),
    {
      maxIterations: options.maxIterations ?? 400,
      tolerance: options.tolerance ?? 1e-4,
    },
  );

  return {
    status: 'ok',
    initialCost,
    finalCost,
    iterations,
    params: params.map((p, i) => ({
      fqn: p.fqn,
      initial: initial[i]!,
      fitted: clamp(fitted[i]!, p.low, p.high),
      low: p.low,
      high: p.high,
    })),
  };
}

// ── Cost ──────────────────────────────────────────────────────────────────

function costAt(
  program: CompiledProgram,
  params: readonly { fqn: string }[],
  x: number[],
  options: CalibrationOptions,
): number {
  // Build override map.
  const overrides: Record<string, number> = {};
  for (let i = 0; i < params.length; i++) overrides[params[i]!.fqn] = x[i]!;

  let result;
  try {
    const simOpts: SimulateOptions = { overrides };
    if (options.solver !== undefined) (simOpts as { solver?: SimulateOptions['solver'] }).solver = options.solver;
    result = simulate(program, simOpts);
  } catch {
    return Infinity;
  }
  if (result.abortedAt !== undefined) return Infinity;

  // Sum-of-squares across every reference's points.
  let sumSq = 0;
  let n = 0;
  for (const ref of program.references) {
    const series = result.stocks[ref.fqn] ?? result.calcs[ref.fqn];
    if (!series) continue;
    for (const pt of ref.points) {
      const sim = interpolate(result.time, series, pt.t);
      if (sim === null) continue;
      const diff = sim - pt.v;
      sumSq += diff * diff;
      n++;
    }
  }
  if (n === 0) return Infinity;
  return Math.sqrt(sumSq / n);
}

/** Linear interpolation of `series` at `targetTime`, given the time array. */
function interpolate(time: Float64Array, series: Float64Array, targetTime: number): number | null {
  if (time.length === 0 || series.length === 0) return null;
  if (targetTime <= (time[0] ?? 0)) return series[0] ?? null;
  if (targetTime >= (time[time.length - 1] ?? 0)) return series[series.length - 1] ?? null;
  // Binary search for the bracketing pair.
  let lo = 0;
  let hi = time.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if ((time[mid] ?? 0) <= targetTime) lo = mid;
    else hi = mid;
  }
  const t0 = time[lo]!;
  const t1 = time[hi]!;
  const v0 = series[lo]!;
  const v1 = series[hi]!;
  const f = (targetTime - t0) / (t1 - t0 || 1);
  return v0 + f * (v1 - v0);
}

// ── Nelder-Mead simplex ────────────────────────────────────────────────────
//
// Standard 1965 implementation. For an n-dimensional problem we maintain
// (n+1) vertices, each a parameter vector. At each iteration:
//   1. Sort by cost.
//   2. Compute the centroid of the n best (excluding worst).
//   3. Reflect the worst through the centroid.
//   4. If reflection is better than the best → expand further.
//   5. If reflection is worse than the second-worst → contract.
//   6. If contraction fails → shrink the whole simplex toward the best.

interface NMOptions {
  readonly maxIterations: number;
  readonly tolerance: number;
}

interface Bound {
  readonly low: number;
  readonly high: number;
}

function nelderMead(
  cost: (x: number[]) => number,
  initial: number[],
  bounds: readonly Bound[],
  options: NMOptions,
): { x: number[]; cost: number; iterations: number } {
  const n = initial.length;
  const alpha = 1.0;
  const gamma = 2.0;
  const rho = 0.5;
  const sigma = 0.5;

  // Build initial simplex: each vertex offset along one axis by 5% of the
  // bound range (or 0.05 absolute if range is degenerate).
  const simplex: number[][] = [initial.slice()];
  for (let i = 0; i < n; i++) {
    const pt = initial.slice();
    const range = bounds[i]!.high - bounds[i]!.low;
    const step = Math.max(0.05, range * 0.05);
    pt[i] = clamp(pt[i]! + step, bounds[i]!.low, bounds[i]!.high);
    simplex.push(pt);
  }
  const fvals = simplex.map((v) => cost(clampVec(v, bounds)));

  let iter = 0;
  while (iter < options.maxIterations) {
    iter++;

    // Sort by cost ascending.
    const order = simplex.map((_, i) => i).sort((a, b) => fvals[a]! - fvals[b]!);
    const sortedSimplex = order.map((i) => simplex[i]!);
    const sortedF = order.map((i) => fvals[i]!);
    for (let i = 0; i < simplex.length; i++) {
      simplex[i] = sortedSimplex[i]!;
      fvals[i] = sortedF[i]!;
    }

    // Convergence: simplex diameter under tolerance (max distance from best).
    const best = simplex[0]!;
    let maxDist = 0;
    for (let i = 1; i < simplex.length; i++) {
      let d = 0;
      for (let j = 0; j < n; j++) d += Math.abs(simplex[i]![j]! - best[j]!);
      if (d > maxDist) maxDist = d;
    }
    if (maxDist < options.tolerance) break;

    // Centroid of the n best.
    const centroid = new Array(n).fill(0) as number[];
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) centroid[j]! += simplex[i]![j]!;
    }
    for (let j = 0; j < n; j++) centroid[j]! /= n;

    const worst = simplex[n]!;
    const fWorst = fvals[n]!;
    const fSecondWorst = fvals[n - 1]!;
    const fBest = fvals[0]!;

    // Reflection.
    const reflect = centroid.map((c, j) => c + alpha * (c - worst[j]!));
    const reflectClamped = clampVec(reflect, bounds);
    const fReflect = cost(reflectClamped);

    if (fReflect < fSecondWorst && fReflect >= fBest) {
      simplex[n] = reflectClamped;
      fvals[n] = fReflect;
      continue;
    }

    if (fReflect < fBest) {
      // Expansion.
      const expand = centroid.map((c, j) => c + gamma * (reflect[j]! - c));
      const expandClamped = clampVec(expand, bounds);
      const fExpand = cost(expandClamped);
      if (fExpand < fReflect) {
        simplex[n] = expandClamped;
        fvals[n] = fExpand;
      } else {
        simplex[n] = reflectClamped;
        fvals[n] = fReflect;
      }
      continue;
    }

    // Contraction.
    const contract = centroid.map((c, j) => c + rho * (worst[j]! - c));
    const contractClamped = clampVec(contract, bounds);
    const fContract = cost(contractClamped);
    if (fContract < fWorst) {
      simplex[n] = contractClamped;
      fvals[n] = fContract;
      continue;
    }

    // Shrink toward the best.
    for (let i = 1; i <= n; i++) {
      const shrunk = simplex[i]!.map((v, j) => best[j]! + sigma * (v - best[j]!));
      simplex[i] = clampVec(shrunk, bounds);
      fvals[i] = cost(simplex[i]!);
    }
  }

  // Final sort and return best.
  const order = simplex.map((_, i) => i).sort((a, b) => fvals[a]! - fvals[b]!);
  return { x: simplex[order[0]!]!, cost: fvals[order[0]!]!, iterations: iter };
}

function clamp(v: number, low: number, high: number): number {
  if (v < low) return low;
  if (v > high) return high;
  return v;
}

function clampVec(v: readonly number[], bounds: readonly Bound[]): number[] {
  return v.map((x, i) => clamp(x, bounds[i]!.low, bounds[i]!.high));
}
