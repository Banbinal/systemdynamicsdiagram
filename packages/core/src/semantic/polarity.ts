/**
 * Symbolic polarity inference.
 *
 * For each (target, source) pair where `target` is a calc, stock-init, or
 * flow-effect expression, determine whether an increase in `source` causes
 * `target` to:
 *   '+'  increase
 *   '-'  decrease
 *   '?'  unclear (nonlinear, two non-constant operands, unknown function, etc.)
 *
 * Rules walk the AST of the target expression:
 *   - Number literal:   contributes nothing (drops the influence).
 *   - Ref(x):           identity, polarity '+' for source=x.
 *   - Unary('-', e):    flips the polarity of e w.r.t. source.
 *   - Binary('+', a, b): combine polarities by union (one side may dominate).
 *   - Binary('-', a, b): combine LHS as-is, flip RHS.
 *   - Binary('*'|'/', a, b):
 *       if one side is a *constant value at compile-time*:
 *          - constant ≥ 0 → identity (other side's polarity)
 *          - constant < 0  → flip
 *       else: '?' (sign depends on operand values)
 *   - Binary('^', a, b): '?' (sign depends on values; we don't track this)
 *   - Binary(comparison/logical): '?' (jumps, not smooth)
 *   - Call(f, args):
 *       if f is monotone-increasing builtin (`exp`, `sqrt`): pass through
 *         the polarity of the (single) argument.
 *       else: '?'
 *
 * The function returns polarity per (source) for one target. The compiler
 * combines per-target results into the final influences[] list.
 */

import type { Expr } from '../syntax/ast.js';
import type { Symbol } from './symbols.js';

export type Polarity = '+' | '-' | '?';

const MONOTONE_INCREASING = new Set<string>(['exp', 'sqrt', 'abs']);

/**
 * Compute polarity of `target` expression w.r.t. each source symbol that
 * appears in it. Returns a map `sourceId → polarity`.
 *
 * The optional `constantSigns` map provides statically-known signs of
 * `constant` symbols (typically derived from their defining expressions):
 * those signs feed `*` and `/` polarity propagation so that, e.g., the rate
 * `Stock * RateConstant` yields `+` for both sources rather than degrading
 * to `?`. Without a sign for a constant, the inference falls back to the
 * literal-only behaviour and emits `?`.
 */
export function inferPolarities(
  expr: Expr,
  resolvedRefs: ReadonlyMap<object, Symbol>,
  constantSigns?: ReadonlyMap<number, Polarity>,
): Map<number, Polarity> {
  const result = new Map<number, Polarity>();
  collectPolarities(expr, '+', resolvedRefs, constantSigns ?? EMPTY_SIGNS, result);
  return result;
}

const EMPTY_SIGNS: ReadonlyMap<number, Polarity> = new Map();

/**
 * Walk an expression and return its sign if it can be statically determined
 * (literals, unary on literals, refs to constants whose sign is known).
 * Returns null if the sign depends on a non-constant variable, or on a
 * constant whose sign is unknown.
 *
 * Used by `inferConstantSigns` to fold each constant's defining expression
 * down to a sign in topo order.
 */
export function signOfConstantExpr(
  expr: Expr,
  resolvedRefs: ReadonlyMap<object, Symbol>,
  constantSigns: ReadonlyMap<number, Polarity>,
): Polarity | null {
  switch (expr.kind) {
    case 'NumberLit':
      if (expr.value > 0) return '+';
      if (expr.value < 0) return '-';
      return '?';
    case 'Ref': {
      const sym = resolvedRefs.get(expr);
      if (!sym || sym.kind !== 'constant') return null;
      return constantSigns.get(sym.id) ?? null;
    }
    case 'Unary': {
      const inner = signOfConstantExpr(expr.operand, resolvedRefs, constantSigns);
      if (inner === null) return null;
      return expr.op === '-' ? flip(inner) : inner;
    }
    case 'Binary': {
      const l = signOfConstantExpr(expr.left, resolvedRefs, constantSigns);
      const r = signOfConstantExpr(expr.right, resolvedRefs, constantSigns);
      if (l === null || r === null) return null;
      switch (expr.op) {
        case '+':
          // Sign of a sum: both same → that sign; otherwise unknown.
          return l === r ? l : null;
        case '-':
          return l === flip(r) ? l : null;
        case '*':
        case '/':
          return mul(l, r);
        default:
          return null;
      }
    }
    case 'Call':
      // Builtins can be sign-preserving (sqrt, exp, abs) but signs of complex
      // calls are out of scope for this static fold.
      return null;
    case 'ArrayLit':
      // Should have been expanded to a NumberLit by the subscript pass.
      return null;
  }
}

