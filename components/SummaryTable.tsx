"use client";

import { useMemo } from "react";
import type { MetricDef } from "@/lib/types";
import { zTestProportion } from "@/lib/stats";

function fmt(v: number, format: MetricDef["format"]): string {
  if (!isFinite(v) || isNaN(v)) return "—";
  if (format === "percent")  return `${(v * 100).toFixed(2)}%`;
  if (format === "currency") return `$${v.toFixed(4)}`;
  return v.toFixed(2);
}

interface GroupSums { [col: string]: number }

interface SummaryTableProps {
  groupSums: Record<string, GroupSums>;   // groupKey → summed cols
  metric: MetricDef;
  controlKey: string;
}

export default function SummaryTable({ groupSums, metric, controlKey }: SummaryTableProps) {
  const isProportion = metric.metricType === "proportion";

  const rows = useMemo(() => {
    const ctrl  = groupSums[controlKey];
    const cNum  = ctrl?.[metric.numerator]   ?? 0;
    const cDen  = ctrl?.[metric.denominator] ?? 0;
    const cVal  = cDen === 0 ? 0 : cNum / cDen;

    return Object.entries(groupSums)
      .map(([key, sums]) => {
        const num    = sums[metric.numerator]   ?? 0;
        const den    = sums[metric.denominator] ?? 0;
        const value  = den === 0 ? NaN : num / den;
        const isCtrl = key === controlKey;

        // Proportions → absolute bps delta; means → relative % delta
        const delta = isCtrl
          ? null
          : isProportion
            ? (value - cVal) * 10_000          // bps
            : cVal === 0 ? null : (value - cVal) / cVal;  // relative %

        let conf: number | null = null;
        let sig = false;

        if (!isCtrl && isProportion) {
          const s = zTestProportion(num, den, cNum, cDen);
          conf = s.confidence;
          sig  = s.significant;
        }

        return { key, value, delta, conf, sig, isCtrl };
      })
      .sort((a, b) => (a.isCtrl ? -1 : b.isCtrl ? 1 : a.key.localeCompare(b.key)));
  }, [groupSums, metric, controlKey, isProportion]);

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm border-collapse">
        <thead>
          <tr className="bg-gray-100 text-gray-500 text-xs uppercase">
            <th className="text-left px-4 py-2 border border-gray-200">Group</th>
            <th className="text-right px-4 py-2 border border-gray-200">Value</th>
            <th className="text-right px-4 py-2 border border-gray-200">Δ vs Control</th>
            <th className="text-center px-4 py-2 border border-gray-200">Confidence</th>
            <th className="text-center px-4 py-2 border border-gray-200">Sig?</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(r => (
            <tr key={r.key} className={r.isCtrl ? "bg-blue-50 font-medium" : "hover:bg-gray-50"}>
              <td className="px-4 py-2 border border-gray-200 whitespace-nowrap">
                {r.key}
                {r.isCtrl && <span className="ml-1 text-xs text-blue-400">(ctrl)</span>}
              </td>
              <td className="px-4 py-2 border border-gray-200 text-right tabular-nums">
                {fmt(r.value, metric.format)}
              </td>
              <td className="px-4 py-2 border border-gray-200 text-right tabular-nums">
                {r.delta === null ? (
                  <span className="text-gray-400">—</span>
                ) : (
                  <span className={r.delta > 0 ? "text-green-600 font-medium" : r.delta < 0 ? "text-red-600 font-medium" : "text-gray-500"}>
                    {r.delta > 0 ? "+" : ""}
                    {isProportion
                      ? `${r.delta.toFixed(1)} bps`
                      : `${(r.delta * 100).toFixed(2)}%`
                    }
                  </span>
                )}
              </td>
              <td className="px-4 py-2 border border-gray-200 text-center">
                {r.conf === null ? (
                  <span className="text-gray-300 text-xs">N/A</span>
                ) : (
                  <span className={`text-xs px-2 py-0.5 rounded font-medium ${
                    r.sig ? "bg-green-100 text-green-700" :
                    r.conf > 80 ? "bg-yellow-100 text-yellow-700" :
                    "bg-gray-100 text-gray-500"
                  }`}>
                    {r.conf.toFixed(1)}%
                  </span>
                )}
              </td>
              <td className="px-4 py-2 border border-gray-200 text-center text-base">
                {r.sig ? "★" : ""}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="text-xs text-gray-400 mt-2 px-1">
        ★ p &lt; 0.05 · Proportions (retention, UPD): Δ in <strong>bps</strong> = (treatment − control) × 10,000 · Means (RPD, IPD, session): Δ as relative %
      </p>
    </div>
  );
}
