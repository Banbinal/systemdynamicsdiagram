import { useMemo, useRef, useState } from 'react';

interface PhasePlotProps {
  readonly time: Float64Array;
  readonly xValues: Float64Array;
  readonly yValues: Float64Array;
  readonly xLabel: string;
  readonly yLabel: string;
  /** Stroke colour at the trajectory's end. Start fades from light to this. */
  readonly color: string;
}

interface HoverState {
  readonly idx: number;
  readonly pxRel: number;
  readonly pyRel: number;
}

/**
 * Phase portrait: plots the trajectory of (X(t), Y(t)) in state space.
 *
 * Reveals dynamical features that are invisible on the time chart — closed
 * orbits (Lotka-Volterra), spiral attractors, fixed points, bifurcation
 * topology. The trajectory's colour fades from light to the series colour so
 * the temporal direction stays legible. Start and end are marked with an
 * open and filled dot respectively.
 */
export function PhasePlot({ time, xValues, yValues, xLabel, yLabel, color }: PhasePlotProps) {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<HoverState | null>(null);

  const W = 880;
  const H = 480;
  const M = { top: 14, right: 28, bottom: 36, left: 64 };
  const innerW = W - M.left - M.right;
  const innerH = H - M.top - M.bottom;

  const n = Math.min(xValues.length, yValues.length, time.length);

  const { xMin, xMax, yMin, yMax } = useMemo(() => {
    let xMin = Infinity, xMax = -Infinity, yMin = Infinity, yMax = -Infinity;
    for (let i = 0; i < n; i++) {
      const x = xValues[i]!;
      const y = yValues[i]!;
      if (Number.isFinite(x)) {
        if (x < xMin) xMin = x;
        if (x > xMax) xMax = x;
      }
      if (Number.isFinite(y)) {
        if (y < yMin) yMin = y;
        if (y > yMax) yMax = y;
      }
    }
    if (xMin === xMax) { xMin -= 0.5; xMax += 0.5; }
    if (yMin === yMax) { yMin -= 0.5; yMax += 0.5; }
    const xPad = (xMax - xMin) * 0.06;
    const yPad = (yMax - yMin) * 0.06;
    return { xMin: xMin - xPad, xMax: xMax + xPad, yMin: yMin - yPad, yMax: yMax + yPad };
  }, [xValues, yValues, n]);

  if (n === 0) {
    return (
      <div className="chart-wrapper">
        <svg
          className="chart"
          viewBox={`0 0 ${W} ${H}`}
          preserveAspectRatio="xMidYMid meet"
          role="img"
          aria-label="Empty phase plot"
        >
          <text x={W / 2} y={H / 2} textAnchor="middle" fill="var(--ink-3)">
            — no data —
          </text>
        </svg>
      </div>
    );
  }

  const xScale = (v: number) => M.left + ((v - xMin) / (xMax - xMin)) * innerW;
  const yScale = (v: number) => M.top + innerH - ((v - yMin) / (yMax - yMin)) * innerH;
  const xTicks = niceTicks(xMin, xMax, 6);
  const yTicks = niceTicks(yMin, yMax, 5);

  // Build the trajectory as a series of short segments so we can colour each
  // segment along a gradient (start = light, end = full saturation). With ~400
  // recorded steps a typical model still renders in well under a frame.
  const segments: Array<{ d: string; opacity: number }> = [];
  for (let i = 1; i < n; i++) {
    const xa = xValues[i - 1]!;
    const ya = yValues[i - 1]!;
    const xb = xValues[i]!;
    const yb = yValues[i]!;
    if (!Number.isFinite(xa) || !Number.isFinite(ya) || !Number.isFinite(xb) || !Number.isFinite(yb)) continue;
    const t = i / (n - 1);
    // Opacity ramps from 0.2 (start) to 1 (end) so the eye sees motion.
    const opacity = 0.2 + 0.8 * t;
    segments.push({
      d: `M ${xScale(xa)} ${yScale(ya)} L ${xScale(xb)} ${yScale(yb)}`,
      opacity,
    });
  }

  const startPt = { x: xScale(xValues[0]!), y: yScale(yValues[0]!) };
  const endPt = { x: xScale(xValues[n - 1]!), y: yScale(yValues[n - 1]!) };

  // Direction arrow at ~75% along the trajectory.
  const arrowIdx = Math.floor(n * 0.75);
  const arrowAt = arrowIdx > 0 && arrowIdx < n
    ? buildArrow(
        xScale(xValues[arrowIdx - 1]!),
        yScale(yValues[arrowIdx - 1]!),
        xScale(xValues[arrowIdx]!),
        yScale(yValues[arrowIdx]!),
      )
    : null;

  // Hover: snap to nearest data point in screen-space distance.
  function onMouseMove(e: React.MouseEvent<HTMLDivElement>) {
    const wrapper = wrapperRef.current;
    if (!wrapper) return;
    const rect = wrapper.getBoundingClientRect();
    if (rect.width === 0) return;
    const pxRel = e.clientX - rect.left;
    const pyRel = e.clientY - rect.top;
    const ratio = W / rect.width;
    const sx = pxRel * ratio;
    const sy = pyRel * ratio;
    let bestI = 0;
    let bestD = Infinity;
    for (let i = 0; i < n; i++) {
      const dx = xScale(xValues[i]!) - sx;
      const dy = yScale(yValues[i]!) - sy;
      const d = dx * dx + dy * dy;
      if (d < bestD) { bestD = d; bestI = i; }
    }
    if (bestD > 60 * 60) {
      setHover(null);
      return;
    }
    setHover({ idx: bestI, pxRel, pyRel });
  }

  return (
    <div
      className="chart-wrapper"
      ref={wrapperRef}
      onMouseMove={onMouseMove}
      onMouseLeave={() => setHover(null)}
    >
      <svg
        className="chart"
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="xMidYMid meet"
        role="img"
        aria-label={`Phase plot of ${yLabel} vs ${xLabel}`}
      >
        {/* Axes */}
        <g className="chart-axis">
          {/* X */}
          {xTicks.map((t) => (
            <g key={`xt-${t}`}>
              <line
                x1={xScale(t)}
                x2={xScale(t)}
                y1={M.top + innerH}
                y2={M.top + innerH + 4}
                stroke="var(--ink-3)"
              />
              <text
                x={xScale(t)}
                y={M.top + innerH + 18}
                textAnchor="middle"
                fontSize="11"
                fill="var(--ink-3)"
                fontFamily="var(--font-mono)"
              >
                {fmtTick(t)}
              </text>
            </g>
          ))}
          <text
            x={M.left + innerW / 2}
            y={H - 4}
            textAnchor="middle"
            fontSize="12"
            fill="var(--ink-2)"
            fontFamily="var(--font-sans)"
          >
            {xLabel}
          </text>
          {/* Y */}
          {yTicks.map((t) => (
            <g key={`yt-${t}`}>
              <line
                x1={M.left - 4}
                x2={M.left + innerW}
                y1={yScale(t)}
                y2={yScale(t)}
                stroke="var(--border)"
                strokeDasharray={t === 0 ? '' : '2 3'}
              />
              <text
                x={M.left - 8}
                y={yScale(t) + 4}
                textAnchor="end"
                fontSize="11"
                fill="var(--ink-3)"
                fontFamily="var(--font-mono)"
              >
                {fmtTick(t)}
              </text>
            </g>
          ))}
          <text
            transform={`translate(14, ${M.top + innerH / 2}) rotate(-90)`}
            textAnchor="middle"
            fontSize="12"
            fill="var(--ink-2)"
            fontFamily="var(--font-sans)"
          >
            {yLabel}
          </text>
          {/* Plot border */}
          <rect
            x={M.left}
            y={M.top}
            width={innerW}
            height={innerH}
            fill="none"
            stroke="var(--border)"
          />
        </g>

        {/* Trajectory: many short segments with progress-based opacity. */}
        <g>
          {segments.map((s, i) => (
            <path
              key={i}
              d={s.d}
              fill="none"
              stroke={color}
              strokeWidth={1.6}
              strokeOpacity={s.opacity}
              strokeLinecap="round"
            />
          ))}
        </g>

        {/* Direction arrow at 75% along. */}
        {arrowAt && (
          <polygon
            points={arrowAt}
            fill={color}
            opacity={0.85}
          />
        )}

        {/* Start = open dot, end = filled dot. */}
        <circle
          cx={startPt.x}
          cy={startPt.y}
          r={4.5}
          fill="var(--surface)"
          stroke={color}
          strokeWidth={1.5}
        />
        <circle cx={endPt.x} cy={endPt.y} r={5} fill={color} />

        {/* Hover dot. */}
        {hover && (
          <circle
            cx={xScale(xValues[hover.idx]!)}
            cy={yScale(yValues[hover.idx]!)}
            r={5.5}
            fill="none"
            stroke={color}
            strokeWidth={2}
          />
        )}
      </svg>

      {hover && (
        <div
          className="chart-tooltip"
          style={{
            left: hover.pxRel + 12,
            top: hover.pyRel + 12,
          }}
        >
          <div className="chart-tooltip__time">t = {fmtTick(time[hover.idx]!)}</div>
          <div className="chart-tooltip__row">
            <span className="chart-tooltip__label">{xLabel}</span>
            <span className="chart-tooltip__value">{fmtTick(xValues[hover.idx]!)}</span>
          </div>
          <div className="chart-tooltip__row">
            <span className="chart-tooltip__label">{yLabel}</span>
            <span className="chart-tooltip__value">{fmtTick(yValues[hover.idx]!)}</span>
          </div>
        </div>
      )}
    </div>
  );
}

