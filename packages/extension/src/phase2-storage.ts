import {
  LOUPE_AUTH_SCHEME,
  LOUPE_SCHEMA_VERSION,
  is_agent_mark,
  storage_keys,
  type AgentMark,
  type Annotation,
  type AnnotationPosition,
  type FrameworkName,
  type HealthPayload,
  type IntentKind,
  type ListMarksResponse,
  type Locator,
  type ProjectScopeWithUrl,
  type ResolveResult,
} from "@loupe-server/shared";

export type AnnotationDraft = {
  id: string;
  project: ProjectScopeWithUrl;
  locator: Locator;
  resolution: ResolveResult;
  comment: string;
  intent_kind?: IntentKind;
  context: AnnotationContextDraft;
  now: string;
};

export type AnnotationContextDraft = {
  element: {
    tag: string;
    id?: string;
    role?: string;
    accessible_name?: string;
    classes?: string[];
    text?: string;
    selector_preview: string;
  };
  a11y?: {
    role?: string;
    label?: string;
    described_by?: string;
    tab_index?: number;
    expanded?: boolean;
  };
  layout?: {
    display?: string;
    position?: string;
    box_sizing?: string;
    flex_direction?: string;
    gap?: string;
  };
  framework?: {
    name: FrameworkName;
    component?: string;
    source_hint?: {
      file?: string;
      line?: number;
      confidence: number;
    };
  };
  viewport: {
    width: number;
    height: number;
    dpr: number;
  };
  position: AnnotationPosition;
};

export type MarkStore = {
  get(key: string): Promise<unknown>;
  set(items: Record<string, unknown>): Promise<void>;
};

export type SessionRoute = {
  project_id: string;
  session_id: string;
  route_key?: string;
};

export type DaemonFetch = (input: string, init?: RequestInit) => Promise<Response>;

export type DaemonSyncDependencies = {
  fetch: DaemonFetch;
  store: MarkStore;
  now: () => string;
};

export type DaemonRequestOptions = {
  base_url: string;
  token: string;
};

export type ReconcileScope = {
  project_id: string;
  session_id: string;
};

export type SyncAnnotationResult =
  | { ok: true; mark: Annotation }
  | { ok: false; mark: Annotation; error: string };

export type RetryUnsyncedResult = {
  attempted: number;
  results: SyncAnnotationResult[];
};

export function session_marks_key(project_id: string, session_id: string): string {
  return storage_keys.session_marks(project_id, session_id);
}

export type ProjectScopeUrlInput = {
  url: string;
  title?: string;
  project_id?: string;
  workspace_root_hash?: string;
  branch?: string;
};

export function project_scope_from_url(input: ProjectScopeUrlInput): ProjectScopeWithUrl {
  const url = new URL(input.url);
  const origin_hash = fnv1a(url.origin).toString(36);
  const route_key = route_key_from_url(url);
  const has_daemon_project = input.project_id !== undefined && input.workspace_root_hash !== undefined;
  const project_id = input.project_id ?? `local_${origin_hash}`;
  const scope: ProjectScopeWithUrl = {
    project_id,
    workspace_root_hash: input.workspace_root_hash ?? `temporary_origin_${origin_hash}`,
    ...(input.branch === undefined ? {} : { branch: input.branch }),
    origin: url.origin,
    route_key,
    session_id: has_daemon_project ? deterministic_session_id(project_id, input.branch, route_key) : transient_session_id(url.origin, route_key),
    url: url.href,
  };
  if (input.title !== undefined) scope.title = input.title;
  return scope;
}

export function deterministic_session_id(project_id: string, branch: string | undefined, route_key: string): string {
  return `session_${fnv1a(`${project_id}\n${branch ?? ""}\n${route_key}`).toString(36)}`;
}

function transient_session_id(origin: string, route_key: string): string {
  return `temporary_${fnv1a(`${origin}\n${route_key}`).toString(36)}`;
}

function route_key_from_url(url: URL): string {
  const params = [...url.searchParams.entries()].sort(([left], [right]) => left.localeCompare(right));
  const search = new URLSearchParams(params).toString();
  return `${url.pathname || "/"}${search.length === 0 ? "" : `?${search}`}`;
}

