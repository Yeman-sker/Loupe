declare const chrome: unknown;

import { origin_permission_pattern, page_bridge_exposure } from "./content.js";

export const MESSAGE_TYPES = Object.freeze({
  GET_ORIGIN_AUTH: "loupe.origin_auth.get",
  REQUEST_ORIGIN_AUTH: "loupe.origin_auth.request",
  SERVICE_WORKER_WAKE: "loupe.service_worker.wake",
});

export type ChromeLike = {
  readonly runtime: {
    readonly onInstalled: {
      addListener(listener: () => void): void;
    };
    readonly onMessage: {
      addListener(
        listener: (message: unknown, sender: ChromeMessageSender, sendResponse: (response: unknown) => void) => boolean,
      ): void;
    };
    readonly lastError?: { readonly message?: string };
  };
  readonly storage: {
    readonly session: {
      set(items: Record<string, unknown>): Promise<void>;
    };
    readonly local: {
      get(keys?: string | string[] | Record<string, unknown> | null): Promise<Record<string, unknown>>;
      set(items: Record<string, unknown>): Promise<void>;
    };
  };
  readonly permissions: {
    contains(permissions: { origins: string[] }): Promise<boolean>;
    request(permissions: { origins: string[] }): Promise<boolean>;
  };
  readonly tabs?: ChromeTabsLike;
};

type ChromeTabLike = Readonly<{
  id?: number;
  url?: string;
}>;

type ChromeTabsLike = Readonly<{
  query(query_info: { active: boolean; currentWindow: boolean }): Promise<ChromeTabLike[]>;
  reload(tab_id: number): Promise<void>;
}>;

export type ChromeMessageSender = {
  readonly url?: string;
  readonly tab?: { readonly id?: number; readonly url?: string };
};

export type AuthorizationDecision =
  | { ok: true; authorized: true; origin: string; origin_pattern: string }
  | { ok: true; authorized: false; origin: string; origin_pattern: string; error?: string }
  | { ok: false; authorized: false; error: string; origin?: string };

export type OriginPermissionProbe = (origins: readonly string[]) => Promise<boolean>;

type ProjectScope = {
  readonly project_id: string;
  readonly session_id: string;
  readonly workspace_root_hash?: string;
  readonly branch?: string;
  readonly origin?: string;
  readonly url?: string;
  readonly route_key?: string;
};

type DaemonCredentials = {
  readonly base_url: string;
  readonly token: string;
};

type SyncState = {
  readonly status?: string;
  readonly retry_count?: number;
  readonly last_synced_at?: string;
  readonly last_error?: string;
};

type Annotation = Record<string, unknown> & {
  readonly id?: unknown;
  readonly project?: { readonly project_id?: unknown; readonly session_id?: unknown } | undefined;
  readonly sync?: SyncState | undefined;
  readonly lifecycle?: { readonly created_at?: string; readonly updated_at?: string; readonly task_status?: string; readonly task_resolved_at?: string } | undefined;
  readonly intent?: { readonly comment?: unknown; readonly kind?: unknown } | undefined;
  readonly target?: (Record<string, unknown> & { readonly resolution?: Record<string, unknown> }) | undefined;
};

type FetchLike = (input: string | URL, init?: RequestInit) => Promise<Response>;

const LOUPE_AUTH_SCHEME = "Bearer";

export function origin_from_message_or_sender(message: unknown, sender: ChromeMessageSender): string | undefined {
  if (is_record(message) && typeof message.origin === "string") return origin_from_url_or_origin(message.origin);
  const sender_url = sender.tab?.url ?? sender.url;
  return typeof sender_url === "string" ? origin_from_url_or_origin(sender_url) : undefined;
}

