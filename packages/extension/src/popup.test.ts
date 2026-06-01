import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { authorize_current_tab_origin, DAEMON_SETTINGS_KEY, pair_daemon } from "./popup.js";

describe("popup current-site authorization", () => {
  it("requests current active tab origin permission and reloads after grant", async () => {
    const requested: string[][] = [];
    const reloaded: number[] = [];

    const result = await authorize_current_tab_origin(
      {
        query: async (query_info) => {
          assert.deepEqual(query_info, { active: true, currentWindow: true });
          return [{ id: 3, url: "http://127.0.0.1:4172/dashboard" }];
        },
        reload: async (tab_id) => void reloaded.push(tab_id),
      },
      {
        contains: async () => false,
        request: async ({ origins }) => {
          requested.push([...origins]);
          return true;
        },
      },
    );

    assert.deepEqual(requested, [["http://127.0.0.1:4172/*"]]);
    assert.deepEqual(reloaded, [3]);
    assert.deepEqual(result, {
      ok: true,
      authorized: true,
      origin: "http://127.0.0.1:4172",
      origin_pattern: "http://127.0.0.1:4172/*",
      reloaded: true,
    });
  });

  it("does not request permissions for unsupported pages", async () => {
    let request_count = 0;

    const result = await authorize_current_tab_origin(
      {
        query: async () => [{ id: 3, url: "chrome://extensions" }],
        reload: async () => undefined,
      },
      {
        contains: async () => false,
        request: async () => {
          request_count += 1;
          return true;
        },
      },
    );

    assert.equal(request_count, 0);
    assert.deepEqual(result, { ok: false, authorized: false, reloaded: false, error: "Open an http:// or https:// page first." });
  });
});

describe("popup daemon pairing", () => {
  it("stores daemon pairing under the content-script settings key", async () => {
    const writes: Record<string, unknown>[] = [];

    const result = await pair_daemon(
      {
        set: async (values) => void writes.push(values),
      },
      { base_url: "http://127.0.0.1:7373/", token: "  secret-token  " },
    );

    assert.deepEqual(result, { ok: true, base_url: "http://127.0.0.1:7373", token: "secret-token" });
    assert.deepEqual(writes, [{ [DAEMON_SETTINGS_KEY]: { daemon: { base_url: "http://127.0.0.1:7373", token: "secret-token" } } }]);
  });

  it("rejects missing tokens without writing daemon settings", async () => {
    let wrote = false;

    const result = await pair_daemon(
      {
        set: async () => void (wrote = true),
      },
      { base_url: "http://127.0.0.1:7373", token: " " },
    );

    assert.equal(wrote, false);
    assert.deepEqual(result, { ok: false, error: "Daemon token is required." });
  });
});
