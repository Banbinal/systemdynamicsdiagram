/**
 * Parser tests. Covers each grammar construct and key error paths.
 *
 * Strategy: parse a small fixture per construct, assert the AST shape
 * (kind, names, structure). Snapshot-style assertions are kept narrow so the
 * tests stay readable and tightly scoped to behavior.
 */

import { describe, expect, it } from 'vitest';

import { parse } from '../src/api/parse.js';
import type {
  BinaryExpr,
  CalcStmt,
  CallExpr,
  ConstantStmt,
  FlowStmt,
  LimitStmt,
  MapStmt,
  ModuleStmt,
  NumberLit,
  PlotStmt,
  RefExpr,
  ScenarioStmt,
  StockStmt,
  SweepStmt,
  TimeConfigStmt,
  TitleStmt,
  UnaryExpr,
} from '../src/syntax/ast.js';

function parseOk(source: string) {
  const { ast, diagnostics } = parse(source);
  expect(diagnostics).toEqual([]);
  return ast;
}

describe('parser — top-level statements', () => {
  it('time config', () => {
    const ast = parseOk(['StartTime = 0', 'EndTime = 10', 'TimeStep = 0.5'].join('\n'));
    expect(ast.body).toHaveLength(3);
    expect(ast.body.map((s) => (s as TimeConfigStmt).key)).toEqual([
      'StartTime',
      'EndTime',
      'TimeStep',
    ]);
    expect(ast.body.map((s) => (s as TimeConfigStmt).value)).toEqual([0, 10, 0.5]);
  });

  it('title (multi-word)', () => {
    const ast = parseOk('title Toy population model');
    const t = ast.body[0] as TitleStmt;
    expect(t.kind).toBe('Title');
    expect(t.text).toBe('Toy population model');
  });

  it('constant, stock, calc', () => {
    const ast = parseOk(['constant K = 1.5', 'stock A = 100', 'calc D = A * K'].join('\n'));
    const [c, s, calc] = ast.body as [ConstantStmt, StockStmt, CalcStmt];
    expect(c.kind).toBe('Constant');
    expect(c.name).toBe('K');
    expect((c.expr as NumberLit).value).toBe(1.5);
    expect(s.kind).toBe('Stock');
    expect(s.name).toBe('A');
    expect(calc.kind).toBe('Calc');
    expect((calc.expr as BinaryExpr).op).toBe('*');
  });

  it('plot, limit', () => {
    const ast = parseOk('plot Demography.Population\nlimit Demography.Population min=0\n');
    const p = ast.body[0] as PlotStmt;
    expect(p.target.path).toEqual(['Demography', 'Population']);
    const l = ast.body[1] as LimitStmt;
    expect(l.target.path).toEqual(['Demography', 'Population']);
    expect(l.min).toBe(0);
    expect(l.max).toBeUndefined();
  });

  it('limit with both min and max (negative number)', () => {
    const ast = parseOk('limit X min=-5 max=10\n');
    const l = ast.body[0] as LimitStmt;
    expect(l.min).toBe(-5);
    expect(l.max).toBe(10);
  });
});

describe('parser — flows', () => {
  it('parses a flow with two effects (positive and negative)', () => {
    const src = [
      'flow Population:',
      '    Pop * Birth -+> Pop',
      '    Pop * Death --> Pop',
      '',
    ].join('\n');
    const ast = parseOk(src);
    const f = ast.body[0] as FlowStmt;
    expect(f.kind).toBe('Flow');
    expect(f.name).toBe('Population');
    expect(f.effects).toHaveLength(2);
    expect(f.effects[0]!.polarity).toBe('positive');
    expect(f.effects[1]!.polarity).toBe('negative');
    expect(f.effects[0]!.target.path).toEqual(['Pop']);
  });

  it('rejects flow whose body has no valid effects', () => {
    // Body parses INDENT/DEDENT but every effect fails (no polarity arrow).
    const { diagnostics } = parse('flow F:\n    bad stuff\n');
    expect(diagnostics.some((d) => d.code === 'SD0026')).toBe(true);
  });
});

