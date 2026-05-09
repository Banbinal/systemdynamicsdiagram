import { Fragment, useMemo, useState } from 'react';

import type { CompiledProgram } from '@sysdyn/core';

import {
  computeTornadoMatrix,
  type TornadoBar,
  type TornadoMatrixCell,
  type TornadoMetric,
} from '../lib/tornado.ts';

interface TornadoProps {
  readonly program: CompiledProgram | null;
  readonly stockFqns: readonly string[];
}

const METRIC_LABELS: Record<TornadoMetric, string> = {
  final: 'Final',
  peak: 'Peak',
  trough: 'Trough',
  integral: 'Integral',
  meanAbsRate: 'Mean |rate|',
};

const METRICS: readonly TornadoMetric[] = [
  'final',
  'peak',
  'trough',
  'integral',
  'meanAbsRate',
];

function shortName(fqn: string): string {
  const i = fqn.lastIndexOf('.');
  return i < 0 ? fqn : fqn.slice(i + 1);
}

function fmt(v: number): string {
  if (!Number.isFinite(v)) return String(v);
  if (v === 0) return '0';
  const abs = Math.abs(v);
  if (abs >= 1000 || abs < 0.01) return v.toPrecision(3);
  if (abs >= 100) return v.toFixed(0);
  if (abs >= 10) return v.toFixed(1);
  return v.toFixed(2);
}

function fmtSigned(v: number): string {
  if (!Number.isFinite(v)) return String(v);
  if (v === 0) return '0';
  return (v > 0 ? '+' : '') + fmt(v);
}

/** A small bar drawn inside one (stock × metric) cell on a symmetric scale
 *  centered on the baseline. The cell-wide scale runs from −M to +M where
 *  M is the largest absolute deviation from baseline among any param's
 *  endpoint in the same cell — so bars within a cell are directly
 *  comparable in width. Right of center = output rose (green), left of
 *  center = output fell (red). */
function MiniBar({
  bar,
  cell,
  cellMaxDev,
}: {
  bar: TornadoBar;
  cell: TornadoMatrixCell;
  cellMaxDev: number;
}) {
  const W = 96;
  const H = 10;
  const half = W / 2;
  const M = Math.max(cellMaxDev, 1e-12);
  // Map deviation from baseline → x in [0, W], with baseline at W/2.
  const dev = (v: number) => half + ((v - cell.baseline) / M) * half;
  const x0 = dev(bar.outLow);
  const x1 = dev(bar.outHigh);
  const xLo = Math.min(x0, x1);
  const xHi = Math.max(x0, x1);
  const swing = bar.outHigh - bar.outLow;

  return (
    <span className="mini-bar" title={
      `${shortName(bar.paramFqn)}\n` +
      `output ${fmt(bar.outLow)} → ${fmt(bar.outHigh)}\n` +
      `baseline ${fmt(bar.outBaseline)} ` +
      `(Δ ${fmtSigned(bar.outLow - bar.outBaseline)} … ${fmtSigned(bar.outHigh - bar.outBaseline)})`
    }>
      <svg width={W} height={H} role="img" aria-hidden="true">
        {/* below-baseline segment (red, output fell) */}
        {xLo < half && (
          <rect
            x={xLo}
            y={2}
            width={Math.min(xHi, half) - xLo}
            height={H - 4}
            fill="#B23A2C"
            fillOpacity={0.82}
            rx={1}
          />
        )}
        {/* above-baseline segment (green, output rose) */}
        {xHi > half && (
          <rect
            x={Math.max(xLo, half)}
            y={2}
            width={xHi - Math.max(xLo, half)}
            height={H - 4}
            fill="#2E7D5C"
            fillOpacity={0.82}
            rx={1}
          />
        )}
        {/* baseline line — drawn last so it sits on top of the bar */}
        <line
          x1={half}
          x2={half}
          y1={0}
          y2={H}
          stroke="var(--ink-1)"
          strokeWidth={1}
        />
      </svg>
      <span className="mini-bar__num">{fmt(Math.abs(swing))}</span>
    </span>
  );
}

/**
 * Sensitivity matrix: rows × columns = stocks × metrics, each cell holds a
 * mini bar per declared `sweep`. Replaces the focus/metric dropdowns of the
 * earlier single-tornado view — the user sees every (stock, metric) result
 * at once and scrolls instead of clicking through selectors.
 *
 * Bars are sorted globally by aggregate normalised |swing|, so the most
 * influential param sits on top of every section. Click ⓘ next to a param
 * name to peek at its input range.
 */
