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
  prompt?: (message: string, defaultValue?: string) => string | null;
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
  let disposeErrors: (() => void) | null = null;
  let activeApi: InstrumentationApi | null = null;

  async function captureManual(api: InstrumentationApi): Promise<void> {
    const target = api.getCurrentTarget();
    if (target === null) {
      deps.onResult?.({ ok: false, error: "No anomaly target" });
      return;
    }

    const context = buildContext(target, api.document);
    const prompt = deps.prompt ?? api.document.defaultView?.prompt;
    const expected = prompt?.call(api.document.defaultView, "Loupe anomaly: what did you expect?", "");
    if (expected === undefined || expected === null || expected.trim().length === 0) {
      deps.onResult?.({ ok: false, error: "Manual anomaly capture requires expected behavior" });
      return;
    }
    const actualDefault = `Current target: ${context.element.selector_preview}`;
    const actual = prompt?.call(api.document.defaultView, "Loupe anomaly: what actually happened?", actualDefault);

    breadcrumbs.push("manual_flag");
    await submit(api, {
      source: "manual",
      target,
      summary: `Manual anomaly @ ${context.element.selector_preview}`,
      expected: expected.trim(),
      actual: actual === null || actual === undefined || actual.trim().length === 0 ? actualDefault : actual.trim(),
    });
  }

  async function captureHardError(api: InstrumentationApi, error: unknown): Promise<void> {
    breadcrumbs.push("hard_error", errorSummary(error));
    await submit(api, {
      source: "hard_error",
      target: api.getCurrentTarget(),
      summary: `Hard error: ${errorSummary(error)}`,
      error: anomalyError(error),
    });
  }

  async function captureInvariant(api: InstrumentationApi, name: string, detail?: string): Promise<void> {
    breadcrumbs.push("invariant", detail ?? name);
    await submit(api, {
      source: "invariant",
      target: api.getCurrentTarget(),
      summary: detail === undefined ? `Invariant failed: ${name}` : `Invariant failed: ${name} — ${detail}`,
      expected: `Invariant holds: ${name}`,
      actual: detail ?? "Invariant hook reported a violation",
    });
  }

  async function submit(api: InstrumentationApi, input: CaptureInput): Promise<void> {
    const doc = api.document;
    const target = input.target;
    const project = project_scope_from_url(api.getScopeInput());
    const key = session_marks_key(project.project_id, project.session_id);
    const stored = await storageGet(key);

    const draft: AnomalyDraft = {
      source: input.source,
      summary: input.summary,
      breadcrumbs: breadcrumbs.snapshot(),
      project,
      env: captureEnv(doc.defaultView ?? {}),
      storage: { [key]: stored[key] ?? [] },
    };

    if (input.expected !== undefined) draft.expected = input.expected;
    if (input.actual !== undefined) draft.actual = input.actual;
    if (input.error !== undefined) draft.error = input.error;
    if (target !== null) {
      try {
        const locator = capture_locator(target);
        draft.locator = locator;
        draft.resolve_result = resolve(locator, doc);
      } catch (error) {
        breadcrumbs.push("locator_capture_failed", errorSummary(error));
      }
      draft.dom_html = serializeAnomalySnapshot(target as unknown as Parameters<typeof serializeAnomalySnapshot>[0]);
    }

    const creds = await readDaemonCredentials(storageGet);
    if (creds === undefined) {
      deps.onResult?.({ ok: false, error: "Missing daemon credentials" });
      return;
    }
    deps.onResult?.(await postAnomaly(fetchImpl, creds, buildAnomalyReport(draft)));
  }

  return {
    breadcrumb: (kind, detail) => breadcrumbs.push(kind, detail),
    invariant: (name, detail) => {
      if (activeApi !== null) void captureInvariant(activeApi, name, detail);
    },
    attach: (api) => {
      activeApi = api;
      disposeHotkey = installAnomalyHotkey(api.document, () => void captureManual(api));
      disposeErrors = installHardErrorListeners(api, (error) => void captureHardError(api, error));
    },
    detach: () => {
      disposeHotkey?.();
      disposeErrors?.();
      disposeHotkey = null;
      disposeErrors = null;
      activeApi = null;
    },
  };
}

type CaptureInput = {
  source: AnomalyDraft["source"];
  target: Element | null;
  summary: string;
  expected?: string;
  actual?: string;
  error?: NonNullable<AnomalyDraft["error"]>;
};

function installHardErrorListeners(api: InstrumentationApi, onError: (error: unknown) => void): () => void {
  const win = api.document.defaultView;
  if (win === null) return () => {};
  const onWindowError = (event: ErrorEvent): void => onError(event.error ?? event.message);
  const onUnhandledRejection = (event: PromiseRejectionEvent): void => onError(event.reason);
  win.addEventListener("error", onWindowError);
  win.addEventListener("unhandledrejection", onUnhandledRejection);
  return () => {
    win.removeEventListener("error", onWindowError);
    win.removeEventListener("unhandledrejection", onUnhandledRejection);
  };
}

function anomalyError(error: unknown): NonNullable<AnomalyDraft["error"]> {
  if (error instanceof Error) {
    const result: NonNullable<AnomalyDraft["error"]> = { message: error.message };
    if (error.name.length > 0) result.name = error.name;
    if (typeof error.stack === "string") result.stack = error.stack;
    return result;
  }
  return { message: typeof error === "string" ? error : JSON.stringify(error) ?? String(error) };
}

function errorSummary(error: unknown): string {
  const message = anomalyError(error).message;
  return message.length === 0 ? "Unknown error" : message;
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
