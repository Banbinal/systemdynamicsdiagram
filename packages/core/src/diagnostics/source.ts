/**
 * Source positions and ranges. LSP-shaped: positions are 0-indexed line/column,
 * ranges are half-open [start, end).
 */

export interface Position {
  /** 0-indexed line. */
  readonly line: number;
  /** 0-indexed UTF-16 column. */
  readonly column: number;
  /** 0-indexed byte offset into the source. */
  readonly offset: number;
}

export interface SourceRange {
  readonly start: Position;
  /** Exclusive. */
  readonly end: Position;
}

export interface SourceFile {
  /** Display name (e.g. "model.sd" or "<stdin>"). */
  readonly name: string;
  readonly text: string;
}

export const ZERO_POSITION: Position = { line: 0, column: 0, offset: 0 };

export const EMPTY_RANGE: SourceRange = { start: ZERO_POSITION, end: ZERO_POSITION };

/**
 * Build a SourceFile from a name and text. The text is stored as-is; we do
 * not normalize line endings here (the lexer handles `\r\n`).
 */
export function makeSourceFile(name: string, text: string): SourceFile {
  return { name, text };
}
