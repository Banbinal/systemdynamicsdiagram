/**
 * Recursive-descent parser for the v2 DSL.
 *
 * Statements: top-down. Expressions: Pratt with binding-power table.
 *
 * Stable error codes:
 *   SD0020  unexpected token at top level
 *   SD0021  expected token kind X, got Y
 *   SD0022  expected expression
 *   SD0023  invalid override target (must be `constant` or `stock`)
 *   SD0024  invalid map interpolation tag
 *   SD0025  empty sweep value list
 *   SD0026  flow body must contain at least one effect
 *   SD0027  map body must contain at least two points
 *   SD0028  module body cannot be empty
 *   SD0029  scenario body cannot be empty
 *   SD0030  duplicate `min`/`max` in limit directive
 */

import type { Diagnostic, Severity } from '../diagnostics/diagnostic.js';
import type { Position, SourceRange } from '../diagnostics/source.js';
import type {
  BinaryExpr,
  BinaryOp,
  CalcStmt,
  CallExpr,
  CheckInput,
  CheckOp,
  CheckStmt,
  CheckTemporal,
  ConstantStmt,
  Expr,
  FlowEffect,
  FlowPolarity,
  FlowStmt,
  LimitStmt,
  MapInterpolation,
  MapPoint,
  MapStmt,
  ModuleStmt,
  NumberLit,
  PlotStmt,
  Program,
  QualifiedRef,
  RefExpr,
  CalibrateStmt,
  CalibrationParam,
  ReferencePoint,
  ReferenceStmt,
  ScenarioOverride,
  ScenarioStmt,
  Stmt,
  StockStmt,
  SweepStmt,
  TimeConfigKey,
  TimeConfigStmt,
  TitleStmt,
  UnaryExpr,
  UnaryOp,
} from './ast.js';
import { TokenKind, type Token } from './token.js';

export interface ParseTokensResult {
  readonly ast: Program;
  readonly diagnostics: readonly Diagnostic[];
}

export function parseTokens(tokens: readonly Token[]): ParseTokensResult {
  return new Parser(tokens).parse();
}

// ──────────────────────────────────────────────────────────────────────────────
// Operator binding-power tables

const BIN_PREC: Partial<Record<TokenKind, { op: BinaryOp; prec: number; rightAssoc: boolean }>> = {
  [TokenKind.PipePipe]: { op: '||', prec: 1, rightAssoc: false },
  [TokenKind.AmpAmp]: { op: '&&', prec: 2, rightAssoc: false },
  [TokenKind.Lt]: { op: '<', prec: 3, rightAssoc: false },
  [TokenKind.LtEq]: { op: '<=', prec: 3, rightAssoc: false },
  [TokenKind.Gt]: { op: '>', prec: 3, rightAssoc: false },
  [TokenKind.GtEq]: { op: '>=', prec: 3, rightAssoc: false },
  [TokenKind.EqEq]: { op: '==', prec: 3, rightAssoc: false },
  [TokenKind.BangEq]: { op: '!=', prec: 3, rightAssoc: false },
  [TokenKind.Plus]: { op: '+', prec: 4, rightAssoc: false },
  [TokenKind.Minus]: { op: '-', prec: 4, rightAssoc: false },
  [TokenKind.Star]: { op: '*', prec: 5, rightAssoc: false },
  [TokenKind.Slash]: { op: '/', prec: 5, rightAssoc: false },
  [TokenKind.Percent]: { op: '%', prec: 5, rightAssoc: false },
  // Unary prefix ops live at prec 6 (handled separately)
  [TokenKind.Caret]: { op: '^', prec: 7, rightAssoc: true },
};

// ──────────────────────────────────────────────────────────────────────────────
// Parser

class Parser {
  private pos = 0;
  private readonly tokens: readonly Token[];
  private readonly diagnostics: Diagnostic[] = [];

  constructor(tokens: readonly Token[]) {
    this.tokens = tokens;
  }

