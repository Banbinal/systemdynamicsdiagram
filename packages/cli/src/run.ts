/**
 * `sysdyn run <file>` — parse, compile, simulate, and emit results.
 *
 * Modes:
 *   1. Single run, output to stdout:
 *        sysdyn run model.sd
 *   2. Single run, write CSV:
 *        sysdyn run model.sd --csv out.csv
 *   3. All variations (cartesian scenarios × sweeps), output dir:
 *        sysdyn run model.sd --all -o out/
 *
 * CLI sweep flags (`--sweep K=v1,v2,…`) are merged into the program's
 * declared sweeps after compile, so a run with `--sweep` always implies
 * the multi-variation path.
 *
 * Exit codes:
 *   0  success (zero error diagnostics)
 *   1  compile error, simulation NaN abort, IO error mid-write
 *   2  invalid usage (unknown solver, malformed --sweep, missing -o)
 */

import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import {
  build,
  hasErrors,
  simulate,
  simulateAll,
  type CompiledProgram,
  type SimulateAllOptions,
  type SimulateOptions,
  type SimulationResult,
  type SweepIR,
  type VariationResult,
} from '@sysdyn/core';

import { labelToSlug, simulationToCsvString, writeCsv } from './csv.js';
import { readSource, renderDiagnostics, type ExecResult } from './io.js';

export interface RunOptions {
  readonly scenario?: string;
  readonly sweep?: readonly string[]; // e.g. ['K=1,2,3', 'Tau=0.5,1.0']
  readonly csv?: string;
  readonly solver?: 'rk4' | 'euler';
  readonly all?: boolean;
  readonly outDir?: string;
  readonly quiet?: boolean;
}

export async function runCommand(file: string, opts: RunOptions = {}): Promise<ExecResult> {
  // ─── Load source ─────────────────────────────────────────────────────
  let src: { text: string; name: string };
  try {
    src = readSource(file);
  } catch (err) {
    return { exitCode: 2, stdout: '', stderr: `sysdyn run: ${(err as Error).message}\n` };
  }

  // ─── Compile ─────────────────────────────────────────────────────────
  const { program, diagnostics } = build(src.text, { fileName: src.name });
  const compileErrStream = renderDiagnostics(diagnostics, src.name);
  if (hasErrors(diagnostics)) {
    return { exitCode: 1, stdout: '', stderr: compileErrStream };
  }

  // ─── Validate solver ─────────────────────────────────────────────────
  const solver: 'rk4' | 'euler' = opts.solver ?? 'rk4';
  if (solver !== 'rk4' && solver !== 'euler') {
    return {
      exitCode: 2,
      stdout: '',
      stderr: `sysdyn run: unknown --solver '${solver}' (expected 'rk4' or 'euler')\n`,
    };
  }

  // ─── Merge CLI sweeps ────────────────────────────────────────────────
  const sweepParse = parseCliSweeps(opts.sweep ?? [], program);
  if (!sweepParse.ok) {
    return { exitCode: 2, stdout: '', stderr: `sysdyn run: ${sweepParse.error}\n` };
  }
  const effectiveProgram: CompiledProgram = sweepParse.sweeps.length === 0
    ? program
    : { ...program, sweeps: [...program.sweeps, ...sweepParse.sweeps] };

  const isMulti = opts.all === true || sweepParse.sweeps.length > 0;

  // ─── Single-run path ─────────────────────────────────────────────────
  if (!isMulti) {
    const simOpts: SimulateOptions = {
      solver,
      ...(opts.scenario ? { scenarioName: opts.scenario } : {}),
    };
    const result = simulate(effectiveProgram, simOpts);
    return finishSingle(effectiveProgram, src.name, compileErrStream, result, opts);
  }

  // ─── Multi-variation path ────────────────────────────────────────────
  // --all without -o still works (output goes to stdout, concatenated).
  const allOpts: SimulateAllOptions = { solver };
  const variations = simulateAll(effectiveProgram, allOpts);
  return finishMulti(effectiveProgram, src.name, compileErrStream, variations, opts);
}

// ────────────────────────────────────────────────────────────────────────────

