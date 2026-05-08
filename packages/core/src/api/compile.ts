/**
 * Public compile API — runs resolver, dep graph, topo sort, polarity inference,
 * and IR lowering, producing a `CompiledProgram` ready for `simulate`.
 *
 * Pipeline:
 *   1. resolve(ast) — symbol table + resolved Refs + duplicate/unknown diags
 *   2. flatten the program into typed buckets (constants, stocks, calcs, …),
 *      recursing into modules so every bucket is already namespaced
 *   3. build the dep graph (constants + calcs only; stocks are cut points),
 *      then topo-sort. Cycles → SD0050, simulation gets an empty program but
 *      the rest of the pipeline still runs so we report all diagnostics in
 *      one pass
 *   4. allocate dense per-region slot indices (constants: topo order;
 *      stocks: declaration order; calcs: topo order; maps: declaration order)
 *   5. lower every Expr to flat ops with pre-resolved slot indices
 *   6. precompute natural-cubic-spline second derivatives for spline maps
 *   7. infer per-target polarity for each calc and flow effect, fold into
 *      the program-wide influence list
 *   8. assemble the CompiledProgram
 */

import type { Diagnostic } from '../diagnostics/diagnostic.js';
import { ZERO_POSITION } from '../diagnostics/source.js';
import {
  buildDepGraph,
  emitCycleDiagnostics,
  findCycles,
  topoSort,
} from '../semantic/deps.js';
import { desugar } from '../semantic/desugar.js';
import { inferPolarities, signOfConstantExpr, type Polarity } from '../semantic/polarity.js';
import { resolve } from '../semantic/resolver.js';
import type { Symbol, SymbolTable } from '../semantic/symbols.js';
import type {
  CalcStmt,
  CalibrateStmt,
  CheckStmt,
  ConstantStmt,
  Expr,
  FlowStmt,
  LimitStmt,
  MapStmt,
  PlotStmt,
  Program,
  ReferenceStmt,
  ScenarioStmt,
  Stmt,
  StockStmt,
  SweepStmt,
  TitleStmt,
  TimeConfigStmt,
} from '../syntax/ast.js';
import { lowerExpr, type SlotIndex } from '../ir/lower.js';
import { precomputeSpline } from '../ir/interp.js';
import type {
  CalcIR,
  CalibrateIR,
  CalibrateParamIR,
  CheckIR,
  CheckInputIR,
  CompiledExpr,
  CompiledProgram,
  FlowEffectIR,
  FlowInput,
  Influence,
  LimitIR,
  MapData,
  ReferenceModeIR,
  ScenarioIR,
  StockIR,
  SweepIR,
} from '../ir/program.js';

export interface CompileResult {
  readonly program: CompiledProgram;
  readonly diagnostics: readonly Diagnostic[];
}

const DEFAULT_TIME = { startTime: 0, endTime: 10, timeStep: 1 };

