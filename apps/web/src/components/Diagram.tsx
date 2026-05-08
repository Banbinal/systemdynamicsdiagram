import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Background,
  BackgroundVariant,
  Controls,
  MarkerType,
  ReactFlow,
  ReactFlowProvider,
  useEdgesState,
  useNodesState,
  type Edge,
  type Node,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';

import {
  findLoopDominance,
  findLoops,
  type CompiledProgram,
  type Loop,
  type SimulationResult,
} from '@sysdyn/core';

import { layoutProgramGraph } from '../lib/elkLayout.ts';
import {
  programToReactFlow,
  type DiagramEdge,
  type DiagramNode,
} from '../lib/programToReactFlow.ts';
import { EDGE_TYPES } from './diagram/edges.tsx';
import { NODE_TYPES } from './diagram/nodes.tsx';
import { CausalLens } from './CausalLens.tsx';

interface DiagramProps {
  readonly program: CompiledProgram | null;
  readonly result?: SimulationResult | null;
  /**
   * Time index whose state populates the stock gauges. Defaults to the
   * final recorded step (i.e. "where each stock ended up").
   */
  readonly timeIndex?: number;
  /**
   * Reports the dominant loop id at the current scrubber position so
   * sibling components (e.g. the Loops sidebar) can show a "dominant"
   * badge synchronised with the diagram's edge highlight.
   */
  readonly onDominantLoopChange?: (loopId: string | null) => void;
}

const PROVIDED_NODE_TYPES = NODE_TYPES;
const PROVIDED_EDGE_TYPES = EDGE_TYPES;

export function Diagram(props: DiagramProps) {
  return (
    <ReactFlowProvider>
      <DiagramInner {...props} />
    </ReactFlowProvider>
  );
}

