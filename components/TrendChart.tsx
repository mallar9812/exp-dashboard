"use client";

import {
  LineChart, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, Legend, ResponsiveContainer,
} from "recharts";
import type { MetricDef } from "@/lib/types";

const COLORS = [
  "#2563eb","#dc2626","#16a34a","#d97706","#7c3aed",
  "#0891b2","#db2777","#65a30d","#ea580c","#6366f1",
];

function formatVal(v: number, format: MetricDef["format"]): string {
  if (!isFinite(v) || isNaN(v)) return "—";
  if (format === "percent")  return `${(v * 100).toFixed(2)}%`;
  if (format === "currency") return `$${v.toFixed(4)}`;
  return v.toFixed(2);
}

interface ChartPoint {
  date: string;
  [group: string]: number | string;
}

interface TrendChartProps {
  points: ChartPoint[];
  groups: string[];           // all group keys (exp + PAB)
  pabGroups?: Set<string>;    // which keys are PAB → rendered dashed
  metric: MetricDef;
  fullHeight?: boolean;
}

export default function TrendChart({
  points, groups, pabGroups = new Set(), metric, fullHeight,
}: TrendChartProps) {
  if (!points.length) return (
    <div className="flex items-center justify-center h-64 text-gray-400">
      No data for selected filters
    </div>
  );

  // Exp groups get index-based colors; PAB groups reuse the same color (just dashed)
  const expGroups = groups.filter(g => !pabGroups.has(g));
  const colorFor  = (g: string): string => {
    if (!pabGroups.has(g)) return COLORS[expGroups.indexOf(g) % COLORS.length];
    const base = g.replace(" (PAB)", "");
    const idx  = expGroups.indexOf(base);
    return COLORS[idx >= 0 ? idx : 0] ?? "#999";
  };

  return (
    <ResponsiveContainer width="100%" height={fullHeight ? "100%" : 300}>
      <LineChart data={points} margin={{ top: 8, right: 24, left: 8, bottom: 8 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
        <XAxis
          dataKey="date"
          tick={{ fontSize: 11 }}
          tickFormatter={d => d.slice(5)}
          minTickGap={30}
        />
        <YAxis
          tick={{ fontSize: 11 }}
          tickFormatter={v => formatVal(v as number, metric.format)}
          width={72}
        />
        <Tooltip
          formatter={(v: number, name: string) => [formatVal(v, metric.format), name]}
          labelFormatter={l => `Date: ${l}`}
        />
        <Legend />
        {groups.map(g => (
          <Line
            key={g}
            type="monotone"
            dataKey={g}
            name={g}
            stroke={colorFor(g)}
            strokeWidth={2}
            strokeDasharray={pabGroups.has(g) ? "6 3" : undefined}
            dot={false}
            connectNulls
          />
        ))}
      </LineChart>
    </ResponsiveContainer>
  );
}
