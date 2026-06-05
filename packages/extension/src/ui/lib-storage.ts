// Storage bridge for dist/ui — re-implements the subset of phase2-storage.ts
// functions needed by UI-1. Imports types from "./schema.js" (relative) so the
// browser module graph stays free of bare specifiers. The algorithmic helpers
// (fnv1a, route_key_from_url, transient_session_id) are copied verbatim from
// phase2-storage.ts; all schema types are imported from ./schema.js.
//
// Source of truth for the exported functions: packages/extension/src/phase2-storage.ts
// Source of truth for types: packages/shared/src/schema.ts (via ./schema.js)

import {
  storage_keys,
  LOUPE_SCHEMA_VERSION,
  type Annotation,
  type AnnotationPosition,
  type IntentKind,
  type Locator,
  type ProjectScopeWithUrl,
  type ResolveResult,
} from "./schema.js";

export type { IntentKind } from "./schema.js";

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
  viewport: {
    width: number;
    height: number;
    dpr: number;
  };
  position: AnnotationPosition;
};

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

export type ProjectScopeUrlInput = {
  url: string;
  title?: string;
  project_id?: string;
  workspace_root_hash?: string;
  branch?: string;
};

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

export function session_marks_key(project_id: string, session_id: string): string {
  return storage_keys.session_marks(project_id, session_id);
}

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
    session_id: has_daemon_project
      ? deterministic_session_id(project_id, input.branch, route_key)
      : transient_session_id(url.origin, route_key),
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
