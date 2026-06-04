import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { decide_origin_authorization, handle_service_worker_wake, request_active_tab_origin_authorization, request_current_tab_origin_authorization, request_origin_authorization } from "./background.js";

describe("background origin authorization", () => {
  it("returns denied authorization result when permission request is declined", async () => {
    const requested: string[][] = [];

    const decision = await request_origin_authorization(
      { origin: "https://app.example.test" },
      {},
      async () => false,
      async (origins) => {
        requested.push([...origins]);
        return false;
      },
    );

    assert.deepEqual(requested, [["https://app.example.test/*"]]);
    assert.deepEqual(decision, {
      ok: true,
      authorized: false,
      origin: "https://app.example.test",
      origin_pattern: "https://app.example.test/*",
      error: "Origin permission request was denied",
    });
  });

  it("returns successful request result using the origin permission pattern", async () => {
    const requested: string[][] = [];

    const decision = await request_origin_authorization(
      {},
      { tab: { url: "http://localhost:5173/dashboard" } },
      async () => false,
      async (origins) => {
        requested.push([...origins]);
        return true;
      },
    );

    assert.deepEqual(requested, [["http://localhost:5173/*"]]);
    assert.deepEqual(decision, {
      ok: true,
      authorized: true,
      origin: "http://localhost:5173",
      origin_pattern: "http://localhost:5173/*",
    });
  });

  it("rejects unsupported origins before probing or requesting permissions", async () => {
    let contains_count = 0;
    let request_count = 0;

    const decision = await request_origin_authorization(
      { origin: "chrome://extensions" },
      {},
      async () => {
        contains_count += 1;
        return true;
      },
      async () => {
        request_count += 1;
        return true;
      },
    );

    assert.equal(contains_count, 0);
    assert.equal(request_count, 0);
    assert.deepEqual(decision, {
      ok: false,
      authorized: false,
      origin: "chrome://extensions",
      error: "Unsupported page origin: chrome://extensions",
    });
  });

  it("propagates permission request failure messages", async () => {
    const decision = await request_origin_authorization(
      { origin: "https://app.example.test" },
      {},
      async () => false,
      async () => {
        throw new Error("User gesture required");
      },
    );

    assert.deepEqual(decision, {
      ok: false,
      authorized: false,
      origin: "https://app.example.test",
      error: "User gesture required",
    });
  });

  it("returns missing origin result without probing permissions", async () => {
    let contains_count = 0;

    const decision = await decide_origin_authorization({}, {}, async () => {
      contains_count += 1;
      return true;
    });

    assert.equal(contains_count, 0);
    assert.deepEqual(decision, { ok: false, authorized: false, error: "No page origin available" });
  });

  it("returns already authorized result without requesting permissions", async () => {
    let request_count = 0;

    const decision = await request_origin_authorization(
      { origin: "https://app.example.test" },
      {},
      async () => true,
      async () => {
        request_count += 1;
        return false;
      },
    );

    assert.equal(request_count, 0);
    assert.deepEqual(decision, {
      ok: true,
      authorized: true,
      origin: "https://app.example.test",
      origin_pattern: "https://app.example.test/*",
    });
  });

  it("requests active-tab origin permission and reloads after grant", async () => {
    const requested: string[][] = [];
    const reloaded: number[] = [];

    const decision = await request_active_tab_origin_authorization(
      { id: 7, url: "http://127.0.0.1:4172/" },
      async () => false,
      async (origins) => {
        requested.push([...origins]);
        return true;
      },
      async (tab_id) => void reloaded.push(tab_id),
    );

    assert.deepEqual(requested, [["http://127.0.0.1:4172/*"]]);
    assert.deepEqual(reloaded, [7]);
    assert.deepEqual(decision, {
      ok: true,
      authorized: true,
      origin: "http://127.0.0.1:4172",
      origin_pattern: "http://127.0.0.1:4172/*",
    });
  });

  it("requests current active tab origin permission", async () => {
    const requested: string[][] = [];
    const reloaded: number[] = [];

    const decision = await request_current_tab_origin_authorization(
      {
        query: async (query_info) => {
          assert.deepEqual(query_info, { active: true, currentWindow: true });
          return [{ id: 9, url: "http://127.0.0.1:4172/dashboard" }];
        },
        reload: async (tab_id) => void reloaded.push(tab_id),
      },
      async () => false,
      async (origins) => {
        requested.push([...origins]);
        return true;
      },
    );

    assert.deepEqual(requested, [["http://127.0.0.1:4172/*"]]);
    assert.deepEqual(reloaded, [9]);
    assert.equal(decision.ok, true);
    assert.equal(decision.authorized, true);
  });
});

