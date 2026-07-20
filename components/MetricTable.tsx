"use client";

import { useMemo } from "react";
import type { MetricDef, AggGroup, GroupResult } from "@/lib/types";
import { zTestProportion } from "@/lib/stats";

function formatVal(v: number, format: MetricDef["format"]): string {
  if (isNaN(v) || !isFinite(v)) return "—";
  if (format === "percent") return `${(v * 100).toFixed(2)}%`;
  if (format === "currency") return `$${v.toFixed(4)}`;
  return v.toFixed(2);
}

function DeltaBadge({ delta }: { delta: number | null }) {
  if (delta === null) return <span className="text-gray-400">—</span>;
  const pct = (delta * 100).toFixed(2);
  const color = delta > 0 ? "text-green-600" : delta < 0 ? "text-red-600" : "text-gray-500";
  return <span className={`font-medium ${color}`}>{delta > 0 ? "+" : ""}{pct}%</span>;
}

function ConfBadge({ conf, sig }: { conf: number | null; sig: boolean }) {
  if (conf === null) return <span className="text-gray-400 text-xs">N/A</span>;
  const color = sig ? "bg-green-100 text-green-700" : conf > 80 ? "bg-yellow-100 text-yellow-700" : "bg-gray-100 text-gray-500";
  return (
    <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${color}`}>
      {conf.toFixed(1)}% {sig ? "★" : ""}
    </span>
  );
}

function computeResults(
  groups: AggGroup[],
  metrics: MetricDef[],
  controlKey: string,
): GroupResult[] {
  const control = groups.find(g => g.groupKey === controlKey) ?? groups[0];

  return groups.map(g => {
    const values = metrics.map(def => {
      const num  = g.sums[def.numerator]   ?? 0;
      const den  = g.sums[def.denominator] ?? 0;
      const value = den === 0 ? 0 : num / den;

      if (g.isControl) {
        return { def, value, delta: null, confidence: null, pValue: null, significant: false };
      }

      const cNum = control?.sums[def.numerator]   ?? 0;
      const cDen = control?.sums[def.denominator] ?? 0;
      const cVal = cDen === 0 ? 0 : cNum / cDen;
      const delta = cVal === 0 ? null : (value - cVal) / cVal;

      let stat = { pValue: null as number | null, confidence: null as number | null, significant: false };
      if (def.metricType === "proportion") {
        const s = zTestProportion(num, den, cNum, cDen);
        stat = { pValue: s.pValue, confidence: s.confidence, significant: s.significant };
      }

      return { def, value, delta, ...stat };
    });

    return { group: g, values };
  });
}

interface MetricTableProps {
  groups: AggGroup[];
  metrics: MetricDef[];
  controlKey: string;
  groupLabel: string;
}

export default function MetricTable({ groups, metrics, controlKey, groupLabel }: MetricTableProps) {
  const results = useMemo(
    () => computeResults(groups, metrics, controlKey),
    [groups, metrics, controlKey]
  );

  // Group metrics by their `group` property for section headers
  const metricGroups = useMemo(() => {
    const seen = new Set<string>();
    const order: string[] = [];
    metrics.forEach(m => { if (!seen.has(m.group)) { seen.add(m.group); order.push(m.group); } });
    return order;
  }, [metrics]);

  if (groups.length === 0) return <p className="text-gray-400 p-4">No data after filters.</p>;

  return (
    <div className="overflow-x-auto">
      <table className="text-sm w-full border-collapse">
        <thead>
          <tr className="bg-gray-100 text-gray-600 text-xs uppercase">
            <th className="sticky left-0 bg-gray-100 text-left px-3 py-2 border border-gray-200 whitespace-nowrap">
              {groupLabel}
            </th>
            {metrics.map(m => (
              <th key={m.key} colSpan={3} className="px-3 py-2 border border-gray-200 text-center whitespace-nowrap">
                {m.label}
              </th>
            ))}
          </tr>
          <tr className="bg-gray-50 text-gray-500 text-xs">
            <th className="sticky left-0 bg-gray-50 border border-gray-200 px-3 py-1" />
            {metrics.map(m => (
              <>
                <th key={`${m.key}-v`}  className="border border-gray-200 px-2 py-1 text-center">Value</th>
                <th key={`${m.key}-d`}  className="border border-gray-200 px-2 py-1 text-center">Δ</th>
                <th key={`${m.key}-c`}  className="border border-gray-200 px-2 py-1 text-center">Conf.</th>
              </>
            ))}
          </tr>
        </thead>
        <tbody>
          {results.map(({ group, values }) => (
            <tr
              key={group.groupKey}
              className={group.isControl ? "bg-blue-50 font-medium" : "hover:bg-gray-50"}
            >
              <td className="sticky left-0 bg-inherit border border-gray-200 px-3 py-2 whitespace-nowrap">
                {group.label}
                {group.isControl && <span className="ml-1 text-xs text-blue-500">(ctrl)</span>}
              </td>
              {values.map(v => (
                <>
                  <td key={`${group.groupKey}-${v.def.key}-val`} className="border border-gray-200 px-2 py-2 text-right tabular-nums">
                    {formatVal(v.value, v.def.format)}
                  </td>
                  <td key={`${group.groupKey}-${v.def.key}-delta`} className="border border-gray-200 px-2 py-2 text-right tabular-nums">
                    <DeltaBadge delta={v.delta} />
                  </td>
                  <td key={`${group.groupKey}-${v.def.key}-conf`} className="border border-gray-200 px-2 py-2 text-center">
                    <ConfBadge conf={v.confidence} sig={v.significant} />
                  </td>
                </>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      <p className="text-xs text-gray-400 mt-2">
        ★ = p &lt; 0.05 (statistically significant) · Confidence shown for proportions only · Δ = (treatment − control) / control
      </p>
    </div>
  );
}
