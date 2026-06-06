// Assembles an AnomalyReportInput from captured pieces. Kept as the single seam
// that stamps schema_version and applies exactOptionalPropertyTypes-safe defaults.

import { LOUPE_SCHEMA_VERSION, type AnomalyBreadcrumb, type AnomalyEnv, type AnomalyError, type AnomalyReportInput, type AnomalySource, type Locator, type ProjectScopeCandidate } from "@loupe-server/shared";

export type AnomalyDraft = {
  source: AnomalySource;
  summary: string;
  expected?: string;
  actual?: string;
  error?: AnomalyError;
  breadcrumbs?: AnomalyBreadcrumb[];
  locator?: Locator;
  resolve_result?: unknown;
  project?: ProjectScopeCandidate;
  env: AnomalyEnv;
  dom_html?: string;
  storage?: unknown;
};

export function buildAnomalyReport(draft: AnomalyDraft): AnomalyReportInput {
  const report: AnomalyReportInput = {
    schema_version: LOUPE_SCHEMA_VERSION,
    source: draft.source,
    summary: draft.summary,
    breadcrumbs: draft.breadcrumbs ?? [],
    env: draft.env,
  };
  if (draft.expected !== undefined) report.expected = draft.expected;
  if (draft.actual !== undefined) report.actual = draft.actual;
  if (draft.error !== undefined) report.error = draft.error;
  if (draft.locator !== undefined) report.locator = draft.locator;
  if (draft.resolve_result !== undefined) report.resolve_result = draft.resolve_result;
  if (draft.project !== undefined) report.project = draft.project;
  if (draft.dom_html !== undefined) report.dom_html = draft.dom_html;
  if (draft.storage !== undefined) report.storage = draft.storage;
  return report;
}

type WindowLike = {
  readonly location?: { readonly href?: string };
  readonly navigator?: { readonly userAgent?: string };
  readonly innerWidth?: number;
  readonly innerHeight?: number;
  readonly devicePixelRatio?: number;
};

export function captureEnv(win: WindowLike): AnomalyEnv {
  const env: AnomalyEnv = {};
  if (typeof win.location?.href === "string") env.url = win.location.href;
  if (typeof win.navigator?.userAgent === "string") env.user_agent = win.navigator.userAgent;
  if (typeof win.innerWidth === "number" && typeof win.innerHeight === "number") {
    env.viewport = { width: win.innerWidth, height: win.innerHeight, dpr: typeof win.devicePixelRatio === "number" ? win.devicePixelRatio : 1 };
  }
  return env;
}
