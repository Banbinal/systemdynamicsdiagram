/**
 * One-at-a-time sensitivity: for each sweep, vary that single parameter from
 * its declared low to its declared high while holding every other sweep at
 * its first value (the baseline). Compute the chosen output metric on the
 * focus stock for each end of the range.
 *
 * The output is a list of bars sorted by |high - low| descending — the
 * "tornado" shape. Each bar carries enough context for the renderer to
 * label the parameter and show the swing relative to baseline.
 */

import { simulate, type CompiledProgram } from '@sysdyn/core';

export type TornadoMetric = 'final' | 'peak' | 'trough' | 'integral' | 'meanAbsRate';

export interface TornadoBar {
  /** FQN of the swept constant. */
  readonly paramFqn: string;
  /** Sweep values used for low / high ends. */
  readonly low: number;
  readonly high: number;
  /** Output metric at the low / high / baseline runs. */
  readonly outLow: number;
  readonly outHigh: number;
  readonly outBaseline: number;
  /** |outHigh - outLow|. Used for sorting. */
  readonly amplitude: number;
}

export interface TornadoResult {
  readonly bars: readonly TornadoBar[];
  /** Output metric on the baseline (no overrides) run. */
  readonly baseline: number;
  /** Combined min/max across all swing endpoints + baseline. */
  readonly outMin: number;
  readonly outMax: number;
}

export interface TornadoOptions {
  readonly focusFqn: string;
  readonly metric?: TornadoMetric;
}

/** One cell of the tornado matrix — a (stock, metric) pair. */
export interface TornadoMatrixCell {
  readonly stockFqn: string;
  readonly metric: TornadoMetric;
  readonly bars: readonly TornadoBar[];
  readonly baseline: number;
  readonly outMin: number;
  readonly outMax: number;
}

export interface TornadoMatrixResult {
  /** Cells indexed by [stockFqn][metric]. Missing entries mean the metric
   *  could not be computed for that stock (e.g. empty series). */
  readonly cells: Readonly<Record<string, Readonly<Partial<Record<TornadoMetric, TornadoMatrixCell>>>>>;
  /** Param FQNs in display order (sorted by aggregate normalised |swing|). */
  readonly params: readonly string[];
  /** Input range per param. */
  readonly ranges: Readonly<Record<string, { readonly low: number; readonly high: number }>>;
}

export interface TornadoMatrixOptions {
  readonly stocks: readonly string[];
  readonly metrics: readonly TornadoMetric[];
}

/**
 * Compute the full tornado matrix in a single pass: one baseline run plus
 * two runs per sweep (low + high). Each (stock, metric) pair is then derived
 * by reducing those runs — no extra simulations needed when the user toggles
 * stocks or metrics in the UI.
 *
 * Param ordering across the whole matrix uses aggregated normalised swing
 * (|swing| / max(|baseline|, eps)) so the most globally influential param
 * sits on top regardless of which cell you're looking at.
 */
export function computeTornadoMatrix(
  program: CompiledProgram,
  options: TornadoMatrixOptions,
): TornadoMatrixResult | null {
  if (program.sweeps.length === 0) return null;
  if (options.stocks.length === 0 || options.metrics.length === 0) return null;

  const baselineOverrides: Record<string, number> = {};
  for (const sw of program.sweeps) baselineOverrides[sw.target] = sw.values[0]!;
  const baselineRun = simulate(program, { overrides: baselineOverrides });

  // One pair of runs per sweep.
  type SweepRun = {
    readonly paramFqn: string;
    readonly low: number;
    readonly high: number;
    readonly lowRun: ReturnType<typeof simulate>;
    readonly highRun: ReturnType<typeof simulate>;
  };
  const sweepRuns: SweepRun[] = [];
  for (const sw of program.sweeps) {
    const values = sw.values;
    if (values.length < 2) continue;
    let low = Infinity;
    let high = -Infinity;
    for (let i = 0; i < values.length; i++) {
      const v = values[i]!;
      if (v < low) low = v;
      if (v > high) high = v;
    }
    if (low === high) continue;
    const lowRun = simulate(program, {
      overrides: { ...baselineOverrides, [sw.target]: low },
    });
    const highRun = simulate(program, {
      overrides: { ...baselineOverrides, [sw.target]: high },
    });
    sweepRuns.push({ paramFqn: sw.target, low, high, lowRun, highRun });
  }
  if (sweepRuns.length === 0) return null;

  const cells: Record<string, Partial<Record<TornadoMetric, TornadoMatrixCell>>> = {};
  const aggregate: Record<string, number> = {};

  for (const stock of options.stocks) {
    cells[stock] = {};
    for (const metric of options.metrics) {
      const baseline = computeMetric(baselineRun.stocks[stock], metric, baselineRun.time);
      if (baseline === null) continue;

      let outMin = baseline;
      let outMax = baseline;
      const bars: TornadoBar[] = [];
      for (const r of sweepRuns) {
        const outLow = computeMetric(r.lowRun.stocks[stock], metric, r.lowRun.time);
        const outHigh = computeMetric(r.highRun.stocks[stock], metric, r.highRun.time);
        if (outLow === null || outHigh === null) continue;
        if (outLow < outMin) outMin = outLow;
        if (outLow > outMax) outMax = outLow;
        if (outHigh < outMin) outMin = outHigh;
        if (outHigh > outMax) outMax = outHigh;
        const amplitude = Math.abs(outHigh - outLow);
        bars.push({
          paramFqn: r.paramFqn,
          low: r.low,
          high: r.high,
          outLow,
          outHigh,
          outBaseline: baseline,
          amplitude,
        });
        // Normalised contribution to the global param ordering. Using
        // |baseline| guards against tiny baselines blowing up; finite
        // metrics like meanAbsRate use 1 as a floor.
        const denom = Math.max(Math.abs(baseline), 1e-9);
        aggregate[r.paramFqn] = (aggregate[r.paramFqn] ?? 0) + amplitude / denom;
      }
      bars.sort((a, b) => b.amplitude - a.amplitude);
      cells[stock]![metric] = { stockFqn: stock, metric, bars, baseline, outMin, outMax };
    }
  }

  const params = sweepRuns
    .map((r) => r.paramFqn)
    .sort((a, b) => (aggregate[b] ?? 0) - (aggregate[a] ?? 0));

  const ranges: Record<string, { low: number; high: number }> = {};
  for (const r of sweepRuns) ranges[r.paramFqn] = { low: r.low, high: r.high };

  return { cells, params, ranges };
}

