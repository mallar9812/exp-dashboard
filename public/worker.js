// Web Worker — runs off the main thread so the UI never freezes
importScripts('https://cdn.sheetjs.com/xlsx-0.20.3/package/dist/xlsx.full.min.js');

// ── Type helpers ─────────────────────────────────────────────────────────────

function toNum(v) {
  if (v == null || v === "") return 0;
  const n = Number(v);
  return isNaN(n) ? 0 : n;
}
function toStr(v) { return v == null ? "" : String(v).trim(); }

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
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const us = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (us) return `${us[3]}-${us[1].padStart(2,"0")}-${us[2].padStart(2,"0")}`;
  if (/^\d+(\.\d+)?$/.test(s)) {
    try {
      const info = XLSX.SSF.parse_date_code(Number(s));
      if (info) return `${info.y}-${String(info.m).padStart(2,"0")}-${String(info.d).padStart(2,"0")}`;
    } catch(_) {}
  }
  return s;
}

// ── Sheet reader ─────────────────────────────────────────────────────────────

function sheetToRows(wb, name) {
  if (!name) return [];
  const sheet = wb.Sheets[name];
  if (!sheet) return [];
  return XLSX.utils.sheet_to_json(sheet, { defval: 0, raw: true });
}

// ── Row normaliser — passes ALL columns through, converts types ───────────────

function normaliseRow(r, dateCol) {
  const out = {};
  for (const [k, v] of Object.entries(r)) {
    if (k === dateCol) {
      out[k] = toDate(v);
    } else if (typeof v === "number") {
      out[k] = v;
    } else if (v instanceof Date) {
      out[k] = toDate(v);
    } else {
      const s = String(v).trim();
      const n = Number(s.replace(/,/g, ""));
      out[k] = (s !== "" && !isNaN(n)) ? n : s;
    }
  }
  return out;
}

// ── IR parser ─────────────────────────────────────────────────────────────────

function parseIR(rows) {
  return rows.map(r => {
    const out = normaliseRow(r, "install_date");
    if (!out.install_date) out.install_date = "";
    for (const c of ["installs","d01_users","d03_users","d05_users","d07_users","d14_users","d21_users","d30_users"]) {
      out[c] = toNum(out[c] ?? 0);
    }
    return out;
  });
}

// ── Metrics parser — tags rows with _tab and type ────────────────────────────

function parseMetrics(rows, tab, type) {
  return rows.map(r => {
    const out = normaliseRow(r, "dau_date");
    out._tab = tab;
    out.type = type;
    if (!out.dau_date) out.dau_date = "";
    if (out.dau == null) out.dau = 0; else out.dau = toNum(out.dau);
    return out;
  });
}

// ── Sheet name matching ───────────────────────────────────────────────────────

/**
 * Find a sheet whose name matches any of the given patterns.
 * Patterns are tested against the lowercased, trimmed sheet name.
 */
function findSheet(names, ...patterns) {
  return names.find(n => {
    const l = n.toLowerCase().trim();
    return patterns.some(p => (typeof p === "string" ? l === p : p.test(l)));
  }) ?? null;
}

// ── Helper: detect engagement columns ────────────────────────────────────────

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

// ── Worker entry point ────────────────────────────────────────────────────────

