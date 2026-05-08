import { Handle, Position, type Node, type NodeProps } from '@xyflow/react';

import type {
  AuxNodeData,
  CloudNodeData,
  FlowNodeData,
  GroupNodeData,
  StockNodeData,
} from '../../lib/programToReactFlow.ts';

// Node-typed aliases for `NodeProps`. React Flow's NodeProps generic takes the
// full `Node<TData, TType>` and exposes `data` + flow-runtime props on it.
type StockNodeT = Node<StockNodeData, 'stock'>;
type FlowNodeT = Node<FlowNodeData, 'flow'>;
type AuxNodeT = Node<AuxNodeData, 'aux'>;
type CloudNodeT = Node<CloudNodeData, 'cloud'>;
type GroupNodeT = Node<GroupNodeData, 'group'>;

// ── Shape colour palette ───────────────────────────────────────────────────
// Kept in JS rather than CSS so each `<svg>` carries its colours inline; that
// makes the diagram exportable as a single self-contained image down the line.
const FILL = {
  stock: '#FFFFFF',
  flow: '#F4EFE6',
  cloud: '#F0EEEA',
  calc: '#FAFAF9',
  constant: '#FAFAF9',
  map: '#FAFAF9',
};
const STROKE = {
  stock: '#1F1F1F',
  flow: '#A0742E',
  cloud: '#B8B5AE',
  calc: '#5C5A55',
  constant: '#0F4C5C',
  map: '#5C2B5B',
};
const LABEL_COLOR = {
  stock: '#1F1F1F',
  flow: '#1F1F1F',
  calc: '#1F1F1F',
  constant: '#0F4C5C',
  map: '#5C2B5B',
};

// Hex bevel ratio: how much of the width the angled cuts take. 0.18 reads as
// the canonical SD valve/bowtie proxy at typical sizes.
const HEX_BEVEL = 0.18;
const PARALL_SKEW = 0.16;

const HANDLE_STYLE: React.CSSProperties = {
  width: 1,
  height: 1,
  minWidth: 1,
  minHeight: 1,
  background: 'transparent',
  border: 0,
  pointerEvents: 'none',
};

function HandleSet() {
  return (
    <>
      <Handle type="target" position={Position.Left} style={HANDLE_STYLE} />
      <Handle type="target" position={Position.Top} style={HANDLE_STYLE} />
      <Handle type="source" position={Position.Right} style={HANDLE_STYLE} />
      <Handle type="source" position={Position.Bottom} style={HANDLE_STYLE} />
    </>
  );
}

interface ShapeProps {
  readonly width: number;
  readonly height: number;
  readonly label: string;
  readonly fill: string;
  readonly stroke: string;
  readonly strokeWidth: number;
  readonly textColor: string;
  readonly fontSize: number;
  /** SVG primitive used for the outline. */
  readonly element: 'rect' | 'roundedRect' | 'polygon' | 'circle';
  /** Polygon points, used iff `element === 'polygon'`. */
  readonly path?: string;
  /** Optional dashed-stroke pattern (e.g. '4 3') applied to whichever
   *  primitive `element` selects. Used by the exogenous boundary marker. */
  readonly strokeDasharray?: string;
}

/**
 * Generic shape renderer. Draws the SVG primitive into a 100%-sized box, then
 * overlays the label as a centred HTML span on top — using HTML rather than
 * `<text>` keeps fonts pixel-perfect and avoids SVG text antialiasing quirks.
 */
function Shape({ width, height, label, fill, stroke, strokeWidth, textColor, fontSize, element, path, strokeDasharray }: ShapeProps) {
  const dashAttr = strokeDasharray ? { strokeDasharray } : {};
  return (
    <div
      className="rfn"
      style={{
        width,
        height,
        position: 'relative',
        color: textColor,
        fontSize,
      }}
    >
      <svg
        className="rfn__svg"
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        preserveAspectRatio="none"
      >
        {element === 'rect' && (
          <rect
            x={strokeWidth / 2}
            y={strokeWidth / 2}
            width={width - strokeWidth}
            height={height - strokeWidth}
            fill={fill}
            stroke={stroke}
            strokeWidth={strokeWidth}
            {...dashAttr}
          />
        )}
        {element === 'roundedRect' && (
          <rect
            x={strokeWidth / 2}
            y={strokeWidth / 2}
            width={width - strokeWidth}
            height={height - strokeWidth}
            rx={(height - strokeWidth) / 2}
            ry={(height - strokeWidth) / 2}
            fill={fill}
            stroke={stroke}
            strokeWidth={strokeWidth}
            {...dashAttr}
          />
        )}
        {element === 'polygon' && path && (
          <polygon
            points={path}
            fill={fill}
            stroke={stroke}
            strokeWidth={strokeWidth}
            strokeLinejoin="round"
            {...dashAttr}
          />
        )}
        {element === 'circle' && (
          <circle
            cx={width / 2}
            cy={height / 2}
            r={(Math.min(width, height) - strokeWidth) / 2}
            fill={fill}
            stroke={stroke}
            strokeWidth={strokeWidth}
            {...dashAttr}
          />
        )}
      </svg>
      {label && <span className="rfn__label">{label}</span>}
    </div>
  );
}

// ── Per-kind nodes ─────────────────────────────────────────────────────────