export async function decide_origin_authorization(
  message: unknown,
  sender: ChromeMessageSender,
  contains: OriginPermissionProbe,
): Promise<AuthorizationDecision> {
  const origin = origin_from_message_or_sender(message, sender);
  if (origin === undefined) return { ok: false, authorized: false, error: "No page origin available" };
  const pattern = origin_permission_pattern(origin);
  if (pattern === undefined) return { ok: false, authorized: false, error: `Unsupported page origin: ${origin}`, origin };

  try {
    const authorized = await contains([pattern]);
    return authorized
      ? { ok: true, authorized: true, origin, origin_pattern: pattern }
      : { ok: true, authorized: false, origin, origin_pattern: pattern };
  } catch (error) {
    return { ok: false, authorized: false, error: error_message(error), origin };
  }
}

export async function request_origin_authorization(
  message: unknown,
  sender: ChromeMessageSender,
  contains: OriginPermissionProbe,
  request: OriginPermissionProbe,
): Promise<AuthorizationDecision> {
  const decision = await decide_origin_authorization(message, sender, contains);
  if (!decision.ok || decision.authorized) return decision;

  try {
    const authorized = await request([decision.origin_pattern]);
    return authorized
      ? { ok: true, authorized: true, origin: decision.origin, origin_pattern: decision.origin_pattern }
      : { ...decision, authorized: false, error: "Origin permission request was denied" };
  } catch (error) {
    return { ok: false, authorized: false, error: error_message(error), origin: decision.origin };
  }
}

export async function request_origin_authorization_from_user_gesture(
  message: unknown,
  sender: ChromeMessageSender,
  contains: OriginPermissionProbe,
  request: OriginPermissionProbe,
  reload_tab?: (tab_id: number) => Promise<void>,
): Promise<AuthorizationDecision> {
  const origin = origin_from_message_or_sender(message, sender);
  if (origin === undefined) return { ok: false, authorized: false, error: "No page origin available" };
  const pattern = origin_permission_pattern(origin);
  if (pattern === undefined) return { ok: false, authorized: false, error: `Unsupported page origin: ${origin}`, origin };

  try {
    const authorized = await request([pattern]);
    if (authorized && sender.tab?.id !== undefined && reload_tab !== undefined) await reload_tab(sender.tab.id);
    return authorized
      ? { ok: true, authorized: true, origin, origin_pattern: pattern }
      : { ok: true, authorized: false, origin, origin_pattern: pattern, error: "Origin permission request was denied" };
  } catch (error) {
    try {
      if (await contains([pattern])) return { ok: true, authorized: true, origin, origin_pattern: pattern };
    } catch {
      // Keep the original permission-request error; contains() is only fallback.
    }
    return { ok: false, authorized: false, error: error_message(error), origin };
  }
}

export async function request_active_tab_origin_authorization(
  tab: ChromeTabLike,
  _contains: OriginPermissionProbe,
  request: OriginPermissionProbe,
  reload_tab?: (tab_id: number) => Promise<void>,
): Promise<AuthorizationDecision> {
  const origin = origin_from_message_or_sender({}, tab.url === undefined ? {} : { tab: { url: tab.url } });
  if (origin === undefined) return { ok: false, authorized: false, error: "No page origin available" };
  const pattern = origin_permission_pattern(origin);
  if (pattern === undefined) return { ok: false, authorized: false, error: `Unsupported page origin: ${origin}`, origin };

  try {
    // Browser-action grant path: call request directly. Probing with contains()
    // first can consume the transient toolbar-click gesture in Chrome.
    const authorized = await request([pattern]);
    const decision: AuthorizationDecision = authorized
      ? { ok: true, authorized: true, origin, origin_pattern: pattern }
      : { ok: true, authorized: false, origin, origin_pattern: pattern, error: "Origin permission request was denied" };
    if (decision.ok && decision.authorized && tab.id !== undefined && reload_tab !== undefined) await reload_tab(tab.id);
    return decision;
  } catch (error) {
    return { ok: false, authorized: false, error: error_message(error), origin };
  }
}

