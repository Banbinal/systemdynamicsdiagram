import type { CompiledProgram } from '@sysdyn/core';

export interface MermaidRenderOptions {
  /**
   * When true (default), calc/constant/map nodes and information-link arcs
   * are emitted. When false, only stocks, flows, clouds and matter-flow arcs
   * appear — closer to a bare reservoir-and-valve schematic.
   */
  readonly showAuxiliaries?: boolean;
}

/**
 * Render a `CompiledProgram` as a Mermaid `flowchart LR` source string.
 *
 * Conventions (closer to canonical SD than the previous bare reservoir view):
 *   – Stocks: rectangle.
 *   – Flows:  hexagon (proxy for the canonical valve/bowtie).
 *   – Source/sink clouds: circle.
 *   – Auxiliary nodes (only when `showAuxiliaries`): calcs as rounded
 *     rectangles, constants as rhombi, maps as parallelograms.
 *   – Matter flows (cloud↔flow↔stock): thick arrows `==>`, no label.
 *   – Information links (source → flow, source → calc): thin arrows with a
 *     `+` / `−` / `?` polarity label drawn from `program.influences[]` and
 *     `program.flowInputs[]`.
 *   – Synthetic stocks (smooth/delay3 desugaring) are hidden.
 *   – Modules become `subgraph` blocks.
 */
