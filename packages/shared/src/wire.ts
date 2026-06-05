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
  auth_required: "AUTH_REQUIRED",
  unauthorized: "UNAUTHORIZED",
  not_found: "NOT_FOUND",
  assertion_mismatch: "ASSERTION_MISMATCH",
  conflict: "CONFLICT",
  invalid_request: "INVALID_REQUEST",
  corrupt_store: "CORRUPT_STORE",
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

export type WorkspaceRootScopeInput = {
  project_id?: never;
  workspace_root_hash: string;
  branch?: string;
  origin?: string;
  url?: string;
  route_key?: string;
  session_id?: string;
};

export type RouteScopeInput = {
  project_id?: never;
  workspace_root_hash?: never;
  url?: string;
  origin?: string;
  route_key?: string;
  branch?: string;
  session_id?: string;
};

export type ProjectScopeInput = ProjectIdScopeInput | WorkspaceRootScopeInput | RouteScopeInput;
