import type { ChartSeries } from './Chart.tsx';

interface ChartLegendProps {
  readonly series: readonly ChartSeries[];
  readonly onToggle: (fqn: string) => void;
}

export function ChartLegend({ series, onToggle }: ChartLegendProps) {
  return (
    <div className="chart-legend" role="group" aria-label="Toggle series">
      {series.map((s) => (
        <button
          key={s.fqn}
          type="button"
          className="chart-legend__btn"
          aria-pressed={s.visible}
          onClick={() => onToggle(s.fqn)}
          style={{ color: s.color }}
        >
          <span className="chart-legend__swatch" />
          <span style={{ color: 'var(--ink-2)' }}>{s.label}</span>
        </button>
      ))}
    </div>
  );
}
