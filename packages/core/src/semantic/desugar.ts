/**
 * Pre-resolve AST → AST transformation that lowers high-level builtins to
 * primitive constructs the solver can handle uniformly.
 *
 * Rewrites:
 *   - step(h, t0)         → (time >= t0) * h
 *   - pulse(h, t0, w)     → (time >= t0) * (time < t0 + w) * h
 *   - smooth(input, tau)  → synthetic stock `__smooth_N` initialised to `input`,
 *                            with flow `(input - __smooth_N) / tau -+> __smooth_N`,
 *                            and the original call site replaced by `Ref(__smooth_N)`.
 *   - delay3(input, tau)  → three cascaded synthetic stocks (a, b, c), each
 *                            initialised to `input`, transit time `tau/3`:
 *                              (input - a) / (tau/3) -+> a
 *                              (a - b)     / (tau/3) -+> b
 *                              (b - c)     / (tau/3) -+> c
 *                            Original call replaced by `Ref(c)`.
 *
 * Synthetic stocks/flows are inserted in the same lexical scope as the call,
 * so a `smooth(...)` inside `module M:` produces `M.__smooth_0` (not a clash
 * with another module's synthetics, since the counter is global).
 *
 * The pass runs BEFORE `resolve`, so it works on raw AST and the rewritten
 * program is then resolved fresh. After this pass, `smooth`/`delay3` are
 * gone from the tree; `step`/`pulse` survive as pure expressions referring
 * to the `time` builtin.
 *
 * Stable error codes:
 *   SD0070  step takes 2 arguments (got X)
 *   SD0071  pulse takes 3 arguments (got X)
 *   SD0072  smooth takes 2 arguments (got X)
 *   SD0073  delay3 takes 2 arguments (got X)
 */

import type { Diagnostic } from '../diagnostics/diagnostic.js';
import type { SourceRange } from '../diagnostics/source.js';
import type {
  BinaryExpr,
  BinaryOp,
  CallExpr,
  Expr,
  FlowEffect,
  FlowStmt,
  NumberLit,
  Program,
  QualifiedRef,
  RefExpr,
  Stmt,
  StockStmt,
} from '../syntax/ast.js';

export interface DesugarResult {
  readonly program: Program;
  readonly diagnostics: readonly Diagnostic[];
}

/** Names handled by this pass. Anything else is left unchanged. */
const HANDLED = new Set<string>(['step', 'pulse', 'smooth', 'delay3']);

