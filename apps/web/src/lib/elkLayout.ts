import ELK from 'elkjs/lib/elk.bundled.js';
import type { ElkNode } from 'elkjs/lib/elk-api';

import type {
  DiagramEdge,
  DiagramNode,
  GroupNodeData,
  ProgramGraph,
} from './programToReactFlow.ts';

const elk = new ELK();

// Distance, in px, between a cloud and the flow it connects to. ELK's layered
// algorithm puts clouds in their own layer (~60px gap) which reads as visually
// disconnected; we override that with a tight gap post-layout.
const CLOUD_GAP = 22;

/**
 * Lay out a `ProgramGraph` with the ELK layered algorithm.
 *
 * Returns a Promise that resolves to a list of React Flow nodes (now including
 * group nodes for module clusters) and edges. Module children carry a
 * `parentId` and a position relative to their parent group, per React Flow's
 * grouping convention. Clouds are top-level and get snapped close to their
 * connected flow so they don't drift to a separate layer.
 */
export async function layoutProgramGraph(graph: ProgramGraph): Promise<{
  nodes: DiagramNode[];
  edges: DiagramEdge[];
}> {
  const elkGraph = buildElkSpec(graph);
  const laid = await elk.layout(elkGraph);
  return composeReactFlow(graph, laid);
}

function buildElkSpec(graph: ProgramGraph): ElkNode {
  // Build a flat node id → ElkNode map first; we'll then reparent into modules.
  // Sizes ride on each node's data (set by `programToReactFlow` via the shared
  // `sizeFor` helper) so layout and rendering agree on every box's footprint.
  const elkNodes = new Map<string, ElkNode>();
  for (const n of graph.nodes) {
    if (n.type === 'group') continue; // not produced upstream, defensive
    const { width, height } = (n.data as { size: { width: number; height: number } }).size;
    elkNodes.set(n.id, {
      id: n.id,
      width,
      height,
    });
  }

  // Module clusters become ElkNode containers. Inside each, ELK runs its own
  // layered pass — that gives us module-local layouts inside the global one.
  const moduleNodes = new Map<string, ElkNode>();
  for (const [moduleFqn, childIds] of graph.modules) {
    const sgId = 'mod_' + moduleFqn.replace(/[.\s]/g, '_');
    moduleNodes.set(moduleFqn, {
      id: sgId,
      labels: [{ text: moduleFqn }],
      children: childIds
        .map((cid) => elkNodes.get(cid))
        .filter((n): n is ElkNode => n !== undefined),
      layoutOptions: {
        'elk.algorithm': 'layered',
        'elk.direction': 'RIGHT',
        'elk.padding': '[top=28,left=14,bottom=14,right=14]',
        'elk.spacing.nodeNode': '24',
        'elk.layered.spacing.nodeNodeBetweenLayers': '40',
      },
    });
  }

  // Top-level children = (nodes not in any module) + module clusters.
  const childIdsInModules = new Set<string>();
  for (const [, ids] of graph.modules) for (const id of ids) childIdsInModules.add(id);
  const rootChildren: ElkNode[] = [];
  for (const n of graph.nodes) {
    if (n.type === 'group') continue;
    if (!childIdsInModules.has(n.id)) {
      const en = elkNodes.get(n.id);
      if (en) rootChildren.push(en);
    }
  }
  for (const m of moduleNodes.values()) rootChildren.push(m);

  return {
    id: 'root',
    layoutOptions: {
      'elk.algorithm': 'layered',
      'elk.direction': 'RIGHT',
      'elk.spacing.nodeNode': '36',
      'elk.layered.spacing.nodeNodeBetweenLayers': '60',
      'elk.layered.crossingMinimization.strategy': 'LAYER_SWEEP',
    },
    children: rootChildren,
    edges: graph.edges.map((e) => ({
      id: e.id,
      sources: [e.source],
      targets: [e.target],
    })),
  };
}

/**
 * Reconstruct React Flow nodes from the ELK output. Modules become group
 * nodes; their children adopt `parentId` and keep their parent-relative
 * positions so React Flow's nested-node coordinate system handles the rest.
 */