export async function request_current_tab_origin_authorization(
  tabs: ChromeTabsLike,
  contains: OriginPermissionProbe,
  request: OriginPermissionProbe,
): Promise<AuthorizationDecision> {
  const tab = (await tabs.query({ active: true, currentWindow: true }))[0];
  const decision = await request_active_tab_origin_authorization(tab ?? {}, contains, request, tabs.reload);
  return decision;
}

export function service_worker_wake_state(now: string): Record<string, unknown> {
  return {
    loupe_phase: "phase_4_mv3_regression",
    daemon_health_url: "http://127.0.0.1:7373/health",
    last_service_worker_wake_at: now,
    ...page_bridge_exposure(),
  };
}

export async function persist_service_worker_wake(storage: Pick<ChromeLike["storage"], "session">, now: string): Promise<void> {
  await storage.session.set(service_worker_wake_state(now));
}

export async function handle_service_worker_wake(
  storage: ChromeLike["storage"],
  message: unknown,
  now: string,
  fetch_like: FetchLike = fetch,
): Promise<Record<string, unknown>> {
  await persist_service_worker_wake(storage, now);

  const scope = wake_scope(message);
  const daemon = wake_daemon(message);
  if (scope === undefined || daemon === undefined) return { ok: true, reconciled: false, retried: 0, stored: 0 };

  const marks_key = session_marks_key(scope.project_id, scope.session_id);
  const stored = await storage.local.get(marks_key);
  const local_marks = read_annotation_array(stored[marks_key]);
  const delete_pending = local_marks.filter((mark) => is_scope_mark(mark, scope) && mark.sync?.status === "delete_pending");
  for (const mark of delete_pending) await retry_delete_mark(storage.local, fetch_like, marks_key, mark, daemon);
  const after_deletes = read_annotation_array((await storage.local.get(marks_key))[marks_key]);
  const retryable = after_deletes.filter((mark) => is_scope_mark(mark, scope) && !has_deleted_at(mark) && (mark.sync?.status === "local_only" || mark.sync?.status === "failed"));
  const retried_ids = retryable.map((mark) => mark.id);
  for (const mark of retryable) await retry_local_mark(storage.local, fetch_like, marks_key, mark, daemon, now);

  try {
    const response = await fetch_like(mark_list_url(daemon.base_url, scope), { method: "GET", headers: authorized_headers(daemon.token) });
    if (!response.ok) throw new Error(`GET /v1/marks failed with ${response.status}`);
    const payload: unknown = await response.json();
    const daemon_marks = is_record(payload) && Array.isArray(payload.marks) ? payload.marks : [];
    const merged = await reconcile_daemon_marks(storage.local, marks_key, scope, daemon_marks, retried_ids);
    return { ok: true, reconciled: true, retried: retryable.length, stored: merged.length };
  } catch (error) {
    const current = await storage.local.get(marks_key);
    return { ok: true, reconciled: false, retried: retryable.length, stored: read_annotation_array(current[marks_key]).length, error: error_message(error) };
  }
}

export function install_background_listeners(chrome_like: ChromeLike, now: () => string = () => new Date().toISOString()): void {
  chrome_like.runtime.onInstalled.addListener(() => {
    void persist_service_worker_wake(chrome_like.storage, now());
  });

  chrome_like.runtime.onMessage.addListener((message: unknown, sender, sendResponse) => {
    if (!is_record(message)) return false;

    if (message.type === MESSAGE_TYPES.GET_ORIGIN_AUTH) {
      void decide_origin_authorization(message, sender, (origins) => chrome_like.permissions.contains({ origins: [...origins] })).then(
        sendResponse,
        (error) => sendResponse({ ok: false, authorized: false, error: error_message(error) }),
      );
      return true;
    }

    if (message.type === MESSAGE_TYPES.REQUEST_ORIGIN_AUTH) {
      void request_origin_authorization_from_user_gesture(
        message,
        sender,
        (origins) => chrome_like.permissions.contains({ origins: [...origins] }),
        (origins) => chrome_like.permissions.request({ origins: [...origins] }),
        chrome_like.tabs?.reload,
      ).then(sendResponse, (error) => sendResponse({ ok: false, authorized: false, error: error_message(error) }));
      return true;
    }

    if (message.type === MESSAGE_TYPES.SERVICE_WORKER_WAKE) {
      void handle_service_worker_wake(chrome_like.storage, message, now()).then(
        sendResponse,
        (error) => sendResponse({ ok: false, error: error_message(error) }),
      );
      return true;
    }

    return false;
  });
}

