import { useCallback, useEffect, useRef, useState } from 'react';
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

const MIN_SCALE = 0.4;
const MAX_SCALE = 4;
const ZOOM_STEP = 1.25;

interface DiagramProps {
  readonly program: CompiledProgram | null;
}

interface Transform {
  scale: number;
  x: number;
  y: number;
}

const IDENTITY: Transform = { scale: 1, x: 0, y: 0 };

export function Diagram({ program }: DiagramProps) {
  const stageRef = useRef<HTMLDivElement>(null);
  const innerRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [showAux, setShowAux] = useState(true);
  const [t, setT] = useState<Transform>(IDENTITY);

  // Reset zoom/pan when the model itself changes (but keep it across an
  // auxiliary-toggle, since the same diagram is just gaining/losing nodes).
  useEffect(() => {
    setT(IDENTITY);
  }, [program]);

  // Render the Mermaid SVG into innerRef whenever the program or aux toggle changes.
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
        setError(null);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : String(err));
      });

    return () => {
      cancelled = true;
    };
  }, [program, showAux]);

  // Zoom anchored on cursor position.
  const zoomAt = useCallback((factor: number, anchorX: number, anchorY: number) => {
    setT((prev) => {
      const newScale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, prev.scale * factor));
      if (newScale === prev.scale) return prev;
      // Keep the point under the cursor stable: compute the shift needed in
      // the translation to compensate for the scale change at the anchor.
      const k = newScale / prev.scale;
      const x = anchorX - k * (anchorX - prev.x);
      const y = anchorY - k * (anchorY - prev.y);
      return { scale: newScale, x, y };
    });
  }, []);

  const onWheel = useCallback(
    (e: React.WheelEvent<HTMLDivElement>) => {
      e.preventDefault();
      const stage = stageRef.current;
      if (!stage) return;
      const rect = stage.getBoundingClientRect();
      const factor = e.deltaY < 0 ? ZOOM_STEP : 1 / ZOOM_STEP;
      zoomAt(factor, e.clientX - rect.left, e.clientY - rect.top);
    },
    [zoomAt],
  );

  // Drag-to-pan.
  const dragRef = useRef<{ startX: number; startY: number; baseX: number; baseY: number } | null>(
    null,
  );
  const onMouseDown = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    dragRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      baseX: t.x,
      baseY: t.y,
    };
  }, [t.x, t.y]);
  const onMouseMove = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const d = dragRef.current;
    if (!d) return;
    setT((prev) => ({ ...prev, x: d.baseX + (e.clientX - d.startX), y: d.baseY + (e.clientY - d.startY) }));
  }, []);
  const endDrag = useCallback(() => {
    dragRef.current = null;
  }, []);

  // Toolbar actions zoom around the centre of the stage.
  const zoomCentered = useCallback(
    (factor: number) => {
      const stage = stageRef.current;
      if (!stage) return;
      const rect = stage.getBoundingClientRect();
      zoomAt(factor, rect.width / 2, rect.height / 2);
    },
    [zoomAt],
  );

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

  const pct = Math.round(t.scale * 100);
  const transform = `translate(${t.x}px, ${t.y}px) scale(${t.scale})`;

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
            onClick={() => zoomCentered(1 / ZOOM_STEP)}
            title="Zoom out"
            aria-label="Zoom out"
          >
            −
          </button>
          <button
            type="button"
            className="diagram-zoom__pct"
            onClick={() => setT(IDENTITY)}
            title="Reset to 100%"
          >
            {pct}%
          </button>
          <button
            type="button"
            className="diagram-zoom__btn"
            onClick={() => zoomCentered(ZOOM_STEP)}
            title="Zoom in"
            aria-label="Zoom in"
          >
            +
          </button>
        </div>
      </div>
      <div
        ref={stageRef}
        className={'diagram-stage' + (dragRef.current ? ' diagram-stage--grabbing' : '')}
        onWheel={onWheel}
        onMouseDown={onMouseDown}
        onMouseMove={onMouseMove}
        onMouseUp={endDrag}
        onMouseLeave={endDrag}
      >
        <div
          ref={innerRef}
          className="diagram-host"
          style={{ transform, transformOrigin: '0 0' }}
          aria-label="Stock-and-flow diagram"
        />
      </div>
    </div>
  );
}
