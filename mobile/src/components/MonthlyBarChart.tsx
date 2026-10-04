interface MonthlyBarChartDatum {
  label: string;
  value: number;
}

interface MonthlyBarChartProps {
  data: MonthlyBarChartDatum[];
  formatValue: (n: number) => string;
}

// Lightweight custom SVG bar chart — no charting library dependency for
// what's just 6 bars (the app's JS bundle is already flagged for size;
// recharts/visx would add real weight for something this simple). Not a
// reusable "chart library," just enough for Home's two monthly trend
// charts (Home.tsx: $ invoiced, hours logged).
export function MonthlyBarChart({ data, formatValue }: MonthlyBarChartProps) {
  const max = Math.max(...data.map((d) => d.value), 1); // avoid divide-by-zero when every month is 0
  const barWidth = 28;
  const gap = 14;
  // Bars plot inside their own sub-area, leaving headroom above for the
  // value label — without this, a month at (or near) the max value fills
  // the full chartHeight and its label at y-6 lands above y=0, clipped
  // off the top of the SVG's viewBox and invisible (e.g. the one month
  // with data in a 6-month window, which is trivially also the max).
  const labelHeadroom = 16;
  const chartHeight = 100;
  const plotHeight = chartHeight - labelHeadroom;
  const width = data.length * (barWidth + gap) - gap;

  return (
    <div className="overflow-x-auto">
      <svg
        role="img"
        aria-label={data.map((d) => `${d.label}: ${formatValue(d.value)}`).join(", ")}
        width={width}
        height={chartHeight + 36}
        viewBox={`0 0 ${width} ${chartHeight + 36}`}
        className="mx-auto"
      >
        {data.map((d, i) => {
          const barHeight = (d.value / max) * plotHeight;
          const x = i * (barWidth + gap);
          const y = chartHeight - barHeight;
          const isLast = i === data.length - 1;
          return (
            <g key={d.label + i}>
              {d.value > 0 && (
                <text
                  x={x + barWidth / 2}
                  y={y - 6}
                  textAnchor="middle"
                  className="tabular"
                  style={{ fontSize: 9, fontWeight: 700, fill: "var(--ink-muted)" }}
                >
                  {formatValue(d.value)}
                </text>
              )}
              <rect
                x={x}
                y={y}
                width={barWidth}
                height={Math.max(barHeight, d.value > 0 ? 2 : 0)}
                rx={4}
                fill={isLast ? "var(--primary)" : "var(--primary-tint-2)"}
              />
              <text
                x={x + barWidth / 2}
                y={chartHeight + 16}
                textAnchor="middle"
                style={{ fontSize: 11, fontWeight: 600, fill: "var(--ink-muted)" }}
              >
                {d.label}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}