function DiagramInner({ program, result, timeIndex, onDominantLoopChange }: DiagramProps) {
  const [showAux, setShowAux] = useState(true);
  const [mode, setMode] = useState<'sfd' | 'cld'>('sfd');
  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const [layoutErr, setLayoutErr] = useState<string | null>(null);

  // Causal Lens — FQN of the variable focused via node click. Cleared on
  // model change so a stale FQN from a previous model never lingers.
  const [lensFqn, setLensFqn] = useState<string | null>(null);
  useEffect(() => {
    setLensFqn(null);
  }, [program]);

  // ── Loop dominance ───────────────────────────────────────────────────────
  // Detect loops, compute per-step activity, derive the dominant loop at
  // the current scrubber position. Memoised on program / result identity so
  // the per-step series isn't recomputed on every effIndex tick.
  const loops = useMemo<readonly Loop[]>(
    () => (program ? findLoops(program) : []),
    [program],
  );
  const dominance = useMemo(() => {
    if (!program || !result || loops.length === 0) return null;
    return findLoopDominance(program, result, loops);
  }, [program, result, loops]);

  // Local scrubber state — used when the parent doesn't pass `timeIndex`.
  // Reset to the final step whenever the result identity changes (new run).
  const [localIndex, setLocalIndex] = useState<number>(0);
  useEffect(() => {
    if (!result || result.time.length === 0) {
      setLocalIndex(0);
      return;
    }
    setLocalIndex(result.time.length - 1);
  }, [result]);

  // Effective time index: external override > local scrubber > final step.
  const effIndex = useMemo(() => {
    if (!result || result.time.length === 0) return 0;
    const raw = timeIndex !== undefined ? timeIndex : localIndex;
    return Math.max(0, Math.min(result.time.length - 1, raw));
  }, [result, timeIndex, localIndex]);

  // ── Playback ────────────────────────────────────────────────────────────
  // Animation loop: advances `localIndex` at a steady rate, looping back to
  // start when it reaches the end. ~25 fps feels lively without burning CPU.
  const [playing, setPlaying] = useState(false);
  const playRef = useRef<number | null>(null);
  useEffect(() => {
    if (!playing || !result || result.time.length === 0) return;
    const total = result.time.length;
    const stepMs = Math.max(20, Math.min(80, 4000 / total)); // full run in ~4s
    let last = performance.now();
    const tick = () => {
      const now = performance.now();
      if (now - last >= stepMs) {
        last = now;
        setLocalIndex((i) => (i + 1 >= total ? 0 : i + 1));
      }
      playRef.current = requestAnimationFrame(tick);
    };
    playRef.current = requestAnimationFrame(tick);
    return () => {
      if (playRef.current !== null) cancelAnimationFrame(playRef.current);
    };
  }, [playing, result]);

  // Pause playback when the parent supplies an explicit timeIndex; the
  // external controller is in charge.
  useEffect(() => {
    if (timeIndex !== undefined && playing) setPlaying(false);
  }, [timeIndex, playing]);

  const onScrub = useCallback((idx: number) => {
    setPlaying(false);
    setLocalIndex(idx);
  }, []);

  // Compute the structural graph synchronously, then run ELK async to lay it
  // out. We store the structural graph in `graph` so the layout effect can
  // read it without re-running programToReactFlow when overrides change.
  const graph = useMemo(() => {
    if (!program) return null;
    return programToReactFlow(program, { showAuxiliaries: showAux, mode });
  }, [program, showAux, mode]);

  useEffect(() => {
    let cancelled = false;
    if (!graph) {
      setNodes([]);
      setEdges([]);
      return;
    }
    layoutProgramGraph(graph)
      .then(({ nodes: laidNodes, edges: laidEdges }) => {
        if (cancelled) return;
        // Apply the marker shape per edge type — React Flow doesn't pull this
        // off the edge's `type`, so we set it here in a single pass.
        const decoratedEdges: DiagramEdge[] = laidEdges.map((e) => ({
          ...e,
          markerEnd: {
            type: MarkerType.ArrowClosed,
            width: e.type === 'matter' ? 18 : 14,
            height: e.type === 'matter' ? 18 : 14,
            color: edgeMarkerColor(e),
          },
        })) as DiagramEdge[];
        setNodes(laidNodes as Node[]);
        setEdges(decoratedEdges as Edge[]);
        setLayoutErr(null);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setLayoutErr(err instanceof Error ? err.message : String(err));
      });
    return () => {
      cancelled = true;
    };
  }, [graph, setNodes, setEdges]);

  // ── Loop highlight enrichment ────────────────────────────────────────────
  // The set of React Flow edge IDs that visually trace the dominant loop
  // at the current scrubber position. Updated when scrubber or run changes.
  const dominantLoopId = useMemo(() => {
    if (!dominance) return null;
    return dominance.dominant[Math.min(effIndex, dominance.dominant.length - 1)] ?? null;
  }, [dominance, effIndex]);

  // Notify parent so sibling panels (e.g. Loops) can sync.
  useEffect(() => {
    if (onDominantLoopChange) onDominantLoopChange(dominantLoopId);
  }, [dominantLoopId, onDominantLoopChange]);

  const highlightedEdgeIds = useMemo(() => {
    const out = new Set<string>();
    if (!dominantLoopId || !program) return out;
    const loop = loops.find((l) => l.id === dominantLoopId);
    if (!loop) return out;
    const idOf = (fqn: string) => 'n_' + fqn.replace(/[.\s]/g, '_');
    for (let i = 0; i < loop.nodes.length; i++) {
      const sourceFqn = loop.nodes[i]!;
      const targetFqn = loop.nodes[(i + 1) % loop.nodes.length]!;
      const targetSym = program.symbols.byFqn(targetFqn);
      const sourceSym = program.symbols.byFqn(sourceFqn);
      if (!targetSym || !sourceSym) continue;

      if (targetSym.kind === 'calc') {
        // Direct info-link from source to calc.
        const sId = idOf(sourceFqn);
        const tId = idOf(targetFqn);
        const e = edges.find((edg) => edg.source === sId && edg.target === tId);
        if (e) out.add(e.id);
      } else if (targetSym.kind === 'stock') {
        // Mediated by a flow. Highlight the source→flow info-link AND the
        // matter-flow arc(s) connecting that flow to the target stock.
        for (const fi of program.flowInputs) {
          if (fi.source !== sourceSym.id) continue;
          const flowSym = program.symbols.byId(fi.flow);
          if (!flowSym) continue;
          const touches = program.flowEffects.some((eff) => {
            if (eff.flowFqn !== flowSym.fqn) return false;
            const stock = program.stocks.find((s) => s.slot === eff.targetSlot);
            return stock?.fqn === targetFqn;
          });
          if (!touches) continue;
          const sId = idOf(sourceFqn);
          const fId = idOf(flowSym.fqn);
          const tId = idOf(targetFqn);
          // source → flow info-link
          const ei = edges.find((edg) => edg.source === sId && edg.target === fId && edg.type === 'info');
          if (ei) out.add(ei.id);
          // flow → stock matter
          const em1 = edges.find((edg) => edg.source === fId && edg.target === tId && edg.type === 'matter');
          if (em1) out.add(em1.id);
          // stock → flow matter (negative effect)
          const em2 = edges.find((edg) => edg.source === tId && edg.target === fId && edg.type === 'matter');
          if (em2) out.add(em2.id);
        }
      }
    }
    return out;
  }, [dominantLoopId, loops, program, edges]);

  // Apply highlight to edge data — separate from rate enrichment so the two
  // can update independently without thrashing the edge tree.
  useEffect(() => {
    setEdges((curr) =>
      curr.map((e) => {
        const shouldHighlight = highlightedEdgeIds.has(e.id);
        const wasHighlighted = !!(e.data as { loopHighlight?: boolean })?.loopHighlight;
        if (shouldHighlight === wasHighlighted) return e;
        return { ...e, data: { ...e.data, loopHighlight: shouldHighlight } } as Edge;
      }),
    );
  }, [highlightedEdgeIds, setEdges]);

  // ── Matter-edge rate enrichment ─────────────────────────────────────────
  // Per matter edge, attach the current flow rate (and a per-flow max for
  // normalisation). The MatterEdge component animates a dash offset whose
  // speed scales with the rate.
  useEffect(() => {
    if (!result) {
      setEdges((curr) =>
        curr.map((e) => {
          if (e.type !== 'matter') return e;
          if (!('rate' in (e.data as Record<string, unknown>))) return e;
          const { rate: _rate, ...rest } = e.data as Record<string, unknown>;
          return { ...e, data: rest } as Edge;
        }),
      );
      return;
    }
    setEdges((curr) =>
      curr.map((e) => {
        if (e.type !== 'matter') return e;
        const fqn = (e.data as { flowFqn?: string }).flowFqn;
        if (!fqn) return e;
        const series = result.flows[fqn];
        if (!series || series.length === 0) return e;
        const value = series[Math.min(effIndex, series.length - 1)] ?? 0;
        let max = 0;
        for (let i = 0; i < series.length; i++) {
          const v = series[i]!;
          if (v > max) max = v;
        }
        if (max === 0) max = Math.abs(value) || 1;
        return { ...e, data: { ...e.data, rate: { value, max } } } as Edge;
      }),
    );
  }, [result, effIndex, setEdges]);

  // ── Gauge enrichment ─────────────────────────────────────────────────────
  // Whenever the simulation result or the current time index changes, update
  // each stock node's `data.gauge` with (value, max). React Flow re-renders
  // only the affected nodes thanks to its shallow data equality check.
  useEffect(() => {
    if (!result) {
      // Strip any stale gauges if the result went away.
      setNodes((curr) =>
        curr.map((n) => {
          if (n.type !== 'stock') return n;
          if (!('gauge' in (n.data as Record<string, unknown>))) return n;
          const { gauge: _gauge, ...rest } = n.data as Record<string, unknown>;
          return { ...n, data: rest } as Node;
        }),
      );
      return;
    }
    setNodes((curr) =>
      curr.map((n) => {
        if (n.type !== 'stock') return n;
        const fqn = (n.data as { fqn: string }).fqn;
        const series = result.stocks[fqn];
        if (!series || series.length === 0) return n;
        const value = series[Math.min(effIndex, series.length - 1)] ?? 0;
        // Per-stock max for normalisation. Falls back to |value| so a single-
        // sample series still renders something sensible.
        let max = 0;
        for (let i = 0; i < series.length; i++) {
          const v = series[i]!;
          if (v > max) max = v;
        }
        if (max === 0) max = Math.abs(value) || 1;
        return {
          ...n,
          data: { ...n.data, gauge: { value, max } },
        } as Node;
      }),
    );
  }, [result, effIndex, setNodes]);

  if (!program) {
    return <div className="diagram-empty">— compile a model to see its diagram —</div>;
  }
  if (layoutErr) {
    return (
      <div className="diagram-error">
        <strong>Layout error</strong>
        <pre>{layoutErr}</pre>
      </div>
    );
  }

  const totalSteps = result?.time.length ?? 0;
  const currentT = result && totalSteps > 0 ? result.time[effIndex] ?? 0 : 0;
  const startT = result && totalSteps > 0 ? result.time[0] ?? 0 : 0;
  const endT = result && totalSteps > 0 ? result.time[totalSteps - 1] ?? 0 : 0;

  return (
    <div className="diagram-wrap">
      <div className="diagram-toolbar">
        <div className="diagram-mode" role="group" aria-label="Diagram mode">
          <button
            type="button"
            className={'diagram-mode__btn' + (mode === 'sfd' ? ' diagram-mode__btn--on' : '')}
            onClick={() => setMode('sfd')}
            title="Stock-and-flow (Forrester)"
          >
            SFD
          </button>
          <button
            type="button"
            className={'diagram-mode__btn' + (mode === 'cld' ? ' diagram-mode__btn--on' : '')}
            onClick={() => setMode('cld')}
            title="Causal loop (collapsed via influences)"
          >
            CLD
          </button>
        </div>
        <label className="diagram-toggle" style={{ opacity: mode === 'cld' ? 0.4 : 1 }}>
          <input
            type="checkbox"
            checked={showAux}
            onChange={(e) => setShowAux(e.target.checked)}
            disabled={mode === 'cld'}
          />
          <span>Show auxiliaries</span>
        </label>
        {result && totalSteps > 1 && (
          <div className="diagram-scrubber" role="group" aria-label="Time scrubber">
            <button
              type="button"
              className="diagram-scrubber__btn"
              onClick={() => setPlaying((p) => !p)}
              title={playing ? 'Pause' : 'Play'}
              aria-label={playing ? 'Pause' : 'Play'}
            >
              {playing ? '❚❚' : '▶'}
            </button>
            <input
              type="range"
              className="diagram-scrubber__slider"
              min={0}
              max={totalSteps - 1}
              step={1}
              value={effIndex}
              onChange={(e) => onScrub(parseInt(e.target.value, 10))}
              aria-label="Simulation time"
            />
            <span className="diagram-scrubber__time" title={`step ${effIndex + 1} / ${totalSteps}`}>
              t = {formatTime(currentT, startT, endT)}
            </span>
          </div>
        )}
      </div>
      <div className="diagram-stage">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          nodeTypes={PROVIDED_NODE_TYPES}
          edgeTypes={PROVIDED_EDGE_TYPES}
          fitView
          fitViewOptions={{ padding: 0.15, maxZoom: 1.5 }}
          minZoom={0.2}
          maxZoom={4}
          proOptions={{ hideAttribution: true }}
          nodesDraggable={false}
          nodesConnectable={false}
          elementsSelectable={false}
          onNodeClick={(_, node) => {
            // Group + cloud nodes don't carry a meaningful FQN — ignore clicks.
            if (node.type === 'group' || node.type === 'cloud') return;
            const fqn = (node.data as { fqn?: string }).fqn;
            if (fqn) setLensFqn(fqn);
          }}
        >
          <Background variant={BackgroundVariant.Dots} gap={16} size={1} color="#E5E3DD" />
          <Controls showInteractive={false} />
        </ReactFlow>
        {lensFqn && program && (
          <CausalLens
            fqn={lensFqn}
            program={program}
            result={result ?? null}
            onSelect={setLensFqn}
            onClose={() => setLensFqn(null)}
          />
        )}
      </div>
    </div>
  );
}

function edgeMarkerColor(e: DiagramEdge): string {
  if (e.type === 'matter') return '#A0742E';
  const pol = e.data?.polarity;
  if (pol === '+') return '#2E7D5C';
  if (pol === '-') return '#B23A2C';
  return '#8E8C86';
}

/**
 * Format the scrubber's "t = ..." readout. Decimal precision adapts to the
 * span of the run so a 0..10 sim shows `t = 4.50` while a 0..1000 sim shows
 * `t = 450`.
 */
function formatTime(t: number, start: number, end: number): string {
  const span = Math.max(1e-9, end - start);
  if (span >= 100) return t.toFixed(0);
  if (span >= 10) return t.toFixed(1);
  if (span >= 1) return t.toFixed(2);
  return t.toFixed(3);
}
