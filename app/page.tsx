"use client";

import { useState, useCallback, useMemo, useDeferredValue } from "react";
import { uniqueVals } from "@/lib/parser";
import { STATIC_METRICS, buildEngagementMetrics } from "@/lib/metrics";
import TrendChart from "@/components/TrendChart";
import SummaryTable from "@/components/SummaryTable";
import type { ParsedData, TabType, GroupBy, MetricDef } from "@/lib/types";

// ── Types ─────────────────────────────────────────────────────────

interface Filters {
  geo: string[]; user_type: string[]; cohort: string[];
  payer_flag: string[]; install_source: string[];
  install_bucket: string[]; install_type: string[]; type: string[];
}

// ── Constants ─────────────────────────────────────────────────────

const TABS: TabType[] = ["IR", "RR", "Sessions", "Revenue", "Engagement"];
const COLORS = ["#2563eb","#dc2626","#16a34a","#d97706","#7c3aed","#0891b2","#db2777","#65a30d"];

// ── Helpers ───────────────────────────────────────────────────────

function groupKey(row: Record<string, unknown>, groupBy: GroupBy): string {
  if (groupBy === "variant")     return String(row.variant ?? "");
  if (groupBy === "sub_variant") return String(row.sub_variant ?? "");
  return `${row.variant} · ${row.sub_variant}`;
}

function passes(row: Record<string, unknown>, filters: Filters, tab: TabType): boolean {
  if (tab !== "IR") {
    if (filters.type.length           && !filters.type.includes(String(row.type)))           return false;
    if (filters.user_type.length      && !filters.user_type.includes(String(row.user_type))) return false;
    if (filters.cohort.length         && !filters.cohort.includes(String(row.cohort)))       return false;
    if (filters.payer_flag.length     && !filters.payer_flag.includes(String(row.payer_flag))) return false;
  }
  if (filters.geo.length            && !filters.geo.includes(String(row.geo)))             return false;
  if (filters.install_source.length && !filters.install_source.includes(String(row.install_source))) return false;
  if (filters.install_bucket.length && !filters.install_bucket.includes(String(row.install_bucket))) return false;
  if (filters.install_type.length   && !filters.install_type.includes(String(row.install_type)))   return false;
  return true;
}

// ── Multi-select component ────────────────────────────────────────

