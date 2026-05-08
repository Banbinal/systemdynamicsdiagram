/**
 * `sysdyn run` — single run, multi-variation, sweeps, scenarios, output paths.
 */

import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { runCommand } from '../src/run.js';

const FIXTURES = resolve(__dirname, 'fixtures');

function withTempDir<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = mkdtempSync(join(tmpdir(), 'sysdyn-cli-test-'));
  return fn(dir).finally(() => rmSync(dir, { recursive: true, force: true }));
}

describe('sysdyn run — single', () => {
  it('emits CSV to stdout when no --csv is given', async () => {
    const r = await runCommand(resolve(FIXTURES, 'exp.sd'));
    expect(r.exitCode).toBe(0);
    expect(r.stderr).toBe('');
    const lines = r.stdout.trim().split('\n');
    expect(lines[0]).toMatch(/^time,X$/);
    expect(lines).toHaveLength(7); // header + 6 steps (t=0..5)
  });

  it('writes CSV to a file when --csv is given', async () => {
    await withTempDir(async (dir) => {
      const csvPath = join(dir, 'out.csv');
      const r = await runCommand(resolve(FIXTURES, 'exp.sd'), { csv: csvPath });
      expect(r.exitCode).toBe(0);
      expect(existsSync(csvPath)).toBe(true);
      const content = readFileSync(csvPath, 'utf8');
      expect(content.split('\n')[0]).toBe('time,X');
    });
  });

  it('exit 1 + diagnostics on a model with compile errors', async () => {
    const r = await runCommand(resolve(FIXTURES, 'cycle.sd'));
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toMatch(/SD0050/);
  });

  it('exit 2 on unknown solver', async () => {
    const r = await runCommand(resolve(FIXTURES, 'exp.sd'), { solver: 'rk5' as 'rk4' });
    expect(r.exitCode).toBe(2);
    expect(r.stderr).toMatch(/unknown --solver/);
  });

  it('exit 2 on missing file', async () => {
    const r = await runCommand(resolve(FIXTURES, 'nope.sd'));
    expect(r.exitCode).toBe(2);
    expect(r.stderr).toMatch(/sysdyn run:/);
  });
});

describe('sysdyn run — scenarios', () => {
  it('applies --scenario to override constants', async () => {
    const r = await runCommand(resolve(FIXTURES, 'sweep_demo.sd'), { scenario: 'Big' });
    expect(r.exitCode).toBe(0);
    // X = K. With Big scenario, K = 1, so X starts at 1.
    const lines = r.stdout.trim().split('\n');
    const firstRow = lines[1]!.split(',');
    expect(Number(firstRow[1])).toBe(1);
  });

  it('emits SD0082 on unknown scenario name', async () => {
    const r = await runCommand(resolve(FIXTURES, 'exp.sd'), { scenario: 'Nope' });
    // Sim diagnostics still surface in stderr but exit code is 0 (Base ran).
    expect(r.stderr).toMatch(/SD0082/);
  });
});

describe('sysdyn run — sweeps and --all', () => {
  it('--all produces multiple CSV blocks separated by # label headers', async () => {
    const r = await runCommand(resolve(FIXTURES, 'sweep_demo.sd'), { all: true });
    expect(r.exitCode).toBe(0);
    // sweep K has 2 values; 2 scenarios (Base + Big) → 4 variations.
    const labels = r.stdout.match(/^# .*$/gm)!;
    expect(labels).toHaveLength(4);
  });

  it('--all -o writes one CSV per variation plus index.json', async () => {
    await withTempDir(async (dir) => {
      const r = await runCommand(resolve(FIXTURES, 'sweep_demo.sd'), {
        all: true,
        outDir: dir,
      });
      expect(r.exitCode).toBe(0);
      const files = readdirSync(dir);
      // 4 variations + 1 index.json = 5 files.
      expect(files.length).toBe(5);
      expect(files).toContain('index.json');
      const index = JSON.parse(readFileSync(join(dir, 'index.json'), 'utf8'));
      expect(index.variations).toHaveLength(4);
      // Each entry has a corresponding CSV file.
      for (const entry of index.variations) {
        expect(existsSync(join(dir, entry.file))).toBe(true);
      }
    });
  });

  it('--sweep K=0.1,0.2,0.3 adds runtime sweep values', async () => {
    const r = await runCommand(resolve(FIXTURES, 'exp.sd'), {
      sweep: ['K=0.1,0.2,0.3'],
    });
    expect(r.exitCode).toBe(0);
    const labels = r.stdout.match(/^# .*$/gm)!;
    expect(labels).toHaveLength(3);
    expect(r.stdout).toMatch(/K=0\.1/);
    expect(r.stdout).toMatch(/K=0\.2/);
    expect(r.stdout).toMatch(/K=0\.3/);
  });

  it('exit 2 on a malformed --sweep entry', async () => {
    const r = await runCommand(resolve(FIXTURES, 'exp.sd'), {
      sweep: ['no equals'],
    });
    expect(r.exitCode).toBe(2);
    expect(r.stderr).toMatch(/malformed --sweep/);
  });

  it('exit 2 when --sweep targets an unknown constant', async () => {
    const r = await runCommand(resolve(FIXTURES, 'exp.sd'), {
      sweep: ['Bogus=1,2,3'],
    });
    expect(r.exitCode).toBe(2);
    expect(r.stderr).toMatch(/not a declared constant/);
  });

  it('exit 2 when --sweep value list is non-numeric', async () => {
    const r = await runCommand(resolve(FIXTURES, 'exp.sd'), {
      sweep: ['K=1,abc,3'],
    });
    expect(r.exitCode).toBe(2);
    expect(r.stderr).toMatch(/non-numeric value/);
  });
});
