import type { MetricDef, TabType } from "./types";

const pct  = (key: string, label: string, num: string, den: string, group: string, tab: TabType): MetricDef =>
  ({ key, label, numerator: num, denominator: den, metricType: "proportion", format: "percent", group, tab });

const num  = (key: string, label: string, num: string, den: string, group: string, tab: TabType): MetricDef =>
  ({ key, label, numerator: num, denominator: den, metricType: "mean", format: "number", group, tab });

const curr = (key: string, label: string, num: string, den: string, group: string, tab: TabType): MetricDef =>
  ({ key, label, numerator: num, denominator: den, metricType: "mean", format: "currency", group, tab });

export const STATIC_METRICS: MetricDef[] = [
  // ── IR ──────────────────────────────────────────────────────────
  pct("d01_ret", "D01 Retention", "d01_users", "installs", "Retention", "IR"),
  pct("d03_ret", "D03 Retention", "d03_users", "installs", "Retention", "IR"),
  pct("d05_ret", "D05 Retention", "d05_users", "installs", "Retention", "IR"),
  pct("d07_ret", "D07 Retention", "d07_users", "installs", "Retention", "IR"),
  pct("d14_ret", "D14 Retention", "d14_users", "installs", "Retention", "IR"),
  pct("d21_ret", "D21 Retention", "d21_users", "installs", "Retention", "IR"),
  pct("d30_ret", "D30 Retention", "d30_users", "installs", "Retention", "IR"),

  // ── Rolling Retention ────────────────────────────────────────────
  pct("d1_rr",  "D1 Rolling Retention", "d1_rolling_users", "dau", "Rolling Retention", "RR"),
  pct("d3_rr",  "D3 Rolling Retention", "d3_rolling_users", "dau", "Rolling Retention", "RR"),

  // ── Sessions ─────────────────────────────────────────────────────
  num("sess_len",   "Avg Session Length (s)", "session_length", "dau", "Sessions",  "Sessions"),
  num("sess_count", "Sessions per DAU",       "session_count",  "dau", "Sessions",  "Sessions"),
  num("sess_p25",   "P25 Session (s)",        "perc_25",        "dau", "Sessions",  "Sessions"),
  num("sess_med",   "Median Session (s)",     "median",         "dau", "Sessions",  "Sessions"),
  num("sess_p75",   "P75 Session (s)",        "perc_75",        "dau", "Sessions",  "Sessions"),

  // ── Revenue ──────────────────────────────────────────────────────
  curr("total_rpd",      "Total RPD",       "total_rev",      "dau", "Revenue",     "Revenue"),
  curr("ad_rpd",         "Ad RPD",          "ad_rev",         "dau", "Revenue",     "Revenue"),
  curr("bn_rpd",         "BN RPD",          "bn_rev",         "dau", "Ad Revenue",  "Revenue"),
  curr("it_rpd",         "IT RPD",          "it_rev",         "dau", "Ad Revenue",  "Revenue"),
  curr("w2e_rpd",        "W2E RPD",         "w2e_rev",        "dau", "Ad Revenue",  "Revenue"),
  curr("iap_rpd",        "IAP RPD",         "iap_rev",        "dau", "IAP",         "Revenue"),
  curr("app_open_rpd",   "App Open RPD",    "app_open_rev",   "dau", "Ad Revenue",  "Revenue"),
  curr("mid_it_rpd",     "Mid IT RPD",      "mid_it_rev",     "dau", "Ad Revenue",  "Revenue"),
  curr("aoi_rpd",        "AOI RPD",         "aoi_rev",        "dau", "Ad Revenue",  "Revenue"),
  curr("btob_w2e_rpd",   "BTOB W2E RPD",    "btob_w2e_rev",   "dau", "BTOB",        "Revenue"),
  curr("btob_inter_rpd", "BTOB Inter RPD",  "btob_inter_rev", "dau", "BTOB",        "Revenue"),
  curr("bright_rpd",     "Bright RPD",      "bright_rev",     "dau", "Ad Revenue",  "Revenue"),

  num("bn_ipd",         "BN IPD",          "bn_imp",         "dau", "Impressions", "Revenue"),
  num("it_ipd",         "IT IPD",          "it_imp",         "dau", "Impressions", "Revenue"),
  num("w2e_ipd",        "W2E IPD",         "w2e_imp",        "dau", "Impressions", "Revenue"),
  num("app_open_ipd",   "App Open IPD",    "app_open_imp",   "dau", "Impressions", "Revenue"),
  num("mid_it_ipd",     "Mid IT IPD",      "mid_it_imp",     "dau", "Impressions", "Revenue"),
  num("aoi_ipd",        "AOI IPD",         "aoi_imp",        "dau", "Impressions", "Revenue"),
  num("btob_w2e_ipd",   "BTOB W2E IPD",    "btob_w2e_imp",   "dau", "BTOB",        "Revenue"),
  num("btob_inter_ipd", "BTOB Inter IPD",  "btob_inter_imp", "dau", "BTOB",        "Revenue"),
  num("bright_ipd",     "Bright IPD",      "bright_imp",     "dau", "Impressions", "Revenue"),

  pct("iap_upd",        "IAP UPD",         "iap_users",      "dau", "User Penetration", "Revenue"),
  pct("bn_upd",         "BN UPD",          "bn_users",       "dau", "User Penetration", "Revenue"),
  pct("it_upd",         "IT UPD",          "it_users",       "dau", "User Penetration", "Revenue"),
  pct("w2e_upd",        "W2E UPD",         "w2e_users",      "dau", "User Penetration", "Revenue"),
  pct("app_open_upd",   "App Open UPD",    "app_open_users", "dau", "User Penetration", "Revenue"),
  pct("mid_it_upd",     "Mid IT UPD",      "mid_it_users",   "dau", "User Penetration", "Revenue"),
  pct("aoi_upd",        "AOI UPD",         "aoi_users",      "dau", "User Penetration", "Revenue"),
  pct("btob_w2e_upd",   "BTOB W2E UPD",    "btob_w2e_users", "dau", "BTOB",             "Revenue"),
  pct("btob_inter_upd", "BTOB Inter UPD",  "btob_inter_users","dau","BTOB",             "Revenue"),
  pct("bright_upd",     "Bright UPD",      "bright_users",   "dau", "User Penetration", "Revenue"),
];

/** Build engagement metric defs dynamically from detected columns */
export function buildEngagementMetrics(engagementCols: string[]): MetricDef[] {
  const actionCols = engagementCols.filter(c => c.endsWith("_actions"));
  return actionCols.flatMap(col => {
    const base = col.replace("_actions", "");
    const label = base.replace(/_/g, " ").replace(/\b\w/g, l => l.toUpperCase());
    const userCol = `${base}_users`;
    return [
      num(`${base}_apd`, `${label} APD`, col,     "dau", base.split("_")[0], "Engagement"),
      pct(`${base}_upd`, `${label} UPD`, userCol, "dau", base.split("_")[0], "Engagement"),
    ];
  });
}

/**
 * Filter static + engagement metrics to only those whose numerator AND denominator
 * columns actually exist in the parsed data.  This prevents metrics from silently
 * showing 0 when column names in the Excel differ from the expected names.
 */
export function filterToAvailableMetrics(
  allMetrics: MetricDef[],
  detectedCols: string[],
): MetricDef[] {
  const colSet = new Set(detectedCols);
  // Always allow IR metrics (they run against the IR sheet, not metrics sheet)
  return allMetrics.filter(
    m => m.tab === "IR" || (colSet.has(m.numerator) && colSet.has(m.denominator)),
  );
}