function fnv1a(text: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

export function validate_comment(comment: string): string {
  const trimmed = comment.trim();
  if (trimmed.length === 0) throw new TypeError("Loupe annotations require a non-empty comment");
  return trimmed;
}

export function create_annotation(draft: AnnotationDraft): Annotation {
  const comment = validate_comment(draft.comment);
  const now = draft.now;

  return {
    schema_version: LOUPE_SCHEMA_VERSION,
    id: draft.id,
    project: draft.project,
    target: {
      locator: draft.locator,
      resolution: {
        locator_status: draft.resolution.locator_status,
        confidence: draft.resolution.confidence,
        matched_by: draft.resolution.matched_by,
        resolved_at: now,
      },
    },
    intent: {
      comment,
      kind: draft.intent_kind ?? "other",
    },
    context: draft.context,
    sync: {
      status: "local_only",
      retry_count: 0,
    },
    media: {
      has_screenshot: false,
    },
    replies: {
      items: [],
    },
    lifecycle: {
      task_status: "open",
      created_at: now,
      updated_at: now,
    },
  };
}

export function resolve_annotation(mark: Annotation, resolved_at: string): Annotation {
  return {
    ...mark,
    lifecycle: {
      ...mark.lifecycle,
      task_status: "resolved",
      updated_at: resolved_at,
      task_resolved_at: resolved_at,
    },
  };
}

export async function delete_annotation(store: MarkStore, project_id: string, session_id: string, mark_id: string): Promise<void> {
  const marks_key = session_marks_key(project_id, session_id);
  const tombstones_key = storage_keys.project_tombstones(project_id);
  const active_marks = read_annotation_array(await store.get(marks_key));
  const tombstones = read_tombstones(await store.get(tombstones_key));

  await store.set({
    [marks_key]: active_marks.filter((mark) => mark.id !== mark_id),
    [tombstones_key]: upsert_tombstone(tombstones, mark_id),
  });
}

export async function probe_daemon_health(fetch_impl: DaemonFetch, base_url: string): Promise<HealthPayload | undefined> {
  const response = await fetch_impl(join_daemon_url(base_url, "/health"));
  if (!response.ok) return undefined;
  const payload = (await response.json()) as HealthPayload;
  return payload.ok === true ? payload : undefined;
}

export async function sync_annotation_to_daemon(
  deps: DaemonSyncDependencies,
  options: DaemonRequestOptions,
  mark: Annotation,
): Promise<SyncAnnotationResult> {
  const marks_key = session_marks_key(mark.project.project_id, mark.project.session_id);
  const syncing_mark = with_sync(mark, { status: "syncing", retry_count: mark.sync.retry_count });
  await replace_stored_mark(deps.store, marks_key, syncing_mark);

  try {
    const response = await deps.fetch(join_daemon_url(options.base_url, "/v1/marks"), {
      method: "POST",
      headers: authorized_json_headers(options.token),
      body: JSON.stringify(mark),
    });
    if (!response.ok) throw new Error(`POST /v1/marks failed with ${response.status}`);

    const current_mark = await read_stored_mark(deps.store, marks_key, mark.id);
    if (current_mark !== undefined && current_mark.lifecycle.updated_at !== mark.lifecycle.updated_at) return { ok: true, mark: current_mark };
    const synced_mark = with_sync(current_mark ?? syncing_mark, {
      status: "synced",
      retry_count: (current_mark ?? syncing_mark).sync.retry_count,
      last_synced_at: deps.now(),
    });
    await replace_stored_mark(deps.store, marks_key, synced_mark);
    return { ok: true, mark: synced_mark };
  } catch (error) {
    const current_mark = await read_stored_mark(deps.store, marks_key, mark.id);
    const failed_base = current_mark ?? syncing_mark;
    const failed_mark = with_sync(failed_base, {
      status: "failed",
      retry_count: failed_base.sync.retry_count + 1,
      last_error: error_message(error),
    });
    await replace_stored_mark(deps.store, marks_key, failed_mark);
    return { ok: false, mark: failed_mark, error: failed_mark.sync.last_error ?? "Daemon sync failed" };
  }
}

export async function fetch_daemon_marks(
  fetch_impl: DaemonFetch,
  options: DaemonRequestOptions,
  scope: ProjectScopeWithUrl,
): Promise<ListMarksResponse> {
  const response = await fetch_impl(mark_list_url(options.base_url, scope), {
    method: "GET",
    headers: authorized_headers(options.token),
  });
  if (!response.ok) throw new Error(`GET /v1/marks failed with ${response.status}`);
  const payload = (await response.json()) as ListMarksResponse;
  if (!Array.isArray(payload.marks) || !payload.marks.every(is_agent_mark)) throw new TypeError("Expected daemon marks response");
  return payload;
}

export async function reconcile_daemon_marks(
  store: MarkStore,
  scope: ReconcileScope,
  daemon_marks: readonly AgentMark[],
): Promise<Annotation[]> {
  const marks_key = session_marks_key(scope.project_id, scope.session_id);
  const tombstones_key = storage_keys.project_tombstones(scope.project_id);
  const local_marks = read_annotation_array(await store.get(marks_key));
  const tombstones = read_tombstones(await store.get(tombstones_key));
  const daemon_by_id = new Map(daemon_marks.map((mark) => [mark.id, mark]));
  let next_tombstones = tombstones;
  const next_marks: Annotation[] = [];

  for (const local_mark of local_marks) {
    if (local_mark.project.project_id !== scope.project_id || local_mark.project.session_id !== scope.session_id) {
      next_marks.push(local_mark);
      continue;
    }

    const daemon_mark = daemon_by_id.get(local_mark.id);
    if (daemon_mark === undefined) {
      if (local_mark.sync.status === "synced" || local_mark.sync.status === "delete_pending") {
        next_tombstones = upsert_tombstone(next_tombstones, local_mark.id);
      } else {
        next_marks.push(local_mark);
      }
      continue;
    }
    daemon_by_id.delete(local_mark.id);
    next_marks.push(should_preserve_unsynced_local(local_mark, daemon_mark) ? local_mark : reconcile_local_mark(local_mark, daemon_mark));
  }

  for (const daemon_mark of daemon_by_id.values()) {
    next_marks.push(annotation_from_daemon_mark(daemon_mark));
  }

  await store.set({
    [marks_key]: next_marks,
    [tombstones_key]: next_tombstones,
  });
  return next_marks;
}

export async function retry_unsynced_annotations(
  deps: DaemonSyncDependencies,
  options: DaemonRequestOptions,
  scope: ReconcileScope,
): Promise<RetryUnsyncedResult> {
  const marks_key = session_marks_key(scope.project_id, scope.session_id);
  const local_marks = read_annotation_array(await deps.store.get(marks_key));
  const retryable = local_marks.filter(
    (mark) =>
      mark.project.project_id === scope.project_id &&
      mark.project.session_id === scope.session_id &&
      (mark.sync.status === "local_only" || mark.sync.status === "failed"),
  );
  const results: SyncAnnotationResult[] = [];
  for (const mark of retryable) results.push(await sync_annotation_to_daemon(deps, options, mark));
  return { attempted: retryable.length, results };
}

export async function reconcile_on_service_worker_wake(
  deps: DaemonSyncDependencies,
  options: DaemonRequestOptions,
  scope: ProjectScopeWithUrl,
): Promise<Annotation[]> {
  await retry_unsynced_annotations(deps, options, { project_id: scope.project_id, session_id: scope.session_id });
  try {
    return await fetch_and_reconcile_daemon_marks(deps, options, scope);
  } catch {
    return read_annotation_array(await deps.store.get(session_marks_key(scope.project_id, scope.session_id)));
  }
}


export async function fetch_and_reconcile_daemon_marks(
  deps: Pick<DaemonSyncDependencies, "fetch" | "store">,
  options: DaemonRequestOptions,
  scope: ProjectScopeWithUrl,
): Promise<Annotation[]> {
  const response = await fetch_daemon_marks(deps.fetch, options, scope);
  return reconcile_daemon_marks(deps.store, { project_id: scope.project_id, session_id: scope.session_id }, response.marks);
}

export function copy_markdown(marks: readonly Annotation[], route: SessionRoute): string {
  return marks
    .filter(
      (mark) =>
        mark.project.project_id === route.project_id &&
        mark.project.session_id === route.session_id &&
        (route.route_key === undefined || mark.project.route_key === route.route_key) &&
        mark.lifecycle.task_status === "open",
    )
    .map(mark_to_markdown)
    .join("\n\n");
}

function mark_to_markdown(mark: Annotation): string {
  return [
    `- id: ${mark.id}`,
    `  selector: ${mark.context.element.selector_preview}`,
    `  comment: ${mark.intent.comment}`,
    `  locator: ${mark.target.resolution.locator_status} (${format_confidence(mark.target.resolution.confidence)})`,
    `  sync: ${mark.sync.status}`,
  ].join("\n");
}

function format_confidence(confidence: number): string {
  return String(confidence);
}

function read_annotation_array(value: unknown): Annotation[] {
  return Array.isArray(value) ? (value as Annotation[]) : [];
}

function read_tombstones(value: unknown): string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string") ? value : [];
}