export function computeTornado(
  program: CompiledProgram,
  options: TornadoOptions,
): TornadoResult | null {
  if (program.sweeps.length === 0) return null;

  const metric = options.metric ?? 'final';

  // Baseline: hold every sweep at its first value (the low end of its range).
  // We *could* also simulate with no overrides at all, but using the first
  // sweep value mirrors what the user sees as "the run before sliding any
  // parameter" in the Compare view.
  const baselineOverrides: Record<string, number> = {};
  for (const sw of program.sweeps) {
    baselineOverrides[sw.target] = sw.values[0]!;
  }
  const baselineResult = simulate(program, { overrides: baselineOverrides });
  const baseline = computeMetric(baselineResult.stocks[options.focusFqn], metric, baselineResult.time);
  if (baseline === null) return null;

  let outMin = baseline;
  let outMax = baseline;

  const bars: TornadoBar[] = [];
  for (const sw of program.sweeps) {
    const values = sw.values;
    if (values.length < 2) continue;
    let low = Infinity;
    let high = -Infinity;
    for (let i = 0; i < values.length; i++) {
      const v = values[i]!;
      if (v < low) low = v;
      if (v > high) high = v;
    }
    if (low === high) continue;

    const overridesLow: Record<string, number> = { ...baselineOverrides, [sw.target]: low };
    const overridesHigh: Record<string, number> = { ...baselineOverrides, [sw.target]: high };
    const lowResult = simulate(program, { overrides: overridesLow });
    const highResult = simulate(program, { overrides: overridesHigh });

    const outLow = computeMetric(lowResult.stocks[options.focusFqn], metric, lowResult.time);
    const outHigh = computeMetric(highResult.stocks[options.focusFqn], metric, highResult.time);
    if (outLow === null || outHigh === null) continue;

    if (outLow < outMin) outMin = outLow;
    if (outLow > outMax) outMax = outLow;
    if (outHigh < outMin) outMin = outHigh;
    if (outHigh > outMax) outMax = outHigh;

    bars.push({
      paramFqn: sw.target,
      low,
      high,
      outLow,
      outHigh,
      outBaseline: baseline,
      amplitude: Math.abs(outHigh - outLow),
    });
  }

  bars.sort((a, b) => b.amplitude - a.amplitude);
  return { bars, baseline, outMin, outMax };
}

function computeMetric(
  series: Float64Array | undefined,
  metric: TornadoMetric,
  time: Float64Array,
): number | null {
  if (!series || series.length === 0) return null;
  switch (metric) {
    case 'final':
      return series[series.length - 1] ?? null;
    case 'peak': {
      let m = -Infinity;
      for (let i = 0; i < series.length; i++) if (series[i]! > m) m = series[i]!;
      return Number.isFinite(m) ? m : null;
    }
    case 'trough': {
      let m = Infinity;
      for (let i = 0; i < series.length; i++) if (series[i]! < m) m = series[i]!;
      return Number.isFinite(m) ? m : null;
    }
    case 'integral': {
      // Trapezoid rule on the recorded points. Assumes uniform-ish dt; close
      // enough for sensitivity ranking even on decimated outputs.
      let acc = 0;
      for (let i = 1; i < series.length; i++) {
        const dt = (time[i] ?? 0) - (time[i - 1] ?? 0);
        acc += 0.5 * (series[i]! + series[i - 1]!) * dt;
      }
      return acc;
    }
    case 'meanAbsRate': {
      // Mean |dStock/dt| across the run. Useful for spotting parameters that
      // affect oscillation amplitude even when the final value is the same.
      if (series.length < 2) return 0;
      let acc = 0;
      let n = 0;
      for (let i = 1; i < series.length; i++) {
        const dt = (time[i] ?? 0) - (time[i - 1] ?? 0);
        if (dt > 0) {
          acc += Math.abs(series[i]! - series[i - 1]!) / dt;
          n++;
        }
      }
      return n > 0 ? acc / n : 0;
    }
  }
}
