/**
 * Resolver tests: name resolution, namespace scoping, duplicate detection,
 * unresolved references, reserved names.
 */

import { describe, expect, it } from 'vitest';

import { parse } from '../src/api/parse.js';
import { resolve } from '../src/semantic/resolver.js';

function resolveSource(source: string) {
  const { ast, diagnostics: parseDiags } = parse(source);
  expect(parseDiags).toEqual([]);
  return resolve(ast);
}

describe('resolver — symbol table', () => {
  it('declares symbols for top-level constructs', () => {
    const { table, diagnostics } = resolveSource(
      'constant K = 1\nstock A = 0\ncalc D = A + K\n',
    );
    expect(diagnostics).toEqual([]);
    expect(table.byFqn('K')?.kind).toBe('constant');
    expect(table.byFqn('A')?.kind).toBe('stock');
    expect(table.byFqn('D')?.kind).toBe('calc');
  });

  it('namespaces module symbols with dotted names', () => {
    const src = [
      'module Demography:',
      '    stock Population = 1000',
      '    constant BirthRate = 0.03',
      '',
    ].join('\n');
    const { table, diagnostics } = resolveSource(src);
    expect(diagnostics).toEqual([]);
    expect(table.byFqn('Demography.Population')?.kind).toBe('stock');
    expect(table.byFqn('Demography.BirthRate')?.kind).toBe('constant');
  });

  it('detects duplicate declarations', () => {
    const { diagnostics } = resolveSource('stock A = 1\nconstant A = 2\n');
    expect(diagnostics.some((d) => d.code === 'SD0040')).toBe(true);
  });

  it('rejects redeclaration of the reserved name `time`', () => {
    const { diagnostics } = resolveSource('stock time = 0\n');
    expect(diagnostics.some((d) => d.code === 'SD0042')).toBe(true);
  });

  it('declares builtins so calls to them resolve', () => {
    const { diagnostics } = resolveSource('calc X = max(0, sqrt(2))\n');
    expect(diagnostics).toEqual([]);
  });
});

describe('resolver — references', () => {
  it('resolves a same-scope reference', () => {
    const { resolvedRefs, table, diagnostics } = resolveSource(
      'constant K = 2\ncalc D = K * 3\n',
    );
    expect(diagnostics).toEqual([]);
    const expected = table.byFqn('K');
    let found = false;
    for (const [, sym] of resolvedRefs) {
      if (sym === expected) found = true;
    }
    expect(found).toBe(true);
  });

  it('resolves outward (Python-like) lexical scope from inside a module', () => {
    const src = [
      'constant Outer = 5',
      'module M:',
      '    calc X = Outer * 2',
      '',
    ].join('\n');
    const { diagnostics } = resolveSource(src);
    expect(diagnostics).toEqual([]);
  });

  it('resolves dotted cross-module references', () => {
    const src = [
      'module A:',
      '    constant K = 5',
      'module B:',
      '    calc X = A.K * 2',
      '',
    ].join('\n');
    const { diagnostics } = resolveSource(src);
    expect(diagnostics).toEqual([]);
  });

  it('reports an unresolved reference', () => {
    const { diagnostics } = resolveSource('calc X = NoSuchName + 1\n');
    expect(diagnostics.some((d) => d.code === 'SD0041')).toBe(true);
  });

  it('reports an unresolved function call', () => {
    const { diagnostics } = resolveSource('calc X = bogusfunc(1)\n');
    expect(diagnostics.some((d) => d.code === 'SD0041')).toBe(true);
  });

  it('resolves time as a builtin reference (no error)', () => {
    const { diagnostics } = resolveSource('calc T = time * 2\n');
    expect(diagnostics).toEqual([]);
  });

  it('resolves flow effect targets as stocks', () => {
    const src = [
      'stock Pop = 100',
      'constant Birth = 0.03',
      'flow Births:',
      '    Pop * Birth -+> Pop',
      '',
    ].join('\n');
    const { diagnostics } = resolveSource(src);
    expect(diagnostics).toEqual([]);
  });

  it('reports flow targeting a non-stock', () => {
    const src = [
      'constant K = 1',
      'stock S = 0',
      'flow F:',
      '    S * 0.1 -+> K',
      '',
    ].join('\n');
    const { diagnostics } = resolveSource(src);
    // K is a constant, not a stock — should error
    expect(diagnostics.some((d) => d.code === 'SD0041')).toBe(true);
  });
});