// Series palette matches index.css `--series-1..--series-8` so a stock's gauge
// uses the same hue as its line in the chart.
const SERIES_PALETTE = [
  '#0F4C5C',
  '#B23A2C',
  '#A0742E',
  '#5C2B5B',
  '#2E7D5C',
  '#2A6B89',
  '#6F503D',
  '#1F1F1F',
];

export function StockNode({ data }: NodeProps<StockNodeT>) {
  const { width, height } = data.size;
  const sw = 1.5;
  const seriesColor = SERIES_PALETTE[data.colorIndex % SERIES_PALETTE.length] ?? SERIES_PALETTE[0]!;

  // Compute the gauge fill rectangle. Negative values clamp at 0 for v1 —
  // signed stocks (bank balance, momentum) get a TODO. The fill grows from
  // the bottom up, water-tank style.
  let fillH = 0;
  let level: number | null = null;
  if (data.gauge && data.gauge.max > 0) {
    const v = Math.max(0, data.gauge.value);
    level = v / data.gauge.max;
    fillH = level * (height - sw * 2);
  }

  return (
    <div className="rfn" style={{ width, height, position: 'relative', color: LABEL_COLOR.stock, fontSize: 13 }}>
      <svg
        className="rfn__svg"
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        preserveAspectRatio="none"
      >
        {/* Fill goes first so the outline draws on top of it. */}
        {fillH > 0 && (
          <rect
            x={sw}
            y={height - sw - fillH}
            width={width - sw * 2}
            height={fillH}
            fill={seriesColor}
            fillOpacity={0.18}
          />
        )}
        {/* Outline. */}
        <rect
          x={sw / 2}
          y={sw / 2}
          width={width - sw}
          height={height - sw}
          fill="transparent"
          stroke={STROKE.stock}
          strokeWidth={sw}
        />
      </svg>
      <span className="rfn__label">{data.label}</span>
      {data.gauge && (
        <span
          className="rfn__gauge-pct"
          style={{ color: seriesColor }}
          title={`${data.gauge.value.toFixed(2)} / max ${data.gauge.max.toFixed(2)}`}
        >
          {level !== null ? `${Math.round(level * 100)}%` : ''}
        </span>
      )}
      <HandleSet />
    </div>
  );
}

export function FlowNode({ data }: NodeProps<FlowNodeT>) {
  const { width, height } = data.size;
  const b = width * HEX_BEVEL;
  // Hexagon points clockwise from top-left after the bevel.
  const points = [
    [b, 0],
    [width - b, 0],
    [width, height / 2],
    [width - b, height],
    [b, height],
    [0, height / 2],
  ]
    .map((p) => p.join(','))
    .join(' ');
  return (
    <>
      <Shape
        width={width}
        height={height}
        label={data.label}
        fill={FILL.flow}
        stroke={STROKE.flow}
        strokeWidth={1}
        textColor={LABEL_COLOR.flow}
        fontSize={13}
        element="polygon"
        path={points}
      />
      <HandleSet />
    </>
  );
}

export function AuxNode({ data }: NodeProps<AuxNodeT>) {
  const { width, height } = data.size;
  const kind = data.kind;
  const fill = FILL[kind];
  const stroke = STROKE[kind];
  const text = LABEL_COLOR[kind];
  const isExo = data.exogenous === true;

  let element: ShapeProps['element'] = 'rect';
  let path = '';
  if (kind === 'calc') {
    element = 'roundedRect';
  } else if (kind === 'constant') {
    element = 'polygon';
    // Diamond.
    path = [
      [width / 2, 1],
      [width - 1, height / 2],
      [width / 2, height - 1],
      [1, height / 2],
    ]
      .map((p) => p.join(','))
      .join(' ');
  } else if (kind === 'map') {
    element = 'polygon';
    const s = width * PARALL_SKEW;
    path = [
      [s, 0],
      [width, 0],
      [width - s, height],
      [0, height],
    ]
      .map((p) => p.join(','))
      .join(' ');
  }

  return (
    <>
      <Shape
        width={width}
        height={height}
        label={data.label}
        fill={fill}
        stroke={stroke}
        strokeWidth={1}
        textColor={text}
        fontSize={12}
        element={element}
        path={path}
        {...(isExo ? { strokeDasharray: '4 3' } : {})}
      />
      {isExo && <span className="rfn__exo-badge" title="exogenous (out-of-system input)">exo</span>}
      <HandleSet />
    </>
  );
}

export function CloudNode({ data }: NodeProps<CloudNodeT>) {
  const { width, height } = data.size;
  return (
    <>
      <Shape
        width={width}
        height={height}
        label=""
        fill={FILL.cloud}
        stroke={STROKE.cloud}
        strokeWidth={1}
        textColor="transparent"
        fontSize={12}
        element="circle"
      />
      <HandleSet />
    </>
  );
}

/**
 * Module group: a faint dashed rectangle behind its children, with the
 * module's FQN labelled at the top-left. Sits underneath everything else
 * (React Flow's `parentId` mechanism keeps z-order right by default).
 */
export function GroupNode({ data }: NodeProps<GroupNodeT>) {
  return (
    <div
      className="rfn-group"
      style={{ width: data.width, height: data.height }}
      title={data.fqn}
    >
      <span className="rfn-group__label">{data.label}</span>
    </div>
  );
}

// Type registry for React Flow's `nodeTypes` prop.
export const NODE_TYPES = {
  stock: StockNode,
  flow: FlowNode,
  aux: AuxNode,
  cloud: CloudNode,
  group: GroupNode,
} as const;