/** Build an arrowhead polygon at the segment from (ax,ay) to (bx,by). */
function buildArrow(ax: number, ay: number, bx: number, by: number): string {
  const dx = bx - ax;
  const dy = by - ay;
  const len = Math.hypot(dx, dy) || 1;
  const ux = dx / len;
  const uy = dy / len;
  // Arrowhead 8px long, 6px wide, sitting at the tip (b).
  const tipX = bx;
  const tipY = by;
  const baseX = bx - ux * 8;
  const baseY = by - uy * 8;
  const px = -uy * 4;
  const py = ux * 4;
  return `${tipX},${tipY} ${baseX + px},${baseY + py} ${baseX - px},${baseY - py}`;
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
    const decimals = Math.max(0, -Math.floor(Math.log10(stepSize)));
    const factor = Math.pow(10, decimals);
    ticks.push(Math.round(rounded * factor) / factor);
  }
  return ticks;
}

function fmtTick(v: number): string {
  if (!Number.isFinite(v)) return String(v);
  if (v === 0) return '0';
  const abs = Math.abs(v);
  if (abs >= 1000 || abs < 0.01) return v.toPrecision(3);
  if (abs >= 100) return v.toFixed(0);
  if (abs >= 10) return v.toFixed(1);
  return v.toFixed(2);
}
