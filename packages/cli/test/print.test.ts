/**
 * `sysdyn print` — structural summary of compiled program.
 */

import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { printCommand } from '../src/print.js';

const FIXTURES = resolve(__dirname, 'fixtures');

describe('sysdyn print', () => {
  it('prints time config, stocks, calcs, and flow effects', () => {
    const r = printCommand(resolve(FIXTURES, 'exp.sd'));
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toMatch(/start=0 end=5 step=1/);
    expect(r.stdout).toMatch(/constants:/);
    expect(r.stdout).toMatch(/K\s+\(slot 0\)/);
    expect(r.stdout).toMatch(/stocks:/);
    expect(r.stdout).toMatch(/X\s+\(slot 0\)/);
    expect(r.stdout).toMatch(/flow effects:/);
    expect(r.stdout).toMatch(/Growth: \+→ X/);
  });

  it('prints sweeps and scenarios when present', () => {
    const r = printCommand(resolve(FIXTURES, 'sweep_demo.sd'));
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toMatch(/scenarios:/);
    expect(r.stdout).toMatch(/Big\s+\(1 constants, 0 stocks\)/);
    expect(r.stdout).toMatch(/sweeps:/);
    expect(r.stdout).toMatch(/K = \[0\.1, 0\.2\]/);
  });

  it('exits 1 with diagnostic on an invalid model', () => {
    const r = printCommand(resolve(FIXTURES, 'cycle.sd'));
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toMatch(/SD0050/);
  });
});