function upsert_tombstone(tombstones: readonly string[], mark_id: string): string[] {
  return tombstones.includes(mark_id) ? [...tombstones] : [...tombstones, mark_id];
}

function replace_stored_mark(store: MarkStore, marks_key: string, mark: Annotation): Promise<void> {
  return store.get(marks_key).then((value) => {
    const marks = read_annotation_array(value);
    const index = marks.findIndex((item) => item.id === mark.id);
    const next = index === -1 ? [...marks, mark] : [...marks.slice(0, index), mark, ...marks.slice(index + 1)];
    return store.set({ [marks_key]: next });
  });
}

async function read_stored_mark(store: MarkStore, marks_key: string, mark_id: string): Promise<Annotation | undefined> {
  return read_annotation_array(await store.get(marks_key)).find((mark) => mark.id === mark_id);
}

function should_preserve_unsynced_local(local_mark: Annotation, daemon_mark: AgentMark): boolean {
  return (local_mark.sync.status === "local_only" || local_mark.sync.status === "failed") && local_mark.lifecycle.updated_at >= daemon_mark.lifecycle.updated_at;
}

function with_sync(mark: Annotation, sync: Annotation["sync"]): Annotation {
  return { ...mark, sync };
}

function reconcile_local_mark(local_mark: Annotation, daemon_mark: AgentMark): Annotation {
  return {
    ...local_mark,
    intent: {
      comment: daemon_mark.intent.comment,
      kind: is_intent_kind(daemon_mark.intent.kind) ? daemon_mark.intent.kind : local_mark.intent.kind,
    },
    target: {
      ...local_mark.target,
      resolution: {
        ...local_mark.target.resolution,
        locator_status: daemon_mark.target.locator_status,
        confidence: daemon_mark.target.confidence,
        matched_by: daemon_mark.target.matched_by,
      },
    },
    lifecycle: {
      ...local_mark.lifecycle,
      task_status: daemon_mark.lifecycle.task_status,
      updated_at: daemon_mark.lifecycle.updated_at,
      ...(daemon_mark.lifecycle.task_status === "resolved" && local_mark.lifecycle.task_resolved_at === undefined
        ? { task_resolved_at: daemon_mark.lifecycle.updated_at }
        : {}),
    },
    sync: sync_synced(local_mark.sync),
  };
}

