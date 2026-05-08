/**
 * Abstract Syntax Tree for the v2 DSL.
 *
 * Two parallel discriminated unions: `Stmt` for top-level / block declarations
 * and `Expr` for value-producing expressions. Both carry a `SourceRange`.
 *
 * Filled in by PR 3. PR 1 commits to the public shape so downstream code
 * (resolver, IR, evaluator) can be developed against stable types.
 */

import type { SourceRange } from '../diagnostics/source.js';

// ──────────────────────────────────────────────────────────────────────────────
// Top-level / statement nodes

export type Stmt =
  | TimeConfigStmt
  | TitleStmt
  | ConstantStmt
  | StockStmt
  | CalcStmt
  | FlowStmt
  | MapStmt
  | ModuleStmt
  | ScenarioStmt
  | SweepStmt
  | PlotStmt
  | LimitStmt
  | CheckStmt
  | ReferenceStmt
  | CalibrateStmt
  | SubscriptStmt;

export interface NodeBase {
  readonly range: SourceRange;
}

export type TimeConfigKey = 'StartTime' | 'EndTime' | 'TimeStep';

export interface TimeConfigStmt extends NodeBase {
  readonly kind: 'TimeConfig';
  readonly key: TimeConfigKey;
  readonly value: number;
}

export interface TitleStmt extends NodeBase {
  readonly kind: 'Title';
  readonly text: string;
}

export interface ConstantStmt extends NodeBase {
  readonly kind: 'Constant';
  readonly name: string;
  readonly expr: Expr;
  /**
   * Set when the constant is declared `exogenous constant X = ...` —
   * flags it as an input that comes from outside the modelled system
   * (per Sterman's boundary-diagram convention). The renderer draws
   * exogenous constants with a dashed border + "exo" badge.
   */
  readonly exogenous?: boolean;
  /** Subscript dimension name when declared `constant X[Sub] = ...`. */
  readonly subscript?: string;
}

export interface StockStmt extends NodeBase {
  readonly kind: 'Stock';
  readonly name: string;
  readonly init: Expr;
  /** True if this stock was synthesized by the desugar pass (smooth/delay3). */
  readonly synthetic?: boolean;
  /**
   * Set by desugaring on synthetic stocks that implement an information
   * delay. The renderer uses this to replace edges into the synthetic stock
   * with delay-marked edges from the original input source(s).
   */
  readonly delayKind?: 'smooth' | 'delay3';
  /** Subscript dimension name when declared `stock X[Sub] = ...`. */
  readonly subscript?: string;
}

export interface CalcStmt extends NodeBase {
  readonly kind: 'Calc';
  readonly name: string;
  readonly expr: Expr;
  /** Subscript dimension name when declared `calc X[Sub] = ...`. */
  readonly subscript?: string;
}

export type FlowPolarity = 'positive' | 'negative';

export interface FlowEffect extends NodeBase {
  readonly expr: Expr;
  readonly polarity: FlowPolarity;
  readonly target: QualifiedRef;
}

export interface FlowStmt extends NodeBase {
  readonly kind: 'Flow';
  readonly name: string;
  readonly effects: readonly FlowEffect[];
  /** Subscript dimension name when declared `flow X[Sub]: ...`. */
  readonly subscript?: string;
}

export type MapInterpolation = 'linear' | 'step' | 'spline';

export interface MapPoint {
  readonly x: number;
  readonly y: number;
  readonly range: SourceRange;
}

export interface MapStmt extends NodeBase {
  readonly kind: 'Map';
  readonly name: string;
  readonly interpolation: MapInterpolation;
  readonly points: readonly MapPoint[];
}

export interface ModuleStmt extends NodeBase {
  readonly kind: 'Module';
  readonly name: string;
  readonly body: readonly Stmt[];
}

export type OverrideTargetKind = 'constant' | 'stock';

export interface ScenarioOverride extends NodeBase {
  readonly targetKind: OverrideTargetKind;
  readonly target: QualifiedRef;
  readonly expr: Expr;
}

export interface ScenarioStmt extends NodeBase {
  readonly kind: 'Scenario';
  readonly name: string;
  readonly overrides: readonly ScenarioOverride[];
}

export interface SweepStmt extends NodeBase {
  readonly kind: 'Sweep';
  readonly target: QualifiedRef;
  readonly values: readonly number[];
}

export interface PlotStmt extends NodeBase {
  readonly kind: 'Plot';
  readonly target: QualifiedRef;
}

export interface LimitStmt extends NodeBase {
  readonly kind: 'Limit';
  readonly target: QualifiedRef;
  readonly min?: number;
  readonly max?: number;
}

// ──────────────────────────────────────────────────────────────────────────────
// Reality Check
// ──────────────────────────────────────────────────────────────────────────────

