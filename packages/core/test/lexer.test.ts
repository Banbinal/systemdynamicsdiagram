/**
 * Lexer tests. Covers: token kinds, indentation, comments, numbers, polarities,
 * implicit line joining inside brackets, and error diagnostics.
 */

import { describe, expect, it } from 'vitest';

import { tokenize } from '../src/syntax/lexer.js';
import { TokenKind, type Token } from '../src/syntax/token.js';

/**
 * Strip EOF / NEWLINE / INDENT / DEDENT for content-focused tests.
 * Use `tokenize()` directly when structural tokens matter.
 */
function kinds(source: string): [TokenKind, string][] {
  const { tokens } = tokenize(source);
  return tokens
    .filter(
      (t) =>
        t.kind !== TokenKind.Eof &&
        t.kind !== TokenKind.Newline &&
        t.kind !== TokenKind.Indent &&
        t.kind !== TokenKind.Dedent,
    )
    .map((t) => [t.kind, t.text] as [TokenKind, string]);
}

function full(source: string): { tokens: Token[]; codes: string[] } {
  const { tokens, diagnostics } = tokenize(source);
  return {
    tokens: [...tokens],
    codes: diagnostics.map((d) => d.code),
  };
}

describe('lexer — basics', () => {
  it('tokenizes empty input to just EOF', () => {
    const { tokens } = tokenize('');
    expect(tokens).toHaveLength(1);
    expect(tokens[0]!.kind).toBe(TokenKind.Eof);
  });

  it('tokenizes whitespace-only input to just EOF', () => {
    const { tokens } = tokenize('   \n\n  \n');
    expect(tokens).toHaveLength(1);
    expect(tokens[0]!.kind).toBe(TokenKind.Eof);
  });

  it('strips comments and blank lines', () => {
    expect(kinds('# comment line\n  # indented comment\n')).toEqual([]);
  });

  it('recognizes top-level keywords', () => {
    expect(kinds('constant stock calc flow map module scenario sweep plot limit title')).toEqual([
      [TokenKind.KwConstant, 'constant'],
      [TokenKind.KwStock, 'stock'],
      [TokenKind.KwCalc, 'calc'],
      [TokenKind.KwFlow, 'flow'],
      [TokenKind.KwMap, 'map'],
      [TokenKind.KwModule, 'module'],
      [TokenKind.KwScenario, 'scenario'],
      [TokenKind.KwSweep, 'sweep'],
      [TokenKind.KwPlot, 'plot'],
      [TokenKind.KwLimit, 'limit'],
      [TokenKind.KwTitle, 'title'],
    ]);
  });

  it('recognizes time config keywords', () => {
    expect(kinds('StartTime EndTime TimeStep')).toEqual([
      [TokenKind.KwStartTime, 'StartTime'],
      [TokenKind.KwEndTime, 'EndTime'],
      [TokenKind.KwTimeStep, 'TimeStep'],
    ]);
  });

  it('treats min/max/linear/step/spline/smooth/delay3 as identifiers (not keywords)', () => {
    const ks = kinds('min max linear step spline smooth delay3 pulse time');
    for (const [k] of ks) {
      expect(k).toBe(TokenKind.Ident);
    }
  });
});

describe('lexer — numbers', () => {
  it('parses integers', () => {
    const { tokens } = tokenize('42');
    expect(tokens[0]!.kind).toBe(TokenKind.Number);
    expect(tokens[0]!.value).toBe(42);
    expect(tokens[0]!.text).toBe('42');
  });

  it('parses decimals', () => {
    const { tokens } = tokenize('3.14');
    expect(tokens[0]!.value).toBe(3.14);
  });

  it('parses leading-dot decimals', () => {
    const { tokens } = tokenize('.5');
    expect(tokens[0]!.value).toBe(0.5);
  });

  it('parses scientific notation', () => {
    expect(tokenize('1e3').tokens[0]!.value).toBe(1000);
    expect(tokenize('1.5e-2').tokens[0]!.value).toBe(0.015);
    expect(tokenize('2E+10').tokens[0]!.value).toBe(2e10);
  });

  it('reports unterminated exponent', () => {
    const { codes } = full('1e\n');
    expect(codes).toContain('SD0013');
  });
});

describe('lexer — operators and punctuation', () => {
  it('matches polarity arrows as atomic tokens', () => {
    expect(kinds('a -+> b')).toEqual([
      [TokenKind.Ident, 'a'],
      [TokenKind.ArrowPos, '-+>'],
      [TokenKind.Ident, 'b'],
    ]);
    expect(kinds('a --> b')).toEqual([
      [TokenKind.Ident, 'a'],
      [TokenKind.ArrowNeg, '-->'],
      [TokenKind.Ident, 'b'],
    ]);
  });

  it('matches two-char comparison and logical operators', () => {
    expect(kinds('<= >= == != && ||')).toEqual([
      [TokenKind.LtEq, '<='],
      [TokenKind.GtEq, '>='],
      [TokenKind.EqEq, '=='],
      [TokenKind.BangEq, '!='],
      [TokenKind.AmpAmp, '&&'],
      [TokenKind.PipePipe, '||'],
    ]);
  });

  it('matches single-char operators and punctuation', () => {
    expect(kinds('+ - * / % ^ ! < > = , . :')).toEqual([
      [TokenKind.Plus, '+'],
      [TokenKind.Minus, '-'],
      [TokenKind.Star, '*'],
      [TokenKind.Slash, '/'],
      [TokenKind.Percent, '%'],
      [TokenKind.Caret, '^'],
      [TokenKind.Bang, '!'],
      [TokenKind.Lt, '<'],
      [TokenKind.Gt, '>'],
      [TokenKind.Eq, '='],
      [TokenKind.Comma, ','],
      [TokenKind.Dot, '.'],
      [TokenKind.Colon, ':'],
    ]);
  });
});

