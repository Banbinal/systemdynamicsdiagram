/**
 * Per-node sizing for the diagram. Measures the rendered label text in a
 * canvas at the same font the React node will use, then adds a generous
 * shape-aware padding so the SVG outline always wraps the text with breathing
 * room. The output is fed both to ELK (for layout) and to the SVG renderer
 * (for the shape's `viewBox`).
 *
 * Why a shared sizing pass: ELK needs `width`/`height` *before* layout so it
 * can route edges around real footprints. If we only sized inside the React
 * component, ELK would see stale defaults and produce overlaps.
 */

const FONT = '13px "IBM Plex Sans", system-ui, -apple-system, "Segoe UI", sans-serif';
const SMALL_FONT = '12px "IBM Plex Sans", system-ui, -apple-system, "Segoe UI", sans-serif';

export type ShapeKind =
  | 'stock'
  | 'flow'
  | 'calc'
  | 'constant'
  | 'map'
  | 'cloud';

export interface NodeSize {
  readonly width: number;
  readonly height: number;
}

let measureCtx: CanvasRenderingContext2D | null = null;
function ctx(): CanvasRenderingContext2D | null {
  if (measureCtx) return measureCtx;
  if (typeof document === 'undefined') return null; // SSR / Node guard
  const c = document.createElement('canvas');
  const got = c.getContext('2d');
  measureCtx = got;
  return got;
}

function measure(text: string, font: string): number {
  const c = ctx();
  if (!c) return text.length * 7.2; // rough fallback
  c.font = font;
  return c.measureText(text).width;
}

/**
 * Compute the bounding box for a node of the given shape and label.
 *
 * Padding is calibrated per shape:
 *   - rectangles get a comfortable horizontal cushion;
 *   - hexagons need extra width to clear the bevel;
 *   - diamonds need extra height because the text sits in the narrow waist;
 *   - parallelograms compensate for the horizontal skew.
 *
 * Width and height are rounded to even pixels so React Flow + ELK don't
 * accumulate sub-pixel offsets that visibly jitter labels.
 */
export function sizeFor(kind: ShapeKind, label: string): NodeSize {
  if (kind === 'cloud') return { width: 28, height: 28 };

  const font = kind === 'calc' || kind === 'constant' || kind === 'map' ? SMALL_FONT : FONT;
  const textW = Math.ceil(measure(label, font));

  // (padX, padY, minW, minH) per shape.
  const profile = {
    stock:    { padX: 22, padY: 14, minW: 90, minH: 44 },
    flow:     { padX: 30, padY: 12, minW: 100, minH: 40 },
    calc:     { padX: 22, padY: 10, minW: 84, minH: 34 },
    constant: { padX: 32, padY: 22, minW: 92, minH: 50 },
    map:      { padX: 30, padY: 10, minW: 90, minH: 36 },
  }[kind];

  const w = Math.max(profile.minW, textW + profile.padX * 2);
  const h = Math.max(profile.minH, profile.padY * 2 + 16);
  // Round up to nearest even pixel for crisp 1px strokes at 1× zoom.
  const round2 = (n: number) => Math.ceil(n / 2) * 2;
  return { width: round2(w), height: round2(h) };
}
