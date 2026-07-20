"use client";

import { useState, useCallback, useMemo, useRef } from "react";
import { STATIC_METRICS, buildEngagementMetrics, filterToAvailableMetrics } from "@/lib/metrics";
import TrendChart from "@/components/TrendChart";
import SummaryTable from "@/components/SummaryTable";
import type { TabType, GroupBy, MetricDef } from "@/lib/types";

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
  const ok = (arr: string[], col: string) => arr.length === 0 || arr.includes(sv(row, col));
  if (tab !== "IR") {
    if (!ok(f.type,       "type"))       return false;
    if (!ok(f.user_type,  "user_type"))  return false;
    if (!ok(f.cohort,     "cohort"))     return false;
    if (!ok(f.payer_flag, "payer_flag")) return false;
  }
  if (!ok(f.geo,            "geo"))            return false;
  if (!ok(f.install_source, "install_source")) return false;
  if (!ok(f.install_bucket, "install_bucket")) return false;
  if (!ok(f.install_type,   "install_type"))   return false;
  return true;
}
function uniq(rows: Record<string, unknown>[], col: string): string[] {
  return [...new Set(rows.map(r => sv(r, col)))].filter(Boolean).sort();
}

// ── MultiSelect ────────────────────────────────────────────────────────────────

function MultiSelect({ label, opts, sel, onChange }: {
  label: string; opts: string[]; sel: string[]; onChange: (v: string[]) => void;
}) {
  if (!opts.length) return null;
  const allSel = sel.length === 0;
  return (
    <div className="mb-2">
      <div className="flex justify-between items-center mb-1">
        <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">{label}</span>
        <button className="text-xs text-blue-500 hover:underline" onClick={() => onChange([])}>All</button>
      </div>
      <div className="max-h-28 overflow-y-auto space-y-0.5">
        {opts.map(o => {
          const checked = allSel || sel.includes(o);
          return (
            <label key={o} className={`flex items-center gap-1.5 px-2 py-0.5 rounded cursor-pointer text-xs transition ${
              checked ? "bg-blue-50 text-blue-800" : "text-gray-500 hover:bg-gray-50"
            }`}>
              <input type="checkbox" className="accent-blue-600" checked={checked}
                onChange={() => {
                  if (allSel) onChange(opts.filter(x => x !== o));
                  else if (sel.includes(o)) { const n = sel.filter(x => x !== o); onChange(n.length ? n : []); }
                  else onChange([...sel, o]);
                }} />
              <span className="truncate">{o || "(blank)"}</span>
            </label>
          );
        })}
      </div>
    </div>
  );
}

// ── UploadZone ────────────────────────────────────────────────────────────────

function UploadZone({ label, sublabel, loaded, rows, loading, msg, color, onChange }: {
  label: string; sublabel: string; loaded: boolean; rows: number;
  loading: boolean; msg: string; color: "blue"|"green";
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
}) {
  const bg    = color === "blue"  ? "bg-blue-50 border-blue-300"   : "bg-green-50 border-green-300";
  const badge = color === "blue"  ? "bg-blue-600"                  : "bg-green-600";
  const text  = color === "blue"  ? "text-blue-700"                : "text-green-700";
  return (
    <label className={`flex flex-col items-center justify-center w-72 h-36 border-2 border-dashed rounded-xl cursor-pointer transition hover:opacity-80 ${bg}`}>
      <input type="file" accept=".xlsx,.xls" className="hidden" onChange={onChange} />
      {loading ? (
        <>
          <svg className="animate-spin h-6 w-6 text-gray-400 mb-2" viewBox="0 0 24 24" fill="none">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/>
          </svg>
          <p className="text-xs text-gray-500 text-center px-4">{msg}</p>
        </>
      ) : loaded ? (
        <>
          <span className={`${badge} text-white text-xs font-bold px-3 py-1 rounded-full mb-2`}>✓ Loaded</span>
          <p className={`font-semibold ${text} text-sm`}>{label}</p>
          <p className="text-xs text-gray-500">{rows.toLocaleString()} rows</p>
          <p className="text-xs text-gray-400 mt-1">Click to replace</p>
        </>
      ) : (
        <>
          <span className="text-2xl mb-2">📂</span>
          <p className={`font-semibold ${text} text-sm`}>{label}</p>
          <p className="text-xs text-gray-500 text-center px-4">{sublabel}</p>
        </>
      )}
    </label>
  );
}

