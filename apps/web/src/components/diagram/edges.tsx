import {
  BaseEdge,
  EdgeLabelRenderer,
  getBezierPath,
  type Edge,
  type EdgeProps,
} from '@xyflow/react';

import type {
  InfoEdgeData,
  MatterEdgeData,
} from '../../lib/programToReactFlow.ts';

const MATTER_STROKE = '#A0742E';
const POS_STROKE = '#2E7D5C';
const NEG_STROKE = '#B23A2C';
const UNK_STROKE = '#8E8C86';

type MatterEdgeT = Edge<MatterEdgeData, 'matter'>;
type InfoEdgeT = Edge<InfoEdgeData, 'info'>;

/**
 * Thick warm-tan arrow for matter flows. When a `rate` is provided in `data`,
 * the stroke turns dashed and animates a dash offset; the speed scales
 * inversely with the normalised rate so a fast flow pulses visibly while a
 * trickle barely moves. No label.
 */
export function MatterEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  markerEnd,
  data,
}: EdgeProps<MatterEdgeT>) {
  const [path] = getBezierPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
  });
  const rate = data?.rate;
  // Normalise the rate to (0..1] for animation. A zero rate disables the
  // animation entirely (no visual movement); a max-rate flow runs in 0.5s
  // per dash cycle, slowing to ~3s as the rate drops to 5%.
  let durationS: number | null = null;
  if (rate && rate.max > 0) {
    const norm = Math.min(1, Math.abs(rate.value) / rate.max);
    if (norm > 0.01) durationS = 0.5 + (1 - norm) * 2.5;
  }
  const animated = durationS !== null;
  return (
    <BaseEdge
      id={id}
      path={path}
      {...(markerEnd ? { markerEnd } : {})}
      style={{
        stroke: MATTER_STROKE,
        strokeWidth: 2.5,
        ...(animated
          ? {
              strokeDasharray: '8 6',
              animation: `rfe-flow ${durationS}s linear infinite`,
            }
          : {}),
      }}
    />
  );
}

/** Thin coloured arrow with a polarity glyph (and `‖` for delays) at midpoint. */
export function InfoEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  markerEnd,
  data,
}: EdgeProps<InfoEdgeT>) {
  const [path, labelX, labelY] = getBezierPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
  });
  const polarity = data?.polarity ?? '?';
  const stroke = polarity === '+' ? POS_STROKE : polarity === '-' ? NEG_STROKE : UNK_STROKE;
  const polClass = polarity === '+' ? 'pos' : polarity === '-' ? 'neg' : 'unk';
  const glyph = polarity === '+' ? '+' : polarity === '-' ? '−' : '?';
  const label = data?.delayed ? `${glyph} ‖` : glyph;
  return (
    <>
      <BaseEdge
        id={id}
        path={path}
        {...(markerEnd ? { markerEnd } : {})}
        style={{
          stroke,
          strokeWidth: polarity === '?' ? 1.2 : 1.6,
          ...(polarity === '?' ? { strokeDasharray: '3 3' } : {}),
        }}
      />
      <EdgeLabelRenderer>
        <div
          className={`rfe__label rfe__label--${polClass}`}
          style={{
            transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
          }}
        >
          {label}
        </div>
      </EdgeLabelRenderer>
    </>
  );
}

export const EDGE_TYPES = {
  matter: MatterEdge,
  info: InfoEdge,
} as const;
