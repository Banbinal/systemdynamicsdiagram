import type { CompiledProgram } from '@sysdyn/core';
import type { Edge, Node } from '@xyflow/react';

import { sizeFor, type NodeSize } from './diagramSizing.ts';

export type StockNodeData = {
  readonly fqn: string;
  readonly label: string;
  /** Slot index — used by future phases (gauges, scrubber) to read state. */
  readonly slot: number;
  readonly size: NodeSize;
  /**
   * Index of this stock in the chart's cyclic series palette. Lets the gauge
   * fill match the chart line for the same stock without a colour lookup.
   */
  readonly colorIndex: number;
  /**
   * Live state for the gauge fill: current value and a normalising maximum.
   * Set by `Diagram.tsx` from the simulation result; `undefined` until
   * the first run completes (renders the stock with no fill).
   */
  readonly gauge?: {
    readonly value: number;
    readonly max: number;
  };
};

export type FlowNodeData = {
  readonly fqn: string;
  readonly label: string;
  readonly size: NodeSize;
};

export type AuxNodeData = {
  readonly fqn: string;
  readonly label: string;
  readonly kind: 'calc' | 'constant' | 'map';
  readonly size: NodeSize;
  /** True when the constant was declared `exogenous` — boundary marker. */
  readonly exogenous?: boolean;
};

export type CloudNodeData = {
  readonly size: NodeSize;
};

export type GroupNodeData = {
  readonly fqn: string;
  readonly label: string;
  readonly width: number;
  readonly height: number;
};

export type DiagramNode =
  | (Node<StockNodeData> & { type: 'stock' })
  | (Node<FlowNodeData> & { type: 'flow' })
  | (Node<AuxNodeData> & { type: 'aux' })
  | (Node<CloudNodeData> & { type: 'cloud' })
  | (Node<GroupNodeData> & { type: 'group' });

export type MatterEdgeData = {
  /** FQN of the flow this matter arc carries — used to look up the live rate. */
  readonly flowFqn: string;
  /**
   * Live state for the matter-flow animation: the current absolute rate at
   * the diagram's `timeIndex`, and a normalising max from the run. Set by
   * `Diagram.tsx` after each scrubber update; `undefined` at first render.
   */
  readonly rate?: { readonly value: number; readonly max: number };
  /** Set when this edge belongs to the loop that's dominant at the current
   *  scrubber position. Renderer thickens the stroke + glows. */
  readonly loopHighlight?: boolean;
};
export type InfoEdgeData = {
  readonly polarity: '+' | '-' | '?';
  readonly delayed: boolean;
  /** Set when this edge belongs to the loop that's dominant right now. */
  readonly loopHighlight?: boolean;
};

export type DiagramEdge =
  | (Edge<MatterEdgeData> & { type: 'matter' })
  | (Edge<InfoEdgeData> & { type: 'info' });

export interface ProgramGraph {
  readonly nodes: readonly DiagramNode[];
  readonly edges: readonly DiagramEdge[];
  /**
   * Module FQN → list of child node IDs. Lets the layout group nodes into
   * subgraph clusters and the renderer draw module borders/labels.
   */
  readonly modules: ReadonlyMap<string, readonly string[]>;
}

export interface BuildOptions {
  readonly showAuxiliaries?: boolean;
  /**
   * Diagram surface to produce.
   *   - 'sfd': canonical Forrester stock-and-flow (default). Stocks, flows,
   *     clouds, matter-flow arcs, info-links via flowInputs + calc influences.
   *   - 'cld': causal-loop view. Stocks + (optionally) auxiliaries as nodes,
   *     direct source → target arcs from `program.influences[]`. No flows,
   *     no clouds, no matter-flow chrome — the SFD plumbing is collapsed
   *     into the causal arc's polarity.
   */
  readonly mode?: 'sfd' | 'cld';
}

/**
 * Translate a `CompiledProgram` into the React Flow node + edge graph.
 *
 * Mirrors the conventions of `programToMermaid` (same shapes, same edge
 * semantics) but produces structured data instead of a Mermaid source string,
 * so the renderer (React Flow) can attach interactivity, animations, and
 * gauges per-node.
 */
