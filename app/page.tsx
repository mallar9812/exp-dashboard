"use client";

import { useState, useCallback, useMemo } from "react";
import { STATIC_METRICS, buildEngagementMetrics, filterToAvailableMetrics } from "@/lib/metrics";
import TrendChart from "@/components/TrendChart";
import SummaryTable from "@/components/SummaryTable";
import type { ParsedData, TabType, GroupBy, MetricDef } from "@/lib/types";

// ── Types ──────────────────────────────────────────────────────────────────────

interface Filters {
  type: string[]; geo: string[]; user_type: string[]; cohort: string[];
  payer_flag: string[]; install_source: string[];
  install_bucket: string[]; install_type: string[];
}

const EMPTY_FILTERS: Filters = {
  type: [], geo: [], user_type: [], cohort: [], payer_flag: [],
  install_source: [], install_bucket: [], install_type: [],
};

// ── Constants ──────────────────────────────────────────────────────────────────

const TABS: TabType[] = ["IR", "RR", "Sessions", "Revenue", "Engagement"];
const COLORS = [
  "#2563eb","#dc2626","#16a34a","#d97706","#7c3aed",
  "#0891b2","#db2777","#65a30d","#ea580c","#6366f1",
];

// ── Helpers ────────────────────────────────────────────────────────────────────

function sv(row: Record<string, unknown>, col: string) {
  return String(row[col] ?? "").trim();
}

function groupKey(row: Record<string, unknown>, groupBy: GroupBy): string {
  if (groupBy === "variant")     return sv(row, "variant");
  if (groupBy === "sub_variant") return sv(row, "sub_variant");
  return `${sv(row,"variant")} · ${sv(row,"sub_variant")}`;
}

function passes(row: Record<string, unknown>, f: Filters, tab: TabType): boolean {
  const check = (arr: string[], col: string) =>
    arr.length === 0 || arr.includes(sv(row, col));
  if (tab !== "IR") {
    if (!check(f.type,       "type"))       return false;
    if (!check(f.user_type,  "user_type"))  return false;
    if (!check(f.cohort,     "cohort"))     return false;
    if (!check(f.payer_flag, "payer_flag")) return false;
  }
  if (!check(f.geo,            "geo"))            return false;
  if (!check(f.install_source, "install_source")) return false;
  if (!check(f.install_bucket, "install_bucket")) return false;
  if (!check(f.install_type,   "install_type"))   return false;
  return true;
}

function uniq(rows: Record<string, unknown>[], col: string): string[] {
  return [...new Set(rows.map(r => sv(r, col)))].filter(Boolean).sort();
}

// ── MultiSelect ────────────────────────────────────────────────────────────────

function MultiSelect({
  label, opts, sel, onChange,
}: {
  label: string; opts: string[]; sel: string[]; onChange: (v: string[]) => void;
}) {
  if (!opts.length) return null;
  const allSel = sel.length === 0;

  return (
    <div className="mb-2">
      <div className="flex justify-between items-center mb-1">
        <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">{label}</span>
        <button
          className="text-xs text-blue-500 hover:underline"
          onClick={() => onChange([])}
        >
          All
        </button>
      </div>
      <div className="max-h-24 overflow-y-auto space-y-0.5">
        {opts.map(o => {
          const checked = allSel || sel.includes(o);
          return (
            <label
              key={o}
              className={`flex items-center gap-1.5 px-2 py-0.5 rounded cursor-pointer text-xs transition ${
                checked ? "bg-blue-50 text-blue-800" : "text-gray-500 hover:bg-gray-50"
              }`}
            >
              <input
                type="checkbox"
                className="accent-blue-600"
                checked={checked}
                onChange={() => {
                  if (allSel) {
                    // first click = deselect this one, keep all others
                    onChange(opts.filter(x => x !== o));
                  } else if (sel.includes(o)) {
                    const next = sel.filter(x => x !== o);
                    onChange(next.length === 0 ? [] : next);
                  } else {
                    onChange([...sel, o]);
                  }
                }}
              />
              <span className="truncate">{o || "(blank)"}</span>
            </label>
          );
        })}
      </div>
    </div>
  );
}

// ── Main page ──────────────────────────────────────────────────────────────────

