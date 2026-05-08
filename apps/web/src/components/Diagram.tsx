import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import mermaid from 'mermaid';

import type { CompiledProgram } from '@sysdyn/core';
import { programToMermaid } from '../lib/programToMermaid.ts';

let initialized = false;
function ensureMermaid() {
  if (initialized) return;
  initialized = true;
  mermaid.initialize({
    startOnLoad: false,
    securityLevel: 'loose',
    theme: 'base',
    flowchart: { curve: 'basis', htmlLabels: false, padding: 12 },
    themeVariables: {
      fontFamily: '"IBM Plex Sans", system-ui, sans-serif',
      fontSize: '13px',
      primaryColor: '#FFFFFF',
      primaryTextColor: '#1F1F1F',
      primaryBorderColor: '#1F1F1F',
      lineColor: '#5C5A55',
      secondaryColor: '#F4EFE6',
      tertiaryColor: '#FAFAF9',
      mainBkg: '#FFFFFF',
      nodeBkg: '#FFFFFF',
      clusterBkg: '#FAFAF9',
      clusterBorder: '#D4D1CB',
      titleColor: '#1F1F1F',
      edgeLabelBackground: '#FFFFFF',
    },
  });
}

let renderSeq = 0;

const MIN_ZOOM = 0.25;
const MAX_ZOOM = 6;
const ZOOM_STEP = 1.25;
const STAGE_PADDING = 24;

interface DiagramProps {
  readonly program: CompiledProgram | null;
}

interface Pan {
  readonly x: number;
  readonly y: number;
}

const ORIGIN: Pan = { x: 0, y: 0 };

