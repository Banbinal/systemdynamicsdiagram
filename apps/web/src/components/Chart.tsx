import { useMemo, useRef, useState } from 'react';

export interface ChartSeries {
  readonly fqn: string;
  readonly label: string;
  readonly values: Float64Array;
  readonly color: string;
  readonly visible: boolean;
}

/** Sterman-style reference mode: expected behaviour over time, drawn as a
 *  dashed overlay on top of the simulated series so the gap is visible. */
export interface ReferenceOverlay {
  readonly fqn: string;
  readonly points: ReadonlyArray<{ readonly t: number; readonly v: number }>;
  readonly color: string;
}

interface ChartProps {
  readonly time: Float64Array;
  readonly series: readonly ChartSeries[];
  readonly references?: readonly ReferenceOverlay[];
}

interface HoverState {
  readonly idx: number;
  readonly pxRel: number;   // pointer x, relative to wrapper
  readonly pyRel: number;
}

/**
 * SVG line chart with hover crosshair + floating tooltip (FT / Observable style).
 *
 *   - End-of-line labels render only when ≤ 4 visible series (otherwise they
 *     overlap; the tooltip is the canonical legend at scale).
 *   - On mousemove, snap to the nearest time index and render a vertical
 *     crosshair, dots on each visible series, and an HTML tooltip listing
 *     every series sorted descending by value at that t.
 */
