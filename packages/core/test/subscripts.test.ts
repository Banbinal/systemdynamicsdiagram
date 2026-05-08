/**
 * Subscript expansion tests — verify the desugar produces N independent
 * variables and that simulation runs correctly on the expanded program.
 */

import { describe, expect, it } from 'vitest';

import { compile } from '../src/api/compile.js';
import { parse } from '../src/api/parse.js';
import { simulate } from '../src/runtime/simulate.js';

function compileFor(src: string) {
  const { ast, diagnostics: parseDiags } = parse(src);
  expect(parseDiags.filter((d) => d.severity === 'error')).toEqual([]);
  return compile(ast);
}

describe('Subscript expansion', () => {
  it('expands a uniform-init subscripted stock into N independent stocks', () => {
    const { program, diagnostics } = compileFor(
      [
        'StartTime = 0',
        'EndTime = 5',
        'TimeStep = 1',
        'subscript Region = North, South, East, West',
        'constant Rate[Region] = 0.1',
        'stock Population[Region] = 100',
        'flow Births[Region]:',
        '    Population[Region] * Rate[Region] -+> Population[Region]',
        '',
      ].join('\n'),
    );
    expect(diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
    // Four stocks, four constants, four flows.
    const stockFqns = program.stocks.filter((s) => !s.synthetic).map((s) => s.fqn).sort();
    expect(stockFqns).toEqual(['Population_East', 'Population_North', 'Population_South', 'Population_West']);
    expect(program.constants.map((c) => c.fqn).sort()).toEqual(
      ['Rate_East', 'Rate_North', 'Rate_South', 'Rate_West'],
    );
    // Each region grows independently: same rate, same init, identical output.
    const result = simulate(program);
    const popN = result.stocks['Population_North']!;
    const popS = result.stocks['Population_South']!;
    expect(popN[popN.length - 1]).toBeCloseTo(popS[popS.length - 1]!, 6);
    expect(popN[popN.length - 1]).toBeGreaterThan(100);
  });

  it('per-element values from an array literal', () => {
    const { program, diagnostics } = compileFor(
      [
        'StartTime = 0',
        'EndTime = 5',
        'TimeStep = 1',
        'subscript Region = North, South',
        'constant Rate[Region] = [0.1, 0.5]',
        'stock Population[Region] = 100',
        'flow Births[Region]:',
        '    Population[Region] * Rate[Region] -+> Population[Region]',
        '',
      ].join('\n'),
    );
    expect(diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
    const result = simulate(program);
    const popN = result.stocks['Population_North']![5]!; // ~ 100*1.1^5 = 161
    const popS = result.stocks['Population_South']![5]!; // ~ 100*1.5^5 = 759
    expect(popN).toBeGreaterThan(150);
    expect(popN).toBeLessThan(170);
    expect(popS).toBeGreaterThan(700);
  });

  it('literal-element refs work outside subscripted contexts', () => {
    const { program, diagnostics } = compileFor(
      [
        'StartTime = 0',
        'EndTime = 1',
        'TimeStep = 1',
        'subscript Region = North, South',
        'stock Population[Region] = 50',
        'constant Rate = 0',
        'flow Births[Region]:',
        '    Population[Region] * Rate -+> Population[Region]',
        'calc Total = Population[North] + Population[South]',
        '',
      ].join('\n'),
    );
    expect(diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
    const result = simulate(program);
    const total = result.calcs['Total']!;
    expect(total[0]).toBe(100);
  });

  it('rejects array literals with the wrong length', () => {
    const { diagnostics } = compileFor(
      [
        'subscript Region = North, South, East',
        'constant Rate[Region] = [0.1, 0.2]',  // 2 values for 3 elements
        'stock Population[Region] = 100',
        'flow Births[Region]:',
        '    Population[Region] * Rate[Region] -+> Population[Region]',
        '',
      ].join('\n'),
    );
    const errors = diagnostics.filter((d) => d.severity === 'error');
    expect(errors.length).toBeGreaterThan(0);
    expect(errors.some((d) => d.code === 'SD0050x')).toBe(true);
  });

  it('rejects refs to a subscript dimension outside scope', () => {
    const { diagnostics } = compileFor(
      [
        'subscript Region = North, South',
        'stock Population[Region] = 100',
        'constant Rate = 0',
        'flow Births[Region]:',
        '    Population[Region] * Rate -+> Population[Region]',
        // Outside any subscripted decl — `[Region]` here is meaningless.
        'calc Bad = Population[Region] + 1',
        '',
      ].join('\n'),
    );
    expect(diagnostics.some((d) => d.code === 'SD0048')).toBe(true);
  });
});
