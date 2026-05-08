/**
 * Dimensional analysis for the SD DSL.
 *
 * Units are represented as a sparse map of base-name → integer exponent.
 * `people` is `{people: 1}`; `1/year` is `{year: -1}`; `m^3/s` is
 * `{m: 3, s: -1}`. The empty map represents a dimensionless quantity.
 *
 * Phase 1 deliberately does NOT do unit conversion: `year` and `month` are
 * distinct dimensions that don't add. Users mixing them get a warning. A
 * future pass could fold known time aliases.
 *
 * Operations:
 *   mul / div   — exponent-wise add / subtract
 *   pow         — exponent-wise multiply by integer N
 *   equal       — same keys, same exponents
 *   format      — pretty-print back to a string ("m^3/s", "1/year", "")
 *   parseUnits  — parse from "[…]" content via the lexer's tokens
 *
 * The empty map (`EMPTY`) is the dimensionless / unknown-result sentinel.
 * Unknown vs. dimensionless is distinguished by the *caller* via a separate
 * `null` value: `null` = unknown (skip checks), `Map` = known (check).
 */

export type Units = ReadonlyMap<string, number>;

export const EMPTY: Units = new Map();

export function isEmpty(u: Units): boolean {
  for (const [, v] of u) if (v !== 0) return false;
  return true;
}

export function mul(a: Units, b: Units): Units {
  const out = new Map<string, number>(a);
  for (const [k, v] of b) {
    const n = (out.get(k) ?? 0) + v;
    if (n === 0) out.delete(k);
    else out.set(k, n);
  }
  return out;
}

export function div(a: Units, b: Units): Units {
  const out = new Map<string, number>(a);
  for (const [k, v] of b) {
    const n = (out.get(k) ?? 0) - v;
    if (n === 0) out.delete(k);
    else out.set(k, n);
  }
  return out;
}

export function pow(a: Units, n: number): Units {
  if (!Number.isInteger(n)) {
    // Fractional powers on units: undefined unless every exponent stays integer.
    const out = new Map<string, number>();
    for (const [k, e] of a) {
      const scaled = e * n;
      if (!Number.isInteger(scaled)) return EMPTY; // bail to dimensionless
      out.set(k, scaled);
    }
    return out;
  }
  const out = new Map<string, number>();
  for (const [k, e] of a) {
    const ne = e * n;
    if (ne !== 0) out.set(k, ne);
  }
  return out;
}

export function equal(a: Units, b: Units): boolean {
  if (a.size !== b.size) {
    // a sparse map may have an extra key with exponent 0 — fall back to set check.
    let ka = 0;
    for (const [, v] of a) if (v !== 0) ka++;
    let kb = 0;
    for (const [, v] of b) if (v !== 0) kb++;
    if (ka !== kb) return false;
  }
  for (const [k, v] of a) {
    if ((b.get(k) ?? 0) !== v) return false;
  }
  for (const [k, v] of b) {
    if ((a.get(k) ?? 0) !== v) return false;
  }
  return true;
}

/** Pretty-print "m^3/s", "1/year", "" (dimensionless). */
export function format(u: Units): string {
  const num: string[] = [];
  const den: string[] = [];
  // Stable order: alphabetical, positives first.
  const entries = [...u].filter(([, v]) => v !== 0).sort((a, b) => a[0].localeCompare(b[0]));
  for (const [k, e] of entries) {
    if (e > 0) num.push(e === 1 ? k : `${k}^${e}`);
    else den.push(e === -1 ? k : `${k}^${-e}`);
  }
  if (num.length === 0 && den.length === 0) return '';
  if (num.length === 0) return `1/${den.join('*')}`;
  if (den.length === 0) return num.join('*');
  return `${num.join('*')}/${den.join('*')}`;
}

/**
 * Parse a unit expression from its tokenised form (the parser hands us the
 * tokens between `[` and `]`).
 *
 * Grammar:
 *   units   := factor (('*' | '/') factor)*
 *   factor  := IDENT ('^' NUMBER)?
 *            | NUMBER          // must be 1 — anything else is an error
 *
 * Returns { units, errors } where errors are user-readable strings.
 */
export interface ParsedUnits {
  readonly units: Units;
  readonly errors: readonly string[];
}

export interface UnitToken {
  readonly kind: 'ident' | 'number' | 'star' | 'slash' | 'caret';
  readonly text: string;
  readonly value?: number;
}

export function parseUnitTokens(tokens: readonly UnitToken[]): ParsedUnits {
  const errors: string[] = [];
  let i = 0;

  const peek = () => tokens[i];
  const next = () => tokens[i++];

  function parseFactor(): Units {
    const t = peek();
    if (!t) {
      errors.push('Expected unit factor, got end of unit expression.');
      return EMPTY;
    }
    if (t.kind === 'number') {
      next();
      if (t.value !== 1) {
        errors.push(`Numeric factor must be 1 in a unit expression, got ${t.value}.`);
      }
      return EMPTY;
    }
    if (t.kind === 'ident') {
      next();
      let exp = 1;
      if (peek()?.kind === 'caret') {
        next();
        const numTok = next();
        if (!numTok || numTok.kind !== 'number') {
          errors.push("Expected a number after '^' in unit expression.");
          return new Map([[t.text, 1]]);
        }
        exp = numTok.value ?? 1;
        if (!Number.isInteger(exp)) {
          errors.push(`Unit exponent must be an integer, got ${exp}.`);
          exp = Math.round(exp);
        }
      }
      return new Map([[t.text, exp]]);
    }
    errors.push(`Unexpected '${t.text}' in unit expression.`);
    next();
    return EMPTY;
  }

  let result: Units = parseFactor();
  while (i < tokens.length) {
    const op = peek();
    if (!op) break;
    if (op.kind === 'star') {
      next();
      result = mul(result, parseFactor());
    } else if (op.kind === 'slash') {
      next();
      result = div(result, parseFactor());
    } else {
      errors.push(`Expected '*' or '/' in unit expression, got '${op.text}'.`);
      next();
    }
  }
  return { units: result, errors };
}
