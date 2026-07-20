"use client";

import { useState, useCallback, useMemo } from "react";
import { parseExcel, uniqueVals } from "@/lib/parser";
import { STATIC_METRICS, buildEngagementMetrics } from "@/lib/metrics";
import FilterPanel, { type Filters } from "@/components/FilterPanel";
import MetricTable from "@/components/MetricTable";
import type { ParsedData, TabType, GroupBy, AggGroup, MetricDef } from "@/lib/types";

// ── Helpers ───────────────────────────────────────────────────────

function buildGroups(
  rows: Record<string, unknown>[],
  groupBy: GroupBy,
  controlVariant: string,
): AggGroup[] {
  const map = new Map<string, AggGroup>();

  for (const row of rows) {
    const variant    = String(row.variant    ?? "");
    const sub_variant = String(row.sub_variant ?? "");
    const key = groupBy === "variant"     ? variant
              : groupBy === "sub_variant" ? sub_variant
              : `${variant} · ${sub_variant}`;
    const label = key;

    if (!map.has(key)) {
      map.set(key, {
        groupKey: key, label,
        variant, sub_variant,
        sums: {},
        isControl: groupBy === "variant"     ? variant === controlVariant
                 : groupBy === "sub_variant" ? sub_variant === controlVariant
                 : variant === controlVariant,
      });
    }
    const g = map.get(key)!;
    for (const [col, val] of Object.entries(row)) {
      if (typeof val === "number") {
        g.sums[col] = (g.sums[col] ?? 0) + val;
      }
    }
  }

  // Sort: control first, then alphabetical
  return [...map.values()].sort((a, b) =>
    a.isControl ? -1 : b.isControl ? 1 : a.label.localeCompare(b.label)
  );
}

const TABS: TabType[] = ["IR", "RR", "Sessions", "Revenue", "Engagement"];

// ── Main Page ─────────────────────────────────────────────────────

