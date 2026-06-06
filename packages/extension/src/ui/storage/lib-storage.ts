// Storage bridge for dist/ui — re-implements the subset of phase2-storage.ts
// functions needed by UI-1. Imports types from "../schema.js" (relative) so the
// browser module graph stays free of bare specifiers. The algorithmic helpers
// (fnv1a, route_key_from_url, transient_session_id) are copied verbatim from
// phase2-storage.ts; all schema types are imported from ./schema.js.
//
// Source of truth for the exported functions: packages/extension/src/phase2-storage.ts
// Source of truth for types: packages/shared/src/schema.ts (via ./schema.js)

import {
  storage_keys,
  LOUPE_SCHEMA_VERSION,
  LOUPE_DEFAULT_PORT,
  type Annotation,
  type AnnotationPosition,
  type IntentKind,
  type Locator,
  type ProjectScopeWithUrl,
  type ResolveResult,
} from "../schema.js";

export { storage_keys } from "../schema.js";

export type { Annotation } from "../schema.js";

export type { IntentKind } from "../schema.js";

export type ProjectEntry = {
  id: string;
  name: string;
  path: string;
  workspace_root_hash?: string;
  branch?: string;
};

// Daemon lives on a fixed loopback port (local-first). The extension `baseUrl`
// (chrome.runtime.getURL("")) points at extension assets, NOT the daemon, so the
// health probe must target the loopback origin directly.
export const LOUPE_DAEMON_BASE_URL = `http://127.0.0.1:${LOUPE_DEFAULT_PORT}` as const;

export async function probe_daemon_health(base_url: string = LOUPE_DAEMON_BASE_URL): Promise<boolean> {
  try {
    const response = await fetch(`${base_url}/health`);
    if (!response.ok) return false;
    const payload = (await response.json()) as { ok?: boolean };
    return payload.ok === true;
  } catch {
    return false;
  }
}

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

export type MarkStore = {
  get: (key: string) => Promise<unknown>;
  set: (items: Record<string, unknown>) => Promise<void>;
};

export type SessionRoute = {
  project_id: string;
  session_id: string;
  route_key?: string;
};

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

export async function delete_annotation(
  store: MarkStore,
  project_id: string,
  session_id: string,
  mark_id: string,
): Promise<void> {
  const marks_key = session_marks_key(project_id, session_id);
  const tombstones_key = storage_keys.project_tombstones(project_id);
  const active = readArr(await store.get(marks_key));
  const tombstones = readStrArr(await store.get(tombstones_key));
  await store.set({
    [marks_key]: active.filter((m) => m.id !== mark_id),
    [tombstones_key]: tombstones.includes(mark_id) ? tombstones : [...tombstones, mark_id],
  });
}

export function copy_markdown(marks: readonly Annotation[], route: SessionRoute): string {
  return marks
    .filter(
      (m) =>
        m.project.project_id === route.project_id &&
        m.project.session_id === route.session_id &&
        (route.route_key === undefined || m.project.route_key === route.route_key) &&
        m.lifecycle.task_status === "open",
    )
    .map((m) =>
      [
        `- id: ${m.id}`,
        `  selector: ${m.context.element.selector_preview}`,
        `  comment: ${m.intent.comment}`,
        `  locator: ${m.target.resolution.locator_status} (${m.target.resolution.confidence})`,
        `  sync: ${m.sync.status}`,
      ].join("\n"),
    )
    .join("\n\n");
}

function readArr(value: unknown): Annotation[] {
  return Array.isArray(value) ? (value as Annotation[]) : [];
}

function readStrArr(value: unknown): string[] {
  return Array.isArray(value) && value.every((x) => typeof x === "string") ? value : [];
}

function fnv1a(text: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}
