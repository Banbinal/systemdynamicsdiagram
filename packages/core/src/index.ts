/**
 * `@sysdyn/core` — public barrel.
 *
 * The five entry points for callers are: `parse`, `compile`, `build`, `simulate`, `simulateAll`.
 * Everything else exported here is types.
 */

// Entry points
export { parse, type ParseOptions, type ParseResult } from './api/parse.js';
export { compile, type CompileResult } from './api/compile.js';
export { build, type BuildResult } from './api/build.js';
export {
  simulate,
  simulateAll,
  type SimulateOptions,
  type SimulateAllOptions,
  type SimulationResult,
  type VariationResult,
} from './runtime/simulate.js';
export {
  runChecks,
  type CheckRunOptions,
  type CheckResult,
  type CheckPass,
  type CheckFail,
  type CheckErr,
} from './runtime/checks.js';
export {
  runCalibration,
  type CalibrationOptions,
  type CalibrationResult,
  type CalibrationOk,
  type CalibrationErr,
  type CalibrationParamResult,
} from './runtime/calibrate.js';

// Diagnostics
export {
  hasErrors,
  formatDiagnostic,
  type Diagnostic,
  type Severity,
  type RelatedInformation,
} from './diagnostics/diagnostic.js';
export {
  type Position,
  type SourceRange,
  type SourceFile,
  makeSourceFile,
} from './diagnostics/source.js';

// Syntax (AST)
export type {
  Program,
  Stmt,
  Expr,
  TimeConfigStmt,
  TimeConfigKey,
  TitleStmt,
  ConstantStmt,
  StockStmt,
  CalcStmt,
  FlowStmt,
  FlowEffect,
  FlowPolarity,
  MapStmt,
  MapPoint,
  MapInterpolation,
  ModuleStmt,
  ScenarioStmt,
  ScenarioOverride,
  OverrideTargetKind,
  SweepStmt,
  PlotStmt,
  LimitStmt,
  QualifiedRef,
  NumberLit,
  RefExpr,
  BinaryExpr,
  BinaryOp,
  UnaryExpr,
  UnaryOp,
  CallExpr,
  NodeBase,
} from './syntax/ast.js';

// Semantic
export type { Symbol, SymbolKind, SymbolTable } from './semantic/symbols.js';
export { findLoops, type Loop } from './semantic/loops.js';
export {
  findLoopDominance,
  type LoopDominance,
  type LoopActivitySeries,
} from './runtime/loopDominance.js';

// IR
export type {
  CompiledProgram,
  CompiledExpr,
  Op,
  Polarity,
  Influence,
  FlowInput,
  TimeConfig,
  MapData,
  FlowEffectIR,
  CalcIR,
  StockIR,
  ScenarioIR,
  SweepIR,
  LimitIR,
  CheckIR,
  CheckInputIR,
  CheckOp,
  CheckTemporal,
  ReferenceModeIR,
  CalibrateIR,
  CalibrateParamIR,
} from './ir/program.js';

// Runtime
export type { Solver, StepContext, StepScratch, DerivativeFn } from './runtime/solver.js';
