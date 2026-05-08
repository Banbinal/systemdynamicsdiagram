/**
 * AST → IR lowering.
 *
 * Walks an `Expr` tree and emits a flat opcode list with pre-resolved slot
 * indices. Symbol kinds drive opcode choice:
 *   - constant         → LoadConstant <slot>
 *   - stock            → LoadStock <slot>
 *   - calc             → LoadCalc <slot>
 *   - builtin `time`   → LoadTime
 *   - other builtins (referenced as a value) → SD0062 (must be called)
 *   - map (referenced as a value) → SD0063 (must be invoked)
 *
 * For `Call` expressions, the callee was resolved during the resolver pass
 * and is stored on the CallExpr node in `resolvedRefs`. Dispatch:
 *   - Symbol.kind === 'map'        → MapLookup <mapIndex>
 *   - Symbol.kind === 'builtin'
 *       and builtin is desugared   → SD0061 (smooth/delay3 not yet desugared)
 *       and builtin is callable    → CallBuiltin <name, argc>
 *   - anything else                → SD0064 (not callable)
 *
 * Stable error codes:
 *   SD0060  arity mismatch on builtin call
 *   SD0061  call to a desugared builtin (smooth/delay3) before PR 6 ran
 *   SD0062  builtin used as value (e.g. `min` without parens)
 *   SD0063  map used as value (e.g. `MyMap` without parens)
 *   SD0064  cannot call/use this kind of symbol as a value
 */

import type { Diagnostic } from '../diagnostics/diagnostic.js';
import type { CallExpr, Expr } from '../syntax/ast.js';
import type { Symbol, SymbolTable } from '../semantic/symbols.js';
import { BUILTINS } from './builtins.js';
import type { Op } from './op.js';
import type { CompiledExpr } from './program.js';

/** Per-symbol slot mapping built once per compile. */
export interface SlotIndex {
  /** symbolId → dense index into the constants Float64Array. */
  readonly constantSlot: ReadonlyMap<number, number>;
  /** symbolId → dense index into the stocks Float64Array. */
  readonly stockSlot: ReadonlyMap<number, number>;
  /** symbolId → dense index into the calcs Float64Array. */
  readonly calcSlot: ReadonlyMap<number, number>;
  /** symbolId of a map → dense index into program.maps. */
  readonly mapIndex: ReadonlyMap<number, number>;
}

export interface LowerContext {
  readonly resolvedRefs: ReadonlyMap<object, Symbol>;
  readonly slots: SlotIndex;
  readonly table: SymbolTable;
}

export interface LowerResult {
  readonly expr: CompiledExpr;
  readonly diagnostics: readonly Diagnostic[];
}

export function lowerExpr(e: Expr, ctx: LowerContext): LowerResult {
  const ops: Op[] = [];
  const diagnostics: Diagnostic[] = [];
  const maxStack = walk(e, ctx, ops, diagnostics);
  return {
    expr: { ops, maxStack },
    diagnostics,
  };
}

/**
 * Walk an expression and emit ops in postorder. Returns the maximum stack
 * depth needed by the emitted ops (so the caller can size scratch buffers).
 */
function walk(
  e: Expr,
  ctx: LowerContext,
  ops: Op[],
  diags: Diagnostic[],
): number {
  switch (e.kind) {
    case 'NumberLit':
      ops.push({ kind: 'PushNum', value: e.value });
      return 1;

    case 'Ref': {
      const sym = ctx.resolvedRefs.get(e);
      if (!sym) {
        // Resolver already emitted SD0041; emit a placeholder so downstream
        // sizing remains consistent and tests don't crash on undefined.
        ops.push({ kind: 'PushNum', value: 0 });
        return 1;
      }
      return emitLoad(sym, e, ctx, ops, diags);
    }

    case 'Unary': {
      const inner = walk(e.operand, ctx, ops, diags);
      ops.push({ kind: 'UnOp', op: e.op });
      return inner;
    }

    case 'Binary': {
      const leftDepth = walk(e.left, ctx, ops, diags);
      const rightDepth = walk(e.right, ctx, ops, diags);
      ops.push({ kind: 'BinOp', op: e.op });
      // After lowering left, depth = leftDepth.
      // After lowering right, depth = leftDepth + rightDepth (max during right walk = leftDepth + rightDepth).
      // After BinOp, depth = leftDepth + rightDepth - 1.
      return Math.max(leftDepth, leftDepth + rightDepth);
    }

    case 'Call':
      return emitCall(e, ctx, ops, diags);

    case 'ArrayLit':
      // ArrayLit is only legal as the RHS of a subscripted constant; the
      // subscript expansion pass should have replaced it with NumberLits per
      // element. Reaching this branch means it was used out of context —
      // emit a zero so codegen stays consistent and surface a diagnostic.
      diags.push({
        severity: 'error',
        code: 'SD0065',
        message: 'Array literal is only valid as the initial value of a subscripted constant.',
        range: e.range,
      });
      return pushZero(ops);
  }
}

