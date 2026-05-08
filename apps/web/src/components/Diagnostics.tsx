import type { Diagnostic, Severity } from '@sysdyn/core';

interface DiagnosticsProps {
  readonly items: readonly Diagnostic[];
}

const ICON: Record<Severity, string> = {
  error:   '●',
  warning: '▲',
  info:    'i',
  hint:    '?',
};

export function Diagnostics({ items }: DiagnosticsProps) {
  if (items.length === 0) return null;
  return (
    <ul className="diag" role="list">
      {items.map((d, i) => (
        <li key={i} className="diag__item">
          <span className={`diag__icon diag__icon--${d.severity}`} aria-label={d.severity}>
            {ICON[d.severity]}
          </span>
          <span className="diag__loc">
            L{d.range.start.line + 1}:{d.range.start.column + 1}
          </span>
          <span className="diag__code">{d.code}</span>
          <span className="diag__msg">{d.message}</span>
        </li>
      ))}
    </ul>
  );
}
