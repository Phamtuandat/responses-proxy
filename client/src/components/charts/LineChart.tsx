import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend,
  Filler,
} from 'chart.js';
import { Line } from 'react-chartjs-2';
import { format } from 'date-fns';

ChartJS.register(
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend,
  Filler
);

export type LineChartDataPoint = {
  timestamp: string | Date;
  value: number;
  label?: string;
};

export type LineChartProps = {
  data: LineChartDataPoint[];
  title?: string;
  height?: number;
  color?: string;
  fill?: boolean;
  showGrid?: boolean;
  timeFormat?: string;
  valueFormatter?: (value: number) => string;
  className?: string;
};

export function LineChart({
  data = [], // Default to empty array
  title,
  height = 300,
  color = 'var(--accent)',
  fill = false,
  showGrid = true,
  timeFormat = 'HH:mm',
  valueFormatter = (value) => value.toString(),
  className = '',
}: LineChartProps) {
  // Resolve CSS custom properties for canvas rendering
  const resolveCss = (input: string, fallback = '#6366f1'): string => {
    if (!input.startsWith('var(')) return input;
    const prop = input.slice(4, -1).trim();
    const computed = getComputedStyle(document.documentElement).getPropertyValue(prop).trim();
    return computed || fallback;
  };
  const resolvedColor = resolveCss(color);

  // Guard against undefined or empty data
  if (!data || data.length === 0) {
    return (
      <div className={`line-chart ${className}`} style={{ height }}>
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
    labels: data.map(point =>
      typeof point.timestamp === 'string'
        ? format(new Date(point.timestamp), timeFormat)
        : format(point.timestamp, timeFormat)
    ),
    datasets: [
      {
        label: title || 'Data',
        data: data.map(point => point.value),
        borderColor: resolvedColor,
        backgroundColor: fill ? `${resolvedColor}33` : 'transparent',
        borderWidth: 2,
        fill,
        tension: 0.4,
        pointRadius: 3,
        pointHoverRadius: 5,
        pointBackgroundColor: resolvedColor,
        pointBorderColor: 'var(--surface-strong)',
        pointBorderWidth: 2,
      },
    ],
  };

  const options = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: {
        display: !!title,
        labels: {
          color: resolveCss('var(--text-secondary)'),
          font: {
            family: 'Inter, system-ui, sans-serif',
            size: 12,
          },
        },
      },
      tooltip: {
        backgroundColor: resolveCss('var(--surface-strong)'),
        titleColor: resolveCss('var(--text-primary)'),
        bodyColor: resolveCss('var(--text-secondary)'),
        borderColor: resolveCss('var(--line)'),
        borderWidth: 1,
        cornerRadius: 8,
        displayColors: false,
        callbacks: {
          label: (context: any) => {
            const value = valueFormatter(context.parsed.y);
            return `${context.dataset.label}: ${value}`;
          },
        },
      },
    },
    scales: {
      x: {
        grid: {
          display: showGrid,
          color: resolveCss('var(--line)'),
        },
        ticks: {
          color: resolveCss('var(--text-muted)'),
          font: {
            family: 'Inter, system-ui, sans-serif',
            size: 11,
          },
        },
      },
      y: {
        grid: {
          display: showGrid,
          color: resolveCss('var(--line)'),
        },
        ticks: {
          color: resolveCss('var(--text-muted)'),
          font: {
            family: 'Inter, system-ui, sans-serif',
            size: 11,
          },
          callback: (value: any) => valueFormatter(value),
        },
      },
    },
    interaction: {
      intersect: false,
      mode: 'index' as const,
    },
  };

  return (
    <div className={`line-chart ${className}`} style={{ height }}>
      <Line data={chartData} options={options} />
    </div>
  );
}