function emitLoad(
  sym: Symbol,
  e: Expr,
  ctx: LowerContext,
  ops: Op[],
  diags: Diagnostic[],
): number {
  switch (sym.kind) {
    case 'constant': {
      const slot = ctx.slots.constantSlot.get(sym.id);
      if (slot === undefined) return pushZero(ops);
      ops.push({ kind: 'LoadConstant', slot });
      return 1;
    }
    case 'stock': {
      const slot = ctx.slots.stockSlot.get(sym.id);
      if (slot === undefined) return pushZero(ops);
      ops.push({ kind: 'LoadStock', slot });
      return 1;
    }
    case 'calc': {
      const slot = ctx.slots.calcSlot.get(sym.id);
      if (slot === undefined) return pushZero(ops);
      ops.push({ kind: 'LoadCalc', slot });
      return 1;
    }
    case 'builtin':
      if (sym.fqn === 'time') {
        ops.push({ kind: 'LoadTime' });
        return 1;
      }
      diags.push({
        severity: 'error',
        code: 'SD0062',
        message: `Builtin '${sym.fqn}' must be called, not referenced as a value.`,
        range: e.range,
      });
      return pushZero(ops);
    case 'map':
      diags.push({
        severity: 'error',
        code: 'SD0063',
        message: `Map '${sym.fqn}' must be invoked as ${sym.name}(x), not referenced as a value.`,
        range: e.range,
      });
      return pushZero(ops);
    case 'flow':
    case 'module':
      diags.push({
        severity: 'error',
        code: 'SD0064',
        message: `Cannot use ${sym.kind} '${sym.fqn}' as a value.`,
        range: e.range,
      });
      return pushZero(ops);
  }
}

function emitCall(
  e: CallExpr,
  ctx: LowerContext,
  ops: Op[],
  diags: Diagnostic[],
): number {
  const callee = ctx.resolvedRefs.get(e);
  if (!callee) {
    // Resolver already flagged this as unresolved.
    return pushZero(ops);
  }

  // Map call: MapName(x).
  if (callee.kind === 'map') {
    if (e.args.length !== 1) {
      diags.push({
        severity: 'error',
        code: 'SD0060',
        message: `Map '${callee.fqn}' takes exactly 1 argument; got ${e.args.length}.`,
        range: e.range,
      });
      return pushZero(ops);
    }
    const idx = ctx.slots.mapIndex.get(callee.id);
    if (idx === undefined) return pushZero(ops);
    const argDepth = walk(e.args[0]!, ctx, ops, diags);
    ops.push({ kind: 'MapLookup', mapIndex: idx });
    return argDepth;
  }

  // Builtin call.
  if (callee.kind === 'builtin') {
    const spec = BUILTINS[callee.fqn];
    if (!spec) {
      diags.push({
        severity: 'error',
        code: 'SD0064',
        message: `Builtin '${callee.fqn}' is not callable.`,
        range: e.range,
      });
      return pushZero(ops);
    }
    if (spec.desugared) {
      diags.push({
        severity: 'error',
        code: 'SD0061',
        message: `Builtin '${callee.fqn}' must be desugared before lowering (PR 6).`,
        range: e.range,
      });
      return pushZero(ops);
    }
    if (e.args.length !== spec.argc) {
      diags.push({
        severity: 'error',
        code: 'SD0060',
        message: `Builtin '${callee.fqn}' takes ${spec.argc} arguments; got ${e.args.length}.`,
        range: e.range,
      });
      return pushZero(ops);
    }
    let depth = 0;
    for (let i = 0; i < e.args.length; i++) {
      const argDepth = walk(e.args[i]!, ctx, ops, diags);
      depth = Math.max(depth, i + argDepth);
    }
    ops.push({ kind: 'CallBuiltin', name: callee.fqn, argc: spec.argc });
    // After call, we have argc fewer items, +1 result.
    return Math.max(depth, e.args.length);
  }

  diags.push({
    severity: 'error',
    code: 'SD0064',
    message: `Cannot call ${callee.kind} '${callee.fqn}'.`,
    range: e.range,
  });
  return pushZero(ops);
}

function pushZero(ops: Op[]): number {
  ops.push({ kind: 'PushNum', value: 0 });
  return 1;
}