export function Diagram({ program }: DiagramProps) {
  const stageRef = useRef<HTMLDivElement>(null);
  const innerRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [showAux, setShowAux] = useState(true);
  // zoom is a multiplier on top of the fit-to-stage scale: 1 means "fit",
  // 2 means "twice as large as fit", etc. The `100%` toolbar button resets to 1.
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState<Pan>(ORIGIN);

  // Per-render baselines, kept in refs so applyAll can read them without
  // pulling them into effect dependency arrays.
  const baseSizeRef = useRef<{ w: number; h: number } | null>(null);
  const fitScaleRef = useRef(1);
  const zoomRef = useRef(zoom);
  zoomRef.current = zoom;

  // Recompute the fit scale (stage / baseline) and resize the SVG accordingly.
  // Uses zoomRef so it doesn't need to be in any effect's deps.
  const applyAll = useCallback(() => {
    const svg = innerRef.current?.querySelector('svg');
    if (!svg || !baseSizeRef.current) return;
    fitScaleRef.current = computeFitScale(stageRef.current, baseSizeRef.current);
    applyScale(svg, baseSizeRef.current, fitScaleRef.current * zoomRef.current);
  }, []);

  // Reset zoom + pan when the model itself changes (preserved across an
  // auxiliary-toggle since the same diagram is just gaining/losing nodes).
  useEffect(() => {
    setZoom(1);
    setPan(ORIGIN);
  }, [program]);

  // Render Mermaid into innerRef. Only re-renders on program or aux change —
  // never on zoom, which would redo the (expensive) layout pass for nothing.
  useEffect(() => {
    ensureMermaid();
    if (!program || !innerRef.current) return;

    const source = programToMermaid(program, { showAuxiliaries: showAux });
    const id = `sd-diagram-${++renderSeq}`;
    let cancelled = false;

    mermaid
      .render(id, source)
      .then(({ svg }) => {
        if (cancelled || !innerRef.current) return;
        innerRef.current.innerHTML = svg;
        // Mermaid sets `style="max-width:Xpx"` on the root SVG — strip both the
        // inline cap and the width/height attributes so applyScale wins.
        const svgEl = innerRef.current.querySelector('svg');
        if (svgEl) {
          svgEl.style.maxWidth = 'none';
          svgEl.removeAttribute('width');
          svgEl.removeAttribute('height');
        }
        baseSizeRef.current = readSvgBaseSize(svgEl);
        setError(null);
        applyAll();
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : String(err));
      });

    return () => {
      cancelled = true;
    };
  }, [program, showAux, applyAll]);

  // Re-apply on zoom change (no Mermaid re-render).
  useLayoutEffect(() => {
    applyAll();
  }, [zoom, applyAll]);

  // Re-fit on stage resize (window resize, sidebar collapses, font reflow).
  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const obs = new ResizeObserver(() => applyAll());
    obs.observe(stage);
    return () => obs.disconnect();
  }, [applyAll]);

  // ── Wheel-to-zoom (no modifier needed; the diagram owns its pane). ──────
  const onWheel = useCallback((e: React.WheelEvent<HTMLDivElement>) => {
    e.preventDefault();
    setZoom((z) => clamp(z * (e.deltaY < 0 ? ZOOM_STEP : 1 / ZOOM_STEP), MIN_ZOOM, MAX_ZOOM));
  }, []);

  // ── Drag-to-pan ──────────────────────────────────────────────────────────
  const dragRef = useRef<{ startX: number; startY: number; baseX: number; baseY: number } | null>(
    null,
  );
  const [grabbing, setGrabbing] = useState(false);
  const onMouseDown = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (e.button !== 0) return;
      dragRef.current = { startX: e.clientX, startY: e.clientY, baseX: pan.x, baseY: pan.y };
      setGrabbing(true);
    },
    [pan.x, pan.y],
  );
  const onMouseMove = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const d = dragRef.current;
    if (!d) return;
    setPan({ x: d.baseX + (e.clientX - d.startX), y: d.baseY + (e.clientY - d.startY) });
  }, []);
  const endDrag = useCallback(() => {
    dragRef.current = null;
    setGrabbing(false);
  }, []);

  if (!program) {
    return <div className="diagram-empty">— compile a model to see its diagram —</div>;
  }
  if (error) {
    return (
      <div className="diagram-error">
        <strong>Mermaid error</strong>
        <pre>{error}</pre>
      </div>
    );
  }

  const pct = Math.round(zoom * 100);
  return (
    <div className="diagram-wrap">
      <div className="diagram-toolbar">
        <label className="diagram-toggle">
          <input
            type="checkbox"
            checked={showAux}
            onChange={(e) => setShowAux(e.target.checked)}
          />
          <span>Show auxiliaries</span>
        </label>
        <div className="diagram-zoom" role="group" aria-label="Zoom controls">
          <button
            type="button"
            className="diagram-zoom__btn"
            onClick={() => setZoom((z) => clamp(z / ZOOM_STEP, MIN_ZOOM, MAX_ZOOM))}
            title="Zoom out"
            aria-label="Zoom out"
          >
            −
          </button>
          <button
            type="button"
            className="diagram-zoom__pct"
            onClick={() => {
              setZoom(1);
              setPan(ORIGIN);
            }}
            title="Reset to fit"
          >
            {pct}%
          </button>
          <button
            type="button"
            className="diagram-zoom__btn"
            onClick={() => setZoom((z) => clamp(z * ZOOM_STEP, MIN_ZOOM, MAX_ZOOM))}
            title="Zoom in"
            aria-label="Zoom in"
          >
            +
          </button>
        </div>
      </div>
      <div
        ref={stageRef}
        className={'diagram-stage' + (grabbing ? ' diagram-stage--grabbing' : '')}
        onWheel={onWheel}
        onMouseDown={onMouseDown}
        onMouseMove={onMouseMove}
        onMouseUp={endDrag}
        onMouseLeave={endDrag}
      >
        <div
          ref={innerRef}
          className="diagram-host"
          style={{ transform: `translate(${pan.x}px, ${pan.y}px)` }}
          aria-label="Stock-and-flow diagram"
        />
      </div>
    </div>
  );
}

// ── Helpers ────────────────────────────────────────────────────────────────

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

function readSvgBaseSize(svg: SVGSVGElement | null): { w: number; h: number } | null {
  if (!svg) return null;
  const vb = svg.viewBox.baseVal;
  if (vb && vb.width > 0 && vb.height > 0) return { w: vb.width, h: vb.height };
  const bb = svg.getBBox();
  if (bb.width > 0 && bb.height > 0) return { w: bb.width, h: bb.height };
  return null;
}

function computeFitScale(
  stage: HTMLDivElement | null,
  base: { w: number; h: number } | null,
): number {
  if (!stage || !base) return 1;
  const r = stage.getBoundingClientRect();
  const availW = Math.max(1, r.width - STAGE_PADDING * 2);
  const availH = Math.max(1, r.height - STAGE_PADDING * 2);
  return Math.max(0.05, Math.min(availW / base.w, availH / base.h));
}

function applyScale(
  svg: SVGSVGElement | null,
  base: { w: number; h: number } | null,
  scale: number,
): void {
  if (!svg || !base) return;
  const w = base.w * scale;
  const h = base.h * scale;
  svg.setAttribute('width', String(w));
  svg.setAttribute('height', String(h));
  svg.style.width = `${w}px`;
  svg.style.height = `${h}px`;
  svg.style.maxWidth = 'none';
}
