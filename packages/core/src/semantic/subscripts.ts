/**
 * Subscript expansion pass.
 *
 * Phase 1: a single 1D subscript per declaration. Runs BEFORE the smooth /
 * delay3 / step / pulse desugar so the rest of the pipeline (resolve, IR,
 * runtime) sees a fully scalar program.
 *
 * Rewrites:
 *   subscript Region = North, South, East, West
 *   constant BirthRate[Region] = 0.05         → constant BirthRate_North = 0.05
 *                                                 constant BirthRate_South = 0.05
 *                                                 …  (one per element)
 *   constant BirthRate[Region] = [.05, .04, .06, .03]
 *                                              → per-element values from the array
 *   stock Population[Region] = 1000           → stock Population_North = 1000  …
 *   flow Births[Region]:                       → flow Births_North:
 *     Population[Region] * BirthRate[Region]      Population_North * BirthRate_North
 *       -+> Population[Region]                      -+> Population_North
 *                                                (and same for South / East / West)
 *
 * Refs to a specific element (`Foo[North]`) are rewritten to `Foo_North` in
 * every context — declarations, expressions, scenario overrides, limits,
 * plots, sweeps. Subscript declarations themselves are dropped.
 *
 * Stable error codes:
 *   SD0048  ref to a subscript dimension outside a subscripted context
 *   SD0049  unknown subscript dimension on a declaration
 *   SD0050x array literal length mismatch (using SD0050y to avoid clash with deps)
 */

import type { Diagnostic } from '../diagnostics/diagnostic.js';
import type {
  ArrayLit,
  CalcStmt,
  ConstantStmt,
  Expr,
  FlowEffect,
  FlowStmt,
  LimitStmt,
  PlotStmt,
  Program,
  QualifiedRef,
  RefExpr,
  ScenarioOverride,
  ScenarioStmt,
  Stmt,
  StockStmt,
  SweepStmt,
} from '../syntax/ast.js';

export interface SubscriptExpansionResult {
  readonly program: Program;
  readonly diagnostics: readonly Diagnostic[];
}

interface ExpansionCtx {
  readonly subName: string;
  readonly element: string;
  readonly index: number;
}

