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
  | LimitStmt;

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
}

export interface StockStmt extends NodeBase {
  readonly kind: 'Stock';
  readonly name: string;
  readonly init: Expr;
  /** True if this stock was synthesized by the desugar pass (smooth/delay3). */
  readonly synthetic?: boolean;
}

export interface CalcStmt extends NodeBase {
  readonly kind: 'Calc';
  readonly name: string;
  readonly expr: Expr;
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
// Expression nodes

export type Expr =
  | NumberLit
  | RefExpr
  | BinaryExpr
  | UnaryExpr
  | CallExpr;

export interface NumberLit extends NodeBase {
  readonly kind: 'NumberLit';
  readonly value: number;
}

/** A possibly-dotted name. The resolver fills `symbolId` post-resolution. */
export interface QualifiedRef extends NodeBase {
  readonly path: readonly string[];
}

export interface RefExpr extends NodeBase {
  readonly kind: 'Ref';
  readonly path: readonly string[];
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

// ──────────────────────────────────────────────────────────────────────────────
// Program (root)

export interface Program extends NodeBase {
  readonly kind: 'Program';
  readonly body: readonly Stmt[];
}
