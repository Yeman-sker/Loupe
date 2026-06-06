import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  LOUPE_SCHEMA_VERSION,
  error_codes,
  storage_keys,
  assert_annotation,
  assert_storage_envelope,
  is_agent_mark,
  is_annotation,
  is_locator,
  is_resolve_result,
  is_storage_envelope,
  type AgentMark,
  type Annotation,
  type BoundaryKind,
  type DeleteMarkResponse,
  type GetMarkResponse,
  type ListMarksResponse,
  type Locator,
  type ResolveMarkResponse,
  type ResolveResult,
  type StorageEnvelope,
} from "./schema.js";
import { is_anomaly_report_input } from "./anomaly.js";

describe("Loupe Phase 0 schema and storage contracts", () => {
  it("storage key helpers include global, project_id, and session_id keys", () => {
    const projectId = "project-abc";
    const sessionId = "session-def";
    assert.equal(storage_keys.projects_index, "loupe:v1:projects:index");
    assert.equal(storage_keys.settings, "loupe:v1:settings");
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
    assert.equal(annotation.lifecycle.deleted_at, undefined);
    assert.doesNotThrow(() => assert_annotation(annotation));
    assert.doesNotThrow(() => assert_storage_envelope(envelope));
    assert.equal(is_annotation(annotation), true);
    assert.equal(is_storage_envelope(envelope), true);
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

  it("Locator, ResolveResult, and AgentMark are valid without schema_version", () => {
    const locator = sampleLocator();
    const resolveResult: ResolveResult = {
      locator_status: "drifted",
      confidence: 0.51,
      matched_by: ["alternate", "text"],
      candidates_considered: 4,
      ambiguity: {
        top_1: 0.51,
        top_2: 0.5,
        reason: "close_score",
      },
    };
    const mark = sampleAgentMark(locator);

    assert.equal("schema_version" in locator, false);
    assert.equal("schema_version" in resolveResult, false);
    assert.equal("schema_version" in mark, false);
    assert.equal(is_locator(locator), true);
    assert.equal(is_resolve_result(resolveResult), true);
    assert.equal(is_agent_mark(mark), true);
    assert.equal(resolveResult.ambiguity?.top_1, 0.51);
    assert.equal(resolveResult.ambiguity?.top_2, 0.5);
  });

  it("support matrix boundary kinds are accepted", () => {
    const boundaryKinds: BoundaryKind[] = [
      "cross_origin_iframe",
      "canvas_internal_target",
      "closed_shadow_root",
      "svg_internal_target",
    ];

    for (const kind of boundaryKinds) {
      const locator = sampleLocator(kind);
      const mark = sampleAgentMark(locator);

      assert.equal(is_locator(locator), true);
      assert.equal(is_agent_mark(mark), true);
      assert.equal(locator.evidence.boundary?.kind, kind);
    }
  });

  it("locator evidence validators reject malformed optional evidence fields", () => {
    const validLocator = sampleLocator();
    const validAnnotation = sampleAnnotation();
    assert.equal(is_locator(validLocator), true);
    assert.equal(is_annotation(validAnnotation), true);

    const malformedEvidenceFields: Array<[string, unknown]> = [
      ["stable_attrs", { "data-testid": 42 }],
      ["classes", { stable: ["save", 7], total: 2 }],
      ["classes", { stable: ["save"], total: "1" }],
      ["text", { normalized: "Save", hash: "hash-save", length: "4" }],
      ["text", { normalized: "Save", hash: 123, length: 4 }],
    ];

    for (const [field, malformedValue] of malformedEvidenceFields) {
      const locator = {
        ...sampleLocator(),
        evidence: { ...sampleLocator().evidence, [field]: malformedValue },
      };
      const annotation = {
        ...sampleAnnotation(),
        target: {
          ...sampleAnnotation().target,
          locator,
        },
      };

      assert.equal(is_locator(locator), false, field);
      assert.equal(is_annotation(annotation), false, field);
    }
  });

  it("locator evidence validators reject camelCase evidence aliases even with snake_case fields present", () => {
    const aliases: Array<[string, unknown]> = [
      ["stableId", "save-button"],
      ["accessibleName", "Save"],
      ["accesssibleName", "Save"],
      ["stableAttrs", { "data-testid": "save-button" }],
      ["nthPath", "html > body > button:nth-of-type(1)"],
      ["parentChain", [{ tag: "app-shell" }]],
      ["shadowPath", ["app-shell", "settings-panel"]],
    ];

    for (const [alias, aliasValue] of aliases) {
      const locator = sampleLocatorWithStableEvidence();
      const locatorWithAlias = {
        ...locator,
        evidence: { ...locator.evidence, [alias]: aliasValue },
      };
      const annotationWithAlias = {
        ...sampleAnnotation(),
        target: {
          ...sampleAnnotation().target,
          locator: locatorWithAlias,
        },
      };

      assert.equal(is_locator(locatorWithAlias), false, alias);
      assert.equal(is_annotation(annotationWithAlias), false, alias);
    }
  });

  it("validators reject missing schema_version and known camelCase fields", () => {
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
    const resolveResult: ResolveResult = {
      locator_status: "resolved",
      confidence: 0.99,
      matched_by: ["primary"],
      candidates_considered: 1,
    };

    const annotationWithoutSchemaVersion = { ...annotation } as Record<string, unknown>;
    delete annotationWithoutSchemaVersion.schema_version;
    assert.equal(is_annotation(annotationWithoutSchemaVersion), false);
    assert.throws(() => assert_annotation(annotationWithoutSchemaVersion), /Annotation wire contract/);

    const envelopeWithoutSchemaVersion = { ...envelope } as Record<string, unknown>;
    delete envelopeWithoutSchemaVersion.schema_version;
    assert.equal(is_storage_envelope(envelopeWithoutSchemaVersion), false);
    assert.throws(() => assert_storage_envelope(envelopeWithoutSchemaVersion), /StorageEnvelope wire contract/);

    assert.equal(is_annotation({ ...annotation, schemaVersion: LOUPE_SCHEMA_VERSION }), false);
    assert.equal(is_storage_envelope({ ...envelope, schemaVersion: LOUPE_SCHEMA_VERSION }), false);
    assert.equal(is_locator({ ...sampleLocator(), locatorStatus: "resolved" }), false);
    assert.equal(is_resolve_result({ ...resolveResult, locatorStatus: resolveResult.locator_status }), false);
    assert.equal(is_agent_mark({ ...sampleAgentMark(sampleLocator()), target: { ...sampleAgentMark(sampleLocator()).target, locatorStatus: "resolved" } }), false);
  });

  it("AnomalyReportInput accepts only scoped mark storage blobs", () => {
    const valid = {
      schema_version: LOUPE_SCHEMA_VERSION,
      source: "manual",
      summary: "wrong pin",
      breadcrumbs: [],
      env: {},
      storage: { "loupe:v1:project:project-1:session:session-1:marks": [] },
    };

    assert.equal(is_anomaly_report_input(valid), true);
    assert.equal(is_anomaly_report_input({ ...valid, storage: { marks: [] } }), false);
    assert.equal(is_anomaly_report_input({ ...valid, storage: { "loupe:v1:daemon": { token: "secret" } } }), false);
  });

  it("M3 error codes export the project scope, auth, assertion, and store failures", () => {
    assert.equal(error_codes.scope_required, "SCOPE_REQUIRED");
    assert.equal(error_codes.multi_project, "MULTI_PROJECT");
    assert.equal(error_codes.not_found, "NOT_FOUND");
    assert.equal(error_codes.assertion_mismatch, "ASSERTION_MISMATCH");
    assert.equal(error_codes.auth_required, "AUTH_REQUIRED");
    assert.equal(error_codes.invalid_request, "INVALID_REQUEST");
    assert.equal(error_codes.corrupt_store, "CORRUPT_STORE");
  });

  it("M3 AgentMark responses use the low-noise shape and reject raw fields", () => {
    const mark = sampleAgentMark(sampleLocator());
    const getResponse: GetMarkResponse = mark;
    const listResponse: ListMarksResponse = {
      project: { project_id: mark.project.project_id, session_id: mark.project.session_id },
      marks: [mark],
    };

    assert.equal(is_agent_mark(getResponse), true);
    assert.equal(is_agent_mark(listResponse.marks[0]), true);

    const rawFields: Array<[string, unknown]> = [
      ["sync", { status: "failed", error_stack: "stack" }],
      ["context", { viewport: { width: 1, height: 1, dpr: 1 } }],
      ["replies", { items: [] }],
      ["token", "secret-token"],
      ["screenshot_bytes", "base64"],
    ];

    for (const [field, value] of rawFields) {
      assert.equal(is_agent_mark({ ...mark, [field]: value }), false, field);
    }

    assert.equal(is_agent_mark({ ...mark, target: { ...mark.target, layout: { display: "grid" } } }), false);
    assert.equal(is_agent_mark({ ...mark, media: { ...mark.media, screenshot_id: "shot-1" } }), false);
    assert.equal(is_agent_mark({ ...mark, lifecycle: { ...mark.lifecycle, task_resolved_at: "2026-05-31T00:00:00.000Z" } }), false);
    assert.equal(is_agent_mark({ ...mark, project: { ...mark.project, workspaceRootHash: "root-hash" } }), false);
  });

  it("M3 resolve and delete responses stay snake_case", () => {
    const resolveResponse: ResolveMarkResponse = { ok: true, task_status: "resolved" };
    const deleteResponse: DeleteMarkResponse = { ok: true, deleted_at: "2026-05-31T00:00:00.000Z" };

    assert.deepEqual(Object.keys(resolveResponse), ["ok", "task_status"]);
    assert.deepEqual(Object.keys(deleteResponse), ["ok", "deleted_at"]);
    assert.equal("taskStatus" in resolveResponse, false);
    assert.equal("deletedAt" in deleteResponse, false);
  });

  it("M3 StorageEnvelope tombstones are scoped per project", () => {
    const annotation = sampleAnnotation();
    const otherProjectAnnotation: Annotation = {
      ...annotation,
      id: "annotation-2",
      project: {
        ...annotation.project,
        project_id: "project-other",
        session_id: "session-other",
      },
    };
    const envelope: StorageEnvelope = {
      schema_version: LOUPE_SCHEMA_VERSION,
      projects: {
        [annotation.project.project_id]: {
          sessions: { [annotation.project.session_id]: { marks: [annotation] } },
          tombstones: ["deleted-in-project-abc"],
        },
        [otherProjectAnnotation.project.project_id]: {
          sessions: { [otherProjectAnnotation.project.session_id]: { marks: [otherProjectAnnotation] } },
          tombstones: ["deleted-in-project-other"],
        },
      },
    };

    assert.equal(is_storage_envelope(envelope), true);
    assert.deepEqual(envelope.projects[annotation.project.project_id]?.tombstones, ["deleted-in-project-abc"]);
    assert.deepEqual(envelope.projects[otherProjectAnnotation.project.project_id]?.tombstones, ["deleted-in-project-other"]);
    const scopedProject = envelope.projects[annotation.project.project_id];
    if (scopedProject === undefined) throw new Error("Expected scoped project");
    assert.equal(is_storage_envelope({ ...envelope, tombstones: ["global-delete"] }), false);
    assert.equal(
      is_storage_envelope({
        ...envelope,
        projects: {
          ...envelope.projects,
          [annotation.project.project_id]: {
            ...scopedProject,
            tombstones: undefined,
          },
        },
      }),
      false,
    );
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
      position: { x: 10, y: 20, width: 80, height: 32 },
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

function sampleLocator(boundaryKind: BoundaryKind = "closed_shadow_root"): Locator {
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
        kind: boundaryKind,
        target_scope: "boundary_shell",
        internal_target_supported: false,
        shell_selector: "settings-panel",
        reason: "Closed shadow root requires marking the host shell.",
      },
    },
  };
}

function sampleAgentMark(locator: Locator): AgentMark {
  return {
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
}

function sampleLocatorWithStableEvidence(): Locator {
  const locator = sampleLocator();
  return {
    ...locator,
    evidence: {
      ...locator.evidence,
      stable_id: "save-button",
      stable_attrs: { "data-testid": "save-button" },
      accessible_name: "Save",
    },
  };
}
