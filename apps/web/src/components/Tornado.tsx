import { useMemo, useState } from 'react';

import type { CompiledProgram } from '@sysdyn/core';

import { computeTornado, type TornadoMetric } from '../lib/tornado.ts';

interface TornadoProps {
  readonly program: CompiledProgram | null;
  readonly stockFqns: readonly string[];
}

const METRIC_LABELS: Record<TornadoMetric, string> = {
  final: 'Final value',
  peak: 'Peak value',
  trough: 'Trough value',
  integral: 'Integral over time',
  meanAbsRate: 'Mean |rate|',
};

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

/**
 * One-at-a-time sensitivity bar chart. For each declared `sweep`, varies
 * that single constant from low to high (others held at baseline) and shows
 * the resulting swing on the chosen output metric of the focus stock.
 *
 * Bars are sorted by absolute amplitude descending — the canonical "tornado"
 * shape where the most influential parameter sits on top.
 */
export function Tornado({ program, stockFqns }: TornadoProps) {
  const [focus, setFocus] = useState<string>(stockFqns[0] ?? '');
  const [metric, setMetric] = useState<TornadoMetric>('final');

  // Reset focus when the model changes — a stale FQN would silently produce
  // a no-op tornado.
  useMemo(() => {
    if (focus && !stockFqns.includes(focus) && stockFqns.length > 0) {
      setFocus(stockFqns[0]!);
    } else if (!focus && stockFqns.length > 0) {
      setFocus(stockFqns[0]!);
    }
  }, [stockFqns, focus]);

  const result = useMemo(() => {
    if (!program || !focus) return null;
    try {
      return computeTornado(program, { focusFqn: focus, metric });
    } catch {
      return null;
    }
  }, [program, focus, metric]);

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
          Each sweep contributes one bar to the tornado, ranked by |swing|.
        </p>
      </div>
    );
  }
  if (!result || result.bars.length === 0) {
    return (
      <div className="placeholder">
        Sensitivity unavailable for this configuration.
      </div>
    );
  }

  // ── Layout ────────────────────────────────────────────────────────────────
  const W = 880;
  const rowH = 32;
  const labelW = 200;
  const valueW = 90;
  const M = { top: 36, right: 24, bottom: 14, left: 16 };
  const innerW = W - M.left - M.right - labelW - valueW;
  const innerH = result.bars.length * rowH;
  const H = M.top + innerH + M.bottom;

  // X scale spans the combined range of every bar's endpoints + baseline.
  const span = Math.max(1e-12, result.outMax - result.outMin);
  const pad = span * 0.06;
  const xMin = result.outMin - pad;
  const xMax = result.outMax + pad;
  const xScale = (v: number) => M.left + labelW + ((v - xMin) / (xMax - xMin)) * innerW;
  const baselineX = xScale(result.baseline);

  return (
    <div className="tornado">
      <div className="tornado__head">
        <label className="tornado__field">
          <span>Focus stock</span>
          <select value={focus} onChange={(e) => setFocus(e.target.value)}>
            {stockFqns.map((fqn) => (
              <option key={fqn} value={fqn}>{shortName(fqn)}</option>
            ))}
          </select>
        </label>
        <label className="tornado__field">
          <span>Metric</span>
          <select value={metric} onChange={(e) => setMetric(e.target.value as TornadoMetric)}>
            {(Object.keys(METRIC_LABELS) as TornadoMetric[]).map((m) => (
              <option key={m} value={m}>{METRIC_LABELS[m]}</option>
            ))}
          </select>
        </label>
        <span className="tornado__baseline">
          baseline: <code>{fmt(result.baseline)}</code>
        </span>
      </div>
      <div className="chart-wrapper">
        <svg
          className="chart"
          viewBox={`0 0 ${W} ${H}`}
          preserveAspectRatio="xMidYMid meet"
          role="img"
          aria-label={`Tornado of ${shortName(focus)} ${METRIC_LABELS[metric]}`}
        >
          {/* Axis range labels at top. */}
          <text
            x={M.left + labelW}
            y={M.top - 12}
            textAnchor="start"
            fontSize="10"
            fontFamily="var(--font-mono)"
            fill="var(--ink-3)"
          >
            {fmt(xMin)}
          </text>
          <text
            x={M.left + labelW + innerW}
            y={M.top - 12}
            textAnchor="end"
            fontSize="10"
            fontFamily="var(--font-mono)"
            fill="var(--ink-3)"
          >
            {fmt(xMax)}
          </text>
          {/* Baseline line. */}
          <line
            x1={baselineX}
            x2={baselineX}
            y1={M.top - 4}
            y2={M.top + innerH}
            stroke="var(--ink-2)"
            strokeWidth={1}
            strokeDasharray="3 3"
          />
          <text
            x={baselineX}
            y={M.top - 18}
            textAnchor="middle"
            fontSize="9"
            fontFamily="var(--font-mono)"
            fill="var(--ink-2)"
          >
            baseline
          </text>

          {/* Bars. */}
          {result.bars.map((bar, i) => {
            const y = M.top + i * rowH + rowH / 2;
            const x0 = xScale(bar.outLow);
            const x1 = xScale(bar.outHigh);
            const xMin_ = Math.min(x0, x1);
            const xMax_ = Math.max(x0, x1);
            const lowSide = bar.outLow < bar.outBaseline;
            // Two-tone bar: red (down from baseline) on the left, green on the right.
            return (
              <g key={bar.paramFqn}>
                {/* Param label */}
                <text
                  x={M.left + labelW - 8}
                  y={y + 4}
                  textAnchor="end"
                  fontSize="11"
                  fontFamily="var(--font-mono)"
                  fill="var(--ink-1)"
                >
                  {shortName(bar.paramFqn)}
                </text>
                {/* Range hint under the label */}
                <text
                  x={M.left + labelW - 8}
                  y={y + 16}
                  textAnchor="end"
                  fontSize="9"
                  fontFamily="var(--font-mono)"
                  fill="var(--ink-3)"
                >
                  {fmt(bar.low)} → {fmt(bar.high)}
                </text>

                {/* Negative-side bar (output below baseline). */}
                {xMin_ < baselineX && (
                  <rect
                    x={xMin_}
                    y={y - 9}
                    width={Math.min(xMax_, baselineX) - xMin_}
                    height={18}
                    fill={lowSide ? '#B23A2C' : '#2E7D5C'}
                    fillOpacity={0.75}
                  />
                )}
                {/* Positive-side bar (output above baseline). */}
                {xMax_ > baselineX && (
                  <rect
                    x={Math.max(xMin_, baselineX)}
                    y={y - 9}
                    width={xMax_ - Math.max(xMin_, baselineX)}
                    height={18}
                    fill={lowSide ? '#2E7D5C' : '#B23A2C'}
                    fillOpacity={0.75}
                  />
                )}

                {/* Value labels at each end. */}
                <text
                  x={xMin_ - 6}
                  y={y + 4}
                  textAnchor="end"
                  fontSize="10"
                  fontFamily="var(--font-mono)"
                  fill="var(--ink-2)"
                >
                  {fmt(bar.outLow < bar.outHigh ? bar.outLow : bar.outHigh)}
                </text>
                <text
                  x={xMax_ + 6}
                  y={y + 4}
                  textAnchor="start"
                  fontSize="10"
                  fontFamily="var(--font-mono)"
                  fill="var(--ink-2)"
                >
                  {fmt(bar.outLow < bar.outHigh ? bar.outHigh : bar.outLow)}
                </text>
              </g>
            );
          })}
        </svg>
      </div>
    </div>
  );
}
