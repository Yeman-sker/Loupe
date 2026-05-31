import { after, before, describe, it } from "node:test";
import { createServer as createNodeServer, type Server as NodeServer } from "node:http";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AddressInfo } from "node:net";
import { error_codes, LOUPE_DAEMON_NAME, LOUPE_DEFAULT_PORT, LOUPE_TOKEN_MIN_BYTES } from "@loupe/shared";
import { ensure, parseCli, serve } from "./cli.js";
import { createServer, ensureToken, serverStatusPathForHome, tokenPathForHome, writeServerStatus, type LoupeHttpServer } from "./server.js";

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

    it(`rejects no-token /v1/marks/some-id for ${originCase.name}`, async () => {
      const headers = new Headers();
      if (originCase.origin !== undefined) headers.set("origin", originCase.origin);
      const response = await fetch(`${baseUrl}/v1/marks/some-id`, { headers });
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

  it("returns SCOPE_REQUIRED for authorized unscoped REST list marks", async () => {
    const response = await fetch(`${baseUrl}/v1/marks`, { headers: { authorization: `Bearer ${token}` } });
    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), {
      error: { code: error_codes.scope_required, message: "Project scope is required." },
    });
  });

  it("returns empty marks for authorized project_id scoped REST list marks", async () => {
    const response = await fetch(`${baseUrl}/v1/marks?project_id=project-123`, {
      headers: { authorization: `Bearer ${token}` },
    });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { project: { project_id: "project-123" }, marks: [] });
  });

  it("returns empty marks for authorized route scoped REST list marks", async () => {
    const query = new URLSearchParams({
      workspace_root_hash: "root-hash-123",
      url: "https://example.test/dashboard",
      route_key: "/dashboard",
    });
    const response = await fetch(`${baseUrl}/v1/marks?${query}`, { headers: { authorization: `Bearer ${token}` } });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      project: {
        project_id: "root-hash-123",
        workspace_root_hash: "root-hash-123",
        url: "https://example.test/dashboard",
        route_key: "/dashboard",
      },
      marks: [],
    });
  });

  it("returns not implemented for authorized REST mark item reads", async () => {
    const response = await fetch(`${baseUrl}/v1/marks/some-id`, { headers: { authorization: `Bearer ${token}` } });
    assert.equal(response.status, 501);
    assert.deepEqual(await response.json(), {
      error: { code: error_codes.invalid_request, message: "Mark item operations are not implemented in Phase 0." },
    });
  });

  it("returns not implemented for authorized REST mark mutations", async () => {
    const response = await fetch(`${baseUrl}/v1/marks`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ project_id: "project-123" }),
    });
    assert.equal(response.status, 501);
    assert.deepEqual(await response.json(), {
      error: { code: error_codes.invalid_request, message: "Mark mutations are not implemented in Phase 0." },
    });
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

describe("Loupe Phase 0 CLI", () => {
  it("defaults serve and ensure to the Loupe default port", () => {
    assert.deepEqual(parseCli(["serve"]), { command: "serve", port: LOUPE_DEFAULT_PORT });
    assert.deepEqual(parseCli(["ensure"]), { command: "ensure", port: LOUPE_DEFAULT_PORT });
  });

  it("defaults direct serve calls to the Loupe default port", async () => {
    const home = await mkdtemp(join(tmpdir(), "loupe-server-test-"));
    let server: LoupeHttpServer | undefined;
    try {
      server = await serve({ home });
      assert.equal(server.loupe.port, LOUPE_DEFAULT_PORT);
    } finally {
      if (server !== undefined) await closeServer(server);
      await rm(home, { recursive: true, force: true });
    }
  });

  it("fails clearly when ensure probes a non-Loupe service on the requested port", async () => {
    const dummy = createNodeServer((_request, response) => {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ ok: true, name: "not-loupe" }));
    });

    await listenEphemeral(dummy);
    try {
      const address = dummy.address() as AddressInfo;
      await assert.rejects(
        ensure({ port: address.port }),
        new Error(`Port ${address.port} is occupied by a non-Loupe service.`),
      );
    } finally {
      await closeServer(dummy);
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

async function listenEphemeral(server: NodeServer): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });
}

async function closeServer(server: NodeServer | LoupeHttpServer): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}
