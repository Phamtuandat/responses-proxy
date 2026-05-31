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
        backgroundColor: data.map(point => {
          if (point.color) {
            // If color ends with opacity suffix (like '20'), create transparent version
            if (point.color.match(/[a-f0-9]{2}$/i)) {
              return point.color;
            }
            // Add transparency to solid colors
            return point.color + '20';
          }
          return 'var(--chart-primary)20';
        }),
        borderColor: data.map(point => {
          if (point.color) {
            // Remove opacity suffix if present to get solid color
            return point.color.replace(/[a-f0-9]{2}$/i, '');
          }
          return 'var(--chart-primary)';
        }),
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
          color: 'var(--text-secondary)',
          font: {
            family: 'Inter, system-ui, sans-serif',
            size: 12,
          },
        },
      },
      tooltip: {
        backgroundColor: 'var(--surface-strong)',
        titleColor: 'var(--text-primary)',
        bodyColor: 'var(--text-secondary)',
        borderColor: 'var(--line)',
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
          color: 'var(--line)',
        },
        ticks: {
          color: 'var(--text-muted)',
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
          color: 'var(--line)',
        },
        ticks: {
          color: 'var(--text-muted)',
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