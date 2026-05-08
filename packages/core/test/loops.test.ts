/**
 * Loop detection tests.
 *
 * Verifies that `findLoops` discovers each elementary cycle exactly once
 * and classifies it as R/B per the canonical SD parity rule.
 */

import { describe, expect, it } from 'vitest';

import { compile } from '../src/api/compile.js';
import { parse } from '../src/api/parse.js';
import { findLoops } from '../src/semantic/loops.js';

function loopsOf(src: string) {
  const { ast, diagnostics: parseDiags } = parse(src);
  expect(parseDiags.filter((d) => d.severity === 'error')).toEqual([]);
  const { program, diagnostics } = compile(ast);
  expect(diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
  return findLoops(program);
}

describe('findLoops — basic cases', () => {
  it('no influences → no loops', () => {
    const loops = loopsOf(['stock A = 0', 'stock B = 0', ''].join('\n'));
    expect(loops).toEqual([]);
  });

  it('self-reinforcing stock → R1', () => {
    const loops = loopsOf(
      [
        'constant Rate = 0.1',
        'stock Population = 100',
        'flow Births:',
        '    Population * Rate -+> Population',
        '',
      ].join('\n'),
    );
    expect(loops).toHaveLength(1);
    expect(loops[0]!.id).toBe('R1');
    expect(loops[0]!.kind).toBe('R');
    expect(loops[0]!.nodes).toEqual(['Population']);
    expect(loops[0]!.negativeCount).toBe(0);
  });

  it('self-balancing stock → B1', () => {
    const loops = loopsOf(
      [
        'constant Rate = 0.1',
        'stock Population = 100',
        'flow Deaths:',
        '    Population * Rate --> Population',
        '',
      ].join('\n'),
    );
    expect(loops).toHaveLength(1);
    expect(loops[0]!.id).toBe('B1');
    expect(loops[0]!.kind).toBe('B');
    expect(loops[0]!.negativeCount).toBe(1);
  });

  it('logistic growth → R + B', () => {
    const loops = loopsOf(
      [
        'constant BirthRate = 0.1',
        'constant DeathRate = 0.05',
        'stock Population = 100',
        'flow Births:',
        '    Population * BirthRate -+> Population',
        'flow Deaths:',
        '    Population * DeathRate --> Population',
        '',
      ].join('\n'),
    );
    expect(loops).toHaveLength(2);
    const ids = loops.map((l) => l.id).sort();
    expect(ids).toEqual(['B1', 'R1']);
  });

  it('predator-prey: at least one R and one B emerge', () => {
    const loops = loopsOf(
      [
        'constant Alpha = 0.4',
        'constant Beta = 0.012',
        'constant Gamma = 0.5',
        'constant Delta = 0.005',
        'stock Prey = 100',
        'stock Predator = 20',
        'calc Encounters = Prey * Predator',
        'flow PreyBirth:',
        '    Prey * Alpha -+> Prey',
        'flow PreyDeath:',
        '    Encounters * Beta --> Prey',
        'flow PredBirth:',
        '    Encounters * Delta -+> Predator',
        'flow PredDeath:',
        '    Predator * Gamma --> Predator',
        '',
      ].join('\n'),
    );
    const rs = loops.filter((l) => l.kind === 'R');
    const bs = loops.filter((l) => l.kind === 'B');
    expect(rs.length).toBeGreaterThanOrEqual(1);
    expect(bs.length).toBeGreaterThanOrEqual(1);
  });
});

describe('findLoops — uniqueness', () => {
  it('reports each cycle exactly once even with multiple entry points', () => {
    const loops = loopsOf(
      [
        'stock A = 1',
        'stock B = 1',
        'stock C = 1',
        'flow fAB:',
        '    A -+> B',
        'flow fBC:',
        '    B -+> C',
        'flow fCA:',
        '    C -+> A',
        '',
      ].join('\n'),
    );
    expect(loops).toHaveLength(1);
    expect(loops[0]!.kind).toBe('R');
    expect(loops[0]!.nodes).toHaveLength(3);
  });
});
