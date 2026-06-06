import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  validate_comment,
  create_annotation,
  project_scope_from_url,
  session_marks_key,
} from "./ui/storage/lib-storage.js";
import type { AnnotationDraft } from "./ui/storage/lib-storage.js";
import type { Locator, ResolveResult } from "./ui/schema.js";

/* ------------------------------------------------------------------ *
 * lib-storage — unit tests for the UI-1 storage bridge functions.
 * These mirror the truth logic in phase2-storage.ts; failures here
 * mean the bridge has drifted from the source.
 * ------------------------------------------------------------------ */

const FAKE_LOCATOR: Locator = {
  primary: { strategy: "stable_class", selector: "button.save" },
  alternates: [],
  evidence: {
    tag: "button",
    nth_path: ":nth-child(1)",
    parent_chain: [],
  },
};

const FAKE_RESOLUTION: ResolveResult = {
  locator_status: "resolved",
  confidence: 1,
  matched_by: ["selector:css"],
  candidates_considered: 1,
};

function makeDraft(overrides: Partial<AnnotationDraft> = {}): AnnotationDraft {
  return {
    id: "test-id-1",
    project: project_scope_from_url({ url: "http://localhost:3000/settings" }),
    locator: FAKE_LOCATOR,
    resolution: FAKE_RESOLUTION,
    comment: "Fix the save button color",
    intent_kind: "style",
    context: {
      element: { tag: "button", selector_preview: "button.save" },
      viewport: { width: 1440, height: 900, dpr: 2 },
      position: { x: 100, y: 200, width: 80, height: 36 },
    },
    now: "2026-06-05T12:00:00.000Z",
    ...overrides,
  };
}

describe("UI-1 · lib-storage bridge", () => {
  describe("validate_comment", () => {
    it("trims and returns the comment when non-empty", () => {
      assert.equal(validate_comment("  fix button  "), "fix button");
    });

    it("throws for empty string", () => {
      assert.throws(() => validate_comment(""), /non-empty/);
    });

    it("throws for whitespace-only string", () => {
      assert.throws(() => validate_comment("   "), /non-empty/);
    });
  });

  describe("project_scope_from_url", () => {
    it("derives a deterministic origin-based project_id when daemon identity is absent", () => {
      const scope = project_scope_from_url({ url: "http://localhost:3000/settings" });
      assert.ok(scope.project_id.startsWith("local_"), "project_id should be origin-based local_*");
      assert.equal(scope.origin, "http://localhost:3000");
      assert.equal(scope.route_key, "/settings");
      assert.equal(scope.url, "http://localhost:3000/settings");
      assert.ok(scope.session_id.startsWith("temporary_"), "session_id should be transient for local scope");
    });

    it("sorts query parameters for canonical route_key", () => {
      const scope1 = project_scope_from_url({ url: "http://localhost:3000/page?z=1&a=2" });
      const scope2 = project_scope_from_url({ url: "http://localhost:3000/page?a=2&z=1" });
      assert.equal(scope1.route_key, scope2.route_key, "route_key is query-order-independent");
    });

    it("includes optional title when provided", () => {
      const scope = project_scope_from_url({ url: "http://localhost:3000/", title: "Dev App" });
      assert.equal(scope.title, "Dev App");
    });

    it("generates a deterministic session when daemon project identity is supplied", () => {
      const scope = project_scope_from_url({
        url: "http://localhost:3000/page",
        project_id: "proj-abc",
        workspace_root_hash: "hash-xyz",
        branch: "main",
      });
      assert.equal(scope.project_id, "proj-abc");
      assert.ok(scope.session_id.startsWith("session_"), "session_id should be deterministic for daemon scope");
    });
  });

  describe("session_marks_key", () => {
    it("returns a loupe:v1 scoped key", () => {
      const key = session_marks_key("proj-123", "session-abc");
      assert.ok(key.startsWith("loupe:v1"), "key must start with storage prefix");
      assert.ok(key.includes("proj-123"), "key includes project_id");
    });
  });

  describe("create_annotation", () => {
    it("creates a local-only, open annotation with the correct schema shape", () => {
      const ann = create_annotation(makeDraft());
      assert.equal(ann.schema_version, 1);
      assert.equal(ann.id, "test-id-1");
      assert.equal(ann.intent.comment, "Fix the save button color");
      assert.equal(ann.intent.kind, "style");
      assert.equal(ann.sync.status, "local_only");
      assert.equal(ann.sync.retry_count, 0);
      assert.equal(ann.lifecycle.task_status, "open");
      assert.equal(ann.lifecycle.created_at, "2026-06-05T12:00:00.000Z");
      assert.equal(ann.lifecycle.updated_at, "2026-06-05T12:00:00.000Z");
      assert.equal(ann.media.has_screenshot, false);
      assert.deepEqual(ann.replies.items, []);
    });

    it("defaults kind to 'other' when intent_kind is omitted", () => {
      const { intent_kind: _removed, ...draftWithoutKind } = makeDraft();
      const ann = create_annotation(draftWithoutKind);
      assert.equal(ann.intent.kind, "other");
    });

    it("carries the locator and resolution in the target", () => {
      const ann = create_annotation(makeDraft());
      assert.equal(ann.target.locator.primary.selector, "button.save");
      assert.equal(ann.target.resolution.locator_status, "resolved");
      assert.equal(ann.target.resolution.confidence, 1);
      assert.equal(ann.target.resolution.resolved_at, "2026-06-05T12:00:00.000Z");
    });

    it("trims whitespace from comment during creation", () => {
      const ann = create_annotation(makeDraft({ comment: "  fix spacing  " }));
      assert.equal(ann.intent.comment, "fix spacing");
    });

    it("throws when comment is empty", () => {
      assert.throws(() => create_annotation(makeDraft({ comment: "" })), /non-empty/);
    });

    it("stores project scope verbatim", () => {
      const project = project_scope_from_url({ url: "http://localhost:3000/" });
      const ann = create_annotation(makeDraft({ project }));
      assert.equal(ann.project.origin, "http://localhost:3000");
      assert.ok(ann.project.project_id.startsWith("local_"));
    });
  });
});
