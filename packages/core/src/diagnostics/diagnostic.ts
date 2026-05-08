/**
 * LSP-shaped diagnostics. Codes follow `SD####` for stable references in docs.
 */

import type { SourceRange } from './source.js';

export type Severity = 'error' | 'warning' | 'info' | 'hint';

export interface RelatedInformation {
  readonly message: string;
  readonly range: SourceRange;
}

export interface Diagnostic {
  readonly severity: Severity;
  /** Stable identifier, e.g. `SD0042`. Used by docs and tests. */
  readonly code: string;
  readonly message: string;
  readonly range: SourceRange;
  readonly related?: readonly RelatedInformation[];
}

/** Convenience: filter and count errors. */
export function hasErrors(diagnostics: readonly Diagnostic[]): boolean {
  for (const d of diagnostics) {
    if (d.severity === 'error') return true;
  }
  return false;
}

/** Format a single diagnostic in IDE-clickable form: `name:line:col: severity SDxxxx: message`. */
export function formatDiagnostic(d: Diagnostic, fileName = '<source>'): string {
  const { line, column } = d.range.start;
  // 1-indexed for display (matches editor conventions).
  return `${fileName}:${line + 1}:${column + 1}: ${d.severity} ${d.code}: ${d.message}`;
}
