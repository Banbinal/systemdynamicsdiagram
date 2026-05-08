/**
 * Dependency graph + cycle detection + topological sort.
 */

import { describe, expect, it } from 'vitest';

import { parse } from '../src/api/parse.js';
import { buildDepGraph, findCycles, topoSort } from '../src/semantic/deps.js';
import { resolve } from '../src/semantic/resolver.js';

function build(source: string) {
  const { ast, diagnostics: parseDiags } = parse(source);
  expect(parseDiags).toEqual([]);
  const r = resolve(ast);
  expect(r.diagnostics).toEqual([]);
  const graph = buildDepGraph(r.resolvedRefs, r.stmtSymbols);
  return { table: r.table, graph };
}

describe('deps — graph construction', () => {
  it('builds a calc-to-constant edge', () => {
    const { table, graph } = build('constant K = 2\ncalc D = K * 3\n');
    const k = table.byFqn('K')!.id;
    const d = table.byFqn('D')!.id;
    expect(graph.get(d)?.has(k)).toBe(true);
  });

  it('does not treat stock references as graph edges', () => {
    const src = [
      'stock A = 1',
      'constant K = 2',
      'calc D = A + K', // depends on stock A and constant K
      '',
    ].join('\n');
    const { table, graph } = build(src);
    const k = table.byFqn('K')!.id;
    const a = table.byFqn('A')!.id;
    const d = table.byFqn('D')!.id;
    expect(graph.get(d)?.has(k)).toBe(true);
    expect(graph.get(d)?.has(a)).toBe(false); // stock is a cut point
  });
});

describe('deps — cycle detection', () => {
  it('detects a direct calc-calc cycle', () => {
    const { graph } = build('calc A = B + 1\ncalc B = A + 1\n');
    const cycles = findCycles(graph);
    expect(cycles.length).toBe(1);
    expect(cycles[0]!.length).toBe(2);
  });

  it('detects a self-cycle', () => {
    const { graph } = build('calc A = A + 1\n');
    const cycles = findCycles(graph);
    expect(cycles.length).toBe(1);
    expect(cycles[0]!.length).toBe(1);
  });

  it('detects a longer indirect cycle', () => {
    const { graph } = build('calc A = B\ncalc B = C\ncalc C = A\n');
    const cycles = findCycles(graph);
    expect(cycles.length).toBe(1);
    expect(cycles[0]!.length).toBe(3);
  });

  it('does NOT flag stock-mediated cycles (stocks break dependency)', () => {
    // A → flow → S → calc → A: not a cycle in our sense.
    const src = [
      'stock S = 0',
      'calc A = S + 1',
      'flow F:',
      '    A -+> S',
      '',
    ].join('\n');
    const { graph } = build(src);
    const cycles = findCycles(graph);
    expect(cycles).toEqual([]);
  });

  it('emits no cycle for a clean DAG', () => {
    const { graph } = build('constant K = 1\ncalc A = K + 1\ncalc B = A + 1\n');
    expect(findCycles(graph)).toEqual([]);
  });
});

describe('deps — topological sort', () => {
  it('orders dependencies before dependents', () => {
    const { table, graph } = build('constant K = 1\ncalc A = K + 1\ncalc B = A + 1\n');
    const result = topoSort(graph);
    if ('cycles' in result) throw new Error('expected no cycles');
    const idx = (fqn: string) => result.order.indexOf(table.byFqn(fqn)!.id);
    expect(idx('K')).toBeLessThan(idx('A'));
    expect(idx('A')).toBeLessThan(idx('B'));
  });

  it('returns cycles when present', () => {
    const { graph } = build('calc A = B\ncalc B = A\n');
    const result = topoSort(graph);
    expect('cycles' in result).toBe(true);
  });
});
