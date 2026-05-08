/**
 * `sysdyn check` — exit codes and diagnostic rendering.
 */

import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { checkCommand } from '../src/check.js';

const FIXTURES = resolve(__dirname, 'fixtures');

describe('sysdyn check', () => {
  it('exits 0 on a valid model', () => {
    const r = checkCommand(resolve(FIXTURES, 'exp.sd'));
    expect(r.exitCode).toBe(0);
    expect(r.stderr).toBe('');
    expect(r.stdout).toMatch(/OK \(no errors\)/);
  });

  it('exits 1 on a model with errors', () => {
    const r = checkCommand(resolve(FIXTURES, 'cycle.sd'));
    expect(r.exitCode).toBe(1);
    // SD0050 is the cycle code from the dep graph.
    expect(r.stderr).toMatch(/SD0050/);
  });

  it('exits 2 on an unreadable file', () => {
    const r = checkCommand(resolve(FIXTURES, 'nope-does-not-exist.sd'));
    expect(r.exitCode).toBe(2);
    expect(r.stderr).toMatch(/sysdyn check:/);
  });
});