/**
 * Internal recursive walker.
 *
 * `signSoFar` is the polarity that this subtree contributes to the parent
 * with respect to its containing chain (e.g., inside a `-(...)` it flips).
 */
function collectPolarities(
  expr: Expr,
  signSoFar: Polarity,
  resolvedRefs: ReadonlyMap<object, Symbol>,
  constantSigns: ReadonlyMap<number, Polarity>,
  out: Map<number, Polarity>,
): void {
  switch (expr.kind) {
    case 'NumberLit':
      return;

    case 'Ref': {
      const sym = resolvedRefs.get(expr);
      // We track polarity for stocks, calcs, and constants. For constants
      // it can be debated; including them helps the diagram for clarity.
      if (!sym) return;
      if (sym.kind === 'builtin' || sym.kind === 'map') return;
      mergePolarity(out, sym.id, signSoFar);
      return;
    }

    case 'Unary': {
      const inner = expr.op === '-' ? flip(signSoFar) : signSoFar;
      collectPolarities(expr.operand, inner, resolvedRefs, constantSigns, out);
      return;
    }

    case 'Binary': {
      const op = expr.op;
      if (op === '+') {
        collectPolarities(expr.left, signSoFar, resolvedRefs, constantSigns, out);
        collectPolarities(expr.right, signSoFar, resolvedRefs, constantSigns, out);
        return;
      }
      if (op === '-') {
        collectPolarities(expr.left, signSoFar, resolvedRefs, constantSigns, out);
        collectPolarities(expr.right, flip(signSoFar), resolvedRefs, constantSigns, out);
        return;
      }
      if (op === '*' || op === '/') {
        const leftConst = constSign(expr.left, resolvedRefs, constantSigns);
        const rightConst = constSign(expr.right, resolvedRefs, constantSigns);
        if (leftConst !== null && rightConst !== null) {
          // Both fully constant: no source-dependence at all. We still recurse
          // into Refs so any constant symbol gets registered as a (zero-net)
          // source — but with the propagated polarity from its multiplier.
          collectPolarities(expr.left, mul(signSoFar, rightConst), resolvedRefs, constantSigns, out);
          collectPolarities(
            expr.right,
            op === '*' ? mul(signSoFar, leftConst) : flip(mul(signSoFar, leftConst)),
            resolvedRefs,
            constantSigns,
            out,
          );
          return;
        }
        if (leftConst !== null) {
          // Right is the variable side; left scales it. Recurse into the left
          // too so a constant Ref appears as a source (NumberLits no-op).
          if (op === '*') {
            collectPolarities(expr.right, mul(signSoFar, leftConst), resolvedRefs, constantSigns, out);
          } else {
            // op === '/': a / variable → flip polarity for the right side.
            collectPolarities(
              expr.right,
              flip(mul(signSoFar, leftConst)),
              resolvedRefs,
              constantSigns,
              out,
            );
          }
          // Left's effect on the product depends on sign of right side. We
          // can't always determine that statically — fall back to '?' for
          // the left when it's a Ref to a constant, otherwise no-op (literal).
          if (expr.left.kind === 'Ref') {
            const sym = resolvedRefs.get(expr.left);
            if (sym && sym.kind !== 'builtin' && sym.kind !== 'map') {
              mergePolarity(out, sym.id, '?');
            }
          }
          return;
        }
        if (rightConst !== null) {
          // Left is the variable side.
          collectPolarities(expr.left, mul(signSoFar, rightConst), resolvedRefs, constantSigns, out);
          // Right's effect on the product depends on sign of left side.
          if (expr.right.kind === 'Ref') {
            const sym = resolvedRefs.get(expr.right);
            if (sym && sym.kind !== 'builtin' && sym.kind !== 'map') {
              mergePolarity(out, sym.id, '?');
            }
          }
          return;
        }
        // Both non-constant: emit '?' for everything mentioned on either side.
        markUnknown(expr.left, resolvedRefs, out);
        markUnknown(expr.right, resolvedRefs, out);
        return;
      }
      // ^, %, comparison, logical: too gnarly to track precisely.
      markUnknown(expr.left, resolvedRefs, out);
      markUnknown(expr.right, resolvedRefs, out);
      return;
    }

    case 'Call': {
      // Pass-through for monotone-increasing single-arg builtins.
      if (MONOTONE_INCREASING.has(expr.callee) && expr.args.length === 1) {
        collectPolarities(expr.args[0]!, signSoFar, resolvedRefs, constantSigns, out);
        return;
      }
      // Anything else: mark every referenced source as unknown.
      for (const arg of expr.args) markUnknown(arg, resolvedRefs, out);
      return;
    }
  }
}

