import type { Annotation, AnnotationContextDraft, ProjectEntry } from "./lib-storage.js";
import type { PinRecord } from "./surface-pin.js";
export type { ProjectEntry } from "./lib-storage.js";

export function annotationToPinRecord(ann: Annotation, num: number, doc: Document): PinRecord {
  const syncStatus = ann.sync.status;
  const sync: PinRecord["sync"] = syncStatus === "synced"
    ? "synced"
    : syncStatus === "syncing" || syncStatus === "delete_pending"
      ? "syncing"
      : syncStatus === "failed"
        ? "failed"
        : "local";

  const locatorStatus = ann.target.resolution.locator_status;
  const loc: PinRecord["loc"] = locatorStatus === "lost"
    ? "lost"
    : locatorStatus === "drifted"
      ? "drifted"
      : "located";

  const pos = ann.context.position;
  const rect: DOMRect = {
    left: pos.x, top: pos.y, right: pos.x + pos.width, bottom: pos.y + pos.height,
    width: pos.width, height: pos.height, x: pos.x, y: pos.y, toJSON: () => ({}),
  };

  // Try to find the element live; fall back to a minimal stub
  let element: Element;
  try {
    const found = doc.querySelector(ann.context.element.selector_preview);
    element = found ?? stubElement(ann, doc);
  } catch {
    element = stubElement(ann, doc);
  }

  return {
    id: ann.id,
    num,
    element,
    rect,
    kind: ann.intent.kind,
    comment: ann.intent.comment,
    task: ann.lifecycle.task_status === "resolved" ? "done" : "open",
    loc,
    confidence: ann.target.resolution.confidence,
    sync,
  };
}

function stubElement(ann: Annotation, doc: Document): Element {
  const el = doc.createElement(ann.context.element.tag || "div");
  if (ann.context.element.id) el.id = ann.context.element.id;
  for (const cls of ann.context.element.classes ?? []) el.classList.add(cls);
  return el;
}

export function rawToProjectEntry(raw: unknown): ProjectEntry | null {
  if (typeof raw !== "object" || raw === null) return null;
  const r = raw as Record<string, unknown>;
  const id = typeof r.project_id === "string" ? r.project_id : typeof r.id === "string" ? r.id : null;
  if (id === null) return null;
  const entry: ProjectEntry = {
    id,
    name: typeof r.name === "string" ? r.name : id,
    path: typeof r.path === "string" ? r.path : typeof r.workspace_root_hash === "string" ? r.workspace_root_hash : "",
  };
  if (typeof r.workspace_root_hash === "string") entry.workspace_root_hash = r.workspace_root_hash;
  if (typeof r.branch === "string") entry.branch = r.branch;
  return entry;
}

export function buildContext(element: Element, doc: Document): AnnotationContextDraft {
  const view = doc.defaultView;
  const rect = element.getBoundingClientRect();
  const tag = element.tagName.toLowerCase();
  const classes = Array.from(element.classList).slice(0, 10);
  const rawText = element.textContent?.trim().slice(0, 120);
  const role = element.getAttribute("role");
  const ariaLabel = element.getAttribute("aria-label");

  const elCtx: AnnotationContextDraft["element"] = {
    tag,
    selector_preview: selectorPreview(element),
  };
  if (element.id.length > 0) elCtx.id = element.id;
  if (role !== null) elCtx.role = role;
  if (ariaLabel !== null) elCtx.accessible_name = ariaLabel;
  if (classes.length > 0) elCtx.classes = classes;
  if (rawText !== undefined && rawText.length > 0) elCtx.text = rawText;

  const a11y: NonNullable<AnnotationContextDraft["a11y"]> = {};
  if (role !== null) a11y.role = role;
  if (ariaLabel !== null) a11y.label = ariaLabel;

  return {
    element: elCtx,
    ...(Object.keys(a11y).length > 0 ? { a11y } : {}),
    viewport: {
      width: view?.innerWidth ?? 0,
      height: view?.innerHeight ?? 0,
      dpr: view?.devicePixelRatio ?? 1,
    },
    position: {
      x: Math.round(rect.left),
      y: Math.round(rect.top),
      width: Math.round(rect.width),
      height: Math.round(rect.height),
    },
  };
}

function selectorPreview(element: Element): string {
  const tag = element.tagName.toLowerCase();
  if (element.id.length > 0) return `${tag}#${element.id}`;
  const cls = Array.from(element.classList)
    .filter((c) => c.length < 32)
    .slice(0, 2)
    .join(".");
  return cls.length > 0 ? `${tag}.${cls}` : tag;
}