// ── Main page ──────────────────────────────────────────────────────────────────

export default function Home() {
  // ── Data state ─────────────────────────────────────────────────────────────
  const [irRows,      setIrRows]      = useState<Record<string, unknown>[]>([]);
  const [metricRows,  setMetricRows]  = useState<Record<string, unknown>[]>([]);
  const [engCols,     setEngCols]     = useState<string[]>([]);
  const [detectedCols,setDetectedCols]= useState<string[]>([]);
  const [filterOpts,  setFilterOpts]  = useState<Record<string, string[]>>({});
  const [irLog,       setIrLog]       = useState("");
  const [metLog,      setMetLog]      = useState<string[]>([]);

  const [irLoading,   setIrLoading]   = useState(false);
  const [irMsg,       setIrMsg]       = useState("");
  const [metLoading,  setMetLoading]  = useState(false);
  const [metMsg,      setMetMsg]      = useState("");

  // ── UI state ───────────────────────────────────────────────────────────────
  const [tab,        setTab]       = useState<TabType>("IR");
  const [groupBy,    setGroupBy]   = useState<GroupBy>("variant");
  const [controlVar, setControl]   = useState("control");
  const [metricKey,  setMetricKey] = useState("");
  const [filters,    setFilters]   = useState<Filters>(EMPTY_FILTERS);
  const [dateRange,  setDateRange] = useState<[string, string]>(["", ""]);
  const [showDebug,  setShowDebug] = useState(false);

  // ── Panel sizes ────────────────────────────────────────────────────────────
  const [metricsW, setMetricsW] = useState(180);
  const [filtersW, setFiltersW] = useState(220);
  const [chartH,   setChartH]  = useState(340);
  const dragging = useRef<null | { which: "m"|"f"|"ch"; startX: number; startY: number; startVal: number }>(null);

  const onDragStart = useCallback((which: "m"|"f"|"ch", e: React.MouseEvent) => {
    e.preventDefault();
    dragging.current = { which, startX: e.clientX, startY: e.clientY,
      startVal: which === "m" ? metricsW : which === "f" ? filtersW : chartH };
    const move = (ev: MouseEvent) => {
      if (!dragging.current) return;
      const { which: w, startX, startY, startVal } = dragging.current;
      if (w === "m") setMetricsW(Math.max(120, Math.min(400, startVal + ev.clientX - startX)));
      else if (w === "f") setFiltersW(Math.max(140, Math.min(450, startVal + ev.clientX - startX)));
      else setChartH(Math.max(180, Math.min(700, startVal + ev.clientY - startY)));
    };
    const up = () => { dragging.current = null; window.removeEventListener("mousemove", move); window.removeEventListener("mouseup", up); };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
  }, [metricsW, filtersW, chartH]);

  // ── File upload helpers ────────────────────────────────────────────────────
  function runWorker(
    buffer: ArrayBuffer,
    mode: "ir" | "metrics",
    onProgress: (m: string) => void,
    onDone: (d: Record<string, unknown>) => void,
    onError: (m: string) => void,
  ) {
    const worker = new Worker(`/worker.js?v=${Date.now()}`);
    worker.onmessage = msg => {
      const { type, message, data } = msg.data;
      if (type === "progress") { onProgress(message); return; }
      if (type === "done")     { onDone(data); worker.terminate(); return; }
      if (type === "error")    { onError(message); worker.terminate(); }
    };
    worker.postMessage({ mode, buffer }, [buffer]);
  }

  const onIrFile = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]; if (!file) return;
    setIrLoading(true); setIrMsg("Reading…");
    const reader = new FileReader();
    reader.onload = ev => {
      const buffer = ev.target?.result as ArrayBuffer;
      runWorker(buffer, "ir",
        msg => setIrMsg(msg),
        data => {
          const d = data as { ir: Record<string,unknown>[]; rowCount: number; sheetUsed: string };
          setIrRows(d.ir);
          setIrLog(`"${d.sheetUsed}": ${d.rowCount} rows`);
          // init date range
          const dates = d.ir.map(r => String(r.install_date ?? "").slice(0,10)).filter(Boolean).sort();
          if (dates.length) setDateRange([dates[0], dates[dates.length-1]]);
          setIrLoading(false); setIrMsg("");
        },
        msg => { alert("IR parse error: " + msg); setIrLoading(false); setIrMsg(""); },
      );
    };
    reader.readAsArrayBuffer(file);
  }, []);

  const onMetricsFile = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]; if (!file) return;
    setMetLoading(true); setMetMsg("Reading…");
    const reader = new FileReader();
    reader.onload = ev => {
      const buffer = ev.target?.result as ArrayBuffer;
      runWorker(buffer, "metrics",
        msg => setMetMsg(msg),
        data => {
          const d = data as {
            metrics: Record<string,unknown>[];
            engagementCols: string[];
            detectedCols: string[];
            filterOptions: Record<string, string[]>;
            rowCount: number;
            log: string[];
          };
          setMetricRows(d.metrics);
          setEngCols(d.engagementCols);
          setDetectedCols(d.detectedCols);
          setFilterOpts(d.filterOptions);
          setMetLog(d.log);
          const variants = d.filterOptions?.variant ?? [];
          setControl(variants.find(v => v.toLowerCase().includes("control")) ?? variants[0] ?? "control");
          // init date range from metrics
          const dates = d.metrics.map(r => String(r.dau_date ?? "").slice(0,10)).filter(Boolean).sort();
          if (dates.length) setDateRange([dates[0], dates[dates.length-1]]);
          setFilters(EMPTY_FILTERS);
          setMetLoading(false); setMetMsg("");
        },
        msg => { alert("Metrics parse error: " + msg); setMetLoading(false); setMetMsg(""); },
      );
    };
    reader.readAsArrayBuffer(file);
  }, []);

  // ── Derived state ──────────────────────────────────────────────────────────
  const irLoaded  = irRows.length > 0;
  const metLoaded = metricRows.length > 0;

  // All metric defs filtered to columns present in the data
  const allMetrics = useMemo(() => {
    const eng = buildEngagementMetrics(engCols);
    const all = [...STATIC_METRICS, ...eng];
    return detectedCols.length
      ? filterToAvailableMetrics(all, { RR: detectedCols, Sessions: detectedCols, Revenue: detectedCols, Engagement: detectedCols })
      : all;
  }, [engCols, detectedCols]);

  const tabMetrics = useMemo(() => allMetrics.filter(m => m.tab === tab), [allMetrics, tab]);
  const activeMdef: MetricDef | undefined = tabMetrics.find(m => m.key === metricKey) ?? tabMetrics[0];

  const metricSections = useMemo(() => {
    const map = new Map<string, MetricDef[]>();
    for (const m of tabMetrics) {
      if (!map.has(m.group)) map.set(m.group, []);
      map.get(m.group)!.push(m);
    }
    return map;
  }, [tabMetrics]);

  // Source rows: IR rows or all metrics rows (no per-tab filtering — tab controls metric list only)
  const dateField = tab === "IR" ? "install_date" : "dau_date";
  const srcRows   = useMemo(
    () => tab === "IR" ? irRows : metricRows,
    [tab, irRows, metricRows],
  );

  // Live filter options from current source
  const liveFilterOpts = useMemo(() => ({
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

  const allDates = useMemo(
    () => uniq(srcRows, dateField).map(d => d.slice(0,10)).filter(Boolean).sort(),
    [srcRows, dateField],
  );

  const filteredRows = useMemo(() => {
    const [d0, d1] = dateRange;
    return srcRows.filter(r => {
      const d = sv(r, dateField).slice(0,10);
      if (d0 && d && d < d0) return false;
      if (d1 && d && d > d1) return false;
      return passes(r, filters, tab);
    });
  }, [srcRows, filters, dateRange, dateField, tab]);

  const expRows = useMemo(() => filteredRows.filter(r => sv(r,"type") !== "PAB"), [filteredRows]);
  const pabRows = useMemo(() => filteredRows.filter(r => sv(r,"type") === "PAB"),  [filteredRows]);
  const hasPAB  = pabRows.length > 0;
  const hasExp  = expRows.length > 0;

  // ── Aggregation ────────────────────────────────────────────────────────────
  type AggMap = Map<string, Map<string, { num: number; den: number }>>;

  function buildAgg(rows: Record<string, unknown>[], suffix: string) {
    if (!activeMdef) return { dates: [] as string[], groups: [] as string[], agg: new Map() as AggMap };
    const agg = new Map<string, Map<string, { num: number; den: number }>>();
    const gset = new Set<string>();
    for (const row of rows) {
      const date = sv(row, dateField).slice(0,10);
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

  const { chartPoints, groups, pabGroupSet } = useMemo(() => {
    if (!activeMdef) return { chartPoints: [], groups: [] as string[], pabGroupSet: new Set<string>() };
    const eA = buildAgg(expRows, "");
    const pA = buildAgg(pabRows, " (PAB)");
    const allD = [...new Set([...eA.dates, ...pA.dates])].sort();
    const allG = [...eA.groups, ...pA.groups];
    const pabSet = new Set(pA.groups);
    const pts = allD.map(date => {
      const pt: Record<string, number|string> = { date };
      for (const g of eA.groups) { const c = eA.agg.get(date)?.get(g); pt[g] = c && c.den>0 ? c.num/c.den : NaN; }
      for (const g of pA.groups) { const c = pA.agg.get(date)?.get(g); pt[g] = c && c.den>0 ? c.num/c.den : NaN; }
      return pt;
    });
    return { chartPoints: pts, groups: allG, pabGroupSet: pabSet };
  }, [expRows, pabRows, activeMdef, groupBy, dateField, controlVar]);

  const expGroupSums = useMemo(() => buildSums(expRows, ""),        [expRows, groupBy]);
  const pabGroupSums = useMemo(() => buildSums(pabRows, " (PAB)"), [pabRows, groupBy]);
  const expCtrlKey   = useMemo(() => Object.keys(expGroupSums).find(k => k.startsWith(controlVar)) ?? Object.keys(expGroupSums)[0] ?? "", [expGroupSums, controlVar]);
  const pabCtrlKey   = useMemo(() => Object.keys(pabGroupSums).find(k => k.startsWith(controlVar)) ?? Object.keys(pabGroupSums)[0] ?? "", [pabGroupSums, controlVar]);

  function switchTab(t: TabType) {
    setTab(t); setMetricKey(""); setFilters(EMPTY_FILTERS);
    const src   = t === "IR" ? irRows : metricRows;
    const field = t === "IR" ? "install_date" : "dau_date";
    const dates = src.map(r => String(r[field] ?? "").slice(0,10)).filter(Boolean).sort();
    if (dates.length) setDateRange([dates[0], dates[dates.length-1]]);
  }

  // ── Upload screen ──────────────────────────────────────────────────────────
  if (!irLoaded && !metLoaded) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-8 bg-gray-50">
        <div className="text-center">
          <h1 className="text-3xl font-bold text-gray-800 mb-2">Experiment Dashboard</h1>
          <p className="text-gray-500 text-sm">Upload your two Excel files to get started</p>
        </div>
        <div className="flex gap-6">
          <UploadZone label="IR File" sublabel="Install retention data" color="blue"
            loaded={irLoaded} rows={irRows.length} loading={irLoading} msg={irMsg} onChange={onIrFile} />
          <UploadZone label="DAU Metrics File" sublabel="All DAU metrics (RR, Sessions, Revenue, Engagement)" color="green"
            loaded={metLoaded} rows={metricRows.length} loading={metLoading} msg={metMsg} onChange={onMetricsFile} />
        </div>
        <p className="text-xs text-gray-400">You can upload both files or just one to start exploring</p>
      </div>
    );
  }

  // ── Dashboard ──────────────────────────────────────────────────────────────
  return (
    <div className="flex h-screen bg-gray-100 overflow-hidden text-sm select-none">

      {/* ══ Column 1: Metrics ══════════════════════════════════════════════════ */}
      <div className="shrink-0 flex flex-col bg-white border-r border-gray-200 overflow-hidden" style={{ width: metricsW }}>
        <div className="px-3 py-2.5 border-b border-gray-100 bg-gray-50 shrink-0 flex items-center justify-between">
          <span className="text-xs font-bold text-gray-600 uppercase tracking-wide">Metrics</span>
        </div>
        <div className="flex-1 overflow-y-auto p-2">
          {[...metricSections.entries()].map(([section, mlist]) => (
            <div key={section} className="mb-3">
              <p className="text-xs text-gray-400 px-1 mb-0.5 font-medium">{section}</p>
              {mlist.map(m => (
                <button key={m.key} onClick={() => setMetricKey(m.key)}
                  className={`w-full text-left px-2 py-1 rounded text-xs transition ${
                    activeMdef?.key === m.key ? "bg-blue-600 text-white font-medium" : "text-gray-700 hover:bg-gray-100"
                  }`}>{m.label}</button>
              ))}
            </div>
          ))}
        </div>
      </div>

      {/* Drag handle */}
      <div className="w-1 shrink-0 bg-gray-200 hover:bg-blue-400 cursor-col-resize transition-colors"
        onMouseDown={e => onDragStart("m", e)} />

      {/* ══ Column 2: Filters ══════════════════════════════════════════════════ */}
      <div className="shrink-0 flex flex-col bg-white border-r border-gray-200 overflow-hidden" style={{ width: filtersW }}>
        <div className="px-3 py-2.5 border-b border-gray-100 bg-gray-50 shrink-0 flex items-center justify-between">
          <span className="text-xs font-bold text-gray-600 uppercase tracking-wide">Filters</span>
          <button onClick={() => setFilters(EMPTY_FILTERS)} className="text-xs text-red-400 hover:text-red-600">Reset</button>
        </div>
        <div className="flex-1 overflow-y-auto p-2 space-y-1">
          {tab !== "IR" && <MultiSelect label="Data Type" opts={liveFilterOpts.type} sel={filters.type} onChange={v => setFilters(f => ({...f,type:v}))} />}
          <MultiSelect label="Geo" opts={liveFilterOpts.geo} sel={filters.geo} onChange={v => setFilters(f => ({...f,geo:v}))} />
          {tab !== "IR" && <MultiSelect label="User Type" opts={liveFilterOpts.user_type} sel={filters.user_type} onChange={v => setFilters(f => ({...f,user_type:v}))} />}
          {tab !== "IR" && <MultiSelect label="Cohort" opts={liveFilterOpts.cohort} sel={filters.cohort} onChange={v => setFilters(f => ({...f,cohort:v}))} />}
          {tab !== "IR" && <MultiSelect label="Payer Flag" opts={liveFilterOpts.payer_flag} sel={filters.payer_flag} onChange={v => setFilters(f => ({...f,payer_flag:v}))} />}
          <MultiSelect label="Install Source" opts={liveFilterOpts.install_source} sel={filters.install_source} onChange={v => setFilters(f => ({...f,install_source:v}))} />
          <MultiSelect label="Install Bucket" opts={liveFilterOpts.install_bucket} sel={filters.install_bucket} onChange={v => setFilters(f => ({...f,install_bucket:v}))} />
          <MultiSelect label="Install Type" opts={liveFilterOpts.install_type} sel={filters.install_type} onChange={v => setFilters(f => ({...f,install_type:v}))} />
        </div>
      </div>

      {/* Drag handle */}
      <div className="w-1 shrink-0 bg-gray-200 hover:bg-blue-400 cursor-col-resize transition-colors"
        onMouseDown={e => onDragStart("f", e)} />

      {/* ══ Column 3: Main ═════════════════════════════════════════════════════ */}
      <div className="flex-1 flex flex-col overflow-hidden min-w-0">

        {/* Top bar */}
        <div className="bg-white border-b border-gray-200 shrink-0">

          {/* Tabs */}
          <div className="px-4 flex items-center gap-0.5 overflow-x-auto">
            {TABS.map(t => (
              <button key={t} onClick={() => switchTab(t)}
                className={`px-4 py-2.5 text-sm font-medium border-b-2 whitespace-nowrap transition ${
                  tab === t ? "border-blue-600 text-blue-600" : "border-transparent text-gray-500 hover:text-gray-700"
                }`}>{t}</button>
            ))}
            {/* File re-upload buttons in top bar */}
            <div className="ml-auto flex items-center gap-2 pr-2">
              <label className={`text-xs px-2 py-1 rounded border cursor-pointer transition ${irLoaded ? "border-blue-300 text-blue-600 hover:bg-blue-50" : "border-gray-300 text-gray-400"}`}>
                {irLoaded ? "✓ IR" : "Upload IR"}
                <input type="file" accept=".xlsx,.xls" className="hidden" onChange={onIrFile} />
              </label>
              <label className={`text-xs px-2 py-1 rounded border cursor-pointer transition ${metLoaded ? "border-green-300 text-green-600 hover:bg-green-50" : "border-gray-300 text-gray-400"}`}>
                {metLoaded ? "✓ Metrics" : "Upload Metrics"}
                <input type="file" accept=".xlsx,.xls" className="hidden" onChange={onMetricsFile} />
              </label>
              {(irLoading || metLoading) && (
                <svg className="animate-spin h-4 w-4 text-gray-400" viewBox="0 0 24 24" fill="none">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/>
                </svg>
              )}
            </div>
          </div>

          {/* Controls */}
          <div className="px-4 pb-2 flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-1.5">
              <span className="text-xs text-gray-400 font-semibold uppercase">Group</span>
              {(["variant","sub_variant","both"] as GroupBy[]).map(g => (
                <button key={g} onClick={() => setGroupBy(g)}
                  className={`px-2.5 py-0.5 rounded text-xs font-medium border transition ${
                    groupBy === g ? "bg-blue-600 text-white border-blue-600" : "bg-white text-gray-600 border-gray-300 hover:border-blue-400"
                  }`}>
                  {g === "both" ? "Var × Sub" : g === "variant" ? "Variant" : "Sub-variant"}
                </button>
              ))}
            </div>
            <div className="flex items-center gap-1.5">
              <span className="text-xs text-gray-400 font-semibold uppercase">Control</span>
              <select className="border border-gray-200 rounded px-2 py-0.5 text-xs bg-white"
                value={controlVar} onChange={e => setControl(e.target.value)}>
                {liveFilterOpts.variant.map(v => <option key={v}>{v}</option>)}
              </select>
            </div>
            <div className="flex items-center gap-1.5 ml-auto">
              <span className="text-xs text-gray-400 font-semibold uppercase">Date</span>
              <input type="date" value={dateRange[0]} min={allDates[0]} max={allDates[allDates.length-1]}
                onChange={e => setDateRange([e.target.value, dateRange[1]])}
                className="border border-gray-200 rounded px-2 py-0.5 text-xs" />
              <span className="text-gray-400 text-xs">→</span>
              <input type="date" value={dateRange[1]} min={allDates[0]} max={allDates[allDates.length-1]}
                onChange={e => setDateRange([dateRange[0], e.target.value])}
                className="border border-gray-200 rounded px-2 py-0.5 text-xs" />
            </div>
          </div>
        </div>

        {/* Scrollable content */}
        <div className="flex-1 overflow-y-auto bg-gray-100">

          {/* Debug panel */}
          {(irLog || metLog.length > 0) && (
            <div className="mx-3 mt-3 bg-yellow-50 border border-yellow-200 rounded-lg text-xs overflow-hidden">
              <button onClick={() => setShowDebug(d => !d)}
                className="w-full px-3 py-2 flex items-center justify-between text-yellow-800 font-semibold hover:bg-yellow-100 transition">
                <span>📋 IR: {irRows.length.toLocaleString()} rows · Metrics: {metricRows.length.toLocaleString()} rows · {detectedCols.length} columns</span>
                <span>{showDebug ? "▲ Hide" : "▼ Details"}</span>
              </button>
              {showDebug && (
                <div className="px-3 pb-3 space-y-2">
                  {irLog && <p className="font-mono text-yellow-900">IR: {irLog}</p>}
                  {metLog.map((l,i) => <p key={i} className="font-mono text-yellow-900">Metrics: {l}</p>)}
                  <div>
                    <p className="text-yellow-800 font-semibold mb-1">Detected columns ({detectedCols.length}):</p>
                    <div className="flex flex-wrap gap-1">
                      {detectedCols.map(c => (
                        <span key={c} className="bg-yellow-100 border border-yellow-300 rounded px-1.5 py-0.5 text-yellow-900 font-mono">{c}</span>
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Chart */}
          <div className="bg-white mx-3 mt-3 rounded-lg shadow-sm border border-gray-200 overflow-hidden">
            <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
              <div>
                <h2 className="font-semibold text-gray-800">{activeMdef?.label ?? "Select a metric"}</h2>
                <p className="text-xs text-gray-400 mt-0.5">
                  {filteredRows.length.toLocaleString()} / {srcRows.length.toLocaleString()} rows
                  &nbsp;·&nbsp; {groups.filter(g => !pabGroupSet.has(g)).length} groups
                  &nbsp;·&nbsp; {chartPoints.length} dates
                  {hasPAB && hasExp && <span className="ml-2">— solid=Exp, dashed=PAB</span>}
                </p>
              </div>
              <div className="flex flex-wrap gap-1.5 justify-end max-w-xs">
                {groups.filter(g => !pabGroupSet.has(g)).map((g, i) => (
                  <span key={g} className="text-xs px-2 py-0.5 rounded-full font-medium text-white"
                    style={{ backgroundColor: COLORS[i % COLORS.length] }}>{g}</span>
                ))}
              </div>
            </div>
            <div className="px-4 pt-4 pb-0" style={{ height: chartH }}>
              {activeMdef ? (
                <TrendChart points={chartPoints as {date:string;[k:string]:number|string}[]}
                  groups={groups} pabGroups={pabGroupSet} metric={activeMdef} fullHeight />
              ) : (
                <div className="h-full flex items-center justify-center text-gray-300">
                  {srcRows.length === 0
                    ? "Upload your files using the buttons above →"
                    : "Select a metric from the left panel →"}
                </div>
              )}
            </div>
            <div className="h-2 flex items-center justify-center cursor-row-resize hover:bg-blue-50 transition-colors group"
              onMouseDown={e => onDragStart("ch", e)} title="Drag to resize chart">
              <div className="w-10 h-0.5 rounded bg-gray-300 group-hover:bg-blue-400 transition-colors" />
            </div>
          </div>

          {/* Tables */}
          <div className={`mx-3 my-3 grid gap-3 ${hasPAB ? "grid-cols-2" : "grid-cols-1"}`}>
            <div className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
              <div className="px-4 py-2.5 bg-blue-50 border-b border-blue-100">
                <p className="text-xs font-semibold text-blue-700 uppercase tracking-wide">Experiment — Delta &amp; Confidence</p>
                <p className="text-xs text-blue-400">Aggregated over selected date range</p>
              </div>
              <div className="p-3 overflow-x-auto">
                {activeMdef && hasExp
                  ? <SummaryTable groupSums={expGroupSums} metric={activeMdef} controlKey={expCtrlKey} />
                  : <p className="text-xs text-gray-400 py-4 text-center">No experiment data</p>}
              </div>
            </div>
            {hasPAB && (
              <div className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
                <div className="px-4 py-2.5 bg-amber-50 border-b border-amber-100">
                  <p className="text-xs font-semibold text-amber-700 uppercase tracking-wide">PAB — Delta &amp; Confidence</p>
                  <p className="text-xs text-amber-400">Post-acquisition behaviour</p>
                </div>
                <div className="p-3 overflow-x-auto">
                  {activeMdef
                    ? <SummaryTable groupSums={pabGroupSums} metric={activeMdef} controlKey={pabCtrlKey} />
                    : <p className="text-xs text-gray-400 py-4 text-center">No PAB data</p>}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
