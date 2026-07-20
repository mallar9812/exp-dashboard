// Web Worker — runs off the main thread so the UI never freezes
importScripts('https://cdn.sheetjs.com/xlsx-0.20.3/package/dist/xlsx.full.min.js');

// ── Helpers ─────────────────────────────────────────────────────────────────

function toNum(v) {
  if (v == null || v === "") return 0;
  const n = Number(v);
  return isNaN(n) ? 0 : n;
}

function toStr(v) { return v == null ? "" : String(v).trim(); }

/** Normalise any date representation → "YYYY-MM-DD" */
function toDate(v) {
  if (!v && v !== 0) return "";
  if (v instanceof Date) {
    if (isNaN(v.getTime())) return "";
    const y = v.getFullYear();
    const m = String(v.getMonth() + 1).padStart(2, "0");
    const d = String(v.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }
  const s = String(v).trim();
  // Already YYYY-MM-DD or YYYY-MM-DDThh…
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  // MM/DD/YYYY
  const us = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (us) return `${us[3]}-${us[1].padStart(2,"0")}-${us[2].padStart(2,"0")}`;
  // numeric serial — XLSX can return these
  if (/^\d+(\.\d+)?$/.test(s)) {
    try {
      const info = XLSX.SSF.parse_date_code(Number(s));
      if (info) return `${info.y}-${String(info.m).padStart(2,"0")}-${String(info.d).padStart(2,"0")}`;
    } catch(_) {}
  }
  return s;
}

/**
 * Parse a sheet into plain JS objects.
 * raw:true → numbers stay as numbers (avoids "1,234" / "45.20%" formatting issues).
 * cellDates on XLSX.read already makes date cells JS Date objects.
 */
function sheetToRows(wb, name) {
  const sheet = wb.Sheets[name];
  if (!sheet) return [];
  return XLSX.utils.sheet_to_json(sheet, { defval: 0, raw: true });
}

/** Keep every column from the raw row; only coerce types */
function normaliseRow(r, dateCol) {
  const out = {};
  for (const [k, v] of Object.entries(r)) {
    if (k === dateCol) {
      out[k] = toDate(v);          // normalise date → "YYYY-MM-DD"
    } else if (typeof v === "number") {
      out[k] = v;                  // already a number (raw:true)
    } else if (v instanceof Date) {
      out[k] = toDate(v);          // date cell in non-date column
    } else {
      // String cell – try numeric coercion but keep as string if it fails
      const s = String(v).trim();
      const n = Number(s.replace(/,/g, ""));   // strip thousand-separators
      out[k] = (s !== "" && !isNaN(n)) ? n : s;
    }
  }
  return out;
}

function parseIR(rows) {
  return rows.map(r => {
    const out = normaliseRow(r, "install_date");
    if (!out.install_date) out.install_date = "";
    // Guarantee installs / retention columns are numeric
    for (const c of ["installs","d01_users","d03_users","d05_users","d07_users","d14_users","d21_users","d30_users"]) {
      if (out[c] == null) out[c] = 0;
      else out[c] = toNum(out[c]);
    }
    return out;
  });
}

function parseMetricsRows(rows, type) {
  return rows.map(r => {
    const out = normaliseRow(r, "dau_date");
    out.type = type;                                       // overwrite/set type
    if (!out.dau_date) out.dau_date = "";
    // Guarantee dau is numeric
    if (out.dau == null) out.dau = 0;
    else out.dau = toNum(out.dau);
    return out;
  });
}

const KNOWN_AD_USER_COLS = new Set([
  "iap_users","bn_users","it_users","w2e_users","app_open_users",
  "mid_it_users","aoi_users","btob_w2e_users","btob_inter_users","bright_users",
]);

function detectEngagementCols(rows) {
  if (!rows.length) return [];
  return Object.keys(rows[0]).filter(k =>
    k.endsWith("_actions") || (k.endsWith("_users") && !KNOWN_AD_USER_COLS.has(k))
  );
}

function uniqueVals(rows, col) {
  return [...new Set(rows.map(r => toStr(r[col])))].filter(Boolean).sort();
}

// ── Worker entry point ───────────────────────────────────────────────────────

self.onmessage = function (e) {
  const buffer = e.data;
  try {
    self.postMessage({ type: "progress", message: "Parsing Excel…" });

    // cellDates:true → date cells come as JS Date objects
    const wb = XLSX.read(buffer, { type: "array", cellDates: true });
    self.postMessage({ type: "progress", message: `Sheets: ${wb.SheetNames.join(", ")}` });

    // ── IR sheet ──────────────────────────────────────────────────────────────
    const irName = wb.SheetNames.find(n =>
      n === "IR" || n.toLowerCase() === "install retention" || n.toLowerCase().includes("install")
    ) ?? wb.SheetNames[0];
    const ir = parseIR(sheetToRows(wb, irName));
    self.postMessage({ type: "progress", message: `IR: ${ir.length} rows` });

    // ── Metrics sheets (DAU + PAB or combined Metrics) ────────────────────────
    const dauName     = wb.SheetNames.find(n => n === "DAU"  || n.toLowerCase() === "dau")  ?? "";
    const pabName     = wb.SheetNames.find(n => n === "PAB"  || n.toLowerCase() === "pab")  ?? "";
    const metricsName = wb.SheetNames.find(n => n === "Metrics" || n.toLowerCase() === "metrics");

    let metrics = [];
    let engagementCols = [];

    if (metricsName) {
      const raw = sheetToRows(wb, metricsName);
      engagementCols = detectEngagementCols(raw);
      metrics = raw.map(r =>
        parseMetricsRows([r], toStr(r.type) === "PAB" ? "PAB" : "experiment")[0]
      );
    } else {
      const dauRaw = sheetToRows(wb, dauName);
      const pabRaw = sheetToRows(wb, pabName);
      const sample = dauRaw.length ? dauRaw : pabRaw;
      engagementCols = detectEngagementCols(sample);
      const dauRows = parseMetricsRows(dauRaw, "experiment");
      const pabRows = parseMetricsRows(pabRaw, "PAB");
      metrics = [...dauRows, ...pabRows];
      self.postMessage({ type: "progress", message: `DAU: ${dauRows.length} rows, PAB: ${pabRows.length} rows` });
    }

    // ── Filter options ────────────────────────────────────────────────────────
    const filterOptions = {
      type:           uniqueVals(metrics, "type"),
      geo:            uniqueVals(metrics, "geo"),
      user_type:      uniqueVals(metrics, "user_type"),
      cohort:         uniqueVals(metrics, "cohort"),
      payer_flag:     uniqueVals(metrics, "payer_flag"),
      install_source: uniqueVals(metrics, "install_source"),
      install_bucket: uniqueVals(metrics, "install_bucket"),
      install_type:   uniqueVals(metrics, "install_type"),
      variant:        uniqueVals(metrics, "variant"),
    };

    // Expose detected column names for debugging
    const detectedCols = metrics.length ? Object.keys(metrics[0]) : [];

    self.postMessage({
      type: "done",
      data: {
        ir, metrics, engagementCols, filterOptions,
        detectedCols,
        rowCounts: { ir: ir.length, metrics: metrics.length },
        irDims:      ["geo","install_bucket","install_source","install_type","variant","sub_variant"],
        metricsDims: ["type","geo","user_type","cohort","payer_flag","install_bucket","install_source","install_type","variant","sub_variant"],
      },
    });
  } catch (err) {
    self.postMessage({ type: "error", message: err.message + "\n" + err.stack });
  }
};