/** Compile an AST into a simulation-ready `CompiledProgram`. */
export function compile(ast: Program): CompileResult {
  // ─── 0. Desugar smooth/delay3/step/pulse ───────────────────────────────
  // Runs before resolve so the rewritten AST is resolved fresh in one shot.
  const ds = desugar(ast);
  const diagnostics: Diagnostic[] = [...ds.diagnostics];

  // ─── 1. Resolve ─────────────────────────────────────────────────────────
  const r = resolve(ds.program);
  diagnostics.push(...r.diagnostics);

  // ─── 2. Flatten the AST into typed buckets ─────────────────────────────
  const buckets = collectStmts(ds.program);

  // Time config & title (last writer wins for repeated keys; simplest sane
  // default — a stricter validator can flag duplicates in a later PR).
  const time = { ...DEFAULT_TIME };
  for (const t of buckets.times) {
    if (t.key === 'StartTime') time.startTime = t.value;
    else if (t.key === 'EndTime') time.endTime = t.value;
    else if (t.key === 'TimeStep') time.timeStep = t.value;
  }
  const title = buckets.titles[buckets.titles.length - 1]?.text ?? null;

  // ─── 3. Dep graph + topo sort ──────────────────────────────────────────
  const graph = buildDepGraph(r.resolvedRefs, r.stmtSymbols);
  const cycles = findCycles(graph);
  if (cycles.length > 0) {
    diagnostics.push(...emitCycleDiagnostics(cycles, r.table));
  }
  const topo = topoSort(graph);
  const topoOrder: number[] = 'order' in topo ? topo.order : [];

  // ─── 4. Allocate slots ─────────────────────────────────────────────────
  const slots = allocateSlots(buckets, r.stmtSymbols, r.table, topoOrder);

  // ─── 5. Lower every Expr ───────────────────────────────────────────────
  const lowerCtx = {
    resolvedRefs: r.resolvedRefs,
    slots,
    table: r.table,
  };

  // Helper: lower one expression, accumulate diagnostics.
  const lower = (e: Expr): CompiledExpr => {
    const { expr, diagnostics: d } = lowerExpr(e, lowerCtx);
    if (d.length) diagnostics.push(...d);
    return expr;
  };

  // Constants in topo order: each constant.expr can reference earlier constants.
  const constantsByTopo = topoOrder
    .map((id) => buckets.constantsBySymId.get(id))
    .filter((x): x is { stmt: ConstantStmt; symbol: Symbol } => x !== undefined);

  const constants = constantsByTopo.map(({ stmt, symbol }) => {
    const base = {
      slot: slots.constantSlot.get(symbol.id)!,
      fqn: symbol.fqn,
      expr: lower(stmt.expr),
    };
    return stmt.exogenous ? { ...base, exogenous: true } : base;
  });

  const stocks: StockIR[] = buckets.stocks.map(({ stmt, symbol }) => {
    const base = {
      slot: slots.stockSlot.get(symbol.id)!,
      fqn: symbol.fqn,
      init: lower(stmt.init),
      synthetic: stmt.synthetic ?? false,
    };
    if (!stmt.delayKind) return base;
    // Recover the input source(s) from the synthetic stock's init expression
    // — desugaring sets init = the original input expression, so its referenced
    // symbols are exactly what feed the delay.
    const inputSyms = new Set<number>();
    collectExprSymbols(stmt.init, r.resolvedRefs, inputSyms);
    return { ...base, delayKind: stmt.delayKind, delayInputs: [...inputSyms] };
  });

  // Calcs in topo order so the runtime can evaluate them sequentially.
  const calcsByTopo = topoOrder
    .map((id) => buckets.calcsBySymId.get(id))
    .filter((x): x is { stmt: CalcStmt; symbol: Symbol } => x !== undefined);

  const calcs: CalcIR[] = calcsByTopo.map(({ stmt, symbol }) => ({
    slot: slots.calcSlot.get(symbol.id)!,
    fqn: symbol.fqn,
    expr: lower(stmt.expr),
  }));

  const flowEffects: FlowEffectIR[] = [];
  for (const { stmt: flow, symbol: flowSym } of buckets.flows) {
    for (const eff of flow.effects) {
      const targetSym = resolveTarget(r.resolvedRefs, eff.target);
      if (!targetSym || targetSym.kind !== 'stock') continue; // resolver already flagged
      const targetSlot = slots.stockSlot.get(targetSym.id);
      if (targetSlot === undefined) continue;
      flowEffects.push({
        flowFqn: flowSym.fqn,
        targetSlot,
        polarity: eff.polarity,
        expr: lower(eff.expr),
      });
    }
  }

  // ─── 6. Maps ───────────────────────────────────────────────────────────
  const maps: MapData[] = buckets.maps.map(({ stmt, symbol }) => {
    const xs = new Float64Array(stmt.points.map((p) => p.x));
    const ys = new Float64Array(stmt.points.map((p) => p.y));
    const idx = slots.mapIndex.get(symbol.id)!;
    if (stmt.interpolation === 'spline') {
      return {
        id: idx,
        fqn: symbol.fqn,
        interpolation: 'spline',
        xs,
        ys,
        y2: precomputeSpline(xs, ys),
      };
    }
    return {
      id: idx,
      fqn: symbol.fqn,
      interpolation: stmt.interpolation,
      xs,
      ys,
    };
  });

  // ─── 7. Scenarios, sweeps, limits, plots ───────────────────────────────
  const scenarios: ScenarioIR[] = buckets.scenarios.map((sc) => {
    const constantOverrides: { slot: number; expr: CompiledExpr }[] = [];
    const stockOverrides: { slot: number; expr: CompiledExpr }[] = [];
    for (const ov of sc.overrides) {
      const sym = resolveTarget(r.resolvedRefs, ov.target);
      if (!sym) continue;
      const expr = lower(ov.expr);
      if (ov.targetKind === 'constant' && sym.kind === 'constant') {
        const slot = slots.constantSlot.get(sym.id);
        if (slot !== undefined) constantOverrides.push({ slot, expr });
      } else if (ov.targetKind === 'stock' && sym.kind === 'stock') {
        const slot = slots.stockSlot.get(sym.id);
        if (slot !== undefined) stockOverrides.push({ slot, expr });
      }
    }
    return { name: sc.name, constantOverrides, stockOverrides };
  });

  const sweeps: SweepIR[] = [];
  for (const sw of buckets.sweeps) {
    const sym = resolveTarget(r.resolvedRefs, sw.target);
    if (!sym || sym.kind !== 'constant') continue;
    const slot = slots.constantSlot.get(sym.id);
    if (slot === undefined) continue;
    sweeps.push({
      target: sym.fqn,
      slot,
      values: new Float64Array(sw.values),
    });
  }

  const limits: LimitIR[] = [];
  for (const lim of buckets.limits) {
    const sym = resolveTarget(r.resolvedRefs, lim.target);
    if (!sym || sym.kind !== 'stock') continue;
    const slot = slots.stockSlot.get(sym.id);
    if (slot === undefined) continue;
    limits.push({
      slot,
      fqn: sym.fqn,
      ...(lim.min !== undefined ? { min: lim.min } : {}),
      ...(lim.max !== undefined ? { max: lim.max } : {}),
    });
  }

  const plotTargets: string[] = [];
  for (const p of buckets.plots) {
    const sym = resolveTarget(r.resolvedRefs, p.target);
    if (sym) plotTargets.push(sym.fqn);
  }

  // ─── 8. Polarity → influences + flow inputs ────────────────────────────
  const { influences, flowInputs } = buildInfluences(buckets, r);

  // ─── 9. Reality Check assertions ──────────────────────────────────────
  const checks: CheckIR[] = [];
  for (const c of buckets.checks) {
    const inputs: CheckInputIR[] = [];
    for (const inp of c.inputs) {
      const sym = resolveTarget(r.resolvedRefs, inp.target);
      if (!sym || sym.kind !== 'constant') continue;
      inputs.push({ fqn: sym.fqn, expr: lower(inp.expr) });
    }
    checks.push({
      name: c.name,
      inputs,
      lhs: lower(c.lhs),
      op: c.op,
      rhs: lower(c.rhs),
      temporal: c.temporal,
    });
  }

  // ─── 10. Reference modes — sort points by t for monotonic plotting ─────
  const references: ReferenceModeIR[] = [];
  for (const ref of buckets.references) {
    const sym = resolveTarget(r.resolvedRefs, ref.target);
    if (!sym) continue;
    const sortedPoints = [...ref.points]
      .map((p) => ({ t: p.t, v: p.v }))
      .sort((a, b) => a.t - b.t);
    references.push({ fqn: sym.fqn, points: sortedPoints });
  }

  // ─── 11. Calibration block — last one wins if multiple are declared. ───
  let calibration: CalibrateIR | null = null;
  const lastCal = buckets.calibrates[buckets.calibrates.length - 1];
  if (lastCal) {
    const calParams: CalibrateParamIR[] = [];
    for (const p of lastCal.params) {
      const sym = resolveTarget(r.resolvedRefs, p.target);
      if (!sym || sym.kind !== 'constant') continue;
      calParams.push({ fqn: sym.fqn, low: p.low, high: p.high });
    }
    if (calParams.length > 0) calibration = { params: calParams };
  }

  // ─── 12. Assemble ──────────────────────────────────────────────────────
  const program: CompiledProgram = {
    title,
    time,
    symbols: r.table,
    stocks,
    constants,
    calcs,
    flowEffects,
    maps,
    scenarios,
    sweeps,
    limits,
    plotTargets,
    influences,
    flowInputs,
    checks,
    references,
    calibration,
    diagnostics,
    stockCount: stocks.length,
    constantCount: constants.length,
    calcCount: calcs.length,
  };

  return { program, diagnostics };
}

