export const LOUPE_SCHEMA_VERSION = 1 as const;
export const LOUPE_DAEMON_NAME = "loupe" as const;
export const LOUPE_DEFAULT_PORT = 7373 as const;
export const LOUPE_AUTH_SCHEME = "Bearer" as const;
export const LOUPE_TOKEN_MIN_BYTES = 32 as const;
export const LOUPE_HOME_DIR = "~/.loupe" as const;
export const LOUPE_TOKEN_PATH = "~/.loupe/token" as const;
export const LOUPE_SERVER_STATUS_PATH = "~/.loupe/server.json" as const;
export const LOUPE_MARKS_PATH = "~/.loupe/marks.json" as const;
export const LOUPE_SERVER_LOG_PATH = "~/.loupe/server.log" as const;

export const error_codes = {
  scope_required: "SCOPE_REQUIRED",
  multi_project: "MULTI_PROJECT",
  unauthorized: "UNAUTHORIZED",
  not_found: "NOT_FOUND",
  conflict: "CONFLICT",
  invalid_request: "INVALID_REQUEST",
  internal_error: "INTERNAL_ERROR",
} as const;

export type ErrorCode = (typeof error_codes)[keyof typeof error_codes];

export type LoupeError = {
  code: ErrorCode;
  message: string;
  candidates?: ProjectScopeCandidate[];
};

export const storage_key_prefix = "loupe:v1" as const;

export const storage_keys = {
  projects_index: "loupe:v1:projects:index",
  settings: "loupe:v1:settings",
  project_sessions_index: (project_id: string): `loupe:v1:project:${string}:sessions:index` =>
    `loupe:v1:project:${project_id}:sessions:index`,
  session_marks: (project_id: string, session_id: string): `loupe:v1:project:${string}:session:${string}:marks` =>
    `loupe:v1:project:${project_id}:session:${session_id}:marks`,
  project_tombstones: (project_id: string): `loupe:v1:project:${string}:tombstones` =>
    `loupe:v1:project:${project_id}:tombstones`,
} as const;

export type ProjectScope = {
  project_id: string;
  workspace_root_hash: string;
  branch?: string;
  origin: string;
  route_key: string;
  session_id: string;
};

export type ProjectScopeWithUrl = ProjectScope & {
  url: string;
  title?: string;
};

export type ProjectScopeCandidate = Partial<ProjectScopeWithUrl> & {
  project_id: string;
};

export type ProjectIdScopeInput = {
  project_id: string;
  workspace_root_hash?: string;
  branch?: string;
  origin?: string;
  url?: string;
  route_key?: string;
  session_id?: string;
};

export type ExplicitRouteScopeInput = {
  project_id?: never;
  workspace_root_hash: string;
  url: string;
  route_key: string;
  branch?: string;
  origin?: string;
  session_id?: string;
};

export type ProjectScopeInput = ProjectIdScopeInput | ExplicitRouteScopeInput;

export type SelectorStrategy =
  | "shadow_path"
  | "stable_attr"
  | "stable_id"
  | "role_name"
  | "stable_class"
  | "text"
  | "parent_chain"
  | "nth_path"
  | "geometry";

export type FrameLocatorPathItem = {
  selector: string;
  index?: number;
  name?: string;
};

export type FrameLocatorPath = FrameLocatorPathItem[];

export type LocatorStatus = "resolved" | "drifted" | "lost";

export type BoundaryKind =
  | "cross_origin_iframe"
  | "canvas_internal_target"
  | "closed_shadow_root"
  | "svg_internal_target";

export type TargetScope = "internal_element" | "boundary_shell";

export type TargetBoundary = {
  kind: BoundaryKind;
  target_scope: TargetScope;
  internal_target_supported: boolean;
  shell_selector?: string;
  reason: string;
};

export type LocatorSelector = {
  selector: string;
  strategy: SelectorStrategy;
};

export type LocatorGeometry = {
  x: number;
  y: number;
  width: number;
  height: number;
  viewport_width: number;
  viewport_height: number;
  dpr: number;
};

export type LocatorTextEvidence = {
  normalized: string;
  hash: string;
  length: number;
};

export type LocatorClassEvidence = {
  stable: string[];
  total: number;
};

export type LocatorParentEvidence = {
  tag: string;
  role?: string;
  stable_attr?: string;
  stable_class?: string;
};

export type LocatorEvidence = {
  stable_attrs?: Record<string, string>;
  stable_id?: string;
  tag: string;
  role?: string;
  accessible_name?: string;
  classes?: LocatorClassEvidence;
  text?: LocatorTextEvidence;
  nth_path: string;
  parent_chain: LocatorParentEvidence[];
  shadow_path?: string[];
  geometry?: LocatorGeometry;
  boundary?: TargetBoundary;
};

