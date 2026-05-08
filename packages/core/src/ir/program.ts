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
  readonly constants: ReadonlyArray<{ slot: number; fqn: string; expr: CompiledExpr }>;
  readonly calcs: readonly CalcIR[]; // already topologically sorted
  readonly flowEffects: readonly FlowEffectIR[];
  readonly maps: readonly MapData[];
  readonly scenarios: readonly ScenarioIR[];
  readonly sweeps: readonly SweepIR[];
  readonly limits: readonly LimitIR[];
  readonly plotTargets: readonly string[]; // FQNs
  readonly influences: readonly Influence[];
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