export function Chart({ time, series, references }: ChartProps) {
  const visible = useMemo(() => series.filter((s) => s.visible), [series]);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<HoverState | null>(null);

  const W = 880;
  const H = 360;

  const showEndLabels = visible.length > 0 && visible.length <= 4;
  const M = {
    top: 14,
    right: showEndLabels ? 132 : 28,
    bottom: 28,
    left: 56,
  };
  const innerW = W - M.left - M.right;
  const innerH = H - M.top - M.bottom;

  if (time.length === 0 || visible.length === 0) {
    return (
      <div className="chart-wrapper">
        <svg
          className="chart"
          viewBox={`0 0 ${W} ${H}`}
          preserveAspectRatio="xMidYMid meet"
          role="img"
          aria-label="Empty chart"
        >
          <text x={W / 2} y={H / 2} textAnchor="middle" fill="var(--ink-3)">
            — no data —
          </text>
        </svg>
      </div>
    );
  }

  const tMin = time[0]!;
  const tMax = time[time.length - 1]!;

  let yMin = Infinity;
  let yMax = -Infinity;
  for (const s of visible) {
    for (let i = 0; i < s.values.length; i++) {
      const v = s.values[i]!;
      if (Number.isFinite(v)) {
        if (v < yMin) yMin = v;
        if (v > yMax) yMax = v;
      }
    }
  }
  // Reference modes participate in the y-range so the overlay stays inside
  // the plot area (otherwise a high-target reference would clip silently).
  if (references) {
    for (const r of references) {
      for (const p of r.points) {
        if (Number.isFinite(p.v)) {
          if (p.v < yMin) yMin = p.v;
          if (p.v > yMax) yMax = p.v;
        }
      }
    }
  }
  if (yMin === yMax) {
    yMin -= 0.5;
    yMax += 0.5;
  }
  const yPad = (yMax - yMin) * 0.06;
  yMin -= yPad;
  yMax += yPad;

  const xScale = (t: number) => M.left + ((t - tMin) / (tMax - tMin)) * innerW;
  const yScale = (v: number) => M.top + innerH - ((v - yMin) / (yMax - yMin)) * innerH;

  const xTicks = niceTicks(tMin, tMax, 6);
  const yTicks = niceTicks(yMin, yMax, 5);

  const baselineVisible = yMin <= 0 && yMax >= 0;

  // ── End-of-line label positioning (only when ≤ 4 series) ──────────────────
  const endPositions = showEndLabels
    ? visible
        .map((s) => ({
          s,
          y: yScale(s.values[s.values.length - 1]!),
          v: s.values[s.values.length - 1]!,
        }))
        .sort((a, b) => a.y - b.y)
    : [];
  const minGap = 14;
  for (let i = 1; i < endPositions.length; i++) {
    const prev = endPositions[i - 1]!;
    const cur = endPositions[i]!;
    if (cur.y - prev.y < minGap) cur.y = prev.y + minGap;
  }
  for (const p of endPositions) {
    if (p.y < M.top + 4) p.y = M.top + 4;
    if (p.y > H - M.bottom - 4) p.y = H - M.bottom - 4;
  }

  // ── Hover handlers ────────────────────────────────────────────────────────
  function onMouseMove(e: React.MouseEvent<HTMLDivElement>) {
    const wrapper = wrapperRef.current;
    if (!wrapper) return;
    const rect = wrapper.getBoundingClientRect();
    if (rect.width === 0) return;
    const pxRel = e.clientX - rect.left;
    const pyRel = e.clientY - rect.top;
    const ratioX = W / rect.width;
    const svgX = pxRel * ratioX;
    const dataX = tMin + ((svgX - M.left) / innerW) * (tMax - tMin);
    if (dataX < tMin - (tMax - tMin) * 0.05 || dataX > tMax + (tMax - tMin) * 0.05) {
      setHover(null);
      return;
    }
    // Find nearest time index. Time arrays in SD are uniformly spaced so we
    // can compute index directly, but stay linear-search-safe in case of decimation.
    let idx = 0;
    let bestDist = Infinity;
    for (let i = 0; i < time.length; i++) {
      const d = Math.abs(time[i]! - dataX);
      if (d < bestDist) {
        bestDist = d;
        idx = i;
      }
    }
    setHover({ idx, pxRel, pyRel });
  }

  function onMouseLeave() {
    setHover(null);
  }

  return (
    <div
      ref={wrapperRef}
      className="chart-wrapper"
      onMouseMove={onMouseMove}
      onMouseLeave={onMouseLeave}
    >
      <svg
        className="chart"
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="xMidYMid meet"
        role="img"
        aria-label="Time series"
      >
        <g className="grid">
          {yTicks.map((t) => (
            <line
              key={`yg-${t}`}
              x1={M.left}
              x2={W - M.right}
              y1={yScale(t)}
              y2={yScale(t)}
            />
          ))}
        </g>

        {baselineVisible && (
          <line
            x1={M.left}
            x2={W - M.right}
            y1={yScale(0)}
            y2={yScale(0)}
            stroke="var(--ink-3)"
            strokeWidth={1}
            strokeDasharray="2 3"
          />
        )}

        <g className="axis">
          <line x1={M.left} y1={M.top} x2={M.left} y2={H - M.bottom} />
          <line x1={M.left} y1={H - M.bottom} x2={W - M.right} y2={H - M.bottom} />
        </g>

        {yTicks.map((t) => (
          <text
            key={`yl-${t}`}
            x={M.left - 8}
            y={yScale(t) + 3}
            textAnchor="end"
          >
            {fmtNumber(t)}
          </text>
        ))}

        {xTicks.map((t) => (
          <g key={`x-${t}`}>
            <line
              x1={xScale(t)}
              x2={xScale(t)}
              y1={H - M.bottom}
              y2={H - M.bottom + 4}
              stroke="var(--ink-2)"
              strokeWidth={1}
            />
            <text x={xScale(t)} y={H - M.bottom + 16} textAnchor="middle">
              {fmtNumber(t)}
            </text>
          </g>
        ))}

        <text className="axis-title" x={W - M.right} y={H - 4} textAnchor="end">
          TIME →
        </text>

        {/* Reference modes: dashed overlay drawn behind the series so the
            simulated line stays foregrounded. Each reference's points are
            joined by a polyline (no smoothing — it's a target, not a fit). */}
        {references && references.map((r) => (
          <path
            key={`ref-${r.fqn}`}
            className="reference"
            fill="none"
            stroke={r.color}
            strokeWidth={1.4}
            strokeOpacity={0.6}
            strokeDasharray="6 4"
            d={r.points
              .map((p, i) => `${i === 0 ? 'M' : 'L'} ${xScale(p.t)} ${yScale(p.v)}`)
              .join(' ')}
          />
        ))}
        {/* Reference endpoint markers (small open circles) so the user can
            see the data points the curve interpolates through. */}
        {references && references.map((r) =>
          r.points.map((p, i) => (
            <circle
              key={`ref-${r.fqn}-pt-${i}`}
              cx={xScale(p.t)}
              cy={yScale(p.v)}
              r={3}
              fill="var(--surface)"
              stroke={r.color}
              strokeWidth={1.2}
              strokeOpacity={0.8}
            />
          )),
        )}

        {visible.map((s) => (
          <path
            key={s.fqn}
            className="series"
            stroke={s.color}
            d={pathFor(time, s.values, xScale, yScale)}
          />
        ))}

        {/* End-of-line labels — only for small series counts */}
        {showEndLabels &&
          endPositions.map(({ s, y, v }) => (
            <g key={`lbl-${s.fqn}`}>
              <line
                x1={W - M.right}
                x2={W - M.right + 6}
                y1={yScale(v)}
                y2={y}
                stroke={s.color}
                strokeWidth={0.75}
              />
              <text
                x={W - M.right + 10}
                y={y + 3}
                className="series-label"
                fill={s.color}
              >
                {s.label}
              </text>
            </g>
          ))}

        {/* Crosshair */}
        {hover && time[hover.idx] !== undefined && (
          <g className="crosshair">
            <line
              x1={xScale(time[hover.idx]!)}
              x2={xScale(time[hover.idx]!)}
              y1={M.top}
              y2={H - M.bottom}
            />
            {visible.map((s) => {
              const v = s.values[hover.idx];
              if (v === undefined || !Number.isFinite(v)) return null;
              return (
                <circle
                  key={`hd-${s.fqn}`}
                  cx={xScale(time[hover.idx]!)}
                  cy={yScale(v)}
                  r={3.5}
                  fill={s.color}
                  stroke="var(--surface)"
                  strokeWidth={1.5}
                />
              );
            })}
          </g>
        )}
      </svg>

      {hover && time[hover.idx] !== undefined && (
        <ChartTooltip
          t={time[hover.idx]!}
          series={visible}
          idx={hover.idx}
          pxRel={hover.pxRel}
          pyRel={hover.pyRel}
          wrapperWidth={wrapperRef.current?.getBoundingClientRect().width ?? 0}
          wrapperHeight={wrapperRef.current?.getBoundingClientRect().height ?? 0}
        />
      )}
    </div>
  );
}

