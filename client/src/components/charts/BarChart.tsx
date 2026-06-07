import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  BarElement,
  Title,
  Tooltip,
  Legend,
} from 'chart.js';
import { Bar } from 'react-chartjs-2';

ChartJS.register(
  CategoryScale,
  LinearScale,
  BarElement,
  Title,
  Tooltip,
  Legend
);

export type BarChartDataPoint = {
  label: string;
  value: number;
  color?: string;
};

export type BarChartProps = {
  data: BarChartDataPoint[];
  title?: string;
  height?: number;
  horizontal?: boolean;
  showGrid?: boolean;
  valueFormatter?: (value: number) => string;
  className?: string;
};

export function BarChart({
  data = [], // Default to empty array
  title,
  height = 300,
  horizontal = false,
  showGrid = true,
  valueFormatter = (value) => value.toString(),
  className = '',
}: BarChartProps) {
  // Resolve CSS custom properties (var(--xxx)) to computed colors so they
  // render on canvas. Chart.js cannot resolve CSS vars in canvas contexts.
  const resolveCssColor = (input: string | undefined): string => {
    const fallback = '#6366f1';
    if (!input) return fallback;
    if (!input.startsWith('var(')) return input;
    const prop = input.slice(4, -1).trim();
    const computed = getComputedStyle(document.documentElement).getPropertyValue(prop).trim();
    return computed || fallback;
  };

  // Guard against undefined or empty data
  if (!data || data.length === 0) {
    return (
      <div className={`bar-chart ${className}`} style={{ height }}>
        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          height: '100%',
          color: 'var(--text-muted)',
          fontSize: 'var(--text-sm)'
        }}>
          No data available
        </div>
      </div>
    );
  }
  const chartData = {
    labels: data.map(point => point.label),
    datasets: [
      {
        label: title || 'Data',
        data: data.map(point => point.value),
        backgroundColor: data.map(point => `${resolveCssColor(point.color)}33`),
        borderColor: data.map(point => resolveCssColor(point.color)),
        borderWidth: 1,
        borderRadius: 4,
        borderSkipped: false,
      },
    ],
  };

  const options = {
    responsive: true,
    maintainAspectRatio: false,
    indexAxis: horizontal ? 'y' as const : 'x' as const,
    plugins: {
      legend: {
        display: !!title,
        labels: {
          color: resolveCssColor('var(--text-secondary)'),
          font: {
            family: 'Inter, system-ui, sans-serif',
            size: 12,
          },
        },
      },
      tooltip: {
        backgroundColor: resolveCssColor('var(--surface-strong)'),
        titleColor: resolveCssColor('var(--text-primary)'),
        bodyColor: resolveCssColor('var(--text-secondary)'),
        borderColor: resolveCssColor('var(--line)'),
        borderWidth: 1,
        cornerRadius: 8,
        displayColors: false,
        callbacks: {
          label: (context: any) => {
            const value = valueFormatter(context.parsed[horizontal ? 'x' : 'y']);
            return `${context.dataset.label}: ${value}`;
          },
        },
      },
    },
    scales: {
      x: {
        grid: {
          display: showGrid,
          color: resolveCssColor('var(--line)'),
        },
        ticks: {
          color: resolveCssColor('var(--text-muted)'),
          font: {
            family: 'Inter, system-ui, sans-serif',
            size: 11,
          },
          callback: horizontal ? (value: any) => valueFormatter(value) : undefined,
        },
      },
      y: {
        grid: {
          display: showGrid,
          color: resolveCssColor('var(--line)'),
        },
        ticks: {
          color: resolveCssColor('var(--text-muted)'),
          font: {
            family: 'Inter, system-ui, sans-serif',
            size: 11,
          },
          callback: !horizontal ? (value: any) => valueFormatter(value) : undefined,
        },
      },
    },
  };

  return (
    <div className={`bar-chart ${className}`} style={{ height }}>
      <Bar data={chartData} options={options} />
    </div>
  );
}