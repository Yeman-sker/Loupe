import {
  LOUPE_SCHEMA_VERSION,
  storage_keys,
  type Annotation,
  type AnnotationPosition,
  type FrameworkName,
  type IntentKind,
  type Locator,
  type ProjectScopeWithUrl,
  type ResolveResult,
} from "@loupe/shared";

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

export function session_marks_key(project_id: string, session_id: string): string {
  return storage_keys.session_marks(project_id, session_id);
}

export type ProjectScopeUrlInput = {
  url: string;
  session_id: string;
  title?: string;
};

export function project_scope_from_url(input: ProjectScopeUrlInput): ProjectScopeWithUrl {
  const url = new URL(input.url);
  const scope: ProjectScopeWithUrl = {
    project_id: `local_${fnv1a(url.origin).toString(36)}`,
    workspace_root_hash: `origin_${fnv1a(url.origin).toString(36)}`,
    origin: url.origin,
    route_key: `${url.pathname || "/"}${url.search}`,
    session_id: input.session_id,
    url: url.href,
  };
  if (input.title !== undefined) scope.title = input.title;
  return scope;
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
