import { after, before, describe, it } from "node:test";
import { createServer as createNodeServer, type Server as NodeServer } from "node:http";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { AddressInfo } from "node:net";
import { error_codes, is_agent_mark, LOUPE_DAEMON_NAME, LOUPE_DEFAULT_PORT, LOUPE_SCHEMA_VERSION, LOUPE_TOKEN_MIN_BYTES, type AgentMark, type Annotation, type Locator } from "@loupe-server/shared";
import { ensure, init, logs, parseCli, runCli, serve, status } from "./cli.js";
import { forwardJsonRpcMessage, parseProxyArgs } from "./mcp-proxy.js";
import { createServer, ensureToken, homeHashForHome, projectIdForWorkspaceRootHash, resolveLoupeHome, serverLogPathForHome, serverStatusPathForHome, tokenPathForHome, workspaceRootHashForRoot, writeServerStatus, type LoupeHttpServer } from "./server.js";

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
    data?: Record<string, unknown>;
  };
};

describe("Loupe Phase 0 HTTP contract", () => {
  const token = "phase-0-test-token";
  let server: LoupeHttpServer;
  let home = "";
  let baseUrl = "";

  before(async () => {
    home = await mkdtemp(join(tmpdir(), "loupe-http-contract-"));
    server = createServer({ home, port: 0, token, version: "phase-0-test" });
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
    await rm(home, { recursive: true, force: true });
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
    assert.equal(body.home_hash, await homeHashForHome(home));
    assert.equal(body.workspace_root_hash, await workspaceRootHashForRoot(process.cwd()));
    assert.equal(body.project_id, projectIdForWorkspaceRootHash(body.workspace_root_hash));
    assert.equal(body.home, undefined);
    assert.equal(body.token, undefined);
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

  it("exposes Phase 3 MCP mark tools", async () => {
    const response = await fetch(`${baseUrl}/mcp`, {
      method: "POST",
      headers: { ...authHeaders(token), "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: "tools-list", method: "tools/list" }),
    });

    assert.equal(response.status, 200);
    const body = (await response.json()) as JsonRpcResponse;
    assert.equal(body.jsonrpc, "2.0");
    assert.equal(body.id, "tools-list");
    assert.ok(isRecord(body.result));
    assert.ok(Array.isArray(body.result.tools));
    const names = body.result.tools.map((tool) => (isRecord(tool) ? tool.name : undefined));
    assert.deepEqual(names, ["list_marks", "get_mark", "resolve_mark", "delete_mark"]);
  });

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
    assert.deepEqual(mcpStructuredContent(body), { project: { project_id: "project-123" }, marks: [] });
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
    assert.deepEqual(mcpStructuredContent(body), { project: { project_id: projectIdForWorkspaceRootHash(args.workspace_root_hash), ...args }, marks: [] });
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
        project_id: projectIdForWorkspaceRootHash("root-hash-123"),
        workspace_root_hash: "root-hash-123",
        url: "https://example.test/dashboard",
        route_key: "/dashboard",
      },
      marks: [],
    });
  });


  it("allows extension CORS preflight for protected mark sync", async () => {
    const response = await fetch(`${baseUrl}/v1/marks`, {
      method: "OPTIONS",
      headers: {
        origin: "http://127.0.0.1:5173",
        "access-control-request-method": "POST",
        "access-control-request-headers": "authorization,content-type",
      },
    });

    assert.equal(response.status, 204);
    assert.equal(response.headers.get("access-control-allow-origin"), "http://127.0.0.1:5173");
    assert.match(response.headers.get("access-control-allow-methods") ?? "", /POST/);
    assert.match(response.headers.get("access-control-allow-headers") ?? "", /authorization/);
  });
  it("stores a valid Annotation and returns a low-noise mark", async () => {
    const annotation = sampleAnnotation({ id: "rest-create-1", project_id: "rest-project-create", session_id: "rest-session-create" });
    const response = await postMark(baseUrl, token, annotation);

    assert.equal(response.status, 200);
    const body = await response.json();
    assert.deepEqual(body, { mark: expectedAgentMark(annotation) });
    assert.equal("schema_version" in body.mark, false);
    assert.equal("sync" in body.mark, false);
    assert.equal("context" in body.mark, false);
    assert.equal("replies" in body.mark, false);
    assert.equal("screenshot_id" in body.mark.media, false);
  });

  it("returns MCP AgentMarks with snake_case low-noise schema and no raw internals", async () => {
    const annotation = sampleAnnotation({ id: "mcp-contract-1", project_id: "mcp-project-contract", session_id: "mcp-session-contract" });
    annotation.context.layout = { display: "grid", position: "absolute", box_sizing: "border-box", flex_direction: "column", gap: "8px" };
    annotation.context.framework = { name: "react", component: "SecretButton", source_hint: { file: "src/SecretButton.tsx", line: 42, confidence: 0.9 } };
    annotation.sync = { status: "failed", retry_count: 3, last_error: "token expired", last_synced_at: "2026-05-31T00:01:00.000Z" };
    annotation.media = { has_screenshot: true, screenshot_id: "shot-secret" };
    annotation.replies = { items: [{ author: "agent", text: "internal reply", at: "2026-05-31T00:02:00.000Z" }] };

    await assertOk(await postMark(baseUrl, token, annotation));
    const body = await callMcpTool(baseUrl, token, "get_mark", { id: annotation.id, project_id: annotation.project.project_id }, "mcp-contract");

    assert.equal(body.jsonrpc, "2.0");
    assert.equal(body.id, "mcp-contract");
    const mark = mcpStructuredContent(body);
    assert.deepEqual(mark, expectedAgentMark(annotation));
    assert.equal(is_agent_mark(mark), true);
    assertAgentMarkLowNoise(mark as AgentMark);
    assertNoLeakedKeys(mark, [
      "schema_version",
      "sync",
      "context",
      "layout",
      "position",
      "viewport",
      "replies",
      "token",
      "last_error",
      "last_synced_at",
      "retry_count",
      "screenshot_id",
      "screenshot_bytes",
      "storage_key",
      "sessions",
      "tombstones",
      "task_resolved_at",
      "deleted_at",
      "workspaceRootHash",
      "routeKey",
      "selectorPreview",
      "hasScreenshot",
    ]);
  });

  it("returns project-scoped MCP lists without mixing same-origin marks", async () => {
    const origin = "https://mcp-clean-project.test";
    const first = sampleAnnotation({ id: "mcp-clean-project-1", project_id: "mcp-clean-project-a", session_id: "mcp-clean-session-a", origin, url: `${origin}/shared`, route_key: "/shared" });
    const second = sampleAnnotation({ id: "mcp-clean-project-2", project_id: "mcp-clean-project-b", session_id: "mcp-clean-session-b", origin, url: `${origin}/shared`, route_key: "/shared" });
    await assertOk(await postMark(baseUrl, token, first));
    await assertOk(await postMark(baseUrl, token, second));

    const firstList = await callMcpTool(baseUrl, token, "list_marks", { project_id: first.project.project_id }, "mcp-clean-first");
    const secondList = await callMcpTool(baseUrl, token, "list_marks", { project_id: second.project.project_id }, "mcp-clean-second");

    assert.deepEqual(mcpStructuredContent(firstList), { project: candidateFor(first), marks: [expectedAgentMark(first)] });
    assert.deepEqual(mcpStructuredContent(secondList), { project: candidateFor(second), marks: [expectedAgentMark(second)] });
  });

  it("supports MCP initialize and initialized notification before tool discovery", async () => {
    const initialized = await fetch(`${baseUrl}/mcp`, {
      method: "POST",
      headers: { ...authHeaders(token), "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: "init", method: "initialize", params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "test", version: "0" } } }),
    });
    assert.equal(initialized.status, 200);
    assert.deepEqual(await initialized.json(), {
      jsonrpc: "2.0",
      id: "init",
      result: {
        protocolVersion: "2024-11-05",
        capabilities: { tools: {} },
        serverInfo: { name: LOUPE_DAEMON_NAME, version: "phase-0-test" },
      },
    });

    const notification = await fetch(`${baseUrl}/mcp`, {
      method: "POST",
      headers: { ...authHeaders(token), "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }),
    });
    assert.equal(notification.status, 204);

    const list = await fetch(`${baseUrl}/mcp`, {
      method: "POST",
      headers: { ...authHeaders(token), "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: "tools", method: "tools/list" }),
    });
    assert.equal(list.status, 200);
    assert.equal(((await list.json()) as { result: { tools: unknown[] } }).result.tools.length, 4);
  });

  it("rejects UUID-like bare-id MCP get, resolve, and delete", async () => {
    const annotation = sampleAnnotation({ id: "123e4567-e89b-12d3-a456-426614174000", project_id: "mcp-project-uuid", session_id: "mcp-session-uuid" });
    await assertOk(await postMark(baseUrl, token, annotation));

    for (const [tool, id] of [["get_mark", "mcp-uuid-get"], ["resolve_mark", "mcp-uuid-resolve"], ["delete_mark", "mcp-uuid-delete"]] as const) {
      const body = await callMcpTool(baseUrl, token, tool, { id: annotation.id }, id);
      assert.equal(body.jsonrpc, "2.0");
      assert.equal(body.id, id);
      assert.equal(body.error?.data?.code, error_codes.scope_required);
      assert.equal(body.result, undefined);
    }
  });

  it("returns a Save-to-Agent readable mark through MCP list_marks under the daemon-online gate", async () => {
    const annotation = sampleAnnotation({ id: "mcp-p95-1", project_id: "mcp-project-p95", session_id: "mcp-session-p95" });

    const start = performance.now();
    await assertOk(await postMark(baseUrl, token, annotation));
    const body = await callMcpTool(baseUrl, token, "list_marks", { project_id: annotation.project.project_id }, "mcp-p95-list");
    const elapsedMs = performance.now() - start;

    assert.equal(body.jsonrpc, "2.0");
    assert.equal(body.id, "mcp-p95-list");
    assert.ok(elapsedMs < 2000, `Expected Save-to-Agent readable first stage under 2000ms, got ${elapsedMs}ms`);
    const listed = mcpStructuredContent(body) as { marks: AgentMark[] };
    assert.deepEqual(listed, { project: candidateFor(annotation), marks: [expectedAgentMark(annotation)] });
    assertAgentMarkLowNoise(listed.marks[0]!);
  });

  it("returns MCP tool result content for list_marks", async () => {
    const annotation = sampleAnnotation({ id: "mcp-envelope-1", project_id: "mcp-project-envelope", session_id: "mcp-session-envelope" });
    await assertOk(await postMark(baseUrl, token, annotation));
    const body = await callMcpTool(baseUrl, token, "list_marks", { project_id: annotation.project.project_id }, "mcp-envelope-list");

    assert.equal(body.jsonrpc, "2.0");
    assert.equal(body.id, "mcp-envelope-list");
    assert.ok(isRecord(body.result));
    assert.ok(Array.isArray(body.result.content));
    assert.deepEqual(body.result.content[0], { type: "text", text: JSON.stringify({ project: candidateFor(annotation), marks: [expectedAgentMark(annotation)] }, null, 2) });
    assert.deepEqual(body.result.structuredContent, { project: candidateFor(annotation), marks: [expectedAgentMark(annotation)] });
  });

  it("gets a posted Annotation as a low-noise AgentMark through MCP get_mark", async () => {
    const annotation = sampleAnnotation({ id: "mcp-get-1", project_id: "mcp-project-get", session_id: "mcp-session-get" });
    await assertOk(await postMark(baseUrl, token, annotation));

    const body = await callMcpTool(baseUrl, token, "get_mark", { id: annotation.id, project_id: annotation.project.project_id }, "mcp-get");

    assert.equal(body.jsonrpc, "2.0");
    assert.equal(body.id, "mcp-get");
    const mark = mcpStructuredContent(body);
    assert.deepEqual(mark, expectedAgentMark(annotation));
    assertAgentMarkLowNoise(mark as AgentMark);
  });

  it("resolves through MCP only with project assertion and read-back reports resolved", async () => {
    const annotation = sampleAnnotation({ id: "mcp-resolve-1", project_id: "mcp-project-resolve", session_id: "mcp-session-resolve" });
    await assertOk(await postMark(baseUrl, token, annotation));

    const bare = await callMcpTool(baseUrl, token, "resolve_mark", { id: annotation.id }, "mcp-resolve-bare");
    assert.equal(bare.jsonrpc, "2.0");
    assert.equal(bare.id, "mcp-resolve-bare");
    assert.equal(bare.error?.data?.code, error_codes.scope_required);

    const resolved = await callMcpTool(baseUrl, token, "resolve_mark", { id: annotation.id, project_id: annotation.project.project_id }, "mcp-resolve");
    assert.equal(resolved.jsonrpc, "2.0");
    assert.equal(resolved.id, "mcp-resolve");
    assert.deepEqual(mcpStructuredContent(resolved), { ok: true, task_status: "resolved" });

    const readBack = await callMcpTool(baseUrl, token, "get_mark", { id: annotation.id, project_id: annotation.project.project_id }, "mcp-resolve-read");
    assert.equal(readBack.jsonrpc, "2.0");
    assert.equal(readBack.id, "mcp-resolve-read");
    const resolvedMark = mcpStructuredContent(readBack);
    assert.ok(isRecord(resolvedMark));
    assert.ok(isRecord(resolvedMark.lifecycle));
    assert.equal(resolvedMark.lifecycle.task_status, "resolved");
    assert.equal(typeof resolvedMark.lifecycle.updated_at, "string");
    assertAgentMarkLowNoise(resolvedMark as AgentMark);
  });

  it("deletes through MCP with project assertion and removes the mark from project lists", async () => {
    const annotation = sampleAnnotation({ id: "mcp-delete-1", project_id: "mcp-project-delete", session_id: "mcp-session-delete" });
    await assertOk(await postMark(baseUrl, token, annotation));

    const bare = await callMcpTool(baseUrl, token, "delete_mark", { id: annotation.id }, "mcp-delete-bare");
    assert.equal(bare.jsonrpc, "2.0");
    assert.equal(bare.id, "mcp-delete-bare");
    assert.equal(bare.error?.data?.code, error_codes.scope_required);

    const deleted = await callMcpTool(baseUrl, token, "delete_mark", { id: annotation.id, project_id: annotation.project.project_id }, "mcp-delete");
    assert.equal(deleted.jsonrpc, "2.0");
    assert.equal(deleted.id, "mcp-delete");
    const deletedResult = mcpStructuredContent(deleted);
    assert.ok(isRecord(deletedResult));
    assert.equal(deletedResult.ok, true);
    assert.equal(typeof deletedResult.deleted_at, "string");

    const list = await callMcpTool(baseUrl, token, "list_marks", { project_id: annotation.project.project_id }, "mcp-delete-list");
    assert.equal(list.jsonrpc, "2.0");
    assert.equal(list.id, "mcp-delete-list");
    assert.deepEqual(mcpStructuredContent(list), { project: { project_id: annotation.project.project_id }, marks: [] });
  });

  it("returns MULTI_PROJECT candidates and no mixed marks for MCP same-origin list_marks", async () => {
    const origin = "https://mcp-multi-project.test";
    const first = sampleAnnotation({ id: "mcp-multi-project-1", project_id: "mcp-multi-project-a", session_id: "mcp-multi-session-a", origin, url: `${origin}/shared`, route_key: "/shared" });
    const second = sampleAnnotation({ id: "mcp-multi-project-2", project_id: "mcp-multi-project-b", session_id: "mcp-multi-session-b", origin, url: `${origin}/shared`, route_key: "/shared" });
    await assertOk(await postMark(baseUrl, token, first));
    await assertOk(await postMark(baseUrl, token, second));

    const body = await callMcpTool(baseUrl, token, "list_marks", { origin }, "mcp-multi-project");

    assert.equal(body.jsonrpc, "2.0");
    assert.equal(body.id, "mcp-multi-project");
    assert.equal(body.error?.data?.code, error_codes.multi_project);
    assert.deepEqual(body.error?.data, {
      code: error_codes.multi_project,
      message: "Project scope matches multiple projects.",
      candidates: [candidateFor(first), candidateFor(second)],
    });
    assert.equal(body.result, undefined);
  });

  it("accepts workspace_root_hash as project assertion for MCP get, resolve, and delete", async () => {
    const annotation = sampleAnnotation({ id: "mcp-workspace-assertion", project_id: "mcp-workspace-project", session_id: "mcp-workspace-session", workspace_root_hash: "workspace-assertion-root" });
    await assertOk(await postMark(baseUrl, token, annotation));

    const read = await callMcpTool(baseUrl, token, "get_mark", { id: annotation.id, workspace_root_hash: annotation.project.workspace_root_hash }, "mcp-workspace-get");
    assert.deepEqual(mcpStructuredContent(read), expectedAgentMark(annotation));

    const resolved = await callMcpTool(baseUrl, token, "resolve_mark", { id: annotation.id, workspace_root_hash: annotation.project.workspace_root_hash }, "mcp-workspace-resolve");
    assert.deepEqual(mcpStructuredContent(resolved), { ok: true, task_status: "resolved" });

    const deleted = await callMcpTool(baseUrl, token, "delete_mark", { id: annotation.id, workspace_root_hash: annotation.project.workspace_root_hash }, "mcp-workspace-delete");
    const deletedResult = mcpStructuredContent(deleted);
    assert.ok(isRecord(deletedResult));
    assert.equal(deletedResult.ok, true);
  });

  it("requires and accepts project assertion for REST mark reads", async () => {
    const annotation = sampleAnnotation({ id: "rest-read-1", project_id: "rest-project-read", session_id: "rest-session-read" });
    await assertOk(await postMark(baseUrl, token, annotation));

    const bare = await fetch(`${baseUrl}/v1/marks/${annotation.id}`, { headers: authHeaders(token) });
    assert.equal(bare.status, 400);
    assert.deepEqual(await bare.json(), {
      error: { code: error_codes.scope_required, message: "Project assertion is required to read a mark." },
    });

    const response = await fetch(`${baseUrl}/v1/marks/${annotation.id}?project_id=${annotation.project.project_id}`, { headers: authHeaders(token) });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { mark: expectedAgentMark(annotation) });
  });

  it("sets resolved for asserted REST resolve and rejects bare id resolve", async () => {
    const annotation = sampleAnnotation({ id: "rest-resolve-1", project_id: "rest-project-resolve", session_id: "rest-session-resolve" });
    await assertOk(await postMark(baseUrl, token, annotation));

    const bare = await fetch(`${baseUrl}/v1/marks/${annotation.id}/resolve`, { method: "POST", headers: authHeaders(token) });
    assert.equal(bare.status, 400);
    assert.deepEqual(await bare.json(), {
      error: { code: error_codes.scope_required, message: "Project assertion is required to resolve a mark." },
    });

    const response = await fetch(`${baseUrl}/v1/marks/${annotation.id}/resolve?project_id=${annotation.project.project_id}`, { method: "POST", headers: authHeaders(token) });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { ok: true, task_status: "resolved" });

    const readBack = await fetch(`${baseUrl}/v1/marks/${annotation.id}?project_id=${annotation.project.project_id}`, { headers: authHeaders(token) });
    assert.equal(readBack.status, 200);
    const body = await readBack.json();
    assert.equal(body.mark.lifecycle.task_status, "resolved");
    assert.equal(typeof body.mark.lifecycle.updated_at, "string");
  });

  it("removes active mark and returns deleted_at for asserted REST delete and rejects bare id delete", async () => {
    const annotation = sampleAnnotation({ id: "rest-delete-1", project_id: "rest-project-delete", session_id: "rest-session-delete" });
    await assertOk(await postMark(baseUrl, token, annotation));

    const bare = await fetch(`${baseUrl}/v1/marks/${annotation.id}`, { method: "DELETE", headers: authHeaders(token) });
    assert.equal(bare.status, 400);
    assert.deepEqual(await bare.json(), {
      error: { code: error_codes.scope_required, message: "Project assertion is required to delete a mark." },
    });

    const response = await fetch(`${baseUrl}/v1/marks/${annotation.id}?project_id=${annotation.project.project_id}`, { method: "DELETE", headers: authHeaders(token) });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.ok, true);
    assert.equal(typeof body.deleted_at, "string");

    const list = await fetch(`${baseUrl}/v1/marks?project_id=${annotation.project.project_id}`, { headers: authHeaders(token) });
    assert.equal(list.status, 200);
    assert.deepEqual(await list.json(), { project: { project_id: annotation.project.project_id }, marks: [] });
  });

  it("rejects wrong project assertion with ASSERTION_MISMATCH", async () => {
    const annotation = sampleAnnotation({ id: "rest-mismatch-1", project_id: "rest-project-mismatch", session_id: "rest-session-mismatch" });
    await assertOk(await postMark(baseUrl, token, annotation));

    const response = await fetch(`${baseUrl}/v1/marks/${annotation.id}?project_id=wrong-project`, { headers: authHeaders(token) });
    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), {
      error: { code: error_codes.assertion_mismatch, message: "Project assertion does not match mark." },
    });
  });

  it("returns MULTI_PROJECT candidates for multi-project same-origin list", async () => {
    const origin = "https://multi-project.test";
    const first = sampleAnnotation({ id: "multi-project-1", project_id: "multi-project-a", session_id: "multi-session-a", origin, url: `${origin}/shared`, route_key: "/shared" });
    const second = sampleAnnotation({ id: "multi-project-2", project_id: "multi-project-b", session_id: "multi-session-b", origin, url: `${origin}/shared`, route_key: "/shared" });
    await assertOk(await postMark(baseUrl, token, first));
    await assertOk(await postMark(baseUrl, token, second));

    const query = new URLSearchParams({ origin: first.project.origin });
    const response = await fetch(`${baseUrl}/v1/marks?${query}`, { headers: authHeaders(token) });
    assert.equal(response.status, 409);
    assert.deepEqual(await response.json(), {
      error: {
        code: error_codes.multi_project,
        message: "Project scope matches multiple projects.",
        candidates: [candidateFor(first), candidateFor(second)],
      },
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

describe("Loupe Phase 3 marks store health", () => {
  it("reports corrupt marks.json backup warning on /health", async () => {
    const home = await mkdtemp(join(tmpdir(), "loupe-server-test-"));
    const token = "phase-3-health-token";
    await writeFile(join(home, "marks.json"), "{not-json", "utf8");
    const server = createServer({ home, port: 0, token, version: "phase-3-health-test" });
    try {
      await listenEphemeral(server);
      const address = server.address() as AddressInfo;
      const response = await fetch(`http://127.0.0.1:${address.port}/health`);

      assert.equal(response.status, 200);
      const body = await response.json();
      assert.equal(body.ok, true);
      assert.deepEqual(body.warnings, [
        {
          code: "CORRUPT_MARKS_JSON",
          message: "marks.json was corrupt JSON and was backed up.",
          file: body.warnings[0].file,
        },
      ]);
      assert.match(body.warnings[0].file, /^marks\.json\.corrupted\./);

      const rawLog = await readFile(serverLogPathForHome(home), "utf8");
      assert.match(rawLog, /WARN health warning CORRUPT_MARKS_JSON/);
      assert.doesNotMatch(rawLog, new RegExp(token));
    } finally {
      if (server.listening) await closeServer(server);
      await rm(home, { recursive: true, force: true });
    }
  });

  it("initializes an empty marks store after backing up corrupt marks.json", async () => {
    const home = await mkdtemp(join(tmpdir(), "loupe-server-test-"));
    const token = "phase-4-corrupt-init-token";
    await writeFile(join(home, "marks.json"), "{not-json", "utf8");
    const server = createServer({ home, port: 0, token, version: "phase-4-corrupt-init-test" });
    try {
      await listenEphemeral(server);
      const address = server.address() as AddressInfo;
      const response = await fetch(`http://127.0.0.1:${address.port}/v1/marks?project_id=empty-after-corrupt`, { headers: authHeaders(token) });

      assert.equal(response.status, 200);
      assert.deepEqual(await response.json(), { project: { project_id: "empty-after-corrupt" }, marks: [] });
    } finally {
      if (server.listening) await closeServer(server);
      await rm(home, { recursive: true, force: true });
    }
  });

  it("persists delete tombstones and rejects deleted mark resurrection after restart", async () => {
    const home = await mkdtemp(join(tmpdir(), "loupe-server-test-"));
    const token = "phase-4-tombstone-token";
    const annotation = sampleAnnotation({ id: "tombstone-resurrection", project_id: "tombstone-project", session_id: "tombstone-session" });
    let server: LoupeHttpServer | undefined = createServer({ home, port: 0, token, version: "phase-4-tombstone-test" });
    try {
      await listenEphemeral(server);
      let address = server.address() as AddressInfo;
      let baseUrl = `http://127.0.0.1:${address.port}`;
      await assertOk(await postMark(baseUrl, token, annotation));
      const deleted = await fetch(`${baseUrl}/v1/marks/${annotation.id}?project_id=${annotation.project.project_id}`, { method: "DELETE", headers: authHeaders(token) });
      assert.equal(deleted.status, 200);
      await closeServer(server);
      server = undefined;

      server = createServer({ home, port: 0, token, version: "phase-4-tombstone-test" });
      await listenEphemeral(server);
      address = server.address() as AddressInfo;
      baseUrl = `http://127.0.0.1:${address.port}`;
      await assertOk(await postMark(baseUrl, token, annotation));

      const list = await fetch(`${baseUrl}/v1/marks?project_id=${annotation.project.project_id}`, { headers: authHeaders(token) });
      assert.equal(list.status, 200);
      assert.deepEqual(await list.json(), { project: { project_id: annotation.project.project_id }, marks: [] });
    } finally {
      if (server?.listening) await closeServer(server);
      await rm(home, { recursive: true, force: true });
    }
  });
});

describe("Loupe Phase 0 CLI", () => {
  it("defaults CLI commands to the Loupe default port", () => {
    assert.deepEqual(parseCli(["serve"]), { command: "serve", port: LOUPE_DEFAULT_PORT });
    assert.deepEqual(parseCli(["ensure"]), { command: "ensure", port: LOUPE_DEFAULT_PORT });
    assert.deepEqual(parseCli(["init"]), { command: "init", port: LOUPE_DEFAULT_PORT });
    assert.deepEqual(parseCli(["status"]), { command: "status", port: LOUPE_DEFAULT_PORT });
    assert.deepEqual(parseCli(["logs"]), { command: "logs", port: LOUPE_DEFAULT_PORT });
    assert.deepEqual(parseCli(["logs", "--all"]), { command: "logs", port: LOUPE_DEFAULT_PORT, allLogs: true });
    assert.deepEqual(parseCli(["status", "--port", "41234", "--home", "/tmp/loupe-test"]), { command: "status", port: 41234, home: "/tmp/loupe-test" });

    assert.deepEqual(parseCli(["mcp-proxy"]), { command: "mcp-proxy", port: LOUPE_DEFAULT_PORT });
    assert.deepEqual(parseProxyArgs(["--url", "http://127.0.0.1:7000/mcp", "--token-path", "/tmp/loupe-token"]), { url: "http://127.0.0.1:7000/mcp", tokenPath: "/tmp/loupe-token" });
  });

  it("defaults direct serve calls to the Loupe default port", async () => {
    const home = await mkdtemp(join(tmpdir(), "loupe-server-test-"));
    let server: LoupeHttpServer | undefined;
    try {
      try {
        server = await serve({ home });
      } catch (error) {
        if (!(error instanceof Error)) throw error;
        assert.equal(error.message, `Port ${LOUPE_DEFAULT_PORT} is occupied by a non-Loupe service.`);
        return;
      }
      assert.equal(server.loupe.port, LOUPE_DEFAULT_PORT);
    } finally {
      if (server !== undefined) await closeServer(server);
      await rm(home, { recursive: true, force: true });
    }
  });

  it("prints a serve summary and streams only WARN/ERROR to the serve console", async () => {
    const home = await mkdtemp(join(tmpdir(), "loupe-server-test-"));
    const stdout = new MemoryStream();
    let server: LoupeHttpServer | undefined;
    try {
      server = await serve({ home, port: 0 }, stdout);
      const address = server.address() as AddressInfo;
      assert.match(stdout.text, /Loupe daemon listening on http:\/\/127\.0\.0\.1:0/);
      assert.match(stdout.text, new RegExp(`Loupe home: ${escapeRegExp(home)}`));
      assert.match(stdout.text, /Marks store: .*marks\.json/);
      assert.match(stdout.text, /Projects: 0/);
      assert.match(stdout.text, /Marks: 0 open, 0 total/);
      assert.match(stdout.text, /MCP: ready at http:\/\/127\.0\.0\.1:0\/mcp/);
      assert.match(stdout.text, /Logs: .*server\.log/);

      const annotation = sampleAnnotation({ id: "serve-log-created", project_id: "serve-log-project", session_id: "serve-log-session" });
      await assertOk(await postMark(`http://127.0.0.1:${address.port}`, server.loupe.token, annotation));
      assert.doesNotMatch(stdout.text, /mark created/);

      const unauthorized = await fetch(`http://127.0.0.1:${address.port}/v1/marks`);
      assert.equal(unauthorized.status, 401);
      assert.match(stdout.text, /WARN unauthorized GET \/v1\/marks/);
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

  it("classifies Loupe health and non-Loupe health-shaped services during ensure", async () => {
    const home = await mkdtemp(join(tmpdir(), "loupe-server-test-"));
    const loupe = createNodeServer((_request, response) => {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ ok: true, name: LOUPE_DAEMON_NAME, version: "phase-4-health", port: (loupe.address() as AddressInfo).port, requires_auth: true }));
    });
    const other = createNodeServer((_request, response) => {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ ok: true, name: LOUPE_DAEMON_NAME, version: "phase-4-health", port: 0, requires_auth: false }));
    });
    try {
      await listenEphemeral(loupe);
      let address = loupe.address() as AddressInfo;
      assert.equal(await ensure({ home, port: address.port }), undefined);

      await listenEphemeral(other);
      address = other.address() as AddressInfo;
      await assert.rejects(
        ensure({ home, port: address.port }),
        new Error(`Port ${address.port} is occupied by a non-Loupe service.`),
      );
    } finally {
      if (loupe.listening) await closeServer(loupe);
      if (other.listening) await closeServer(other);
      await rm(home, { recursive: true, force: true });
    }
  });

  it("initializes home, token, server metadata, and prints next steps without a daemon", async () => {
    const home = await mkdtemp(join(tmpdir(), "loupe-server-test-"));
    const stdout = new MemoryStream();
    try {
      assert.equal(await init({ home, port: 9 }, stdout), 0);
      assert.ok((await readFile(tokenPathForHome(home), "utf8")).trim().length > 0);
      assert.deepEqual(JSON.parse(await readFile(serverStatusPathForHome(home), "utf8")).port, 9);
      assert.match(stdout.text, /Loupe initialized/);
      assert.match(stdout.text, /\/loupe:marks/);
      assert.match(stdout.text, /Daemon: not running yet/);
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });

  it("initializes successfully when running daemon home matches requested home", async () => {
    const home = await mkdtemp(join(tmpdir(), "loupe-server-test-"));
    const stdout = new MemoryStream();
    const server = createServer({ home, port: 0, token: "phase-5-init-match-token", version: "phase-5-init-match" });
    try {
      await listenEphemeral(server);
      const address = server.address() as AddressInfo;
      assert.equal(await init({ home, port: address.port }, stdout), 0);
      assert.ok((await readFile(tokenPathForHome(home), "utf8")).trim().length > 0);
      assert.equal(JSON.parse(await readFile(serverStatusPathForHome(home), "utf8")).port, 0);
      assert.match(stdout.text, /Loupe initialized/);
      assert.match(stdout.text, /Daemon: running on port/);
    } finally {
      if (server.listening) await closeServer(server);
      await rm(home, { recursive: true, force: true });
    }
  });

  it("treats equivalent relative home spellings as the same running daemon home", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "loupe-server-cwd-"));
    const daemonHomeSpelling = ".loupe";
    const requestedHomeSpelling = "././.loupe";
    const differentHome = ".loupe-other";
    const stdout = new MemoryStream();
    const originalCwd = process.cwd();
    process.chdir(cwd);
    const canonicalHome = resolve(process.cwd(), ".loupe");
    const server = createServer({ home: daemonHomeSpelling, port: 0, token: "phase-5-canonical-home-token", version: "phase-5-canonical-home" });
    try {
      assert.equal(resolveLoupeHome(daemonHomeSpelling), canonicalHome);
      assert.equal(resolveLoupeHome(requestedHomeSpelling), canonicalHome);
      await mkdir(canonicalHome, { recursive: true });
      await mkdir(differentHome);
      assert.equal(await homeHashForHome(daemonHomeSpelling), await homeHashForHome(requestedHomeSpelling));
      assert.notEqual(await homeHashForHome(daemonHomeSpelling), await homeHashForHome(differentHome));

      await listenEphemeral(server);
      const address = server.address() as AddressInfo;
      const response = await fetch(`http://127.0.0.1:${address.port}/health`);
      const health = await response.json() as Record<string, unknown>;
      assert.equal(health.home_hash, await homeHashForHome(requestedHomeSpelling));
      assert.equal(health.home, undefined);
      assert.equal(health.token, undefined);

      assert.equal(await init({ home: requestedHomeSpelling, port: address.port }, stdout), 0);
      assert.ok((await readFile(tokenPathForHome(requestedHomeSpelling), "utf8")).trim().length > 0);
      assert.equal(JSON.parse(await readFile(serverStatusPathForHome(requestedHomeSpelling), "utf8")).port, 0);
      assert.match(stdout.text, /Loupe initialized/);
      assert.match(stdout.text, /Daemon: running on port/);
    } finally {
      process.chdir(originalCwd);
      if (server.listening) await closeServer(server);
      await rm(cwd, { recursive: true, force: true });
    }
  });


  it("treats symlinked and real home paths as the same running daemon home", async (test) => {
    const parent = await mkdtemp(join(tmpdir(), "loupe-server-symlink-"));
    const realHome = join(parent, "real-home");
    const linkedHome = join(parent, "linked-home");
    const differentHome = join(parent, "different-home");
    const stdout = new MemoryStream();
    let server: LoupeHttpServer | undefined;
    try {
      await mkdir(realHome);
      await mkdir(differentHome);
      try {
        await symlink(realHome, linkedHome, "dir");
      } catch (error) {
        if (isNodeErrorCode(error, "EPERM") || isNodeErrorCode(error, "EACCES") || isNodeErrorCode(error, "ENOTSUP")) {
          test.skip(`symlinked Loupe home assertion skipped: ${error.code}`);
          return;
        }
        throw error;
      }

      assert.equal(await homeHashForHome(linkedHome), await homeHashForHome(realHome));
      assert.notEqual(await homeHashForHome(linkedHome), await homeHashForHome(differentHome));

      server = createServer({ home: linkedHome, port: 0, token: "phase-5-symlink-home-token", version: "phase-5-symlink-home" });
      await listenEphemeral(server);
      const address = server.address() as AddressInfo;
      const response = await fetch(`http://127.0.0.1:${address.port}/health`);
      const health = await response.json() as Record<string, unknown>;
      assert.equal(health.home_hash, await homeHashForHome(realHome));
      assert.equal(health.home, undefined);
      assert.equal(health.token, undefined);

      assert.equal(await init({ home: realHome, port: address.port }, stdout), 0);
      assert.ok((await readFile(tokenPathForHome(realHome), "utf8")).trim().length > 0);
      assert.equal(JSON.parse(await readFile(serverStatusPathForHome(realHome), "utf8")).port, 0);
      assert.match(stdout.text, /Loupe initialized/);
      assert.match(stdout.text, /Daemon: running on port/);
    } finally {
      if (server?.listening) await closeServer(server);
      await rm(parent, { recursive: true, force: true });
    }
  });
  it("fails init clearly when running daemon home differs from requested home", async () => {
    const daemonHome = await mkdtemp(join(tmpdir(), "loupe-server-test-"));
    const requestedHome = await mkdtemp(join(tmpdir(), "loupe-server-test-"));
    const stdout = new MemoryStream();
    const server = createServer({ home: daemonHome, port: 0, token: "phase-5-init-mismatch-token", version: "phase-5-init-mismatch" });
    try {
      await listenEphemeral(server);
      const address = server.address() as AddressInfo;
      const response = await fetch(`http://127.0.0.1:${address.port}/health`);
      const health = await response.json() as Record<string, unknown>;
      assert.equal(health.home_hash, await homeHashForHome(daemonHome));
      assert.equal(health.home, undefined);
      assert.equal(health.token, undefined);

      assert.equal(await init({ home: requestedHome, port: address.port }, stdout), 1);
      assert.match(stdout.text, /different or unverifiable home/);
      assert.match(stdout.text, /Repair:/);
      assert.doesNotMatch(stdout.text, /Loupe initialized/);
      await assert.rejects(readFile(tokenPathForHome(requestedHome), "utf8"), { code: "ENOENT" });
      await assert.rejects(readFile(serverStatusPathForHome(requestedHome), "utf8"), { code: "ENOENT" });
    } finally {
      if (server.listening) await closeServer(server);
      await rm(daemonHome, { recursive: true, force: true });
      await rm(requestedHome, { recursive: true, force: true });
    }
  });

  it("reports healthy status when running daemon home matches requested home", async () => {
    const home = await mkdtemp(join(tmpdir(), "loupe-server-test-"));
    const stdout = new MemoryStream();
    const server = createServer({ home, port: 0, token: "phase-5-status-match-token", version: "phase-5-status-match" });
    try {
      await ensureToken({ home });
      await listenEphemeral(server);
      const address = server.address() as AddressInfo;
      await writeServerStatus({ home, port: address.port });

      assert.equal(await status({ home, port: address.port }, stdout), 0);
      assert.match(stdout.text, /Loupe home:/);
      assert.match(stdout.text, /Daemon: Loupe running on port/);
      assert.match(stdout.text, /Token: present/);
      assert.doesNotMatch(stdout.text, /not for requested home/);
      assert.doesNotMatch(stdout.text, /different from or unverifiable/);
    } finally {
      if (server.listening) await closeServer(server);
      await rm(home, { recursive: true, force: true });
    }
  });

  it("reports healthy status for symlink-equivalent requested home", async (test) => {
    const parent = await mkdtemp(join(tmpdir(), "loupe-server-status-symlink-"));
    const realHome = join(parent, "real-home");
    const linkedHome = join(parent, "linked-home");
    const stdout = new MemoryStream();
    let server: LoupeHttpServer | undefined;
    try {
      await mkdir(realHome);
      try {
        await symlink(realHome, linkedHome, "dir");
      } catch (error) {
        if (isNodeErrorCode(error, "EPERM") || isNodeErrorCode(error, "EACCES") || isNodeErrorCode(error, "ENOTSUP")) {
          test.skip(`symlinked Loupe status assertion skipped: ${error.code}`);
          return;
        }
        throw error;
      }

      assert.equal(await homeHashForHome(linkedHome), await homeHashForHome(realHome));
      server = createServer({ home: linkedHome, port: 0, token: "phase-5-status-symlink-token", version: "phase-5-status-symlink" });
      await ensureToken({ home: realHome });
      await listenEphemeral(server);
      const address = server.address() as AddressInfo;
      await writeServerStatus({ home: realHome, port: address.port });

      assert.equal(await status({ home: realHome, port: address.port }, stdout), 0);
      assert.match(stdout.text, /Daemon: Loupe running on port/);
      assert.match(stdout.text, /Token: present/);
      assert.doesNotMatch(stdout.text, /not for requested home/);
      assert.doesNotMatch(stdout.text, /different from or unverifiable/);
    } finally {
      if (server?.listening) await closeServer(server);
      await rm(parent, { recursive: true, force: true });
    }
  });

  it("fails status clearly when running daemon home differs from requested home with local metadata", async () => {
    const daemonHome = await mkdtemp(join(tmpdir(), "loupe-server-test-"));
    const requestedHome = await mkdtemp(join(tmpdir(), "loupe-server-test-"));
    const stdout = new MemoryStream();
    const server = createServer({ home: daemonHome, port: 0, token: "phase-5-status-mismatch-token", version: "phase-5-status-mismatch" });
    try {
      await ensureToken({ home: requestedHome });
      await listenEphemeral(server);
      const address = server.address() as AddressInfo;
      await writeServerStatus({ home: requestedHome, port: address.port });
      assert.notEqual(await homeHashForHome(daemonHome), await homeHashForHome(requestedHome));

      assert.equal(await status({ home: requestedHome, port: address.port }, stdout), 1);
      assert.match(stdout.text, /Loupe home:/);
      assert.match(stdout.text, /not for requested home/);
      assert.match(stdout.text, /different from or unverifiable/);
      assert.match(stdout.text, /Repair: stop that daemon/);
      assert.match(stdout.text, /Token: present/);
      assert.match(stdout.text, /Server status: present/);
      assert.doesNotMatch(stdout.text, /Daemon: Loupe running on port \d+\./);
    } finally {
      if (server.listening) await closeServer(server);
      await rm(daemonHome, { recursive: true, force: true });
      await rm(requestedHome, { recursive: true, force: true });
    }
  });

  it("reports missing token with non-zero repair guidance", async () => {
    const home = await mkdtemp(join(tmpdir(), "loupe-server-test-"));
    const stdout = new MemoryStream();
    try {
      assert.equal(await status({ home, port: 9 }, stdout), 1);
      assert.match(stdout.text, /Token: missing/);
      assert.match(stdout.text, /Repair: run loupe init/);
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });

  it("reports a non-Loupe occupied port with non-zero repair guidance", async () => {
    const dummy = createNodeServer((_request, response) => {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ ok: true, name: "not-loupe" }));
    });
    const home = await mkdtemp(join(tmpdir(), "loupe-server-test-"));
    const stdout = new MemoryStream();
    try {
      await ensureToken({ home });
      await listenEphemeral(dummy);
      const address = dummy.address() as AddressInfo;
      assert.equal(await status({ home, port: address.port }, stdout), 1);
      assert.match(stdout.text, /occupied by a non-Loupe service/);
      assert.match(stdout.text, /stop that service/);
    } finally {
      if (dummy.listening) await closeServer(dummy);
      await rm(home, { recursive: true, force: true });
    }
  });

  it("reports missing and daemon-written logs without dumping the whole file", async () => {
    const missingHome = await mkdtemp(join(tmpdir(), "loupe-server-test-"));
    const stdout = new MemoryStream();
    const stderr = new MemoryStream();
    try {
      assert.equal(await logs({ home: missingHome }, stdout, stderr), 1);
      assert.match(stderr.text, /No Loupe server log found/);
    } finally {
      await rm(missingHome, { recursive: true, force: true });
    }

    const home = await mkdtemp(join(tmpdir(), "loupe-server-test-"));
    const token = "phase-5-log-token";
    const server = createServer({ home, port: 0, token, version: "phase-5-log-test" });
    try {
      await listenEphemeral(server);
      const address = server.address() as AddressInfo;
      const response = await fetch(`http://127.0.0.1:${address.port}/v1/marks`);
      assert.equal(response.status, 401);

      const rawLog = await readFile(serverLogPathForHome(home), "utf8");
      assert.match(rawLog, /WARN unauthorized GET \/v1\/marks/);
      assert.doesNotMatch(rawLog, new RegExp(token));

      const present = new MemoryStream();
      assert.equal(await logs({ home }, present, new MemoryStream()), 2);
      assert.match(present.text, /Recent Loupe server errors\/warnings/);
      assert.match(present.text, /WARN unauthorized GET \/v1\/marks/);
    } finally {
      if (server.listening) await closeServer(server);
      await rm(home, { recursive: true, force: true });
    }
  });

  it("supports --all logs and records mark lifecycle without leaking mark content", async () => {
    const home = await mkdtemp(join(tmpdir(), "loupe-server-test-"));
    const token = "phase-5-log-all-token";
    const server = createServer({ home, port: 0, token, version: "phase-5-log-all-test" });
    try {
      await listenEphemeral(server);
      const address = server.address() as AddressInfo;
      const baseUrl = `http://127.0.0.1:${address.port}`;
      const annotation = sampleAnnotation({ id: "log-lifecycle-1", project_id: "log-project", session_id: "log-session" });

      await assertOk(await postMark(baseUrl, token, annotation));
      await assertOk(await postMark(baseUrl, token, annotation));
      const resolved = await fetch(`${baseUrl}/v1/marks/${annotation.id}/resolve?project_id=${annotation.project.project_id}`, { method: "POST", headers: authHeaders(token) });
      await assertOk(resolved);
      const readBack = await fetch(`${baseUrl}/v1/marks/${annotation.id}?project_id=${annotation.project.project_id}`, { headers: authHeaders(token) });
      const resolvedMark = (await readBack.json()).mark as AgentMark;
      const resolvedLifecycle = resolvedMark.lifecycle as unknown;
      assert.ok(isRecord(resolvedLifecycle));
      const resolvedAt = resolvedLifecycle.task_resolved_at;
      const noop = await fetch(`${baseUrl}/v1/marks/${annotation.id}/resolve?project_id=${annotation.project.project_id}`, { method: "POST", headers: authHeaders(token) });
      await assertOk(noop);
      const noopReadBack = await fetch(`${baseUrl}/v1/marks/${annotation.id}?project_id=${annotation.project.project_id}`, { headers: authHeaders(token) });
      const noopMark = (await noopReadBack.json()).mark as AgentMark;
      const noopLifecycle = noopMark.lifecycle as unknown;
      assert.ok(isRecord(noopLifecycle));
      assert.equal(noopLifecycle.task_resolved_at, resolvedAt);
      const deleted = await fetch(`${baseUrl}/v1/marks/${annotation.id}?project_id=${annotation.project.project_id}`, { method: "DELETE", headers: authHeaders(token) });
      assert.equal(deleted.status, 200);
      const repeatedDelete = await fetch(`${baseUrl}/v1/marks/${annotation.id}?project_id=${annotation.project.project_id}`, { method: "DELETE", headers: authHeaders(token) });
      assert.equal(repeatedDelete.status, 404);

      const rawLog = await readFile(serverLogPathForHome(home), "utf8");
      assert.match(rawLog, /INFO project=log-project session=log-session mark=log-lifecycle-1 mark created/);
      assert.match(rawLog, /INFO project=log-project session=log-session mark=log-lifecycle-1 mark updated/);
      assert.match(rawLog, /INFO project=log-project session=log-session mark=log-lifecycle-1 mark resolved/);
      assert.match(rawLog, /INFO project=log-project session=log-session mark=log-lifecycle-1 mark resolve noop/);
      assert.match(rawLog, /INFO project=log-project session=log-session mark=log-lifecycle-1 mark deleted/);
      assert.match(rawLog, /ERROR project=log-project mark=log-lifecycle-1 marks delete failed NOT_FOUND: Mark not found\./);
      assert.doesNotMatch(rawLog, /Inspect nested target/);
      assert.doesNotMatch(rawLog, /button\.save/);

      const defaultLogs = new MemoryStream();
      assert.equal(await logs({ home }, defaultLogs, new MemoryStream()), 2);
      assert.doesNotMatch(defaultLogs.text, /mark created/);
      assert.match(defaultLogs.text, /marks delete failed NOT_FOUND/);

      const allLogs = new MemoryStream();
      assert.equal(await logs({ home, allLogs: true }, allLogs, new MemoryStream()), 2);
      assert.match(allLogs.text, /mark created/);
      assert.match(allLogs.text, /marks delete failed NOT_FOUND/);
    } finally {
      if (server.listening) await closeServer(server);
      await rm(home, { recursive: true, force: true });
    }
  });

  it("surfaces corrupt marks.json as warning semantics", async () => {
    const home = await mkdtemp(join(tmpdir(), "loupe-server-test-"));
    const homeHash = await homeHashForHome(home);
    const loupe = createNodeServer((_request, response) => {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ ok: true, name: LOUPE_DAEMON_NAME, version: "phase-5-status-test", port: (loupe.address() as AddressInfo).port, requires_auth: true, home_hash: homeHash }));
    });
    const stdout = new MemoryStream();
    try {
      await ensureToken({ home });
      await listenEphemeral(loupe);
      const address = loupe.address() as AddressInfo;
      await writeServerStatus({ home, port: address.port });
      await writeFile(join(home, "marks.json"), "{not-json", "utf8");
      assert.equal(await status({ home, port: address.port }, stdout), 2);
      assert.match(stdout.text, /Marks store: warning corrupt JSON/);
      assert.match(stdout.text, /Repair: back up or remove marks\.json/);
    } finally {
      if (loupe.listening) await closeServer(loupe);
      await rm(home, { recursive: true, force: true });
    }
  });

  it("forwards stdio MCP payloads to daemon HTTP MCP with bearer token", async () => {
    const token = "phase-5-proxy-token";
    const server = createNodeServer(async (request, response) => {
      assert.equal(request.method, "POST");
      assert.equal(request.url, "/mcp");
      assert.equal(request.headers.authorization, `Bearer ${token}`);
      let body = "";
      for await (const chunk of request) body += String(chunk);
      assert.equal(body, JSON.stringify({ jsonrpc: "2.0", id: "proxy", method: "tools/list" }));
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ jsonrpc: "2.0", id: "proxy", result: { tools: [] } }));
    });
    try {
      await listenEphemeral(server);
      const address = server.address() as AddressInfo;
      const body = await forwardJsonRpcMessage(`http://127.0.0.1:${address.port}/mcp`, token, JSON.stringify({ jsonrpc: "2.0", id: "proxy", method: "tools/list" }));
      assert.equal(body, JSON.stringify({ jsonrpc: "2.0", id: "proxy", result: { tools: [] } }));
    } finally {
      if (server.listening) await closeServer(server);
    }
  });

  it("routes runCli output streams for status diagnostics", async () => {
    const home = await mkdtemp(join(tmpdir(), "loupe-server-test-"));
    const stdout = new MemoryStream();
    try {
      assert.equal(await runCli({ argv: ["status", "--home", home, "--port", "9"], stdout, stderr: new MemoryStream() }), 1);
      assert.match(stdout.text, /Loupe home:/);
      assert.match(stdout.text, /Token: missing/);
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });
});

