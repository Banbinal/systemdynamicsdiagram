/**
 * CSV writer for SimulationResult.
 *
 * Layout:
 *   header: time, <stock1>, <stock2>, …, <calc1>, <calc2>, …
 *   rows:   one per recorded step
 *
 * Column order is stable across runs:
 *   - stocks in `program.stocks` declaration order (matches CompiledProgram)
 *   - calcs  in `program.calcs`  topological order
 *
 * Streaming: rows are written through `WriteStream.write` so the in-memory
 * footprint stays bounded (a long simulation may produce hundreds of MB).
 *
 * For testability the same logic is exposed as `simulationToCsvString` —
 * tests assert on the full string without touching the filesystem.
 */

import { createWriteStream } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';

import type { CompiledProgram, SimulationResult } from '@sysdyn/core';

import { formatNumber } from './io.js';

/**
 * Build the in-memory CSV string from a SimulationResult.
 *
 * Trailing newline is included so each row (including the last) ends with `\n`.
 */
export function simulationToCsvString(
  program: CompiledProgram,
  result: SimulationResult,
): string {
  const stockFqns = program.stocks.map((s) => s.fqn);
  const calcFqns = program.calcs.map((c) => c.fqn);
  const header = ['time', ...stockFqns, ...calcFqns].join(',');
  const lines: string[] = [header];

  for (let i = 0; i < result.time.length; i++) {
    const cells: string[] = [formatNumber(result.time[i]!)];
    for (const fqn of stockFqns) cells.push(formatNumber(result.stocks[fqn]![i]!));
    for (const fqn of calcFqns) cells.push(formatNumber(result.calcs[fqn]![i]!));
    lines.push(cells.join(','));
  }

  return lines.join('\n') + '\n';
}

/**
 * Stream a SimulationResult to a CSV file at `path`. Creates the parent
 * directory if needed. Resolves once the stream has flushed and closed.
 */
export async function writeCsv(
  program: CompiledProgram,
  result: SimulationResult,
  path: string,
): Promise<void> {
  await mkdir(dirname(path), { recursive: true });

  const stream = createWriteStream(path, { encoding: 'utf8' });
  const stockFqns = program.stocks.map((s) => s.fqn);
  const calcFqns = program.calcs.map((c) => c.fqn);

  await write(stream, ['time', ...stockFqns, ...calcFqns].join(',') + '\n');

  for (let i = 0; i < result.time.length; i++) {
    const cells: string[] = [formatNumber(result.time[i]!)];
    for (const fqn of stockFqns) cells.push(formatNumber(result.stocks[fqn]![i]!));
    for (const fqn of calcFqns) cells.push(formatNumber(result.calcs[fqn]![i]!));
    await write(stream, cells.join(',') + '\n');
  }

  await new Promise<void>((resolve, reject) => {
    stream.end((err: unknown) => (err ? reject(err) : resolve()));
  });
}

/** Backpressure-aware single-line writer. */
function write(stream: NodeJS.WritableStream, chunk: string): Promise<void> {
  return new Promise((resolve, reject) => {
    stream.write(chunk, (err) => (err ? reject(err) : resolve()));
  });
}

/**
 * Convert a variation label like `Hi (K=1, Tau=2.5)` to a filesystem-safe slug.
 * Replaces every non-alphanumeric run with `_` and collapses repeats.
 */
export function labelToSlug(label: string): string {
  return label
    .replace(/[^A-Za-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    || 'variation';
}
