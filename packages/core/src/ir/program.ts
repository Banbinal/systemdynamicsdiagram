/**
 * Compiled program — the simulation-ready intermediate representation.
 *
 * Filled in by PR 5 (IR lowering). PR 1 commits to the public shape.
 */

import type { Diagnostic } from '../diagnostics/diagnostic.js';
import type { Symbol, SymbolTable } from '../semantic/symbols.js';

/**
 * Polarity of an influence on a target variable.
 * `?` means "could not be determined symbolically" (e.g. nonlinear, two non-constant operands).
 */
export type Polarity = '+' | '-' | '?';

export interface Influence {
  readonly source: number; // Symbol.id
  readonly target: number; // Symbol.id
  readonly polarity: Polarity;
}

/**
 * SFD-style information link: a source symbol (stock, calc, constant) feeding
 * a flow's rate expression, with the polarity of that source on the rate
 * (pre-flip — independent of whether the flow adds to or subtracts from the
 * affected stock). Used by the diagram renderer to draw `source → flow` arcs.
 */
export interface FlowInput {
  readonly flow: number; // Symbol.id of the flow
  readonly source: number; // Symbol.id of the source
  readonly polarity: Polarity; // raw polarity on the flow rate
}

export type { Op } from './op.js';
import type { Op as _Op } from './op.js';

export interface CompiledExpr {
  readonly ops: readonly _Op[];
  /**
   * Maximum eval-stack depth needed to execute `ops`. Used by the runtime to
   * size scratch buffers without per-step probing.
   */
  readonly maxStack: number;
}

export interface TimeConfig {
  readonly startTime: number;
  readonly endTime: number;
  readonly timeStep: number;
}

export interface MapData {
  readonly id: number;
  readonly fqn: string;
  readonly interpolation: 'linear' | 'step' | 'spline';
  readonly xs: Float64Array;
  readonly ys: Float64Array;
  /** Precomputed second derivatives for natural cubic spline. Present iff `interpolation === 'spline'`. */
  readonly y2?: Float64Array;
}

export interface FlowEffectIR {
  readonly flowFqn: string;
  readonly targetSlot: number;
  readonly polarity: 'positive' | 'negative';
  readonly expr: CompiledExpr;
}

export interface CalcIR {
  readonly slot: number;
  readonly fqn: string;
  readonly expr: CompiledExpr;
}

export interface StockIR {
  readonly slot: number;
  readonly fqn: string;
  readonly init: CompiledExpr;
  /** True if this stock was synthesized from `smooth`/`delay3` desugaring. */
  readonly synthetic: boolean;
  /** When this stock was synthesized for `smooth(...)` or `delay3(...)`. */
  readonly delayKind?: 'smooth' | 'delay3';
  /**
   * Symbol ids of the original input source(s) — recovered by walking the
   * synthetic stock's init expression. Used by the renderer to substitute
   * `synthetic → consumer` arcs with `input → consumer` arcs marked as
   * delayed. Empty for non-delay stocks.
   */
  readonly delayInputs?: readonly number[];
}

export interface ScenarioIR {
  readonly name: string;
  readonly constantOverrides: ReadonlyArray<{ slot: number; expr: CompiledExpr }>;
  readonly stockOverrides: ReadonlyArray<{ slot: number; expr: CompiledExpr }>;
}

export interface SweepIR {
  readonly target: string; // FQN
  readonly slot: number;
  readonly values: Float64Array;
}

export interface LimitIR {
  readonly slot: number;
  readonly fqn: string;
  readonly min?: number;
  readonly max?: number;
}

// ──────────────────────────────────────────────────────────────────────────────
// Reality Check IR

export type CheckOp = '>=' | '<=' | '>' | '<' | '==' | '!=';
export type CheckTemporal =
  | { readonly kind: 'always' }
  | { readonly kind: 'at'; readonly t: number };

export interface CheckInputIR {
  /** Constant FQN being overridden for this check's run. */
  readonly fqn: string;
  /** Compiled override expression. Evaluated against base constants only. */
  readonly expr: CompiledExpr;
}

export interface CheckIR {
  readonly name: string;
  readonly inputs: readonly CheckInputIR[];
  readonly lhs: CompiledExpr;
  readonly op: CheckOp;
  readonly rhs: CompiledExpr;
  readonly temporal: CheckTemporal;
}

/** Reference-mode IR — a (t, v) point list keyed by target FQN. */
export interface ReferenceModeIR {
  readonly fqn: string;
  readonly points: ReadonlyArray<{ readonly t: number; readonly v: number }>;
}

/**
 * The result of `compile(ast)`: ready for `simulate(program)`.
 *
 * Layout: stocks and constants live in separate Float64Array slots indexed by
 * `Symbol.id`. Calcs are evaluated in topological order each step.
 */
export interface CompiledProgram {
  readonly title: string | null;
  readonly time: TimeConfig;
  readonly symbols: SymbolTable;
  readonly stocks: readonly StockIR[];
  readonly constants: ReadonlyArray<{
    slot: number;
    fqn: string;
    expr: CompiledExpr;
    /** Set when declared `exogenous constant …` — surfaced by the renderer. */
    exogenous?: boolean;
  }>;
  readonly calcs: readonly CalcIR[]; // already topologically sorted
  readonly flowEffects: readonly FlowEffectIR[];
  readonly maps: readonly MapData[];
  readonly scenarios: readonly ScenarioIR[];
  readonly sweeps: readonly SweepIR[];
  readonly limits: readonly LimitIR[];
  readonly plotTargets: readonly string[]; // FQNs
  readonly influences: readonly Influence[];
  readonly flowInputs: readonly FlowInput[];
  readonly checks: readonly CheckIR[];
  readonly references: readonly ReferenceModeIR[];
  readonly diagnostics: readonly Diagnostic[];
  /** Total number of stock slots (including synthetic stocks from desugaring). */
  readonly stockCount: number;
  /** Total number of constant slots. */
  readonly constantCount: number;
  /** Total number of calc slots. */
  readonly calcCount: number;
}

/** A symbolic export so consumers can probe the table without importing semantic/. */
export type { Symbol, SymbolTable };
