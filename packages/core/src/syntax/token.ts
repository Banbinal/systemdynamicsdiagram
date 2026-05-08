/**
 * Token definitions for the v2 DSL.
 *
 * The lexer (added in PR 2) emits a stream of these. Indentation is significant:
 * virtual INDENT / DEDENT / NEWLINE tokens are emitted by the lexer itself.
 */

import type { SourceRange } from '../diagnostics/source.js';

export const enum TokenKind {
  // Structure
  Newline = 'NEWLINE',
  Indent = 'INDENT',
  Dedent = 'DEDENT',
  Eof = 'EOF',

  // Literals & identifiers
  Number = 'NUMBER',
  Ident = 'IDENT',

  // Punctuation
  LParen = 'LPAREN',
  RParen = 'RPAREN',
  LBracket = 'LBRACKET',
  RBracket = 'RBRACKET',
  Comma = 'COMMA',
  Dot = 'DOT',
  Colon = 'COLON',
  Eq = 'EQ',

  // Operators
  Plus = 'PLUS',
  Minus = 'MINUS',
  Star = 'STAR',
  Slash = 'SLASH',
  Percent = 'PERCENT',
  Caret = 'CARET',
  Bang = 'BANG',
  Lt = 'LT',
  LtEq = 'LT_EQ',
  Gt = 'GT',
  GtEq = 'GT_EQ',
  EqEq = 'EQ_EQ',
  BangEq = 'BANG_EQ',
  AmpAmp = 'AMP_AMP',
  PipePipe = 'PIPE_PIPE',

  // Flow polarities (atomic, not built from Minus + Gt)
  ArrowNeg = 'ARROW_NEG', // -->
  ArrowPos = 'ARROW_POS', // -+>

  // Keywords (statement-introducing words)
  KwConstant = 'KW_CONSTANT',
  KwStock = 'KW_STOCK',
  KwCalc = 'KW_CALC',
  KwFlow = 'KW_FLOW',
  KwMap = 'KW_MAP',
  KwModule = 'KW_MODULE',
  KwScenario = 'KW_SCENARIO',
  KwSweep = 'KW_SWEEP',
  KwPlot = 'KW_PLOT',
  KwLimit = 'KW_LIMIT',
  KwTitle = 'KW_TITLE',
  // Reality Check
  KwCheck = 'KW_CHECK',
  KwWhen = 'KW_WHEN',
  KwThen = 'KW_THEN',
  KwAlways = 'KW_ALWAYS',
  KwAt = 'KW_AT',
  // Boundary marker — `exogenous constant X = ...` flags inputs that come
  // from outside the modelled system (per Sterman's boundary diagram).
  KwExogenous = 'KW_EXOGENOUS',
  // Reference mode — `reference <Stock>: (t, v) (t, v) ...` declares the
  // expected/observed behaviour the model should reproduce.
  KwReference = 'KW_REFERENCE',
  // Calibration — `calibrate: bounds <C> = [low, high]` fits constants
  // against the model's reference modes via Nelder-Mead.
  KwCalibrate = 'KW_CALIBRATE',
  KwBounds = 'KW_BOUNDS',
  // Time configuration words. Treated as keywords because they introduce
  // statements (e.g. `StartTime = 0`) and must not collide with user identifiers.
  KwStartTime = 'KW_START_TIME',
  KwEndTime = 'KW_END_TIME',
  KwTimeStep = 'KW_TIME_STEP',
}

/**
 * Map of keyword text → TokenKind. Built-in functions (smooth, delay3, step,
 * pulse, min, max, abs, sqrt, etc.) and map interpolation tags (linear, step,
 * spline) are NOT keywords — they are plain identifiers, disambiguated by the
 * parser based on context.
 */
export const KEYWORDS: ReadonlyMap<string, TokenKind> = new Map([
  ['constant', TokenKind.KwConstant],
  ['stock', TokenKind.KwStock],
  ['calc', TokenKind.KwCalc],
  ['flow', TokenKind.KwFlow],
  ['map', TokenKind.KwMap],
  ['module', TokenKind.KwModule],
  ['scenario', TokenKind.KwScenario],
  ['sweep', TokenKind.KwSweep],
  ['plot', TokenKind.KwPlot],
  ['limit', TokenKind.KwLimit],
  ['title', TokenKind.KwTitle],
  ['StartTime', TokenKind.KwStartTime],
  ['EndTime', TokenKind.KwEndTime],
  ['TimeStep', TokenKind.KwTimeStep],
  ['check', TokenKind.KwCheck],
  ['when', TokenKind.KwWhen],
  ['then', TokenKind.KwThen],
  ['always', TokenKind.KwAlways],
  ['at', TokenKind.KwAt],
  ['exogenous', TokenKind.KwExogenous],
  ['reference', TokenKind.KwReference],
  ['calibrate', TokenKind.KwCalibrate],
  ['bounds', TokenKind.KwBounds],
]);

export interface Token {
  readonly kind: TokenKind;
  readonly range: SourceRange;
  /** The verbatim source text (for IDENT/NUMBER) or the matched keyword spelling. */
  readonly text: string;
  /** Pre-parsed numeric value when kind === NUMBER. */
  readonly value?: number;
}

/**
 * Reserved identifiers — in the resolver these resolve to runtime built-ins.
 * Listed here so the lexer doesn't tokenize them as keywords (they remain `Ident`).
 */
export const RESERVED_IDENTIFIERS = new Set<string>([
  'time',
  'smooth',
  'delay3',
  'pulse',
  'abs',
  'sqrt',
  'exp',
  'log',
  'log10',
  'sin',
  'cos',
  'tan',
  'pow',
]);
