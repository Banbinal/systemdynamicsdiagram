import { useEffect, useState } from 'react';
import {
  MarkerType,
  ReactFlow,
  ReactFlowProvider,
  type Edge,
  type Node,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';

import type { CompiledProgram, SimulationResult } from '@sysdyn/core';

import { layoutProgramGraph } from '../lib/elkLayout.ts';
import {
  programToReactFlow,
  type DiagramEdge,
} from '../lib/programToReactFlow.ts';
import { EDGE_TYPES } from './diagram/edges.tsx';
import { NODE_TYPES } from './diagram/nodes.tsx';

interface PrintDiagramProps {
  readonly program: CompiledProgram | null;
  readonly result?: SimulationResult | null;
  /**
   * Fires once the layout has been computed and React Flow's `onInit` has
   * fired — i.e. when the diagram is safe to capture for printing.
   */
  readonly onReady: () => void;
  /** Pixel size of the print frame. Print CSS scales to fit the page. */
  readonly width: number;
  readonly height: number;
}

/**
 * Print-friendly wrapper around React Flow that disables every interaction
 * and signals readiness once the layout pass completes. Used by PrintReport
 * in place of the previous Mermaid render.
 *
 * Sharing the layout pipeline with `Diagram.tsx` keeps the printed output
 * faithful to what the user sees on screen — same shapes, same polarity
 * colours, same module groups and cloud snapping.
 */
export function PrintDiagram(props: PrintDiagramProps) {
  return (
    <ReactFlowProvider>
      <PrintDiagramInner {...props} />
    </ReactFlowProvider>
  );
}

function PrintDiagramInner({ program, result, onReady, width, height }: PrintDiagramProps) {
  const [nodes, setNodes] = useState<Node[]>([]);
  const [edges, setEdges] = useState<Edge[]>([]);
  const [layoutDone, setLayoutDone] = useState(false);
  const [initFired, setInitFired] = useState(false);

  // Run the layout pipeline once per program.
  useEffect(() => {
    let cancelled = false;
    if (!program) {
      setLayoutDone(true);
      return;
    }
    const graph = programToReactFlow(program, { showAuxiliaries: true });
    layoutProgramGraph(graph)
      .then(({ nodes: laidNodes, edges: laidEdges }) => {
        if (cancelled) return;
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
        setLayoutDone(true);
      })
      .catch(() => setLayoutDone(true));
    return () => {
      cancelled = true;
    };
  }, [program]);

  // Enrich stock nodes with their final-step gauge value, mirroring
  // Diagram.tsx so the print snapshot shows where each stock landed.
  useEffect(() => {
    if (!result || result.time.length === 0) return;
    const lastIdx = result.time.length - 1;
    setNodes((curr) =>
      curr.map((n) => {
        if (n.type !== 'stock') return n;
        const fqn = (n.data as { fqn: string }).fqn;
        const series = result.stocks[fqn];
        if (!series || series.length === 0) return n;
        const value = series[Math.min(lastIdx, series.length - 1)] ?? 0;
        let max = 0;
        for (let i = 0; i < series.length; i++) {
          const v = series[i]!;
          if (v > max) max = v;
        }
        if (max === 0) max = Math.abs(value) || 1;
        return { ...n, data: { ...n.data, gauge: { value, max } } } as Node;
      }),
    );
  }, [result]);

  // Signal readiness only after the layout finished AND React Flow has
  // initialised (so the SVG inside the host has been laid out).
  useEffect(() => {
    if (layoutDone && initFired) {
      // One frame of grace lets the fitView animation settle before print.
      const t = requestAnimationFrame(() => onReady());
      return () => cancelAnimationFrame(t);
    }
    return;
  }, [layoutDone, initFired, onReady]);

  if (!program) {
    return <div className="print-diagram-empty">— no diagram —</div>;
  }

  return (
    <div className="print-diagram" style={{ width, height }}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={NODE_TYPES}
        edgeTypes={EDGE_TYPES}
        fitView
        fitViewOptions={{ padding: 0.1, maxZoom: 1.5 }}
        proOptions={{ hideAttribution: true }}
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable={false}
        panOnDrag={false}
        zoomOnScroll={false}
        zoomOnPinch={false}
        zoomOnDoubleClick={false}
        preventScrolling={false}
        onInit={() => setInitFired(true)}
      />
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
