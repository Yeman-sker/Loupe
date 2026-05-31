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
    position: LocatorGeometry;
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
    archived_at?: string;
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