function annotation_from_daemon_mark(daemon_mark: AgentMark): Annotation {
  const resolved_at = daemon_mark.lifecycle.updated_at;
  const project: ProjectScopeWithUrl = {
    project_id: daemon_mark.project.project_id,
    workspace_root_hash: daemon_mark.project.workspace_root_hash,
    ...(daemon_mark.project.branch === undefined ? {} : { branch: daemon_mark.project.branch }),
    origin: new URL(daemon_mark.project.url).origin,
    url: daemon_mark.project.url,
    route_key: daemon_mark.project.route_key,
    session_id: daemon_mark.project.session_id,
  };
  const context_framework = daemon_mark.framework === undefined || !is_framework_name(daemon_mark.framework.name)
    ? {}
    : {
        framework: {
          name: daemon_mark.framework.name,
          ...(daemon_mark.framework.component === undefined ? {} : { component: daemon_mark.framework.component }),
          ...(daemon_mark.framework.source_hint === undefined
            ? {}
            : { source_hint: { file: daemon_mark.framework.source_hint, confidence: daemon_mark.target.confidence } }),
        },
      };

  return {
    schema_version: LOUPE_SCHEMA_VERSION,
    id: daemon_mark.id,
    project,
    target: {
      locator: {
        ...(daemon_mark.target.frame_path === undefined ? {} : { frame_path: daemon_mark.target.frame_path }),
        primary: { selector: daemon_mark.target.selector, strategy: daemon_mark.target.shadow_path === undefined ? "stable_attr" : "shadow_path" },
        alternates: daemon_mark.target.path === undefined ? [] : [{ selector: daemon_mark.target.path, strategy: "nth_path" }],
        evidence: {
          tag: daemon_mark.target.tag,
          ...(daemon_mark.target.classes === undefined ? {} : { classes: { stable: daemon_mark.target.classes, total: daemon_mark.target.classes.length } }),
          ...(daemon_mark.target.text === undefined
            ? {}
            : { text: { normalized: daemon_mark.target.text, hash: "", length: daemon_mark.target.text.length } }),
          nth_path: daemon_mark.target.path ?? daemon_mark.target.selector,
          parent_chain: [],
          ...(daemon_mark.target.shadow_path === undefined ? {} : { shadow_path: daemon_mark.target.shadow_path }),
          ...(daemon_mark.target.boundary === undefined ? {} : { boundary: daemon_mark.target.boundary }),
        },
      },
      ...(daemon_mark.target.boundary === undefined ? {} : { boundary: daemon_mark.target.boundary }),
      resolution: {
        locator_status: daemon_mark.target.locator_status,
        confidence: daemon_mark.target.confidence,
        matched_by: daemon_mark.target.matched_by,
        resolved_at,
      },
    },
    intent: {
      comment: daemon_mark.intent.comment,
      kind: is_intent_kind(daemon_mark.intent.kind) ? daemon_mark.intent.kind : "other",
    },
    context: {
      element: {
        tag: daemon_mark.target.tag,
        ...(daemon_mark.target.classes === undefined ? {} : { classes: daemon_mark.target.classes }),
        ...(daemon_mark.target.text === undefined ? {} : { text: daemon_mark.target.text }),
        selector_preview: daemon_mark.target.selector_preview,
      },
      ...context_framework,
      viewport: { width: 0, height: 0, dpr: 1 },
      position: { x: 0, y: 0, width: 0, height: 0 },
    },
    sync: { status: "synced", retry_count: 0 },
    media: daemon_mark.media,
    replies: { items: [] },
    lifecycle: {
      task_status: daemon_mark.lifecycle.task_status,
      created_at: daemon_mark.lifecycle.created_at,
      updated_at: daemon_mark.lifecycle.updated_at,
      ...(daemon_mark.lifecycle.task_status === "resolved" ? { task_resolved_at: daemon_mark.lifecycle.updated_at } : {}),
    },
  };
}

function sync_synced(sync: Annotation["sync"]): Annotation["sync"] {
  return sync.last_synced_at === undefined
    ? { status: "synced", retry_count: sync.retry_count }
    : { status: "synced", retry_count: sync.retry_count, last_synced_at: sync.last_synced_at };
}

function mark_list_url(base_url: string, scope: ProjectScopeWithUrl): string {
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

function authorized_json_headers(token: string): HeadersInit {
  return { ...authorized_headers(token), "content-type": "application/json" };
}

function join_daemon_url(base_url: string, path: string): string {
  return new URL(path, base_url.endsWith("/") ? base_url : `${base_url}/`).href;
}

function error_message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function is_intent_kind(value: unknown): value is IntentKind {
  return value === "bug" || value === "copy" || value === "style" || value === "layout" || value === "question" || value === "other";
}

function is_framework_name(value: unknown): value is FrameworkName {
  return value === "react" || value === "vue" || value === "svelte" || value === "angular" || value === "solid" || value === "unknown";
}
