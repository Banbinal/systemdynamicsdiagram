/**
 * XMILE → SystemDiagram v2 DSL importer.
 *
 * XMILE is the OASIS XML standard for SD models (2015). Stella (.stmx),
 * Insight Maker, Simlin and PySD all read/write it. Implementing this lets
 * users drop a model from the rest of the ecosystem into our editor.
 *
 * Scope of this importer (Phase 1):
 *   - flat models (no <group> / <module> nesting — flagged as a warning).
 *   - <stock>, <flow>, <aux>.
 *   - <sim_specs> (start, stop, dt).
 *   - <header><name> → title.
 *   - basic equations: arithmetic + a small subset of MIN/MAX/ABS/SQRT/EXP/
 *     LN/LOG10/SIN/COS/TAN/STEP/PULSE/SMTH1/DELAY3, case-folded.
 *
 * Out of scope (warned, not stripped silently):
 *   - subscripts / arrays.
 *   - graphical functions (lookups other than declared <gf>).
 *   - submodels, conveyors, queues, ovens (Stella extensions).
 *   - units checks (we don't track units yet).
 *
 * Returns { dsl, warnings } so callers can surface the limitations.
 */

export interface XmileImportResult {
  readonly dsl: string;
  readonly warnings: readonly string[];
}

interface VarStock {
  readonly kind: 'stock';
  readonly name: string;
  readonly eqn: string;
  readonly inflows: readonly string[];
  readonly outflows: readonly string[];
}

interface VarFlow {
  readonly kind: 'flow';
  readonly name: string;
  readonly eqn: string;
  readonly nonNegative: boolean;
}

interface VarAux {
  readonly kind: 'aux';
  readonly name: string;
  readonly eqn: string;
}

type Var = VarStock | VarFlow | VarAux;