describe('parser — maps', () => {
  it('parses a linear map with three points', () => {
    const src = [
      'map Response: linear',
      '    (0, 0)',
      '    (1, 0.5)',
      '    (2, 0.9)',
      '',
    ].join('\n');
    const ast = parseOk(src);
    const m = ast.body[0] as MapStmt;
    expect(m.kind).toBe('Map');
    expect(m.interpolation).toBe('linear');
    expect(m.points.map((p) => [p.x, p.y])).toEqual([
      [0, 0],
      [1, 0.5],
      [2, 0.9],
    ]);
  });

  it('parses spline and step interpolation tags', () => {
    const ast1 = parseOk('map A: spline\n    (0, 1)\n    (1, 0)\n');
    expect((ast1.body[0] as MapStmt).interpolation).toBe('spline');

    const ast2 = parseOk('map B: step\n    (0, 1)\n    (1, 0)\n');
    expect((ast2.body[0] as MapStmt).interpolation).toBe('step');
  });

  it('rejects invalid interpolation tag', () => {
    const { diagnostics } = parse('map M: bezier\n    (0, 0)\n    (1, 1)\n');
    expect(diagnostics.some((d) => d.code === 'SD0024')).toBe(true);
  });

  it('rejects map with fewer than 2 points', () => {
    const { diagnostics } = parse('map M: linear\n    (0, 0)\n');
    expect(diagnostics.some((d) => d.code === 'SD0027')).toBe(true);
  });
});

describe('parser — modules', () => {
  it('parses a nested module', () => {
    const src = [
      'module Demography:',
      '    stock Population = 1000',
      '    constant BirthRate = 0.03',
      '    flow Births:',
      '        Population * BirthRate -+> Population',
      '',
    ].join('\n');
    const ast = parseOk(src);
    const m = ast.body[0] as ModuleStmt;
    expect(m.kind).toBe('Module');
    expect(m.name).toBe('Demography');
    expect(m.body).toHaveLength(3);
    expect(m.body[0]!.kind).toBe('Stock');
    expect(m.body[1]!.kind).toBe('Constant');
    expect(m.body[2]!.kind).toBe('Flow');
  });

  it('rejects module whose body produces no statements', () => {
    // Body has tokens (INDENT emitted) but every entry fails parseTopStmt.
    const src = ['module Empty:', '    bogus content', ''].join('\n');
    const { diagnostics } = parse(src);
    expect(diagnostics.some((d) => d.code === 'SD0028')).toBe(true);
  });
});

describe('parser — scenarios', () => {
  it('parses a scenario with constant and stock overrides', () => {
    const src = [
      'scenario HighGrowth:',
      '    constant BirthRate = 0.05',
      '    stock Demography.Population = 2000',
      '',
    ].join('\n');
    const ast = parseOk(src);
    const s = ast.body[0] as ScenarioStmt;
    expect(s.kind).toBe('Scenario');
    expect(s.name).toBe('HighGrowth');
    expect(s.overrides).toHaveLength(2);
    expect(s.overrides[0]!.targetKind).toBe('constant');
    expect(s.overrides[0]!.target.path).toEqual(['BirthRate']);
    expect(s.overrides[1]!.targetKind).toBe('stock');
    expect(s.overrides[1]!.target.path).toEqual(['Demography', 'Population']);
  });

  it('rejects override without explicit constant/stock keyword', () => {
    const src = ['scenario X:', '    BirthRate = 0.05', ''].join('\n');
    const { diagnostics } = parse(src);
    expect(diagnostics.some((d) => d.code === 'SD0023')).toBe(true);
  });
});

describe('parser — sweeps', () => {
  it('parses a sweep on a dotted target', () => {
    const ast = parseOk('sweep Loan.InterestRate = [0.03, 0.04, 0.05]\n');
    const s = ast.body[0] as SweepStmt;
    expect(s.kind).toBe('Sweep');
    expect(s.target.path).toEqual(['Loan', 'InterestRate']);
    expect([...s.values]).toEqual([0.03, 0.04, 0.05]);
  });

  it('parses negative values in sweep', () => {
    const ast = parseOk('sweep R = [-1, 0, 1]\n');
    expect([...((ast.body[0] as SweepStmt).values)]).toEqual([-1, 0, 1]);
  });

  it('rejects empty sweep value list', () => {
    const { diagnostics } = parse('sweep R = []\n');
    expect(diagnostics.some((d) => d.code === 'SD0025')).toBe(true);
  });

  it('parses sweep with implicit line joining inside brackets', () => {
    const ast = parseOk('sweep R = [\n  0.01,\n  0.02,\n  0.03\n]\n');
    expect([...((ast.body[0] as SweepStmt).values)]).toEqual([0.01, 0.02, 0.03]);
  });
});

