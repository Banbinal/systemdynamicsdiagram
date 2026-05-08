/**
 * `sysdyn print <file>` — print a structural summary of the compiled program.
 *
 * Useful for debugging desugar output and verifying topological order.
 * Format is human-readable, not machine-stable; tests assert key fragments.
 */

import { build, hasErrors } from '@sysdyn/core';

import {
  readSource,
  renderDiagnostics,
  type ExecResult,
} from './io.js';

export function printCommand(file: string): ExecResult {
  let src: { text: string; name: string };
  try {
    src = readSource(file);
  } catch (err) {
    return {
      exitCode: 2,
      stdout: '',
      stderr: `sysdyn print: ${(err as Error).message}\n`,
    };
  }

  const { program, diagnostics } = build(src.text, { fileName: src.name });
  const errStream = renderDiagnostics(diagnostics, src.name);
  if (hasErrors(diagnostics)) {
    return { exitCode: 1, stdout: '', stderr: errStream };
  }

  const lines: string[] = [];
  lines.push(`# ${program.title ?? src.name}`);
  lines.push(`time: start=${program.time.startTime} end=${program.time.endTime} step=${program.time.timeStep}`);
  lines.push('');

  if (program.constants.length > 0) {
    lines.push('constants:');
    for (const c of program.constants) lines.push(`  ${c.fqn}  (slot ${c.slot})`);
    lines.push('');
  }

  if (program.stocks.length > 0) {
    lines.push('stocks:');
    for (const s of program.stocks) {
      const tag = s.synthetic ? ' [synthetic]' : '';
      lines.push(`  ${s.fqn}  (slot ${s.slot})${tag}`);
    }
    lines.push('');
  }

  if (program.calcs.length > 0) {
    lines.push('calcs (topological order):');
    for (const c of program.calcs) lines.push(`  ${c.fqn}  (slot ${c.slot})`);
    lines.push('');
  }

  if (program.flowEffects.length > 0) {
    lines.push('flow effects:');
    for (const f of program.flowEffects) {
      const sign = f.polarity === 'positive' ? '+' : '-';
      const target = program.stocks.find((s) => s.slot === f.targetSlot)?.fqn ?? '?';
      lines.push(`  ${f.flowFqn}: ${sign}→ ${target}`);
    }
    lines.push('');
  }

  if (program.maps.length > 0) {
    lines.push('maps:');
    for (const m of program.maps) {
      lines.push(`  ${m.fqn}: ${m.interpolation} (${m.xs.length} points)`);
    }
    lines.push('');
  }

  if (program.scenarios.length > 0) {
    lines.push('scenarios:');
    for (const sc of program.scenarios) {
      const c = sc.constantOverrides.length;
      const s = sc.stockOverrides.length;
      lines.push(`  ${sc.name}  (${c} constants, ${s} stocks)`);
    }
    lines.push('');
  }

  if (program.sweeps.length > 0) {
    lines.push('sweeps:');
    for (const sw of program.sweeps) {
      lines.push(`  ${sw.target} = [${Array.from(sw.values).join(', ')}]`);
    }
    lines.push('');
  }

  if (program.limits.length > 0) {
    lines.push('limits:');
    for (const l of program.limits) {
      const parts: string[] = [];
      if (l.min !== undefined) parts.push(`min=${l.min}`);
      if (l.max !== undefined) parts.push(`max=${l.max}`);
      lines.push(`  ${l.fqn}  ${parts.join(' ')}`);
    }
    lines.push('');
  }

  return {
    exitCode: 0,
    stdout: lines.join('\n') + '\n',
    stderr: errStream, // surfaces non-error diagnostics (warnings/info)
  };
}
