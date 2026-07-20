import * as XLSX from "xlsx";
import type { ParsedData, IRRow, MetricsRow } from "./types";

function toNum(v: unknown): number {
  const n = Number(v);
  return isNaN(n) ? 0 : n;
}
function toStr(v: unknown): string {
  return v == null ? "" : String(v);
}

function sheetToRows(wb: XLSX.WorkBook, name: string): Record<string, unknown>[] {
  const sheet = wb.Sheets[name];
  if (!sheet) return [];
  return XLSX.utils.sheet_to_json(sheet, { defval: 0 });
}

function parseIR(rows: Record<string, unknown>[]): IRRow[] {
  return rows.map(r => ({
    install_date:   toStr(r.install_date),
    gid:            toNum(r.gid),
    cli:            toNum(r.cli),
    variant:        toStr(r.variant),
    sub_variant:    toStr(r.sub_variant),
    geo:            toStr(r.geo),
    install_bucket: toStr(r.install_bucket),
    install_source: toStr(r.install_source),
    install_type:   toStr(r.install_type),
    build:          toNum(r.build),
    installs:       toNum(r.installs),
    d01_users:      toNum(r.d01_users),
    d03_users:      toNum(r.d03_users),
    d05_users:      toNum(r.d05_users),
    d07_users:      toNum(r.d07_users),
    d14_users:      toNum(r.d14_users),
    d21_users:      toNum(r.d21_users),
    d30_users:      toNum(r.d30_users),
  }));
}

function parseMetricsRows(
  rows: Record<string, unknown>[],
  type: "experiment" | "PAB",
  engagementCols: string[],
): MetricsRow[] {
  return rows.map(r => {
    const row: MetricsRow = {
      type,
      dau_date:         toStr(r.dau_date),
      gid:              toNum(r.gid),
      cli:              toNum(r.cli),
      variant:          toStr(r.variant),
      sub_variant:      toStr(r.sub_variant),
      user_type:        toStr(r.user_type),
      geo:              toStr(r.geo),
      cohort:           toStr(r.cohort),
      payer_flag:       toStr(r.payer_flag),
      install_bucket:   toStr(r.install_bucket),
      install_source:   toStr(r.install_source),
      install_type:     toStr(r.install_type),
      dau:              toNum(r.dau),
      d1_rolling_users: toNum(r.d1_rolling_users),
      d3_rolling_users: toNum(r.d3_rolling_users),
      session_length:   toNum(r.session_length),
      session_count:    toNum(r.session_count),
      perc_25:          toNum(r.perc_25),
      median:           toNum(r.median),
      perc_75:          toNum(r.perc_75),
      total_rev:        toNum(r.total_rev),
      ad_rev:           toNum(r.ad_rev),
      bn_rev:           toNum(r.bn_rev),
      it_rev:           toNum(r.it_rev),
      w2e_rev:          toNum(r.w2e_rev),
      iap_rev:          toNum(r.iap_rev),
      app_open_rev:     toNum(r.app_open_rev),
      mid_it_rev:       toNum(r.mid_it_rev),
      aoi_rev:          toNum(r.aoi_rev),
      btob_w2e_rev:     toNum(r.btob_w2e_rev),
      btob_inter_rev:   toNum(r.btob_inter_rev),
      bright_rev:       toNum(r.bright_rev),
      bn_imp:           toNum(r.bn_imp),
      it_imp:           toNum(r.it_imp),
      w2e_imp:          toNum(r.w2e_imp),
      app_open_imp:     toNum(r.app_open_imp),
      mid_it_imp:       toNum(r.mid_it_imp),
      aoi_imp:          toNum(r.aoi_imp),
      btob_w2e_imp:     toNum(r.btob_w2e_imp),
      btob_inter_imp:   toNum(r.btob_inter_imp),
      bright_imp:       toNum(r.bright_imp),
      iap_users:        toNum(r.iap_users),
      bn_users:         toNum(r.bn_users),
      it_users:         toNum(r.it_users),
      w2e_users:        toNum(r.w2e_users),
      app_open_users:   toNum(r.app_open_users),
      mid_it_users:     toNum(r.mid_it_users),
      aoi_users:        toNum(r.aoi_users),
      btob_w2e_users:   toNum(r.btob_w2e_users),
      btob_inter_users: toNum(r.btob_inter_users),
      bright_users:     toNum(r.bright_users),
    };
    for (const col of engagementCols) {
      row[col] = toNum(r[col]);
    }
    return row;
  });
}

// Known non-engagement user/impression columns to exclude from dynamic detection
const KNOWN_USER_COLS = new Set([
  "iap_users","bn_users","it_users","w2e_users","app_open_users",
  "mid_it_users","aoi_users","btob_w2e_users","btob_inter_users","bright_users",
]);

function detectEngagementCols(rows: Record<string, unknown>[]): string[] {
  if (rows.length === 0) return [];
  return Object.keys(rows[0]).filter(k =>
    (k.endsWith("_actions") || (k.endsWith("_users") && !KNOWN_USER_COLS.has(k)))
  );
}

export function parseExcel(buffer: ArrayBuffer): ParsedData {
  const wb = XLSX.read(buffer, { type: "array" });

  // Log available sheet names so user can verify
  console.log("Sheets found:", wb.SheetNames);

  // ── IR ──────────────────────────────────────────────────────────
  // Accept "IR" or "Install Retention" tab name
  const irName  = wb.SheetNames.find(n => n === "IR" || n.toLowerCase().includes("install")) ?? wb.SheetNames[0];
  const ir      = parseIR(sheetToRows(wb, irName));

  // ── DAU (experiment) ────────────────────────────────────────────
  // Accept "DAU", "RR", "Sessions", "Revenue", "Engagement" — but since
  // they are now ONE combined sheet called "DAU", try that first.
  // If the file still has separate tabs (DAU + PAB), combine them.
  const dauName = wb.SheetNames.find(n => n === "DAU") ?? "";
  const pabName = wb.SheetNames.find(n => n === "PAB") ?? "";

  const dauRaw = sheetToRows(wb, dauName);
  const pabRaw = sheetToRows(wb, pabName);

  // Detect engagement cols from whichever sheet has data
  const sampleRows = dauRaw.length > 0 ? dauRaw : pabRaw;
  const engagementCols = detectEngagementCols(sampleRows);

  const dauRows = parseMetricsRows(dauRaw, "experiment", engagementCols);
  const pabRows = parseMetricsRows(pabRaw, "PAB",        engagementCols);

  // If the file already has a combined "Metrics" sheet with a `type` column, use that instead
  const metricsName = wb.SheetNames.find(n => n === "Metrics");
  let metrics: MetricsRow[];
  if (metricsName) {
    const raw = sheetToRows(wb, metricsName);
    const eng = detectEngagementCols(raw);
    metrics = raw.map(r => ({
      ...parseMetricsRows([r], toStr(r.type) === "PAB" ? "PAB" : "experiment", eng)[0],
    }));
  } else {
    // Combine DAU + PAB, add type column
    metrics = [...dauRows, ...pabRows];
  }

  const irDims      = ["geo", "install_bucket", "install_source", "install_type", "variant", "sub_variant"];
  const metricsDims = ["type","geo","user_type","cohort","payer_flag","install_bucket","install_source","install_type","variant","sub_variant"];

  return { ir, metrics, engagementCols, irDims, metricsDims };
}

export function uniqueVals<T extends Record<string, unknown>>(rows: T[], col: string): string[] {
  return [...new Set(rows.map(r => String(r[col] ?? "")))].filter(Boolean).sort();
}