export default function Home() {
  const [data,         setData]        = useState<ParsedData | null>(null);
  const [loading,      setLoading]     = useState(false);
  const [loadingMsg,   setLoadingMsg]  = useState("");
  const [debugInfo,    setDebugInfo]   = useState<{ colsByTab: Record<string,string[]>; counts: Record<string,number> } | null>(null);
  const [showDebug,    setShowDebug]   = useState(false);

  const [tab,        setTab]       = useState<TabType>("IR");
  const [groupBy,    setGroupBy]   = useState<GroupBy>("variant");
  const [controlVar, setControl]   = useState("control");
  const [metricKey,  setMetricKey] = useState("");
  const [filters,    setFilters]   = useState<Filters>(EMPTY_FILTERS);
  const [dateRange,  setDateRange] = useState<[string, string]>(["", ""]);

  // ── File upload ────────────────────────────────────────────────────────────
  const onFile = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setLoading(true); setLoadingMsg("Reading file…");
    const reader = new FileReader();
    reader.onload = ev => {
      const buffer = ev.target?.result as ArrayBuffer;
      const worker = new Worker("/worker.js");
      worker.onmessage = msg => {
        const { type, message, data: d } = msg.data;
        if (type === "progress") { setLoadingMsg(message); return; }
        if (type === "done") {
          const parsed = d as ParsedData & { filterOptions: Record<string, string[]> };
          setData(parsed);
          setDebugInfo({ colsByTab: parsed.detectedColsByTab ?? {}, counts: parsed.rowCounts ?? {} });
          const variants = parsed.filterOptions?.variant ?? [];
          setControl(variants.find(v => v.toLowerCase().includes("control")) ?? variants[0] ?? "control");
          // init date range from IR dates
          const irDates = parsed.ir.map(r => String(r.install_date ?? "").slice(0,10)).filter(Boolean).sort();
          if (irDates.length) setDateRange([irDates[0], irDates[irDates.length - 1]]);
          setFilters(EMPTY_FILTERS);
          setLoading(false); setLoadingMsg(""); worker.terminate();
        }
        if (type === "error") {
          alert("Parse error: " + message);
          setLoading(false); setLoadingMsg(""); worker.terminate();
        }
      };
      worker.postMessage(buffer, [buffer]);
    };
    reader.readAsArrayBuffer(file);
  }, []);

  // ── Metrics — only show metrics whose columns exist in per-tab data ────────
  const allMetrics = useMemo(() => {
    const eng       = data ? buildEngagementMetrics(data.engagementCols) : [];
    const all       = [...STATIC_METRICS, ...eng];
    const byTab     = data?.detectedColsByTab ?? {};
    return Object.keys(byTab).length ? filterToAvailableMetrics(all, byTab) : all;
  }, [data]);

  const tabMetrics = useMemo(() => allMetrics.filter(m => m.tab === tab), [allMetrics, tab]);

  const activeMdef: MetricDef | undefined =
    tabMetrics.find(m => m.key === metricKey) ?? tabMetrics[0];

  const metricSections = useMemo(() => {
    const map = new Map<string, MetricDef[]>();
    for (const m of tabMetrics) {
      if (!map.has(m.group)) map.set(m.group, []);
      map.get(m.group)!.push(m);
    }
    return map;
  }, [tabMetrics]);

  // ── Source rows — per tab ─────────────────────────────────────────────────
  const dateField = tab === "IR" ? "install_date" : "dau_date";

  const srcRows = useMemo(() => {
    if (tab === "IR") return (data?.ir ?? []) as Record<string, unknown>[];
    const all = (data?.metrics ?? []) as Record<string, unknown>[];
    // If per-tab sheets: filter by _tab; if legacy single sheet: use all rows
    const hasPerTab = data?.hasPerTabSheets ?? false;
    return hasPerTab ? all.filter(r => String(r._tab) === tab) : all;
  }, [data, tab]);

  // ── Live filter options from current tab data ──────────────────────────────
  const filterOpts = useMemo(() => ({
    type:           uniq(srcRows, "type"),
    geo:            uniq(srcRows, "geo"),
    user_type:      uniq(srcRows, "user_type"),
    cohort:         uniq(srcRows, "cohort"),
    payer_flag:     uniq(srcRows, "payer_flag"),
    install_source: uniq(srcRows, "install_source"),
    install_bucket: uniq(srcRows, "install_bucket"),
    install_type:   uniq(srcRows, "install_type"),
    variant:        uniq(srcRows, "variant"),
  }), [srcRows]);

  // ── Date bounds for current tab ────────────────────────────────────────────
  const allDates = useMemo(
    () => uniq(srcRows, dateField).map(d => d.slice(0,10)).filter(Boolean).sort(),
    [srcRows, dateField],
  );

  // ── Filtered rows (real-time, no defer) ───────────────────────────────────
  const filteredRows = useMemo(() => {
    const [d0, d1] = dateRange;
    return srcRows.filter(r => {
      const d = sv(r, dateField).slice(0, 10);
      if (d0 && d && d < d0) return false;
      if (d1 && d && d > d1) return false;
      return passes(r, filters, tab);
    });
  }, [srcRows, filters, dateRange, dateField, tab]);

  // ── Exp / PAB split ───────────────────────────────────────────────────────
  const expRows = useMemo(() => filteredRows.filter(r => sv(r,"type") !== "PAB"), [filteredRows]);
  const pabRows = useMemo(() => filteredRows.filter(r => sv(r,"type") === "PAB"),  [filteredRows]);
  const hasPAB  = pabRows.length > 0;
  const hasExp  = expRows.length > 0;

  // ── Aggregation helpers ────────────────────────────────────────────────────
  type AggMap = Map<string, Map<string, { num: number; den: number }>>;

  function buildAgg(rows: Record<string, unknown>[], suffix: string) {
    if (!activeMdef) return { dates: [] as string[], groups: [] as string[], agg: new Map() as AggMap };
    const agg = new Map<string, Map<string, { num: number; den: number }>>();
    const gset = new Set<string>();
    for (const row of rows) {
      const date = sv(row, dateField).slice(0, 10);
      const gk   = groupKey(row, groupBy) + suffix;
      gset.add(gk);
      if (!agg.has(date)) agg.set(date, new Map());
      const dm = agg.get(date)!;
      if (!dm.has(gk)) dm.set(gk, { num: 0, den: 0 });
      const cell = dm.get(gk)!;
      cell.num += Number(row[activeMdef.numerator]   ?? 0);
      cell.den += Number(row[activeMdef.denominator] ?? 0);
    }
    const groups = [...gset].sort((a, b) =>
      a.startsWith(controlVar) ? -1 : b.startsWith(controlVar) ? 1 : a.localeCompare(b)
    );
    return { dates: [...agg.keys()].sort(), groups, agg };
  }

  function buildSums(rows: Record<string, unknown>[], suffix: string) {
    const result: Record<string, Record<string, number>> = {};
    for (const row of rows) {
      const gk = groupKey(row, groupBy) + suffix;
      if (!result[gk]) result[gk] = {};
      for (const [col, val] of Object.entries(row)) {
        if (typeof val === "number") result[gk][col] = (result[gk][col] ?? 0) + val;
      }
    }
    return result;
  }

  // ── Chart data ────────────────────────────────────────────────────────────
  const { chartPoints, groups, pabGroupSet } = useMemo(() => {
    if (!activeMdef) return { chartPoints: [], groups: [] as string[], pabGroupSet: new Set<string>() };
    const eA = buildAgg(expRows, "");
    const pA = buildAgg(pabRows, " (PAB)");
    const allD = [...new Set([...eA.dates, ...pA.dates])].sort();
    const allG = [...eA.groups, ...pA.groups];
    const pabSet = new Set(pA.groups);
    const pts = allD.map(date => {
      const pt: Record<string, number | string> = { date };
      for (const g of eA.groups) { const c = eA.agg.get(date)?.get(g); pt[g] = c && c.den > 0 ? c.num/c.den : NaN; }
      for (const g of pA.groups) { const c = pA.agg.get(date)?.get(g); pt[g] = c && c.den > 0 ? c.num/c.den : NaN; }
      return pt;
    });
    return { chartPoints: pts, groups: allG, pabGroupSet: pabSet };
  }, [expRows, pabRows, activeMdef, groupBy, dateField, controlVar]);

  // ── Summary sums ──────────────────────────────────────────────────────────
  const expGroupSums = useMemo(() => buildSums(expRows, ""),        [expRows, groupBy]);
  const pabGroupSums = useMemo(() => buildSums(pabRows, " (PAB)"), [pabRows, groupBy]);

  const expCtrlKey = useMemo(() =>
    Object.keys(expGroupSums).find(k => k.startsWith(controlVar)) ?? Object.keys(expGroupSums)[0] ?? "",
  [expGroupSums, controlVar]);

  const pabCtrlKey = useMemo(() =>
    Object.keys(pabGroupSums).find(k => k.startsWith(controlVar)) ?? Object.keys(pabGroupSums)[0] ?? "",
  [pabGroupSums, controlVar]);

  // ── Tab switch helper ──────────────────────────────────────────────────────
  function switchTab(t: TabType) {
    setTab(t); setMetricKey(""); setFilters(EMPTY_FILTERS);
    if (data) {
      const field = t === "IR" ? "install_date" : "dau_date";
      const src   = (t === "IR" ? data.ir : data.metrics) as Record<string, unknown>[];
      const dates = [...new Set(src.map(r => String(r[field] ?? "").slice(0,10)))].filter(Boolean).sort();
      if (dates.length) setDateRange([dates[0], dates[dates.length - 1]]);
    }
  }

  // ── Upload screen ──────────────────────────────────────────────────────────
  if (!data) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-6 bg-gray-50">
        <h1 className="text-3xl font-bold text-gray-800">Experiment Dashboard</h1>
        <p className="text-gray-500 text-sm">Upload your Excel file (sheets: IR, DAU, PAB)</p>
        <label className={`cursor-pointer font-medium px-6 py-3 rounded-lg text-white transition
          ${loading ? "bg-gray-400 cursor-wait" : "bg-blue-600 hover:bg-blue-700"}`}>
          {loading ? (loadingMsg || "Processing…") : "Upload Excel (.xlsx)"}
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

  // ── Dashboard ──────────────────────────────────────────────────────────────
  return (
    <div className="flex h-screen bg-gray-100 overflow-hidden text-sm">

      {/* ══ LEFT SIDEBAR: metric list + filters ═══════════════════════════════ */}
      <aside className="w-56 shrink-0 flex flex-col bg-white border-r border-gray-200 overflow-hidden">

        {/* Logo / upload */}
        <div className="px-3 py-3 border-b border-gray-200 shrink-0 flex items-center justify-between">
          <span className="font-bold text-gray-800 text-sm">📊 ExpDash</span>
          <label className="text-xs text-blue-500 cursor-pointer hover:underline">
            New file
            <input type="file" accept=".xlsx,.xls" className="hidden" onChange={onFile} />
          </label>
        </div>

        {/* Metric list */}
        <div className="flex-1 overflow-y-auto p-2 border-b border-gray-200">
          <p className="text-xs font-semibold text-gray-400 uppercase px-1 mb-1">Metrics</p>
          {[...metricSections.entries()].map(([section, mlist]) => (
            <div key={section} className="mb-3">
              <p className="text-xs text-gray-400 px-1 mb-0.5">{section}</p>
              {mlist.map(m => (
                <button key={m.key} onClick={() => setMetricKey(m.key)}
                  className={`w-full text-left px-2 py-1 rounded text-xs transition ${
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

        {/* Filters — always visible */}
        <div className="overflow-y-auto p-2" style={{ maxHeight: "45%" }}>
          <p className="text-xs font-semibold text-gray-400 uppercase px-1 mb-2">Filters</p>

          {tab !== "IR" && filterOpts.type.length > 0 && (
            <MultiSelect label="Data Type"
              opts={filterOpts.type} sel={filters.type}
              onChange={v => setFilters(f => ({ ...f, type: v }))} />
          )}
          {filterOpts.geo.length > 0 && (
            <MultiSelect label="Geo"
              opts={filterOpts.geo} sel={filters.geo}
              onChange={v => setFilters(f => ({ ...f, geo: v }))} />
          )}
          {tab !== "IR" && filterOpts.user_type.length > 0 && (
            <MultiSelect label="User Type"
              opts={filterOpts.user_type} sel={filters.user_type}
              onChange={v => setFilters(f => ({ ...f, user_type: v }))} />
          )}
          {tab !== "IR" && filterOpts.cohort.length > 0 && (
            <MultiSelect label="Cohort"
              opts={filterOpts.cohort} sel={filters.cohort}
              onChange={v => setFilters(f => ({ ...f, cohort: v }))} />
          )}
          {tab !== "IR" && filterOpts.payer_flag.length > 0 && (
            <MultiSelect label="Payer Flag"
              opts={filterOpts.payer_flag} sel={filters.payer_flag}
              onChange={v => setFilters(f => ({ ...f, payer_flag: v }))} />
          )}
          {filterOpts.install_source.length > 0 && (
            <MultiSelect label="Install Source"
              opts={filterOpts.install_source} sel={filters.install_source}
              onChange={v => setFilters(f => ({ ...f, install_source: v }))} />
          )}
          {filterOpts.install_bucket.length > 0 && (
            <MultiSelect label="Install Bucket"
              opts={filterOpts.install_bucket} sel={filters.install_bucket}
              onChange={v => setFilters(f => ({ ...f, install_bucket: v }))} />
          )}
          {filterOpts.install_type.length > 0 && (
            <MultiSelect label="Install Type"
              opts={filterOpts.install_type} sel={filters.install_type}
              onChange={v => setFilters(f => ({ ...f, install_type: v }))} />
          )}

          {/* Reset */}
          <button
            onClick={() => setFilters(EMPTY_FILTERS)}
            className="mt-1 w-full text-xs text-red-400 hover:text-red-600 text-left px-1"
          >
            ✕ Reset all filters
          </button>
        </div>
      </aside>

      {/* ══ MAIN AREA ════════════════════════════════════════════════════════ */}
      <div className="flex-1 flex flex-col overflow-hidden">

        {/* ── Top bar: tabs + controls ─────────────────────────────────────── */}
        <div className="bg-white border-b border-gray-200 shrink-0">

          {/* Tab row */}
          <div className="px-4 flex items-center gap-1">
            {TABS.map(t => (
              <button key={t} onClick={() => switchTab(t)}
                className={`px-4 py-2.5 text-sm font-medium border-b-2 transition ${
                  tab === t
                    ? "border-blue-600 text-blue-600"
                    : "border-transparent text-gray-500 hover:text-gray-700"
                }`}>
                {t}
              </button>
            ))}
          </div>

          {/* Controls row */}
          <div className="px-4 pb-2 flex flex-wrap items-center gap-4">

            {/* Group by */}
            <div className="flex items-center gap-1.5">
              <span className="text-xs text-gray-400 font-semibold uppercase">Group</span>
              {(["variant", "sub_variant", "both"] as GroupBy[]).map(g => (
                <button key={g} onClick={() => setGroupBy(g)}
                  className={`px-2.5 py-0.5 rounded text-xs font-medium border transition ${
                    groupBy === g
                      ? "bg-blue-600 text-white border-blue-600"
                      : "bg-white text-gray-600 border-gray-300 hover:border-blue-400"
                  }`}>
                  {g === "both" ? "Var × Sub" : g === "variant" ? "Variant" : "Sub-variant"}
                </button>
              ))}
            </div>

            {/* Control */}
            <div className="flex items-center gap-1.5">
              <span className="text-xs text-gray-400 font-semibold uppercase">Control</span>
              <select
                className="border border-gray-200 rounded px-2 py-0.5 text-xs bg-white"
                value={controlVar} onChange={e => setControl(e.target.value)}>
                {filterOpts.variant.map(v => <option key={v}>{v}</option>)}
              </select>
            </div>

            {/* Date range */}
            <div className="flex items-center gap-1.5 ml-auto">
              <span className="text-xs text-gray-400 font-semibold uppercase">Date</span>
              <input type="date"
                value={dateRange[0]}
                min={allDates[0]} max={allDates[allDates.length - 1]}
                onChange={e => setDateRange([e.target.value, dateRange[1]])}
                className="border border-gray-200 rounded px-2 py-0.5 text-xs" />
              <span className="text-gray-400 text-xs">→</span>
              <input type="date"
                value={dateRange[1]}
                min={allDates[0]} max={allDates[allDates.length - 1]}
                onChange={e => setDateRange([dateRange[0], e.target.value])}
                className="border border-gray-200 rounded px-2 py-0.5 text-xs" />
            </div>
          </div>
        </div>

        {/* ── Chart area ───────────────────────────────────────────────────── */}
        <div className="flex-1 overflow-y-auto bg-gray-100">

          {/* Debug info panel */}
          {debugInfo && (
            <div className="mx-3 mt-3 bg-yellow-50 border border-yellow-200 rounded-lg text-xs overflow-hidden">
              <button
                onClick={() => setShowDebug(d => !d)}
                className="w-full px-3 py-2 flex items-center justify-between text-yellow-800 font-semibold hover:bg-yellow-100 transition"
              >
                <span>
                  📋 Sheets parsed: {Object.entries(debugInfo.counts).map(([k,v]) => `${k}=${v}`).join(" · ")}
                </span>
                <span>{showDebug ? "▲ Hide" : "▼ Show columns"}</span>
              </button>
              {showDebug && (
                <div className="px-3 pb-3 space-y-2">
                  {Object.entries(debugInfo.colsByTab).map(([t, cols]) => (
                    <div key={t}>
                      <p className="text-yellow-800 font-semibold mb-1">{t} columns ({cols.length}):</p>
                      <div className="flex flex-wrap gap-1">
                        {cols.map(c => (
                          <span key={c} className="bg-yellow-100 border border-yellow-300 rounded px-1.5 py-0.5 text-yellow-900 font-mono">
                            {c}
                          </span>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Chart card */}
          <div className="bg-white m-3 rounded-lg shadow-sm border border-gray-200 overflow-hidden">
            {/* Chart header */}
            <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
              <div>
                <h2 className="font-semibold text-gray-800">
                  {activeMdef?.label ?? "Select a metric"}
                </h2>
                <p className="text-xs text-gray-400 mt-0.5">
                  {filteredRows.length.toLocaleString()} / {srcRows.length.toLocaleString()} rows
                  &nbsp;·&nbsp; {groups.filter(g => !pabGroupSet.has(g)).length} groups
                  &nbsp;·&nbsp; {chartPoints.length} dates
                  {hasPAB && hasExp && (
                    <span className="ml-2 text-gray-500">
                      &nbsp;— solid = Exp &nbsp; dashed = PAB
                    </span>
                  )}
                </p>
              </div>
              {/* Legend chips */}
              <div className="flex flex-wrap gap-1.5 justify-end">
                {groups.filter(g => !pabGroupSet.has(g)).map((g, i) => (
                  <span key={g}
                    className="text-xs px-2 py-0.5 rounded-full font-medium text-white"
                    style={{ backgroundColor: COLORS[i % COLORS.length] }}>
                    {g}
                  </span>
                ))}
              </div>
            </div>

            {/* Chart body */}
            <div className="p-4" style={{ height: 340 }}>
              {activeMdef ? (
                <TrendChart
                  points={chartPoints as { date: string; [k: string]: number | string }[]}
                  groups={groups}
                  pabGroups={pabGroupSet}
                  metric={activeMdef}
                  fullHeight
                />
              ) : (
                <div className="h-full flex items-center justify-center text-gray-300">
                  Select a metric from the sidebar →
                </div>
              )}
            </div>
          </div>

          {/* ── Delta & Confidence tables ─────────────────────────────────── */}
          <div className={`mx-3 mb-3 grid gap-3 ${hasPAB ? "grid-cols-2" : "grid-cols-1"}`}>

            {/* Experiment table */}
            <div className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
              <div className="px-4 py-2.5 bg-blue-50 border-b border-blue-100">
                <p className="text-xs font-semibold text-blue-700 uppercase tracking-wide">
                  Experiment — Delta &amp; Confidence
                </p>
                <p className="text-xs text-blue-400">Aggregated over date range</p>
              </div>
              <div className="p-3">
                {activeMdef && hasExp ? (
                  <SummaryTable
                    groupSums={expGroupSums}
                    metric={activeMdef}
                    controlKey={expCtrlKey}
                  />
                ) : (
                  <p className="text-xs text-gray-400 py-4 text-center">No experiment data</p>
                )}
              </div>
            </div>

            {/* PAB table — only when PAB rows exist */}
            {hasPAB && (
              <div className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
                <div className="px-4 py-2.5 bg-amber-50 border-b border-amber-100">
                  <p className="text-xs font-semibold text-amber-700 uppercase tracking-wide">
                    PAB — Delta &amp; Confidence
                  </p>
                  <p className="text-xs text-amber-400">Post-acquisition behaviour</p>
                </div>
                <div className="p-3">
                  {activeMdef ? (
                    <SummaryTable
                      groupSums={pabGroupSums}
                      metric={activeMdef}
                      controlKey={pabCtrlKey}
                    />
                  ) : (
                    <p className="text-xs text-gray-400 py-4 text-center">No PAB data</p>
                  )}
                </div>
              </div>
            )}
          </div>

        </div>
      </div>
    </div>
  );
}