self.onmessage = function(e) {
  const buffer = e.data;
  try {
    self.postMessage({ type: "progress", message: "Parsing Excel…" });

    const wb = XLSX.read(buffer, { type: "array", cellDates: true });
    const names = wb.SheetNames;
    self.postMessage({ type: "progress", message: `Sheets: ${names.join(", ")}` });

    // ── IR ────────────────────────────────────────────────────────────────────
    const irName = findSheet(names,
      "ir", /install\s*retention/, /install/
    ) ?? names[0];
    const ir = parseIR(sheetToRows(wb, irName));
    self.postMessage({ type: "progress", message: `IR: ${ir.length} rows (sheet: "${irName}")` });

    // ── Metric sheet definitions ──────────────────────────────────────────────
    // Each entry: { tab, expSheet, pabSheet }
    // We support two layouts:
    //   A) Separate sheets per tab: "RR", "RR PAB", "Sessions", "Sessions PAB", ...
    //   B) Single combined sheets:  "DAU" (experiment) + "PAB" (all pab)

    const METRIC_DEFS = [
      {
        tab: "RR",
        expSheet:  findSheet(names, "rr", /^rolling\s*ret/),
        pabSheet:  findSheet(names, "rr pab", /^rr\s+pab/, /^rolling.*pab/),
      },
      {
        tab: "Sessions",
        expSheet:  findSheet(names, "sessions", "session"),
        pabSheet:  findSheet(names, "sessions pab", "session pab", /session.*pab/),
      },
      {
        tab: "Revenue",
        expSheet:  findSheet(names, "revenue", "rev"),
        pabSheet:  findSheet(names, "revenue pab", "rev pab", /revenue.*pab/),
      },
      {
        tab: "Engagement",
        expSheet:  findSheet(names, "engagement", "engage"),
        pabSheet:  findSheet(names, "engagement pab", "engage pab", /engagement.*pab/),
      },
    ];

    // Fallback: if none of the per-tab sheets were found, try legacy "DAU" / "PAB"
    const hasPerTabSheets = METRIC_DEFS.some(d => d.expSheet !== null);
    const legacyDauSheet = !hasPerTabSheets ? findSheet(names, "dau", "metrics") : null;
    const legacyPabSheet = !hasPerTabSheets ? findSheet(names, "pab") : null;

    let metrics = [];
    let engagementCols = [];
    const detectedColsByTab = {};
    const rowCounts = { ir: ir.length };

    if (hasPerTabSheets) {
      // ── Layout A: separate sheets per tab ────────────────────────────────
      for (const { tab, expSheet, pabSheet } of METRIC_DEFS) {
        const expRaw = expSheet ? sheetToRows(wb, expSheet) : [];
        const pabRaw = pabSheet ? sheetToRows(wb, pabSheet) : [];

        const expRows = parseMetrics(expRaw, tab, "experiment");
        const pabRows = parseMetrics(pabRaw, tab, "PAB");

        // Detected columns for this tab (from exp sheet, fall back to pab sheet)
        const sampleRaw = expRaw.length ? expRaw : pabRaw;
        detectedColsByTab[tab] = sampleRaw.length ? Object.keys(normaliseRow(sampleRaw[0], "dau_date")) : [];

        if (tab === "Engagement") {
          engagementCols = detectEngagementCols(sampleRaw);
        }

        metrics.push(...expRows, ...pabRows);
        rowCounts[tab] = expRows.length;
        rowCounts[`${tab} PAB`] = pabRows.length;

        self.postMessage({
          type: "progress",
          message: `${tab}: ${expRows.length} exp + ${pabRows.length} PAB rows`,
        });
      }
    } else {
      // ── Layout B: legacy single DAU / PAB sheets ──────────────────────────
      const dauRaw = legacyDauSheet ? sheetToRows(wb, legacyDauSheet) : [];
      const pabRaw = legacyPabSheet ? sheetToRows(wb, legacyPabSheet) : [];
      const sampleRaw = dauRaw.length ? dauRaw : pabRaw;
      engagementCols = detectEngagementCols(sampleRaw);
      const allCols = sampleRaw.length ? Object.keys(normaliseRow(sampleRaw[0], "dau_date")) : [];
      for (const tab of ["RR","Sessions","Revenue","Engagement"]) detectedColsByTab[tab] = allCols;

      const dauRows = parseMetrics(dauRaw, "ALL", "experiment");
      const pabRows = parseMetrics(pabRaw, "ALL", "PAB");
      // Reassign _tab based on presence of distinguishing columns for legacy layout
      // (no per-tab detection possible, show all metrics under every tab)
      metrics = [...dauRows, ...pabRows];
      rowCounts["DAU"] = dauRows.length;
      rowCounts["PAB"] = pabRows.length;
      self.postMessage({ type: "progress", message: `Legacy DAU: ${dauRows.length}, PAB: ${pabRows.length}` });
    }

    // ── Filter options (from all metric rows combined) ─────────────────────
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

    self.postMessage({
      type: "done",
      data: {
        ir, metrics, engagementCols,
        filterOptions, detectedColsByTab, rowCounts,
        hasPerTabSheets,
      },
    });
  } catch (err) {
    self.postMessage({ type: "error", message: err.message + "\n" + err.stack });
  }
};
