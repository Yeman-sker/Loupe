import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { LOUPE_SCHEMA_VERSION, type Annotation, type Locator, type ResolveResult } from "@loupe-server/shared";
import { build_pin_detail_view_model } from "./pin-detail.js";

const PROJECT_ID = "project-abc";
const SESSION_ID = "session-def";
const ROUTE_KEY = "/dashboard";
const NOW = "2026-05-31T12:00:00.000Z";
const RESOLVED_AT = "2026-05-31T12:10:00.000Z";

describe("pin detail view model", () => {
  it("covers PRD pin detail fields for an open synced mark", () => {
    const mark = sample_annotation({ id: "mark-open", sync_status: "synced", last_synced_at: RESOLVED_AT });

    const view_model = build_pin_detail_view_model(mark, 2);

    assert.equal(view_model.id, "mark-open");
    assert.equal(view_model.display_number, "3");
    assert.deepEqual(view_model.task_status, {
      state: "open",
      label: "Open task",
      icon: "circle",
      tone: "warning",
      class_name: "pin-detail__status--task-open",
    });
    assert.deepEqual(view_model.locator_status, {
      state: "resolved",
      label: "Locator resolved",
      icon: "target",
      tone: "success",
      class_name: "pin-detail__status--locator-resolved",
    });
    assert.equal(view_model.confidence_text, "93% confidence");
    assert.equal(view_model.comment, "Needs review");
    assert.equal(view_model.selector_preview, "button#save-button");
    assert.deepEqual(view_model.sync_status, {
      state: "synced",
      label: "Synced",
      icon: "cloud-check",
      tone: "success",
      class_name: "pin-detail__status--sync-synced",
    });
    assert.equal(view_model.retry_available, false);
    assert.equal(view_model.copy_fallback_available, false);
    assert.deepEqual(view_model.actions, [
      { id: "copy_markdown", label: "Copy Markdown", enabled: true },
      { id: "resolve", label: "Resolve", enabled: true },
      { id: "delete", label: "Delete", enabled: true },
    ]);
  });

  it("shows retry and copy fallback for a failed sync mark", () => {
    const mark = sample_annotation({ id: "mark-failed", sync_status: "failed", last_error: "daemon unavailable", retry_count: 2 });

    const view_model = build_pin_detail_view_model(mark, 0);

    assert.deepEqual(view_model.sync_status, {
      state: "failed",
      label: "Sync failed",
      icon: "warning",
      tone: "danger",
      class_name: "pin-detail__status--sync-failed",
    });
    assert.equal(view_model.retry_available, true);
    assert.equal(view_model.copy_fallback_available, true);
  });

  it("keeps resolved task status separate from a lost locator", () => {
    const mark = sample_annotation({ id: "mark-lost", task_status: "resolved", locator_status: "lost", task_resolved_at: RESOLVED_AT });

    const view_model = build_pin_detail_view_model(mark, 4);

    assert.deepEqual(view_model.task_status, {
      state: "resolved",
      label: "Resolved task",
      icon: "check",
      tone: "success",
      class_name: "pin-detail__status--task-resolved",
    });
    assert.deepEqual(view_model.locator_status, {
      state: "lost",
      label: "Locator lost",
      icon: "missing",
      tone: "danger",
      class_name: "pin-detail__status--locator-lost",
    });
    assert.deepEqual(view_model.actions.find((action) => action.id === "resolve"), { id: "resolve", label: "Resolve", enabled: false });
  });
});

function sample_annotation(overrides: {
  id: string;
  sync_status?: Annotation["sync"]["status"];
  last_synced_at?: string;
  last_error?: string;
  retry_count?: number;
  task_status?: Annotation["lifecycle"]["task_status"];
  locator_status?: Annotation["target"]["resolution"]["locator_status"];
  task_resolved_at?: string;
}): Annotation {
  return {
    schema_version: LOUPE_SCHEMA_VERSION,
    id: overrides.id,
    project: {
      project_id: PROJECT_ID,
      workspace_root_hash: "workspace-root-hash",
      origin: "https://app.example.test",
      url: "https://app.example.test/dashboard?tab=home",
      route_key: ROUTE_KEY,
      session_id: SESSION_ID,
    },
    target: {
      locator: sample_locator(),
      resolution: sample_resolution(overrides.locator_status),
    },
    intent: { comment: "Needs review", kind: "other" },
    context: {
      element: {
        tag: "button",
        id: "save-button",
        role: "button",
        accessible_name: "Save changes",
        classes: ["btn", "primary"],
        text: "Save",
        selector_preview: "button#save-button",
      },
      viewport: { width: 1440, height: 900, dpr: 2 },
      position: { x: 10, y: 20, width: 120, height: 32 },
    },
    sync: {
      status: overrides.sync_status ?? "local_only",
      retry_count: overrides.retry_count ?? 0,
      ...(overrides.last_synced_at === undefined ? {} : { last_synced_at: overrides.last_synced_at }),
      ...(overrides.last_error === undefined ? {} : { last_error: overrides.last_error }),
    },
    media: { has_screenshot: false },
    replies: { items: [] },
    lifecycle: {
      task_status: overrides.task_status ?? "open",
      created_at: NOW,
      updated_at: NOW,
      ...(overrides.task_resolved_at === undefined ? {} : { task_resolved_at: overrides.task_resolved_at }),
    },
  };
}

function sample_resolution(locator_status: Annotation["target"]["resolution"]["locator_status"] = "resolved"): Annotation["target"]["resolution"] {
  const resolution: ResolveResult = {
    locator_status,
    confidence: locator_status === "lost" ? 0 : 0.93,
    matched_by: locator_status === "lost" ? [] : ["primary"],
    candidates_considered: locator_status === "lost" ? 0 : 1,
  };
  return { ...resolution, resolved_at: RESOLVED_AT };
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
      geometry: { x: 10, y: 20, width: 120, height: 32, viewport_width: 1440, viewport_height: 900, dpr: 2 },
      parent_chain: [{ tag: "form", stable_attr: "id=settings" }],
    },
  };
}
