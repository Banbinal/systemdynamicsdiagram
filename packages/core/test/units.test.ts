/**
 * Units & dimensional consistency tests.
 *
 * Covers the parser (syntax acceptance), the units module (algebra), and
 * the compile-time check (warnings on mismatched +/-).
 */

import { describe, expect, it } from 'vitest';

import { compile } from '../src/api/compile.js';
import { parse } from '../src/api/parse.js';
import {
  EMPTY,
  div,
  equal,
  format,
  mul,
  parseUnitTokens,
  pow,
  type UnitToken,
} from '../src/semantic/units.js';

function compileFor(src: string) {
  const { ast, diagnostics: parseDiags } = parse(src);
  expect(parseDiags.filter((d) => d.severity === 'error')).toEqual([]);
  return compile(ast);
}

function tokens(...args: ({ ident: string } | { num: number } | '*' | '/' | '^')[]): UnitToken[] {
  return args.map((a) => {
    if (typeof a === 'string') {
      if (a === '*') return { kind: 'star', text: '*' };
      if (a === '/') return { kind: 'slash', text: '/' };
      if (a === '^') return { kind: 'caret', text: '^' };
      throw new Error('bad token');
    }
    if ('ident' in a) return { kind: 'ident', text: a.ident };
    return { kind: 'number', text: String(a.num), value: a.num };
  });
}

describe('units — algebra', () => {
  it('mul / div add and subtract exponents', () => {
    const m = new Map([['m', 1]]);
    const s = new Map([['s', 1]]);
    expect([...mul(m, s).entries()]).toEqual([['m', 1], ['s', 1]]);
    expect([...div(m, s).entries()]).toEqual([['m', 1], ['s', -1]]);
  });

  it('pow scales exponents and drops zeros', () => {
    const ms = new Map([['m', 1], ['s', -1]]);
    expect([...pow(ms, 2).entries()]).toEqual([['m', 2], ['s', -2]]);
    expect([...pow(ms, 0).entries()]).toEqual([]);
  });

  it('equal compares maps including the empty=dimensionless case', () => {
    expect(equal(EMPTY, new Map())).toBe(true);
    expect(equal(new Map([['m', 1]]), new Map([['m', 1]]))).toBe(true);
    expect(equal(new Map([['m', 1]]), new Map([['s', 1]]))).toBe(false);
  });

  it('format pretty-prints num/den / dimensionless', () => {
    expect(format(EMPTY)).toBe('');
    expect(format(new Map([['m', 1]]))).toBe('m');
    expect(format(new Map([['m', 3], ['s', -1]]))).toBe('m^3/s');
    expect(format(new Map([['year', -1]]))).toBe('1/year');
  });
});

describe('units — token parsing', () => {
  it('parses simple identifier', () => {
    const r = parseUnitTokens(tokens({ ident: 'people' }));
    expect(r.errors).toEqual([]);
    expect(format(r.units)).toBe('people');
  });

  it('parses 1/year', () => {
    const r = parseUnitTokens(tokens({ num: 1 }, '/', { ident: 'year' }));
    expect(r.errors).toEqual([]);
    expect(format(r.units)).toBe('1/year');
  });

  it('parses m^3/s', () => {
    const r = parseUnitTokens(tokens({ ident: 'm' }, '^', { num: 3 }, '/', { ident: 's' }));
    expect(r.errors).toEqual([]);
    expect(format(r.units)).toBe('m^3/s');
  });

  it('reports an error on a bad numeric factor', () => {
    const r = parseUnitTokens(tokens({ num: 5 }, '/', { ident: 'year' }));
    expect(r.errors.length).toBeGreaterThan(0);
  });
});

describe('units — compile-time check', () => {
  it('passes when both sides of + share units', () => {
    const { diagnostics } = compileFor(
      [
        'constant a = 100 [people]',
        'constant b = 50 [people]',
        'calc Sum = a + b',
        '',
      ].join('\n'),
    );
    const warns = diagnostics.filter((d) => d.code === 'SD0072');
    expect(warns).toEqual([]);
  });

  it('warns when + crosses different units', () => {
    const { diagnostics } = compileFor(
      [
        'constant a = 100 [people]',
        'constant b = 5 [year]',
        'calc Bad = a + b',
        '',
      ].join('\n'),
    );
    const warns = diagnostics.filter((d) => d.code === 'SD0072');
    expect(warns.length).toBe(1);
    expect(warns[0]!.message).toMatch(/people.*year|year.*people/);
  });

  it('combines units across * and /', () => {
    const { diagnostics } = compileFor(
      [
        'constant Pop = 100 [people]',
        'constant Rate = 0.05 [1/year]',
        'constant Birth = 1 [people/year]',
        // Pop * Rate = people/year — should match Birth declared units.
        'calc Diff = Pop * Rate - Birth',
        '',
      ].join('\n'),
    );
    expect(diagnostics.filter((d) => d.code === 'SD0072')).toEqual([]);
  });

  it('warns when an exp/log argument is not dimensionless', () => {
    const { diagnostics } = compileFor(
      [
        'constant Pop = 100 [people]',
        'calc E = exp(Pop)',
        '',
      ].join('\n'),
    );
    const warns = diagnostics.filter((d) => d.code === 'SD0072');
    expect(warns.some((w) => w.message.includes('exp'))).toBe(true);
  });

  it('does not warn when units are not declared (no annotations)', () => {
    const { diagnostics } = compileFor(
      [
        'constant a = 100',
        'constant b = 5',
        'calc Sum = a + b',
        '',
      ].join('\n'),
    );
    expect(diagnostics.filter((d) => d.code === 'SD0072')).toEqual([]);
  });
});