describe("background service worker wake", () => {
  it("retries unsynced marks and reconciles daemon marks without storing the token", async () => {
    const key = "loupe:v1:project:project-1:session:session-1:marks";
    const local_mark = {
      id: "mark-1",
      project: { project_id: "project-1", workspace_root_hash: "workspace-root-hash", origin: "https://app.example.test", url: "https://app.example.test/dashboard", route_key: "/dashboard", session_id: "session-1" },
      target: { resolution: {} },
      intent: { comment: "local", kind: "copy" },
      lifecycle: { created_at: "2026-01-01T00:00:00.000Z", updated_at: "2026-01-01T00:00:00.000Z", task_status: "open" },
      sync: { status: "local_only", retry_count: 0 },
    };
    const store: Record<string, unknown> = { [key]: [local_mark] };
    const session_sets: Record<string, unknown>[] = [];
    const requests: { url: string; init: RequestInit | undefined }[] = [];

    const result = await handle_service_worker_wake(
      {
        session: { set: async (items) => void session_sets.push(items) },
        local: {
          get: async (requested_key) => (typeof requested_key === "string" ? { [requested_key]: store[requested_key] } : { ...store }),
          set: async (items) => void Object.assign(store, items),
        },
      },
      { type: "loupe.service_worker.wake", scope: { project_id: "project-1", workspace_root_hash: "workspace-root-hash", origin: "https://app.example.test", url: "https://app.example.test/dashboard", route_key: "/dashboard", session_id: "session-1" }, daemon: { base_url: "http://127.0.0.1:7373", token: "secret-token" } },
      "2026-01-01T00:00:01.000Z",
      async (url, init) => {
        requests.push({ url: String(url), init });
        if (init?.method === "POST") return new Response("{}", { status: 200 });
        return Response.json({
          marks: [
            {
              id: "mark-1",
              project: { project_id: "project-1", workspace_root_hash: "workspace-root-hash", origin: "https://app.example.test", url: "https://app.example.test/dashboard", route_key: "/dashboard", session_id: "session-1" },
              target: { selector: "#mark", locator_status: "resolved", confidence: 1, matched_by: ["daemon"] },
              intent: { comment: "daemon", kind: "copy" },
              lifecycle: { created_at: "2026-01-01T00:00:00.000Z", updated_at: "2026-01-01T00:00:02.000Z", task_status: "resolved" },
            },
          ],
        });
      },
    );

    assert.deepEqual(result, { ok: true, reconciled: true, retried: 1, stored: 1 });
    assert.equal(requests.length, 2);
    assert.equal(requests[0]?.url, "http://127.0.0.1:7373/v1/marks");
    assert.equal(requests[0]?.init?.method, "POST");
    assert.equal((requests[0]?.init?.headers as Record<string, string>).authorization, "Bearer secret-token");
    assert.equal(requests[1]?.url, "http://127.0.0.1:7373/v1/marks?project_id=project-1&workspace_root_hash=workspace-root-hash&origin=https%3A%2F%2Fapp.example.test&url=https%3A%2F%2Fapp.example.test%2Fdashboard&route_key=%2Fdashboard&session_id=session-1");
    assert.equal(requests[1]?.init?.method, "GET");
    assert.equal((requests[1]?.init?.headers as Record<string, string>).authorization, "Bearer secret-token");
    assert.equal(JSON.stringify(session_sets).includes("secret-token"), false);
    assert.equal(JSON.stringify(store).includes("secret-token"), false);
    assert.equal(((store[key] as Array<{ sync: { status: string }; intent: { comment: string } }>)[0]?.sync.status), "synced");
    assert.equal(((store[key] as Array<{ sync: { status: string }; intent: { comment: string } }>)[0]?.intent.comment), "daemon");
  });

  it("removes synced local marks omitted by daemon reconciliation after agent delete", async () => {
    const key = "loupe:v1:project:project-1:session:session-1:marks";
    const tombstones_key = "loupe:v1:project:project-1:tombstones";
    const local_mark = {
      id: "mark-deleted",
      project: { project_id: "project-1", workspace_root_hash: "workspace-root-hash", origin: "https://app.example.test", url: "https://app.example.test/dashboard", route_key: "/dashboard", session_id: "session-1" },
      target: { resolution: {} },
      intent: { comment: "deleted by agent", kind: "copy" },
      lifecycle: { created_at: "2026-01-01T00:00:00.000Z", updated_at: "2026-01-01T00:00:00.000Z", task_status: "open" },
      sync: { status: "synced", retry_count: 0 },
    };
    const store: Record<string, unknown> = { [key]: [local_mark] };

    const result = await handle_service_worker_wake(
      {
        session: { set: async () => undefined },
        local: {
          get: async (requested_key) => (typeof requested_key === "string" ? { [requested_key]: store[requested_key] } : { ...store }),
          set: async (items) => void Object.assign(store, items),
        },
      },
      { type: "loupe.service_worker.wake", scope: local_mark.project, daemon: { base_url: "http://127.0.0.1:7373", token: "secret-token" } },
      "2026-01-01T00:00:01.000Z",
      async () => Response.json({ marks: [] }),
    );

    assert.deepEqual(result, { ok: true, reconciled: true, retried: 0, stored: 0 });
    assert.deepEqual(store[key], []);
    assert.deepEqual(store[tombstones_key], ["mark-deleted"]);
  });

  it("preserves newer unsynced local marks during daemon reconciliation", async () => {
    const key = "loupe:v1:project:project-1:session:session-1:marks";
    const store: Record<string, unknown> = {
      [key]: [
        {
          id: "mark-1",
          project: { project_id: "project-1", workspace_root_hash: "workspace-root-hash", origin: "https://app.example.test", url: "https://app.example.test/dashboard", route_key: "/dashboard", session_id: "session-1" },
          target: { resolution: {} },
          intent: { comment: "newer local", kind: "copy" },
          lifecycle: { created_at: "2026-01-01T00:00:00.000Z", updated_at: "2026-01-01T00:00:03.000Z", task_status: "open" },
          sync: { status: "failed", retry_count: 1 },
        },
      ],
    };

    await handle_service_worker_wake(
      {
        session: { set: async () => undefined },
        local: {
          get: async (requested_key) => (typeof requested_key === "string" ? { [requested_key]: store[requested_key] } : { ...store }),
          set: async (items) => void Object.assign(store, items),
        },
      },
      { project_id: "project-1", workspace_root_hash: "workspace-root-hash", origin: "https://app.example.test", url: "https://app.example.test/dashboard", route_key: "/dashboard", session_id: "session-1", base_url: "http://127.0.0.1:7373", token: "secret-token" },
      "2026-01-01T00:00:04.000Z",
      async (_url, init) => {
        if (init?.method === "POST") return new Response("daemon unavailable", { status: 503 });
        return Response.json({
          marks: [
            {
              id: "mark-1",
              project: { project_id: "project-1", workspace_root_hash: "workspace-root-hash", origin: "https://app.example.test", url: "https://app.example.test/dashboard", route_key: "/dashboard", session_id: "session-1" },
              target: { selector: "#mark", locator_status: "resolved", confidence: 1 },
              intent: { comment: "older daemon", kind: "copy" },
              lifecycle: { created_at: "2026-01-01T00:00:00.000Z", updated_at: "2026-01-01T00:00:02.000Z", task_status: "resolved" },
            },
          ],
        });
      },
    );

    const stored_mark = (store[key] as Array<{ sync: { status: string; retry_count: number }; intent: { comment: string } }>)[0];
    assert.equal(stored_mark?.sync.status, "failed");
    assert.equal(stored_mark?.sync.retry_count, 2);
    assert.equal(stored_mark?.intent.comment, "newer local");
  });
});