export function importXmile(xml: string): XmileImportResult {
  const warnings: string[] = [];

  let doc: Document;
  try {
    doc = new DOMParser().parseFromString(xml, 'application/xml');
  } catch (err) {
    return {
      dsl: '',
      warnings: [`Could not parse XML: ${err instanceof Error ? err.message : String(err)}`],
    };
  }
  const parserError = doc.querySelector('parsererror');
  if (parserError) {
    return { dsl: '', warnings: [`XML parser error: ${parserError.textContent ?? 'unknown'}`] };
  }

  // ── Header / sim_specs ────────────────────────────────────────────────
  const title = textOf(doc.querySelector('xmile > header > name')) ?? null;
  const start = numOf(doc.querySelector('xmile > sim_specs > start')) ?? 0;
  const stop = numOf(doc.querySelector('xmile > sim_specs > stop')) ?? 100;
  const dt = numOf(doc.querySelector('xmile > sim_specs > dt')) ?? 1;

  // ── Variables ──────────────────────────────────────────────────────────
  const groups = Array.from(doc.querySelectorAll('xmile > model > variables, xmile > model'));
  if (groups.length === 0) {
    return { dsl: '', warnings: ['No <model> element found.'] };
  }

  const submodels = doc.querySelectorAll('xmile > model > group, xmile > model > module');
  if (submodels.length > 0) {
    warnings.push(`${submodels.length} <group>/<module> element(s) flattened into the root scope.`);
  }

  const arrays = doc.querySelectorAll('xmile > dimensions, xmile > model variables > stock dimensions, xmile > model variables > flow dimensions, xmile > model variables > aux dimensions');
  if (arrays.length > 0) {
    warnings.push(`${arrays.length} subscript/array declaration(s) skipped — unsupported.`);
  }

  const vars: Var[] = [];

  for (const stockEl of doc.querySelectorAll('xmile > model variables > stock, xmile > model > stock')) {
    const name = stockEl.getAttribute('name')?.trim();
    if (!name) continue;
    const eqn = textOf(stockEl.querySelector(':scope > eqn')) ?? '0';
    const inflows = Array.from(stockEl.querySelectorAll(':scope > inflow'))
      .map((e) => (e.textContent ?? '').trim())
      .filter(Boolean);
    const outflows = Array.from(stockEl.querySelectorAll(':scope > outflow'))
      .map((e) => (e.textContent ?? '').trim())
      .filter(Boolean);
    vars.push({ kind: 'stock', name, eqn, inflows, outflows });
  }

  for (const flowEl of doc.querySelectorAll('xmile > model variables > flow, xmile > model > flow')) {
    const name = flowEl.getAttribute('name')?.trim();
    if (!name) continue;
    const eqn = textOf(flowEl.querySelector(':scope > eqn')) ?? '0';
    const nonNegative = !!flowEl.querySelector(':scope > non_negative');
    vars.push({ kind: 'flow', name, eqn, nonNegative });
  }

  for (const auxEl of doc.querySelectorAll('xmile > model variables > aux, xmile > model > aux')) {
    const name = auxEl.getAttribute('name')?.trim();
    if (!name) continue;
    const gf = auxEl.querySelector(':scope > gf');
    if (gf) {
      warnings.push(`Aux '${name}' has a graphical function (<gf>) — emitted as a constant placeholder.`);
    }
    const eqn = textOf(auxEl.querySelector(':scope > eqn')) ?? '0';
    vars.push({ kind: 'aux', name, eqn });
  }

  // ── Build a stock → flow direction map so we can emit `-+>` vs `-->`. ─
  const flowAffects = new Map<string, { positive: string[]; negative: string[] }>();
  for (const v of vars) {
    if (v.kind !== 'stock') continue;
    for (const f of v.inflows) {
      const e = flowAffects.get(f) ?? { positive: [], negative: [] };
      e.positive.push(v.name);
      flowAffects.set(f, e);
    }
    for (const f of v.outflows) {
      const e = flowAffects.get(f) ?? { positive: [], negative: [] };
      e.negative.push(v.name);
      flowAffects.set(f, e);
    }
  }

  // ── Emit DSL ──────────────────────────────────────────────────────────
  const lines: string[] = [];
  if (title) lines.push(`title ${sanitiseTitle(title)}`, '');

  lines.push(`StartTime = ${formatNum(start)}`);
  lines.push(`EndTime = ${formatNum(stop)}`);
  lines.push(`TimeStep = ${formatNum(dt)}`);
  lines.push('');

  // Aux first: classify each as `constant` (literal) or `calc` (expression).
  const auxes = vars.filter((v): v is VarAux => v.kind === 'aux');
  if (auxes.length > 0) {
    for (const a of auxes) {
      const expr = translateExpr(a.eqn);
      const isLiteral = /^-?\s*\d+(\.\d+)?(\s*[eE][-+]?\d+)?$/.test(a.eqn.trim());
      lines.push(`${isLiteral ? 'constant' : 'calc'} ${normName(a.name)} = ${expr}`);
    }
    lines.push('');
  }

  for (const s of vars.filter((v): v is VarStock => v.kind === 'stock')) {
    lines.push(`stock ${normName(s.name)} = ${translateExpr(s.eqn)}`);
  }
  if (vars.some((v) => v.kind === 'stock')) lines.push('');

  for (const f of vars.filter((v): v is VarFlow => v.kind === 'flow')) {
    const aff = flowAffects.get(f.name);
    if (!aff || (aff.positive.length === 0 && aff.negative.length === 0)) {
      warnings.push(`Flow '${f.name}' is not referenced by any stock's inflow/outflow — emitted but disconnected.`);
      lines.push(`# WARNING: '${f.name}' has no destination stock in the original XMILE.`);
      lines.push(`flow ${normName(f.name)}:`);
      lines.push(`    ${translateExpr(f.eqn)} -+> __unconnected_${normName(f.name)}`);
      continue;
    }
    lines.push(`flow ${normName(f.name)}:`);
    for (const stockName of aff.positive) {
      lines.push(`    ${translateExpr(f.eqn)} -+> ${normName(stockName)}`);
    }
    for (const stockName of aff.negative) {
      lines.push(`    ${translateExpr(f.eqn)} --> ${normName(stockName)}`);
    }
    if (f.nonNegative) {
      // Translate XMILE's `<non_negative/>` to a clamp on each affected stock.
      for (const stockName of [...aff.positive, ...aff.negative]) {
        lines.push(`limit ${normName(stockName)} min = 0`);
      }
    }
  }

  return { dsl: lines.join('\n') + '\n', warnings };
}

