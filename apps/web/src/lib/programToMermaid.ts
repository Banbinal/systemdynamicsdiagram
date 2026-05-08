import type { CompiledProgram } from '@sysdyn/core';

/**
 * Render a `CompiledProgram` as a Mermaid `flowchart LR` source string.
 *
 *   – Stocks become rectangular nodes.
 *   – Flows become rhombus nodes; their effects determine arrow direction:
 *       · only positive effects on stock S → cloud → flow → S
 *       · only negative effects on stock S → S → flow → cloud
 *       · both                              → src_stock → flow → dst_stock
 *   – Synthetic stocks (smooth/delay3 desugaring) are hidden.
 *   – Modules become `subgraph` blocks for multi-module models.
 */
export function programToMermaid(program: CompiledProgram): string {
  if (program.stocks.length === 0 && program.flowEffects.length === 0) {
    return 'flowchart LR\n  empty["No stocks or flows defined"]';
  }

  const lines: string[] = ['flowchart LR'];

  const slotToFqn = new Map<number, string>();
  for (const s of program.stocks) {
    if (!s.synthetic) slotToFqn.set(s.slot, s.fqn);
  }

  type Eff = { stockFqn: string; polarity: 'positive' | 'negative' };
  const flows = new Map<string, Eff[]>();
  for (const eff of program.flowEffects) {
    const fqn = slotToFqn.get(eff.targetSlot);
    if (!fqn) continue;
    let arr = flows.get(eff.flowFqn);
    if (!arr) {
      arr = [];
      flows.set(eff.flowFqn, arr);
    }
    arr.push({ stockFqn: fqn, polarity: eff.polarity });
  }

  // Group nodes by their parent namespace so we can emit subgraphs.
  const stocksByModule = groupByModule(
    program.stocks.filter((s) => !s.synthetic).map((s) => s.fqn),
  );
  const flowsByModule = groupByModule([...flows.keys()]);

  const idOf = (fqn: string) => 'n_' + fqn.replace(/[.\s]/g, '_');
  const shortName = (fqn: string) => {
    const i = fqn.lastIndexOf('.');
    return i < 0 ? fqn : fqn.slice(i + 1);
  };
  const escLabel = (s: string) => s.replace(/"/g, '#quot;');

  const allModules = new Set<string>([
    ...stocksByModule.keys(),
    ...flowsByModule.keys(),
  ]);
  // Emit nodes — top-level (no module) first, then each module subgraph.
  const topLevelStocks = stocksByModule.get('') ?? [];
  const topLevelFlows = flowsByModule.get('') ?? [];

  for (const fqn of topLevelStocks) {
    lines.push(`  ${idOf(fqn)}["${escLabel(shortName(fqn))}"]:::stock`);
  }
  for (const fqn of topLevelFlows) {
    lines.push(`  ${idOf(fqn)}{{"${escLabel(shortName(fqn))}"}}:::flow`);
  }

  for (const moduleFqn of allModules) {
    if (moduleFqn === '') continue;
    const sgId = 'mod_' + moduleFqn.replace(/[.\s]/g, '_');
    const sgLabel = escLabel(moduleFqn);
    lines.push(`  subgraph ${sgId}["${sgLabel}"]`);
    lines.push(`    direction TB`);
    for (const fqn of stocksByModule.get(moduleFqn) ?? []) {
      lines.push(`    ${idOf(fqn)}["${escLabel(shortName(fqn))}"]:::stock`);
    }
    for (const fqn of flowsByModule.get(moduleFqn) ?? []) {
      lines.push(`    ${idOf(fqn)}{{"${escLabel(shortName(fqn))}"}}:::flow`);
    }
    lines.push(`  end`);
  }

  // Edges — clouds get unique IDs as we emit them so we don't reuse one cloud across flows.
  let cloudIdx = 0;
  for (const [flowFqn, effs] of flows) {
    const flowId = idOf(flowFqn);
    const positives = effs.filter((e) => e.polarity === 'positive');
    const negatives = effs.filter((e) => e.polarity === 'negative');

    if (positives.length === 0 && negatives.length === 0) continue;

    if (positives.length > 0 && negatives.length === 0) {
      const cloud = `cloud_${cloudIdx++}`;
      lines.push(`  ${cloud}(("&nbsp;")):::cloud`);
      lines.push(`  ${cloud} --> ${flowId}`);
      for (const e of positives) lines.push(`  ${flowId} --> ${idOf(e.stockFqn)}`);
    } else if (negatives.length > 0 && positives.length === 0) {
      const cloud = `cloud_${cloudIdx++}`;
      lines.push(`  ${cloud}(("&nbsp;")):::cloud`);
      for (const e of negatives) lines.push(`  ${idOf(e.stockFqn)} --> ${flowId}`);
      lines.push(`  ${flowId} --> ${cloud}`);
    } else {
      for (const e of negatives) lines.push(`  ${idOf(e.stockFqn)} --> ${flowId}`);
      for (const e of positives) lines.push(`  ${flowId} --> ${idOf(e.stockFqn)}`);
    }
  }

  // Class definitions — match the light pro palette in styles/index.css.
  lines.push('  classDef stock fill:#FFFFFF,stroke:#1F1F1F,stroke-width:1.5px,color:#1F1F1F');
  lines.push('  classDef flow fill:#F4EFE6,stroke:#A0742E,stroke-width:1px,color:#1F1F1F');
  lines.push('  classDef cloud fill:#F0EEEA,stroke:#B8B5AE,stroke-width:1px,color:#8E8C86');

  return lines.join('\n');
}

function groupByModule(fqns: readonly string[]): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const fqn of fqns) {
    const i = fqn.lastIndexOf('.');
    const mod = i < 0 ? '' : fqn.slice(0, i);
    let arr = out.get(mod);
    if (!arr) {
      arr = [];
      out.set(mod, arr);
    }
    arr.push(fqn);
  }
  return out;
}
