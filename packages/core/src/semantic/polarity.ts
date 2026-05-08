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
 * Constants (compile-time-resolvable to numbers) are ignored: we don't infer
 * polarities w.r.t. them since they cannot vary at run time.
 */
export function inferPolarities(
  expr: Expr,
  resolvedRefs: ReadonlyMap<object, Symbol>,
): Map<number, Polarity> {
  const result = new Map<number, Polarity>();
  collectPolarities(expr, '+', resolvedRefs, result);
  return result;
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
      collectPolarities(expr.operand, inner, resolvedRefs, out);
      return;
    }

    case 'Binary': {
      const op = expr.op;
      if (op === '+') {
        collectPolarities(expr.left, signSoFar, resolvedRefs, out);
        collectPolarities(expr.right, signSoFar, resolvedRefs, out);
        return;
      }
      if (op === '-') {
        collectPolarities(expr.left, signSoFar, resolvedRefs, out);
        collectPolarities(expr.right, flip(signSoFar), resolvedRefs, out);
        return;
      }
      if (op === '*' || op === '/') {
        const leftConst = constSign(expr.left);
        const rightConst = constSign(expr.right);
        if (leftConst !== null && rightConst !== null) {
          // Both constant: no source-dependence at all.
          return;
        }
        if (leftConst !== null) {
          // Right is the variable side; left scales it.
          // If divisor: a / b — sign depends on whether the variable is on top or bottom.
          if (op === '*') {
            collectPolarities(expr.right, mul(signSoFar, leftConst), resolvedRefs, out);
          } else {
            // op === '/': a / variable → flips polarity (smaller variable → larger result).
            // Since right is variable, polarity is flipped (and scaled by sign of `a`).
            collectPolarities(expr.right, flip(mul(signSoFar, leftConst)), resolvedRefs, out);
          }
          return;
        }
        if (rightConst !== null) {
          // Left is the variable side.
          // op '*' or '/': both pass through with possible sign flip from right constant
          collectPolarities(expr.left, mul(signSoFar, rightConst), resolvedRefs, out);
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
        collectPolarities(expr.args[0]!, signSoFar, resolvedRefs, out);
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
 * For now we treat only literal numbers and unary on literals as constants.
 * (A future pass could constant-fold or use the resolved constant table.)
 */
function constSign(expr: Expr): Polarity | null {
  if (expr.kind === 'NumberLit') {
    if (expr.value > 0) return '+';
    if (expr.value < 0) return '-';
    return '?';
  }
  if (expr.kind === 'Unary' && expr.op === '-') {
    const inner = constSign(expr.operand);
    if (inner === null) return null;
    return flip(inner);
  }
  if (expr.kind === 'Unary' && expr.op === '+') {
    return constSign(expr.operand);
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