function wake_scope(message: unknown): ProjectScope | undefined {
  if (!is_record(message)) return undefined;
  const scope = is_record(message.scope) ? message.scope : message;
  if (typeof scope.project_id !== "string" || typeof scope.session_id !== "string") return undefined;
  return optional_scope({
    project_id: scope.project_id,
    session_id: scope.session_id,
    workspace_root_hash: scope.workspace_root_hash,
    branch: scope.branch,
    origin: scope.origin,
    url: scope.url,
    route_key: scope.route_key,
  });
}

function optional_scope(fields: Record<keyof ProjectScope, unknown>): ProjectScope {
  return {
    project_id: String(fields.project_id),
    session_id: String(fields.session_id),
    ...(typeof fields.workspace_root_hash === "string" ? { workspace_root_hash: fields.workspace_root_hash } : {}),
    ...(typeof fields.branch === "string" ? { branch: fields.branch } : {}),
    ...(typeof fields.origin === "string" ? { origin: fields.origin } : {}),
    ...(typeof fields.url === "string" ? { url: fields.url } : {}),
    ...(typeof fields.route_key === "string" ? { route_key: fields.route_key } : {}),
  };
}

function wake_daemon(message: unknown): DaemonCredentials | undefined {
  if (!is_record(message)) return undefined;
  const daemon = is_record(message.daemon) ? message.daemon : message;
  if (typeof daemon.base_url !== "string" || typeof daemon.token !== "string" || daemon.base_url.length === 0 || daemon.token.length === 0) return undefined;
  return { base_url: daemon.base_url, token: daemon.token };
}

async function retry_local_mark(
  storage: ChromeLike["storage"]["local"],
  fetch_like: FetchLike,
  marks_key: string,
  mark: Annotation,
  daemon: DaemonCredentials,
  now: string,
): Promise<void> {
  const retry_count = mark.sync?.retry_count ?? 0;
  await replace_stored_mark(storage, marks_key, { ...mark, sync: { status: "syncing", retry_count } });
  try {
    const response = await fetch_like(join_daemon_url(daemon.base_url, "/v1/marks"), {
      method: "POST",
      headers: { ...authorized_headers(daemon.token), "content-type": "application/json" },
      body: JSON.stringify(mark),
    });
    if (!response.ok) throw new Error(`POST /v1/marks failed with ${response.status}`);
    const current = (await read_stored_mark(storage, marks_key, mark.id)) ?? mark;
    if (current.lifecycle?.updated_at !== mark.lifecycle?.updated_at) return;
    await replace_stored_mark(storage, marks_key, { ...current, sync: { status: "synced", retry_count: current.sync?.retry_count ?? 0, last_synced_at: now } });
  } catch (error) {
    const current = (await read_stored_mark(storage, marks_key, mark.id)) ?? mark;
    await replace_stored_mark(storage, marks_key, { ...current, sync: { status: "failed", retry_count: (current.sync?.retry_count ?? 0) + 1, last_error: error_message(error) } });
  }
}