describe('lexer — newlines and blank lines', () => {
  it('emits a NEWLINE between logical lines (plus a synthetic trailing one)', () => {
    const { tokens } = tokenize('stock A = 1\nstock B = 2');
    const newlines = tokens.filter((t) => t.kind === TokenKind.Newline).length;
    expect(newlines).toBe(2); // explicit between, synthetic at EOF
  });

  it('coalesces blank lines (no extra NEWLINEs)', () => {
    const { tokens } = tokenize('stock A = 1\n\n\n\nstock B = 2');
    const newlines = tokens.filter((t) => t.kind === TokenKind.Newline).length;
    expect(newlines).toBe(2); // 4 blank lines collapse to 1, plus synthetic trailing
  });

  it('handles CRLF line endings', () => {
    const { tokens } = tokenize('stock A = 1\r\nstock B = 2\r\n');
    const newlines = tokens.filter((t) => t.kind === TokenKind.Newline).length;
    expect(newlines).toBe(2);
  });

  it('synthesizes a trailing NEWLINE when missing', () => {
    const { tokens } = tokenize('stock A = 1');
    const newlines = tokens.filter((t) => t.kind === TokenKind.Newline).length;
    expect(newlines).toBe(1);
  });
});

describe('lexer — indentation', () => {
  it('emits INDENT/DEDENT for a single block', () => {
    const { tokens } = tokenize('flow F:\n    a -+> X\n');
    const structure = tokens.filter(
      (t) =>
        t.kind === TokenKind.Indent ||
        t.kind === TokenKind.Dedent ||
        t.kind === TokenKind.Newline,
    );
    // After `flow F:` → NEWLINE, INDENT; after `a -+> X` → NEWLINE, DEDENT
    expect(structure.map((t) => t.kind)).toEqual([
      TokenKind.Newline,
      TokenKind.Indent,
      TokenKind.Newline,
      TokenKind.Dedent,
    ]);
  });

  it('handles nested blocks', () => {
    const src = [
      'module M:',
      '    flow F:',
      '        a -+> X',
      '    constant K = 1',
      '',
    ].join('\n');
    const { tokens } = tokenize(src);
    const indents = tokens.filter((t) => t.kind === TokenKind.Indent).length;
    const dedents = tokens.filter((t) => t.kind === TokenKind.Dedent).length;
    expect(indents).toBe(2);
    expect(dedents).toBe(2);
  });

  it('reports tabs in leading whitespace', () => {
    const { codes } = full('flow F:\n\ta -+> X\n');
    expect(codes).toContain('SD0011');
  });

  it('reports an inconsistent dedent', () => {
    const src = [
      'module M:',
      '    flow F:',
      '        a -+> X',
      '      constant K = 1', // 6 spaces, doesn't match any prior level (0, 4, 8)
      '',
    ].join('\n');
    const { codes } = full(src);
    expect(codes).toContain('SD0012');
  });
});

describe('lexer — implicit line joining inside brackets', () => {
  it('does not emit NEWLINE inside parentheses', () => {
    const { tokens } = tokenize('sweep R = [\n  0.01,\n  0.02,\n  0.03\n]\n');
    const newlines = tokens.filter((t) => t.kind === TokenKind.Newline).length;
    expect(newlines).toBe(1); // only the final one after `]`
  });

  it('reports unmatched closing bracket', () => {
    const { codes } = full(')\n');
    expect(codes).toContain('SD0014');
  });

  it('reports unclosed bracket at EOF', () => {
    const { codes } = full('sweep R = [1, 2, 3');
    expect(codes).toContain('SD0015');
  });
});

describe('lexer — source ranges', () => {
  it('tracks line and column accurately', () => {
    const src = 'stock A = 1\n  flow F:';
    const { tokens } = tokenize(src);
    const flow = tokens.find((t) => t.text === 'flow');
    expect(flow).toBeDefined();
    expect(flow!.range.start.line).toBe(1);
    expect(flow!.range.start.column).toBe(2);
  });

  it('records exclusive end positions', () => {
    const { tokens } = tokenize('Population');
    const ident = tokens[0]!;
    expect(ident.range.start.column).toBe(0);
    expect(ident.range.end.column).toBe(10);
    expect(ident.range.end.offset).toBe(10);
  });
});

describe('lexer — full v2 model snapshot', () => {
  it('tokenizes a small population model', () => {
    const src = [
      'title Toy population',
      'StartTime = 0',
      'EndTime = 10',
      'TimeStep = 0.1',
      '',
      'stock Population = 100',
      'constant BirthRate = 0.03',
      '',
      'flow Births:',
      '    Population * BirthRate -+> Population',
      '',
      'plot Population',
      '',
    ].join('\n');

    const { tokens, diagnostics } = tokenize(src);
    expect(diagnostics).toEqual([]);

    // Quick structural assertion: there is exactly one INDENT/DEDENT pair (for the flow body)
    const indents = tokens.filter((t) => t.kind === TokenKind.Indent).length;
    const dedents = tokens.filter((t) => t.kind === TokenKind.Dedent).length;
    expect(indents).toBe(1);
    expect(dedents).toBe(1);

    // First non-trivial token is `title`
    expect(tokens[0]!.kind).toBe(TokenKind.KwTitle);

    // `-+>` recognized atomically
    expect(tokens.some((t) => t.kind === TokenKind.ArrowPos && t.text === '-+>')).toBe(true);
  });
});
