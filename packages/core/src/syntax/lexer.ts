/**
 * Lexer for the v2 System Dynamics DSL.
 *
 * Indentation-significant: emits virtual `INDENT` / `DEDENT` / `NEWLINE` tokens
 * Python-style. Comments (`# ...`) are stripped. Tabs in leading whitespace
 * are an error (v2 mandates spaces). Newlines inside `(...)` or `[...]` are
 * implicitly joined (no NEWLINE emitted, indentation is not tracked).
 *
 * Stable error codes:
 *   SD0010  unexpected character
 *   SD0011  tabs in leading whitespace
 *   SD0012  inconsistent dedent (does not match any prior indent level)
 *   SD0013  unterminated number literal
 *   SD0014  unmatched closing bracket
 *   SD0015  unterminated bracket at end of file
 */

import type { Diagnostic, Severity } from '../diagnostics/diagnostic.js';
import type { Position, SourceRange } from '../diagnostics/source.js';
import { KEYWORDS, TokenKind, type Token } from './token.js';

export interface LexResult {
  readonly tokens: readonly Token[];
  readonly diagnostics: readonly Diagnostic[];
}

export function tokenize(source: string): LexResult {
  return new Lexer(source).run();
}

class Lexer {
  private readonly source: string;
  private readonly tokens: Token[] = [];
  private readonly diagnostics: Diagnostic[] = [];

  private pos = 0;
  private line = 0;
  private column = 0;

  private parenDepth = 0;
  private readonly bracketStack: { open: '(' | '['; pos: Position }[] = [];
  private readonly indentStack: number[] = [0];

  /** True when the lexer is at the start of a logical line (column 0, after newline or BOF). */
  private atLineStart = true;

  constructor(source: string) {
    this.source = source;
  }

