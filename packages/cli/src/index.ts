#!/usr/bin/env node
/**
 * `sysdyn` CLI entry point.
 *
 * Thin shell over the pure command functions in `run.ts`, `check.ts`, `print.ts`.
 * The shell's only job is argv parsing (commander) and IO (stdout / stderr / exit).
 *
 * Subcommands return an `ExecResult` carrying { exitCode, stdout, stderr } so
 * everything is unit-testable without spawning subprocesses.
 */

import { Command } from 'commander';

import { checkCommand } from './check.js';
import { printCommand } from './print.js';
import { runCommand, type RunOptions } from './run.js';
import type { ExecResult } from './io.js';

const program = new Command();

program
  .name('sysdyn')
  .description('System Dynamics CLI: run, check, and inspect models.')
  .version('2.0.0-alpha.0');

program
  .command('run')
  .description('Parse, compile, and simulate a model. Output to stdout or CSV.')
  .argument('<file>', 'path to a .sd model file (or "-" for stdin)')
  .option('--scenario <name>', 'apply a named scenario')
  .option('--sweep <kv>', 'override a constant: KEY=v1,v2,v3 (repeatable)', collect, [])
  .option('--csv <path>', 'write CSV output to this path (single-run mode)')
  .option('--solver <name>', 'rk4 | euler', 'rk4')
  .option('--all', 'run all variations (cartesian product of scenarios × sweeps)')
  .option('-o, --out-dir <path>', 'output directory for multi-variation runs')
  .option('--quiet', 'suppress informational output')
  .action(async (file: string, opts: RunCliOptions) => {
    const r = await runCommand(file, optsToRun(opts));
    emit(r);
  });

program
  .command('check')
  .description('Parse and compile a model. Print diagnostics. Exit 0 on success, 1 otherwise.')
  .argument('<file>', 'path to a .sd model file')
  .action((file: string) => {
    emit(checkCommand(file));
  });

program
  .command('print')
  .description('Pretty-print a structural summary of the compiled program (debug).')
  .argument('<file>', 'path to a .sd model file')
  .action((file: string) => {
    emit(printCommand(file));
  });

program.parseAsync(process.argv).catch((err: unknown) => {
  const msg = err instanceof Error ? err.message : String(err);
  process.stderr.write(`sysdyn: ${msg}\n`);
  process.exit(2);
});

// ────────────────────────────────────────────────────────────────────────────

interface RunCliOptions {
  readonly scenario?: string;
  readonly sweep?: string[];
  readonly csv?: string;
  readonly solver?: string;
  readonly all?: boolean;
  readonly outDir?: string;
  readonly quiet?: boolean;
}

function optsToRun(o: RunCliOptions): RunOptions {
  return {
    ...(o.scenario ? { scenario: o.scenario } : {}),
    ...(o.sweep && o.sweep.length > 0 ? { sweep: o.sweep } : {}),
    ...(o.csv ? { csv: o.csv } : {}),
    solver: (o.solver as 'rk4' | 'euler' | undefined) ?? 'rk4',
    ...(o.all ? { all: true } : {}),
    ...(o.outDir ? { outDir: o.outDir } : {}),
    ...(o.quiet ? { quiet: true } : {}),
  };
}

function collect(value: string, prev: string[]): string[] {
  return [...prev, value];
}

function emit(result: ExecResult): void {
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  process.exit(result.exitCode);
}