function composeReactFlow(
  graph: ProgramGraph,
  laid: ElkNode,
): { nodes: DiagramNode[]; edges: DiagramEdge[] } {
  const groupNodes: DiagramNode[] = [];
  const childParent = new Map<string, string>();
  const positions = new Map<string, { x: number; y: number }>();
  const absolutePositions = new Map<string, { x: number; y: number }>();

  function processModule(elkMod: ElkNode, absX: number, absY: number) {
    const moduleFqn = elkMod.labels?.[0]?.text ?? elkMod.id;
    const w = elkMod.width ?? 0;
    const h = elkMod.height ?? 0;
    const data: GroupNodeData = { fqn: moduleFqn, label: moduleFqn, width: w, height: h };
    groupNodes.push({
      id: elkMod.id,
      type: 'group',
      position: { x: absX, y: absY },
      data,
      style: { width: w, height: h },
      draggable: false,
      selectable: false,
    } as DiagramNode);
    absolutePositions.set(elkMod.id, { x: absX, y: absY });

    for (const child of elkMod.children ?? []) {
      const cx = child.x ?? 0;
      const cy = child.y ?? 0;
      childParent.set(child.id, elkMod.id);
      // Position is parent-relative — React Flow expects this when parentId is set.
      positions.set(child.id, { x: cx, y: cy });
      absolutePositions.set(child.id, { x: absX + cx, y: absY + cy });
    }
  }

  for (const child of laid.children ?? []) {
    const cx = child.x ?? 0;
    const cy = child.y ?? 0;
    if (child.id.startsWith('mod_')) {
      processModule(child, cx, cy);
    } else {
      positions.set(child.id, { x: cx, y: cy });
      absolutePositions.set(child.id, { x: cx, y: cy });
    }
  }

  // ── Snap each cloud close to its connected flow ──────────────────────────
  // ELK's layered algorithm allocates a full layer for clouds, which leaves
  // them visually disconnected. Each cloud has a single matter-flow edge —
  // we override its position to sit a small fixed gap away from its partner.
  const cloudEdges = graph.edges.filter((e) => e.type === 'matter');
  for (const n of graph.nodes) {
    if (n.type !== 'cloud') continue;
    const e = cloudEdges.find((edge) => edge.source === n.id || edge.target === n.id);
    if (!e) continue;
    const otherId = e.source === n.id ? e.target : e.source;
    const otherAbs = absolutePositions.get(otherId);
    const otherNode = graph.nodes.find((x) => x.id === otherId);
    if (!otherAbs || !otherNode || otherNode.type === 'group') continue;
    const otherSize = (otherNode.data as { size: { width: number; height: number } }).size;
    const cloudSize = (n.data as { size: { width: number; height: number } }).size;
    const otherCenterY = otherAbs.y + otherSize.height / 2;
    const newY = otherCenterY - cloudSize.height / 2;
    let newX: number;
    if (e.source === n.id) {
      // Cloud → flow: cloud sits to the LEFT of its target.
      newX = otherAbs.x - cloudSize.width - CLOUD_GAP;
    } else {
      // Flow → cloud: cloud sits to the RIGHT of its source.
      newX = otherAbs.x + otherSize.width + CLOUD_GAP;
    }
    positions.set(n.id, { x: newX, y: newY });
    absolutePositions.set(n.id, { x: newX, y: newY });
  }

  // ── Emit React Flow nodes: groups first (parents must precede children) ──
  const out: DiagramNode[] = [];
  for (const g of groupNodes) out.push(g);
  for (const n of graph.nodes) {
    const pos = positions.get(n.id) ?? { x: 0, y: 0 };
    const parentId = childParent.get(n.id);
    if (parentId) {
      out.push({ ...n, position: pos, parentId, extent: 'parent' as const } as DiagramNode);
    } else {
      out.push({ ...n, position: pos } as DiagramNode);
    }
  }

  return { nodes: out, edges: [...graph.edges] };
}