async function retry_delete_mark(
  storage: ChromeLike["storage"]["local"],
  fetch_like: FetchLike,
  marks_key: string,
  mark: Annotation,
  daemon: DaemonCredentials,
): Promise<void> {
  try {
    const response = await fetch_like(mark_delete_url(daemon.base_url, mark), { method: "DELETE", headers: authorized_headers(daemon.token) });
    if (!response.ok) throw new Error(`DELETE /v1/marks/${mark.id} failed with ${response.status}`);
    const current = (await read_stored_mark(storage, marks_key, mark.id)) ?? mark;
    await delete_stored_mark(storage, marks_key, current);
  } catch (error) {
    const current = (await read_stored_mark(storage, marks_key, mark.id)) ?? mark;
    await replace_stored_mark(storage, marks_key, { ...current, sync: { status: "delete_pending", retry_count: (current.sync?.retry_count ?? 0) + 1, last_error: error_message(error) } });
  }
}

async function reconcile_daemon_marks(
  storage: ChromeLike["storage"]["local"],
  marks_key: string,
  scope: ProjectScope,
  daemon_marks: readonly unknown[],
  preserve_missing_ids: readonly unknown[] = [],
): Promise<Annotation[]> {
  const stored = await storage.get(marks_key);
  const local_marks = read_annotation_array(stored[marks_key]);
  const preserved_missing_ids = new Set(preserve_missing_ids);
  const tombstones_key = project_tombstones_key(scope.project_id);
  const existing_tombstones = read_string_array((await storage.get(tombstones_key))[tombstones_key]);
  const tombstone_ids = new Set(existing_tombstones);
  const scoped_daemon_marks: Annotation[] = [];
  for (const mark of daemon_marks) {
    if (is_daemon_mark_for_scope(mark, scope) && typeof mark.id === "string" && !tombstone_ids.has(mark.id)) scoped_daemon_marks.push(mark);
  }
  const daemon_ids = new Set(scoped_daemon_marks.map((mark) => mark.id));
  const next: Annotation[] = [];
  const tombstoned_ids: unknown[] = [];
  for (const local_mark of local_marks) {
    if (!is_scope_mark(local_mark, scope)) {
      next.push(local_mark);
      continue;
    }
    if (!daemon_ids.has(local_mark.id)) {
      if (preserved_missing_ids.has(local_mark.id) || local_mark.sync?.status === "local_only" || local_mark.sync?.status === "failed") next.push(local_mark);
      else if (local_mark.sync?.status === "synced" || local_mark.sync?.status === "delete_pending") tombstoned_ids.push(local_mark.id);
    }
  }
  const by_id = new Map<unknown, Annotation>(next.map((mark) => [mark.id, mark]));
  for (const daemon_mark of scoped_daemon_marks) {
    const local = by_id.get(daemon_mark.id) ?? local_marks.find((mark) => mark.id === daemon_mark.id);
    if (local !== undefined && should_preserve_unsynced_local(local, daemon_mark)) {
      by_id.set(local.id, local);
      continue;
    }
    by_id.set(daemon_mark.id, local === undefined ? annotation_from_daemon_mark(daemon_mark) : reconcile_local_mark(local, daemon_mark));
  }
  const reconciled = Array.from(by_id.values());
  await storage.set({ [marks_key]: reconciled, [tombstones_key]: upsert_tombstones(existing_tombstones, tombstoned_ids) });
  return reconciled;
}

function annotation_from_daemon_mark(daemon_mark: Annotation): Annotation {
  const target = is_record(daemon_mark.target) ? daemon_mark.target : {};
  const intent = is_record(daemon_mark.intent) ? daemon_mark.intent : {};
  const lifecycle = is_record(daemon_mark.lifecycle) ? daemon_mark.lifecycle : {};
  const selector = typeof target.selector === "string" ? target.selector : "";
  const now = typeof lifecycle.updated_at === "string" ? lifecycle.updated_at : "";
  return {
    schema_version: 1,
    id: daemon_mark.id,
    project: daemon_mark.project,
    target: { locator: { primary: { selector, strategy: "daemon" }, alternates: [], evidence: { tag: target.tag ?? "unknown", nth_path: selector, parent_chain: [] } }, resolution: { locator_status: target.locator_status, confidence: target.confidence, matched_by: target.matched_by ?? ["daemon"], resolved_at: now } },
    intent: { comment: intent.comment, kind: intent.kind ?? "other" },
    context: { element: { tag: target.tag ?? "unknown", selector_preview: target.selector_preview ?? selector, ...(target.text === undefined ? {} : { text: target.text }), ...(target.classes === undefined ? {} : { classes: target.classes }) }, viewport: { width: 0, height: 0, dpr: 1 }, position: { x: 0, y: 0, width: 0, height: 0 } },
    sync: { status: "synced", retry_count: 0 },
    media: daemon_mark.media ?? { has_screenshot: false },
    replies: { items: [] },
    lifecycle: { ...(typeof lifecycle.task_status === "string" ? { task_status: lifecycle.task_status } : {}), ...(typeof lifecycle.created_at === "string" ? { created_at: lifecycle.created_at } : {}), ...(typeof lifecycle.updated_at === "string" ? { updated_at: lifecycle.updated_at } : {}) },
  };
}