export function desugar(ast: Program): DesugarResult {
  const diagnostics: Diagnostic[] = [];
  let counter = 0;
  const fresh = (prefix: string): string => `__${prefix}_${counter++}`;

  function rewriteScope(stmts: readonly Stmt[]): Stmt[] {
    const out: Stmt[] = [];
    const pending: Stmt[] = [];

    function rewriteExpr(e: Expr): Expr {
      switch (e.kind) {
        case 'NumberLit':
        case 'Ref':
          return e;
        case 'Unary':
          return { ...e, operand: rewriteExpr(e.operand) };
        case 'Binary':
          return { ...e, left: rewriteExpr(e.left), right: rewriteExpr(e.right) };
        case 'Call': {
          const args = e.args.map(rewriteExpr);
          if (HANDLED.has(e.callee)) {
            return desugarCall(e, args);
          }
          return { ...e, args };
        }
      }
    }

    function desugarCall(e: CallExpr, args: Expr[]): Expr {
      switch (e.callee) {
        case 'step':
          return desugarStep(e, args);
        case 'pulse':
          return desugarPulse(e, args);
        case 'smooth':
          return desugarSmooth(e, args, pending);
        case 'delay3':
          return desugarDelay3(e, args, pending);
        default:
          return e;
      }
    }

    function desugarStep(e: CallExpr, args: Expr[]): Expr {
      if (args.length !== 2) {
        diagnostics.push(arity('SD0070', 'step', 2, args.length, e.range));
        return mkNum(0, e.range);
      }
      const [h, t0] = args;
      // (time >= t0) * h
      const cond = mkBin('>=', mkRef('time', e.range), t0!, e.range);
      return mkBin('*', cond, h!, e.range);
    }

    function desugarPulse(e: CallExpr, args: Expr[]): Expr {
      if (args.length !== 3) {
        diagnostics.push(arity('SD0071', 'pulse', 3, args.length, e.range));
        return mkNum(0, e.range);
      }
      const [h, t0, w] = args;
      // (time >= t0) * (time < t0 + w) * h
      const ge = mkBin('>=', mkRef('time', e.range), t0!, e.range);
      const upper = mkBin('+', t0!, w!, e.range);
      const lt = mkBin('<', mkRef('time', e.range), upper, e.range);
      const guard = mkBin('*', ge, lt, e.range);
      return mkBin('*', guard, h!, e.range);
    }

    function desugarSmooth(e: CallExpr, args: Expr[], pending: Stmt[]): Expr {
      if (args.length !== 2) {
        diagnostics.push(arity('SD0072', 'smooth', 2, args.length, e.range));
        return mkNum(0, e.range);
      }
      const [input, tau] = args;
      const stockName = fresh('smooth');
      // stock __smooth_N = input
      pending.push(mkStock(stockName, input!, e.range));
      // flow __smooth_N_flow:  (input - __smooth_N) / tau -+> __smooth_N
      const flowExpr = mkBin(
        '/',
        mkBin('-', input!, mkRef(stockName, e.range), e.range),
        tau!,
        e.range,
      );
      pending.push(mkFlow(`${stockName}_flow`, [
        mkEffect(flowExpr, 'positive', stockName, e.range),
      ], e.range));
      return mkRef(stockName, e.range);
    }

    function desugarDelay3(e: CallExpr, args: Expr[], pending: Stmt[]): Expr {
      if (args.length !== 2) {
        diagnostics.push(arity('SD0073', 'delay3', 2, args.length, e.range));
        return mkNum(0, e.range);
      }
      const [input, tau] = args;
      const a = fresh('delay3a');
      const b = fresh('delay3b');
      const c = fresh('delay3c');
      // Each cascade re-evaluates tau/3 fresh; this is correct if tau is itself
      // an expression that varies.
      const mkTau3 = (): Expr => mkBin('/', tau!, mkNum(3, e.range), e.range);

      pending.push(mkStock(a, input!, e.range));
      pending.push(mkStock(b, input!, e.range));
      pending.push(mkStock(c, input!, e.range));

      // flow a:  (input - a) / (tau/3) -+> a
      pending.push(mkFlow(`${a}_flow`, [
        mkEffect(
          mkBin('/', mkBin('-', input!, mkRef(a, e.range), e.range), mkTau3(), e.range),
          'positive',
          a,
          e.range,
        ),
      ], e.range));
      // flow b:  (a - b) / (tau/3) -+> b
      pending.push(mkFlow(`${b}_flow`, [
        mkEffect(
          mkBin(
            '/',
            mkBin('-', mkRef(a, e.range), mkRef(b, e.range), e.range),
            mkTau3(),
            e.range,
          ),
          'positive',
          b,
          e.range,
        ),
      ], e.range));
      // flow c:  (b - c) / (tau/3) -+> c
      pending.push(mkFlow(`${c}_flow`, [
        mkEffect(
          mkBin(
            '/',
            mkBin('-', mkRef(b, e.range), mkRef(c, e.range), e.range),
            mkTau3(),
            e.range,
          ),
          'positive',
          c,
          e.range,
        ),
      ], e.range));

      return mkRef(c, e.range);
    }

    for (const s of stmts) {
      switch (s.kind) {
        case 'Constant':
          out.push({ ...s, expr: rewriteExpr(s.expr) });
          break;
        case 'Stock':
          out.push({ ...s, init: rewriteExpr(s.init) });
          break;
        case 'Calc':
          out.push({ ...s, expr: rewriteExpr(s.expr) });
          break;
        case 'Flow': {
          const newEffects: FlowEffect[] = s.effects.map((eff) => ({
            ...eff,
            expr: rewriteExpr(eff.expr),
          }));
          out.push({ ...s, effects: newEffects });
          break;
        }
        case 'Module':
          out.push({ ...s, body: rewriteScope(s.body) });
          break;
        case 'Scenario': {
          const newOverrides = s.overrides.map((ov) => ({
            ...ov,
            expr: rewriteExpr(ov.expr),
          }));
          out.push({ ...s, overrides: newOverrides });
          break;
        }
        default:
          out.push(s);
          break;
      }
    }

    return [...out, ...pending];
  }

  const newBody = rewriteScope(ast.body);
  return {
    program: { ...ast, body: newBody },
    diagnostics,
  };
}

// ────────────────────────────────────────────────────────────────────────────
// AST node constructors

function mkNum(value: number, range: SourceRange): NumberLit {
  return { kind: 'NumberLit', value, range };
}

function mkRef(name: string, range: SourceRange): RefExpr {
  return { kind: 'Ref', path: [name], range };
}

function mkBin(op: BinaryOp, left: Expr, right: Expr, range: SourceRange): BinaryExpr {
  return { kind: 'Binary', op, left, right, range };
}

function mkStock(name: string, init: Expr, range: SourceRange): StockStmt {
  return { kind: 'Stock', name, init, range, synthetic: true };
}

function mkFlow(name: string, effects: FlowEffect[], range: SourceRange): FlowStmt {
  return { kind: 'Flow', name, effects, range };
}

function mkEffect(
  expr: Expr,
  polarity: 'positive' | 'negative',
  targetName: string,
  range: SourceRange,
): FlowEffect {
  const target: QualifiedRef = { path: [targetName], range };
  return { range, expr, polarity, target };
}

function arity(
  code: string,
  name: string,
  expected: number,
  got: number,
  range: SourceRange,
): Diagnostic {
  return {
    severity: 'error',
    code,
    message: `Builtin '${name}' takes ${expected} arguments; got ${got}.`,
    range,
  };
}