  parse(): ParseTokensResult {
    const startPos = this.peek().range.start;
    const body: Stmt[] = [];

    while (!this.isAtEnd()) {
      // Skip stray structural tokens at top level. INDENT/DEDENT can leak
      // here when an inner statement fails recovery; rather than loop on
      // them (which would burn the heap), treat them as no-ops.
      const k = this.peek().kind;
      if (k === TokenKind.Newline || k === TokenKind.Indent || k === TokenKind.Dedent) {
        this.advance();
        continue;
      }
      const stmt = this.parseTopStmt();
      if (stmt) body.push(stmt);
    }

    const endPos = this.previous()?.range.end ?? startPos;
    const ast: Program = {
      kind: 'Program',
      body,
      range: { start: startPos, end: endPos },
    };
    return { ast, diagnostics: this.diagnostics };
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Top-level statement dispatch

  private parseTopStmt(): Stmt | null {
    const tok = this.peek();
    switch (tok.kind) {
      case TokenKind.KwTitle: return this.parseTitle();
      case TokenKind.KwStartTime:
      case TokenKind.KwEndTime:
      case TokenKind.KwTimeStep:
        return this.parseTimeConfig();
      case TokenKind.KwConstant: return this.parseConstant(false);
      case TokenKind.KwExogenous: return this.parseExogenousConstant();
      case TokenKind.KwStock: return this.parseStock();
      case TokenKind.KwCalc: return this.parseCalc();
      case TokenKind.KwFlow: return this.parseFlow();
      case TokenKind.KwMap: return this.parseMap();
      case TokenKind.KwModule: return this.parseModule();
      case TokenKind.KwScenario: return this.parseScenario();
      case TokenKind.KwSweep: return this.parseSweep();
      case TokenKind.KwPlot: return this.parsePlot();
      case TokenKind.KwLimit: return this.parseLimit();
      case TokenKind.KwCheck: return this.parseCheck();
      case TokenKind.KwReference: return this.parseReference();
      case TokenKind.KwCalibrate: return this.parseCalibrate();
      default: {
        this.diag('error', 'SD0020', `Unexpected token '${tok.text}' at top level.`, tok.range);
        this.recoverToNewline();
        return null;
      }
    }
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Simple statements

  private parseTimeConfig(): TimeConfigStmt | null {
    const kw = this.advance();
    const key: TimeConfigKey =
      kw.kind === TokenKind.KwStartTime ? 'StartTime'
      : kw.kind === TokenKind.KwEndTime ? 'EndTime'
      : 'TimeStep';
    if (!this.expect(TokenKind.Eq)) {
      this.recoverToNewline();
      return null;
    }
    const num = this.expect(TokenKind.Number);
    if (!num) {
      this.recoverToNewline();
      return null;
    }
    this.consumeNewline();
    return {
      kind: 'TimeConfig',
      key,
      value: num.value!,
      range: { start: kw.range.start, end: num.range.end },
    };
  }

  /**
   * Title: collect every token after `title` up to NEWLINE, then join their
   * source text with single spaces. Cheap heuristic that produces readable
   * titles without introducing a string literal token.
   */
  private parseTitle(): TitleStmt | null {
    const kw = this.advance(); // title
    const parts: string[] = [];
    let last: Token = kw;
    while (this.peek().kind !== TokenKind.Newline && !this.isAtEnd()) {
      const t = this.advance();
      parts.push(t.text);
      last = t;
    }
    this.consumeNewline();
    return {
      kind: 'Title',
      text: parts.join(' '),
      range: { start: kw.range.start, end: last.range.end },
    };
  }

  private parseConstant(exogenous: boolean): ConstantStmt | null {
    const kw = this.advance();
    const name = this.expect(TokenKind.Ident);
    if (!name) {
      this.recoverToNewline();
      return null;
    }
    if (!this.expect(TokenKind.Eq)) {
      this.recoverToNewline();
      return null;
    }
    const expr = this.parseExpression();
    if (!expr) {
      this.recoverToNewline();
      return null;
    }
    this.consumeNewline();
    return exogenous
      ? {
          kind: 'Constant',
          name: name.text,
          expr,
          exogenous: true,
          range: { start: kw.range.start, end: expr.range.end },
        }
      : {
          kind: 'Constant',
          name: name.text,
          expr,
          range: { start: kw.range.start, end: expr.range.end },
        };
  }

  /** `exogenous constant <Name> = <expr>` — boundary-marker prefix. */
  private parseExogenousConstant(): ConstantStmt | null {
    const exoKw = this.advance(); // 'exogenous'
    if (this.peek().kind !== TokenKind.KwConstant) {
      this.diag(
        'error',
        'SD0038',
        `'exogenous' must be followed by 'constant'.`,
        exoKw.range,
      );
      this.recoverToNewline();
      return null;
    }
    return this.parseConstant(true);
  }

  private parseStock(): StockStmt | null {
    const kw = this.advance();
    const name = this.expect(TokenKind.Ident);
    if (!name) { this.recoverToNewline(); return null; }
    if (!this.expect(TokenKind.Eq)) { this.recoverToNewline(); return null; }
    const init = this.parseExpression();
    if (!init) { this.recoverToNewline(); return null; }
    this.consumeNewline();
    return {
      kind: 'Stock',
      name: name.text,
      init,
      range: { start: kw.range.start, end: init.range.end },
    };
  }

  private parseCalc(): CalcStmt | null {
    const kw = this.advance();
    const name = this.expect(TokenKind.Ident);
    if (!name) { this.recoverToNewline(); return null; }
    if (!this.expect(TokenKind.Eq)) { this.recoverToNewline(); return null; }
    const expr = this.parseExpression();
    if (!expr) { this.recoverToNewline(); return null; }
    this.consumeNewline();
    return {
      kind: 'Calc',
      name: name.text,
      expr,
      range: { start: kw.range.start, end: expr.range.end },
    };
  }

  private parsePlot(): PlotStmt | null {
    const kw = this.advance();
    const target = this.parseQualifiedRef();
    if (!target) { this.recoverToNewline(); return null; }
    this.consumeNewline();
    return {
      kind: 'Plot',
      target,
      range: { start: kw.range.start, end: target.range.end },
    };
  }

  /**
   * `limit Foo min=0 max=100` — both clauses optional but at least one required.
   */
  private parseLimit(): LimitStmt | null {
    const kw = this.advance();
    const target = this.parseQualifiedRef();
    if (!target) { this.recoverToNewline(); return null; }

    let min: number | undefined;
    let max: number | undefined;
    let endRange = target.range.end;

    while (this.peek().kind === TokenKind.Ident) {
      const word = this.advance();
      if (word.text !== 'min' && word.text !== 'max') {
        this.diag('error', 'SD0020', `Expected 'min' or 'max', got '${word.text}'.`, word.range);
        this.recoverToNewline();
        return null;
      }
      if (!this.expect(TokenKind.Eq)) { this.recoverToNewline(); return null; }
      const numTok = this.maybeSignedNumber();
      if (!numTok) { this.recoverToNewline(); return null; }
      if (word.text === 'min') {
        if (min !== undefined) {
          this.diag('error', 'SD0030', 'Duplicate `min` in limit directive.', word.range);
        }
        min = numTok.value;
      } else {
        if (max !== undefined) {
          this.diag('error', 'SD0030', 'Duplicate `max` in limit directive.', word.range);
        }
        max = numTok.value;
      }
      endRange = numTok.range.end;
    }

    if (min === undefined && max === undefined) {
      this.diag(
        'error',
        'SD0021',
        `Limit directive for '${qualifiedName(target)}' must specify at least one of min/max.`,
        kw.range,
      );
    }

    this.consumeNewline();
    const node: LimitStmt = {
      kind: 'Limit',
      target,
      range: { start: kw.range.start, end: endRange },
      ...(min !== undefined ? { min } : {}),
      ...(max !== undefined ? { max } : {}),
    };
    return node;
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Sweep: `sweep <ref> = [number, number, ...]`

  private parseSweep(): SweepStmt | null {
    const kw = this.advance();
    const target = this.parseQualifiedRef();
    if (!target) { this.recoverToNewline(); return null; }
    if (!this.expect(TokenKind.Eq)) { this.recoverToNewline(); return null; }
    if (!this.expect(TokenKind.LBracket)) { this.recoverToNewline(); return null; }

    const values: number[] = [];
    if (this.peek().kind !== TokenKind.RBracket) {
      do {
        const numTok = this.maybeSignedNumber();
        if (!numTok) { this.recoverToNewline(); return null; }
        values.push(numTok.value);
      } while (this.consume(TokenKind.Comma));
    }
    const close = this.expect(TokenKind.RBracket);
    if (!close) { this.recoverToNewline(); return null; }

    if (values.length === 0) {
      this.diag('error', 'SD0025', 'Sweep value list cannot be empty.', kw.range);
    }

    this.consumeNewline();
    return {
      kind: 'Sweep',
      target,
      values,
      range: { start: kw.range.start, end: close.range.end },
    };
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Block statements: flow, map, module, scenario

  private parseFlow(): FlowStmt | null {
    const kw = this.advance();
    const name = this.expect(TokenKind.Ident);
    if (!name) { this.recoverToNewline(); return null; }
    if (!this.expect(TokenKind.Colon)) { this.recoverToNewline(); return null; }
    if (!this.consumeNewline()) { return null; }
    if (!this.expect(TokenKind.Indent)) { this.recoverToDedent(); return null; }

    const effects: FlowEffect[] = [];
    while (this.peek().kind !== TokenKind.Dedent && !this.isAtEnd()) {
      const eff = this.parseFlowEffect();
      if (eff) effects.push(eff);
    }
    const close = this.expect(TokenKind.Dedent);
    if (effects.length === 0) {
      this.diag('error', 'SD0026', `Flow '${name.text}' must contain at least one effect.`, kw.range);
    }

    return {
      kind: 'Flow',
      name: name.text,
      effects,
      range: { start: kw.range.start, end: close?.range.end ?? this.previous().range.end },
    };
  }

  private parseFlowEffect(): FlowEffect | null {
    const expr = this.parseExpression();
    if (!expr) { this.recoverToNewline(); return null; }

    const arrowTok = this.peek();
    let polarity: FlowPolarity;
    if (arrowTok.kind === TokenKind.ArrowPos) {
      polarity = 'positive';
      this.advance();
    } else if (arrowTok.kind === TokenKind.ArrowNeg) {
      polarity = 'negative';
      this.advance();
    } else {
      this.diag(
        'error',
        'SD0021',
        `Expected flow polarity arrow ('-+>' or '-->'), got '${arrowTok.text}'.`,
        arrowTok.range,
      );
      this.recoverToNewline();
      return null;
    }

    const target = this.parseQualifiedRef();
    if (!target) { this.recoverToNewline(); return null; }
    this.consumeNewline();

    return {
      expr,
      polarity,
      target,
      range: { start: expr.range.start, end: target.range.end },
    };
  }

  private parseMap(): MapStmt | null {
    const kw = this.advance();
    const name = this.expect(TokenKind.Ident);
    if (!name) { this.recoverToNewline(); return null; }
    if (!this.expect(TokenKind.Colon)) { this.recoverToNewline(); return null; }

    const tagTok = this.expect(TokenKind.Ident);
    if (!tagTok) { this.recoverToNewline(); return null; }
    let interpolation: MapInterpolation;
    if (tagTok.text === 'linear' || tagTok.text === 'step' || tagTok.text === 'spline') {
      interpolation = tagTok.text;
    } else {
      this.diag(
        'error',
        'SD0024',
        `Invalid map interpolation '${tagTok.text}': expected 'linear', 'step', or 'spline'.`,
        tagTok.range,
      );
      this.recoverPastBlock();
      return null;
    }

    if (!this.consumeNewline()) return null;
    if (!this.expect(TokenKind.Indent)) { this.recoverToDedent(); return null; }

    const points: MapPoint[] = [];
    while (this.peek().kind !== TokenKind.Dedent && !this.isAtEnd()) {
      const pt = this.parseMapPoint();
      if (pt) points.push(pt);
    }
    const close = this.expect(TokenKind.Dedent);

    if (points.length < 2) {
      this.diag('error', 'SD0027', `Map '${name.text}' must define at least 2 points.`, kw.range);
    }

    return {
      kind: 'Map',
      name: name.text,
      interpolation,
      points,
      range: { start: kw.range.start, end: close?.range.end ?? this.previous().range.end },
    };
  }

  private parseMapPoint(): MapPoint | null {
    const open = this.expect(TokenKind.LParen);
    if (!open) { this.recoverToNewline(); return null; }
    const x = this.maybeSignedNumber();
    if (!x) { this.recoverToNewline(); return null; }
    if (!this.expect(TokenKind.Comma)) { this.recoverToNewline(); return null; }
    const y = this.maybeSignedNumber();
    if (!y) { this.recoverToNewline(); return null; }
    const close = this.expect(TokenKind.RParen);
    if (!close) { this.recoverToNewline(); return null; }
    this.consumeNewline();
    return {
      x: x.value,
      y: y.value,
      range: { start: open.range.start, end: close.range.end },
    };
  }

  private parseCalibrate(): CalibrateStmt | null {
    const kw = this.advance(); // 'calibrate'
    if (!this.expect(TokenKind.Colon)) { this.recoverToNewline(); return null; }
    if (!this.consumeNewline()) return null;
    if (!this.expect(TokenKind.Indent)) { this.recoverToDedent(); return null; }

    const params: CalibrationParam[] = [];
    while (this.peek().kind !== TokenKind.Dedent && !this.isAtEnd()) {
      const t = this.peek();
      if (t.kind === TokenKind.Newline) { this.advance(); continue; }
      if (t.kind !== TokenKind.KwBounds) {
        this.diag(
          'error',
          'SD0044',
          `Expected 'bounds <Constant> = [low, high]' inside calibrate, got '${t.text}'.`,
          t.range,
        );
        this.recoverToNewline();
        continue;
      }
      const p = this.parseCalibrationParam();
      if (p) params.push(p);
    }
    const close = this.expect(TokenKind.Dedent);

    if (params.length === 0) {
      this.diag(
        'error',
        'SD0045',
        `Calibrate block must declare at least one 'bounds' parameter.`,
        kw.range,
      );
      return null;
    }

    return {
      kind: 'Calibrate',
      params,
      range: { start: kw.range.start, end: close?.range.end ?? this.previous().range.end },
    };
  }

  private parseCalibrationParam(): CalibrationParam | null {
    const kw = this.advance(); // 'bounds'
    const target = this.parseQualifiedRef();
    if (!target) { this.recoverToNewline(); return null; }
    if (!this.expect(TokenKind.Eq)) { this.recoverToNewline(); return null; }
    if (!this.expect(TokenKind.LBracket)) { this.recoverToNewline(); return null; }
    const low = this.maybeSignedNumber();
    if (!low) { this.recoverToNewline(); return null; }
    if (!this.expect(TokenKind.Comma)) { this.recoverToNewline(); return null; }
    const high = this.maybeSignedNumber();
    if (!high) { this.recoverToNewline(); return null; }
    const close = this.expect(TokenKind.RBracket);
    if (!close) { this.recoverToNewline(); return null; }
    if (low.value > high.value) {
      this.diag(
        'error',
        'SD0046',
        `bounds low (${low.value}) must be ≤ high (${high.value}).`,
        kw.range,
      );
    }
    this.consumeNewline();
    return {
      target,
      low: low.value,
      high: high.value,
      range: { start: kw.range.start, end: close.range.end },
    };
  }

  private parseReference(): ReferenceStmt | null {
    const kw = this.advance(); // 'reference'
    const target = this.parseQualifiedRef();
    if (!target) { this.recoverToNewline(); return null; }
    if (!this.expect(TokenKind.Colon)) { this.recoverToNewline(); return null; }
    if (!this.consumeNewline()) return null;
    if (!this.expect(TokenKind.Indent)) { this.recoverToDedent(); return null; }

    const points: ReferencePoint[] = [];
    while (this.peek().kind !== TokenKind.Dedent && !this.isAtEnd()) {
      if (this.peek().kind === TokenKind.Newline) { this.advance(); continue; }
      const pt = this.parseReferencePoint();
      if (pt) points.push(pt);
    }
    const close = this.expect(TokenKind.Dedent);

    if (points.length < 2) {
      this.diag(
        'error',
        'SD0039',
        `Reference mode for '${target.path.join('.')}' must have at least two points.`,
        kw.range,
      );
    }

    return {
      kind: 'Reference',
      target,
      points,
      range: { start: kw.range.start, end: close?.range.end ?? this.previous().range.end },
    };
  }

  private parseReferencePoint(): ReferencePoint | null {
    const open = this.expect(TokenKind.LParen);
    if (!open) { this.recoverToNewline(); return null; }
    const t = this.maybeSignedNumber();
    if (!t) { this.recoverToNewline(); return null; }
    if (!this.expect(TokenKind.Comma)) { this.recoverToNewline(); return null; }
    const v = this.maybeSignedNumber();
    if (!v) { this.recoverToNewline(); return null; }
    const close = this.expect(TokenKind.RParen);
    if (!close) { this.recoverToNewline(); return null; }
    this.consumeNewline();
    return {
      t: t.value,
      v: v.value,
      range: { start: open.range.start, end: close.range.end },
    };
  }

  private parseModule(): ModuleStmt | null {
    const kw = this.advance();
    const name = this.expect(TokenKind.Ident);
    if (!name) { this.recoverToNewline(); return null; }
    if (!this.expect(TokenKind.Colon)) { this.recoverToNewline(); return null; }
    if (!this.consumeNewline()) return null;
    if (!this.expect(TokenKind.Indent)) { this.recoverToDedent(); return null; }

    const body: Stmt[] = [];
    while (this.peek().kind !== TokenKind.Dedent && !this.isAtEnd()) {
      // Skip stray NEWLINEs inside module body
      if (this.peek().kind === TokenKind.Newline) { this.advance(); continue; }
      const s = this.parseTopStmt();
      if (s) body.push(s);
    }
    const close = this.expect(TokenKind.Dedent);

    if (body.length === 0) {
      this.diag('error', 'SD0028', `Module '${name.text}' body cannot be empty.`, kw.range);
    }

    return {
      kind: 'Module',
      name: name.text,
      body,
      range: { start: kw.range.start, end: close?.range.end ?? this.previous().range.end },
    };
  }

  private parseScenario(): ScenarioStmt | null {
    const kw = this.advance();
    const name = this.expect(TokenKind.Ident);
    if (!name) { this.recoverToNewline(); return null; }
    if (!this.expect(TokenKind.Colon)) { this.recoverToNewline(); return null; }
    if (!this.consumeNewline()) return null;
    if (!this.expect(TokenKind.Indent)) { this.recoverToDedent(); return null; }

    const overrides: ScenarioOverride[] = [];
    while (this.peek().kind !== TokenKind.Dedent && !this.isAtEnd()) {
      if (this.peek().kind === TokenKind.Newline) { this.advance(); continue; }
      const ov = this.parseScenarioOverride();
      if (ov) overrides.push(ov);
    }
    const close = this.expect(TokenKind.Dedent);

    if (overrides.length === 0) {
      this.diag('error', 'SD0029', `Scenario '${name.text}' body cannot be empty.`, kw.range);
    }

    return {
      kind: 'Scenario',
      name: name.text,
      overrides,
      range: { start: kw.range.start, end: close?.range.end ?? this.previous().range.end },
    };
  }

  private parseCheck(): CheckStmt | null {
    const kw = this.advance();
    const name = this.expect(TokenKind.Ident);
    if (!name) { this.recoverToNewline(); return null; }
    if (!this.expect(TokenKind.Colon)) { this.recoverToNewline(); return null; }
    if (!this.consumeNewline()) return null;
    if (!this.expect(TokenKind.Indent)) { this.recoverToDedent(); return null; }

    const inputs: CheckInput[] = [];
    let assertion: { lhs: Expr; op: CheckOp; rhs: Expr; temporal: CheckTemporal; range: SourceRange } | null = null;

    while (this.peek().kind !== TokenKind.Dedent && !this.isAtEnd()) {
      const t = this.peek();
      if (t.kind === TokenKind.Newline) { this.advance(); continue; }
      if (t.kind === TokenKind.KwWhen) {
        const inp = this.parseCheckInput();
        if (inp) inputs.push(inp);
      } else if (t.kind === TokenKind.KwThen) {
        const a = this.parseCheckAssertion();
        if (a) {
          if (assertion) {
            this.diag('error', 'SD0034', `Check '${name.text}' has multiple 'then' clauses; only one is allowed.`, a.range);
          } else {
            assertion = a;
          }
        }
      } else {
        this.diag('error', 'SD0033', `Expected 'when' or 'then' inside check, got '${t.text}'.`, t.range);
        this.recoverToNewline();
      }
    }
    const close = this.expect(TokenKind.Dedent);

    if (!assertion) {
      this.diag('error', 'SD0035', `Check '${name.text}' must have exactly one 'then' clause.`, kw.range);
      return null;
    }

    return {
      kind: 'Check',
      name: name.text,
      inputs,
      lhs: assertion.lhs,
      op: assertion.op,
      rhs: assertion.rhs,
      temporal: assertion.temporal,
      range: { start: kw.range.start, end: close?.range.end ?? this.previous().range.end },
    };
  }

  private parseCheckInput(): CheckInput | null {
    const kw = this.advance(); // 'when'
    const target = this.parseQualifiedRef();
    if (!target) { this.recoverToNewline(); return null; }
    if (!this.expect(TokenKind.Eq)) { this.recoverToNewline(); return null; }
    const expr = this.parseExpression();
    if (!expr) { this.recoverToNewline(); return null; }
    this.consumeNewline();
    return {
      target,
      expr,
      range: { start: kw.range.start, end: expr.range.end },
    };
  }

  private parseCheckAssertion(): {
    lhs: Expr;
    op: CheckOp;
    rhs: Expr;
    temporal: CheckTemporal;
    range: SourceRange;
  } | null {
    const kw = this.advance(); // 'then'
    // Use min-prec 4 to skip comparison operators — the assertion's own
    // comparison operator is parsed explicitly below, not as part of `lhs`.
    const lhs = this.parseExprBP(4);
    if (!lhs) { this.recoverToNewline(); return null; }
    const opTok = this.peek();
    let op: CheckOp;
    switch (opTok.kind) {
      case TokenKind.GtEq: op = '>='; break;
      case TokenKind.LtEq: op = '<='; break;
      case TokenKind.Gt: op = '>'; break;
      case TokenKind.Lt: op = '<'; break;
      case TokenKind.EqEq: op = '=='; break;
      case TokenKind.BangEq: op = '!='; break;
      default:
        this.diag('error', 'SD0036', `Expected comparison operator (>=, <=, >, <, ==, !=) in check assertion, got '${opTok.text}'.`, opTok.range);
        this.recoverToNewline();
        return null;
    }
    this.advance();
    // Same trick: rhs must not consume comparison operators (none follow,
    // but be consistent and bail at the temporal keyword).
    const rhs = this.parseExprBP(4);
    if (!rhs) { this.recoverToNewline(); return null; }

    // Temporal qualifier: 'always' or 'at t = <num>'.
    const tempTok = this.peek();
    let temporal: CheckTemporal;
    let endRange = rhs.range;
    if (tempTok.kind === TokenKind.KwAlways) {
      this.advance();
      temporal = { kind: 'always' };
      endRange = tempTok.range;
    } else if (tempTok.kind === TokenKind.KwAt) {
      this.advance();
      // Optionally consume identifier 't' or '=' shape: `at t = <num>`.
      // We accept either bare `at <num>` or `at t = <num>` for ergonomics.
      let tValue: number | null = null;
      if (this.peek().kind === TokenKind.Ident && this.peek().text === 't') {
        this.advance();
        if (!this.expect(TokenKind.Eq)) { this.recoverToNewline(); return null; }
      }
      const num = this.maybeSignedNumber();
      if (!num) { this.recoverToNewline(); return null; }
      tValue = num.value;
      temporal = { kind: 'at', t: tValue };
      endRange = num.range;
    } else {
      this.diag('error', 'SD0037', `Expected temporal qualifier ('always' or 'at t = <num>') after assertion, got '${tempTok.text}'.`, tempTok.range);
      this.recoverToNewline();
      return null;
    }
    this.consumeNewline();
    return {
      lhs,
      op,
      rhs,
      temporal,
      range: { start: kw.range.start, end: endRange.end },
    };
  }

  private parseScenarioOverride(): ScenarioOverride | null {
    const tok = this.peek();
    if (tok.kind !== TokenKind.KwConstant && tok.kind !== TokenKind.KwStock) {
      this.diag(
        'error',
        'SD0023',
        `Override target must be 'constant' or 'stock', got '${tok.text}'.`,
        tok.range,
      );
      this.recoverToNewline();
      return null;
    }
    this.advance();
    const targetKind = tok.kind === TokenKind.KwConstant ? 'constant' : 'stock';
    const target = this.parseQualifiedRef();
    if (!target) { this.recoverToNewline(); return null; }
    if (!this.expect(TokenKind.Eq)) { this.recoverToNewline(); return null; }
    const expr = this.parseExpression();
    if (!expr) { this.recoverToNewline(); return null; }
    this.consumeNewline();
    return {
      targetKind,
      target,
      expr,
      range: { start: tok.range.start, end: expr.range.end },
    };
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Qualified references and helpers

  private parseQualifiedRef(): QualifiedRef | null {
    const first = this.expect(TokenKind.Ident);
    if (!first) return null;
    const path = [first.text];
    let last: Token = first;
    while (this.consume(TokenKind.Dot)) {
      const next = this.expect(TokenKind.Ident);
      if (!next) return null;
      path.push(next.text);
      last = next;
    }
    return {
      path,
      range: { start: first.range.start, end: last.range.end },
    };
  }

  /** Accept a number, optionally preceded by a unary `+` or `-` sign. */
  private maybeSignedNumber(): { value: number; range: SourceRange } | null {
    const t = this.peek();
    if (t.kind === TokenKind.Plus || t.kind === TokenKind.Minus) {
      this.advance();
      const num = this.expect(TokenKind.Number);
      if (!num) return null;
      const v = t.kind === TokenKind.Minus ? -num.value! : num.value!;
      return { value: v, range: { start: t.range.start, end: num.range.end } };
    }
    if (t.kind === TokenKind.Number) {
      this.advance();
      return { value: t.value!, range: t.range };
    }
    this.diag('error', 'SD0021', `Expected number, got '${t.text}'.`, t.range);
    return null;
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Expressions (Pratt)

  parseExpression(): Expr | null {
    return this.parseExprBP(0);
  }

  private parseExprBP(minPrec: number): Expr | null {
    let left = this.parsePrefix();
    if (!left) return null;

    while (true) {
      const tok = this.peek();
      const info = BIN_PREC[tok.kind];
      if (!info || info.prec < minPrec) break;
      this.advance();
      const nextMin = info.rightAssoc ? info.prec : info.prec + 1;
      const right = this.parseExprBP(nextMin);
      if (!right) return null;
      const node: BinaryExpr = {
        kind: 'Binary',
        op: info.op,
        left,
        right,
        range: { start: left.range.start, end: right.range.end },
      };
      left = node;
    }
    return left;
  }

  private parsePrefix(): Expr | null {
    const tok = this.peek();
    if (tok.kind === TokenKind.Minus || tok.kind === TokenKind.Plus || tok.kind === TokenKind.Bang) {
      this.advance();
      const op: UnaryOp =
        tok.kind === TokenKind.Minus ? '-' : tok.kind === TokenKind.Plus ? '+' : '!';
      const operand = this.parsePrefix();
      if (!operand) return null;
      const node: UnaryExpr = {
        kind: 'Unary',
        op,
        operand,
        range: { start: tok.range.start, end: operand.range.end },
      };
      return node;
    }
    return this.parsePrimary();
  }

  private parsePrimary(): Expr | null {
    const tok = this.peek();

    if (tok.kind === TokenKind.Number) {
      this.advance();
      const node: NumberLit = {
        kind: 'NumberLit',
        value: tok.value!,
        range: tok.range,
      };
      return node;
    }

    if (tok.kind === TokenKind.LParen) {
      this.advance();
      const inner = this.parseExpression();
      if (!inner) return null;
      const close = this.expect(TokenKind.RParen);
      if (!close) return null;
      // Preserve source range to the closing paren
      return { ...inner, range: { start: tok.range.start, end: close.range.end } };
    }

    if (tok.kind === TokenKind.Ident) {
      this.advance();
      // Function call?
      if (this.peek().kind === TokenKind.LParen) {
        this.advance();
        const args: Expr[] = [];
        if (this.peek().kind !== TokenKind.RParen) {
          do {
            const a = this.parseExpression();
            if (!a) return null;
            args.push(a);
          } while (this.consume(TokenKind.Comma));
        }
        const close = this.expect(TokenKind.RParen);
        if (!close) return null;
        const node: CallExpr = {
          kind: 'Call',
          callee: tok.text,
          args,
          range: { start: tok.range.start, end: close.range.end },
        };
        return node;
      }
      // Dotted reference
      const path = [tok.text];
      let last: Token = tok;
      while (this.consume(TokenKind.Dot)) {
        const next = this.expect(TokenKind.Ident);
        if (!next) return null;
        path.push(next.text);
        last = next;
      }
      const node: RefExpr = {
        kind: 'Ref',
        path,
        range: { start: tok.range.start, end: last.range.end },
      };
      return node;
    }

    this.diag('error', 'SD0022', `Expected expression, got '${tok.text}'.`, tok.range);
    return null;
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Token cursor helpers

  private peek(offset = 0): Token {
    return this.tokens[this.pos + offset] ?? this.eof();
  }

  private previous(): Token {
    return this.tokens[this.pos - 1] ?? this.eof();
  }

  private advance(): Token {
    const t = this.peek();
    if (t.kind !== TokenKind.Eof) this.pos++;
    return t;
  }

  private isAtEnd(): boolean {
    return this.peek().kind === TokenKind.Eof;
  }

  private eof(): Token {
    const last = this.tokens[this.tokens.length - 1];
    return last ?? {
      kind: TokenKind.Eof,
      range: { start: ORIGIN, end: ORIGIN },
      text: '',
    };
  }

  /** Consume `kind` if next; return the token or null. */
  private consume(kind: TokenKind): Token | null {
    if (this.peek().kind === kind) return this.advance();
    return null;
  }

  /** Require `kind`; emit diagnostic if not. */
  private expect(kind: TokenKind): Token | null {
    if (this.peek().kind === kind) return this.advance();
    const t = this.peek();
    this.diag(
      'error',
      'SD0021',
      `Expected ${describeKind(kind)}, got '${t.text || describeKind(t.kind)}'.`,
      t.range,
    );
    return null;
  }

  /** Eat a NEWLINE if present; tolerate EOF / DEDENT (block end). */
  private consumeNewline(): boolean {
    if (this.peek().kind === TokenKind.Newline) {
      this.advance();
      return true;
    }
    if (this.peek().kind === TokenKind.Dedent || this.isAtEnd()) return true;
    const t = this.peek();
    this.diag(
      'error',
      'SD0021',
      `Expected end of line, got '${t.text || describeKind(t.kind)}'.`,
      t.range,
    );
    return false;
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Error recovery

  /** Skip until the next NEWLINE (inclusive) or EOF, so the next statement starts cleanly. */
  private recoverToNewline(): void {
    while (!this.isAtEnd()) {
      const k = this.peek().kind;
      if (k === TokenKind.Newline) { this.advance(); return; }
      if (k === TokenKind.Dedent) return;
      this.advance();
    }
  }

  /** Skip the rest of the current line, then a complete indented block if one starts. */
  private recoverPastBlock(): void {
    this.recoverToNewline();
    if (this.peek().kind === TokenKind.Indent) {
      this.advance();
      this.recoverToDedent();
    }
  }

  /** Skip until the next DEDENT (consuming it), used when a block start fails. */
  private recoverToDedent(): void {
    let depth = 0;
    while (!this.isAtEnd()) {
      const k = this.peek().kind;
      if (k === TokenKind.Indent) depth++;
      if (k === TokenKind.Dedent) {
        if (depth === 0) { this.advance(); return; }
        depth--;
      }
      this.advance();
    }
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Diagnostic helpers

  private diag(severity: Severity, code: string, message: string, range: SourceRange): void {
    this.diagnostics.push({ severity, code, message, range });
  }
}

const ORIGIN: Position = { line: 0, column: 0, offset: 0 };

function qualifiedName(ref: QualifiedRef): string {
  return ref.path.join('.');
}

/** Human-readable description of a token kind for error messages. */
function describeKind(kind: TokenKind): string {
  switch (kind) {
    case TokenKind.Newline: return 'newline';
    case TokenKind.Indent: return 'indent';
    case TokenKind.Dedent: return 'dedent';
    case TokenKind.Eof: return 'end of file';
    case TokenKind.Number: return 'number';
    case TokenKind.Ident: return 'identifier';
    case TokenKind.LParen: return "'('";
    case TokenKind.RParen: return "')'";
    case TokenKind.LBracket: return "'['";
    case TokenKind.RBracket: return "']'";
    case TokenKind.Comma: return "','";
    case TokenKind.Dot: return "'.'";
    case TokenKind.Colon: return "':'";
    case TokenKind.Eq: return "'='";
    case TokenKind.ArrowPos: return "'-+>'";
    case TokenKind.ArrowNeg: return "'-->'";
    default: return kind;
  }
}