function reconcile_local_mark(local_mark: Annotation, daemon_mark: Annotation): Annotation {
  const daemon_target = is_record(daemon_mark.target) ? daemon_mark.target : {};
  const daemon_intent = is_record(daemon_mark.intent) ? daemon_mark.intent : {};
  const daemon_lifecycle = is_record(daemon_mark.lifecycle) ? daemon_mark.lifecycle : {};
  const local_lifecycle = is_record(local_mark.lifecycle) ? local_mark.lifecycle : {};
  return {
    ...local_mark,
    intent: { comment: daemon_intent.comment, kind: daemon_intent.kind ?? local_mark.intent?.kind ?? "other" },
    target: { ...local_mark.target, resolution: { ...local_mark.target?.resolution, locator_status: daemon_target.locator_status, confidence: daemon_target.confidence, matched_by: daemon_target.matched_by ?? [] } },
    lifecycle: { ...local_lifecycle, ...(typeof daemon_lifecycle.task_status === "string" ? { task_status: daemon_lifecycle.task_status } : {}), ...(typeof daemon_lifecycle.updated_at === "string" ? { updated_at: daemon_lifecycle.updated_at } : {}), ...(daemon_lifecycle.task_status === "resolved" && local_lifecycle.task_resolved_at === undefined && typeof daemon_lifecycle.updated_at === "string" ? { task_resolved_at: daemon_lifecycle.updated_at } : {}) },
    sync: { status: "synced", retry_count: local_mark.sync?.retry_count ?? 0 },
  };
}

function should_preserve_unsynced_local(local_mark: Annotation, daemon_mark: Annotation): boolean {
  return (local_mark.sync?.status === "local_only" || local_mark.sync?.status === "failed") && (local_mark.lifecycle?.updated_at ?? "") >= (daemon_mark.lifecycle?.updated_at ?? "");
}

async function replace_stored_mark(storage: ChromeLike["storage"]["local"], marks_key: string, mark: Annotation): Promise<void> {
  const stored = await storage.get(marks_key);
  const marks = read_annotation_array(stored[marks_key]);
  const index = marks.findIndex((item) => item.id === mark.id);
  const next = index === -1 ? [...marks, mark] : [...marks.slice(0, index), mark, ...marks.slice(index + 1)];
  await storage.set({ [marks_key]: next });
}

async function delete_stored_mark(storage: ChromeLike["storage"]["local"], marks_key: string, mark: Annotation): Promise<void> {
  const stored = await storage.get(marks_key);
  const marks = read_annotation_array(stored[marks_key]);
  const project_id = mark_project_string(mark, "project_id");
  if (project_id === undefined) return;
  const tombstones_key = project_tombstones_key(project_id);
  const existing_tombstones = read_string_array((await storage.get(tombstones_key))[tombstones_key]);
  await storage.set({ [marks_key]: marks.filter((item) => item.id !== mark.id), [tombstones_key]: upsert_tombstones(existing_tombstones, [mark.id]) });
}

