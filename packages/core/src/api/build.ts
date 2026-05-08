/**
 * Sugar over `parse` + `compile`. Most callers want a one-shot entry point;
 * advanced tools (LSP, codemods) call `parse` and `compile` separately.
 */

import type { Diagnostic } from '../diagnostics/diagnostic.js';
import type { CompiledProgram } from '../ir/program.js';
import { compile } from './compile.js';
import { parse, type ParseOptions } from './parse.js';

export interface BuildResult {
  readonly program: CompiledProgram;
  readonly diagnostics: readonly Diagnostic[];
}

export function build(source: string, options?: ParseOptions): BuildResult {
  const { ast, diagnostics: parseDiags } = parse(source, options);
  const { program, diagnostics: compileDiags } = compile(ast);
  return {
    program,
    diagnostics: [...parseDiags, ...compileDiags],
  };
}
