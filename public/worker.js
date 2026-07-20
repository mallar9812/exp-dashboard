// Web Worker
importScripts('https://cdn.sheetjs.com/xlsx-0.20.3/package/dist/xlsx.full.min.js');

function toNum(v) {
  if (v == null || v === "") return 0;
  const n = Number(v); return isNaN(n) ? 0 : n;
}
function toStr(v) { return v == null ? "" : String(v).trim(); }

function toDate(v) {
  if (!v && v !== 0) return "";
  if (v instanceof Date) {
    if (isNaN(v.getTime())) return "";
    return `${v.getFullYear()}-${String(v.getMonth()+1).padStart(2,"0")}-${String(v.getDate()).padStart(2,"0")}`;
  }
  const s = String(v).trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0,10);
  const us = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (us) return `${us[3]}-${us[1].padStart(2,"0")}-${us[2].padStart(2,"0")}`;
  try {
    if (/^\d+$/.test(s)) {
      const info = XLSX.SSF.parse_date_code(Number(s));
      if (info) return `${info.y}-${String(info.m).padStart(2,"0")}-${String(info.d).padStart(2,"0")}`;
    }
  } catch(_) {}
  return s;
}

function sheetToRows(wb, name) {
  const sheet = wb.Sheets[name];
  if (!sheet) return [];
  return XLSX.utils.sheet_to_json(sheet, { defval: 0, raw: true });
}

function normaliseRow(r, dateCol) {
  const out = {};
  for (const [k, v] of Object.entries(r)) {
    if (k === dateCol) { out[k] = toDate(v); }
    else if (typeof v === "number") { out[k] = v; }
    else if (v instanceof Date) { out[k] = toDate(v); }
    else {
      const s = String(v).trim();
      const n = Number(s.replace(/,/g, ""));
      out[k] = (s !== "" && !isNaN(n)) ? n : s;
    }
  }
  return out;
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

// ─────────────────────────────────────────────────────────────────────────────

self.onmessage = function(e) {
  const { mode, buffer } = e.data;

  try {
    self.postMessage({ type: "progress", message: `Parsing ${mode} file…` });
    const wb = XLSX.read(buffer, { type: "array", cellDates: true });
    const names = wb.SheetNames;
    self.postMessage({ type: "progress", message: `Sheets: ${names.join(", ")}` });

    // ── IR mode ───────────────────────────────────────────────────────────────
    if (mode === "ir") {
      // Take first sheet (or one named IR)
      const irName = names.find(n => /ir|install/i.test(n)) ?? names[0];
      const raw = sheetToRows(wb, irName);
      const ir = raw.map(r => {
        const out = normaliseRow(r, "install_date");
        if (!out.install_date) out.install_date = "";
        for (const c of ["installs","d01_users","d03_users","d05_users","d07_users","d14_users","d21_users","d30_users"]) {
          out[c] = toNum(out[c] ?? 0);
        }
        return out;
      });
      self.postMessage({ type: "done", data: { mode: "ir", ir, rowCount: ir.length, sheetUsed: irName } });
      return;
    }

    // ── Metrics mode ──────────────────────────────────────────────────────────
    if (mode === "metrics") {
      let metrics = [];
      const log = [];

      for (const name of names) {
        const raw = sheetToRows(wb, name);
        if (!raw.length) { log.push(`"${name}": empty`); continue; }

        // Determine type from sheet name; or from existing "type" column
        const isPAB = /pab/i.test(name);

        const rows = raw.map(r => {
          const out = normaliseRow(r, "dau_date");
          // Honour existing type column if present, otherwise infer from sheet name
          if (!out.type || (toStr(out.type) !== "PAB" && toStr(out.type) !== "experiment")) {
            out.type = isPAB ? "PAB" : "experiment";
          }
          if (!out.dau_date) out.dau_date = "";
          out.dau = toNum(out.dau ?? 0);
          return out;
        });

        metrics.push(...rows);
        log.push(`"${name}": ${rows.length} rows (${isPAB ? "PAB" : "experiment"})`);
      }

      const engagementCols = detectEngagementCols(
        metrics.filter(r => toStr(r.type) === "experiment")
      );
      const detectedCols = metrics.length ? Object.keys(metrics[0]) : [];

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
          mode: "metrics",
          metrics,
          engagementCols,
          detectedCols,
          filterOptions,
          rowCount: metrics.length,
          log,
        },
      });
    }
  } catch(err) {
    self.postMessage({ type: "error", message: err.message + "\n" + (err.stack || "") });
  }
};
