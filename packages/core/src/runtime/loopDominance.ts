/**
 * Loop dominance over time — pragmatic approximation of "Loops That Matter".
 *
 * For each detected feedback loop L, we compute an activity score at every
 * recorded simulation step. The score is the sum of |rate| of the flows that
 * mediate L's arcs — i.e. the flows that simultaneously have a source in L
 * and an effect on the next node in L.
 *
 * The dominant loop at each step is the one with the highest score. This is
 * lighter than Schoenberg/Hayward/Eberlein's full LTM (which uses partial
 * derivatives along every link) but agrees with it on the qualitative story:
 * when stocks involved in a loop are changing fast, the flows around them
 * carry a lot of matter, and the loop "drives" the dynamics at that moment.
 *
 * Pure calc-only loops (no flow mediation) score 0 — they're typically not
 * what users are watching for dominance anyway.
 */

import type { CompiledProgram } from '../ir/program.js';
import type { Loop } from '../semantic/loops.js';
import type { SimulationResult } from './simulate.js';

export interface LoopActivitySeries {
  readonly loopId: string;
  /** Activity score at each recorded step. Same length as result.time. */
  readonly activity: Float64Array;
}

export interface LoopDominance {
  /** Per-loop time series of activity scores. */
  readonly perLoop: readonly LoopActivitySeries[];
  /**
   * Loop id that dominates at each step (argmax of activity), or null when
   * every loop scores 0 (system at rest, or no flow-mediated loops).
   */
  readonly dominant: readonly (string | null)[];
}

export function findLoopDominance(
  program: CompiledProgram,
  result: SimulationResult,
  loops: readonly Loop[],
): LoopDominance {
  const T = result.time.length;
  if (T === 0 || loops.length === 0) {
    return { perLoop: [], dominant: [] };
  }

  // ── Map each loop to the FQNs of its mediating flows ─────────────────
  // For each consecutive pair (source, target) around the loop, find flows
  // where the source feeds the flow's rate AND the flow has an effect on
  // the target stock. The union of those flows is the loop's "mediators".
  const loopFlows = new Map<string, Set<string>>();
  for (const loop of loops) {
    const flows = new Set<string>();
    for (let i = 0; i < loop.nodeIds.length; i++) {
      const sourceId = loop.nodeIds[i]!;
      const nextId = loop.nodeIds[(i + 1) % loop.nodeIds.length]!;
      const nextSym = program.symbols.byId(nextId);
      if (!nextSym || nextSym.kind !== 'stock') continue;
      // For each flow that the source feeds…
      for (const fi of program.flowInputs) {
        if (fi.source !== sourceId) continue;
        const flowSym = program.symbols.byId(fi.flow);
        if (!flowSym) continue;
        // …does it touch the next stock?
        const touches = program.flowEffects.some((eff) => {
          if (eff.flowFqn !== flowSym.fqn) return false;
          const stock = program.stocks.find((s) => s.slot === eff.targetSlot);
          return stock?.fqn === nextSym.fqn;
        });
        if (touches) flows.add(flowSym.fqn);
      }
    }
    loopFlows.set(loop.id, flows);
  }

  // ── Per-step activity = sum of |rate| over the loop's flows ──────────
  const perLoop: LoopActivitySeries[] = loops.map((loop) => {
    const flows = loopFlows.get(loop.id) ?? new Set();
    const activity = new Float64Array(T);
    for (let t = 0; t < T; t++) {
      let sum = 0;
      for (const fqn of flows) {
        const series = result.flows[fqn];
        if (series && t < series.length) sum += Math.abs(series[t] ?? 0);
      }
      activity[t] = sum;
    }
    return { loopId: loop.id, activity };
  });

  // ── Dominant per step ────────────────────────────────────────────────
  const dominant: (string | null)[] = new Array(T).fill(null);
  for (let t = 0; t < T; t++) {
    let bestId: string | null = null;
    let bestVal = 0;
    for (const series of perLoop) {
      const v = series.activity[t]!;
      if (v > bestVal) {
        bestVal = v;
        bestId = series.loopId;
      }
    }
    dominant[t] = bestId;
  }

  return { perLoop, dominant };
}
