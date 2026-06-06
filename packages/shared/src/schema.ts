import { LOUPE_DAEMON_NAME, LOUPE_SCHEMA_VERSION, type ProjectScopeCandidate, type ProjectScopeInput, type ProjectScopeWithUrl } from "./wire.js";
import { has_no_known_camel_case_fields, has_only_keys, has_optional_string, is_number, is_record, is_string_array } from "./wire-guards.js";
import { is_boundary, is_frame_path, is_locator, is_locator_status, type FrameLocatorPath, type Locator, type LocatorStatus, type TargetBoundary } from "./locator.js";

export * from "./wire.js";
export * from "./locator.js";

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

export type GetMarkResponse = AgentMark;

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
  home_hash?: string;
  workspace_root_hash?: string;
  project_id?: string;
  workspace_root?: string;
  project_name?: string;
  branch?: string;
};

export type ServerStatusFile = {
  pid: number;
  port: number;
  token_path: string;
  started_at: string;
};

function is_task_status(value: unknown): value is Annotation["lifecycle"]["task_status"] {
  return value === "open" || value === "resolved" || value === "archived";
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
    is_locator_status(target.resolution.locator_status) &&
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

const storage_envelope_keys: ReadonlySet<string> = new Set(["schema_version", "projects"]);
const storage_project_keys: ReadonlySet<string> = new Set(["sessions", "tombstones"]);
const storage_session_keys: ReadonlySet<string> = new Set(["marks"]);

export function is_storage_envelope(value: unknown): value is StorageEnvelope {
  if (
    !is_record(value) ||
    !has_no_known_camel_case_fields(value) ||
    !has_only_keys(value, storage_envelope_keys) ||
    value.schema_version !== LOUPE_SCHEMA_VERSION
  ) {
    return false;
  }
  if (!is_record(value.projects)) return false;
  return Object.values(value.projects).every(
    (project) =>
      is_record(project) &&
      has_only_keys(project, storage_project_keys) &&
      is_record(project.sessions) &&
      Object.values(project.sessions).every(
        (session) =>
          is_record(session) &&
          has_only_keys(session, storage_session_keys) &&
          Array.isArray(session.marks) &&
          session.marks.every(is_annotation),
      ) &&
      is_string_array(project.tombstones),
  );
}

export function assert_storage_envelope(value: unknown): asserts value is StorageEnvelope {
  if (!is_storage_envelope(value)) throw new TypeError("Expected StorageEnvelope wire contract");
}

const agent_mark_keys: ReadonlySet<string> = new Set(["id", "project", "intent", "target", "framework", "media", "lifecycle"]);
const agent_project_keys: ReadonlySet<string> = new Set([
  "project_id",
  "workspace_root_hash",
  "branch",
  "url",
  "route_key",
  "session_id",
]);
const agent_intent_keys: ReadonlySet<string> = new Set(["comment", "kind"]);
const agent_target_keys: ReadonlySet<string> = new Set([
  "frame_path",
  "shadow_path",
  "boundary",
  "selector",
  "selector_preview",
  "tag",
  "text",
  "classes",
  "path",
  "locator_status",
  "confidence",
  "matched_by",
]);
const agent_framework_keys: ReadonlySet<string> = new Set(["name", "component", "source_hint"]);
const agent_media_keys: ReadonlySet<string> = new Set(["has_screenshot"]);
const agent_lifecycle_keys: ReadonlySet<string> = new Set(["task_status", "created_at", "updated_at"]);

export function is_agent_mark(value: unknown): value is AgentMark {
  if (!is_record(value) || value.schema_version !== undefined || !has_no_known_camel_case_fields(value)) return false;
  const project = value.project;
  const intent = value.intent;
  const target = value.target;
  const media = value.media;
  const lifecycle = value.lifecycle;
  return (
    has_only_keys(value, agent_mark_keys) &&
    typeof value.id === "string" &&
    is_record(project) &&
    has_only_keys(project, agent_project_keys) &&
    typeof project.project_id === "string" &&
    typeof project.workspace_root_hash === "string" &&
    has_optional_string(project, "branch") &&
    typeof project.url === "string" &&
    typeof project.route_key === "string" &&
    typeof project.session_id === "string" &&
    is_record(intent) &&
    has_only_keys(intent, agent_intent_keys) &&
    typeof intent.comment === "string" &&
    typeof intent.kind === "string" &&
    is_record(target) &&
    has_only_keys(target, agent_target_keys) &&
    (target.frame_path === undefined || is_frame_path(target.frame_path)) &&
    (target.shadow_path === undefined || is_string_array(target.shadow_path)) &&
    (target.boundary === undefined || is_boundary(target.boundary)) &&
    typeof target.selector === "string" &&
    typeof target.selector_preview === "string" &&
    typeof target.tag === "string" &&
    has_optional_string(target, "text") &&
    (target.classes === undefined || is_string_array(target.classes)) &&
    has_optional_string(target, "path") &&
    typeof target.locator_status === "string" &&
    is_locator_status(target.locator_status) &&
    is_number(target.confidence) &&
    is_string_array(target.matched_by) &&
    (value.framework === undefined ||
      (is_record(value.framework) &&
        has_only_keys(value.framework, agent_framework_keys) &&
        typeof value.framework.name === "string" &&
        has_optional_string(value.framework, "component") &&
        has_optional_string(value.framework, "source_hint"))) &&
    is_record(media) &&
    has_only_keys(media, agent_media_keys) &&
    typeof media.has_screenshot === "boolean" &&
    is_record(lifecycle) &&
    has_only_keys(lifecycle, agent_lifecycle_keys) &&
    is_task_status(lifecycle.task_status) &&
    typeof lifecycle.created_at === "string" &&
    typeof lifecycle.updated_at === "string"
  );
}