export function Tornado({ program, stockFqns }: TornadoProps) {
  const [showAbout, setShowAbout] = useState(true);
  const [openRanges, setOpenRanges] = useState<ReadonlySet<string>>(() => new Set());

  const matrix = useMemo(() => {
    if (!program) return null;
    try {
      return computeTornadoMatrix(program, { stocks: stockFqns, metrics: METRICS });
    } catch {
      return null;
    }
  }, [program, stockFqns]);

  if (!program) {
    return <div className="placeholder">— compile a model to run sensitivity —</div>;
  }
  if (program.sweeps.length === 0) {
    return (
      <div className="tornado-empty">
        <p>
          No <code>sweep</code> declarations. Add one to vary a parameter:
        </p>
        <pre className="tornado-empty__example">{`sweep BirthRate = [0.01, 0.05, 0.10]`}</pre>
        <p className="tornado-empty__hint">
          Each sweep contributes one bar to every (stock × metric) cell, ranked
          by |swing|.
        </p>
      </div>
    );
  }
  if (!matrix || matrix.params.length === 0) {
    return (
      <div className="placeholder">Sensitivity unavailable for this configuration.</div>
    );
  }

  const toggleRange = (paramFqn: string) =>
    setOpenRanges((prev) => {
      const next = new Set(prev);
      if (next.has(paramFqn)) next.delete(paramFqn);
      else next.add(paramFqn);
      return next;
    });

  return (
    <div className="tornado">
      {showAbout && (
        <div className="tornado__about">
          <div className="tornado__about-head">
            <span className="tornado__about-tag">Tornado · sensitivity matrix</span>
            <button
              type="button"
              className="tornado__about-close"
              onClick={() => setShowAbout(false)}
              aria-label="Hide explanation"
            >
              ×
            </button>
          </div>
          <p className="tornado__about-lede">
            <strong>Which parameter moves the needle most?</strong>{' '}
            Each <em>row</em> is one stock × one swept parameter. Each{' '}
            <em>column</em> is a summary metric (final value, peak, …) computed
            over the full simulation. The bar in a cell shows how much that
            parameter swings that metric when pushed from its low to its high
            (others held at baseline). The dashed tick is the baseline. Bars
            are sorted globally by <code>|swing|</code> normalised against
            baseline, so the row at the top is the parameter your model is
            most sensitive to overall — the one worth measuring or controlling
            more tightly.
          </p>
          <ul className="tornado__about-legend">
            <li>
              <span className="tornado__sw tornado__sw--up" /> output{' '}
              <em>rose</em> above baseline
            </li>
            <li>
              <span className="tornado__sw tornado__sw--dn" /> output{' '}
              <em>fell</em> below baseline
            </li>
            <li>
              <span className="tornado__sw tornado__sw--bl" /> dashed = baseline
              (every sweep at its first value)
            </li>
            <li>
              <span className="tornado__about-info">ⓘ</span> click next to a
              param to see its input range
            </li>
          </ul>
        </div>
      )}

      {!showAbout && (
        <div className="tornado__head">
          <button
            type="button"
            className="tornado__about-show"
            onClick={() => setShowAbout(true)}
          >
            ⓘ what is this?
          </button>
        </div>
      )}

      <div className="tornado-matrix-wrap">
        <table className="tornado-matrix">
          <thead>
            <tr>
              <th className="tornado-matrix__corner">parameter</th>
              {METRICS.map((m) => (
                <th key={m} className="tornado-matrix__metric">
                  {METRIC_LABELS[m]}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {stockFqns.map((stock, stockIdx) => {
              const stockCells = matrix.cells[stock] ?? {};
              return (
                <Fragment key={stock}>
                  <tr className="tornado-matrix__stock-row">
                    <th colSpan={METRICS.length + 1}>
                      <span className="tornado-matrix__stock-tag">stock</span>{' '}
                      {shortName(stock)}
                    </th>
                  </tr>
                  {matrix.params.map((paramFqn) => {
                    const open = openRanges.has(paramFqn);
                    const range = matrix.ranges[paramFqn];
                    return (
                      <Fragment key={`${stock}-${paramFqn}`}>
                        <tr className="tornado-matrix__row">
                          <th className="tornado-matrix__param">
                            <button
                              type="button"
                              className="tornado-matrix__info"
                              aria-expanded={open}
                              aria-label={`Toggle input range for ${shortName(paramFqn)}`}
                              onClick={() => toggleRange(paramFqn)}
                            >
                              ⓘ
                            </button>
                            <span className="tornado-matrix__param-name">
                              {shortName(paramFqn)}
                            </span>
                          </th>
                          {METRICS.map((m) => {
                            const cell = stockCells[m];
                            const bar = cell?.bars.find((b) => b.paramFqn === paramFqn);
                            // Cell-wide max deviation from baseline (across
                            // every param's endpoints) — fixes the scale so
                            // every bar in this cell is comparable.
                            const cellMaxDev = cell
                              ? cell.bars.reduce((acc, b) => {
                                  const lo = Math.abs(b.outLow - cell.baseline);
                                  const hi = Math.abs(b.outHigh - cell.baseline);
                                  return Math.max(acc, lo, hi);
                                }, 0)
                              : 0;
                            return (
                              <td key={m} className="tornado-matrix__cell">
                                {bar && cell ? (
                                  <MiniBar bar={bar} cell={cell} cellMaxDev={cellMaxDev} />
                                ) : (
                                  <span className="tornado-matrix__empty">—</span>
                                )}
                              </td>
                            );
                          })}
                        </tr>
                        {open && stockIdx === 0 && range && (
                          <tr className="tornado-matrix__range-row">
                            <td colSpan={METRICS.length + 1}>
                              <span className="tornado-matrix__range-label">
                                input range
                              </span>{' '}
                              <code>{shortName(paramFqn)}</code>
                              {' = '}
                              <code>{fmt(range.low)}</code> →{' '}
                              <code>{fmt(range.high)}</code>
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    );
                  })}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>

      <p className="tornado-matrix__footer">
        Cell scale is local — bar widths are comparable within a cell, not
        across cells. The number to the right of each bar is the absolute
        swing <code>|outHigh − outLow|</code>.
      </p>
    </div>
  );
}
