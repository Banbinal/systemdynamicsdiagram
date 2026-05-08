/**
 * Stack-based evaluator for compiled expressions.
 *
 * Hot path: this is called for every constant init, every stock init, every
 * calc and every flow effect at every solver step (and four times per step
 * for RK4). Keep it allocation-free; all scratch buffers are passed in by
 * the caller.
 */

import type { BinaryOp } from '../syntax/ast.js';
import { BUILTINS } from './builtins.js';
import type { Op } from './op.js';
import { interpolateMap } from './interp.js';
import type { CompiledExpr, MapData } from './program.js';

export interface EvalContext {
  readonly constants: Float64Array;
  readonly stocks: Float64Array;
  readonly calcs: Float64Array;
  readonly time: number;
  readonly maps: readonly MapData[];
}

export class EvalError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
    this.name = 'EvalError';
  }
}

/**
 * Evaluate a compiled expression. `stack` must be at least
 * `expr.maxStack` slots wide. Returns the top-of-stack value.
 *
 * Throws `EvalError` only on programming errors (calling a `desugared`
 * builtin or unknown opcode); arithmetic NaN/Inf propagate normally and
 * are detected by the simulation loop, not here.
 */
export function evalExpr(
  expr: CompiledExpr,
  ctx: EvalContext,
  stack: Float64Array,
): number {
  return evalOps(expr.ops, ctx, stack);
}

export function evalOps(
  ops: readonly Op[],
  ctx: EvalContext,
  stack: Float64Array,
): number {
  let sp = 0;
  const n = ops.length;
  for (let i = 0; i < n; i++) {
    const op = ops[i]!;
    switch (op.kind) {
      case 'PushNum':
        stack[sp++] = op.value;
        break;
      case 'LoadConstant':
        stack[sp++] = ctx.constants[op.slot]!;
        break;
      case 'LoadStock':
        stack[sp++] = ctx.stocks[op.slot]!;
        break;
      case 'LoadCalc':
        stack[sp++] = ctx.calcs[op.slot]!;
        break;
      case 'LoadTime':
        stack[sp++] = ctx.time;
        break;
      case 'UnOp': {
        const a = stack[sp - 1]!;
        if (op.op === '-') stack[sp - 1] = -a;
        else if (op.op === '+') stack[sp - 1] = a;
        else stack[sp - 1] = a !== 0 ? 0 : 1; // '!'
        break;
      }
      case 'BinOp': {
        const b = stack[--sp]!;
        const a = stack[sp - 1]!;
        stack[sp - 1] = applyBin(op.op, a, b);
        break;
      }
      case 'CallBuiltin': {
        const spec = BUILTINS[op.name];
        if (!spec || !spec.impl) {
          throw new EvalError(
            'SD0061',
            `Builtin '${op.name}' has no runtime implementation (was it desugared?).`,
          );
        }
        const r = spec.impl(stack, sp, ctx.time);
        sp -= op.argc;
        stack[sp++] = r;
        break;
      }
      case 'MapLookup': {
        const x = stack[sp - 1]!;
        stack[sp - 1] = interpolateMap(ctx.maps[op.mapIndex]!, x);
        break;
      }
    }
  }
  return stack[0]!;
}

function applyBin(op: BinaryOp, a: number, b: number): number {
  switch (op) {
    case '+': return a + b;
    case '-': return a - b;
    case '*': return a * b;
    case '/': return a / b;
    case '%': return a % b;
    case '^': return Math.pow(a, b);
    case '<': return a < b ? 1 : 0;
    case '<=': return a <= b ? 1 : 0;
    case '>': return a > b ? 1 : 0;
    case '>=': return a >= b ? 1 : 0;
    case '==': return a === b ? 1 : 0;
    case '!=': return a !== b ? 1 : 0;
    case '&&': return a !== 0 && b !== 0 ? 1 : 0;
    case '||': return a !== 0 || b !== 0 ? 1 : 0;
  }
}
