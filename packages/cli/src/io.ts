/**
 * Shared CLI helpers: reading source from disk/stdin, formatting diagnostics,
 * and the discriminated `ExecResult` returned by every command function.
 *
 * The command implementations are pure — they never call `process.exit` or
 * `process.stdout.write` directly. The thin shell in `index.ts` is the only
 * thing that touches the runtime; this keeps the commands trivially testable.
 */

import { readFileSync } from 'node:fs';

import {
  formatDiagnostic,
  hasErrors,
  type Diagnostic,
} from '@sysdyn/core';

export interface ExecResult {
  /** 0 = OK, 1 = command-level error (parse/compile/sim/runtime), 2 = invalid usage. */
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
}

/** Read source text from a file path. `-` reads from stdin. */
export function readSource(file: string): { text: string; name: string } {
  if (file === '-') {
    const text = readFileSync(0, 'utf8'); // fd 0 = stdin
    return { text, name: '<stdin>' };
  }
  const text = readFileSync(file, 'utf8');
  return { text, name: file };
}

/** Render a list of diagnostics in stderr-friendly form, one per line. */
export function renderDiagnostics(diags: readonly Diagnostic[], fileName: string): string {
  if (diags.length === 0) return '';
  return diags.map((d) => formatDiagnostic(d, fileName)).join('\n') + '\n';
}

export { hasErrors };

/**
 * Format a number for CSV output.
 *   - integers (within 2^53) → no fractional part
 *   - finite reals          → 12 significant figures
 *   - NaN/Inf               → 'NaN' / 'Infinity' / '-Infinity'
 *
 * 12 sig figs is the sweet spot for round-trip stability against snapshot
 * tests: tight enough to detect drift, loose enough to absorb the last
 * float-arithmetic ULP across runs.
 */
export function formatNumber(n: number): string {
  if (!Number.isFinite(n)) return String(n);
  if (Number.isInteger(n) && Math.abs(n) < 1e15) return n.toString();
  return n.toPrecision(12);
}