/** Operators allowed in a check assertion. Strict subset of the binary set. */
export type CheckOp = '>=' | '<=' | '>' | '<' | '==' | '!=';

/** A single `when <Const> = <expr>` clause: a fixed input override for the run. */
export interface CheckInput extends NodeBase {
  readonly target: QualifiedRef;
  readonly expr: Expr;
}

/**
 * Temporal qualifier on the assertion.
 *   - `always`: must hold at every recorded step.
 *   - `at`:     must hold at the recorded step closest to `t`.
 */
export type CheckTemporal =
  | { readonly kind: 'always' }
  | { readonly kind: 'at'; readonly t: number };

export interface CheckStmt extends NodeBase {
  readonly kind: 'Check';
  readonly name: string;
  readonly inputs: readonly CheckInput[];
  /** The assertion's left-hand expression (`Population` in `Population >= 0`). */
  readonly lhs: Expr;
  readonly op: CheckOp;
  /** The assertion's right-hand expression (`0` in `Population >= 0`). */
  readonly rhs: Expr;
  readonly temporal: CheckTemporal;
}

// ──────────────────────────────────────────────────────────────────────────────
// Reference modes — Sterman's "expected behaviour over time" target. Drawn
// as a dashed overlay on the simulation chart so the modeller sees the gap
// between the model's output and the cited behaviour.

export interface ReferencePoint {
  readonly t: number;
  readonly v: number;
  readonly range: SourceRange;
}

export interface ReferenceStmt extends NodeBase {
  readonly kind: 'Reference';
  readonly target: QualifiedRef;
  readonly points: readonly ReferencePoint[];
}

// ──────────────────────────────────────────────────────────────────────────────
// Calibration — fit a subset of constants so the simulation reproduces the
// model's reference modes. One block per program (last wins); each `bounds`
// line declares a free parameter and its allowed range.

export interface CalibrationParam extends NodeBase {
  readonly target: QualifiedRef;
  readonly low: number;
  readonly high: number;
}

export interface CalibrateStmt extends NodeBase {
  readonly kind: 'Calibrate';
  readonly params: readonly CalibrationParam[];
}

// ──────────────────────────────────────────────────────────────────────────────
// Subscripts — `subscript Region = North, South, East, West`. Phase 1 only
// supports a single 1D dimension per declaration; the desugar pass expands
// `Foo[Region]` into one variable per element, e.g. `Foo_North`, …

export interface SubscriptStmt extends NodeBase {
  readonly kind: 'Subscript';
  readonly name: string;
  readonly elements: readonly string[];
}

// ──────────────────────────────────────────────────────────────────────────────
// Expression nodes

export type Expr =
  | NumberLit
  | RefExpr
  | BinaryExpr
  | UnaryExpr
  | CallExpr
  | ArrayLit;

export interface NumberLit extends NodeBase {
  readonly kind: 'NumberLit';
  readonly value: number;
}

/** A possibly-dotted name. The resolver fills `symbolId` post-resolution. */
export interface QualifiedRef extends NodeBase {
  readonly path: readonly string[];
  /**
   * Optional subscript bracket: `Foo[Sub]` or `Foo[North]`. The desugar
   * pass resolves it to either the current loop's element (when Sub is the
   * containing decl's subscript name) or the named element directly.
   */
  readonly subscript?: string;
}

export interface RefExpr extends NodeBase {
  readonly kind: 'Ref';
  readonly path: readonly string[];
  readonly subscript?: string;
}

export type BinaryOp =
  | '+' | '-' | '*' | '/' | '%' | '^'
  | '<' | '<=' | '>' | '>=' | '==' | '!='
  | '&&' | '||';

export interface BinaryExpr extends NodeBase {
  readonly kind: 'Binary';
  readonly op: BinaryOp;
  readonly left: Expr;
  readonly right: Expr;
}

export type UnaryOp = '-' | '+' | '!';

export interface UnaryExpr extends NodeBase {
  readonly kind: 'Unary';
  readonly op: UnaryOp;
  readonly operand: Expr;
}

export interface CallExpr extends NodeBase {
  readonly kind: 'Call';
  readonly callee: string;
  readonly args: readonly Expr[];
}

/**
 * Numeric array literal: `[0.05, 0.04, 0.06, 0.03]`. Only legal as the RHS
 * of a subscripted constant declaration; everywhere else the desugar pass
 * raises an error.
 */
export interface ArrayLit extends NodeBase {
  readonly kind: 'ArrayLit';
  readonly values: readonly number[];
}

// ──────────────────────────────────────────────────────────────────────────────
// Program (root)

export interface Program extends NodeBase {
  readonly kind: 'Program';
  readonly body: readonly Stmt[];
}
