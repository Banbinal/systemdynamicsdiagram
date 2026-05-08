/**
 * Dimensional consistency check.
 *
 * Walks every declared expression after resolve, infers units bottom-up
 * from the declared units of `constant` and `stock` declarations, and
 * emits a warning whenever the two sides of `+` or `-` carry known
 * incompatible units. Multiplication, division and integer powers
 * combine units algebraically; an expression involving a variable with
 * no declared units yields "unknown" units (no check fires).
 *
 * Stable codes:
 *   SD0090  invalid token inside a unit annotation (emitted by parser)
 *   SD0091  dimensional mismatch in + / − or comparison
 *   SD0092  declared units differ from inferred (constant or stock)
 *   SD0093  invalid unit annotation (parse error in the bracket content)
 */

import type { Diagnostic } from '../diagnostics/diagnostic.js';
import type {
  ConstantStmt,
  Expr,
  FlowStmt,
  Program,
  StockStmt,
  CalcStmt,
  ModuleStmt,
  Stmt,
  UnitTokenAst,
} from '../syntax/ast.js';
import type { Symbol } from './symbols.js';
import {
  EMPTY,
  equal,
  format,
  mul,
  div,
  pow,
  parseUnitTokens,
  type Units,
} from './units.js';

export interface CheckUnitsInput {
  readonly ast: Program;
  readonly resolvedRefs: ReadonlyMap<object, Symbol>;
  readonly stmtSymbols: ReadonlyMap<Stmt, Symbol>;
}