export function programToMermaid(
  program: CompiledProgram,
  options: MermaidRenderOptions = {},
): string {
  const showAux = options.showAuxiliaries ?? true;

  if (program.stocks.length === 0 && program.flowEffects.length === 0) {
    return 'flowchart LR\n  empty["No stocks or flows defined"]';
  }

  const lines: string[] = ['flowchart LR'];

  // ── Lookups ──────────────────────────────────────────────────────────────
  const symFqn = (id: number): string | null => program.symbols.byId(id)?.fqn ?? null;
  const symKind = (id: number): string | null => program.symbols.byId(id)?.kind ?? null;

  const stockSlotToFqn = new Map<number, string>();
  for (const s of program.stocks) {
    if (!s.synthetic) stockSlotToFqn.set(s.slot, s.fqn);
  }

  // Synthetic delay-stock substitution: when an info-link points FROM a
  // synthetic smooth/delay3 stock, redirect it to the original input(s)
  // and mark the edge as delayed (canonical SD `‖` glyph on the arrow).
  type DelayMeta = { readonly kind: 'smooth' | 'delay3'; readonly inputIds: readonly number[] };
  const delaySubsByFqn = new Map<string, DelayMeta>();
  for (const s of program.stocks) {
    if (s.delayKind && s.delayInputs && s.delayInputs.length > 0) {
      delaySubsByFqn.set(s.fqn, { kind: s.delayKind, inputIds: s.delayInputs });
    }
  }
  const lookupDelay = (sym: ReturnType<typeof program.symbols.byId>): DelayMeta | null => {
    if (!sym || sym.kind !== 'stock') return null;
    return delaySubsByFqn.get(sym.fqn) ?? null;
  };

  type Eff = { stockFqn: string; polarity: 'positive' | 'negative' };
  const flows = new Map<string, Eff[]>();
  for (const eff of program.flowEffects) {
    const fqn = stockSlotToFqn.get(eff.targetSlot);
    if (!fqn) continue;
    let arr = flows.get(eff.flowFqn);
    if (!arr) {
      arr = [];
      flows.set(eff.flowFqn, arr);
    }
    arr.push({ stockFqn: fqn, polarity: eff.polarity });
  }

  // ── Renderable node sets ─────────────────────────────────────────────────
  // Stocks, flows always render. Calcs/constants/maps only when showAux.
  const stockFqns: string[] = program.stocks.filter((s) => !s.synthetic).map((s) => s.fqn);
  const flowFqns: string[] = [...flows.keys()];
  const calcFqns: string[] = showAux ? program.calcs.map((c) => c.fqn) : [];
  const constantFqns: string[] = showAux ? program.constants.map((c) => c.fqn) : [];
  // Maps appear as standalone nodes when shown — info-links into maps are
  // not currently tracked (compiler skips builtins/maps from polarity), so
  // they aren't connected. They still belong on the diagram so users can
  // see what lookup tables exist in the model.
  const mapFqns: string[] = showAux
    ? program.symbols
        .ofKind('map')
        .map((s) => s.fqn)
    : [];

  const renderable = new Set<string>([
    ...stockFqns,
    ...flowFqns,
    ...calcFqns,
    ...constantFqns,
    ...mapFqns,
  ]);

  // ── Helpers ──────────────────────────────────────────────────────────────
  const idOf = (fqn: string) => 'n_' + fqn.replace(/[.\s]/g, '_');
  const shortName = (fqn: string) => {
    const i = fqn.lastIndexOf('.');
    return i < 0 ? fqn : fqn.slice(i + 1);
  };
  const escLabel = (s: string) => s.replace(/"/g, '#quot;');

  const polLabel = (p: '+' | '-' | '?'): string => {
    if (p === '+') return '+';
    if (p === '-') return '−'; // U+2212 Mathematical Minus, more legible than ASCII '-'
    return '?';
  };

  // ── Group by module ──────────────────────────────────────────────────────
  const groups: Record<string, Map<string, string[]>> = {
    stock: groupByModule(stockFqns),
    flow: groupByModule(flowFqns),
    calc: groupByModule(calcFqns),
    constant: groupByModule(constantFqns),
    map: groupByModule(mapFqns),
  };

  const allModules = new Set<string>();
  for (const g of Object.values(groups)) for (const k of g.keys()) allModules.add(k);

  // ── Emit nodes ───────────────────────────────────────────────────────────
  const emitNode = (kind: keyof typeof groups, fqn: string, indent: string) => {
    const id = idOf(fqn);
    const lbl = escLabel(shortName(fqn));
    switch (kind) {
      case 'stock':
        lines.push(`${indent}${id}["${lbl}"]:::stock`);
        break;
      case 'flow':
        lines.push(`${indent}${id}{{"${lbl}"}}:::flow`);
        break;
      case 'calc':
        lines.push(`${indent}${id}(["${lbl}"]):::calc`);
        break;
      case 'constant':
        lines.push(`${indent}${id}{"${lbl}"}:::constant`);
        break;
      case 'map':
        lines.push(`${indent}${id}[/"${lbl}"/]:::map`);
        break;
    }
  };

  const KINDS = ['stock', 'flow', 'calc', 'constant', 'map'] as const;
  // Top level first
  for (const kind of KINDS) {
    const list = groups[kind]?.get('') ?? [];
    for (const fqn of list) emitNode(kind, fqn, '  ');
  }

  // Then each module subgraph
  for (const moduleFqn of allModules) {
    if (moduleFqn === '') continue;
    const sgId = 'mod_' + moduleFqn.replace(/[.\s]/g, '_');
    lines.push(`  subgraph ${sgId}["${escLabel(moduleFqn)}"]`);
    lines.push(`    direction TB`);
    for (const kind of KINDS) {
      const list = groups[kind]?.get(moduleFqn) ?? [];
      for (const fqn of list) emitNode(kind, fqn, '    ');
    }
    lines.push(`  end`);
  }

  // ── Edge emission: track each edge's Mermaid index so we can recolour
  // them via `linkStyle` at the end. Mermaid numbers edges in declaration
  // order (matter-flows first, then info-links).
  let edgeIdx = 0;
  const matterIdx: number[] = [];
  const posIdx: number[] = [];
  const negIdx: number[] = [];
  const unkIdx: number[] = [];
  const delayedIdx: number[] = [];

  // ── Matter-flow edges (cloud ↔ flow ↔ stock) — thick, unlabelled ─────────
  let cloudIdx = 0;
  const pushMatter = (line: string) => {
    lines.push(line);
    matterIdx.push(edgeIdx++);
  };
  for (const [flowFqn, effs] of flows) {
    const flowId = idOf(flowFqn);
    const positives = effs.filter((e) => e.polarity === 'positive');
    const negatives = effs.filter((e) => e.polarity === 'negative');

    if (positives.length === 0 && negatives.length === 0) continue;

    if (positives.length > 0 && negatives.length === 0) {
      const cloud = `cloud_${cloudIdx++}`;
      lines.push(`  ${cloud}(("&nbsp;")):::cloud`);
      pushMatter(`  ${cloud} ==> ${flowId}`);
      for (const e of positives) pushMatter(`  ${flowId} ==> ${idOf(e.stockFqn)}`);
    } else if (negatives.length > 0 && positives.length === 0) {
      const cloud = `cloud_${cloudIdx++}`;
      lines.push(`  ${cloud}(("&nbsp;")):::cloud`);
      for (const e of negatives) pushMatter(`  ${idOf(e.stockFqn)} ==> ${flowId}`);
      pushMatter(`  ${flowId} ==> ${cloud}`);
    } else {
      for (const e of negatives) pushMatter(`  ${idOf(e.stockFqn)} ==> ${flowId}`);
      for (const e of positives) pushMatter(`  ${flowId} ==> ${idOf(e.stockFqn)}`);
    }
  }

  // ── Information-link edges (source → flow / source → calc) ───────────────
  // Deduplicate (source, target, delayed) tuples so we don't double-draw.
  const drawn = new Set<string>();
  const drawInfoLink = (
    sourceFqn: string,
    targetFqn: string,
    polarity: '+' | '-' | '?',
    delayed: boolean,
  ) => {
    if (!renderable.has(sourceFqn) || !renderable.has(targetFqn)) return;
    const key = `${sourceFqn}→${targetFqn}|${delayed ? 'd' : ''}`;
    if (drawn.has(key)) return;
    drawn.add(key);
    const label = delayed ? `${polLabel(polarity)} ‖` : polLabel(polarity);
    lines.push(`  ${idOf(sourceFqn)} -->|"${label}"| ${idOf(targetFqn)}`);
    if (polarity === '+') posIdx.push(edgeIdx);
    else if (polarity === '-') negIdx.push(edgeIdx);
    else unkIdx.push(edgeIdx);
    if (delayed) delayedIdx.push(edgeIdx);
    edgeIdx++;
  };

  // Resolve a source symbol id, walking through any synthetic delay stock so
  // the rendered edge starts at the original input (not the hidden buffer).
  // Returns the substituted FQNs and whether any delay was traversed.
  const resolveSourceFqns = (sourceId: number): { fqns: string[]; delayed: boolean } => {
    const sym = program.symbols.byId(sourceId);
    const delay = lookupDelay(sym);
    if (!delay) {
      const fqn = sym?.fqn;
      return { fqns: fqn ? [fqn] : [], delayed: false };
    }
    // Recurse through chained delays (rare, but possible).
    const fqns: string[] = [];
    for (const inputId of delay.inputIds) {
      const sub = resolveSourceFqns(inputId);
      for (const f of sub.fqns) if (!fqns.includes(f)) fqns.push(f);
    }
    return { fqns, delayed: true };
  };

  // Source → flow info links (SFD-correct routing through the flow valve).
  for (const fi of program.flowInputs) {
    const flowSym = program.symbols.byId(fi.flow);
    if (!flowSym || flowSym.kind !== 'flow') continue;
    const { fqns, delayed } = resolveSourceFqns(fi.source);
    for (const sourceFqn of fqns) drawInfoLink(sourceFqn, flowSym.fqn, fi.polarity, delayed);
  }

  // Source → calc info links (calc-on-calc, stock-on-calc, constant-on-calc).
  for (const inf of program.influences) {
    const targetKind = symKind(inf.target);
    if (targetKind !== 'calc') continue; // stock targets are matter flows, already drawn
    const targetFqn = symFqn(inf.target);
    if (!targetFqn) continue;
    const { fqns, delayed } = resolveSourceFqns(inf.source);
    for (const sourceFqn of fqns) drawInfoLink(sourceFqn, targetFqn, inf.polarity, delayed);
  }

  // ── Class definitions ────────────────────────────────────────────────────
  // Palette aligned with styles/index.css. Auxiliary tints stay muted so they
  // recede behind stocks/flows/clouds.
  lines.push('  classDef stock fill:#FFFFFF,stroke:#1F1F1F,stroke-width:1.5px,color:#1F1F1F');
  lines.push('  classDef flow fill:#F4EFE6,stroke:#A0742E,stroke-width:1px,color:#1F1F1F');
  lines.push('  classDef cloud fill:#F0EEEA,stroke:#B8B5AE,stroke-width:1px,color:#8E8C86');
  lines.push('  classDef calc fill:#FAFAF9,stroke:#5C5A55,stroke-width:1px,color:#1F1F1F');
  lines.push('  classDef constant fill:#FAFAF9,stroke:#0F4C5C,stroke-width:1px,color:#0F4C5C');
  lines.push('  classDef map fill:#FAFAF9,stroke:#5C2B5B,stroke-width:1px,color:#5C2B5B');

  // ── Edge styling via linkStyle ───────────────────────────────────────────
  // Polarity colours match the Loops sidebar (green=+, red=−, gray=?).
  // Matter flows stay in the warm-tan family to read as "physical conservation".
  if (matterIdx.length > 0) {
    lines.push(`  linkStyle ${matterIdx.join(',')} stroke:#A0742E,stroke-width:2.5px`);
  }
  if (posIdx.length > 0) {
    lines.push(`  linkStyle ${posIdx.join(',')} stroke:#2E7D5C,stroke-width:1.6px`);
  }
  if (negIdx.length > 0) {
    lines.push(`  linkStyle ${negIdx.join(',')} stroke:#B23A2C,stroke-width:1.6px`);
  }
  if (unkIdx.length > 0) {
    lines.push(`  linkStyle ${unkIdx.join(',')} stroke:#8E8C86,stroke-width:1.2px,stroke-dasharray:3 3`);
  }

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
