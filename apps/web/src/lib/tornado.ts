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
