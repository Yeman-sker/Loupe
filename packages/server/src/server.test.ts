import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AddressInfo } from "node:net";
import { error_codes, LOUPE_DAEMON_NAME, LOUPE_TOKEN_MIN_BYTES } from "@loupe/shared";
import { createServer, ensureToken, serverStatusPathForHome, tokenPathForHome, writeServerStatus } from "./server.js";

const originCases: ReadonlyArray<{ name: string; origin?: string }> = [
  { name: "absent Origin" },
  { name: "Origin: null", origin: "null" },
  { name: "localhost origin", origin: "http://localhost:5173" },
  { name: "chrome-extension origin", origin: "chrome-extension://abcdefghijklmnopabcdefghijklmnop" },
];

type JsonRpcResponse = {
  jsonrpc?: unknown;
  id?: unknown;
  result?: unknown;
  error?: {
    data?: {
      code?: unknown;
    };
  };
};

describe("Loupe Phase 0 HTTP contract", () => {
  const token = "phase-0-test-token";
  const server = createServer({ port: 0, token, version: "phase-0-test" });
  let baseUrl = "";

  before(async () => {
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", () => {
        server.off("error", reject);
        const address = server.address() as AddressInfo;
        baseUrl = `http://127.0.0.1:${address.port}`;
        resolve();
      });
    });
  });

  after(async () => {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  });

  it("serves anonymous /health with Loupe identity", async () => {
    const response = await fetch(`${baseUrl}/health`);
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.ok, true);
    assert.equal(body.name, LOUPE_DAEMON_NAME);
    assert.equal(body.version, "phase-0-test");
    assert.equal(body.requires_auth, true);
    assert.equal(typeof body.port, "number");
  });

  for (const originCase of originCases) {
    it(`rejects no-token /mcp for ${originCase.name}`, async () => {
      const headers = new Headers({ "content-type": "application/json" });
      if (originCase.origin !== undefined) headers.set("origin", originCase.origin);
      const response = await fetch(`${baseUrl}/mcp`, {
        method: "POST",
        headers,
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
      });
      assert.equal(response.status, 401);
      assert.deepEqual(await response.json(), {
        error: { code: error_codes.unauthorized, message: "Authorization bearer token is required." },
      });
    });

    it(`rejects no-token /v1/marks for ${originCase.name}`, async () => {
      const headers = new Headers();
      if (originCase.origin !== undefined) headers.set("origin", originCase.origin);
      const response = await fetch(`${baseUrl}/v1/marks`, { headers });
      assert.equal(response.status, 401);
      assert.deepEqual(await response.json(), {
        error: { code: error_codes.unauthorized, message: "Authorization bearer token is required." },
      });
    });
  }

  it("returns SCOPE_REQUIRED for authorized unscoped list_marks", async () => {
    const body = await callListMarks(baseUrl, token, {});
    assert.equal(body.jsonrpc, "2.0");
    assert.equal(body.id, "list-unscoped");
    assert.equal(body.error?.data?.code, error_codes.scope_required);
  });

  it("returns empty marks for authorized project_id scoped list_marks", async () => {
    const body = await callListMarks(baseUrl, token, { project_id: "project-123" }, "list-project");
    assert.equal(body.jsonrpc, "2.0");
    assert.equal(body.id, "list-project");
    assert.deepEqual(body.result, { project: { project_id: "project-123" }, marks: [] });
  });

  it("returns empty marks for authorized route scoped list_marks", async () => {
    const args = {
      workspace_root_hash: "root-hash-123",
      url: "https://example.test/dashboard",
      route_key: "/dashboard",
    };
    const body = await callListMarks(baseUrl, token, args, "list-route");
    assert.equal(body.jsonrpc, "2.0");
    assert.equal(body.id, "list-route");
    assert.deepEqual(body.result, { project: { project_id: args.workspace_root_hash, ...args }, marks: [] });
  });
});

describe("Loupe Phase 0 token and server status files", () => {
  it("creates a non-empty random-shaped token and server status in a supplied home", async () => {
    const home = await mkdtemp(join(tmpdir(), "loupe-server-test-"));
    try {
      const token = await ensureToken({ home });
      assert.match(token, /^[A-Za-z0-9_-]+$/);
      assert.ok(Buffer.from(token, "base64url").byteLength >= LOUPE_TOKEN_MIN_BYTES);
      assert.equal((await readFile(tokenPathForHome(home), "utf8")).trim(), token);

      const startedAt = "2026-05-31T00:00:00.000Z";
      const status = await writeServerStatus({ home, port: 49152, pid: 12345, startedAt });
      assert.deepEqual(status, {
        pid: 12345,
        port: 49152,
        token_path: tokenPathForHome(home),
        started_at: startedAt,
      });
      assert.deepEqual(JSON.parse(await readFile(serverStatusPathForHome(home), "utf8")), status);
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });
});

async function callListMarks(
  baseUrl: string,
  token: string,
  args: Record<string, unknown>,
  id = "list-unscoped",
): Promise<JsonRpcResponse> {
  const response = await fetch(`${baseUrl}/mcp`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id,
      method: "tools/call",
      params: { name: "list_marks", arguments: args },
    }),
  });
  assert.equal(response.status, 200);
  return (await response.json()) as JsonRpcResponse;
}
