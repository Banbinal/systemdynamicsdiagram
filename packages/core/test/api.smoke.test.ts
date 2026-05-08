/**
 * Smoke test for the public API surface. Confirms exports exist and stubs
 * return the expected shapes. Real behavior is tested in PR 2+.
 */

import { describe, expect, it } from 'vitest';

import {
  build,
  compile,
  formatDiagnostic,
  hasErrors,
  parse,
  simulate,
  simulateAll,
  makeSourceFile,
} from '../src/index.js';

describe('@sysdyn/core public API', () => {
  it('exposes parse() returning a ParseResult shape', () => {
    const { ast, diagnostics } = parse('# any input');
    expect(ast.kind).toBe('Program');
    expect(Array.isArray(ast.body)).toBe(true);
    expect(Array.isArray(diagnostics)).toBe(true);
    // Comment-only source: no diagnostics, empty body.
    expect(diagnostics).toEqual([]);
    expect(ast.body).toEqual([]);
  });

  it('exposes compile() returning a CompileResult shape', () => {
    const { program, diagnostics } = compile({
      kind: 'Program',
      body: [],
      range: {
        start: { line: 0, column: 0, offset: 0 },
        end: { line: 0, column: 0, offset: 0 },
      },
    });
    expect(program.stockCount).toBe(0);
    expect(program.calcCount).toBe(0);
    expect(diagnostics).toEqual([]);
  });

  it('build() composes parse + compile', () => {
    const { program, diagnostics } = build('# any input');
    expect(program.title).toBeNull();
    expect(diagnostics).toEqual([]);
  });

  it('simulate() runs the default time config on an empty program', () => {
    const { program } = build('# any input');
    const result = simulate(program);
    // Default time: 0..10 step 1 → 11 recorded points.
    expect(result.time.length).toBe(11);
    expect(result.time[0]).toBe(0);
    expect(result.time[10]).toBe(10);
    expect(result.diagnostics).toEqual([]);
    expect(Object.keys(result.stocks)).toHaveLength(0);
    expect(Object.keys(result.calcs)).toHaveLength(0);
  });

  it('simulateAll() runs the Base case when no scenarios or sweeps are declared', () => {
    const { program } = build('# any input');
    const variations = simulateAll(program);
    expect(variations).toHaveLength(1);
    expect(variations[0]!.scenarioName).toBeNull();
    expect(variations[0]!.sweepValues).toEqual({});
    expect(variations[0]!.label).toBe('Base (Base)');
  });

  it('hasErrors / formatDiagnostic operate on Diagnostic[]', () => {
    const { diagnostics } = parse('not a valid construct');
    expect(hasErrors(diagnostics)).toBe(true);
    const formatted = formatDiagnostic(diagnostics[0]!, 'model.sd');
    // Format: file:line:col: severity SDxxxx: message
    expect(formatted).toMatch(/^model\.sd:\d+:\d+: error SD\d{4}:/);
  });

  it('makeSourceFile builds a SourceFile', () => {
    const f = makeSourceFile('foo.sd', 'stock X = 1');
    expect(f.name).toBe('foo.sd');
    expect(f.text).toBe('stock X = 1');
  });
});
