/**
 * Reality Check tests — parser, compile, runtime.
 */

import { describe, expect, it } from 'vitest';

import { compile } from '../src/api/compile.js';
import { parse } from '../src/api/parse.js';
import { runChecks } from '../src/runtime/checks.js';

function checks(src: string) {
  const { ast, diagnostics: parseDiags } = parse(src);
  expect(parseDiags.filter((d) => d.severity === 'error')).toEqual([]);
  const { program, diagnostics } = compile(ast);
  expect(diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
  return runChecks(program);
}

describe('Reality Check — parser + runtime', () => {
  it('always-true assertion passes', () => {
    const r = checks(
      [
        'StartTime = 0',
        'EndTime = 5',
        'TimeStep = 1',
        'constant Rate = 0.1',
        'stock Population = 100',
        'flow Births:',
        '    Population * Rate -+> Population',
        'check Population_grows:',
        '    then Population >= 100 always',
        '',
      ].join('\n'),
    );
    expect(r).toHaveLength(1);
    expect(r[0]!.status).toBe('pass');
  });

  it('always-true assertion that fails reports the failing step', () => {
    const r = checks(
      [
        'StartTime = 0',
        'EndTime = 10',
        'TimeStep = 1',
        'constant DeathRate = 0.5',
        'stock Population = 100',
        'flow Deaths:',
        '    Population * DeathRate --> Population',
        'check Population_above_50:',
        '    then Population >= 50 always',
        '',
      ].join('\n'),
    );
    expect(r).toHaveLength(1);
    expect(r[0]!.status).toBe('fail');
    if (r[0]!.status === 'fail') {
      expect(r[0]!.failedAt.lhs).toBeLessThan(50);
    }
  });

  it('when input overrides a constant for the run', () => {
    const r = checks(
      [
        'StartTime = 0',
        'EndTime = 5',
        'TimeStep = 1',
        'constant Rate = 0.1',
        'stock Population = 100',
        'flow Births:',
        '    Population * Rate -+> Population',
        'check Default_run:',
        '    then Population >= 100 always',
        'check Zeroed_run:',
        '    when Rate = 0',
        '    then Population == 100 always',
        '',
      ].join('\n'),
    );
    expect(r).toHaveLength(2);
    expect(r[0]!.status).toBe('pass');
    expect(r[1]!.status).toBe('pass');
  });

  it('at t=N evaluates only the closest step', () => {
    const r = checks(
      [
        'StartTime = 0',
        'EndTime = 10',
        'TimeStep = 1',
        'constant Rate = 0.1',
        'stock Population = 100',
        'flow Births:',
        '    Population * Rate -+> Population',
        'check Pop_at_end:',
        '    then Population >= 200 at t = 10',
        '',
      ].join('\n'),
    );
    // 100 * exp(0.1*10) ≈ 271 — passes the >= 200.
    expect(r).toHaveLength(1);
    expect(r[0]!.status).toBe('pass');
  });

  it('empty checks → empty results', () => {
    const r = checks(['stock A = 0', ''].join('\n'));
    expect(r).toEqual([]);
  });
});
