/**
 * E2E acceptance suite — exercises the public examples through the full
 * pipeline (parse → desugar → compile → simulate → CSV) and asserts that:
 *
 *  1. Every example compiles without error diagnostics.
 *  2. Every example simulates without aborting (no NaN/Inf).
 *  3. The CSV output is bit-stable across runs (snapshot).
 *
 * The snapshot is the strongest acceptance signal: a numerical change
 * anywhere in the pipeline (lexer, parser, desugar, IR, solver, formatting)
 * shows up immediately as a diff against the committed snapshot.
 *
 * `cycle_demo.sd` is checked separately — it must exit 1 on `sysdyn check`.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { build, simulate } from '@sysdyn/core';

import { checkCommand } from '../src/check.js';
import { simulationToCsvString } from '../src/csv.js';

const EXAMPLES_DIR = resolve(__dirname, '../../../examples/v2');

const EXAMPLES = [
  'loan_payoff',
  'simple_population',
  'population_model',
  'business_growth',
  'economic_model',
] as const;

describe('E2E — examples compile and simulate cleanly', () => {
  for (const name of EXAMPLES) {
    it(`${name}.sd compiles with no errors`, () => {
      const src = readFileSync(resolve(EXAMPLES_DIR, `${name}.sd`), 'utf8');
      const { diagnostics } = build(src, { fileName: `${name}.sd` });
      const errors = diagnostics.filter((d) => d.severity === 'error');
      expect(errors).toEqual([]);
    });

    it(`${name}.sd simulates without aborting`, () => {
      const src = readFileSync(resolve(EXAMPLES_DIR, `${name}.sd`), 'utf8');
      const { program } = build(src, { fileName: `${name}.sd` });
      const result = simulate(program);
      expect(result.abortedAt).toBeUndefined();
      // Spot-check: time series must be non-empty.
      expect(result.time.length).toBeGreaterThan(1);
      // No stock series may contain NaN or Inf at any recorded step.
      for (const fqn of Object.keys(result.stocks)) {
        for (let i = 0; i < result.stocks[fqn]!.length; i++) {
          expect(Number.isFinite(result.stocks[fqn]![i]!)).toBe(true);
        }
      }
    });
  }
});

describe('E2E — CSV snapshots', () => {
  for (const name of EXAMPLES) {
    it(`${name}.sd CSV output is stable`, () => {
      const src = readFileSync(resolve(EXAMPLES_DIR, `${name}.sd`), 'utf8');
      const { program } = build(src, { fileName: `${name}.sd` });
      const result = simulate(program);
      const csv = simulationToCsvString(program, result);
      // Vitest's inline snapshot stores into __snapshots__/ — first run records,
      // subsequent runs assert byte-equality.
      expect(csv).toMatchSnapshot();
    });
  }
});

describe('E2E — cycle_demo', () => {
  it('sysdyn check exits 1 with SD0050 on cycle_demo.sd', () => {
    const r = checkCommand(resolve(EXAMPLES_DIR, 'cycle_demo.sd'));
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toMatch(/SD0050/);
  });
});

describe('E2E — sweep + scenario expansion', () => {
  it('loan_payoff produces 5 sweep variations × 2 scenarios = 10 combos', () => {
    const src = readFileSync(resolve(EXAMPLES_DIR, 'loan_payoff.sd'), 'utf8');
    const { program } = build(src);
    expect(program.sweeps).toHaveLength(1);
    expect(program.sweeps[0]!.values.length).toBe(5);
    expect(program.scenarios).toHaveLength(1);
    // Total = (Base + 1 scenario) × 5 sweep values.
    // We don't run simulateAll here — that's covered in core/test/simulate-all.test.ts.
  });
});