interface TooltipProps {
  readonly t: number;
  readonly series: readonly ChartSeries[];
  readonly idx: number;
  readonly pxRel: number;
  readonly pyRel: number;
  readonly wrapperWidth: number;
  readonly wrapperHeight: number;
}

function ChartTooltip({
  t,
  series,
  idx,
  pxRel,
  pyRel,
  wrapperWidth,
  wrapperHeight,
}: TooltipProps) {
  const rows = series
    .map((s) => ({ s, v: s.values[idx] }))
    .filter((r): r is { s: ChartSeries; v: number } => typeof r.v === 'number' && Number.isFinite(r.v))
    .sort((a, b) => b.v - a.v);

  const TT_W = 240;
  const offset = 14;
  const flipX = pxRel + TT_W + offset > wrapperWidth - 8;
  const left = flipX ? Math.max(8, pxRel - TT_W - offset) : pxRel + offset;
  const top = Math.min(Math.max(8, pyRel + offset), Math.max(8, wrapperHeight - 80));

  return (
    <div className="chart-tooltip" style={{ left, top, width: TT_W }}>
      <div className="chart-tooltip__time">t = {fmtNumberPrecise(t)}</div>
      <div className="chart-tooltip__rows">
        {rows.map(({ s, v }) => (
          <div key={s.fqn} className="chart-tooltip__row">
            <span className="chart-tooltip__sw" style={{ background: s.color }} />
            <span className="chart-tooltip__lbl" title={s.label}>
              {s.label}
            </span>
            <span className="chart-tooltip__val">{fmtNumberPrecise(v)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function pathFor(
  time: Float64Array,
  vals: Float64Array,
  x: (t: number) => number,
  y: (v: number) => number,
): string {
  let d = '';
  let started = false;
  for (let i = 0; i < vals.length; i++) {
    const v = vals[i]!;
    if (!Number.isFinite(v)) {
      started = false;
      continue;
    }
    d += (started ? 'L' : 'M') + x(time[i]!).toFixed(2) + ' ' + y(v).toFixed(2) + ' ';
    started = true;
  }
  return d;
}

function niceTicks(min: number, max: number, count: number): number[] {
  if (!Number.isFinite(min) || !Number.isFinite(max) || min === max) return [min];
  const range = max - min;
  const rough = range / Math.max(1, count);
  const mag = Math.pow(10, Math.floor(Math.log10(Math.abs(rough))));
  const norm = rough / mag;
  const step = norm < 1.5 ? 1 : norm < 3 ? 2 : norm < 7 ? 5 : 10;
  const stepSize = step * mag;
  const start = Math.ceil(min / stepSize) * stepSize;
  const ticks: number[] = [];
  for (let v = start; v <= max + stepSize * 1e-9; v += stepSize) {
    const rounded = Math.abs(v) < stepSize * 1e-9 ? 0 : v;
    ticks.push(roundTo(rounded, stepSize));
  }
  return ticks;
}

function roundTo(v: number, step: number): number {
  const decimals = Math.max(0, -Math.floor(Math.log10(step)));
  const factor = Math.pow(10, decimals);
  return Math.round(v * factor) / factor;
}

function fmtNumber(v: number): string {
  if (v === 0) return '0';
  const abs = Math.abs(v);
  if (abs >= 10_000) {
    const sign = v < 0 ? '−' : '';
    if (abs >= 1_000_000) return sign + (abs / 1_000_000).toFixed(1) + 'M';
    return sign + (abs / 1000).toFixed(abs >= 100_000 ? 0 : 1) + 'k';
  }
  const sign = v < 0 ? '−' : '';
  const a = Math.abs(v);
  if (a >= 1000) return sign + a.toFixed(0);
  if (a >= 100) return sign + a.toFixed(0);
  if (a >= 10) return sign + a.toFixed(1);
  if (a >= 1) return sign + a.toFixed(2);
  if (a >= 0.01) return sign + a.toFixed(3);
  return sign + a.toExponential(1);
}

/** More precise formatter for tooltip — keep enough decimals to disambiguate close values. */
function fmtNumberPrecise(v: number): string {
  if (!Number.isFinite(v)) return String(v);
  if (v === 0) return '0';
  const abs = Math.abs(v);
  if (abs >= 1_000_000) return v.toExponential(3);
  if (abs >= 100_000) {
    return v.toLocaleString('en-US', { maximumFractionDigits: 0 });
  }
  if (abs >= 1) {
    return v.toLocaleString('en-US', { maximumFractionDigits: 3 });
  }
  if (abs >= 0.001) return v.toFixed(5);
  return v.toExponential(3);
}
