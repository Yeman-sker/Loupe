import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { LOUPE_SCHEMA_VERSION, storage_keys, assert_annotation, type Annotation, type Locator, type ResolveResult } from "@loupe/shared";
import {
  copy_markdown,
  create_annotation,
  delete_annotation,
  project_scope_from_url,
  resolve_annotation,
  session_marks_key,
  validate_comment,
  type MarkStore,
} from "./phase2-storage.js";

describe("Phase 2 storage and annotation helpers", () => {
  it("uses project/session scoped storage keys, not a global marks key", () => {
    const project_a_key = session_marks_key("project-a", "session-1");
    const project_b_key = session_marks_key("project-b", "session-1");

    assert.equal(project_a_key, storage_keys.session_marks("project-a", "session-1"));
    assert.equal(project_a_key, "loupe:v1:project:project-a:session:session-1:marks");
    assert.equal(project_b_key, "loupe:v1:project:project-b:session:session-1:marks");
    assert.notEqual(project_a_key, project_b_key);
    assert.notEqual(project_a_key, "loupe:v1:marks");
  });

  it("derives project scope from origin and route scope from path plus query", () => {
    const route_a = project_scope_from_url({
      url: "https://app.example.test/dashboard?tab=home#settings",
      session_id: SESSION_ID,
      title: "Dashboard",
    });
    const route_b = project_scope_from_url({
      url: "https://app.example.test/settings?tab=profile",
      session_id: SESSION_ID,
    });
    const query_variant = project_scope_from_url({
      url: "https://app.example.test/dashboard?tab=a",
      session_id: SESSION_ID,
    });

    assert.equal(route_a.project_id, route_b.project_id);
    assert.equal(route_a.workspace_root_hash, route_b.workspace_root_hash);
    assert.equal(route_a.origin, "https://app.example.test");
    assert.equal(route_a.route_key, "/dashboard?tab=home");
    assert.equal(query_variant.route_key, "/dashboard?tab=a");
    assert.notEqual(route_a.route_key, query_variant.route_key);
    assert.equal(route_a.url, "https://app.example.test/dashboard?tab=home#settings");
    assert.equal(route_a.title, "Dashboard");
  });

  it("creates a PRD-shaped local-only annotation with required defaults", () => {
    const mark = sample_annotation({ id: "mark-new", comment: "  Fix the button label  " });

    assert.doesNotThrow(() => assert_annotation(mark));
    assert.equal(mark.schema_version, LOUPE_SCHEMA_VERSION);
    assert.deepEqual(mark.project, sample_project());
    assert.deepEqual(mark.target.locator, sample_locator());
    assert.deepEqual(mark.target.resolution, {
      locator_status: "resolved",
      confidence: 0.93,
      matched_by: ["primary"],
      resolved_at: NOW,
    });
    assert.deepEqual(mark.intent, { comment: "Fix the button label", kind: "other" });
    assert.deepEqual(mark.context.element, {
      tag: "button",
      id: "save-button",
      role: "button",
      accessible_name: "Save changes",
      classes: ["btn", "primary"],
      text: "Save",
      selector_preview: "button#save-button",
    });
    assert.deepEqual(mark.context.a11y, {
      role: "button",
      label: "Save changes",
      described_by: "save-help",
      tab_index: 0,
      expanded: false,
    });
    assert.deepEqual(mark.context.layout, {
      display: "inline-flex",
      position: "relative",
      box_sizing: "border-box",
      flex_direction: "row",
      gap: "4px",
    });
    assert.deepEqual(mark.context.framework, {
      name: "react",
      component: "SaveButton",
      source_hint: { file: "src/SaveButton.tsx", line: 42, confidence: 0.8 },
    });
    assert.deepEqual(mark.context.viewport, { width: 1440, height: 900, dpr: 2 });
    assert.deepEqual(mark.context.position, { x: 10, y: 20, width: 120, height: 32 });
    assert.deepEqual(mark.sync, { status: "local_only", retry_count: 0 });
    assert.deepEqual(mark.media, { has_screenshot: false });
    assert.deepEqual(mark.replies, { items: [] });
    assert.deepEqual(mark.lifecycle, { task_status: "open", created_at: NOW, updated_at: NOW });
  });

  it("resolve action marks the task resolved without deleting locator status", () => {
    const mark = sample_annotation({ id: "mark-resolve" });
    const resolved = resolve_annotation(mark, RESOLVED_AT);

    assert.equal(resolved.lifecycle.task_status, "resolved");
    assert.equal(resolved.lifecycle.task_resolved_at, RESOLVED_AT);
    assert.equal(resolved.lifecycle.updated_at, RESOLVED_AT);
    assert.equal(resolved.target.resolution.locator_status, "resolved");
    assert.equal(resolved.target.resolution.confidence, mark.target.resolution.confidence);
    assert.deepEqual(resolved.target.locator, mark.target.locator);
  });

  it("delete action writes a project tombstone and removes the mark from active session storage", async () => {
    const removed = sample_annotation({ id: "mark-delete" });
    const kept = sample_annotation({ id: "mark-keep" });
    const marks_key = session_marks_key(PROJECT_ID, SESSION_ID);
    const tombstones_key = storage_keys.project_tombstones(PROJECT_ID);
    const store = new MemoryStore({
      [marks_key]: [removed, kept],
      [tombstones_key]: ["older"],
    });

    await delete_annotation(store, PROJECT_ID, SESSION_ID, removed.id);

    assert.deepEqual(store.data.get(marks_key), [kept]);
    assert.deepEqual(store.data.get(tombstones_key), ["older", removed.id]);
    await delete_annotation(store, PROJECT_ID, SESSION_ID, removed.id);

    assert.deepEqual(store.data.get(marks_key), [kept]);
    assert.deepEqual(store.data.get(tombstones_key), ["older", removed.id]);
    assert.equal(store.data.has("loupe:v1:marks"), false);
  });

  it("copies markdown for open marks in the current session and route by default", () => {
    const current_open = sample_annotation({ id: "mark-open", comment: "Current route note", selector_preview: "button.save" });
    const current_resolved = resolve_annotation(sample_annotation({ id: "mark-resolved", comment: "Done note" }), RESOLVED_AT);
    const other_route = sample_annotation({ id: "mark-other-route", route_key: "/settings", comment: "Wrong route" });
    const other_session = sample_annotation({ id: "mark-other-session", session_id: "session-other", comment: "Wrong session" });
    const other_project = sample_annotation({ id: "mark-other-project", project_id: "project-other", comment: "Wrong project" });

    const markdown = copy_markdown([current_open, current_resolved, other_route, other_session, other_project], {
      project_id: PROJECT_ID,
      session_id: SESSION_ID,
      route_key: ROUTE_KEY,
    });

    assert.match(markdown, /id: mark-open/);
    assert.match(markdown, /selector: button\.save/);
    assert.match(markdown, /comment: Current route note/);
    assert.match(markdown, /locator: resolved \(0\.93\)/);
    assert.match(markdown, /sync: local_only/);
    assert.doesNotMatch(markdown, /mark-resolved|mark-other-route|mark-other-session|mark-other-project/);
  });

  it("rejects empty or whitespace-only comments", () => {
    assert.throws(() => validate_comment(""), /non-empty comment/);
    assert.throws(() => validate_comment(" \n\t "), /non-empty comment/);
    assert.throws(() => sample_annotation({ id: "bad-comment", comment: "   " }), /non-empty comment/);
    assert.equal(validate_comment("  keep me  "), "keep me");
  });
});