  run(): LexResult {
    while (this.pos < this.source.length) {
      if (this.atLineStart && this.parenDepth === 0) {
        this.handleLineStart();
        this.atLineStart = false;
        if (this.pos >= this.source.length) break;
      }

      const ch = this.source[this.pos]!;

      // Mid-line horizontal whitespace
      if (ch === ' ' || ch === '\t') {
        this.advance();
        continue;
      }

      // Line comment to end of line
      if (ch === '#') {
        while (this.pos < this.source.length && this.source[this.pos] !== '\n') {
          this.advance();
        }
        continue;
      }

      // Newline (LF or CRLF)
      if (ch === '\r' || ch === '\n') {
        const nlStart = this.position();
        if (ch === '\r' && this.source[this.pos + 1] === '\n') {
          this.advance(); // CR
        }
        const nlEnd = this.advanceNewline();

        if (this.parenDepth === 0) {
          // Suppress NEWLINE if the last emitted token is also a NEWLINE,
          // INDENT, DEDENT, or there are no tokens yet (skips blank lines).
          if (this.shouldEmitNewline()) {
            this.emit(TokenKind.Newline, nlStart, nlEnd, '\n');
          }
          this.atLineStart = true;
        }
        // Inside brackets, newlines are implicitly joined; indentation
        // tracking pauses until parens close.
        continue;
      }

      // Numbers — check BEFORE operators so `.5` is a NUMBER, not a DOT followed by a NUMBER
      if (this.isDigit(ch) || (ch === '.' && this.isDigit(this.peek(1)))) {
        this.readNumber();
        continue;
      }

      // Operators and punctuation (longest match)
      if (this.tryOperator()) continue;

      // Identifiers / keywords
      if (this.isIdentStart(ch)) {
        this.readIdentOrKeyword();
        continue;
      }

      // Unknown character
      const start = this.position();
      this.advance();
      this.diag('error', 'SD0010', `Unexpected character '${ch}'.`, {
        start,
        end: this.position(),
      });
    }

    this.finalize();
    return { tokens: this.tokens, diagnostics: this.diagnostics };
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Line start: count indent, emit INDENT/DEDENT, skip blank/comment-only lines

  private handleLineStart(): void {
    const startPos = this.position();
    let indent = 0;
    let hasTab = false;

    while (this.pos < this.source.length) {
      const ch = this.source[this.pos];
      if (ch === ' ') {
        indent++;
        this.advance();
      } else if (ch === '\t') {
        hasTab = true;
        indent++; // count tab as 1 column for stack comparison
        this.advance();
      } else {
        break;
      }
    }

    if (this.pos >= this.source.length) return;

    const ch = this.source[this.pos]!;
    // Blank line or comment-only line — no INDENT/DEDENT, no NEWLINE
    if (ch === '\n' || ch === '\r' || ch === '#') return;

    if (hasTab) {
      this.diag(
        'error',
        'SD0011',
        'Indentation must use spaces, not tabs.',
        { start: startPos, end: this.position() },
      );
    }

    const top = this.indentStack[this.indentStack.length - 1]!;
    const here = this.position();
    if (indent > top) {
      this.indentStack.push(indent);
      this.emit(TokenKind.Indent, here, here, '');
    } else if (indent < top) {
      while (this.indentStack[this.indentStack.length - 1]! > indent) {
        this.indentStack.pop();
        this.emit(TokenKind.Dedent, here, here, '');
      }
      const newTop = this.indentStack[this.indentStack.length - 1]!;
      if (newTop !== indent) {
        this.diag(
          'error',
          'SD0012',
          `Inconsistent indentation: dedent to column ${indent} does not match any prior indent level.`,
          { start: startPos, end: here },
        );
      }
    }
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Operator and punctuation matching (longest match)

  private tryOperator(): boolean {
    const ch = this.source[this.pos]!;

    // Three-char polarity arrows -- check before single -
    if (ch === '-') {
      if (this.source.startsWith('-+>', this.pos)) {
        this.emitFixed(TokenKind.ArrowPos, '-+>');
        return true;
      }
      if (this.source.startsWith('-->', this.pos)) {
        this.emitFixed(TokenKind.ArrowNeg, '-->');
        return true;
      }
    }

    // Two-char operators
    if (ch === '<' && this.peek(1) === '=') return this.emitFixed(TokenKind.LtEq, '<=');
    if (ch === '>' && this.peek(1) === '=') return this.emitFixed(TokenKind.GtEq, '>=');
    if (ch === '=' && this.peek(1) === '=') return this.emitFixed(TokenKind.EqEq, '==');
    if (ch === '!' && this.peek(1) === '=') return this.emitFixed(TokenKind.BangEq, '!=');
    if (ch === '&' && this.peek(1) === '&') return this.emitFixed(TokenKind.AmpAmp, '&&');
    if (ch === '|' && this.peek(1) === '|') return this.emitFixed(TokenKind.PipePipe, '||');

    // Single-char operators and punctuation
    switch (ch) {
      case '+': return this.emitFixed(TokenKind.Plus, '+');
      case '-': return this.emitFixed(TokenKind.Minus, '-');
      case '*': return this.emitFixed(TokenKind.Star, '*');
      case '/': return this.emitFixed(TokenKind.Slash, '/');
      case '%': return this.emitFixed(TokenKind.Percent, '%');
      case '^': return this.emitFixed(TokenKind.Caret, '^');
      case '!': return this.emitFixed(TokenKind.Bang, '!');
      case '<': return this.emitFixed(TokenKind.Lt, '<');
      case '>': return this.emitFixed(TokenKind.Gt, '>');
      case '=': return this.emitFixed(TokenKind.Eq, '=');
      case ',': return this.emitFixed(TokenKind.Comma, ',');
      case '.': return this.emitFixed(TokenKind.Dot, '.');
      case ':': return this.emitFixed(TokenKind.Colon, ':');
      case '(': {
        this.openBracket('(');
        return this.emitFixed(TokenKind.LParen, '(');
      }
      case ')': {
        this.closeBracket('(', TokenKind.RParen, ')');
        return true;
      }
      case '[': {
        this.openBracket('[');
        return this.emitFixed(TokenKind.LBracket, '[');
      }
      case ']': {
        this.closeBracket('[', TokenKind.RBracket, ']');
        return true;
      }
      default:
        return false;
    }
  }

  private openBracket(open: '(' | '['): void {
    this.parenDepth++;
    this.bracketStack.push({ open, pos: this.position() });
  }

  private closeBracket(expected: '(' | '[', kind: TokenKind, text: string): void {
    if (this.bracketStack.length === 0) {
      const start = this.position();
      this.advance();
      this.diag('error', 'SD0014', `Unmatched closing '${text}'.`, {
        start,
        end: this.position(),
      });
      return;
    }
    const top = this.bracketStack[this.bracketStack.length - 1]!;
    if (top.open !== expected) {
      const start = this.position();
      this.advance();
      this.diag('error', 'SD0014', `Mismatched closing '${text}': expected '${this.matchingClose(top.open)}'.`, {
        start,
        end: this.position(),
      });
      return;
    }
    this.bracketStack.pop();
    this.parenDepth--;
    this.emitFixed(kind, text);
  }

  private matchingClose(open: '(' | '['): string {
    return open === '(' ? ')' : ']';
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Numbers

  /**
   * Numbers: integer or decimal, optional scientific exponent.
   * Forms: `123`, `1.5`, `.5`, `1e3`, `1.5e-2`, `2E+10`.
   */
  private readNumber(): void {
    const start = this.position();
    let hasDot = false;
    let hasExp = false;

    while (this.pos < this.source.length) {
      const c = this.source[this.pos]!;
      if (this.isDigit(c)) {
        this.advance();
      } else if (c === '.' && !hasDot && !hasExp && this.isDigit(this.peek(1))) {
        hasDot = true;
        this.advance();
      } else if ((c === 'e' || c === 'E') && !hasExp) {
        hasExp = true;
        this.advance();
        if (this.source[this.pos] === '+' || this.source[this.pos] === '-') {
          this.advance();
        }
        if (!this.isDigit(this.source[this.pos])) {
          this.diag(
            'error',
            'SD0013',
            'Unterminated number literal: exponent expects digits.',
            { start, end: this.position() },
          );
          break;
        }
      } else {
        break;
      }
    }

    const end = this.position();
    const text = this.source.slice(start.offset, end.offset);
    const value = Number(text);
    this.tokens.push({
      kind: TokenKind.Number,
      range: { start, end },
      text,
      value,
    });
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Identifiers / keywords

  private readIdentOrKeyword(): void {
    const start = this.position();
    while (this.pos < this.source.length && this.isIdentPart(this.source[this.pos]!)) {
      this.advance();
    }
    const end = this.position();
    const text = this.source.slice(start.offset, end.offset);
    const kw = KEYWORDS.get(text);
    this.tokens.push({
      kind: kw ?? TokenKind.Ident,
      range: { start, end },
      text,
    });
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Finalization (EOF, trailing dedents, unclosed brackets)

  private finalize(): void {
    // Report unclosed brackets
    for (const { open, pos } of this.bracketStack) {
      this.diag(
        'error',
        'SD0015',
        `Unclosed '${open}' at end of file.`,
        { start: pos, end: pos },
      );
    }

    // Synthesize a trailing NEWLINE if the source ended without one and we
    // have some non-whitespace tokens whose final block needs a clean break.
    if (this.shouldEmitNewline()) {
      const here = this.position();
      this.tokens.push({
        kind: TokenKind.Newline,
        range: { start: here, end: here },
        text: '',
      });
    }

    // Emit DEDENTs to close any open blocks
    const here = this.position();
    while (this.indentStack.length > 1) {
      this.indentStack.pop();
      this.tokens.push({
        kind: TokenKind.Dedent,
        range: { start: here, end: here },
        text: '',
      });
    }

    // Emit EOF
    this.tokens.push({
      kind: TokenKind.Eof,
      range: { start: here, end: here },
      text: '',
    });
  }

  private shouldEmitNewline(): boolean {
    if (this.tokens.length === 0) return false;
    const last = this.tokens[this.tokens.length - 1]!;
    return (
      last.kind !== TokenKind.Newline &&
      last.kind !== TokenKind.Indent &&
      last.kind !== TokenKind.Dedent
    );
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Low-level helpers

  private position(): Position {
    return { line: this.line, column: this.column, offset: this.pos };
  }

  private peek(n: number): string | undefined {
    return this.source[this.pos + n];
  }

  /** Advance one character, updating line/column. Caller handles newlines via `advanceNewline`. */
  private advance(): void {
    this.pos++;
    this.column++;
  }

  /** Consume the LF at current position, returning the new position. */
  private advanceNewline(): Position {
    this.pos++;
    this.line++;
    this.column = 0;
    return this.position();
  }

  private emit(kind: TokenKind, start: Position, end: Position, text: string, value?: number): void {
    const range: SourceRange = { start, end };
    if (value === undefined) {
      this.tokens.push({ kind, range, text });
    } else {
      this.tokens.push({ kind, range, text, value });
    }
  }

  /** Emit a fixed-text operator/punctuator token, advancing `text.length` chars. */
  private emitFixed(kind: TokenKind, text: string): true {
    const start = this.position();
    for (let i = 0; i < text.length; i++) this.advance();
    const end = this.position();
    this.emit(kind, start, end, text);
    return true;
  }

  private diag(severity: Severity, code: string, message: string, range: SourceRange): void {
    this.diagnostics.push({ severity, code, message, range });
  }

  private isDigit(c: string | undefined): c is string {
    return c !== undefined && c >= '0' && c <= '9';
  }

  private isIdentStart(c: string): boolean {
    return (c >= 'A' && c <= 'Z') || (c >= 'a' && c <= 'z') || c === '_';
  }

  private isIdentPart(c: string): boolean {
    return this.isIdentStart(c) || (c >= '0' && c <= '9');
  }
}
