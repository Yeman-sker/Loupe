// DEV-BUILD ONLY. Excluded from the production tsconfig (tsconfig.build.json)
// and never loaded by the production manifest, so end users who install Loupe
// never get the anomaly tooling. This consumes the runtime's read-only
// instrumentation seam to flag Loupe's own misbehavior during real testing.
//
// The POST goes straight from the content (isolated) world to the loopback
// daemon: content-script fetch bypasses page CSP, and credentials come from the
// pairing key in extension storage — so this needs no service-worker changes.

import type { Instrumentation, InstrumentationApi } from "../runtime/app.js";
import { capture_locator, resolve } from "../schema.js";
import { buildContext } from "../runtime/pin-model.js";
import { project_scope_from_url, session_marks_key } from "../storage/lib-storage.js";
import { BreadcrumbBuffer } from "../anomaly/breadcrumbs.js";
import { buildAnomalyReport, captureEnv, type AnomalyDraft } from "../anomaly/report.js";
import { serializeAnomalySnapshot } from "../anomaly/snapshot.js";
import { installAnomalyHotkey } from "../anomaly/hotkey.js";

export const DAEMON_CREDENTIALS_KEY = "loupe:v1:daemon";

export type DaemonCredentials = { base_url: string; token: string };
export type StorageGet = (key: string) => Promise<Record<string, unknown>>;
export type FetchImpl = (input: string, init?: RequestInit) => Promise<Response>;
export type CaptureResult = { ok: boolean; id?: string; error?: string };

export type AnomalyCaptureDeps = {
  storageGet?: StorageGet;
  fetchImpl?: FetchImpl;
  now?: () => string;
  onResult?: (result: CaptureResult) => void;
};

export async function readDaemonCredentials(get: StorageGet): Promise<DaemonCredentials | undefined> {
  const value = (await get(DAEMON_CREDENTIALS_KEY))[DAEMON_CREDENTIALS_KEY];
  if (!isRecord(value)) return undefined;
  const base_url = value.base_url;
  const token = value.token;
  if (typeof base_url !== "string" || base_url.length === 0 || typeof token !== "string" || token.length === 0) return undefined;
  return { base_url, token };
}

export async function postAnomaly(fetchImpl: FetchImpl, creds: DaemonCredentials, report: unknown): Promise<CaptureResult> {
  try {
    const response = await fetchImpl(joinDaemonUrl(creds.base_url, "/v1/anomalies"), {
      method: "POST",
      headers: { authorization: `Bearer ${creds.token}`, "content-type": "application/json" },
      body: JSON.stringify(report),
    });
    if (!response.ok) return { ok: false, error: `POST /v1/anomalies failed with ${response.status}` };
    const payload: unknown = await response.json().catch(() => null);
    const id = isRecord(payload) && isRecord(payload.anomaly) && typeof payload.anomaly.id === "string" ? payload.anomaly.id : undefined;
    return id === undefined ? { ok: true } : { ok: true, id };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

export function createAnomalyInstrumentation(deps: AnomalyCaptureDeps = {}): Instrumentation {
  const breadcrumbs = new BreadcrumbBuffer(30, deps.now);
  const storageGet = deps.storageGet ?? defaultStorageGet;
  const fetchImpl = deps.fetchImpl ?? ((input, init) => fetch(input, init));
  let disposeHotkey: (() => void) | null = null;

  async function capture(api: InstrumentationApi): Promise<void> {
    const target = api.getCurrentTarget();
    if (target === null) {
      deps.onResult?.({ ok: false, error: "No anomaly target" });
      return;
    }
    breadcrumbs.push("manual_flag");

    const doc = api.document;
    const locator = capture_locator(target);
    const resolution = resolve(locator, doc);
    const context = buildContext(target, doc);
    const project = project_scope_from_url(api.getScopeInput());
    const key = session_marks_key(project.project_id, project.session_id);
    const stored = await storageGet(key);

    const draft: AnomalyDraft = {
      source: "manual",
      summary: `Manual anomaly @ ${context.element.selector_preview}`,
      breadcrumbs: breadcrumbs.snapshot(),
      locator,
      resolve_result: resolution,
      project,
      env: captureEnv(doc.defaultView ?? {}),
      dom_html: serializeAnomalySnapshot(target as unknown as Parameters<typeof serializeAnomalySnapshot>[0]),
      storage: { [key]: stored[key] ?? [] },
    };

    const creds = await readDaemonCredentials(storageGet);
    if (creds === undefined) {
      deps.onResult?.({ ok: false, error: "Missing daemon credentials" });
      return;
    }
    deps.onResult?.(await postAnomaly(fetchImpl, creds, buildAnomalyReport(draft)));
  }

  return {
    breadcrumb: (kind, detail) => breadcrumbs.push(kind, detail),
    attach: (api) => {
      disposeHotkey = installAnomalyHotkey(api.document, () => void capture(api));
    },
    detach: () => {
      disposeHotkey?.();
      disposeHotkey = null;
    },
  };
}

function defaultStorageGet(key: string): Promise<Record<string, unknown>> {
  const local = (globalThis as { chrome?: { storage?: { local?: { get?: (k: string) => Promise<Record<string, unknown>> } } } }).chrome?.storage?.local;
  return local?.get ? local.get(key) : Promise.resolve({});
}

function joinDaemonUrl(baseUrl: string, path: string): string {
  return new URL(path, baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`).href;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
