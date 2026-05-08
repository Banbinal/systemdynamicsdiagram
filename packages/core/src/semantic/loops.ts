/**
 * Feedback-loop detection on the influence graph.
 *
 * Walks `program.influences[]` to find all *elementary* feedback cycles
 * (no node repeats, except the closing edge), then classifies each as
 * **Reinforcing** (R, even number of negative links) or **Balancing**
 * (B, odd number) per the canonical SD convention (Sterman 2000).
 *
 * Algorithm: Johnson-style enumeration without the blocking optimization —
 * for each starting node in id order, DFS only visits nodes whose id is ≥
 * the start. That guarantees each cycle is reported exactly once, with its
 * smallest node first. Sufficient for typical SD models (≤ ~50 variables,
 * ≤ ~30 cycles).
 *
 * Constants never participate in cycles (they appear only as influence
 * sources, never targets), so they're naturally excluded.
 */

import type { CompiledProgram, Polarity } from '../ir/program.js';

export interface Loop {
  /** Stable identifier: R1, R2, ..., or B1, B2, ... in discovery order. */
  readonly id: string;
  /** Reinforcing or Balancing. */
  readonly kind: 'R' | 'B';
  /**
   * Symbol ids of the nodes around the cycle, in traversal order.
   * The cycle closes from `nodes[last] → nodes[0]`.
   */
  readonly nodeIds: readonly number[];
  /** Same nodes, resolved to fully-qualified names for display. */
  readonly nodes: readonly string[];
  /**
   * Polarity of each edge around the cycle. `edgePolarities[i]` is the
   * polarity of the edge `nodes[i] → nodes[(i+1) mod n]`.
   */
  readonly edgePolarities: readonly Polarity[];
  /** Count of `-` polarities; parity determines R vs B. */
  readonly negativeCount: number;
  /** Count of `?` polarities; if > 0 the R/B classification is uncertain. */
  readonly unknownCount: number;
}

export function findLoops(program: CompiledProgram): readonly Loop[] {
  type Edge = { readonly target: number; readonly polarity: Polarity };
  const adj = new Map<number, Edge[]>();
  for (const inf of program.influences) {
    let arr = adj.get(inf.source);
    if (!arr) {
      arr = [];
      adj.set(inf.source, arr);
    }
    arr.push({ target: inf.target, polarity: inf.polarity });
  }

  const sortedStarts = [...adj.keys()].sort((a, b) => a - b);
  const found: { nodeIds: number[]; polarities: Polarity[] }[] = [];

  for (const start of sortedStarts) {
    // Enumerate cycles whose smallest node is `start`.
    const path: number[] = [start];
    const polPath: Polarity[] = [];
    const inPath = new Set<number>([start]);

    const dfs = (node: number): void => {
      const edges = adj.get(node);
      if (!edges) return;
      for (const e of edges) {
        if (e.target < start) continue; // Smaller starts handle these.
        if (e.target === start) {
          // Cycle closed.
          found.push({
            nodeIds: [...path],
            polarities: [...polPath, e.polarity],
          });
          continue;
        }
        if (inPath.has(e.target)) continue; // Re-entry but not closing — skip.
        inPath.add(e.target);
        path.push(e.target);
        polPath.push(e.polarity);
        dfs(e.target);
        path.pop();
        polPath.pop();
        inPath.delete(e.target);
      }
    };
    dfs(start);
  }

  // Classify and number.
  let rIdx = 1;
  let bIdx = 1;
  const out: Loop[] = [];
  for (const { nodeIds, polarities } of found) {
    const negativeCount = polarities.filter((p) => p === '-').length;
    const unknownCount = polarities.filter((p) => p === '?').length;
    const kind: 'R' | 'B' = negativeCount % 2 === 0 ? 'R' : 'B';
    const id = kind === 'R' ? `R${rIdx++}` : `B${bIdx++}`;
    const nodes = nodeIds.map((nid) => program.symbols.byId(nid)?.fqn ?? `#${nid}`);
    out.push({ id, kind, nodeIds, nodes, edgePolarities: polarities, negativeCount, unknownCount });
  }
  return out;
}
