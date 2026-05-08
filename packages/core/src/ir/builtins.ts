/**
 * Built-in functions exposed to user expressions.
 *
 * Each builtin reads its arguments directly from the eval stack at offsets
 * `[sp-argc .. sp-1]` to avoid per-call allocations. The evaluator pops them
 * after the impl returns.
 *
 * Time-aware builtins (`step`, `pulse`) receive the current simulation time
 * as the third arg. Time-insensitive ones simply ignore it.
 *
 * `smooth` and `delay3` are flagged `desugared`: PR 6 rewrites them into
 * synthetic stocks plus pure expressions before lowering, so the evaluator
 * never executes them. Calling them from the lowering layer must yield
 * SD0061 ("not yet desugared").
 */

export type BuiltinImpl = (stack: Float64Array, sp: number, time: number) => number;

export interface BuiltinSpec {
  readonly argc: number;
  readonly desugared?: boolean;
  readonly impl?: BuiltinImpl;
}

export const BUILTINS: Readonly<Record<string, BuiltinSpec>> = {
  // Arity 1 — pure
  abs:   { argc: 1, impl: (s, sp) => Math.abs(s[sp - 1]!) },
  sqrt:  { argc: 1, impl: (s, sp) => Math.sqrt(s[sp - 1]!) },
  exp:   { argc: 1, impl: (s, sp) => Math.exp(s[sp - 1]!) },
  log:   { argc: 1, impl: (s, sp) => Math.log(s[sp - 1]!) },
  log10: { argc: 1, impl: (s, sp) => Math.log10(s[sp - 1]!) },
  sin:   { argc: 1, impl: (s, sp) => Math.sin(s[sp - 1]!) },
  cos:   { argc: 1, impl: (s, sp) => Math.cos(s[sp - 1]!) },
  tan:   { argc: 1, impl: (s, sp) => Math.tan(s[sp - 1]!) },

  // Arity 2 — pure
  min: { argc: 2, impl: (s, sp) => Math.min(s[sp - 2]!, s[sp - 1]!) },
  max: { argc: 2, impl: (s, sp) => Math.max(s[sp - 2]!, s[sp - 1]!) },
  pow: { argc: 2, impl: (s, sp) => Math.pow(s[sp - 2]!, s[sp - 1]!) },

  // Time-aware (will be desugared into pure expressions in PR 6,
  // but kept here so PR 5's evaluator is self-sufficient for early tests).
  step: {
    argc: 2,
    impl: (s, sp, t) => (t >= s[sp - 1]! ? s[sp - 2]! : 0),
  },
  pulse: {
    argc: 3,
    impl: (s, sp, t) => {
      const w = s[sp - 1]!;
      const t0 = s[sp - 2]!;
      const h = s[sp - 3]!;
      return t >= t0 && t < t0 + w ? h : 0;
    },
  },

  // Desugared into hidden stocks by PR 6.
  smooth: { argc: 2, desugared: true },
  delay3: { argc: 2, desugared: true },
};

export function isBuiltin(name: string): boolean {
  return Object.prototype.hasOwnProperty.call(BUILTINS, name);
}