// ────────────────────────────────────────────────────────────────────────────
// Helpers

interface Buckets {
  readonly times: TimeConfigStmt[];
  readonly titles: TitleStmt[];
  readonly constants: { stmt: ConstantStmt; symbol: Symbol }[];
  readonly stocks: { stmt: StockStmt; symbol: Symbol }[];
  readonly calcs: { stmt: CalcStmt; symbol: Symbol }[];
  readonly flows: { stmt: FlowStmt; symbol: Symbol }[];
  readonly maps: { stmt: MapStmt; symbol: Symbol }[];
  readonly scenarios: ScenarioStmt[];
  readonly sweeps: SweepStmt[];
  readonly plots: PlotStmt[];
  readonly limits: LimitStmt[];
  readonly checks: CheckStmt[];
  readonly references: ReferenceStmt[];
  readonly calibrates: CalibrateStmt[];
  readonly constantsBySymId: Map<number, { stmt: ConstantStmt; symbol: Symbol }>;
  readonly calcsBySymId: Map<number, { stmt: CalcStmt; symbol: Symbol }>;
}

function collectStmts(ast: Program): Buckets {
  const buckets: Buckets = {
    times: [],
    titles: [],
    constants: [],
    stocks: [],
    calcs: [],
    flows: [],
    maps: [],
    scenarios: [],
    sweeps: [],
    plots: [],
    limits: [],
    checks: [],
    references: [],
    calibrates: [],
    constantsBySymId: new Map(),
    calcsBySymId: new Map(),
  };
  // We need symbols to build the `*BySymId` maps; collect via a second pass
  // using stmtSymbols. Here we just collect the typed shape.
  walk(ast.body, buckets);
  return buckets;
}