function finishSingle(
  program: CompiledProgram,
  fileName: string,
  compileErrStream: string,
  result: SimulationResult,
  opts: RunOptions,
): ExecResult | Promise<ExecResult> {
  const simErrStream = renderDiagnostics(result.diagnostics, fileName);
  const stderr = compileErrStream + simErrStream;

  if (opts.csv) {
    return writeCsv(program, result, opts.csv).then(
      () => ({
        exitCode: result.abortedAt !== undefined ? 1 : 0,
        stdout: opts.quiet ? '' : `wrote ${result.time.length} rows to ${opts.csv}\n`,
        stderr,
      }),
      (err) => ({
        exitCode: 1,
        stdout: '',
        stderr: stderr + `sysdyn run: failed to write CSV: ${(err as Error).message}\n`,
      }),
    );
  }

  // No --csv: write CSV to stdout.
  return {
    exitCode: result.abortedAt !== undefined ? 1 : 0,
    stdout: simulationToCsvString(program, result),
    stderr,
  };
}

async function finishMulti(
  program: CompiledProgram,
  fileName: string,
  compileErrStream: string,
  variations: readonly VariationResult[],
  opts: RunOptions,
): Promise<ExecResult> {
  // Aggregate any sim diagnostics across variations.
  const simStreams: string[] = [];
  let anyAbort = false;
  for (const v of variations) {
    if (v.result.diagnostics.length > 0) {
      simStreams.push(`[${v.label}]\n${renderDiagnostics(v.result.diagnostics, fileName)}`);
    }
    if (v.result.abortedAt !== undefined) anyAbort = true;
  }
  const stderr = compileErrStream + simStreams.join('');

  if (opts.outDir) {
    try {
      const indexEntries: Array<{ label: string; file: string; scenario: string | null; sweep: Record<string, number> }> = [];
      for (const v of variations) {
        const slug = labelToSlug(v.label);
        const fileOut = `${slug}.csv`;
        await writeCsv(program, v.result, join(opts.outDir, fileOut));
        indexEntries.push({
          label: v.label,
          file: fileOut,
          scenario: v.scenarioName,
          sweep: v.sweepValues as Record<string, number>,
        });
      }
      await writeFile(
        join(opts.outDir, 'index.json'),
        JSON.stringify({ variations: indexEntries }, null, 2) + '\n',
        'utf8',
      );
      return {
        exitCode: anyAbort ? 1 : 0,
        stdout: opts.quiet ? '' : `wrote ${variations.length} variations to ${opts.outDir}\n`,
        stderr,
      };
    } catch (err) {
      return {
        exitCode: 1,
        stdout: '',
        stderr: stderr + `sysdyn run: ${(err as Error).message}\n`,
      };
    }
  }

  // No -o: emit a concatenated CSV with a leading `# label` line per variation.
  const chunks: string[] = [];
  for (const v of variations) {
    chunks.push(`# ${v.label}`);
    chunks.push(simulationToCsvString(program, v.result));
  }
  return {
    exitCode: anyAbort ? 1 : 0,
    stdout: chunks.join('\n'),
    stderr,
  };
}

// ────────────────────────────────────────────────────────────────────────────
// CLI sweep parsing

interface ParseOk {
  readonly ok: true;
  readonly sweeps: readonly SweepIR[];
}
interface ParseErr {
  readonly ok: false;
  readonly error: string;
}

/**
 * Parse `KEY=v1,v2,…` strings into SweepIR entries. The KEY must resolve to a
 * declared constant in the program (we need its slot for runtime overrides).
 */
function parseCliSweeps(
  raw: readonly string[],
  program: CompiledProgram,
): ParseOk | ParseErr {
  const out: SweepIR[] = [];
  for (const entry of raw) {
    const eq = entry.indexOf('=');
    if (eq <= 0) {
      return { ok: false, error: `malformed --sweep '${entry}' (expected KEY=v1,v2,…)` };
    }
    const key = entry.slice(0, eq).trim();
    const valuesText = entry.slice(eq + 1);
    const parts = valuesText.split(',').map((s) => s.trim()).filter(Boolean);
    if (parts.length === 0) {
      return { ok: false, error: `--sweep '${key}' has no values` };
    }
    const values: number[] = [];
    for (const p of parts) {
      const n = Number(p);
      if (!Number.isFinite(n)) {
        return { ok: false, error: `--sweep '${key}' has non-numeric value '${p}'` };
      }
      values.push(n);
    }
    const cst = program.constants.find((c) => c.fqn === key);
    if (!cst) {
      return { ok: false, error: `--sweep target '${key}' is not a declared constant` };
    }
    out.push({ target: key, slot: cst.slot, values: new Float64Array(values) });
  }
  return { ok: true, sweeps: out };
}
