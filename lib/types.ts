export type DataType = "experiment" | "PAB";
export type GroupBy = "variant" | "sub_variant" | "both";
export type TabType = "IR" | "RR" | "Sessions" | "Revenue" | "Engagement";

export interface IRRow {
  install_date: string;
  gid: number;
  cli: number;
  variant: string;
  sub_variant: string;
  geo: string;
  install_bucket: string;
  install_source: string;
  install_type: string;
  build: number;
  installs: number;
  d01_users: number;
  d03_users: number;
  d05_users: number;
  d07_users: number;
  d14_users: number;
  d21_users: number;
  d30_users: number;
  [key: string]: number | string;
}

export interface MetricsRow {
  type: DataType;
  dau_date: string;
  gid: number;
  cli: number;
  variant: string;
  sub_variant: string;
  user_type: string;
  geo: string;
  cohort: string;
  payer_flag: string;
  install_bucket: string;
  install_source: string;
  install_type: string;
  dau: number;
  d1_rolling_users: number;
  d3_rolling_users: number;
  session_length: number;
  session_count: number;
  perc_25: number;
  median: number;
  perc_75: number;
  total_rev: number;
  ad_rev: number;
  bn_rev: number;
  it_rev: number;
  w2e_rev: number;
  iap_rev: number;
  app_open_rev: number;
  mid_it_rev: number;
  aoi_rev: number;
  btob_w2e_rev: number;
  btob_inter_rev: number;
  bright_rev: number;
  bn_imp: number;
  it_imp: number;
  w2e_imp: number;
  app_open_imp: number;
  mid_it_imp: number;
  aoi_imp: number;
  btob_w2e_imp: number;
  btob_inter_imp: number;
  bright_imp: number;
  iap_users: number;
  bn_users: number;
  it_users: number;
  w2e_users: number;
  app_open_users: number;
  mid_it_users: number;
  aoi_users: number;
  btob_w2e_users: number;
  btob_inter_users: number;
  bright_users: number;
  [key: string]: number | string;
}

export interface ParsedData {
  ir: IRRow[];
  metrics: MetricsRow[];          // all non-IR rows; each row has _tab + type fields
  engagementCols: string[];
  detectedColsByTab?: Record<string, string[]>;  // tab → column names actually found
  detectedCols?: string[];        // legacy / flat list
  rowCounts?: Record<string, number>;
  filterOptions?: Record<string, string[]>;
  hasPerTabSheets?: boolean;
  irDims?: string[];
  metricsDims?: string[];
}

export interface MetricDef {
  key: string;
  label: string;
  numerator: string;
  denominator: string;
  metricType: "proportion" | "mean";
  format: "percent" | "number" | "currency";
  group: string;
  tab: TabType;
}

export interface AggGroup {
  groupKey: string;
  label: string;
  variant: string;
  sub_variant: string;
  sums: Record<string, number>;
  isControl: boolean;
}

export interface MetricValue {
  def: MetricDef;
  value: number;
  delta: number | null;
  confidence: number | null;
  pValue: number | null;
  significant: boolean;
}

export interface GroupResult {
  group: AggGroup;
  values: MetricValue[];
}

export const IR_DIMS = ["geo", "install_bucket", "install_source", "install_type", "variant", "sub_variant"] as const;

export const METRICS_DIMS = [
  "type", "geo", "user_type", "cohort", "payer_flag",
  "install_bucket", "install_source", "install_type", "variant", "sub_variant",
] as const;
