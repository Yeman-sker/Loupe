import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  LOUPE_SCHEMA_VERSION,
  storage_keys,
  type AgentMark,
  type Annotation,
  type Locator,
  type StorageEnvelope,
} from "./schema.js";

describe("Loupe Phase 0 schema and storage contracts", () => {
  it("storage key helpers include project_id and session_id", () => {
    const projectId = "project-abc";
    const sessionId = "session-def";
    assert.equal(storage_keys.project_sessions_index(projectId), "loupe:v1:project:project-abc:sessions:index");
    assert.equal(storage_keys.session_marks(projectId, sessionId), "loupe:v1:project:project-abc:session:session-def:marks");
    assert.equal(storage_keys.project_tombstones(projectId), "loupe:v1:project:project-abc:tombstones");
  });

  it("Annotation and StorageEnvelope carry the schema version contract", () => {
    const annotation = sampleAnnotation();
    const envelope: StorageEnvelope = {
      schema_version: LOUPE_SCHEMA_VERSION,
      projects: {
        [annotation.project.project_id]: {
          sessions: {
            [annotation.project.session_id]: { marks: [annotation] },
          },
          tombstones: [],
        },
      },
    };

    assert.equal(annotation.schema_version, LOUPE_SCHEMA_VERSION);
    assert.equal(envelope.schema_version, LOUPE_SCHEMA_VERSION);
    assert.equal(envelope.projects[annotation.project.project_id]?.sessions[annotation.project.session_id]?.marks[0]?.id, annotation.id);
  });

  it("Locator and AgentMark support frame_path, shadow_path, and boundary fields", () => {
    const locator: Locator = sampleLocator();
    const mark: AgentMark = {
      id: "mark-1",
      project: {
        project_id: "project-abc",
        workspace_root_hash: "root-hash",
        url: "https://example.test/page",
        route_key: "/page",
        session_id: "session-def",
      },
      intent: { comment: "Inspect nested target", kind: "question" },
      target: {
        ...(locator.frame_path === undefined ? {} : { frame_path: locator.frame_path }),
        ...(locator.evidence.shadow_path === undefined ? {} : { shadow_path: locator.evidence.shadow_path }),
        ...(locator.evidence.boundary === undefined ? {} : { boundary: locator.evidence.boundary }),
        selector: locator.primary.selector,
        selector_preview: "button.save",
        tag: "button",
        text: "Save",
        classes: ["save"],
        locator_status: "resolved",
        confidence: 0.99,
        matched_by: ["primary"],
      },
      media: { has_screenshot: false },
      lifecycle: {
        task_status: "open",
        created_at: "2026-05-31T00:00:00.000Z",
        updated_at: "2026-05-31T00:00:00.000Z",
      },
    };

    assert.deepEqual(locator.frame_path, [{ selector: "iframe[name=app]", index: 0, name: "app" }]);
    assert.deepEqual(locator.evidence.shadow_path, ["app-shell", "settings-panel"]);
    assert.equal(locator.evidence.boundary?.kind, "closed_shadow_root");
    assert.deepEqual(mark.target.frame_path, locator.frame_path);
    assert.deepEqual(mark.target.shadow_path, locator.evidence.shadow_path);
    assert.equal(mark.target.boundary?.target_scope, "boundary_shell");
  });
});

function sampleAnnotation(): Annotation {
  const locator = sampleLocator();
  return {
    schema_version: LOUPE_SCHEMA_VERSION,
    id: "annotation-1",
    project: {
      project_id: "project-abc",
      workspace_root_hash: "root-hash",
      origin: "https://example.test",
      url: "https://example.test/page",
      route_key: "/page",
      session_id: "session-def",
    },
    target: {
      locator,
      ...(locator.evidence.boundary === undefined ? {} : { boundary: locator.evidence.boundary }),
      resolution: {
        locator_status: "resolved",
        confidence: 0.99,
        matched_by: ["primary"],
        resolved_at: "2026-05-31T00:00:00.000Z",
      },
    },
    intent: { comment: "Inspect nested target", kind: "question" },
    context: {
      element: { tag: "button", classes: ["save"], text: "Save", selector_preview: "button.save" },
      viewport: { width: 1280, height: 720, dpr: 2 },
      position: { x: 10, y: 20, width: 80, height: 32, viewport_width: 1280, viewport_height: 720, dpr: 2 },
    },
    sync: { status: "local_only", retry_count: 0 },
    media: { has_screenshot: false },
    replies: { items: [] },
    lifecycle: {
      task_status: "open",
      created_at: "2026-05-31T00:00:00.000Z",
      updated_at: "2026-05-31T00:00:00.000Z",
    },
  };
}

function sampleLocator(): Locator {
  return {
    frame_path: [{ selector: "iframe[name=app]", index: 0, name: "app" }],
    primary: { selector: "button.save", strategy: "stable_class" },
    alternates: [{ selector: "button:nth-of-type(1)", strategy: "nth_path" }],
    evidence: {
      tag: "button",
      accessible_name: "Save",
      classes: { stable: ["save"], total: 1 },
      text: { normalized: "Save", hash: "hash-save", length: 4 },
      nth_path: "html > body > app-shell > button:nth-of-type(1)",
      parent_chain: [{ tag: "app-shell" }],
      shadow_path: ["app-shell", "settings-panel"],
      geometry: { x: 10, y: 20, width: 80, height: 32, viewport_width: 1280, viewport_height: 720, dpr: 2 },
      boundary: {
        kind: "closed_shadow_root",
        target_scope: "boundary_shell",
        internal_target_supported: false,
        shell_selector: "settings-panel",
        reason: "Closed shadow root requires marking the host shell.",
      },
    },
  };
}
