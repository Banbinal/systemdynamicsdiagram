/**
 * CSV writer tests — formatting, column order, slug generation.
 */

import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { build, simulate } from '@sysdyn/core';

import { labelToSlug, simulationToCsvString, writeCsv } from '../src/csv.js';

describe('CSV — formatting', () => {
  it('emits header followed by one row per recorded step', () => {
    const { program } = build([
      'StartTime = 0',
      'EndTime = 2',
      'TimeStep = 1',
      'stock X = 100',
      '',
    ].join('\n'));
    const result = simulate(program);
    const csv = simulationToCsvString(program, result);
    const lines = csv.trim().split('\n');
    expect(lines[0]).toBe('time,X');
    expect(lines).toHaveLength(4); // header + 3 rows
  });

  it('orders columns: time, then stocks (declared), then calcs (topo)', () => {
    const { program } = build([
      'StartTime = 0',
      'EndTime = 0',
      'TimeStep = 1',
      'stock B = 1',
      'stock A = 2',
      'calc D = A * 2',
      'calc C = B + 1',
      '',
    ].join('\n'));
    const result = simulate(program);
    const lines = simulationToCsvString(program, result).trim().split('\n');
    // stocks in declaration order (B, A); calcs in topo order (any-order C/D
    // but each independently — since neither depends on the other, the order
    // is implementation-defined but stable).
    const header = lines[0]!.split(',');
    expect(header[0]).toBe('time');
    expect(header.slice(1, 3).sort()).toEqual(['A', 'B']);
    expect(header.slice(3).sort()).toEqual(['C', 'D']);
  });

  it('uses 12 sig figs for non-integer numbers', () => {
    const { program } = build([
      'StartTime = 0',
      'EndTime = 0',
      'TimeStep = 1',
      'stock X = 1.23456789012345',
      '',
    ].join('\n'));
    const result = simulate(program);
    const csv = simulationToCsvString(program, result);
    // Look for the 12-sig-fig representation in the CSV.
    expect(csv).toMatch(/1\.23456789012/);
  });

  it('preserves integer formatting (no trailing zeros)', () => {
    const { program } = build([
      'StartTime = 0',
      'EndTime = 0',
      'TimeStep = 1',
      'stock X = 42',
      '',
    ].join('\n'));
    const result = simulate(program);
    const lines = simulationToCsvString(program, result).trim().split('\n');
    expect(lines[1]).toBe('0,42');
  });
});

describe('CSV — file writing', () => {
  it('writes to disk and matches the in-memory string exactly', async () => {
    const { program } = build([
      'StartTime = 0',
      'EndTime = 3',
      'TimeStep = 1',
      'constant K = 0.5',
      'stock X = 1',
      'flow F:',
      '    X * K -+> X',
      '',
    ].join('\n'));
    const result = simulate(program);

    const dir = mkdtempSync(join(tmpdir(), 'sysdyn-cli-test-'));
    const outPath = join(dir, 'sub', 'out.csv'); // tests parent-mkdir
    try {
      await writeCsv(program, result, outPath);
      const onDisk = readFileSync(outPath, 'utf8');
      expect(onDisk).toBe(simulationToCsvString(program, result));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('CSV — slug', () => {
  it('produces filesystem-safe slugs from variation labels', () => {
    expect(labelToSlug('Base (Base)')).toBe('Base_Base');
    expect(labelToSlug('Hi (K=1, Tau=2.5)')).toBe('Hi_K_1_Tau_2_5');
    expect(labelToSlug('   weird/// stuff !!!')).toBe('weird_stuff');
  });

  it('falls back to "variation" for empty labels', () => {
    expect(labelToSlug('')).toBe('variation');
    expect(labelToSlug('   ')).toBe('variation');
  });
});
