/**
 * Public parse API — wraps lexer + parser + diagnostics.
 */

import type { Diagnostic } from '../diagnostics/diagnostic.js';
import { ZERO_POSITION } from '../diagnostics/source.js';
import { tokenize } from '../syntax/lexer.js';
import { parseTokens } from '../syntax/parser.js';
import type { Program } from '../syntax/ast.js';

export interface ParseOptions {
  readonly fileName?: string;
}

export interface ParseResult {
  readonly ast: Program;
  readonly diagnostics: readonly Diagnostic[];
}

const EMPTY_PROGRAM: Program = {
  kind: 'Program',
  body: [],
  range: { start: ZERO_POSITION, end: ZERO_POSITION },
};

export function parse(source: string, _options?: ParseOptions): ParseResult {
  const lex = tokenize(source);
  const parsed = parseTokens(lex.tokens);
  const diagnostics = [...lex.diagnostics, ...parsed.diagnostics];
  return {
    ast: parsed.ast ?? EMPTY_PROGRAM,
    diagnostics,
  };
}
