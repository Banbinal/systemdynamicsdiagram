/**
 * SystemDiagram v2 DSL → XMILE exporter.
 *
 * Walks the AST returned by `parse()` and emits a self-contained XMILE 1.0
 * document. The resulting file imports cleanly into Stella, Insight Maker
 * and Simlin. We don't currently round-trip every feature:
 *   - `module` blocks are flattened (their FQNs become flat names with `_`).
 *   - `scenario`, `sweep`, `plot`, `limit`, `check`, `reference` are
 *     out of XMILE's scope and skipped (with a comment in the header).
 *   - `map` lookup tables become an XMILE <gf>.
 */

import { parse, type Expr, type Program, type Stmt } from '@sysdyn/core';

export interface XmileExportResult {
  readonly xml: string;
  readonly warnings: readonly string[];
}

export function exportXmile(source: string, modelTitle?: string): XmileExportResult {
  const { ast, diagnostics } = parse(source, { fileName: 'model.sd' });
  const warnings: string[] = diagnostics
    .filter((d) => d.severity !== 'error')
    .map((d) => `${d.code}: ${d.message}`);
  const errors = diagnostics.filter((d) => d.severity === 'error');
  if (errors.length > 0) {
    return {
      xml: '',
      warnings: errors.map((d) => `${d.code}: ${d.message}`),
    };
  }
  return buildXmile(ast, modelTitle, warnings);
}

interface FlatStock {
  readonly fqn: string;
  readonly init: Expr;
  readonly inflows: string[];
  readonly outflows: string[];
}
interface FlatFlow {
  readonly fqn: string;
  /**
   * XMILE flows have a single eqn. If our DSL uses different expressions per
   * effect, we pick the first and warn (rare in practice — almost all flows
   * have one rate that just splits between sources/sinks).
   */
  readonly eqn: Expr;
}
interface FlatAux {
  readonly fqn: string;
  readonly eqn: Expr;
  readonly isConstant: boolean;
}
interface FlatMap {
  readonly fqn: string;
  readonly xs: number[];
  readonly ys: number[];
}