/** Mark every referenced source in `expr` as unknown polarity. */
function markUnknown(
  expr: Expr,
  resolvedRefs: ReadonlyMap<object, Symbol>,
  out: Map<number, Polarity>,
): void {
  switch (expr.kind) {
    case 'NumberLit':
      return;
    case 'Ref': {
      const sym = resolvedRefs.get(expr);
      if (sym && sym.kind !== 'builtin' && sym.kind !== 'map') {
        mergePolarity(out, sym.id, '?');
      }
      return;
    }
    case 'Unary':
      markUnknown(expr.operand, resolvedRefs, out);
      return;
    case 'Binary':
      markUnknown(expr.left, resolvedRefs, out);
      markUnknown(expr.right, resolvedRefs, out);
      return;
    case 'Call':
      for (const a of expr.args) markUnknown(a, resolvedRefs, out);
      return;
  }
}

/**
 * If an expression is a constant at compile time, return its sign:
 *   '+' for ≥ 0, '-' for < 0, '?' if zero (rare but well-defined).
 * Returns null if not constant.
 *
 * Recognizes:
 *   - literal numbers and unary +/- on literals,
 *   - references to a `constant` symbol — treated as `+` per SD convention
 *     (named parameters like rates, capacities, factors are positive by
 *     default). A user who declares `constant K = -3` will see polarity `?`
 *     downgraded to `+` here; this is a conscious trade-off — getting useful
 *     polarity labels on the common case beats correctness on the edge case.
 *     A future pass could fold the constant's defining expression.
 */
function constSign(
  expr: Expr,
  resolvedRefs: ReadonlyMap<object, Symbol>,
  constantSigns: ReadonlyMap<number, Polarity>,
): Polarity | null {
  if (expr.kind === 'NumberLit') {
    if (expr.value > 0) return '+';
    if (expr.value < 0) return '-';
    return '?';
  }
  if (expr.kind === 'Unary' && expr.op === '-') {
    const inner = constSign(expr.operand, resolvedRefs, constantSigns);
    if (inner === null) return null;
    return flip(inner);
  }
  if (expr.kind === 'Unary' && expr.op === '+') {
    return constSign(expr.operand, resolvedRefs, constantSigns);
  }
  if (expr.kind === 'Ref') {
    const sym = resolvedRefs.get(expr);
    if (!sym || sym.kind !== 'constant') return null;
    return constantSigns.get(sym.id) ?? null;
  }
  return null;
}

function flip(p: Polarity): Polarity {
  if (p === '+') return '-';
  if (p === '-') return '+';
  return '?';
}

function mul(a: Polarity, b: Polarity): Polarity {
  if (a === '?' || b === '?') return '?';
  return a === b ? '+' : '-';
}

/** Merge an incoming polarity into an existing one for the same source. */
function mergePolarity(map: Map<number, Polarity>, id: number, incoming: Polarity): void {
  const existing = map.get(id);
  if (existing === undefined) {
    map.set(id, incoming);
    return;
  }
  if (existing === incoming) return;
  // Conflict (one expression has +, another -): downgrade to ?.
  map.set(id, '?');
}