export default function Home() {
  const [data, setData]               = useState<ParsedData | null>(null);
  const [loading, setLoading]         = useState(false);
  const [tab, setTab]                 = useState<TabType>("IR");
  const [groupBy, setGroupBy]         = useState<GroupBy>("variant");
  const [controlVariant, setControl]  = useState("control");
  const [metricGroup, setMetricGroup] = useState<string>("all");
  const [filters, setFilters]         = useState<Filters>({
    type: [], geo: [], user_type: [], cohort: [], payer_flag: [],
    install_source: [], install_bucket: [], install_type: [],
  });

  // ── File upload ─────────────────────────────────────────────────
  const onFile = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setLoading(true);
    const buf = await file.arrayBuffer();
    const parsed = parseExcel(buf);
    setData(parsed);
    // Init filters to all values
    const allVals = (rows: Record<string, unknown>[], col: string) =>
      [...new Set(rows.map(r => String(r[col] ?? "")))].filter(Boolean);
    setFilters({
      type:           allVals(parsed.metrics, "type"),
      geo:            allVals(parsed.metrics, "geo"),
      user_type:      allVals(parsed.metrics, "user_type"),
      cohort:         allVals(parsed.metrics, "cohort"),
      payer_flag:     allVals(parsed.metrics, "payer_flag"),
      install_source: allVals(parsed.metrics, "install_source"),
      install_bucket: allVals(parsed.metrics, "install_bucket"),
      install_type:   allVals(parsed.metrics, "install_type"),
    });
    // Auto-detect control variant
    const variants = allVals(parsed.metrics, "variant");
    const ctrl = variants.find(v => v.toLowerCase().includes("control")) ?? variants[0] ?? "control";
    setControl(ctrl);
    setLoading(false);
  }, []);

  // ── Filter options ──────────────────────────────────────────────
  const filterOptions = useMemo(() => {
    if (!data) return {} as Record<keyof Filters, string[]>;
    return {
      type:           uniqueVals(data.metrics, "type"),
      geo:            uniqueVals(data.metrics, "geo"),
      user_type:      uniqueVals(data.metrics, "user_type"),
      cohort:         uniqueVals(data.metrics, "cohort"),
      payer_flag:     uniqueVals(data.metrics, "payer_flag"),
      install_source: uniqueVals(data.metrics, "install_source"),
      install_bucket: uniqueVals(data.metrics, "install_bucket"),
      install_type:   uniqueVals(data.metrics, "install_type"),
    };
  }, [data]);

  const variantOptions = useMemo(() =>
    data ? uniqueVals(data.metrics, "variant") : [],
  [data]);

  // ── All metric defs ─────────────────────────────────────────────
  const allMetrics = useMemo(() => {
    if (!data) return STATIC_METRICS;
    return [...STATIC_METRICS, ...buildEngagementMetrics(data.engagementCols)];
  }, [data]);

  // ── Active metrics for current tab ──────────────────────────────
  const tabMetrics = useMemo(() =>
    allMetrics.filter(m => m.tab === tab),
  [allMetrics, tab]);

  const metricGroups = useMemo(() => {
    const seen = new Set<string>();
    tabMetrics.forEach(m => seen.add(m.group));
    return ["all", ...seen];
  }, [tabMetrics]);

  const visibleMetrics: MetricDef[] = useMemo(() =>
    metricGroup === "all" ? tabMetrics : tabMetrics.filter(m => m.group === metricGroup),
  [tabMetrics, metricGroup]);

  // ── Filtered rows ───────────────────────────────────────────────
  const filteredRows = useMemo(() => {
    if (!data) return [];
    const src = tab === "IR" ? data.ir : data.metrics;

    return (src as Record<string, unknown>[]).filter(r => {
      if (tab === "IR") {
        return (
          (filters.geo.length           === 0 || filters.geo.includes(String(r.geo))) &&
          (filters.install_source.length === 0 || filters.install_source.includes(String(r.install_source))) &&
          (filters.install_bucket.length === 0 || filters.install_bucket.includes(String(r.install_bucket))) &&
          (filters.install_type.length   === 0 || filters.install_type.includes(String(r.install_type)))
        );
      }
      return (
        (filters.type.length           === 0 || filters.type.includes(String(r.type))) &&
        (filters.geo.length            === 0 || filters.geo.includes(String(r.geo))) &&
        (filters.user_type.length      === 0 || filters.user_type.includes(String(r.user_type))) &&
        (filters.cohort.length         === 0 || filters.cohort.includes(String(r.cohort))) &&
        (filters.payer_flag.length     === 0 || filters.payer_flag.includes(String(r.payer_flag))) &&
        (filters.install_source.length === 0 || filters.install_source.includes(String(r.install_source))) &&
        (filters.install_bucket.length === 0 || filters.install_bucket.includes(String(r.install_bucket))) &&
        (filters.install_type.length   === 0 || filters.install_type.includes(String(r.install_type)))
      );
    });
  }, [data, tab, filters]);

  // ── Groups ──────────────────────────────────────────────────────
  const groups: AggGroup[] = useMemo(() =>
    buildGroups(filteredRows, groupBy, controlVariant),
  [filteredRows, groupBy, controlVariant]);

  const controlKey = useMemo(() => {
    const ctrl = groups.find(g => g.isControl);
    return ctrl?.groupKey ?? groups[0]?.groupKey ?? "";
  }, [groups]);

  // ── Render ──────────────────────────────────────────────────────
  if (!data) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-6 bg-gray-50">
        <div className="text-center">
          <h1 className="text-3xl font-bold text-gray-800 mb-2">Experiment Dashboard</h1>
          <p className="text-gray-500 mb-6">Upload your experiment Excel file (with IR and Metrics sheets)</p>
          <label className="cursor-pointer bg-blue-600 hover:bg-blue-700 text-white font-medium px-6 py-3 rounded-lg transition">
            {loading ? "Parsing…" : "Upload Excel (.xlsx)"}
            <input type="file" accept=".xlsx,.xls" className="hidden" onChange={onFile} />
          </label>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-screen overflow-hidden bg-gray-50">
      {/* Sidebar */}
      <FilterPanel
        options={filterOptions as Record<keyof Filters, string[]>}
        filters={filters}
        onChange={setFilters}
        controlVariant={controlVariant}
        onControlChange={setControl}
        variantOptions={variantOptions}
      />

      {/* Main */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Header */}
        <div className="bg-white border-b border-gray-200 px-6 py-3 flex items-center justify-between">
          <h1 className="font-bold text-gray-800 text-lg">Experiment Dashboard</h1>
          <label className="cursor-pointer text-sm text-blue-500 hover:underline">
            Upload new file
            <input type="file" accept=".xlsx,.xls" className="hidden" onChange={onFile} />
          </label>
        </div>

        {/* Tab bar */}
        <div className="bg-white border-b border-gray-200 px-6 flex gap-1 pt-2">
          {TABS.map(t => (
            <button
              key={t}
              onClick={() => { setTab(t); setMetricGroup("all"); }}
              className={`px-4 py-2 text-sm font-medium rounded-t border-b-2 transition ${
                tab === t
                  ? "border-blue-600 text-blue-600"
                  : "border-transparent text-gray-500 hover:text-gray-700"
              }`}
            >
              {t}
            </button>
          ))}
        </div>

        {/* Controls bar */}
        <div className="bg-white border-b border-gray-200 px-6 py-2 flex items-center gap-6 text-sm">
          {/* Grouping */}
          <div className="flex items-center gap-2">
            <span className="text-gray-500 font-medium">Group by:</span>
            {(["variant", "sub_variant", "both"] as GroupBy[]).map(g => (
              <button
                key={g}
                onClick={() => setGroupBy(g)}
                className={`px-3 py-1 rounded border text-xs font-medium transition ${
                  groupBy === g
                    ? "bg-blue-600 text-white border-blue-600"
                    : "bg-white text-gray-600 border-gray-300 hover:border-blue-400"
                }`}
              >
                {g === "both" ? "Variant × Sub-variant" : g.replace("_", " ")}
              </button>
            ))}
          </div>

          {/* Metric group filter */}
          {metricGroups.length > 2 && (
            <div className="flex items-center gap-2">
              <span className="text-gray-500 font-medium">Show:</span>
              <select
                className="border border-gray-200 rounded px-2 py-1 text-xs"
                value={metricGroup}
                onChange={e => setMetricGroup(e.target.value)}
              >
                {metricGroups.map(g => (
                  <option key={g} value={g}>{g === "all" ? "All groups" : g}</option>
                ))}
              </select>
            </div>
          )}

          <span className="ml-auto text-gray-400 text-xs">
            {filteredRows.length.toLocaleString()} rows · {groups.length} groups
          </span>
        </div>

        {/* Metric table */}
        <div className="flex-1 overflow-auto p-4">
          <MetricTable
            groups={groups}
            metrics={visibleMetrics}
            controlKey={controlKey}
            groupLabel={groupBy === "both" ? "Variant · Sub-variant" : groupBy.replace("_", " ")}
          />
        </div>
      </div>
    </div>
  );
}
