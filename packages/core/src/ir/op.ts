/**
 * Flat opcode for the slot-indexed evaluator.
 *
 * The IR is a stack-based VM:
 *   - PushNum / Load*    → push one value onto the eval stack
 *   - UnOp               → pop 1, push 1
 *   - BinOp              → pop 2, push 1
 *   - CallBuiltin        → pop `argc`, push 1
 *   - MapLookup          → pop 1, push 1 (interpolated lookup)
 *
 * Slots are dense per-region indices resolved at compile time, so the runtime
 * does no hash lookups: `LoadConstant.slot` is a direct `Float64Array` index.
 *
 * Encoding choice: discriminated union of plain objects rather than a packed
 * `Int32Array`/`Float64Array` pair. ~3-5× more memory than packed but trivial
 * to author, debug, and reason about. A future PR can flatten if profiling
 * demands it (the public surface need not change).
 */

import type { BinaryOp, UnaryOp } from '../syntax/ast.js';

export type Op =
  | { readonly kind: 'PushNum'; readonly value: number }
  | { readonly kind: 'LoadConstant'; readonly slot: number }
  | { readonly kind: 'LoadStock'; readonly slot: number }
  | { readonly kind: 'LoadCalc'; readonly slot: number }
  | { readonly kind: 'LoadTime' }
  | { readonly kind: 'UnOp'; readonly op: UnaryOp }
  | { readonly kind: 'BinOp'; readonly op: BinaryOp }
  | { readonly kind: 'CallBuiltin'; readonly name: string; readonly argc: number }
  | { readonly kind: 'MapLookup'; readonly mapIndex: number };