export function programToReactFlow(
  program: CompiledProgram,
  options: BuildOptions = {},
): ProgramGraph {
  const mode = options.mode ?? 'sfd';
  const showAux = options.showAuxiliaries ?? true;
  // CLD always shows non-stock variables — without them the causal-link graph
  // would be missing nodes that arcs anchor to.
  const showAuxEffective = mode === 'cld' ? true : showAux;

  const nodes: DiagramNode[] = [];
  const edges: DiagramEdge[] = [];
  const modules = new Map<string, string[]>();

  // ── Lookups ──────────────────────────────────────────────────────────────
  const symFqn = (id: number) => program.symbols.byId(id)?.fqn ?? null;
  const symKind = (id: number) => program.symbols.byId(id)?.kind ?? null;

  const stockSlotToFqn = new Map<number, string>();
  for (const s of program.stocks) {
    if (!s.synthetic) stockSlotToFqn.set(s.slot, s.fqn);
  }

  type Eff = { stockFqn: string; polarity: 'positive' | 'negative' };
  const flows = new Map<string, Eff[]>();
  for (const eff of program.flowEffects) {
    const fqn = stockSlotToFqn.get(eff.targetSlot);
    if (!fqn) continue;
    let arr = flows.get(eff.flowFqn);
    if (!arr) {
      arr = [];
      flows.set(eff.flowFqn, arr);
    }
    arr.push({ stockFqn: fqn, polarity: eff.polarity });
  }

  // ── Synthetic delay-stock substitution (mirrors programToMermaid) ────────
  type DelayMeta = { kind: 'smooth' | 'delay3'; inputIds: readonly number[] };
  const delaySubsByFqn = new Map<string, DelayMeta>();
  for (const s of program.stocks) {
    if (s.delayKind && s.delayInputs && s.delayInputs.length > 0) {
      delaySubsByFqn.set(s.fqn, { kind: s.delayKind, inputIds: s.delayInputs });
    }
  }
  const lookupDelay = (sym: ReturnType<typeof program.symbols.byId>) => {
    if (!sym || sym.kind !== 'stock') return null;
    return delaySubsByFqn.get(sym.fqn) ?? null;
  };

  // ── Helpers ──────────────────────────────────────────────────────────────
  const idOf = (fqn: string) => 'n_' + fqn.replace(/[.\s]/g, '_');
  const shortName = (fqn: string) => {
    const i = fqn.lastIndexOf('.');
    return i < 0 ? fqn : fqn.slice(i + 1);
  };
  const moduleOf = (fqn: string) => {
    const i = fqn.lastIndexOf('.');
    return i < 0 ? '' : fqn.slice(0, i);
  };

  const trackInModule = (fqn: string, nodeId: string) => {
    const mod = moduleOf(fqn);
    if (mod === '') return;
    let arr = modules.get(mod);
    if (!arr) {
      arr = [];
      modules.set(mod, arr);
    }
    arr.push(nodeId);
  };

  // ── Emit nodes ───────────────────────────────────────────────────────────
  // Stocks first (always rendered). Their colorIndex mirrors the chart's
  // declaration-order palette so a gauge and its line carry the same hue.
  let stockColorIdx = 0;
  for (const s of program.stocks) {
    if (s.synthetic) continue;
    const id = idOf(s.fqn);
    const label = shortName(s.fqn);
    nodes.push({
      id,
      type: 'stock',
      position: { x: 0, y: 0 },
      data: {
        fqn: s.fqn,
        label,
        slot: s.slot,
        size: sizeFor('stock', label),
        colorIndex: stockColorIdx,
      },
    });
    trackInModule(s.fqn, id);
    stockColorIdx++;
  }

  // Flows — emitted only in SFD mode. In CLD mode the flow's contribution
  // is collapsed into the source → target causal arc on the affected stock.
  if (mode === 'sfd') {
    for (const flowFqn of flows.keys()) {
      const id = idOf(flowFqn);
      const label = shortName(flowFqn);
      nodes.push({
        id,
        type: 'flow',
        position: { x: 0, y: 0 },
        data: { fqn: flowFqn, label, size: sizeFor('flow', label) },
      });
      trackInModule(flowFqn, id);
    }
  }

  // Auxiliaries (gated by toggle, forced on in CLD mode).
  if (showAuxEffective) {
    for (const c of program.calcs) {
      const id = idOf(c.fqn);
      const label = shortName(c.fqn);
      nodes.push({
        id,
        type: 'aux',
        position: { x: 0, y: 0 },
        data: { fqn: c.fqn, label, kind: 'calc', size: sizeFor('calc', label) },
      });
      trackInModule(c.fqn, id);
    }
    for (const c of program.constants) {
      const id = idOf(c.fqn);
      const label = shortName(c.fqn);
      const data: AuxNodeData = c.exogenous
        ? { fqn: c.fqn, label, kind: 'constant', size: sizeFor('constant', label), exogenous: true }
        : { fqn: c.fqn, label, kind: 'constant', size: sizeFor('constant', label) };
      nodes.push({
        id,
        type: 'aux',
        position: { x: 0, y: 0 },
        data,
      });
      trackInModule(c.fqn, id);
    }
    for (const m of program.symbols.ofKind('map')) {
      const id = idOf(m.fqn);
      const label = shortName(m.fqn);
      nodes.push({
        id,
        type: 'aux',
        position: { x: 0, y: 0 },
        data: { fqn: m.fqn, label, kind: 'map', size: sizeFor('map', label) },
      });
      trackInModule(m.fqn, id);
    }
  }

  // Track which FQNs ended up as nodes — used for renderable checks below.
  const renderable = new Set(nodes.map((n) => 'fqn' in n.data ? (n.data as { fqn: string }).fqn : ''));

  // ── Matter-flow edges (cloud ↔ flow ↔ stock) ─────────────────────────────
  // CLD mode skips them entirely — the equivalent causal arc is rendered
  // below as a direct source → stock info link from program.influences[].
  let cloudIdx = 0;
  const newCloud = () => {
    const id = `cloud_${cloudIdx++}`;
    nodes.push({
      id,
      type: 'cloud',
      position: { x: 0, y: 0 },
      data: { size: sizeFor('cloud', '') },
    });
    return id;
  };

  if (mode === 'sfd') for (const [flowFqn, effs] of flows) {
    const flowId = idOf(flowFqn);
    const positives = effs.filter((e) => e.polarity === 'positive');
    const negatives = effs.filter((e) => e.polarity === 'negative');
    if (positives.length === 0 && negatives.length === 0) continue;

    const matterData = { flowFqn };

    if (positives.length > 0 && negatives.length === 0) {
      const cloud = newCloud();
      edges.push({
        id: `${cloud}-${flowId}`,
        source: cloud,
        target: flowId,
        type: 'matter',
        data: matterData,
      });
      for (const e of positives) {
        edges.push({
          id: `${flowId}-${idOf(e.stockFqn)}`,
          source: flowId,
          target: idOf(e.stockFqn),
          type: 'matter',
          data: matterData,
        });
      }
    } else if (negatives.length > 0 && positives.length === 0) {
      const cloud = newCloud();
      for (const e of negatives) {
        edges.push({
          id: `${idOf(e.stockFqn)}-${flowId}`,
          source: idOf(e.stockFqn),
          target: flowId,
          type: 'matter',
          data: matterData,
        });
      }
      edges.push({
        id: `${flowId}-${cloud}`,
        source: flowId,
        target: cloud,
        type: 'matter',
        data: matterData,
      });
    } else {
      for (const e of negatives) {
        edges.push({
          id: `${idOf(e.stockFqn)}-${flowId}`,
          source: idOf(e.stockFqn),
          target: flowId,
          type: 'matter',
          data: matterData,
        });
      }
      for (const e of positives) {
        edges.push({
          id: `${flowId}-${idOf(e.stockFqn)}`,
          source: flowId,
          target: idOf(e.stockFqn),
          type: 'matter',
          data: matterData,
        });
      }
    }
  }

  // ── Information links (source → flow / source → calc), with delay sub. ───
  const drawn = new Set<string>();
  const drawInfo = (
    sourceFqn: string,
    targetFqn: string,
    polarity: '+' | '-' | '?',
    delayed: boolean,
  ) => {
    if (!renderable.has(sourceFqn) || !renderable.has(targetFqn)) return;
    const key = `${sourceFqn}→${targetFqn}|${delayed ? 'd' : ''}`;
    if (drawn.has(key)) return;
    drawn.add(key);
    edges.push({
      id: `info_${key}`,
      source: idOf(sourceFqn),
      target: idOf(targetFqn),
      type: 'info',
      data: { polarity, delayed },
    });
  };

  const resolveSourceFqns = (sourceId: number): { fqns: string[]; delayed: boolean } => {
    const sym = program.symbols.byId(sourceId);
    const delay = lookupDelay(sym);
    if (!delay) {
      const fqn = sym?.fqn;
      return { fqns: fqn ? [fqn] : [], delayed: false };
    }
    const fqns: string[] = [];
    for (const inputId of delay.inputIds) {
      const sub = resolveSourceFqns(inputId);
      for (const f of sub.fqns) if (!fqns.includes(f)) fqns.push(f);
    }
    return { fqns, delayed: true };
  };

  // SFD info-links route through the flow valve (source → flow). CLD has no
  // flow nodes, so this loop is skipped and the source's effect on the
  // affected stock is rendered below from `influences[]` instead.
  if (mode === 'sfd') for (const fi of program.flowInputs) {
    const flowSym = program.symbols.byId(fi.flow);
    if (!flowSym || flowSym.kind !== 'flow') continue;
    const { fqns, delayed } = resolveSourceFqns(fi.source);
    for (const sourceFqn of fqns) drawInfo(sourceFqn, flowSym.fqn, fi.polarity, delayed);
  }

  // Source → target causal arcs from the influence graph. SFD mode draws
  // only calc targets (stock targets are covered by matter flow + flowInputs);
  // CLD mode draws every target, including stocks (the SFD plumbing was
  // collapsed into these arcs by `buildInfluences` already).
  for (const inf of program.influences) {
    const tk = symKind(inf.target);
    if (mode === 'sfd' && tk !== 'calc') continue;
    if (mode === 'cld' && tk !== 'calc' && tk !== 'stock') continue;
    const targetFqn = symFqn(inf.target);
    if (!targetFqn) continue;
    const { fqns, delayed } = resolveSourceFqns(inf.source);
    for (const sourceFqn of fqns) drawInfo(sourceFqn, targetFqn, inf.polarity, delayed);
  }

  return { nodes, edges, modules };
}
