import { LOUPE_SCHEMA_VERSION, type ProjectScopeCandidate } from "./wire.js";
import { has_no_known_camel_case_fields, is_record } from "./wire-guards.js";
import { type Locator } from "./locator.js";

export const LOUPE_ANOMALIES_PATH = "~/.loupe/anomalies" as const;

export type AnomalySource = "hard_error" | "invariant" | "manual";

const anomaly_sources: ReadonlySet<string> = new Set(["hard_error", "invariant", "manual"]);

export type AnomalyBreadcrumb = {
  at: string;
  kind: string;
  detail?: string;
};

export type AnomalyError = {
  name?: string;
  message: string;
  stack?: string;
};

export type AnomalyEnv = {
  url?: string;
  user_agent?: string;
  viewport?: { width: number; height: number; dpr: number };
};

/**
 * What the extension POSTs to `/v1/anomalies`. `id` and `created_at` are assigned
 * by the daemon; large blobs (`dom_html`, `storage`) are split into sibling files
 * on disk and replaced by `has_dom` / `has_storage` flags in the stored report.
 */
export type AnomalyReportInput = {
  schema_version: typeof LOUPE_SCHEMA_VERSION;
  source: AnomalySource;
  summary: string;
  expected?: string;
  actual?: string;
  error?: AnomalyError;
  breadcrumbs: AnomalyBreadcrumb[];
  locator?: Locator;
  resolve_result?: unknown;
  project?: ProjectScopeCandidate;
  env: AnomalyEnv;
  dom_html?: string;
  storage?: unknown;
};

/** Stored `report.json`: input minus blobs, plus daemon-assigned fields. */
export type AnomalyReport = Omit<AnomalyReportInput, "dom_html" | "storage"> & {
  id: string;
  created_at: string;
  has_dom: boolean;
  has_storage: boolean;
};

/** Low-noise `list_anomalies` row. */
export type AnomalySummary = {
  id: string;
  created_at: string;
  source: AnomalySource;
  summary: string;
  project_id?: string;
  has_dom: boolean;
  locator_status?: string;
};

export function is_anomaly_report_input(value: unknown): value is AnomalyReportInput {
  if (!is_record(value) || !has_no_known_camel_case_fields(value)) return false;
  if (value.schema_version !== LOUPE_SCHEMA_VERSION) return false;
  if (typeof value.source !== "string" || !anomaly_sources.has(value.source)) return false;
  if (typeof value.summary !== "string" || value.summary.length === 0) return false;
  if (!is_breadcrumbs(value.breadcrumbs)) return false;
  if (!is_record(value.env)) return false;
  if (value.error !== undefined && !is_anomaly_error(value.error)) return false;
  if (value.dom_html !== undefined && typeof value.dom_html !== "string") return false;
  return true;
}

export function assert_anomaly_report_input(value: unknown): asserts value is AnomalyReportInput {
  if (!is_anomaly_report_input(value)) throw new TypeError("Expected AnomalyReportInput wire contract.");
}

function is_breadcrumbs(value: unknown): value is AnomalyBreadcrumb[] {
  return Array.isArray(value) && value.every((item) => is_record(item) && typeof item.at === "string" && typeof item.kind === "string" && (item.detail === undefined || typeof item.detail === "string"));
}

function is_anomaly_error(value: unknown): value is AnomalyError {
  if (!is_record(value)) return false;
  if (typeof value.message !== "string") return false;
  if (value.name !== undefined && typeof value.name !== "string") return false;
  if (value.stack !== undefined && typeof value.stack !== "string") return false;
  return true;
}

export function locator_status_of(resolve_result: unknown): string | undefined {
  if (is_record(resolve_result) && typeof resolve_result.locator_status === "string") return resolve_result.locator_status;
  return undefined;
}

export function summarize_anomaly(report: AnomalyReport): AnomalySummary {
  const summary: AnomalySummary = {
    id: report.id,
    created_at: report.created_at,
    source: report.source,
    summary: report.summary,
    has_dom: report.has_dom,
  };
  if (report.project?.project_id !== undefined) summary.project_id = report.project.project_id;
  const status = locator_status_of(report.resolve_result);
  if (status !== undefined) summary.locator_status = status;
  return summary;
}