function walk(stmts: readonly Stmt[], b: Buckets): void {
  for (const s of stmts) {
    switch (s.kind) {
      case 'TimeConfig': b.times.push(s); break;
      case 'Title': b.titles.push(s); break;
      case 'Constant': b.constants.push({ stmt: s, symbol: PLACEHOLDER }); break;
      case 'Stock': b.stocks.push({ stmt: s, symbol: PLACEHOLDER }); break;
      case 'Calc': b.calcs.push({ stmt: s, symbol: PLACEHOLDER }); break;
      case 'Flow': b.flows.push({ stmt: s, symbol: PLACEHOLDER }); break;
      case 'Map': b.maps.push({ stmt: s, symbol: PLACEHOLDER }); break;
      case 'Module': walk(s.body, b); break;
      case 'Scenario': b.scenarios.push(s); break;
      case 'Sweep': b.sweeps.push(s); break;
      case 'Plot': b.plots.push(s); break;
      case 'Limit': b.limits.push(s); break;
      case 'Check': b.checks.push(s); break;
      case 'Reference': b.references.push(s); break;
      case 'Calibrate': b.calibrates.push(s); break;
    }
  }
}

/** Sentinel placeholder; filled in by `attachSymbols` after `walk`. */
const PLACEHOLDER = {} as unknown as Symbol;

/**
 * Attach the resolved Symbol to each statement-bucket entry and populate
 * the `*BySymId` lookup maps. Skips entries the resolver couldn't declare
 * (duplicates, reserved names) — they have no symbol.
 */
function attachSymbols(
  b: Buckets,
  stmtSymbols: ReadonlyMap<Stmt, Symbol>,
): void {
  for (const arr of [b.constants, b.stocks, b.calcs, b.flows, b.maps]) {
    for (let i = arr.length - 1; i >= 0; i--) {
      const sym = stmtSymbols.get(arr[i]!.stmt);
      if (!sym) {
        arr.splice(i, 1);
        continue;
      }
      (arr[i] as { symbol: Symbol }).symbol = sym;
    }
  }
  for (const c of b.constants) b.constantsBySymId.set(c.symbol.id, c);
  for (const c of b.calcs) b.calcsBySymId.set(c.symbol.id, c);
}

function allocateSlots(
  buckets: Buckets,
  stmtSymbols: ReadonlyMap<Stmt, Symbol>,
  _table: SymbolTable,
  topoOrder: readonly number[],
): SlotIndex {
  // Wire symbols onto bucket entries first so we can read .symbol.id below.
  attachSymbols(buckets, stmtSymbols);

  const constantSlot = new Map<number, number>();
  const stockSlot = new Map<number, number>();
  const calcSlot = new Map<number, number>();
  const mapIndex = new Map<number, number>();

  // Constants in topo order: ensures slot index honors dep order, which means
  // a runtime evaluator that fills slots 0,1,2,... already has earlier deps ready.
  let cidx = 0;
  for (const id of topoOrder) {
    if (buckets.constantsBySymId.has(id)) {
      constantSlot.set(id, cidx++);
    }
  }
  // Any constant with a missing dep edge (e.g. literal-only) still needs a slot.
  for (const c of buckets.constants) {
    if (!constantSlot.has(c.symbol.id)) constantSlot.set(c.symbol.id, cidx++);
  }

  let kidx = 0;
  for (const id of topoOrder) {
    if (buckets.calcsBySymId.has(id)) {
      calcSlot.set(id, kidx++);
    }
  }
  for (const c of buckets.calcs) {
    if (!calcSlot.has(c.symbol.id)) calcSlot.set(c.symbol.id, kidx++);
  }

  let sidx = 0;
  for (const s of buckets.stocks) stockSlot.set(s.symbol.id, sidx++);

  let midx = 0;
  for (const m of buckets.maps) mapIndex.set(m.symbol.id, midx++);

  return { constantSlot, stockSlot, calcSlot, mapIndex };
}

