import { StreamLanguage, type StringStream } from '@codemirror/language';
import { tags as t } from '@lezer/highlight';

/**
 * Stream-based syntax highlighter for the @sysdyn DSL.
 *
 * Pure regex/lookahead — fast, no LR table. Tags map to standard Lezer
 * highlight categories so any theme that styles `keyword`/`number`/etc. picks
 * them up automatically.
 *
 *   keyword  : structural — title, stock, flow, calc, constant, module, …
 *   meta     : time config — StartTime, EndTime, TimeStep
 *   atom     : declarations — scenario, sweep, plot, limit (configuration intent)
 *   builtin  : built-in functions — smooth, delay3, step, pulse, time, sin, cos, …
 *   operator : arrows -->, -+>, math operators
 *   number   : 12, 0.5, 1e-3
 *   comment  : # to end of line
 *   string   : "…" (defensive — lexer rejects them but we still recognise)
 *   variable : identifiers
 */

const STRUCT_KW = new Set([
  'title',
  'stock',
  'flow',
  'calc',
  'constant',
  'map',
  'module',
]);
const CONFIG_KW = new Set([
  'scenario',
  'sweep',
  'plot',
  'limit',
  'min',
  'max',
  'check',
  'when',
  'then',
  'always',
  'at',
  'exogenous',
  'reference',
  'calibrate',
  'bounds',
]);
const TIME_KW = new Set(['StartTime', 'EndTime', 'TimeStep']);
const INTERP_KW = new Set(['linear', 'step', 'spline']);
const BUILTINS = new Set([
  'smooth',
  'delay3',
  'step',
  'pulse',
  'time',
  'min',
  'max',
  'abs',
  'sqrt',
  'pow',
  'exp',
  'log',
  'log10',
  'sin',
  'cos',
  'tan',
  'map',
]);

interface SDState {
  // No real state needed for line-by-line tokens — the language is regular enough.
  // Kept as a placeholder for future block-aware parsing (e.g. inside flow blocks).
  readonly inFlow: boolean;
}

export const sdLanguage = StreamLanguage.define<SDState>({
  name: 'sysdyn',
  startState: () => ({ inFlow: false }),
  token(stream: StringStream): string | null {
    if (stream.eatSpace()) return null;

    // Comments: # to EOL
    if (stream.peek() === '#') {
      stream.skipToEnd();
      return 'comment';
    }

    // Numbers: integers, decimals, scientific notation
    if (/[0-9]/.test(stream.peek() ?? '')) {
      if (stream.match(/^\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/)) return 'number';
    }
    if (stream.peek() === '.' && stream.match(/^\.\d+(?:[eE][+-]?\d+)?/)) {
      return 'number';
    }

    // Polarity arrows
    if (stream.match('-+>') || stream.match('-->')) return 'operator';

    // Math + assignment operators
    if (stream.match(/^[+\-*/^=<>!]+/)) return 'operator';

    // Punctuation
    if (stream.match(/^[():,\[\]]/)) return 'punctuation';

    // Identifiers — possibly dotted (FQN refs)
    const idMatch = stream.match(/^[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*/);
    if (idMatch && Array.isArray(idMatch)) {
      const word = idMatch[0]!;
      const head = word.includes('.') ? word.split('.')[0]! : word;

      // Anchor structural keywords only at line start (after optional indent).
      // This prevents `min`/`max` (limit options) from clashing with builtins.
      // Approximation: `column - word.length === indent column`.
      // Simpler: just treat as structural keyword if matches set.
      if (STRUCT_KW.has(head) || CONFIG_KW.has(head)) {
        // For dotted refs, the head would still be a keyword which is wrong;
        // in practice FQNs starting with a keyword are very rare in our corpus.
        if (!word.includes('.')) {
          return STRUCT_KW.has(head) ? 'keyword' : 'atom';
        }
      }

      if (TIME_KW.has(head) && !word.includes('.')) return 'meta';
      if (INTERP_KW.has(head) && !word.includes('.')) return 'atom';

      // Function call vs plain reference
      if (BUILTINS.has(head)) {
        const next = peekAhead(stream);
        if (next === '(') return 'builtin';
      }

      // Dotted identifier → qualified ref (slightly different visual)
      if (word.includes('.')) return 'propertyName';
      return 'variableName';
    }

    // Stray character — consume so we don't loop.
    stream.next();
    return null;
  },
  tokenTable: {
    keyword:      t.keyword,
    meta:         t.meta,
    atom:         t.atom,
    builtin:      t.standard(t.variableName),
    operator:     t.operator,
    punctuation:  t.punctuation,
    number:       t.number,
    comment:      t.lineComment,
    variableName: t.variableName,
    propertyName: t.propertyName,
  },
  languageData: {
    commentTokens: { line: '#' },
    indentOnInput: /^\s+(?:flow|module|scenario|sweep|map|check):$/,
  },
});

/** Peek the very next non-whitespace character without consuming it. */
function peekAhead(stream: StringStream): string | null {
  const rest = stream.string.slice(stream.pos);
  for (let i = 0; i < rest.length; i++) {
    const c = rest[i];
    if (c !== ' ' && c !== '\t') return c ?? null;
  }
  return null;
}