function isNodeErrorCode(error: unknown, code: string): error is NodeJS.ErrnoException {
  return error instanceof Error && (error as NodeJS.ErrnoException).code === code;
}

function authHeaders(token: string): HeadersInit {
  return { authorization: `Bearer ${token}` };
}

async function postMark(baseUrl: string, token: string, annotation: Annotation): Promise<Response> {
  return fetch(`${baseUrl}/v1/marks`, {
    method: "POST",
    headers: { ...authHeaders(token), "content-type": "application/json" },
    body: JSON.stringify(annotation),
  });
}

async function assertOk(response: Response): Promise<void> {
  if (response.status !== 200) assert.fail(`Expected 200 response, got ${response.status}: ${await response.text()}`);
}

function sampleAnnotation(overrides: { id: string; project_id: string; session_id: string; workspace_root_hash?: string; route_key?: string; url?: string; origin?: string; branch?: string } = { id: "annotation-1", project_id: "project-abc", session_id: "session-def" }): Annotation {
  const locator = sampleLocator();
  const routeKey = overrides.route_key ?? "/page";
  const url = overrides.url ?? `https://example.test${routeKey}`;
  const project: Annotation["project"] = {
    project_id: overrides.project_id,
    workspace_root_hash: overrides.workspace_root_hash ?? "root-hash",
    origin: overrides.origin ?? "https://example.test",
    url,
    route_key: routeKey,
    session_id: overrides.session_id,
  };
  if (overrides.branch !== undefined) project.branch = overrides.branch;

  return {
    schema_version: LOUPE_SCHEMA_VERSION,
    id: overrides.id,
    project,
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

function expectedAgentMark(annotation: Annotation): AgentMark {
  const project: AgentMark["project"] = {
    project_id: annotation.project.project_id,
    workspace_root_hash: annotation.project.workspace_root_hash,
    url: annotation.project.url,
    route_key: annotation.project.route_key,
    session_id: annotation.project.session_id,
  };
  if (annotation.project.branch !== undefined) project.branch = annotation.project.branch;

  const target: AgentMark["target"] = {
    selector: annotation.target.locator.primary.selector,
    selector_preview: annotation.context.element.selector_preview,
    tag: annotation.context.element.tag,
    locator_status: annotation.target.resolution.locator_status,
    confidence: annotation.target.resolution.confidence,
    matched_by: annotation.target.resolution.matched_by,
  };
  if (annotation.target.locator.frame_path !== undefined) target.frame_path = annotation.target.locator.frame_path;
  if (annotation.target.locator.evidence.shadow_path !== undefined) target.shadow_path = annotation.target.locator.evidence.shadow_path;
  if (annotation.target.boundary !== undefined) target.boundary = annotation.target.boundary;
  if (annotation.context.element.text !== undefined) target.text = annotation.context.element.text;
  if (annotation.context.element.classes !== undefined) target.classes = annotation.context.element.classes;
  if (annotation.target.locator.evidence.nth_path !== undefined) target.path = annotation.target.locator.evidence.nth_path;

  const mark: AgentMark = {
    id: annotation.id,
    project,
    intent: { comment: annotation.intent.comment, kind: annotation.intent.kind },
    target,
    media: { has_screenshot: annotation.media.has_screenshot },
    lifecycle: {
      task_status: annotation.lifecycle.task_status,
      created_at: annotation.lifecycle.created_at,
      updated_at: annotation.lifecycle.updated_at,
    },
  };

  const framework = annotation.context.framework;
  if (framework !== undefined) {
    const agentFramework: NonNullable<AgentMark["framework"]> = { name: framework.name };
    if (framework.component !== undefined) agentFramework.component = framework.component;
    if (framework.source_hint?.file !== undefined) {
      agentFramework.source_hint = framework.source_hint.line === undefined ? framework.source_hint.file : `${framework.source_hint.file}:${framework.source_hint.line}`;
    }
    mark.framework = agentFramework;
  }

  return mark;
}

function candidateFor(annotation: Annotation): Record<string, string> {
  return {
    project_id: annotation.project.project_id,
    workspace_root_hash: annotation.project.workspace_root_hash,
    origin: annotation.project.origin,
    url: annotation.project.url,
    route_key: annotation.project.route_key,
    session_id: annotation.project.session_id,
  };
}

async function callMcpTool(
  baseUrl: string,
  token: string,
  name: string,
  args: Record<string, unknown>,
  id = "mcp-call",
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
      params: { name, arguments: args },
    }),
  });
  assert.equal(response.status, 200);
  return (await response.json()) as JsonRpcResponse;
}