export function expandSubscripts(ast: Program): SubscriptExpansionResult {
  const diagnostics: Diagnostic[] = [];

  // ── Collect subscript dictionary (top-level only in Phase 1) ────────────
  const subs = new Map<string, string[]>();
  for (const stmt of ast.body) {
    if (stmt.kind === 'Subscript') subs.set(stmt.name, [...stmt.elements]);
  }

  // Helper: rewrite a single bracketed ref. Returns the new path tail to use.
  function resolveBracket(
    refSubscript: string,
    range: { start: { line: number; column: number; offset: number }; end: { line: number; column: number; offset: number } },
    ctx: ExpansionCtx | null,
  ): string {
    // If we're inside a subscripted-decl expansion AND the bracket names
    // that subscript's dimension, substitute the current element.
    if (ctx && refSubscript === ctx.subName) return ctx.element;
    // Otherwise check if it's a literal element of a known subscript.
    for (const [, elems] of subs) {
      if (elems.includes(refSubscript)) return refSubscript;
    }
    // It might be a subscript dimension name used outside scope — error.
    if (subs.has(refSubscript)) {
      diagnostics.push({
        severity: 'error',
        code: 'SD0048',
        message: `'[${refSubscript}]' references a subscript dimension outside a subscripted declaration.`,
        range,
      });
      return refSubscript; // best-effort: fall through with the name; downstream will fail to resolve.
    }
    // Treat as a literal element name (forgiving — the resolver will catch
    // the bad reference if no such variable exists).
    return refSubscript;
  }

  function rewriteQRef(ref: QualifiedRef, ctx: ExpansionCtx | null): QualifiedRef {
    if (!ref.subscript) return ref;
    const suffix = resolveBracket(ref.subscript, ref.range, ctx);
    const last = ref.path[ref.path.length - 1] ?? '';
    const newPath = [...ref.path.slice(0, -1), `${last}_${suffix}`];
    return { path: newPath, range: ref.range };
  }

  function rewriteRefExpr(ref: RefExpr, ctx: ExpansionCtx | null): RefExpr {
    if (!ref.subscript) return ref;
    const suffix = resolveBracket(ref.subscript, ref.range, ctx);
    const last = ref.path[ref.path.length - 1] ?? '';
    const newPath = [...ref.path.slice(0, -1), `${last}_${suffix}`];
    return { kind: 'Ref', path: newPath, range: ref.range };
  }

  function rewriteExpr(e: Expr, ctx: ExpansionCtx | null): Expr {
    switch (e.kind) {
      case 'NumberLit':
        return e;
      case 'ArrayLit':
        return e; // legal only as a constant init — caught at expansion time
      case 'Ref':
        return rewriteRefExpr(e, ctx);
      case 'Unary':
        return { ...e, operand: rewriteExpr(e.operand, ctx) };
      case 'Binary':
        return { ...e, left: rewriteExpr(e.left, ctx), right: rewriteExpr(e.right, ctx) };
      case 'Call':
        return { ...e, args: e.args.map((a) => rewriteExpr(a, ctx)) };
    }
  }

  // Pull the per-element value out of an ArrayLit, or fall back to rewriting
  // a regular expression with the current ctx.
  function exprForElement(initOrExpr: Expr, ctx: ExpansionCtx, declName: string): Expr {
    if (initOrExpr.kind === 'ArrayLit') {
      const al = initOrExpr as ArrayLit;
      const elems = subs.get(ctx.subName) ?? [];
      if (al.values.length !== elems.length) {
        diagnostics.push({
          severity: 'error',
          code: 'SD0050x',
          message: `'${declName}' array literal has ${al.values.length} values but subscript '${ctx.subName}' has ${elems.length} elements.`,
          range: al.range,
        });
      }
      const v = al.values[ctx.index] ?? 0;
      return { kind: 'NumberLit', value: v, range: al.range };
    }
    return rewriteExpr(initOrExpr, ctx);
  }

  // ── Expand a single statement into 1..N statements ──────────────────────
  function expandStmt(stmt: Stmt): Stmt[] {
    switch (stmt.kind) {
      case 'Subscript':
        return []; // drop
      case 'Constant': {
        if (!stmt.subscript) return [{ ...stmt, expr: rewriteExpr(stmt.expr, null) }];
        const elements = subs.get(stmt.subscript);
        if (!elements) {
          diagnostics.push(unknownSub(stmt.name, stmt.subscript, stmt.range));
          return [];
        }
        return elements.map((elem, idx) => {
          const ctx: ExpansionCtx = { subName: stmt.subscript!, element: elem, index: idx };
          return {
            kind: 'Constant',
            name: `${stmt.name}_${elem}`,
            expr: exprForElement(stmt.expr, ctx, stmt.name),
            range: stmt.range,
            ...(stmt.exogenous ? { exogenous: true } : {}),
          } satisfies ConstantStmt;
        });
      }
      case 'Stock': {
        if (!stmt.subscript) return [{ ...stmt, init: rewriteExpr(stmt.init, null) }];
        const elements = subs.get(stmt.subscript);
        if (!elements) {
          diagnostics.push(unknownSub(stmt.name, stmt.subscript, stmt.range));
          return [];
        }
        return elements.map((elem, idx) => {
          const ctx: ExpansionCtx = { subName: stmt.subscript!, element: elem, index: idx };
          return {
            kind: 'Stock',
            name: `${stmt.name}_${elem}`,
            init: exprForElement(stmt.init, ctx, stmt.name),
            range: stmt.range,
          } satisfies StockStmt;
        });
      }
      case 'Calc': {
        if (!stmt.subscript) return [{ ...stmt, expr: rewriteExpr(stmt.expr, null) }];
        const elements = subs.get(stmt.subscript);
        if (!elements) {
          diagnostics.push(unknownSub(stmt.name, stmt.subscript, stmt.range));
          return [];
        }
        return elements.map((elem, idx) => {
          const ctx: ExpansionCtx = { subName: stmt.subscript!, element: elem, index: idx };
          return {
            kind: 'Calc',
            name: `${stmt.name}_${elem}`,
            expr: rewriteExpr(stmt.expr, ctx),
            range: stmt.range,
          } satisfies CalcStmt;
        });
      }
      case 'Flow': {
        if (!stmt.subscript) {
          // Still rewrite literal-element refs inside effects.
          const newEffects = stmt.effects.map((eff) => ({
            ...eff,
            expr: rewriteExpr(eff.expr, null),
            target: rewriteQRef(eff.target, null),
          }));
          return [{ ...stmt, effects: newEffects } satisfies FlowStmt];
        }
        const elements = subs.get(stmt.subscript);
        if (!elements) {
          diagnostics.push(unknownSub(stmt.name, stmt.subscript, stmt.range));
          return [];
        }
        return elements.map((elem, idx) => {
          const ctx: ExpansionCtx = { subName: stmt.subscript!, element: elem, index: idx };
          const newEffects: FlowEffect[] = stmt.effects.map((eff) => ({
            range: eff.range,
            polarity: eff.polarity,
            expr: rewriteExpr(eff.expr, ctx),
            target: rewriteQRef(eff.target, ctx),
          }));
          return {
            kind: 'Flow',
            name: `${stmt.name}_${elem}`,
            effects: newEffects,
            range: stmt.range,
          } satisfies FlowStmt;
        });
      }
      case 'Module':
        // Recurse — Phase 1 does not support subscript decls inside modules,
        // but a module body may still contain literal-element refs.
        return [{ ...stmt, body: stmt.body.flatMap(expandStmt) }];
      case 'Scenario': {
        const newOverrides: ScenarioOverride[] = stmt.overrides.map((ov) => ({
          range: ov.range,
          targetKind: ov.targetKind,
          target: rewriteQRef(ov.target, null),
          expr: rewriteExpr(ov.expr, null),
        }));
        return [{ ...stmt, overrides: newOverrides } satisfies ScenarioStmt];
      }
      case 'Sweep':
        return [{ ...stmt, target: rewriteQRef(stmt.target, null) } satisfies SweepStmt];
      case 'Plot':
        return [{ ...stmt, target: rewriteQRef(stmt.target, null) } satisfies PlotStmt];
      case 'Limit':
        return [{ ...stmt, target: rewriteQRef(stmt.target, null) } satisfies LimitStmt];
      // Reference / Calibrate / Check carry refs too — rewrite for literal-element
      // brackets so users can reference one element per assertion / target.
      case 'Reference':
        return [{ ...stmt, target: rewriteQRef(stmt.target, null) }];
      case 'Calibrate':
        return [{
          ...stmt,
          params: stmt.params.map((p) => ({ ...p, target: rewriteQRef(p.target, null) })),
        }];
      case 'Check':
        return [{
          ...stmt,
          inputs: stmt.inputs.map((inp) => ({
            ...inp,
            target: rewriteQRef(inp.target, null),
            expr: rewriteExpr(inp.expr, null),
          })),
          lhs: rewriteExpr(stmt.lhs, null),
          rhs: rewriteExpr(stmt.rhs, null),
        }];
      default:
        return [stmt];
    }
  }

  const newBody = ast.body.flatMap(expandStmt);
  return { program: { ...ast, body: newBody }, diagnostics };
}

function unknownSub(declName: string, sub: string, range: Diagnostic['range']): Diagnostic {
  return {
    severity: 'error',
    code: 'SD0049',
    message: `Declaration '${declName}' references unknown subscript '${sub}'.`,
    range,
  };
}