describe('parser — expressions', () => {
  it('respects precedence: + before *', () => {
    const ast = parseOk('calc X = 1 + 2 * 3\n');
    const expr = (ast.body[0] as CalcStmt).expr as BinaryExpr;
    expect(expr.op).toBe('+');
    expect((expr.left as NumberLit).value).toBe(1);
    expect((expr.right as BinaryExpr).op).toBe('*');
  });

  it('left-associative: a - b - c → (a - b) - c', () => {
    const ast = parseOk('calc X = 10 - 3 - 2\n');
    const expr = (ast.body[0] as CalcStmt).expr as BinaryExpr;
    expect(expr.op).toBe('-');
    expect((expr.left as BinaryExpr).op).toBe('-');
    expect((expr.right as NumberLit).value).toBe(2);
  });

  it('right-associative: a ^ b ^ c → a ^ (b ^ c)', () => {
    const ast = parseOk('calc X = 2 ^ 3 ^ 2\n');
    const expr = (ast.body[0] as CalcStmt).expr as BinaryExpr;
    expect(expr.op).toBe('^');
    expect((expr.left as NumberLit).value).toBe(2);
    expect((expr.right as BinaryExpr).op).toBe('^');
  });

  it('parens override precedence', () => {
    const ast = parseOk('calc X = (1 + 2) * 3\n');
    const expr = (ast.body[0] as CalcStmt).expr as BinaryExpr;
    expect(expr.op).toBe('*');
    expect((expr.left as BinaryExpr).op).toBe('+');
  });

  it('unary minus and plus', () => {
    const ast = parseOk('calc X = -5 + +3\n');
    const expr = (ast.body[0] as CalcStmt).expr as BinaryExpr;
    expect(expr.op).toBe('+');
    expect((expr.left as UnaryExpr).op).toBe('-');
    expect((expr.right as UnaryExpr).op).toBe('+');
  });

  it('function call with multiple args', () => {
    const ast = parseOk('calc X = max(0, min(10, Population))\n');
    const expr = (ast.body[0] as CalcStmt).expr as CallExpr;
    expect(expr.kind).toBe('Call');
    expect(expr.callee).toBe('max');
    expect(expr.args).toHaveLength(2);
    expect((expr.args[1] as CallExpr).callee).toBe('min');
  });

  it('dotted reference', () => {
    const ast = parseOk('calc X = Demography.Population * 2\n');
    const expr = (ast.body[0] as CalcStmt).expr as BinaryExpr;
    expect((expr.left as RefExpr).path).toEqual(['Demography', 'Population']);
  });

  it('comparison and logical operators', () => {
    const ast = parseOk('calc X = (a > 0) && (b <= 1)\n');
    const expr = (ast.body[0] as CalcStmt).expr as BinaryExpr;
    expect(expr.op).toBe('&&');
  });
});

describe('parser — error recovery', () => {
  it('reports an error and continues to next statement', () => {
    const src = ['constant A = ', 'stock B = 1', ''].join('\n');
    const { ast, diagnostics } = parse(src);
    expect(diagnostics.some((d) => d.code === 'SD0022')).toBe(true);
    // Recovery: stock B should still be parsed
    expect(ast.body.some((s) => s.kind === 'Stock' && s.name === 'B')).toBe(true);
  });

  it('reports unexpected top-level token', () => {
    const { diagnostics } = parse('5 + 3\n');
    expect(diagnostics.some((d) => d.code === 'SD0020')).toBe(true);
  });

  it('reports missing newline between statements (lexer enforces this implicitly)', () => {
    // Two statements on one line via implicit line joining isn't supported;
    // this should fail in the parser when the second `stock` keyword appears
    // mid-expression.
    const { diagnostics } = parse('stock A = 1 stock B = 2\n');
    expect(diagnostics.length).toBeGreaterThan(0);
  });
});

describe('parser — full integration', () => {
  it('parses a small population model end-to-end', () => {
    const src = [
      'title Toy population',
      'StartTime = 0',
      'EndTime = 10',
      'TimeStep = 0.1',
      '',
      'stock Population = 100',
      'constant BirthRate = 0.03',
      'constant DeathRate = 0.01',
      '',
      'flow Births:',
      '    Population * BirthRate -+> Population',
      '',
      'flow Deaths:',
      '    Population * DeathRate --> Population',
      '',
      'plot Population',
      '',
    ].join('\n');
    const ast = parseOk(src);
    const kinds = ast.body.map((s) => s.kind);
    expect(kinds).toEqual([
      'Title',
      'TimeConfig',
      'TimeConfig',
      'TimeConfig',
      'Stock',
      'Constant',
      'Constant',
      'Flow',
      'Flow',
      'Plot',
    ]);
  });
});
