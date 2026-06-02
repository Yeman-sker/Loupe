import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { LOUPE_SCHEMA_VERSION, storage_keys, assert_annotation, type AgentMark, type Annotation, type Locator, type ResolveResult } from "@loupe-server/shared";
import {
  copy_markdown,
  create_annotation,
  delete_annotation,
  deterministic_session_id,
  fetch_and_reconcile_daemon_marks,
  probe_daemon_health,
  project_scope_from_url,
  reconcile_on_service_worker_wake,
  reconcile_daemon_marks,
  resolve_annotation,
  retry_unsynced_annotations,
  session_marks_key,
  sync_annotation_to_daemon,
  validate_comment,
  type DaemonFetch,
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

  it("uses daemon workspace identity and sorted route query for durable scope", () => {
    const route_a = project_scope_from_url({
      url: "https://app.example.test/dashboard?tab=home&panel=2#settings",
      project_id: PROJECT_ID,
      workspace_root_hash: "workspace-root-hash",
      branch: "main",
      title: "Dashboard",
    });
    const route_b = project_scope_from_url({
      url: "https://app.example.test/settings?tab=profile",
      project_id: PROJECT_ID,
      workspace_root_hash: "workspace-root-hash",
      branch: "main",
    });
    const query_variant = project_scope_from_url({
      url: "https://app.example.test/dashboard?panel=2&tab=a",
      project_id: PROJECT_ID,
      workspace_root_hash: "workspace-root-hash",
      branch: "main",
    });

    assert.equal(route_a.project_id, PROJECT_ID);
    assert.equal(route_a.workspace_root_hash, "workspace-root-hash");
    assert.equal(route_a.origin, "https://app.example.test");
    assert.equal(route_a.route_key, "/dashboard?panel=2&tab=home");
    assert.equal(query_variant.route_key, "/dashboard?panel=2&tab=a");
    assert.notEqual(route_a.route_key, query_variant.route_key);
    assert.equal(route_a.session_id, deterministic_session_id(PROJECT_ID, "main", route_a.route_key));
    assert.notEqual(route_a.session_id, route_b.session_id);
    assert.equal(route_a.url, "https://app.example.test/dashboard?tab=home&panel=2#settings");
    assert.equal(route_a.title, "Dashboard");
  });

  it("marks origin-derived project identity as temporary when daemon identity is unavailable", () => {
    const route = project_scope_from_url({ url: "https://app.example.test/dashboard?tab=home" });

    assert.match(route.project_id, /^local_/);
    assert.match(route.workspace_root_hash, /^temporary_origin_/);
    assert.match(route.session_id, /^temporary_/);
    assert.equal(route.route_key, "/dashboard?tab=home");
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

  it("probes daemon health with injected fetch", async () => {
    const fetch = fetch_sequence([{ ok: true, body: { ok: true, name: "loupe", version: "0.0.0", port: 7373, requires_auth: true } }]);

    const health = await probe_daemon_health(fetch, "http://127.0.0.1:7373");

    assert.equal(health?.ok, true);
    assert.equal(fetch.calls[0]?.input, "http://127.0.0.1:7373/health");
  });

  it("syncs a local mark to daemon and marks it synced", async () => {
    const mark = sample_annotation({ id: "mark-sync" });
    const marks_key = session_marks_key(PROJECT_ID, SESSION_ID);
    const store = new MemoryStore({ [marks_key]: [mark] });
    const fetch = fetch_sequence([{ ok: true, body: { ok: true } }]);

    const result = await sync_annotation_to_daemon({ fetch, store, now: () => RESOLVED_AT }, daemon_options(), mark);

    assert.equal(result.ok, true);
    const stored = stored_marks(store)[0];
    assert.equal(stored?.id, mark.id);
    assert.equal(stored?.sync.status, "synced");
    assert.equal(stored?.sync.last_synced_at, RESOLVED_AT);
    assert.equal(stored?.sync.retry_count, 0);
    assert.equal(fetch.calls[0]?.input, "http://127.0.0.1:7373/v1/marks");
    assert.equal(fetch.calls[0]?.init?.method, "POST");
    assert.equal(header_value(fetch.calls[0]?.init?.headers, "authorization"), "Bearer token-123");
    assert.equal(header_value(fetch.calls[0]?.init?.headers, "content-type"), "application/json");
    assert.deepEqual(JSON.parse(String(fetch.calls[0]?.init?.body)), mark);
  });

  it("preserves local mark and marks failed when daemon sync fails", async () => {
    const mark = sample_annotation({ id: "mark-fail" });
    const marks_key = session_marks_key(PROJECT_ID, SESSION_ID);
    const store = new MemoryStore({ [marks_key]: [mark] });
    const fetch = fetch_sequence([{ ok: false, status: 503, body: { error: { message: "down" } } }]);

    const result = await sync_annotation_to_daemon({ fetch, store, now: () => RESOLVED_AT }, daemon_options(), mark);

    assert.equal(result.ok, false);
    const stored = stored_marks(store)[0];
    assert.equal(stored?.id, mark.id);
    assert.equal(stored?.intent.comment, mark.intent.comment);
    assert.equal(stored?.sync.status, "failed");
    assert.equal(stored?.sync.retry_count, 1);
    assert.match(stored?.sync.last_error ?? "", /503/);
  });

  it("preserves local mark and records failure when daemon is offline", async () => {
    const mark = sample_annotation({ id: "mark-offline" });
    const marks_key = session_marks_key(PROJECT_ID, SESSION_ID);
    const store = new MemoryStore({ [marks_key]: [mark] });
    const fetch = fetch_throwing(new TypeError("fetch failed"));

    const result = await sync_annotation_to_daemon({ fetch, store, now: () => RESOLVED_AT }, daemon_options(), mark);

    assert.equal(result.ok, false);
    assert.equal(fetch.calls.length, 1);
    const stored = stored_marks(store)[0];
    assert.equal(stored?.id, mark.id);
    assert.equal(stored?.intent.comment, mark.intent.comment);
    assert.equal(stored?.sync.status, "failed");
    assert.equal(stored?.sync.retry_count, 1);
    assert.match(stored?.sync.last_error ?? "", /fetch failed/);
  });

  it("preserves local mark and records failure when token is rejected", async () => {
    const mark = sample_annotation({ id: "mark-token-fail" });
    const marks_key = session_marks_key(PROJECT_ID, SESSION_ID);
    const store = new MemoryStore({ [marks_key]: [mark] });
    const fetch = fetch_sequence([{ ok: false, status: 401, body: { error: { message: "invalid token" } } }]);

    const result = await sync_annotation_to_daemon({ fetch, store, now: () => RESOLVED_AT }, daemon_options(), mark);

    assert.equal(result.ok, false);
    const stored = stored_marks(store)[0];
    assert.equal(stored?.id, mark.id);
    assert.equal(stored?.intent.comment, mark.intent.comment);
    assert.equal(stored?.sync.status, "failed");
    assert.equal(stored?.sync.retry_count, 1);
    assert.match(stored?.sync.last_error ?? "", /401/);
  });

  it("retries failed and local-only marks and marks them synced on success", async () => {
    const failed = with_test_sync(sample_annotation({ id: "mark-retry-ok" }), { status: "failed", retry_count: 2, last_error: "offline" });
    const local_only = sample_annotation({ id: "mark-local-retry" });
    const synced = with_test_sync(sample_annotation({ id: "mark-already-synced" }), { status: "synced", retry_count: 0 });
    const marks_key = session_marks_key(PROJECT_ID, SESSION_ID);
    const store = new MemoryStore({ [marks_key]: [failed, local_only, synced] });
    const fetch = fetch_sequence([
      { ok: true, body: { ok: true } },
      { ok: true, body: { ok: true } },
    ]);

    const result = await retry_unsynced_annotations({ fetch, store, now: () => RESOLVED_AT }, daemon_options(), { project_id: PROJECT_ID, session_id: SESSION_ID });

    assert.equal(result.attempted, 2);
    assert.equal(result.results.every((item) => item.ok), true);
    assert.equal(fetch.calls.length, 2);
    const marks = stored_marks(store);
    assert.equal(marks.find((mark) => mark.id === failed.id)?.sync.status, "synced");
    assert.equal(marks.find((mark) => mark.id === failed.id)?.sync.retry_count, 2);
    assert.equal(marks.find((mark) => mark.id === failed.id)?.sync.last_synced_at, RESOLVED_AT);
    assert.equal(marks.find((mark) => mark.id === local_only.id)?.sync.status, "synced");
    assert.equal(marks.find((mark) => mark.id === local_only.id)?.sync.retry_count, 0);
    assert.equal(marks.find((mark) => mark.id === synced.id)?.sync.status, "synced");
  });

  it("retry failure preserves local mark and increments retry count", async () => {
    const failed = with_test_sync(sample_annotation({ id: "mark-retry-fail", comment: "Keep my local comment" }), {
      status: "failed",
      retry_count: 2,
      last_error: "offline",
    });
    const marks_key = session_marks_key(PROJECT_ID, SESSION_ID);
    const store = new MemoryStore({ [marks_key]: [failed] });
    const fetch = fetch_sequence([{ ok: false, status: 503, body: { error: { message: "still down" } } }]);

    const result = await retry_unsynced_annotations({ fetch, store, now: () => RESOLVED_AT }, daemon_options(), { project_id: PROJECT_ID, session_id: SESSION_ID });

    assert.equal(result.attempted, 1);
    assert.equal(result.results[0]?.ok, false);
    const stored = stored_marks(store)[0];
    assert.equal(stored?.id, failed.id);
    assert.equal(stored?.intent.comment, "Keep my local comment");
    assert.equal(stored?.sync.status, "failed");
    assert.equal(stored?.sync.retry_count, 3);
    assert.match(stored?.sync.last_error ?? "", /503/);
  });

  it("service-worker wake retries unsynced marks before daemon reconcile", async () => {
    const local = with_test_sync(sample_annotation({ id: "mark-wake", comment: "Local unsynced comment" }), {
      status: "failed",
      retry_count: 1,
      last_error: "offline",
    });
    const marks_key = session_marks_key(PROJECT_ID, SESSION_ID);
    const store = new MemoryStore({ [marks_key]: [local] });
    const fetch = fetch_sequence([
      { ok: true, body: { ok: true } },
      { ok: true, body: { project: { project_id: PROJECT_ID }, marks: [sample_agent_mark(local, { updated_at: RESOLVED_AT })] } },
    ]);

    await reconcile_on_service_worker_wake({ fetch, store, now: () => RESOLVED_AT }, daemon_options(), local.project);

    assert.equal(fetch.calls.length, 2);
    assert.equal(fetch.calls[0]?.init?.method, "POST");
    assert.equal(fetch.calls[1]?.init?.method, "GET");
    const stored = stored_marks(store)[0];
    assert.equal(stored?.id, local.id);
    assert.equal(stored?.intent.comment, "Local unsynced comment");
    assert.equal(stored?.sync.status, "synced");
  });

  it("service-worker wake does not let daemon overwrite newer failed local mark", async () => {
    const local = with_test_sync(
      { ...sample_annotation({ id: "mark-wake-preserve", comment: "New local comment" }), lifecycle: { task_status: "open", created_at: NOW, updated_at: RESOLVED_AT } },
      { status: "failed", retry_count: 1, last_error: "offline" },
    );
    const older_daemon = sample_agent_mark(
      { ...local, intent: { ...local.intent, comment: "Older daemon comment" }, lifecycle: { ...local.lifecycle, updated_at: NOW } },
      { updated_at: NOW },
    );
    const marks_key = session_marks_key(PROJECT_ID, SESSION_ID);
    const store = new MemoryStore({ [marks_key]: [local] });
    const fetch = fetch_sequence([
      { ok: false, status: 503, body: { error: { message: "still down" } } },
      { ok: true, body: { project: { project_id: PROJECT_ID }, marks: [older_daemon] } },
    ]);

    await reconcile_on_service_worker_wake({ fetch, store, now: () => RESOLVED_AT }, daemon_options(), local.project);

    assert.equal(fetch.calls[0]?.init?.method, "POST");
    assert.equal(fetch.calls[1]?.init?.method, "GET");
    const stored = stored_marks(store)[0];
    assert.equal(stored?.intent.comment, "New local comment");
    assert.equal(stored?.sync.status, "failed");
    assert.equal(stored?.sync.retry_count, 2);
    assert.match(stored?.sync.last_error ?? "", /503/);
  });

  it("copy markdown includes failed open local marks", () => {
    const failed = with_test_sync(sample_annotation({ id: "mark-copy-failed", comment: "Copy me even when token failed" }), {
      status: "failed",
      retry_count: 1,
      last_error: "POST /v1/marks failed with 401",
    });

    const markdown = copy_markdown([failed], { project_id: PROJECT_ID, session_id: SESSION_ID, route_key: ROUTE_KEY });

    assert.match(markdown, /id: mark-copy-failed/);
    assert.match(markdown, /comment: Copy me even when token failed/);
    assert.match(markdown, /sync: failed/);
  });

  it("fetches scoped daemon marks and reconciles a resolved mutation", async () => {
    const mark = { ...sample_annotation({ id: "mark-resolved-daemon" }), sync: { status: "synced" as const, retry_count: 0 } };
    const store = new MemoryStore({ [session_marks_key(PROJECT_ID, SESSION_ID)]: [mark] });
    const daemon_mark = sample_agent_mark(mark, { task_status: "resolved", updated_at: RESOLVED_AT });
    const fetch = fetch_sequence([{ ok: true, body: { project: { project_id: PROJECT_ID }, marks: [daemon_mark] } }]);

    await fetch_and_reconcile_daemon_marks({ fetch, store }, daemon_options(), mark.project);

    const stored = stored_marks(store)[0];
    assert.equal(fetch.calls[0]?.init?.method, "GET");
    assert.equal(header_value(fetch.calls[0]?.init?.headers, "authorization"), "Bearer token-123");
    assert.match(fetch.calls[0]?.input ?? "", /\/v1\/marks\?/);
    assert.match(fetch.calls[0]?.input ?? "", /project_id=project-abc/);
    assert.match(fetch.calls[0]?.input ?? "", /session_id=session-def/);
    assert.equal(stored?.lifecycle.task_status, "resolved");
    assert.equal(stored?.lifecycle.task_resolved_at, RESOLVED_AT);
    assert.equal(stored?.lifecycle.updated_at, RESOLVED_AT);
    assert.equal(stored?.sync.status, "synced");
  });

  it("stores daemon-only marks fetched into a fresh local store", async () => {
    const daemon_mark = {
      ...sample_agent_mark(sample_annotation({ id: "mark-daemon-only", comment: "Daemon note", selector_preview: "main button.save" })),
      project: { ...sample_agent_mark(sample_annotation({ id: "mark-daemon-only" })).project, branch: "main" },
      target: {
        ...sample_agent_mark(sample_annotation({ id: "mark-daemon-only" })).target,
        frame_path: [{ selector: "iframe.editor", name: "editor" }],
        shadow_path: ["loupe-shell", "button.save"],
        path: "html > body > main > button:nth-of-type(1)",
      },
    } satisfies AgentMark;
    const store = new MemoryStore({});
    const fetch = fetch_sequence([{ ok: true, body: { project: { project_id: PROJECT_ID }, marks: [daemon_mark] } }]);

    await fetch_and_reconcile_daemon_marks({ fetch, store }, daemon_options(), sample_project());

    const stored = stored_marks(store);
    assert.equal(stored.length, 1);
    const reconstructed = stored[0];
    assert.ok(reconstructed);
    assert.doesNotThrow(() => assert_annotation(reconstructed));
    assert.equal(reconstructed.id, daemon_mark.id);
    assert.equal(reconstructed.schema_version, LOUPE_SCHEMA_VERSION);
    assert.deepEqual(reconstructed.project, {
      project_id: PROJECT_ID,
      workspace_root_hash: "workspace-root-hash",
      branch: "main",
      origin: "https://app.example.test",
      url: "https://app.example.test/dashboard?tab=home",
      route_key: ROUTE_KEY,
      session_id: SESSION_ID,
    });
    assert.deepEqual(reconstructed.target.locator.frame_path, daemon_mark.target.frame_path);
    assert.deepEqual(reconstructed.target.locator.primary, { selector: daemon_mark.target.selector, strategy: "shadow_path" });
    assert.deepEqual(reconstructed.target.locator.alternates, [{ selector: daemon_mark.target.path, strategy: "nth_path" }]);
    assert.deepEqual(reconstructed.target.locator.evidence.shadow_path, daemon_mark.target.shadow_path);
    assert.equal(reconstructed.target.locator.evidence.nth_path, daemon_mark.target.path);
    assert.equal(reconstructed.target.resolution.locator_status, daemon_mark.target.locator_status);
    assert.equal(reconstructed.target.resolution.confidence, daemon_mark.target.confidence);
    assert.deepEqual(reconstructed.target.resolution.matched_by, daemon_mark.target.matched_by);
    assert.equal(reconstructed.intent.comment, "Daemon note");
    assert.deepEqual(reconstructed.context.element, {
      tag: "button",
      classes: ["btn", "primary"],
      text: "Save",
      selector_preview: "button#save-button",
    });
    assert.deepEqual(reconstructed.sync, { status: "synced", retry_count: 0 });
    assert.deepEqual(reconstructed.media, daemon_mark.media);
    assert.deepEqual(reconstructed.lifecycle, daemon_mark.lifecycle);
  });

  it("appends daemon-only wake marks while preserving newer failed local marks", async () => {
    const local = with_test_sync(
      { ...sample_annotation({ id: "mark-local-newer", comment: "Newer failed local" }), lifecycle: { task_status: "open", created_at: NOW, updated_at: RESOLVED_AT } },
      { status: "failed", retry_count: 1, last_error: "offline" },
    );
    const older_daemon = sample_agent_mark(
      { ...local, intent: { ...local.intent, comment: "Older daemon" }, lifecycle: { ...local.lifecycle, updated_at: NOW } },
      { updated_at: NOW },
    );
    const daemon_only = sample_agent_mark(sample_annotation({ id: "mark-wake-daemon-only", comment: "Wake daemon only" }));
    const marks_key = session_marks_key(PROJECT_ID, SESSION_ID);
    const store = new MemoryStore({ [marks_key]: [local] });
    const fetch = fetch_sequence([
      { ok: false, status: 503, body: { error: { message: "still down" } } },
      { ok: true, body: { project: { project_id: PROJECT_ID }, marks: [older_daemon, daemon_only] } },
    ]);

    await reconcile_on_service_worker_wake({ fetch, store, now: () => RESOLVED_AT }, daemon_options(), local.project);

    const marks = stored_marks(store);
    assert.deepEqual(marks.map((mark) => mark.id), [local.id, daemon_only.id]);
    const preserved = marks.find((mark) => mark.id === local.id);
    assert.equal(preserved?.intent.comment, "Newer failed local");
    assert.equal(preserved?.sync.status, "failed");
    assert.equal(preserved?.sync.retry_count, 2);
    assert.match(preserved?.sync.last_error ?? "", /503/);
    const appended = marks.find((mark) => mark.id === daemon_only.id);
    assert.equal(appended?.intent.comment, "Wake daemon only");
    assert.equal(appended?.sync.status, "synced");
    assert.doesNotThrow(() => assert_annotation(appended));
  });
  it("reconciles daemon delete by removing active mark and writing a tombstone", async () => {
    const deleted = { ...sample_annotation({ id: "mark-deleted" }), sync: { status: "synced" as const, retry_count: 0 } };
    const kept = { ...sample_annotation({ id: "mark-kept" }), sync: { status: "synced" as const, retry_count: 0 } };
    const marks_key = session_marks_key(PROJECT_ID, SESSION_ID);
    const tombstones_key = storage_keys.project_tombstones(PROJECT_ID);
    const store = new MemoryStore({ [marks_key]: [deleted, kept], [tombstones_key]: ["older"] });

    await reconcile_daemon_marks(store, { project_id: PROJECT_ID, session_id: SESSION_ID }, [sample_agent_mark(kept)]);

    assert.deepEqual(stored_marks(store).map((mark) => mark.id), [kept.id]);
    assert.deepEqual(store.data.get(tombstones_key), ["older", deleted.id]);
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

function sample_agent_mark(mark: Annotation, overrides: { task_status?: "open" | "resolved" | "archived"; updated_at?: string } = {}): AgentMark {
  return {
    id: mark.id,
    project: {
      project_id: mark.project.project_id,
      workspace_root_hash: mark.project.workspace_root_hash,
      url: mark.project.url,
      route_key: mark.project.route_key,
      session_id: mark.project.session_id,
    },
    intent: { comment: mark.intent.comment, kind: mark.intent.kind },
    target: {
      selector: mark.target.locator.primary.selector,
      selector_preview: mark.context.element.selector_preview,
      tag: mark.context.element.tag,
      ...(mark.context.element.text === undefined ? {} : { text: mark.context.element.text }),
      ...(mark.context.element.classes === undefined ? {} : { classes: mark.context.element.classes }),
      locator_status: mark.target.resolution.locator_status,
      confidence: mark.target.resolution.confidence,
      matched_by: mark.target.resolution.matched_by,
    },
    media: { has_screenshot: mark.media.has_screenshot },
    lifecycle: {
      task_status: overrides.task_status ?? mark.lifecycle.task_status,
      created_at: mark.lifecycle.created_at,
      updated_at: overrides.updated_at ?? mark.lifecycle.updated_at,
    },
  };
}

function with_test_sync(mark: Annotation, sync: Annotation["sync"]): Annotation {
  return { ...mark, sync };
}

function daemon_options() {
  return { base_url: "http://127.0.0.1:7373", token: "token-123" };
}

function stored_marks(store: MemoryStore): Annotation[] {
  return store.data.get(session_marks_key(PROJECT_ID, SESSION_ID)) as Annotation[];
}

type FetchCall = { input: string; init?: RequestInit };

type FetchFixture = { ok: boolean; status?: number; body: unknown };

function fetch_sequence(fixtures: FetchFixture[]): DaemonFetch & { calls: FetchCall[] } {
  const calls: FetchCall[] = [];
  const fetch_impl = (async (input: string, init?: RequestInit) => {
    calls.push(init === undefined ? { input } : { input, init });
    const fixture = fixtures.shift();
    if (fixture === undefined) throw new Error("Unexpected fetch call");
    return {
      ok: fixture.ok,
      status: fixture.status ?? (fixture.ok ? 200 : 500),
      json: async () => fixture.body,
    } as Response;
  }) as DaemonFetch & { calls: FetchCall[] };
  fetch_impl.calls = calls;
  return fetch_impl;
}

function fetch_throwing(error: Error): DaemonFetch & { calls: FetchCall[] } {
  const calls: FetchCall[] = [];
  const fetch_impl = (async (input: string, init?: RequestInit) => {
    calls.push(init === undefined ? { input } : { input, init });
    throw error;
  }) as unknown as DaemonFetch & { calls: FetchCall[] };
  fetch_impl.calls = calls;
  return fetch_impl;
}

function header_value(headers: HeadersInit | undefined, name: string): string | undefined {
  if (headers === undefined) return undefined;
  if (headers instanceof Headers) return headers.get(name) ?? undefined;
  const lower_name = name.toLowerCase();
  if (Array.isArray(headers)) {
    const entry = headers.find(([key]) => key.toLowerCase() === lower_name);
    return entry?.[1];
  }
  return Object.entries(headers).find(([key]) => key.toLowerCase() === lower_name)?.[1];
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