export function checkUnits(input: CheckUnitsInput): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];

  // ── Build the FQN → Units table from declared annotations ───────────
  const unitsByFqn = new Map<string, Units>();

  function recordUnits(stmt: ConstantStmt | StockStmt) {
    if (!stmt.unitTokens) return;
    const sym = input.stmtSymbols.get(stmt);
    if (!sym) return;
    const parsed = parseUnitTokens(toUnitTokens(stmt.unitTokens));
    for (const err of parsed.errors) {
      diagnostics.push({
        severity: 'warning',
        code: 'SD0093',
        message: `Invalid unit annotation on '${sym.fqn}': ${err}`,
        range: stmt.range,
      });
    }
    unitsByFqn.set(sym.fqn, parsed.units);
  }

  function walkDecls(stmts: readonly Stmt[]) {
    for (const s of stmts) {
      if (s.kind === 'Constant' || s.kind === 'Stock') recordUnits(s);
      else if (s.kind === 'Module') walkDecls((s as ModuleStmt).body);
    }
  }
  walkDecls(input.ast.body);

  // ── Infer + check expression units ─────────────────────────────────
  function infer(e: Expr): Units | null {
    switch (e.kind) {
      case 'NumberLit':
        return EMPTY; // dimensionless
      case 'ArrayLit':
        // Should have been expanded by subscripts. If we see one here, bail.
        return null;
      case 'Ref': {
        const sym = input.resolvedRefs.get(e);
        if (!sym) return null;
        if (sym.kind === 'builtin' || sym.kind === 'map') return null;
        // Constants & stocks: read from declared. Calcs: not declarable in
        // v1, so unknown — we don't recurse into the calc's expression
        // to keep the analysis cheap and acyclic.
        return unitsByFqn.get(sym.fqn) ?? null;
      }
      case 'Unary': {
        if (e.op === '!') return EMPTY; // logical not → dimensionless
        return infer(e.operand);
      }
      case 'Binary': {
        const l = infer(e.left);
        const r = infer(e.right);
        // Numeric literals are silently promoted to whatever unit the other
        // side carries — they're scalar coefficients, not real dimensionless
        // values. Avoids `Population >= 0` style false positives.
        const leftIsLiteral = e.left.kind === 'NumberLit';
        const rightIsLiteral = e.right.kind === 'NumberLit';
        switch (e.op) {
          case '+':
          case '-': {
            if (
              l !== null && r !== null && !equal(l, r) &&
              !(leftIsLiteral && equal(l, EMPTY)) &&
              !(rightIsLiteral && equal(r, EMPTY))
            ) {
              diagnostics.push({
                severity: 'warning',
                code: 'SD0091',
                message: `Dimensional mismatch in '${e.op}': ${formatUnits(l)} ${e.op} ${formatUnits(r)}.`,
                range: e.range,
              });
            }
            // After accepting the literal-promotion rule, the side that's
            // a literal contributes no units; pick the other side's.
            if (rightIsLiteral && r !== null && equal(r, EMPTY)) return l;
            if (leftIsLiteral && l !== null && equal(l, EMPTY)) return r;
            return l ?? r;
          }
          case '*':
            if (l !== null && r !== null) return mul(l, r);
            return null;
          case '/':
            if (l !== null && r !== null) return div(l, r);
            return null;
          case '^': {
            if (l !== null && e.right.kind === 'NumberLit') {
              return pow(l, e.right.value);
            }
            return null;
          }
          case '<':
          case '<=':
          case '>':
          case '>=':
          case '==':
          case '!=':
            // Same literal-promotion rule as +/-.
            if (
              l !== null && r !== null && !equal(l, r) &&
              !(leftIsLiteral && equal(l, EMPTY)) &&
              !(rightIsLiteral && equal(r, EMPTY))
            ) {
              diagnostics.push({
                severity: 'warning',
                code: 'SD0091',
                message: `Dimensional mismatch in '${e.op}': ${formatUnits(l)} ${e.op} ${formatUnits(r)}.`,
                range: e.range,
              });
            }
            return EMPTY;
          case '&&':
          case '||':
            return EMPTY;
          case '%':
            return l;
        }
        return null;
      }
      case 'Call': {
        // Pure-function builtins: log/exp/sin/cos/tan need dimensionless.
        // sqrt halves exponents (handled via pow). abs/min/max preserve.
        const argUnits = e.args.map(infer);
        switch (e.callee) {
          case 'exp':
          case 'log':
          case 'log10':
          case 'sin':
          case 'cos':
          case 'tan': {
            const u = argUnits[0];
            if (u !== null && u !== undefined && !equal(u, EMPTY)) {
              diagnostics.push({
                severity: 'warning',
                code: 'SD0091',
                message: `'${e.callee}' expects a dimensionless argument; got ${formatUnits(u)}.`,
                range: e.range,
              });
            }
            return EMPTY;
          }
          case 'sqrt': {
            const u = argUnits[0];
            return u !== null && u !== undefined ? pow(u, 0.5) : null;
          }
          case 'abs':
            return argUnits[0] ?? null;
          case 'min':
          case 'max': {
            // Both args should match; result has shared units.
            const u0 = argUnits[0];
            const u1 = argUnits[1];
            if (u0 !== null && u0 !== undefined && u1 !== null && u1 !== undefined && !equal(u0, u1)) {
              diagnostics.push({
                severity: 'warning',
                code: 'SD0091',
                message: `'${e.callee}' arguments have different units: ${formatUnits(u0)} vs ${formatUnits(u1)}.`,
                range: e.range,
              });
            }
            return u0 ?? u1 ?? null;
          }
          case 'pow': {
            const base = argUnits[0];
            if (base && e.args[1] && e.args[1].kind === 'NumberLit') {
              return pow(base, e.args[1].value);
            }
            return null;
          }
          default:
            return null;
        }
      }
    }
  }

  // ── Walk every declaration, check init / expr / flow effects ─────────
  function walkChecks(stmts: readonly Stmt[]) {
    for (const s of stmts) {
      switch (s.kind) {
        case 'Constant': {
          // If the constant has declared units, the rhs should match.
          const sym = input.stmtSymbols.get(s);
          const declared = sym ? unitsByFqn.get(sym.fqn) : undefined;
          const inferred = infer(s.expr);
          if (declared !== undefined && inferred !== null && !equal(declared, inferred)) {
            // Allow declared-non-empty + inferred-empty (literal numbers
            // in declared-unit constants are common: `Rate = 0.05 [1/year]`).
            if (!equal(inferred, EMPTY)) {
              diagnostics.push({
                severity: 'warning',
                code: 'SD0092',
                message: `Constant '${sym!.fqn}' declared as ${formatUnits(declared)} but expression evaluates to ${formatUnits(inferred)}.`,
                range: s.range,
              });
            }
          }
          break;
        }
        case 'Stock': {
          const sym = input.stmtSymbols.get(s);
          const declared = sym ? unitsByFqn.get(sym.fqn) : undefined;
          const inferred = infer(s.init);
          if (declared !== undefined && inferred !== null && !equal(declared, inferred) && !equal(inferred, EMPTY)) {
            diagnostics.push({
              severity: 'warning',
              code: 'SD0092',
              message: `Stock '${sym!.fqn}' declared as ${formatUnits(declared)} but init evaluates to ${formatUnits(inferred)}.`,
              range: s.range,
            });
          }
          break;
        }
        case 'Calc':
          infer((s as CalcStmt).expr);
          break;
        case 'Flow': {
          for (const eff of (s as FlowStmt).effects) infer(eff.expr);
          break;
        }
        case 'Module':
          walkChecks((s as ModuleStmt).body);
          break;
        default:
          break;
      }
    }
  }
  walkChecks(input.ast.body);

  return diagnostics;
}

function toUnitTokens(asts: readonly UnitTokenAst[]) {
  return asts.map((t) =>
    t.value === undefined
      ? { kind: t.kind, text: t.text }
      : { kind: t.kind, text: t.text, value: t.value },
  );
}

function formatUnits(u: Units): string {
  const s = format(u);
  return s === '' ? 'dimensionless' : s;
}
