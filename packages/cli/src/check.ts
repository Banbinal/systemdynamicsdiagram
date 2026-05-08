/**
 * `sysdyn check <file>` — parse + compile the model and report diagnostics.
 *
 * Exit codes:
 *   0  no errors
 *   1  at least one error-severity diagnostic
 *   2  IO error (file not found, etc.)
 */

import { build, hasErrors } from '@sysdyn/core';

import {
  readSource,
  renderDiagnostics,
  type ExecResult,
} from './io.js';

export function checkCommand(file: string): ExecResult {
  let src: { text: string; name: string };
  try {
    src = readSource(file);
  } catch (err) {
    return {
      exitCode: 2,
      stdout: '',
      stderr: `sysdyn check: ${(err as Error).message}\n`,
    };
  }

  const { diagnostics } = build(src.text, { fileName: src.name });
  const stderr = renderDiagnostics(diagnostics, src.name);
  const errs = hasErrors(diagnostics);

  return {
    exitCode: errs ? 1 : 0,
    stdout: errs ? '' : `${src.name}: OK (no errors)\n`,
    stderr,
  };
}
