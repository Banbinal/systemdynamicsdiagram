/**
 * Resolver: walks the AST, builds the symbol table, detects duplicate
 * declarations, and (in a second pass) resolves every `Ref` to its symbol.
 *
 * Stable error codes:
 *   SD0040  duplicate declaration
 *   SD0041  unresolved reference
 *   SD0042  reserved name redefinition (e.g. user defines `time`)
 */

import type { Diagnostic, Severity } from '../diagnostics/diagnostic.js';
import type { SourceRange } from '../diagnostics/source.js';
import type {
  CalcStmt,
  ConstantStmt,
  Expr,
  FlowStmt,
  MapStmt,
  ModuleStmt,
  Program,
  ScenarioStmt,
  Stmt,
  StockStmt,
  SweepStmt,
  PlotStmt,
  LimitStmt,
} from '../syntax/ast.js';
import {
  BUILTIN_NAMES,
  SymbolTableImpl,
  resolveRef,
  type Symbol,
  type SymbolKind,
  type SymbolTable,
} from './symbols.js';

export interface ResolveResult {
  readonly table: SymbolTable;
  readonly diagnostics: readonly Diagnostic[];
  /**
   * For each `Ref` node encountered (by reference identity), the resolved Symbol.
   * Refs that don't resolve are NOT in the map (a diagnostic is emitted instead).
   */
  readonly resolvedRefs: ReadonlyMap<object, Symbol>;
  /**
   * For each statement that defines a value (constant/stock/calc/flow/map),
   * the symbol it produces. Used by IR lowering and dep graph.
   */
  readonly stmtSymbols: ReadonlyMap<Stmt, Symbol>;
}

const RESERVED_NAMES = new Set<string>(['time']);

export function resolve(program: Program): ResolveResult {
  return new Resolver().run(program);
}

class Resolver {
  private readonly table = new SymbolTableImpl();
  private readonly diagnostics: Diagnostic[] = [];
  private readonly resolvedRefs = new Map<object, Symbol>();
  private readonly stmtSymbols = new Map<Stmt, Symbol>();
  private nextId = 0;

