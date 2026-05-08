/**
 * Symbol table: representation, builders, and lookups.
 *
 * Each symbol has:
 *   - a unique numeric `id` (used as slot index in Float64Array buffers later)
 *   - a fully-qualified dotted name
 *   - a kind (constant, stock, calc, flow, map, module, builtin)
 *   - a back-reference to its declaring AST node (or none for builtins)
 */

import type { SourceRange } from '../diagnostics/source.js';
import type { Stmt } from '../syntax/ast.js';

export type SymbolKind =
  | 'constant'
  | 'stock'
  | 'calc'
  | 'flow'
  | 'map'
  | 'module'
  | 'builtin';

export interface Symbol {
  readonly id: number;
  readonly fqn: string;
  readonly name: string;
  readonly namespace: readonly string[];
  readonly kind: SymbolKind;
  readonly declRange?: SourceRange;
  readonly decl?: Stmt;
}

export interface SymbolTable {
  byFqn(fqn: string): Symbol | undefined;
  byId(id: number): Symbol | undefined;
  all(): readonly Symbol[];
  /** Ordered list of FQNs of all `kind`. */
  ofKind(kind: SymbolKind): readonly Symbol[];
}

/**
 * Built-in functions injected into every program. They have symbols so
 * resolving `min(...)` doesn't produce an unresolved-reference error,
 * but they're handled specially by the IR (no slot, no derivative).
 */
export const BUILTIN_NAMES = [
  'time',
  'min', 'max', 'abs', 'sqrt', 'pow',
  'exp', 'log', 'log10',
  'sin', 'cos', 'tan',
  'step', 'pulse',
  'smooth', 'delay3',
  'map', // map(name, x) → handled by IR
] as const;

export class SymbolTableImpl implements SymbolTable {
  private readonly _byFqn = new Map<string, Symbol>();
  private readonly _byId: Symbol[] = [];

  add(symbol: Symbol): void {
    this._byFqn.set(symbol.fqn, symbol);
    this._byId[symbol.id] = symbol;
  }

  byFqn(fqn: string): Symbol | undefined {
    return this._byFqn.get(fqn);
  }

  byId(id: number): Symbol | undefined {
    return this._byId[id];
  }

  all(): readonly Symbol[] {
    return this._byId.filter((s) => s !== undefined);
  }

  ofKind(kind: SymbolKind): readonly Symbol[] {
    return this.all().filter((s) => s.kind === kind);
  }
}

/**
 * Resolve a possibly-unqualified reference path against a current namespace.
 * Walks outward (current → parent → ... → root) like Python lexical scope.
 *
 * Returns the matched symbol or undefined if not found.
 */
export function resolveRef(
  table: SymbolTable,
  path: readonly string[],
  currentNamespace: readonly string[],
): Symbol | undefined {
  // Try current namespace, then progressively wider scopes
  for (let i = currentNamespace.length; i >= 0; i--) {
    const scope = currentNamespace.slice(0, i);
    const fqn = [...scope, ...path].join('.');
    const sym = table.byFqn(fqn);
    if (sym) return sym;
  }
  return undefined;
}