function MultiSelect({ label, opts, sel, onChange }: {
  label: string; opts: string[]; sel: string[]; onChange: (v: string[]) => void;
}) {
  const all = sel.length === 0 || sel.length === opts.length;
  return (
    <div className="mb-3">
      <div className="flex justify-between items-center mb-1">
        <span className="text-xs font-semibold text-gray-500 uppercase">{label}</span>
        <button className="text-xs text-blue-500" onClick={() => onChange(all ? [] : [...opts])}>
          {all ? "None" : "All"}
        </button>
      </div>
      <div className="max-h-28 overflow-y-auto border rounded bg-white">
        {opts.map(o => (
          <label key={o} className="flex items-center gap-2 px-2 py-0.5 hover:bg-gray-50 cursor-pointer text-xs">
            <input type="checkbox" checked={sel.length === 0 || sel.includes(o)}
              onChange={() => {
                const base = sel.length === 0 ? opts : sel;
                onChange(base.includes(o) ? base.filter(x => x !== o) : [...base, o]);
              }} />
            <span className="truncate">{o || "(blank)"}</span>
          </label>
        ))}
      </div>
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────

export default function Home() {
  const [data,         setData]        = useState<ParsedData | null>(null);
  const [filterOpts,   setFilterOpts]  = useState<Record<string, string[]>>({});
  const [loading,      setLoading]     = useState(false);
  const [loadingMsg,   setLoadingMsg]  = useState("");

  const [tab,          setTab]         = useState<TabType>("IR");
  const [groupBy,      setGroupBy]     = useState<GroupBy>("variant");
  const [controlVar,   setControlVar]  = useState("control");
  const [selectedMetricKey, setMetric] = useState("");
  const [showFilters,  setShowFilters] = useState(false);

  const [filters, setFilters] = useState<Filters>({
    geo: [], user_type: [], cohort: [], payer_flag: [],
    install_source: [], install_bucket: [], install_type: [], type: [],
  });

  // Date range state: store as string "YYYY-MM-DD"
  const [dateRange, setDateRange] = useState<[string, string]>(["", ""]);

  const dFilters  = useDeferredValue(filters);
  const dDateRange = useDeferredValue(dateRange);

  // ── File upload ──────────────────────────────────────────────────
  const onFile = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setLoading(true);
    setLoadingMsg("Reading file…");
    const reader = new FileReader();
    reader.onload = ev => {
      const buffer = ev.target?.result as ArrayBuffer;
      setLoadingMsg("Launching worker…");
      const worker = new Worker("/worker.js");
      worker.onmessage = msg => {
        const { type, message, data } = msg.data;
        if (type === "progress") { setLoadingMsg(message); return; }
        if (type === "done") {
          const parsed = data as ParsedData & { filterOptions: Record<string, string[]> };
          setData(parsed);
          setFilterOpts(parsed.filterOptions ?? {});
          const variants = parsed.filterOptions?.variant ?? [];
          setControlVar(variants.find(v => v.toLowerCase().includes("control")) ?? variants[0] ?? "control");
          // Init date range from data
          const dates = [...new Set([
            ...parsed.metrics.map(r => String(r.dau_date ?? "")),
            ...parsed.ir.map(r => String(r.install_date ?? "")),
          ])].filter(Boolean).sort();
          if (dates.length) setDateRange([dates[0], dates[dates.length - 1]]);
          setLoading(false); setLoadingMsg(""); worker.terminate();
        }
        if (type === "error") { alert(message); setLoading(false); setLoadingMsg(""); worker.terminate(); }
      };
      worker.postMessage(buffer, [buffer]);
    };
    reader.readAsArrayBuffer(file);
  }, []);

  // ── All metric defs for current tab ─────────────────────────────
  const allMetrics = useMemo(() => {
    const eng = data ? buildEngagementMetrics(data.engagementCols) : [];
    return [...STATIC_METRICS, ...eng];
  }, [data]);

  const tabMetrics = useMemo(() => allMetrics.filter(m => m.tab === tab), [allMetrics, tab]);

  // Auto-select first metric when tab changes
  const activeMdef: MetricDef | undefined = tabMetrics.find(m => m.key === selectedMetricKey) ?? tabMetrics[0];

  // ── Source rows ──────────────────────────────────────────────────
  const srcRows = useMemo(() =>
    (tab === "IR" ? data?.ir ?? [] : data?.metrics ?? []) as Record<string, unknown>[],
  [data, tab]);

  // ── Date field name ──────────────────────────────────────────────
  const dateField = tab === "IR" ? "install_date" : "dau_date";

  // ── All dates in data ────────────────────────────────────────────
  const allDates = useMemo(() =>
    [...new Set(srcRows.map(r => String(r[dateField] ?? "")))].filter(Boolean).sort(),
  [srcRows, dateField]);

  // ── Filtered + date-sliced rows ──────────────────────────────────
  const filteredRows = useMemo(() => {
    const [d0, d1] = dDateRange;
    return srcRows.filter(r => {
      const d = String(r[dateField] ?? "");
      if (d0 && d < d0) return false;
      if (d1 && d > d1) return false;
      return passes(r, dFilters, tab);
    });
  }, [srcRows, dFilters, dDateRange, dateField, tab]);

  // ── Trend chart data ─────────────────────────────────────────────
  const { chartPoints, groups } = useMemo(() => {
    if (!activeMdef) return { chartPoints: [], groups: [] };

    // Aggregate: date × group → {num, den}
    const agg = new Map<string, Map<string, { num: number; den: number }>>();
    const groupSet = new Set<string>();

    for (const row of filteredRows) {
      const date = String(row[dateField] ?? "");
      const gk   = groupKey(row, groupBy);
      groupSet.add(gk);
      if (!agg.has(date)) agg.set(date, new Map());
      const dm = agg.get(date)!;
      if (!dm.has(gk)) dm.set(gk, { num: 0, den: 0 });
      const cell = dm.get(gk)!;
      cell.num += Number(row[activeMdef.numerator]   ?? 0);
      cell.den += Number(row[activeMdef.denominator] ?? 0);
    }

    const dates  = [...agg.keys()].sort();
    const groups = [...groupSet].sort((a, b) =>
      a === controlVar ? -1 : b === controlVar ? 1 : a.localeCompare(b)
    );

    const chartPoints = dates.map(date => {
      const point: Record<string, number | string> = { date };
      const dm = agg.get(date)!;
      for (const g of groups) {
        const cell = dm.get(g);
        point[g] = cell && cell.den > 0 ? cell.num / cell.den : NaN;
      }
      return point;
    });

    return { chartPoints, groups };
  }, [filteredRows, activeMdef, groupBy, dateField, controlVar]);

  // ── Summary table: aggregate over full date range per group ─────
  const groupSums = useMemo(() => {
    const result: Record<string, Record<string, number>> = {};
    for (const row of filteredRows) {
      const gk = groupKey(row, groupBy);
      if (!result[gk]) result[gk] = {};
      for (const [col, val] of Object.entries(row)) {
        if (typeof val === "number") {
          result[gk][col] = (result[gk][col] ?? 0) + val;
        }
      }
    }
    return result;
  }, [filteredRows, groupBy]);

  const controlKey = useMemo(() =>
    Object.keys(groupSums).find(k =>
      groupBy === "variant"     ? k === controlVar :
      groupBy === "sub_variant" ? k === controlVar :
      k.startsWith(controlVar)
    ) ?? Object.keys(groupSums)[0] ?? "",
  [groupSums, groupBy, controlVar]);

  // ── Metric groups for sidebar sections ──────────────────────────
  const metricSections = useMemo(() => {
    const map = new Map<string, MetricDef[]>();
    for (const m of tabMetrics) {
      if (!map.has(m.group)) map.set(m.group, []);
      map.get(m.group)!.push(m);
    }
    return map;
  }, [tabMetrics]);

  // ── Upload screen ────────────────────────────────────────────────
  if (!data) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-4 bg-gray-50">
        <h1 className="text-3xl font-bold text-gray-800">Experiment Dashboard</h1>
        <p className="text-gray-500">Upload your experiment Excel file (IR + Metrics sheets)</p>
        <label className={`cursor-pointer font-medium px-6 py-3 rounded-lg text-white transition ${loading ? "bg-gray-400 cursor-wait" : "bg-blue-600 hover:bg-blue-700"}`}>
          {loading ? loadingMsg || "Processing…" : "Upload Excel (.xlsx)"}
          {!loading && <input type="file" accept=".xlsx,.xls" className="hidden" onChange={onFile} />}
        </label>
        {loading && (
          <div className="flex items-center gap-2 text-gray-500 text-sm">
            <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/>
            </svg>
            {loadingMsg}
          </div>
        )}
      </div>
    );
  }

  // ── Dashboard ────────────────────────────────────────────────────
  return (
    <div className="flex flex-col h-screen bg-gray-50 overflow-hidden">

      {/* ── Top bar ─────────────────────────────────────────────── */}
      <div className="bg-white border-b border-gray-200 px-6 py-3 flex items-center justify-between shrink-0">
        <h1 className="text-lg font-bold text-gray-800">🧪 Experiment Dashboard</h1>
        <label className="cursor-pointer text-sm text-blue-500 hover:underline">
          Upload new file
          <input type="file" accept=".xlsx,.xls" className="hidden" onChange={onFile} />
        </label>
      </div>

      {/* ── Tab bar ─────────────────────────────────────────────── */}
      <div className="bg-white border-b border-gray-200 px-6 flex gap-1 shrink-0">
        {TABS.map(t => (
          <button key={t} onClick={() => { setTab(t); setMetric(""); }}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition ${
              tab === t ? "border-blue-600 text-blue-600" : "border-transparent text-gray-500 hover:text-gray-700"
            }`}>
            {t}
          </button>
        ))}
      </div>

      {/* ── Controls bar ────────────────────────────────────────── */}
      <div className="bg-white border-b border-gray-200 px-6 py-2 flex flex-wrap items-center gap-4 shrink-0">

        {/* Group by */}
        <div className="flex items-center gap-2 text-sm">
          <span className="text-gray-500 font-medium text-xs uppercase">Group by</span>
          {(["variant", "sub_variant", "both"] as GroupBy[]).map(g => (
            <button key={g} onClick={() => setGroupBy(g)}
              className={`px-3 py-1 rounded text-xs font-medium border transition ${
                groupBy === g ? "bg-blue-600 text-white border-blue-600" : "bg-white text-gray-600 border-gray-300 hover:border-blue-400"
              }`}>
              {g === "both" ? "Variant × Sub-variant" : g.replace("_", " ")}
            </button>
          ))}
        </div>

        {/* Control variant */}
        <div className="flex items-center gap-2 text-sm">
          <span className="text-gray-500 font-medium text-xs uppercase">Control</span>
          <select className="border border-gray-200 rounded px-2 py-1 text-xs"
            value={controlVar} onChange={e => setControlVar(e.target.value)}>
            {(filterOpts.variant ?? []).map(v => <option key={v}>{v}</option>)}
          </select>
        </div>

        {/* Date range */}
        <div className="flex items-center gap-2 text-sm">
          <span className="text-gray-500 font-medium text-xs uppercase">Date</span>
          <input type="date" value={dateRange[0]}
            min={allDates[0]} max={allDates[allDates.length - 1]}
            onChange={e => setDateRange([e.target.value, dateRange[1]])}
            className="border border-gray-200 rounded px-2 py-1 text-xs" />
          <span className="text-gray-400">→</span>
          <input type="date" value={dateRange[1]}
            min={allDates[0]} max={allDates[allDates.length - 1]}
            onChange={e => setDateRange([dateRange[0], e.target.value])}
            className="border border-gray-200 rounded px-2 py-1 text-xs" />
        </div>

        {/* Filters toggle */}
        <button onClick={() => setShowFilters(f => !f)}
          className={`ml-auto px-3 py-1 rounded text-xs font-medium border transition ${
            showFilters ? "bg-gray-800 text-white border-gray-800" : "bg-white text-gray-600 border-gray-300 hover:border-gray-500"
          }`}>
          ⚙ Filters {showFilters ? "▲" : "▼"}
        </button>
      </div>

      {/* ── Filter drawer ────────────────────────────────────────── */}
      {showFilters && (
        <div className="bg-gray-50 border-b border-gray-200 px-6 py-3 grid grid-cols-4 gap-4 shrink-0">
          {tab !== "IR" && (
            <MultiSelect label="Data Type" opts={filterOpts.type ?? []}
              sel={filters.type} onChange={v => setFilters(f => ({ ...f, type: v }))} />
          )}
          <MultiSelect label="Geo" opts={filterOpts.geo ?? []}
            sel={filters.geo} onChange={v => setFilters(f => ({ ...f, geo: v }))} />
          {tab !== "IR" && <>
            <MultiSelect label="User Type" opts={filterOpts.user_type ?? []}
              sel={filters.user_type} onChange={v => setFilters(f => ({ ...f, user_type: v }))} />
            <MultiSelect label="Cohort" opts={filterOpts.cohort ?? []}
              sel={filters.cohort} onChange={v => setFilters(f => ({ ...f, cohort: v }))} />
            <MultiSelect label="Payer Flag" opts={filterOpts.payer_flag ?? []}
              sel={filters.payer_flag} onChange={v => setFilters(f => ({ ...f, payer_flag: v }))} />
          </>}
          <MultiSelect label="Install Source" opts={filterOpts.install_source ?? []}
            sel={filters.install_source} onChange={v => setFilters(f => ({ ...f, install_source: v }))} />
          <MultiSelect label="Install Bucket" opts={filterOpts.install_bucket ?? []}
            sel={filters.install_bucket} onChange={v => setFilters(f => ({ ...f, install_bucket: v }))} />
          <MultiSelect label="Install Type" opts={filterOpts.install_type ?? []}
            sel={filters.install_type} onChange={v => setFilters(f => ({ ...f, install_type: v }))} />
        </div>
      )}

      {/* ── Main area ────────────────────────────────────────────── */}
      <div className="flex flex-1 overflow-hidden">

        {/* Left: Metric list ──────────────────────────────────── */}
        <div className="w-52 shrink-0 bg-white border-r border-gray-200 overflow-y-auto p-3">
          <p className="text-xs font-semibold text-gray-400 uppercase mb-2">Metrics</p>
          {[...metricSections.entries()].map(([section, metrics]) => (
            <div key={section} className="mb-4">
              <p className="text-xs font-semibold text-gray-400 mb-1 px-1">{section}</p>
              {metrics.map(m => (
                <button key={m.key} onClick={() => setMetric(m.key)}
                  className={`w-full text-left px-2 py-1.5 rounded text-xs transition ${
                    activeMdef?.key === m.key
                      ? "bg-blue-600 text-white font-medium"
                      : "text-gray-700 hover:bg-gray-100"
                  }`}>
                  {m.label}
                </button>
              ))}
            </div>
          ))}
        </div>

        {/* Centre: Chart ─────────────────────────────────────── */}
        <div className="flex-1 flex flex-col overflow-hidden border-r border-gray-200">

          {/* Metric title */}
          <div className="bg-white px-6 py-3 border-b border-gray-200 flex items-center justify-between shrink-0">
            <div>
              <h2 className="text-base font-bold text-gray-800">
                {activeMdef?.label ?? "Select a metric from the left"}
              </h2>
              <p className="text-xs text-gray-400 mt-0.5">
                {filteredRows.length.toLocaleString()} rows · {groups.length} groups · {chartPoints.length} dates
              </p>
            </div>
            {/* Group colour legend */}
            <div className="flex flex-wrap gap-2">
              {groups.map((g, i) => (
                <span key={g}
                  className="text-xs px-2 py-0.5 rounded-full font-medium text-white"
                  style={{ backgroundColor: COLORS[i % COLORS.length] }}>
                  {g}
                </span>
              ))}
            </div>
          </div>

          {/* Chart — fills remaining vertical space */}
          <div className="flex-1 bg-white p-6 overflow-hidden flex flex-col">
            {activeMdef ? (
              <TrendChart
                points={chartPoints as { date: string; [k: string]: number | string }[]}
                groups={groups}
                metric={activeMdef}
                fullHeight
              />
            ) : (
              <div className="flex-1 flex items-center justify-center text-gray-300 text-sm">
                Select a metric →
              </div>
            )}
          </div>
        </div>

        {/* Right: Delta & Confidence table ────────────────────── */}
        <div className="w-96 shrink-0 bg-white overflow-y-auto flex flex-col">
          <div className="px-4 py-3 border-b border-gray-200 shrink-0">
            <p className="text-xs font-semibold text-gray-500 uppercase">
              Delta &amp; Confidence
            </p>
            <p className="text-xs text-gray-400 mt-0.5">Aggregated over selected date range</p>
          </div>
          <div className="flex-1 overflow-y-auto p-4">
            {activeMdef && Object.keys(groupSums).length > 0 ? (
              <SummaryTable
                groupSums={groupSums}
                metric={activeMdef}
                controlKey={controlKey}
              />
            ) : (
              <p className="text-xs text-gray-400 text-center mt-8">No data</p>
            )}
          </div>
        </div>

      </div>
    </div>
  );
}
