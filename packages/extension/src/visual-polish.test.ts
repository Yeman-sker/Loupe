import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  locator_status_tokens,
  motion_tokens,
  status_class_name,
  sync_status_tokens,
  task_status_tokens,
  visual_polish_tokens,
} from "./visual-polish.js";

const max_transition_ms = 160;

describe("Phase 5 visual polish motion", () => {
  it("disables nonessential transitions and animations when reduced motion is preferred", () => {
    const tokens = motion_tokens(true);

    assert.equal(tokens.prefers_reduced_motion, true);
    assert.equal(tokens.transition_duration_ms, 0);
    assert.equal(tokens.overlay_transition, "none");
    assert.equal(tokens.detail_transition, "none");
    assert.equal(tokens.toolbar_transition, "none");
    assert.equal(tokens.badge_animation, "none");
    assert.match(tokens.css, /transition: none/);
    assert.match(tokens.css, /animation: none/);
    assert.doesNotMatch(tokens.css, /@keyframes/);
  });

  it("keeps normal motion bounded and scoped to overlay chrome", () => {
    const tokens = motion_tokens(false);

    assert.equal(tokens.prefers_reduced_motion, false);
    assert.ok(tokens.transition_duration_ms > 0);
    assert.ok(tokens.transition_duration_ms <= max_transition_ms);
    assert.match(tokens.overlay_transition, /opacity 140ms ease-out/);
    assert.match(tokens.overlay_transition, /transform 140ms ease-out/);
    assert.match(tokens.detail_transition, /opacity 140ms ease-out/);
    assert.match(tokens.toolbar_transition, /^opacity 140ms ease-out$/);
    assert.match(tokens.badge_animation, /^loupe-sync-pulse 900ms ease-out infinite$/);
    assert.match(tokens.css, /@keyframes loupe-sync-pulse/);
    assert.doesNotMatch(tokens.css, /transition: all/);
  });
});

describe("Phase 5 visual polish status affordances", () => {
  it("exposes a label and non-color affordances for every task status", () => {
    for (const [status, token] of Object.entries(task_status_tokens)) {
      assert.equal(token.kind, "task");
      assert.equal(status_class_name("task", status as keyof typeof task_status_tokens), token.class_name);
      assert_accessible_status_token(token);
    }
  });

  it("exposes a label and non-color affordances for every locator status", () => {
    for (const [status, token] of Object.entries(locator_status_tokens)) {
      assert.equal(token.kind, "locator");
      assert.equal(status_class_name("locator", status as keyof typeof locator_status_tokens), token.class_name);
      assert_accessible_status_token(token);
    }
  });

  it("exposes a label and non-color affordances for every sync status including fallback states", () => {
    for (const [status, token] of Object.entries(sync_status_tokens)) {
      assert.equal(token.kind, "sync");
      assert.equal(status_class_name("sync", status as keyof typeof sync_status_tokens), token.class_name);
      assert_accessible_status_token(token);
    }

    assert.match(sync_status_tokens.local_only.aria_label, /copy markdown fallback/i);
    assert.match(sync_status_tokens.failed.aria_label, /retry or copy markdown fallback/i);
  });

  it("composes toolbar/detail CSS with reduced-motion overrides for UI consumers", () => {
    const tokens = visual_polish_tokens(true);

    assert.equal(tokens.class_names.detail, "loupe-pin-detail");
    assert.equal(tokens.class_names.action_copy_markdown, "loupe-action-copy-markdown");
    assert.equal(tokens.class_names.action_resolve, "loupe-action-resolve");
    assert.equal(tokens.class_names.action_delete, "loupe-action-delete");
    assert.match(tokens.css, /\.loupe-toolbar/);
    assert.match(tokens.css, /\.loupe-pin-detail/);
    assert.match(tokens.css, /\.loupe-copy-fallback/);
    assert.match(tokens.css, /transition: none/);
    assert.match(tokens.css, /animation: none/);
  });
});

type StatusToken = (typeof task_status_tokens)[keyof typeof task_status_tokens];

function assert_accessible_status_token(token: StatusToken): void {
  assert.notEqual(token.label, "");
  assert.notEqual(token.badge_text, "");
  assert.notEqual(token.icon_name, "");
  assert.notEqual(token.border_style, undefined);
  assert.notEqual(token.aria_label, "");
  assert.match(token.class_name, /^loupe-status-(task|locator|sync)-[a-z-]+$/);
  assert.ok(["solid", "dashed", "double"].includes(token.border_style));
}
