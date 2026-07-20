// Web Worker — runs off the main thread
importScripts('https://cdn.sheetjs.com/xlsx-0.20.3/package/dist/xlsx.full.min.js');

// ── Conversion helpers ────────────────────────────────────────────────────────

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
    } catch (_) {}
  }
  return s;
}

// ── Row parser — keeps every column, coerces types ────────────────────────────

function sheetToRows(wb, name) {
  const sheet = wb.Sheets[name];
  if (!sheet) return [];
  return XLSX.utils.sheet_to_json(sheet, { defval: 0, raw: true });
}

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

// ── Sheet classification — inferred from COLUMN SIGNATURES ────────────────────

/**
 * Returns { dateCol, tab, isIR } or null if the sheet looks irrelevant.
 * We never rely on the sheet NAME — only the actual column headers.
 */
function classifyByColumns(rows) {
  if (!rows.length) return null;
  const cols = new Set(Object.keys(rows[0]));

  // IR sheet
  if (cols.has("install_date") && (cols.has("installs") || cols.has("d01_users"))) {
    return { dateCol: "install_date", tab: "IR", isIR: true };
  }

  // Metrics sheets all need dau_date + dau
  if (!cols.has("dau_date") && !cols.has("dau")) return null;
  const dateCol = "dau_date";

  // RR
  if (cols.has("d1_rolling_users") || cols.has("d3_rolling_users") ||
      cols.has("d1_rr_flag") || cols.has("d3_rr_flag")) {
    return { dateCol, tab: "RR", isIR: false };
  }
  // Sessions
  if (cols.has("session_length") || cols.has("session_count") ||
      cols.has("perc_25") || cols.has("median")) {
    return { dateCol, tab: "Sessions", isIR: false };
  }
  // Revenue
  if (cols.has("total_rev") || cols.has("bn_rev") || cols.has("ad_rev") ||
      cols.has("iap_rev") || cols.has("bn_imp")) {
    return { dateCol, tab: "Revenue", isIR: false };
  }
  // Engagement — any column ending _actions
  const hasActions = [...cols].some(c => c.endsWith("_actions"));
  if (hasActions) {
    return { dateCol, tab: "Engagement", isIR: false };
  }

  // Fallback: generic metrics sheet — we'll assign ALL tabs so it shows everywhere
  return { dateCol, tab: "ALL", isIR: false };
}

/** Is this sheet name a PAB sheet? */
function isPABName(name) {
  return /pab/i.test(name);
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

// ── Worker ────────────────────────────────────────────────────────────────────

self.onmessage = function (e) {
  const buffer = e.data;
  try {
    self.postMessage({ type: "progress", message: "Parsing Excel…" });

    const wb = XLSX.read(buffer, { type: "array", cellDates: true });
    const names = wb.SheetNames;
    self.postMessage({ type: "progress", message: `Sheets found: ${names.join(", ")}` });

    let ir = [];
    let metrics = [];
    let engagementCols = [];
    const detectedColsByTab = {};
    const rowCounts = {};
    const sheetLog = [];

    // ── Process every sheet ───────────────────────────────────────────────────
    for (const name of names) {
      const rawRows = sheetToRows(wb, name);
      if (!rawRows.length) {
        sheetLog.push(`"${name}": empty`);
        continue;
      }

      const cls = classifyByColumns(rawRows);
      if (!cls) {
        sheetLog.push(`"${name}": unrecognised (cols: ${Object.keys(rawRows[0]).slice(0,6).join(",")}…)`);
        continue;
      }

      const type = isPABName(name) ? "PAB" : "experiment";

      if (cls.isIR) {
        // IR sheet — only take first one found
        if (ir.length === 0) {
          ir = rawRows.map(r => {
            const out = normaliseRow(r, "install_date");
            if (!out.install_date) out.install_date = "";
            for (const c of ["installs","d01_users","d03_users","d05_users","d07_users","d14_users","d21_users","d30_users"]) {
              out[c] = toNum(out[c] ?? 0);
            }
            return out;
          });
          rowCounts["IR"] = ir.length;
          sheetLog.push(`"${name}": IR (${ir.length} rows)`);
        }
      } else {
        // Metrics sheet
        const tab = cls.tab;
        const parsedRows = rawRows.map(r => {
          const out = normaliseRow(r, "dau_date");
          out._tab  = tab;
          out.type  = type;
          if (!out.dau_date) out.dau_date = "";
          out.dau   = toNum(out.dau ?? 0);
          return out;
        });

        // Record detected columns per tab (from experiment sheet if available)
        if (!detectedColsByTab[tab] || type === "experiment") {
          detectedColsByTab[tab] = Object.keys(parsedRows[0] || {});
        }

        // Engagement cols from any engagement sheet
        if (tab === "Engagement" && engagementCols.length === 0) {
          engagementCols = detectEngagementCols(rawRows);
        }

        // If tab === "ALL" (unknown), tag for every metric tab so it's visible everywhere
        if (tab === "ALL") {
          for (const t of ["RR","Sessions","Revenue","Engagement"]) {
            metrics.push(...parsedRows.map(r => ({ ...r, _tab: t })));
          }
        } else {
          metrics.push(...parsedRows);
        }

        const key = type === "PAB" ? `${tab} PAB` : tab;
        rowCounts[key] = (rowCounts[key] ?? 0) + parsedRows.length;
        sheetLog.push(`"${name}": ${tab} / ${type} (${parsedRows.length} rows)`);
      }
    }

    self.postMessage({ type: "progress", message: `Sheet map: ${sheetLog.join(" | ")}` });

    // ── Filter options ─────────────────────────────────────────────────────────
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
        filterOptions,
        detectedColsByTab,
        rowCounts,
        hasPerTabSheets: true,   // always use _tab filtering now
        sheetLog,
      },
    });

  } catch (err) {
    self.postMessage({ type: "error", message: err.message + "\n" + (err.stack || "") });
  }
};
