/**
 * Dependency graph + cycle detection (Tarjan's SCC) + topological sort.
 *
 * Stable error codes:
 *   SD0050  cycle in calc/constant dependencies
 */

import type { Diagnostic } from '../diagnostics/diagnostic.js';
import type { CalcStmt, ConstantStmt, Expr, Stmt } from '../syntax/ast.js';
import type { Symbol, SymbolTable } from './symbols.js';

/**
 * Build a dependency graph among constants and calcs.
 *
 * Edges: `target → source` means "target depends on source", i.e. source must
 * be evaluated first. Stocks are *cut points* — a calc that references a stock
 * does NOT add an edge (the stock value is read from the state vector at each
 * step, which breaks the cycle).
 *
 * Builtins and maps don't appear as graph nodes either.
 */
export function buildDepGraph(
  resolvedRefs: ReadonlyMap<object, Symbol>,
  stmtSymbols: ReadonlyMap<Stmt, Symbol>,
): Map<number, Set<number>> {
  const graph = new Map<number, Set<number>>();

  for (const [stmt, sym] of stmtSymbols) {
    if (sym.kind !== 'calc' && sym.kind !== 'constant') continue;
    const deps = new Set<number>();
    const expr = stmt.kind === 'Calc'
      ? (stmt as CalcStmt).expr
      : stmt.kind === 'Constant'
        ? (stmt as ConstantStmt).expr
        : null;
    if (expr) collectExprDeps(expr, resolvedRefs, deps);
    graph.set(sym.id, deps);
  }
  return graph;
}

function collectExprDeps(
  expr: Expr,
  resolvedRefs: ReadonlyMap<object, Symbol>,
  out: Set<number>,
): void {
  switch (expr.kind) {
    case 'NumberLit':
      return;
    case 'Ref': {
      const sym = resolvedRefs.get(expr);
      if (sym && (sym.kind === 'calc' || sym.kind === 'constant')) {
        out.add(sym.id);
      }
      // stocks, builtins, maps: not graph deps
      return;
    }
    case 'Call':
      for (const a of expr.args) collectExprDeps(a, resolvedRefs, out);
      return;
    case 'Binary':
      collectExprDeps(expr.left, resolvedRefs, out);
      collectExprDeps(expr.right, resolvedRefs, out);
      return;
    case 'Unary':
      collectExprDeps(expr.operand, resolvedRefs, out);
      return;
  }
}

// ──────────────────────────────────────────────────────────────────────────────
// Tarjan's SCC for cycle detection

interface TarjanState {
  index: number;
  lowlink: number;
  onStack: boolean;
}

/**
 * Find all strongly-connected components in the dep graph. Any SCC with more
 * than one node, OR a single-node SCC with a self-edge, indicates a cycle.
 */
export function findCycles(graph: Map<number, Set<number>>): number[][] {
  const state = new Map<number, TarjanState>();
  const stack: number[] = [];
  const sccs: number[][] = [];
  let counter = 0;

  const strongconnect = (v: number): void => {
    const vState: TarjanState = { index: counter, lowlink: counter, onStack: true };
    state.set(v, vState);
    counter++;
    stack.push(v);

    const succ = graph.get(v);
    if (succ) {
      for (const w of succ) {
        const wState = state.get(w);
        if (!wState) {
          strongconnect(w);
          const wAfter = state.get(w)!;
          vState.lowlink = Math.min(vState.lowlink, wAfter.lowlink);
        } else if (wState.onStack) {
          vState.lowlink = Math.min(vState.lowlink, wState.index);
        }
      }
    }

    if (vState.lowlink === vState.index) {
      const scc: number[] = [];
      while (true) {
        const w = stack.pop()!;
        state.get(w)!.onStack = false;
        scc.push(w);
        if (w === v) break;
      }
      // Cycle if SCC has >1 node, OR one node with a self-edge
      if (scc.length > 1 || (scc.length === 1 && graph.get(scc[0]!)?.has(scc[0]!))) {
        sccs.push(scc);
      }
    }
  };

  for (const v of graph.keys()) {
    if (!state.has(v)) strongconnect(v);
  }
  return sccs;
}

/**
 * Topologically sort calc/constant ids so each appears after all its
 * dependencies. Throws (returns null + diagnostic) if any cycle exists.
 *
 * Ordering: dependencies first. So `[a, b]` means `a` must be evaluated before `b`
 * if `b` depends on `a`.
 */
export function topoSort(
  graph: Map<number, Set<number>>,
): { order: number[] } | { cycles: number[][] } {
  const cycles = findCycles(graph);
  if (cycles.length > 0) return { cycles };

  // Kahn's algorithm
  const inDegree = new Map<number, number>();
  for (const v of graph.keys()) inDegree.set(v, 0);
  for (const [, deps] of graph) {
    for (const d of deps) {
      // We're computing in-degree of `v` as "number of edges INTO v",
      // but our graph edges are v→deps meaning "v depends on deps".
      // For topo where deps come first, we count how many other nodes
      // depend on each node — that's the OUT-degree of each node in our graph,
      // which is the IN-degree in the reversed graph.
      inDegree.set(d, (inDegree.get(d) ?? 0) + 1);
    }
  }
  // Roots: nodes with in-degree 0 (no other node depends on them)
  // Wait — we want LEAVES first (deps before dependents). In our graph
  // (v → deps), a leaf in our orientation has no out-edges — a node with no deps.
  // Those should come first. So we run Kahn on the REVERSED graph: for each node,
  // its prerequisites in our orientation = its successors in the reversed graph.
  //
  // Simpler: compute order by recursive DFS of "deps first" with memoization.
  const order: number[] = [];
  const visited = new Set<number>();
  const visit = (v: number): void => {
    if (visited.has(v)) return;
    visited.add(v);
    const deps = graph.get(v);
    if (deps) for (const d of deps) visit(d);
    order.push(v);
  };
  for (const v of graph.keys()) visit(v);
  return { order };
}

/** Convenience: emit cycle diagnostics from a list of SCCs. */
export function emitCycleDiagnostics(
  cycles: number[][],
  table: SymbolTable,
): Diagnostic[] {
  return cycles.map((scc) => {
    const names = scc.map((id) => table.byId(id)?.fqn ?? `#${id}`);
    const range = table.byId(scc[0]!)?.declRange;
    return {
      severity: 'error',
      code: 'SD0050',
      message: `Cyclic dependency detected: ${names.join(' → ')} → ${names[0]}.`,
      range: range ?? {
        start: { line: 0, column: 0, offset: 0 },
        end: { line: 0, column: 0, offset: 0 },
      },
    } satisfies Diagnostic;
  });
}