const PROJECT_ID = "project-abc";
const SESSION_ID = "session-def";
const ROUTE_KEY = "/dashboard";
const NOW = "2026-05-31T12:00:00.000Z";
const RESOLVED_AT = "2026-05-31T12:10:00.000Z";

function sample_annotation(overrides: { id: string; comment?: string; project_id?: string; session_id?: string; route_key?: string; selector_preview?: string }): Annotation {
  return create_annotation({
    id: overrides.id,
    project: sample_project(overrides),
    locator: sample_locator(),
    resolution: sample_resolution(),
    comment: overrides.comment ?? "Needs review",
    context: sample_context(overrides.selector_preview),
    now: NOW,
  });
}

function sample_project(overrides: { project_id?: string; session_id?: string; route_key?: string } = {}) {
  return {
    project_id: overrides.project_id ?? PROJECT_ID,
    workspace_root_hash: "workspace-root-hash",
    origin: "https://app.example.test",
    url: "https://app.example.test/dashboard?tab=home",
    route_key: overrides.route_key ?? ROUTE_KEY,
    session_id: overrides.session_id ?? SESSION_ID,
  };
}

function sample_context(selector_preview = "button#save-button") {
  return {
    element: {
      tag: "button",
      id: "save-button",
      role: "button",
      accessible_name: "Save changes",
      classes: ["btn", "primary"],
      text: "Save",
      selector_preview,
    },
    a11y: {
      role: "button",
      label: "Save changes",
      described_by: "save-help",
      tab_index: 0,
      expanded: false,
    },
    layout: {
      display: "inline-flex",
      position: "relative",
      box_sizing: "border-box",
      flex_direction: "row",
      gap: "4px",
    },
    framework: {
      name: "react" as const,
      component: "SaveButton",
      source_hint: { file: "src/SaveButton.tsx", line: 42, confidence: 0.8 },
    },
    viewport: { width: 1440, height: 900, dpr: 2 },
    position: { x: 10, y: 20, width: 120, height: 32 },
  };
}

function sample_resolution(): ResolveResult {
  return {
    locator_status: "resolved",
    confidence: 0.93,
    matched_by: ["primary"],
    candidates_considered: 1,
  };
}

function sample_locator(): Locator {
  return {
    primary: { selector: "button#save-button", strategy: "stable_id" },
    alternates: [{ selector: "button[data-testid=save]", strategy: "stable_attr" }],
    evidence: {
      tag: "button",
      stable_id: "save-button",
      stable_attrs: { "data-testid": "save" },
      role: "button",
      accessible_name: "Save changes",
      text: { normalized: "Save", hash: "hash-save", length: 4 },
      classes: { stable: ["btn", "primary"], total: 2 },
      nth_path: "html > body > form > button:nth-of-type(1)",
      shadow_path: ["loupe-card", "button#save-button"],
      geometry: { x: 10, y: 20, width: 120, height: 32, viewport_width: 1440, viewport_height: 900, dpr: 2 },
      parent_chain: [{ tag: "form", stable_attr: "id=settings" }],
    },
  };
}

class MemoryStore implements MarkStore {
  readonly data = new Map<string, unknown>();

  constructor(items: Record<string, unknown>) {
    for (const [key, value] of Object.entries(items)) this.data.set(key, value);
  }

  async get(key: string): Promise<unknown> {
    return this.data.get(key);
  }

  async set(items: Record<string, unknown>): Promise<void> {
    for (const [key, value] of Object.entries(items)) this.data.set(key, value);
  }
}