function resolveTarget(
  resolvedRefs: ReadonlyMap<object, Symbol>,
  qref: object,
): Symbol | undefined {
  // QualifiedRefs are stored on `resolvedRefs` by `Resolver.resolveQualifiedTarget`,
  // so this is a direct identity lookup.
  return resolvedRefs.get(qref);
}

function buildInfluences(
  buckets: Buckets,
  r: ReturnType<typeof resolve>,
): { influences: Influence[]; flowInputs: FlowInput[] } {
  const influences: Influence[] = [];
  const flowInputs: FlowInput[] = [];

  // Pre-fold constant signs: walk each constant's defining expression in the
  // order constants were declared (constants can only depend on prior
  // constants). The resulting map lets polarity inference resolve, e.g.,
  // `Stock * RateConstant` to `+/+` instead of `?/?`.
  const constantSigns = new Map<number, Polarity>();
  for (const { stmt, symbol } of buckets.constants) {
    const sign = signOfConstantExpr(stmt.expr, r.resolvedRefs, constantSigns);
    if (sign !== null) constantSigns.set(symbol.id, sign);
  }

  for (const { stmt, symbol } of buckets.calcs) {
    const polarities = inferPolarities(stmt.expr, r.resolvedRefs, constantSigns);
    for (const [sourceId, polarity] of polarities) {
      influences.push({ source: sourceId, target: symbol.id, polarity });
    }
  }

  // Per-flow merged source polarities. A flow may have multiple effects with
  // different rate expressions; we union sources and merge polarities (a
  // conflict between + and − across effects degrades to ?).
  const flowMerged = new Map<number, Map<number, Polarity>>();

  for (const { stmt: flow, symbol: flowSym } of buckets.flows) {
    for (const eff of flow.effects) {
      const targetSym = resolveTarget(r.resolvedRefs, eff.target);
      if (!targetSym) continue;
      const polarities = inferPolarities(eff.expr, r.resolvedRefs, constantSigns);
      for (const [sourceId, polarity] of polarities) {
        const final: Polarity =
          eff.polarity === 'positive' ? polarity : flipPolarity(polarity);
        influences.push({ source: sourceId, target: targetSym.id, polarity: final });

        let perFlow = flowMerged.get(flowSym.id);
        if (!perFlow) {
          perFlow = new Map();
          flowMerged.set(flowSym.id, perFlow);
        }
        const prev = perFlow.get(sourceId);
        perFlow.set(sourceId, prev === undefined ? polarity : mergePolarity(prev, polarity));
      }
    }
  }

  for (const [flowId, perFlow] of flowMerged) {
    for (const [sourceId, polarity] of perFlow) {
      flowInputs.push({ flow: flowId, source: sourceId, polarity });
    }
  }

  return { influences, flowInputs };
}

function mergePolarity(a: Polarity, b: Polarity): Polarity {
  if (a === b) return a;
  return '?';
}

function collectExprSymbols(
  expr: Expr,
  resolvedRefs: ReadonlyMap<object, Symbol>,
  out: Set<number>,
): void {
  switch (expr.kind) {
    case 'NumberLit':
      return;
    case 'Ref': {
      const sym = resolvedRefs.get(expr);
      if (sym && sym.kind !== 'builtin' && sym.kind !== 'map') out.add(sym.id);
      return;
    }
    case 'Unary':
      collectExprSymbols(expr.operand, resolvedRefs, out);
      return;
    case 'Binary':
      collectExprSymbols(expr.left, resolvedRefs, out);
      collectExprSymbols(expr.right, resolvedRefs, out);
      return;
    case 'Call':
      for (const a of expr.args) collectExprSymbols(a, resolvedRefs, out);
      return;
  }
}

function flipPolarity(p: Polarity): Polarity {
  if (p === '+') return '-';
  if (p === '-') return '+';
  return '?';
}

// Re-export so consumers can build their own CompileResult without a stub.
export { ZERO_POSITION };