async function read_stored_mark(storage: ChromeLike["storage"]["local"], marks_key: string, mark_id: unknown): Promise<Annotation | undefined> {
  const stored = await storage.get(marks_key);
  return read_annotation_array(stored[marks_key]).find((mark) => mark.id === mark_id);
}

function has_deleted_at(mark: Annotation): boolean {
  const lifecycle = is_record(mark.lifecycle) ? (mark.lifecycle as Record<string, unknown>) : {};
  return typeof lifecycle.deleted_at === "string";
}

function mark_project_string(mark: Annotation, key: string): string | undefined {
  const project = is_record(mark.project) ? (mark.project as Record<string, unknown>) : {};
  const value = project[key];
  return typeof value === "string" ? value : undefined;
}

function is_scope_mark(mark: Annotation, scope: ProjectScope): boolean {
  return mark.project?.project_id === scope.project_id && mark.project.session_id === scope.session_id;
}

function is_daemon_mark_for_scope(mark: unknown, scope: ProjectScope): mark is Annotation {
  return is_record(mark) && is_scope_mark(mark, scope);
}

function read_annotation_array(value: unknown): Annotation[] {
  return Array.isArray(value) ? value.filter(is_record) : [];
}

function read_string_array(value: unknown): string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string") ? value : [];
}

function upsert_tombstones(tombstones: readonly string[], mark_ids: readonly unknown[]): string[] {
  if (mark_ids.length === 0) return [...tombstones];
  const next = new Set(tombstones);
  for (const mark_id of mark_ids) {
    if (typeof mark_id === "string") next.add(mark_id);
  }
  return Array.from(next);
}

function project_tombstones_key(project_id: string): string {
  return `loupe:v1:project:${project_id}:tombstones`;
}

function session_marks_key(project_id: string, session_id: string): string {
  return `loupe:v1:project:${project_id}:session:${session_id}:marks`;
}
function mark_delete_url(base_url: string, mark: Annotation): string {
  const url = new URL(join_daemon_url(base_url, `/v1/marks/${encodeURIComponent(String(mark.id))}`));
  append_param(url, "project_id", mark_project_string(mark, "project_id"));
  append_param(url, "workspace_root_hash", mark_project_string(mark, "workspace_root_hash"));
  append_param(url, "branch", mark_project_string(mark, "branch"));
  append_param(url, "origin", mark_project_string(mark, "origin"));
  append_param(url, "url", mark_project_string(mark, "url"));
  append_param(url, "route_key", mark_project_string(mark, "route_key"));
  append_param(url, "session_id", mark_project_string(mark, "session_id"));
  return url.href;
}

function mark_list_url(base_url: string, scope: ProjectScope): string {
  const url = new URL(join_daemon_url(base_url, "/v1/marks"));
  append_param(url, "project_id", scope.project_id);
  append_param(url, "workspace_root_hash", scope.workspace_root_hash);
  append_param(url, "branch", scope.branch);
  append_param(url, "origin", scope.origin);
  append_param(url, "url", scope.url);
  append_param(url, "route_key", scope.route_key);
  append_param(url, "session_id", scope.session_id);
  return url.href;
}

function append_param(url: URL, key: string, value: string | undefined): void {
  if (value !== undefined) url.searchParams.set(key, value);
}

function authorized_headers(token: string): HeadersInit {
  return { authorization: `${LOUPE_AUTH_SCHEME} ${token}` };
}

function join_daemon_url(base_url: string, path: string): string {
  return new URL(path, base_url.endsWith("/") ? base_url : `${base_url}/`).href;
}

function origin_from_url_or_origin(value: string): string | undefined {
  try {
    const url = new URL(value);
    return url.origin === "null" ? `${url.protocol}//${url.host}` : url.origin;
  } catch {
    return undefined;
  }
}

function is_record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function error_message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

const chrome_global = typeof chrome === "undefined" ? undefined : (chrome as unknown as ChromeLike);
if (chrome_global !== undefined) install_background_listeners(chrome_global);