function mcpStructuredContent(response: JsonRpcResponse): unknown {
  assert.ok(isRecord(response.result));
  assert.ok(Array.isArray(response.result.content));
  assert.equal(response.result.content[0]?.type, "text");
  assert.equal(response.result.content[0]?.text, JSON.stringify(response.result.structuredContent, null, 2));
  return response.result.structuredContent;
}

async function callListMarks(
  baseUrl: string,
  token: string,
  args: Record<string, unknown>,
  id = "list-unscoped",
): Promise<JsonRpcResponse> {
  return callMcpTool(baseUrl, token, "list_marks", args, id);
}

function assertAgentMarkLowNoise(mark: AgentMark): void {
  assert.equal("schema_version" in mark, false);
  assert.equal("sync" in mark, false);
  assert.equal("context" in mark, false);
  assert.equal("replies" in mark, false);
  assert.equal("screenshot_id" in mark.media, false);
  assert.equal("screenshotId" in mark.media, false);
}

function assertNoLeakedKeys(value: unknown, disallowed: readonly string[]): void {
  if (!isRecord(value) && !Array.isArray(value)) return;
  for (const [key, child] of Object.entries(value)) {
    assert.equal(disallowed.includes(key), false, key);
    assertNoLeakedKeys(child, disallowed);
  }
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

class MemoryStream {
  text = "";

  write(chunk: string): boolean {
    this.text += chunk;
    return true;
  }
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