  run(program: Program): ResolveResult {
    // Pass 1: register builtins so they resolve cleanly.
    for (const name of BUILTIN_NAMES) {
      this.declare(name, 'builtin', [], undefined, undefined);
    }
    // Pass 2: walk AST and declare every named entity.
    this.declarePass(program.body, []);
    // Pass 3: resolve every Ref against the populated table.
    this.resolvePass(program.body, []);
    return {
      table: this.table,
      diagnostics: this.diagnostics,
      resolvedRefs: this.resolvedRefs,
      stmtSymbols: this.stmtSymbols,
    };
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Pass 1: declarations

  private declarePass(stmts: readonly Stmt[], ns: readonly string[]): void {
    for (const stmt of stmts) {
      switch (stmt.kind) {
        case 'Constant':
          this.declareNamed(stmt, 'constant', ns, stmt.name);
          break;
        case 'Stock':
          this.declareNamed(stmt, 'stock', ns, stmt.name);
          break;
        case 'Calc':
          this.declareNamed(stmt, 'calc', ns, stmt.name);
          break;
        case 'Flow':
          this.declareNamed(stmt, 'flow', ns, stmt.name);
          break;
        case 'Map':
          this.declareNamed(stmt, 'map', ns, stmt.name);
          break;
        case 'Module': {
          this.declareNamed(stmt, 'module', ns, stmt.name);
          this.declarePass(stmt.body, [...ns, stmt.name]);
          break;
        }
        case 'Scenario':
        case 'Sweep':
        case 'Plot':
        case 'Limit':
        case 'Title':
        case 'TimeConfig':
          // No new symbol introduced by these.
          break;
      }
    }
  }

  private declareNamed(
    stmt: ConstantStmt | StockStmt | CalcStmt | FlowStmt | MapStmt | ModuleStmt,
    kind: SymbolKind,
    ns: readonly string[],
    name: string,
  ): void {
    if (RESERVED_NAMES.has(name)) {
      this.diag('error', 'SD0042', `'${name}' is a reserved name and cannot be redeclared.`, stmt.range);
      return;
    }
    const sym = this.declare(name, kind, ns, stmt.range, stmt);
    if (sym) this.stmtSymbols.set(stmt, sym);
  }

  private declare(
    name: string,
    kind: SymbolKind,
    ns: readonly string[],
    declRange: SourceRange | undefined,
    decl: Stmt | undefined,
  ): Symbol | null {
    const fqn = ns.length === 0 ? name : `${ns.join('.')}.${name}`;
    const existing = this.table.byFqn(fqn);
    if (existing) {
      if (declRange) {
        this.diag(
          'error',
          'SD0040',
          `Duplicate declaration of '${fqn}' (previously declared as ${existing.kind}).`,
          declRange,
        );
      }
      return null;
    }
    const sym: Symbol = {
      id: this.nextId++,
      fqn,
      name,
      namespace: [...ns],
      kind,
      ...(declRange ? { declRange } : {}),
      ...(decl ? { decl } : {}),
    };
    this.table.add(sym);
    return sym;
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Pass 2: reference resolution

  private resolvePass(stmts: readonly Stmt[], ns: readonly string[]): void {
    for (const stmt of stmts) {
      switch (stmt.kind) {
        case 'Constant':
        case 'Calc':
          this.resolveExpr(stmt.expr, ns);
          break;
        case 'Stock':
          this.resolveExpr(stmt.init, ns);
          break;
        case 'Flow':
          for (const eff of stmt.effects) {
            this.resolveExpr(eff.expr, ns);
            this.resolveQualifiedTarget(eff.target, ns, 'stock');
          }
          break;
        case 'Module':
          this.resolvePass(stmt.body, [...ns, stmt.name]);
          break;
        case 'Scenario':
          for (const ov of stmt.overrides) {
            this.resolveExpr(ov.expr, ns);
            this.resolveQualifiedTarget(ov.target, ns, ov.targetKind);
          }
          break;
        case 'Sweep':
          this.resolveQualifiedTarget(stmt.target, ns, 'constant');
          break;
        case 'Plot':
          // plot can target any value-producing symbol; just check existence
          this.resolveQualifiedTarget(stmt.target, ns);
          break;
        case 'Limit':
          this.resolveQualifiedTarget(stmt.target, ns);
          break;
        case 'Check':
          for (const inp of stmt.inputs) {
            this.resolveExpr(inp.expr, ns);
            // The `when` target must be a `constant` since check inputs override
            // a single fixed value before the run.
            this.resolveQualifiedTarget(inp.target, ns, 'constant');
          }
          this.resolveExpr(stmt.lhs, ns);
          this.resolveExpr(stmt.rhs, ns);
          break;
        case 'Map':
        case 'Title':
        case 'TimeConfig':
          break;
      }
    }
  }

  private resolveExpr(expr: Expr, ns: readonly string[]): void {
    switch (expr.kind) {
      case 'NumberLit':
        return;
      case 'Ref': {
        const sym = resolveRef(this.table, expr.path, ns);
        if (sym) {
          this.resolvedRefs.set(expr, sym);
        } else {
          this.diag(
            'error',
            'SD0041',
            `Unresolved reference '${expr.path.join('.')}'.`,
            expr.range,
          );
        }
        return;
      }
      case 'Call':
        for (const arg of expr.args) this.resolveExpr(arg, ns);
        // The callee is an identifier; look it up too (must be a builtin or a map).
        // We store it on the Call node so the IR lowering can dispatch
        // (map → MapLookup, builtin → CallBuiltin) without a second name lookup.
        {
          const sym = resolveRef(this.table, [expr.callee], ns);
          if (sym) {
            this.resolvedRefs.set(expr, sym);
          } else {
            this.diag(
              'error',
              'SD0041',
              `Unresolved function '${expr.callee}'.`,
              expr.range,
            );
          }
        }
        return;
      case 'Binary':
        this.resolveExpr(expr.left, ns);
        this.resolveExpr(expr.right, ns);
        return;
      case 'Unary':
        this.resolveExpr(expr.operand, ns);
        return;
    }
  }

  /**
   * Resolve a target ref (LHS of override, plot target, sweep target, etc.)
   * If `expectedKind` is provided, also check kind match.
   *
   * The resolved Symbol is stored in `resolvedRefs` keyed by the QualifiedRef
   * node so downstream lowering can look it up without re-walking scope.
   */
  private resolveQualifiedTarget(
    target: { readonly path: readonly string[]; readonly range: SourceRange },
    ns: readonly string[],
    expectedKind?: SymbolKind,
  ): Symbol | undefined {
    const sym = resolveRef(this.table, target.path, ns);
    if (!sym) {
      this.diag(
        'error',
        'SD0041',
        `Unresolved reference '${target.path.join('.')}'.`,
        target.range,
      );
      return undefined;
    }
    if (expectedKind && sym.kind !== expectedKind) {
      this.diag(
        'error',
        'SD0041',
        `Reference '${target.path.join('.')}' is a ${sym.kind}, expected ${expectedKind}.`,
        target.range,
      );
    }
    this.resolvedRefs.set(target, sym);
    return sym;
  }

  // ──────────────────────────────────────────────────────────────────────────

  private diag(severity: Severity, code: string, message: string, range: SourceRange): void {
    this.diagnostics.push({ severity, code, message, range });
  }
}