export type Locator = {
  frame_path?: FrameLocatorPath;
  primary: LocatorSelector;
  alternates: LocatorSelector[];
  evidence: LocatorEvidence;
};

export type ResolveResult = {
  locator_status: LocatorStatus;
  confidence: number;
  matched_by: string[];
  candidates_considered: number;
  ambiguity?: {
    top_1: number;
    top_2: number;
    reason: "close_score" | "duplicate_evidence";
  };
};

export type IntentKind = "bug" | "copy" | "style" | "layout" | "question" | "other";

export type FrameworkName = "react" | "vue" | "svelte" | "angular" | "solid" | "unknown";

export type AnnotationPosition = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type Annotation = {
  schema_version: typeof LOUPE_SCHEMA_VERSION;
  id: string;
  project: ProjectScopeWithUrl;
  target: {
    locator: Locator;
    boundary?: TargetBoundary;
    resolution: {
      locator_status: LocatorStatus;
      confidence: number;
      matched_by: string[];
      resolved_at: string;
    };
  };
  intent: {
    comment: string;
    kind: IntentKind;
  };
  context: {
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
  sync: {
    status: "local_only" | "syncing" | "synced" | "failed" | "delete_pending";
    last_synced_at?: string;
    last_error?: string;
    retry_count: number;
  };
  media: {
    has_screenshot: boolean;
    screenshot_id?: string;
  };
  replies: {
    items: Array<{
      author: "user" | "agent";
      text: string;
      at: string;
    }>;
  };
  lifecycle: {
    task_status: "open" | "resolved" | "archived";
    created_at: string;
    updated_at: string;
    task_resolved_at?: string;
    deleted_at?: string;
  };
};


export type StorageEnvelope = {
  schema_version: typeof LOUPE_SCHEMA_VERSION;
  projects: Record<
    string,
    {
      sessions: Record<
        string,
        {
          marks: Annotation[];
        }
      >;
      tombstones: string[];
    }
  >;
};

export type AgentMark = {
  id: string;
  project: {
    project_id: string;
    workspace_root_hash: string;
    branch?: string;
    url: string;
    route_key: string;
    session_id: string;
  };
  intent: {
    comment: string;
    kind: IntentKind | string;
  };
  target: {
    frame_path?: FrameLocatorPath;
    shadow_path?: string[];
    boundary?: TargetBoundary;
    selector: string;
    selector_preview: string;
    tag: string;
    text?: string;
    classes?: string[];
    path?: string;
    locator_status: LocatorStatus;
    confidence: number;
    matched_by: string[];
  };
  framework?: {
    name: FrameworkName | string;
    component?: string;
    source_hint?: string;
  };
  media: {
    has_screenshot: boolean;
  };
  lifecycle: {
    task_status: "open" | "resolved" | "archived";
    created_at: string;
    updated_at: string;
  };
};

export type ListMarksRequest = ProjectScopeInput & {
  task_status?: "open" | "resolved" | "archived";
};

export type ListMarksResponse = {
  project: ProjectScopeCandidate;
  marks: AgentMark[];
};

export type GetMarkRequest = {
  id: string;
} & ProjectScopeInput;

export type ResolveMarkRequest = {
  id: string;
  resolution_note?: string;
} & ProjectScopeInput;

export type ResolveMarkResponse = {
  ok: true;
  task_status: "resolved";
};

export type DeleteMarkRequest = {
  id: string;
  reason?: string;
} & ProjectScopeInput;

export type DeleteMarkResponse = {
  ok: true;
  deleted_at: string;
};

export type HealthPayload = {
  ok: true;
  name: typeof LOUPE_DAEMON_NAME;
  version: string;
  port: number;
  requires_auth: true;
};

export type ServerStatusFile = {
  pid: number;
  port: number;
  token_path: string;
  started_at: string;
};

const known_camel_case_fields = new Set([
  "schemaVersion",
  "projectId",
  "workspaceRootHash",
  "routeKey",
  "sessionId",
  "framePath",
  "shadowPath",
  "targetScope",
  "internalTargetSupported",
  "shellSelector",
  "locatorStatus",
  "matchedBy",
  "candidatesConsidered",
  "top1",
  "top2",
  "selectorPreview",
  "hasScreenshot",
  "createdAt",
  "updatedAt",
  "resolvedAt",
  "deletedAt",
]) as ReadonlySet<string>;

const boundary_kinds: ReadonlySet<string> = new Set([
  "cross_origin_iframe",
  "canvas_internal_target",
  "closed_shadow_root",
  "svg_internal_target",
]);

const locator_statuses: ReadonlySet<string> = new Set(["resolved", "drifted", "lost"]);
const selector_strategies: ReadonlySet<string> = new Set([
  "shadow_path",
  "stable_attr",
  "stable_id",
  "role_name",
  "stable_class",
  "text",
  "parent_chain",
  "nth_path",
  "geometry",
]);
const target_scopes: ReadonlySet<string> = new Set(["internal_element", "boundary_shell"]);

function is_record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function is_string_array(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function is_number(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function has_no_known_camel_case_fields(value: unknown): boolean {
  if (Array.isArray(value)) return value.every(has_no_known_camel_case_fields);
  if (!is_record(value)) return true;

  for (const [key, child] of Object.entries(value)) {
    if (known_camel_case_fields.has(key) || !has_no_known_camel_case_fields(child)) return false;
  }
  return true;
}

function has_optional_string(record: Record<string, unknown>, key: string): boolean {
  return record[key] === undefined || typeof record[key] === "string";
}

function is_annotation_position(value: unknown): value is AnnotationPosition {
  if (!is_record(value) || !has_no_known_camel_case_fields(value)) return false;
  const keys = Object.keys(value);
  return (
    keys.length === 4 &&
    is_number(value.x) &&
    is_number(value.y) &&
    is_number(value.width) &&
    is_number(value.height)
  );
}

function is_frame_path(value: unknown): value is FrameLocatorPath {
  return (
    Array.isArray(value) &&
    value.every(
      (item) =>
        is_record(item) &&
        has_no_known_camel_case_fields(item) &&
        typeof item.selector === "string" &&
        (item.index === undefined || is_number(item.index)) &&
        has_optional_string(item, "name"),
    )
  );
}

function is_boundary(value: unknown): value is TargetBoundary {
  return (
    is_record(value) &&
    has_no_known_camel_case_fields(value) &&
    typeof value.kind === "string" &&
    boundary_kinds.has(value.kind) &&
    typeof value.target_scope === "string" &&
    target_scopes.has(value.target_scope) &&
    typeof value.internal_target_supported === "boolean" &&
    has_optional_string(value, "shell_selector") &&
    typeof value.reason === "string"
  );
}

function is_locator_selector(value: unknown): value is LocatorSelector {
  return (
    is_record(value) &&
    has_no_known_camel_case_fields(value) &&
    typeof value.selector === "string" &&
    typeof value.strategy === "string" &&
    selector_strategies.has(value.strategy)
  );
}

function is_locator_geometry(value: unknown): value is LocatorGeometry {
  return (
    is_record(value) &&
    has_no_known_camel_case_fields(value) &&
    is_number(value.x) &&
    is_number(value.y) &&
    is_number(value.width) &&
    is_number(value.height) &&
    is_number(value.viewport_width) &&
    is_number(value.viewport_height) &&
    is_number(value.dpr)
  );
}

function is_locator_evidence(value: unknown): value is LocatorEvidence {
  return (
    is_record(value) &&
    has_no_known_camel_case_fields(value) &&
    typeof value.tag === "string" &&
    typeof value.nth_path === "string" &&
    Array.isArray(value.parent_chain) &&
    value.parent_chain.every((item) => is_record(item) && typeof item.tag === "string" && has_no_known_camel_case_fields(item)) &&
    (value.shadow_path === undefined || is_string_array(value.shadow_path)) &&
    (value.geometry === undefined || is_locator_geometry(value.geometry)) &&
    (value.boundary === undefined || is_boundary(value.boundary))
  );
}

export function is_locator(value: unknown): value is Locator {
  return (
    is_record(value) &&
    value.schema_version === undefined &&
    has_no_known_camel_case_fields(value) &&
    (value.frame_path === undefined || is_frame_path(value.frame_path)) &&
    is_locator_selector(value.primary) &&
    Array.isArray(value.alternates) &&
    value.alternates.every(is_locator_selector) &&
    is_locator_evidence(value.evidence)
  );
}

export function is_resolve_result(value: unknown): value is ResolveResult {
  if (!is_record(value) || value.schema_version !== undefined || !has_no_known_camel_case_fields(value)) return false;
  if (typeof value.locator_status !== "string" || !locator_statuses.has(value.locator_status)) return false;
  if (!is_number(value.confidence) || !is_string_array(value.matched_by) || !is_number(value.candidates_considered)) {
    return false;
  }
  if (value.ambiguity === undefined) return true;
  return (
    is_record(value.ambiguity) &&
    has_no_known_camel_case_fields(value.ambiguity) &&
    is_number(value.ambiguity.top_1) &&
    is_number(value.ambiguity.top_2) &&
    (value.ambiguity.reason === "close_score" || value.ambiguity.reason === "duplicate_evidence")
  );
}

export function is_annotation(value: unknown): value is Annotation {
  if (!is_record(value) || !has_no_known_camel_case_fields(value) || value.schema_version !== LOUPE_SCHEMA_VERSION) return false;
  const project = value.project;
  const target = value.target;
  const intent = value.intent;
  const context = value.context;
  const sync = value.sync;
  const media = value.media;
  const replies = value.replies;
  const lifecycle = value.lifecycle;
  return (
    typeof value.id === "string" &&
    is_record(project) &&
    typeof project.project_id === "string" &&
    typeof project.workspace_root_hash === "string" &&
    typeof project.origin === "string" &&
    typeof project.url === "string" &&
    typeof project.route_key === "string" &&
    typeof project.session_id === "string" &&
    is_record(target) &&
    is_locator(target.locator) &&
    (target.boundary === undefined || is_boundary(target.boundary)) &&
    is_record(target.resolution) &&
    typeof target.resolution.locator_status === "string" &&
    locator_statuses.has(target.resolution.locator_status) &&
    is_number(target.resolution.confidence) &&
    is_string_array(target.resolution.matched_by) &&
    typeof target.resolution.resolved_at === "string" &&
    is_record(intent) &&
    typeof intent.comment === "string" &&
    typeof intent.kind === "string" &&
    is_record(context) &&
    is_record(context.element) &&
    typeof context.element.tag === "string" &&
    typeof context.element.selector_preview === "string" &&
    is_record(context.viewport) &&
    is_number(context.viewport.width) &&
    is_number(context.viewport.height) &&
    is_number(context.viewport.dpr) &&
    is_annotation_position(context.position) &&
    is_record(sync) &&
    typeof sync.status === "string" &&
    is_number(sync.retry_count) &&
    is_record(media) &&
    typeof media.has_screenshot === "boolean" &&
    is_record(replies) &&
    Array.isArray(replies.items) &&
    is_record(lifecycle) &&
    typeof lifecycle.task_status === "string" &&
    typeof lifecycle.created_at === "string" &&
    typeof lifecycle.updated_at === "string" &&
    has_optional_string(lifecycle, "task_resolved_at") &&
    has_optional_string(lifecycle, "deleted_at")
  );
}

export function assert_annotation(value: unknown): asserts value is Annotation {
  if (!is_annotation(value)) throw new TypeError("Expected Annotation wire contract");
}

export function is_storage_envelope(value: unknown): value is StorageEnvelope {
  if (!is_record(value) || !has_no_known_camel_case_fields(value) || value.schema_version !== LOUPE_SCHEMA_VERSION) return false;
  if (!is_record(value.projects)) return false;
  return Object.values(value.projects).every(
    (project) =>
      is_record(project) &&
      is_record(project.sessions) &&
      Object.values(project.sessions).every(
        (session) => is_record(session) && Array.isArray(session.marks) && session.marks.every(is_annotation),
      ) &&
      is_string_array(project.tombstones),
  );
}

export function assert_storage_envelope(value: unknown): asserts value is StorageEnvelope {
  if (!is_storage_envelope(value)) throw new TypeError("Expected StorageEnvelope wire contract");
}

export function is_agent_mark(value: unknown): value is AgentMark {
  if (!is_record(value) || value.schema_version !== undefined || !has_no_known_camel_case_fields(value)) return false;
  const project = value.project;
  const intent = value.intent;
  const target = value.target;
  const media = value.media;
  const lifecycle = value.lifecycle;
  return (
    typeof value.id === "string" &&
    is_record(project) &&
    typeof project.project_id === "string" &&
    typeof project.workspace_root_hash === "string" &&
    typeof project.url === "string" &&
    typeof project.route_key === "string" &&
    typeof project.session_id === "string" &&
    is_record(intent) &&
    typeof intent.comment === "string" &&
    typeof intent.kind === "string" &&
    is_record(target) &&
    (target.frame_path === undefined || is_frame_path(target.frame_path)) &&
    (target.shadow_path === undefined || is_string_array(target.shadow_path)) &&
    (target.boundary === undefined || is_boundary(target.boundary)) &&
    typeof target.selector === "string" &&
    typeof target.selector_preview === "string" &&
    typeof target.tag === "string" &&
    typeof target.locator_status === "string" &&
    locator_statuses.has(target.locator_status) &&
    is_number(target.confidence) &&
    is_string_array(target.matched_by) &&
    is_record(media) &&
    typeof media.has_screenshot === "boolean" &&
    is_record(lifecycle) &&
    typeof lifecycle.task_status === "string" &&
    typeof lifecycle.created_at === "string" &&
    typeof lifecycle.updated_at === "string"
  );
}