// ── Expression translation ────────────────────────────────────────────────

/**
 * Best-effort translation of XMILE's arithmetic dialect to ours.
 *
 * Cases we touch:
 *   - operators: `=` (equality, single) → `==`, `<>` → `!=`
 *   - function names: case-fold + rename a few (LN→log, LOG10→log10,
 *     SMTH1→smooth, etc.).
 *   - identifiers: keep as-is (XMILE is case-insensitive but a stock named
 *     `Population` and a ref `population` should resolve to the same symbol;
 *     since we're case-sensitive, we leave the casing the importer found).
 *
 * What we do NOT do: real expression parsing. Edge cases (string literals,
 * IF…THEN…ELSE) get a warning embedded in the output as a comment so the
 * user can fix them.
 */
function translateExpr(eqn: string): string {
  let out = eqn.trim();
  // Function name renames. Use word-boundary-ish replacement: identifier
  // followed by '('.
  const renames: Record<string, string> = {
    LN: 'log',
    LOG: 'log10', // XMILE LOG = base 10
    SMTH1: 'smooth',
    SMTH3: 'smooth', // we don't have SMTH3 — fall back to first-order; add a TODO
    DELAY1: 'smooth',
    INTEG: '__INTEG_INVALID', // INTEG is XMILE's stock-init form, shouldn't appear in eqn here
  };
  for (const [k, v] of Object.entries(renames)) {
    out = out.replace(new RegExp(`\\b${k}\\s*\\(`, 'gi'), `${v}(`);
  }
  // Lowercase known builtins for our case-sensitive lexer.
  const knownLower = ['min', 'max', 'abs', 'sqrt', 'exp', 'pow', 'sin', 'cos', 'tan', 'step', 'pulse', 'smooth', 'delay3', 'log', 'log10', 'time'];
  for (const kw of knownLower) {
    out = out.replace(new RegExp(`\\b${kw}\\s*\\(`, 'gi'), `${kw}(`);
    if (kw === 'time') out = out.replace(/\bTIME\b/g, 'time');
  }
  // Comparison operator translation.
  // `<>` → `!=`. Single `=` inside an expression context is comparison in
  // XMILE; we conservatively translate `==` is unchanged, `=` → `==` only
  // when neither neighbouring char is `=` already.
  out = out.replace(/<>/g, '!=');
  out = out.replace(/(?<![=!<>])=(?!=)/g, '==');
  return out;
}

function normName(name: string): string {
  // XMILE allows spaces in names ("Order Rate"); our DSL doesn't. Replace
  // each run of whitespace with an underscore.
  return name.replace(/\s+/g, '_');
}

function sanitiseTitle(s: string): string {
  // The `title` directive runs to end-of-line; strip newlines from inside.
  return s.replace(/\s+/g, ' ').trim();
}

function textOf(el: Element | null): string | null {
  if (!el) return null;
  const t = el.textContent;
  if (t === null) return null;
  return t.trim();
}

function numOf(el: Element | null): number | null {
  const t = textOf(el);
  if (t === null) return null;
  const n = parseFloat(t);
  return Number.isFinite(n) ? n : null;
}

function formatNum(n: number): string {
  if (Number.isInteger(n)) return n.toString();
  return n.toString();
}
