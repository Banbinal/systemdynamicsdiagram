import { useEffect, useMemo, useState } from 'react';

import {
  hasErrors,
  simulateAll,
  type CompiledProgram,
  type VariationResult,
} from '@sysdyn/core';

import { Chart, type ChartSeries } from './Chart.tsx';

const SERIES_COLORS = [
  'var(--series-1)',
  'var(--series-2)',
  'var(--series-3)',
  'var(--series-4)',
  'var(--series-5)',
  'var(--series-6)',
  'var(--series-7)',
  'var(--series-8)',
];

function shortName(fqn: string): string {
  const i = fqn.lastIndexOf('.');
  return i < 0 ? fqn : fqn.slice(i + 1);
}

interface CompareProps {
  readonly program: CompiledProgram | null;
  readonly stockFqns: readonly string[];
}

export function Compare({ program, stockFqns }: CompareProps) {
  // Run all variations once per program identity. simulateAll caps at 64 by default.
  const variations = useMemo<readonly VariationResult[]>(() => {
    if (!program) return [];
    return simulateAll(program);
  }, [program]);

  const [stockFqn, setStockFqn] = useState<string>(stockFqns[0] ?? '');
  const [hidden, setHidden] = useState<ReadonlySet<number>>(() => new Set());

  // When the model changes, reset selections.
  useEffect(() => {
    setStockFqn((prev) => (prev && stockFqns.includes(prev) ? prev : stockFqns[0] ?? ''));
    setHidden(new Set());
  }, [program, stockFqns]);

  if (!program) {
    return <div className="placeholder">Compile a model to see variations.</div>;
  }
  if (variations.length <= 1) {
    return (
      <div className="placeholder">
        Add at least one <code>scenario</code> or <code>sweep</code> to the model
        to compare alternatives. The current model has only the <em>Base</em> run.
      </div>
    );
  }
  if (stockFqns.length === 0) {
    return <div className="placeholder">No stocks to compare.</div>;
  }

  // Build Chart series — one per variation, all showing the picked stock.
  // Use the longest variation's time array as the x-domain; aborted variations
  // will simply stop drawing earlier than the rest.
  let timeRef = variations[0]!.result.time;
  for (const v of variations) {
    if (v.result.time.length > timeRef.length) timeRef = v.result.time;
  }

  const series: ChartSeries[] = variations.map((v, i) => {
    const values = v.result.stocks[stockFqn] ?? new Float64Array();
    return {
      fqn: `var_${i}`,
      label: compactLabel(v),
      values,
      color: SERIES_COLORS[i % SERIES_COLORS.length]!,
      visible: !hidden.has(i),
    };
  });

  const visibleCount = series.filter((s) => s.visible).length;

  const toggleVariation = (i: number) =>
    setHidden((prev) => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });

  const showAll = () => setHidden(new Set());
  const hideAll = () => setHidden(new Set(variations.map((_, i) => i)));

  return (
    <div className="card">
      <div className="card__title">
        <h3 className="card__title-text">Compare scenarios &amp; sweeps</h3>
        <span className="card__title-sub">
          {variations.length} variations · {visibleCount} visible
        </span>
      </div>

      <div className="compare-controls">
        <label className="compare-controls__label">
          Stock
          <select
            className="model-select"
            value={stockFqn}
            onChange={(e) => setStockFqn(e.target.value)}
            aria-label="Stock to compare"
          >
            {stockFqns.map((fqn) => (
              <option key={fqn} value={fqn}>
                {fqn}
              </option>
            ))}
          </select>
        </label>

        <div className="compare-controls__bulk">
          <button type="button" className="btn btn--ghost" onClick={showAll}>
            Show all
          </button>
          <button type="button" className="btn btn--ghost" onClick={hideAll}>
            Hide all
          </button>
        </div>
      </div>

      <Chart time={timeRef} series={series} />

      <table className="tt compare-table">
        <thead>
          <tr>
            <th style={{ width: 40 }}></th>
            <th style={{ width: 28 }}></th>
            <th>Variation</th>
            <th>Scenario</th>
            <th>Sweep values</th>
            <th className="num">t = end</th>
            <th className="num">Δ vs Base</th>
          </tr>
        </thead>
        <tbody>
          {variations.map((v, i) => {
            const values = v.result.stocks[stockFqn] ?? new Float64Array();
            const final = values.length > 0 ? values[values.length - 1]! : NaN;
            const baseFinal =
              variations[0]!.result.stocks[stockFqn]?.[
                (variations[0]!.result.stocks[stockFqn]?.length ?? 1) - 1
              ] ?? NaN;
            const delta = final - baseFinal;
            const aborted = v.result.abortedAt !== undefined;
            const errored = hasErrors(v.result.diagnostics);
            return (
              <tr key={i} className={hidden.has(i) ? 'compare-row--hidden' : ''}>
                <td>
                  <input
                    type="checkbox"
                    checked={!hidden.has(i)}
                    onChange={() => toggleVariation(i)}
                    aria-label={`Toggle ${v.label}`}
                  />
                </td>
                <td>
                  <span
                    className="compare-swatch"
                    style={{ background: SERIES_COLORS[i % SERIES_COLORS.length] }}
                  />
                </td>
                <td>
                  <span className="compare-label">{compactLabel(v)}</span>
                  {aborted && <span className="compare-tag compare-tag--err">aborted</span>}
                  {errored && !aborted && <span className="compare-tag compare-tag--warn">err</span>}
                </td>
                <td className="compare-cell-muted">{v.scenarioName ?? 'Base'}</td>
                <td className="compare-cell-muted">{formatSweep(v.sweepValues)}</td>
                <td className="num">{fmt(final)}</td>
                <td
                  className={
                    'num ' +
                    (i === 0 || !Number.isFinite(delta) || Math.abs(delta) < 1e-9
                      ? ''
                      : delta > 0
                        ? 'num--delta-pos'
                        : 'num--delta-neg')
                  }
                >
                  {i === 0 ? '—' : fmtDelta(delta)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/** Compact a verbose label like "Base (InterestRate=0.03)" → "0.03". */
function compactLabel(v: VariationResult): string {
  const sweepEntries = Object.entries(v.sweepValues);
  const sweepStr = sweepEntries
    .map(([k, val]) => `${shortName(k)}=${fmtNumberShort(val)}`)
    .join(', ');
  const scn = v.scenarioName ?? 'Base';
  if (sweepStr) return `${scn} · ${sweepStr}`;
  return scn;
}

function formatSweep(values: Readonly<Record<string, number>>): string {
  const entries = Object.entries(values);
  if (entries.length === 0) return '—';
  return entries.map(([k, v]) => `${shortName(k)}=${fmtNumberShort(v)}`).join(', ');
}

function fmtNumberShort(v: number): string {
  if (!Number.isFinite(v)) return String(v);
  if (v === 0) return '0';
  const abs = Math.abs(v);
  if (abs >= 1000) return v.toFixed(0);
  if (abs >= 1) return v.toFixed(2);
  if (abs >= 0.001) return v.toFixed(4);
  return v.toExponential(1);
}

function fmt(v: number): string {
  if (!Number.isFinite(v)) return String(v);
  if (v === 0) return '0';
  const abs = Math.abs(v);
  if (abs >= 100_000) return v.toExponential(2);
  if (abs >= 1) return v.toFixed(2);
  if (abs >= 0.001) return v.toFixed(4);
  return v.toExponential(2);
}

function fmtDelta(v: number): string {
  if (!Number.isFinite(v)) return String(v);
  if (Math.abs(v) < 1e-9) return '±0';
  const sign = v > 0 ? '+' : '−';
  return sign + fmt(Math.abs(v));
}