function buildXmile(ast: Program, modelTitle: string | undefined, warnings: string[]): XmileExportResult {
  const stocks: FlatStock[] = [];
  const flows: FlatFlow[] = [];
  const auxes: FlatAux[] = [];
  const maps: FlatMap[] = [];
  let title = modelTitle ?? null;
  let startTime = 0;
  let endTime = 100;
  let timeStep = 1;
  let scenarioCount = 0;
  let sweepCount = 0;
  let limitCount = 0;
  let checkCount = 0;
  let referenceCount = 0;

  function walk(stmts: readonly Stmt[], ns: readonly string[]) {
    for (const s of stmts) {
      switch (s.kind) {
        case 'Title':
          if (!title) title = s.text;
          break;
        case 'TimeConfig':
          if (s.key === 'StartTime') startTime = s.value;
          else if (s.key === 'EndTime') endTime = s.value;
          else if (s.key === 'TimeStep') timeStep = s.value;
          break;
        case 'Constant':
          auxes.push({ fqn: fqnOf(ns, s.name), eqn: s.expr, isConstant: true });
          break;
        case 'Calc':
          auxes.push({ fqn: fqnOf(ns, s.name), eqn: s.expr, isConstant: false });
          break;
        case 'Stock': {
          if (s.synthetic) break; // smooth/delay3 buffers — emitted via the call site
          const fqn = fqnOf(ns, s.name);
          stocks.push({ fqn, init: s.init, inflows: [], outflows: [] });
          break;
        }
        case 'Flow': {
          const fqn = fqnOf(ns, s.name);
          if (s.effects.length === 0) {
            warnings.push(`Flow '${fqn}' has no effects — skipped.`);
            break;
          }
          // Use the first effect's expression as the canonical flow rate.
          const first = s.effects[0]!;
          flows.push({ fqn, eqn: first.expr });
          if (s.effects.length > 1 && s.effects.some((e) => e.expr !== first.expr)) {
            warnings.push(
              `Flow '${fqn}' has per-target expressions; XMILE only supports one rate per flow — used the first effect.`,
            );
          }
          // Record this flow on each affected stock's inflow / outflow list.
          for (const eff of s.effects) {
            const targetFqn = qualifiedRefToFqn(ns, eff.target.path);
            const stock = stocks.find((x) => x.fqn === targetFqn);
            if (!stock) {
              warnings.push(`Flow '${fqn}' targets unknown stock '${targetFqn}'.`);
              continue;
            }
            (eff.polarity === 'positive' ? stock.inflows : stock.outflows).push(fqn);
          }
          break;
        }
        case 'Map':
          maps.push({
            fqn: fqnOf(ns, s.name),
            xs: s.points.map((p) => p.x),
            ys: s.points.map((p) => p.y),
          });
          break;
        case 'Module':
          walk(s.body, [...ns, s.name]);
          break;
        case 'Scenario': scenarioCount++; break;
        case 'Sweep': sweepCount++; break;
        case 'Limit': limitCount++; break;
        case 'Check': checkCount++; break;
        case 'Reference': referenceCount++; break;
      }
    }
  }
  walk(ast.body, []);

  if (scenarioCount > 0) warnings.push(`${scenarioCount} scenario(s) skipped — XMILE has no equivalent.`);
  if (sweepCount > 0) warnings.push(`${sweepCount} sweep(s) skipped — XMILE has no equivalent.`);
  if (limitCount > 0) warnings.push(`${limitCount} limit clamp(s) skipped — XMILE doesn't support range clamps directly.`);
  if (checkCount > 0) warnings.push(`${checkCount} check(s) skipped — Reality Check is a SystemDiagram-only feature.`);
  if (referenceCount > 0) warnings.push(`${referenceCount} reference mode(s) skipped — XMILE has no equivalent annotation.`);

  // ── Emit XML ──────────────────────────────────────────────────────────
  const x: string[] = [];
  x.push(`<?xml version="1.0" encoding="UTF-8"?>`);
  x.push(`<xmile xmlns="http://docs.oasis-open.org/xmile/ns/XMILE/v1.0" version="1.0">`);
  x.push(`  <header>`);
  x.push(`    <name>${esc(title ?? 'Untitled model')}</name>`);
  x.push(`    <vendor>SystemDiagram</vendor>`);
  x.push(`    <product version="2">SystemDiagram v2</product>`);
  x.push(`  </header>`);
  x.push(`  <sim_specs>`);
  x.push(`    <start>${formatNum(startTime)}</start>`);
  x.push(`    <stop>${formatNum(endTime)}</stop>`);
  x.push(`    <dt>${formatNum(timeStep)}</dt>`);
  x.push(`  </sim_specs>`);
  x.push(`  <model>`);
  x.push(`    <variables>`);
  for (const s of stocks) {
    x.push(`      <stock name="${esc(s.fqn)}">`);
    x.push(`        <eqn>${esc(stringifyExpr(s.init))}</eqn>`);
    for (const f of s.inflows) x.push(`        <inflow>${esc(f)}</inflow>`);
    for (const f of s.outflows) x.push(`        <outflow>${esc(f)}</outflow>`);
    x.push(`      </stock>`);
  }
  for (const f of flows) {
    x.push(`      <flow name="${esc(f.fqn)}">`);
    x.push(`        <eqn>${esc(stringifyExpr(f.eqn))}</eqn>`);
    x.push(`      </flow>`);
  }
  for (const a of auxes) {
    x.push(`      <aux name="${esc(a.fqn)}">`);
    x.push(`        <eqn>${esc(stringifyExpr(a.eqn))}</eqn>`);
    x.push(`      </aux>`);
  }
  for (const m of maps) {
    x.push(`      <aux name="${esc(m.fqn)}">`);
    x.push(`        <gf>`);
    x.push(`          <xpts>${m.xs.map(formatNum).join(',')}</xpts>`);
    x.push(`          <ypts>${m.ys.map(formatNum).join(',')}</ypts>`);
    x.push(`        </gf>`);
    x.push(`        <eqn>0</eqn>`); // placeholder; real call sites use map(name, x)
    x.push(`      </aux>`);
  }
  x.push(`    </variables>`);
  x.push(`  </model>`);
  x.push(`</xmile>`);
  return { xml: x.join('\n') + '\n', warnings };
}

// ── Helpers ────────────────────────────────────────────────────────────────

function fqnOf(ns: readonly string[], name: string): string {
  return ns.length === 0 ? name : `${ns.join('_')}_${name}`;
}

function qualifiedRefToFqn(ns: readonly string[], path: readonly string[]): string {
  // Best-effort: try resolving relative to the current namespace, then walk up.
  // For the export we don't have the resolver's symbol table; we just join
  // path with underscores and let the import side flatten the namespace.
  if (path.length === 1 && ns.length > 0) {
    return `${ns.join('_')}_${path[0]}`;
  }
  return path.join('_');
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function formatNum(n: number): string {
  return Number.isInteger(n) ? n.toString() : n.toString();
}

/** Render an Expr back to a textual equation. Operator precedence is preserved
 *  with conservative parens to keep the output round-trippable. */
function stringifyExpr(e: Expr): string {
  switch (e.kind) {
    case 'NumberLit':
      return formatNum(e.value);
    case 'Ref':
      return e.path.join('_');
    case 'Unary':
      return `${e.op}${needsParen(e.operand) ? '(' + stringifyExpr(e.operand) + ')' : stringifyExpr(e.operand)}`;
    case 'Binary': {
      const left = stringifyExpr(e.left);
      const right = stringifyExpr(e.right);
      const op = e.op === '==' ? '=' : e.op === '!=' ? '<>' : e.op;
      return `(${left} ${op} ${right})`;
    }
    case 'Call':
      return `${e.callee}(${e.args.map(stringifyExpr).join(', ')})`;
  }
}

function needsParen(e: Expr): boolean {
  return e.kind === 'Binary';
}
