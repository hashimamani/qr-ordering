import type { DayBucket } from '../../api/types';

/**
 * Hand-rolled inline SVG -- no charting library, consistent with this
 * codebase's existing hand-drawn-everything approach (components/icons.tsx
 * has zero icon-library dependency). Zero-sale days render as a visible
 * 1px baseline stub (not just missing), matching the backend's
 * generate_series zero-fill so a quiet stretch reads as zero, not absent.
 */
export function RevenueBarChart({ days }: { days: DayBucket[] }) {
  if (days.length === 0) {
    return <div className="chart-empty">No data for this range.</div>;
  }

  const width = 700;
  const height = 160;
  const padding = { top: 8, right: 8, bottom: 20, left: 8 };
  const plotWidth = width - padding.left - padding.right;
  const plotHeight = height - padding.top - padding.bottom;

  const values = days.map((d) => Number(d.gross_sales));
  const max = Math.max(...values, 1);
  const barGap = 2;
  const barWidth = Math.max(1, plotWidth / days.length - barGap);

  // Thin x-axis labels to ~6 evenly spaced dates so a wide range doesn't
  // turn into an unreadable smear.
  const labelEvery = Math.max(1, Math.ceil(days.length / 6));

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      width="100%"
      style={{ display: 'block' }}
      role="img"
      aria-label={`Revenue by day, ${days[0].day} to ${days[days.length - 1].day}`}
    >
      <line
        x1={padding.left}
        y1={padding.top + plotHeight}
        x2={width - padding.right}
        y2={padding.top + plotHeight}
        stroke="var(--ink-200)"
      />
      {days.map((d, i) => {
        const value = Number(d.gross_sales);
        const barHeight = Math.max(1, (value / max) * plotHeight);
        const x = padding.left + i * (plotWidth / days.length);
        const y = padding.top + plotHeight - barHeight;
        return (
          <g key={d.day}>
            <rect x={x} y={y} width={barWidth} height={barHeight} rx="2" fill="var(--brand-500)">
              <title>
                {new Date(`${d.day}T00:00:00`).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })}
                {' — KSh '}
                {value.toLocaleString()}
              </title>
            </rect>
            {i % labelEvery === 0 && (
              <text
                x={x + barWidth / 2}
                y={height - 4}
                fontSize="9"
                fill="var(--ink-400)"
                textAnchor="middle"
              >
                {new Date(`${d.day}T00:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
}
