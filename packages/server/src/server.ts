import { createServer as createNodeServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { appendFile, copyFile, mkdir, open, readFile, realpath, rename, writeFile } from "node:fs/promises";
import { constants } from "node:fs";
import { basename, join, resolve } from "node:path";
import { homedir } from "node:os";
import { createHash, randomBytes } from "node:crypto";
import {
  assert_annotation,
  assert_storage_envelope,
  error_codes,
  LOUPE_DAEMON_NAME,
  LOUPE_DEFAULT_PORT,
  LOUPE_SCHEMA_VERSION,
  LOUPE_TOKEN_MIN_BYTES,
  type AgentMark,
  type Annotation,
  type DeleteMarkResponse,
  type HealthPayload,
  type ListMarksResponse,
  type ProjectScopeCandidate,
  type ResolveMarkResponse,
  type ServerStatusFile,
  type StorageEnvelope,
} from "@loupe-server/shared";

export type LoupeHomeOptions = {
  home?: string;
};

export type TokenOptions = LoupeHomeOptions;

export type ServerStatusOptions = LoupeHomeOptions & {
  port?: number;
  pid?: number;
  tokenPath?: string;
  startedAt?: string;
};

export type LoupeServerOptions = LoupeHomeOptions & {
  port?: number;
  token?: string;
  version?: string;
  workspaceRoot?: string;
  branch?: string;
};

export type LoupeHttpServer = Server & {
  loupe: {
    port: number;
    token: string;
    home: string;
    version: string;
  };
};

type JsonRpcRequest = {
  jsonrpc?: unknown;
  id?: unknown;
  method?: unknown;
  params?: unknown;
};

type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
type StoreWarning = { code: string; message: string; file?: string };
type Mutation = "read" | "resolve" | "delete";

type MarkStore = {
  home: string;
  path: string;
  envelope: StorageEnvelope;
  warnings: StoreWarning[];
  save_chain: Promise<void>;
};

type RequestContext = {
  port: number;
  token: string;
  version: string;
  home: string;
  workspaceRoot: string;
  branch?: string;
  store: Promise<MarkStore>;
};

const DEFAULT_VERSION = "0.0.0";
const MAX_BODY_BYTES = 1_048_576;

export function resolveLoupeHome(home?: string): string {
  if (!home || home === "~/.loupe") return resolve(homedir(), ".loupe");
  if (home === "~") return resolve(homedir());
  if (home.startsWith("~/")) return resolve(homedir(), home.slice(2));
  return resolve(home);
}

export async function ensureLoupeHome(options: LoupeHomeOptions = {}): Promise<string> {
  const home = resolveLoupeHome(options.home);
  await mkdir(home, { recursive: true, mode: 0o700 });
  return home;
}

export function tokenPathForHome(home: string): string {
  return join(home, "token");
}

export function serverStatusPathForHome(home: string): string {
  return join(home, "server.json");
}

export function marksPathForHome(home: string): string {
  return join(home, "marks.json");
}

export function serverLogPathForHome(home: string): string {
  return join(home, "server.log");
}

export async function canonicalLoupeHome(home: string): Promise<string> {
  return realpath(resolveLoupeHome(home));
}

export async function homeHashForHome(home: string): Promise<string> {
  return sha256Base64Url(await canonicalLoupeHome(home));
}

export async function canonicalWorkspaceRoot(workspaceRoot: string): Promise<string> {
  return realpath(resolve(workspaceRoot));
}

export async function workspaceRootHashForRoot(workspaceRoot: string): Promise<string> {
  return sha256Base64Url(await canonicalWorkspaceRoot(workspaceRoot));
}

export function projectIdForWorkspaceRootHash(workspaceRootHash: string): string {
  return `loupe_v1_${workspaceRootHash}`;
}

function sha256Base64Url(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("base64url");
}

export async function ensureToken(options: TokenOptions = {}): Promise<string> {
  const home = await ensureLoupeHome(options);
  const tokenPath = tokenPathForHome(home);
  try {
    const existing = (await readFile(tokenPath, "utf8")).trim();
    if (existing.length > 0) return existing;
  } catch (error) {
    if (!isNodeErrorCode(error, "ENOENT")) throw error;
  }

  const token = randomBytes(LOUPE_TOKEN_MIN_BYTES).toString("base64url");
  const handle = await open(tokenPath, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY, 0o600);
  try {
    await handle.writeFile(`${token}\n`, "utf8");
  } finally {
    await handle.close();
  }
  return token;
}

export async function writeServerStatus(options: ServerStatusOptions = {}): Promise<ServerStatusFile> {
  const home = await ensureLoupeHome(options);
  const tokenPath = options.tokenPath ?? tokenPathForHome(home);
  const status: ServerStatusFile = {
    pid: options.pid ?? process.pid,
    port: options.port ?? LOUPE_DEFAULT_PORT,
    token_path: tokenPath,
    started_at: options.startedAt ?? new Date().toISOString(),
  };
  const statusPath = serverStatusPathForHome(home);
  const tmpPath = `${statusPath}.${process.pid}.tmp`;
  await writeFile(tmpPath, `${JSON.stringify(status, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  await rename(tmpPath, statusPath);
  return status;
}

export function parseBearerToken(header: string | string[] | undefined): string | undefined {
  if (Array.isArray(header) || header === undefined) return undefined;
  const trimmed = header.trim();
  if (!trimmed.startsWith("Bearer ")) return undefined;
  const token = trimmed.slice(7).trim();
  return token.length > 0 ? token : undefined;
}

export function createServer(options: LoupeServerOptions = {}): LoupeHttpServer {
  const port = options.port ?? LOUPE_DEFAULT_PORT;
  const token = options.token ?? "";
  const version = options.version ?? DEFAULT_VERSION;
  const home = resolveLoupeHome(options.home);
  const workspaceRoot = resolve(options.workspaceRoot ?? process.cwd());
  const store = loadMarkStore(home);
  const requestContext: RequestContext = { port, token, version, home, workspaceRoot, store };
  if (options.branch !== undefined) requestContext.branch = options.branch;

  const server = createNodeServer((request, response) => {
    void handleRequest(request, response, requestContext).catch((error: unknown) => {
      void handleRequestError(request, response, home, error);
    });
  }) as LoupeHttpServer;

  server.loupe = { port, token, home, version };
  return server;
}

async function handleRequest(request: IncomingMessage, response: ServerResponse, context: RequestContext): Promise<void> {
  writeCorsHeaders(response);

  if (request.method === "OPTIONS") {
    response.writeHead(204, { "content-length": 0 });
    response.end();
    return;
  }

  const url = new URL(request.url ?? "/", "http://127.0.0.1");

  if (request.method === "GET" && url.pathname === "/health") {
    const store = await context.store;
    const workspace_root_hash = await workspaceRootHashForRoot(context.workspaceRoot);
    const payload: HealthPayload & { warnings?: StoreWarning[] } = {
      ok: true,
      name: LOUPE_DAEMON_NAME,
      version: context.version,
      port: context.port,
      requires_auth: true,
      home_hash: await homeHashForHome(context.home),
      workspace_root_hash,
      project_id: projectIdForWorkspaceRootHash(workspace_root_hash),
    };
    if (context.branch !== undefined) payload.branch = context.branch;
    if (store.warnings.length > 0) {
      payload.warnings = store.warnings;
      for (const warning of store.warnings) await appendDaemonLog(store.home, "WARN", `health warning ${warning.code}${warning.file === undefined ? "" : ` file=${warning.file}`}: ${warning.message}`);
    }
    writeJson(response, 200, payload);
    return;
  }

  if (isProtectedPath(url.pathname) && !isAuthorized(request, context.token)) {
    await appendDaemonLog(context.home, "WARN", `unauthorized ${request.method ?? "UNKNOWN"} ${url.pathname}`);
    writeJson(response, 401, { error: { code: error_codes.unauthorized, message: "Authorization bearer token is required." } });
    return;
  }

  if (url.pathname === "/v1/marks" || url.pathname.startsWith("/v1/marks/")) {
    await handleMarks(request, response, url, await context.store);
    return;
  }

  if (url.pathname === "/mcp") {
    if (request.method !== "POST") {
      await appendDaemonLog(context.home, "WARN", `unsupported ${request.method ?? "UNKNOWN"} ${url.pathname}`);
      writeJson(response, 405, { error: { code: error_codes.invalid_request, message: "MCP endpoint requires POST." } });
      return;
    }
    await handleMcp(request, response, await context.store, context.version);
    return;
  }

  await appendDaemonLog(context.home, "WARN", `not found ${request.method ?? "UNKNOWN"} ${url.pathname}`);
  writeJson(response, 404, { error: { code: error_codes.not_found, message: "Not found." } });
}

function isProtectedPath(pathname: string): boolean {
  return pathname === "/mcp" || pathname === "/v1/marks" || pathname.startsWith("/v1/marks/");
}

function isAuthorized(request: IncomingMessage, token: string): boolean {
  const received = parseBearerToken(request.headers.authorization);
  return token.length > 0 && received === token;
}

async function loadMarkStore(home: string): Promise<MarkStore> {
  await mkdir(home, { recursive: true, mode: 0o700 });
  const path = marksPathForHome(home);
  const warnings: StoreWarning[] = [];
  let envelope = emptyEnvelope();

  try {
    const raw = await readFile(path, "utf8");
    const parsed = JSON.parse(raw) as unknown;
    assert_storage_envelope(parsed);
    envelope = parsed;
  } catch (error) {
    if (isNodeErrorCode(error, "ENOENT")) {
      // Empty first-run store.
    } else if (error instanceof SyntaxError) {
      const backup = `${path}.corrupted.${new Date().toISOString().replace(/[:.]/g, "-")}`;
      await copyOrRenameCorruptFile(path, backup);
      warnings.push({ code: "CORRUPT_MARKS_JSON", message: "marks.json was corrupt JSON and was backed up.", file: basename(backup) });
    } else {
      throw error;
    }
  }

  const store: MarkStore = { home, path, envelope, warnings, save_chain: Promise.resolve() };
  if (warnings.length > 0) await saveStore(store);
  return store;
}

function emptyEnvelope(): StorageEnvelope {
  return { schema_version: LOUPE_SCHEMA_VERSION, projects: {} };
}

async function copyOrRenameCorruptFile(path: string, backup: string): Promise<void> {
  try {
    await rename(path, backup);
  } catch (error) {
    if (!isNodeErrorCode(error, "EXDEV")) throw error;
    await copyFile(path, backup);
  }
}

async function saveStore(store: MarkStore): Promise<void> {
  const save = store.save_chain.then(async () => {
    await mkdir(store.home, { recursive: true, mode: 0o700 });
    const tmpPath = `${store.path}.${process.pid}.${Date.now()}.tmp`;
    await writeFile(tmpPath, `${JSON.stringify(store.envelope, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
    await rename(tmpPath, store.path);
  });
  store.save_chain = save.catch(() => undefined);
  await save;
}

async function handleMcp(request: IncomingMessage, response: ServerResponse, store: MarkStore, version: string): Promise<void> {
  let rpc: JsonRpcRequest;
  try {
    rpc = JSON.parse(await readRequestBody(request)) as JsonRpcRequest;
  } catch {
    await appendDaemonLog(store.home, "ERROR", "mcp parse error");
    writeJson(response, 400, jsonRpcError(null, -32700, "Parse error"));
    return;
  }

  const id = isJsonRpcId(rpc.id) ? rpc.id : null;
  if (rpc.jsonrpc !== "2.0" || typeof rpc.method !== "string") {
    await appendDaemonLog(store.home, "ERROR", "mcp invalid request");
    writeJson(response, 200, jsonRpcError(id, -32600, "Invalid Request"));
    return;
  }

  if (rpc.method === "initialize") {
    writeJson(response, 200, {
      jsonrpc: "2.0",
      id,
      result: {
        protocolVersion: "2024-11-05",
        capabilities: { tools: {} },
        serverInfo: { name: LOUPE_DAEMON_NAME, version },
      },
    });
    return;
  }

  if (rpc.method === "notifications/initialized") {
    response.writeHead(204, { "content-length": 0 });
    response.end();
    return;
  }

  if (rpc.method === "tools/list") {
    writeJson(response, 200, { jsonrpc: "2.0", id, result: { tools: mcpTools() } });
    return;
  }

  if (rpc.method === "tools/call") {
    const call = isRecord(rpc.params) ? rpc.params : undefined;
    const name = typeof call?.name === "string" ? call.name : undefined;
    const args = isRecord(call?.arguments) ? call.arguments : {};
    const result = await callMcpTool(store, name, args);
    if ("error" in result) {
      await appendDaemonLog(store.home, "ERROR", `mcp tools/call failed ${result.error.code}: ${result.error.message}`);
      writeJson(response, 200, jsonRpcError(id, -32000, result.error.message, result.error));
      return;
    }
    writeJson(response, 200, { jsonrpc: "2.0", id, result: mcpToolResult(result.result) });
    return;
  }

  await appendDaemonLog(store.home, "ERROR", `mcp method not found ${rpc.method}`);
  writeJson(response, 200, jsonRpcError(id, -32601, "Method not found"));
}

function mcpTools(): unknown[] {
  const scopeProperties = {
    project_id: { type: "string" },
    workspace_root_hash: { type: "string" },
    origin: { type: "string" },
    url: { type: "string" },
    route_key: { type: "string" },
    session_id: { type: "string" },
  };
  return [
    { name: "list_marks", description: "List Loupe marks for one asserted project scope.", inputSchema: { type: "object", properties: { ...scopeProperties, task_status: { type: "string", enum: ["open", "resolved", "archived"] } }, additionalProperties: true } },
    { name: "get_mark", description: "Get one Loupe mark by id with a project assertion.", inputSchema: { type: "object", properties: { id: { type: "string" }, ...scopeProperties }, required: ["id"], additionalProperties: true } },
    { name: "resolve_mark", description: "Resolve one Loupe mark by id with a project assertion.", inputSchema: { type: "object", properties: { id: { type: "string" }, resolution_note: { type: "string" }, ...scopeProperties }, required: ["id"], additionalProperties: true } },
    { name: "delete_mark", description: "Delete one Loupe mark by id with a project assertion.", inputSchema: { type: "object", properties: { id: { type: "string" }, reason: { type: "string" }, ...scopeProperties }, required: ["id"], additionalProperties: true } },
  ];
}

async function callMcpTool(store: MarkStore, name: string | undefined, args: Record<string, unknown>): Promise<{ result: unknown } | { error: { code: string; message: string; candidates?: ProjectScopeCandidate[] } }> {
  if (name === "list_marks") {
    const result = listMarks(store, args);
    if (result.kind === "ok") return { result: result.value };
    return { error: result.error };
  }
  if (name === "get_mark") {
    const result = findAssertedMark(store, args, "read");
    if (result.kind === "ok") return { result: toAgentMark(result.mark) };
    return { error: result.error };
  }
  if (name === "resolve_mark") {
    const result = await resolveMark(store, args);
    if (result.kind === "ok") return { result: result.value };
    return { error: result.error };
  }
  if (name === "delete_mark") {
    const result = await deleteMark(store, args);
    if (result.kind === "ok") return { result: result.value };
    return { error: result.error };
  }
  return { error: { code: error_codes.not_found, message: "Tool not found." } };
}

function mcpToolResult(value: unknown): { content: Array<{ type: "text"; text: string }>; structuredContent: unknown } {
  return {
    content: [{ type: "text", text: JSON.stringify(value, null, 2) }],
    structuredContent: value,
  };
}

async function handleMarks(request: IncomingMessage, response: ServerResponse, url: URL, store: MarkStore): Promise<void> {
  if (url.pathname === "/v1/marks") {
    if (request.method === "GET") {
      const result = listMarks(store, Object.fromEntries(url.searchParams));
      if (result.kind === "ok") writeJson(response, 200, result.value);
      else {
        await appendDaemonLog(store.home, "ERROR", `marks list failed ${result.error.code}: ${result.error.message}`);
        writeJson(response, result.error.code === error_codes.multi_project ? 409 : 400, { error: result.error });
      }
      return;
    }
    if (request.method === "POST") {
      let body: unknown;
      try {
        body = JSON.parse(await readRequestBody(request)) as unknown;
        assert_annotation(body);
      } catch {
        await appendDaemonLog(store.home, "ERROR", "marks invalid annotation");
        writeJson(response, 400, { error: { code: error_codes.invalid_request, message: "Expected Annotation wire contract." } });
        return;
      }
      await upsertMark(store, body);
      writeJson(response, 200, { mark: toAgentMark(body) });
      return;
    }
  }

  const path = markPath(url.pathname);
  if (path !== undefined) {
    const args = { ...Object.fromEntries(url.searchParams), id: path.id };
    if (request.method === "GET" && path.action === undefined) {
      const result = findAssertedMark(store, args, "read");
      if (result.kind === "ok") writeJson(response, 200, { mark: toAgentMark(result.mark) });
      else {
        await appendDaemonLog(store.home, "ERROR", `marks get failed ${result.error.code}: ${result.error.message}`);
        writeJson(response, result.error.code === error_codes.not_found ? 404 : 400, { error: result.error });
      }
      return;
    }
    if (request.method === "POST" && path.action === "resolve") {
      const result = await resolveMark(store, args);
      if (result.kind === "ok") writeJson(response, 200, result.value);
      else {
        await appendDaemonLog(store.home, "ERROR", `marks resolve failed ${result.error.code}: ${result.error.message}`);
        writeJson(response, result.error.code === error_codes.not_found ? 404 : 400, { error: result.error });
      }
      return;
    }
    if (request.method === "DELETE" && path.action === undefined) {
      const result = await deleteMark(store, args);
      if (result.kind === "ok") writeJson(response, 200, result.value);
      else {
        await appendDaemonLog(store.home, "ERROR", `marks delete failed ${result.error.code}: ${result.error.message}`);
        writeJson(response, result.error.code === error_codes.not_found ? 404 : 400, { error: result.error });
      }
      return;
    }
  }

  await appendDaemonLog(store.home, "WARN", `unsupported ${request.method ?? "UNKNOWN"} ${url.pathname}`);
  writeJson(response, 405, { error: { code: error_codes.invalid_request, message: "Unsupported marks operation." } });
}

function markPath(pathname: string): { id: string; action?: "resolve" } | undefined {
  const parts = pathname.split("/").filter(Boolean);
  if (parts.length === 3 && parts[0] === "v1" && parts[1] === "marks") return { id: decodeURIComponent(parts[2] ?? "") };
  if (parts.length === 4 && parts[0] === "v1" && parts[1] === "marks" && parts[3] === "resolve") {
    return { id: decodeURIComponent(parts[2] ?? ""), action: "resolve" };
  }
  return undefined;
}

async function upsertMark(store: MarkStore, annotation: Annotation): Promise<void> {
  const projectId = annotation.project.project_id;
  const sessionId = annotation.project.session_id;
  const project = (store.envelope.projects[projectId] ??= { sessions: {}, tombstones: [] });
  if (project.tombstones.includes(annotation.id)) return;
  const session = (project.sessions[sessionId] ??= { marks: [] });
  const index = session.marks.findIndex((mark) => mark.id === annotation.id);
  if (index === -1) session.marks.push(annotation);
  else session.marks[index] = annotation;
  await saveStore(store);
}

function listMarks(store: MarkStore, args: Record<string, unknown>): { kind: "ok"; value: ListMarksResponse } | { kind: "error"; error: { code: string; message: string; candidates?: ProjectScopeCandidate[] } } {
  const projects = matchingProjects(store, args);
  if (projects === undefined) return { kind: "error", error: { code: error_codes.scope_required, message: "Project scope is required." } };
  if (projects.length === 0) return { kind: "ok", value: { project: emptyScopeProject(args), marks: [] } };
  if (projects.length > 1) {
    return { kind: "error", error: { code: error_codes.multi_project, message: "Project scope matches multiple projects.", candidates: projects.map(candidateForProject) } };
  }

  const project = projects[0]!;
  const taskStatus = stringArg(args, "task_status");
  const marks = projectMarks(project.id, project.record)
    .filter((mark) => taskStatus === undefined || mark.lifecycle.task_status === taskStatus)
    .map(toAgentMark);
  return { kind: "ok", value: { project: candidateForProject(project), marks } };
}

function matchingProjects(store: MarkStore, args: Record<string, unknown>): Array<{ id: string; record: StorageEnvelope["projects"][string] }> | undefined {
  const projectId = stringArg(args, "project_id");
  const hasRouteScope = hasNonEmptyString(args, "url") || hasNonEmptyString(args, "route_key") || hasNonEmptyString(args, "workspace_root_hash") || hasNonEmptyString(args, "origin");
  if (projectId === undefined && !hasRouteScope) return undefined;

  const entries = Object.entries(store.envelope.projects).map(([id, record]) => ({ id, record }));
  return entries.filter((project) => {
    if (projectId !== undefined && project.id !== projectId) return false;
    return projectMarks(project.id, project.record).some((mark) => scopeMatches(mark, args, projectId !== undefined));
  });
}

function scopeMatches(mark: Annotation, args: Record<string, unknown>, allowProjectOnly: boolean): boolean {
  if (allowProjectOnly && !hasAnyRouteAssertion(args)) return true;
  return matchesOptional(mark.project.workspace_root_hash, args, "workspace_root_hash") &&
    matchesOptional(mark.project.origin, args, "origin") &&
    matchesOptional(mark.project.url, args, "url") &&
    matchesOptional(mark.project.route_key, args, "route_key") &&
    matchesOptional(mark.project.session_id, args, "session_id");
}

function hasAnyRouteAssertion(args: Record<string, unknown>): boolean {
  return hasNonEmptyString(args, "workspace_root_hash") || hasNonEmptyString(args, "origin") || hasNonEmptyString(args, "url") || hasNonEmptyString(args, "route_key") || hasNonEmptyString(args, "session_id");
}

function projectMarks(projectId: string, project: StorageEnvelope["projects"][string]): Annotation[] {
  const marks: Annotation[] = [];
  for (const [sessionId, session] of Object.entries(project.sessions)) {
    for (const mark of session.marks) {
      if (mark.project.project_id === projectId && mark.project.session_id === sessionId && mark.lifecycle.deleted_at === undefined) marks.push(mark);
    }
  }
  return marks;
}

function candidateForProject(project: { id: string; record: StorageEnvelope["projects"][string] }): ProjectScopeCandidate {
  const first = projectMarks(project.id, project.record)[0];
  if (first === undefined) return { project_id: project.id };
  const candidate: ProjectScopeCandidate = {
    project_id: project.id,
    workspace_root_hash: first.project.workspace_root_hash,
    origin: first.project.origin,
    url: first.project.url,
    route_key: first.project.route_key,
    session_id: first.project.session_id,
  };
  if (first.project.branch !== undefined) candidate.branch = first.project.branch;
  return candidate;
}

function findAssertedMark(store: MarkStore, args: Record<string, unknown>, mutation: Mutation): { kind: "ok"; mark: Annotation; project: StorageEnvelope["projects"][string] } | { kind: "error"; error: { code: string; message: string } } {
  const id = stringArg(args, "id");
  if (id === undefined) return { kind: "error", error: { code: error_codes.invalid_request, message: "Mark id is required." } };
  if (!hasProjectAssertion(args)) return { kind: "error", error: { code: error_codes.scope_required, message: `Project assertion is required to ${mutation} a mark.` } };
  let found: { mark: Annotation; project: StorageEnvelope["projects"][string] } | undefined;
  let sawId = false;
  for (const [projectId, project] of Object.entries(store.envelope.projects)) {
    for (const mark of projectMarks(projectId, project)) {
      if (mark.id !== id) continue;
      sawId = true;
      if (!assertionMatches(mark, args)) continue;
      if (found !== undefined) return { kind: "error", error: { code: error_codes.conflict, message: "Project assertion is not unique." } };
      found = { mark, project };
    }
  }
  if (found === undefined) {
    return sawId
      ? { kind: "error", error: { code: error_codes.assertion_mismatch, message: "Project assertion does not match mark." } }
      : { kind: "error", error: { code: error_codes.not_found, message: "Mark not found." } };
  }
  return { kind: "ok", ...found };
}

function hasProjectAssertion(args: Record<string, unknown>): boolean {
  if (hasNonEmptyString(args, "project_id") || hasNonEmptyString(args, "workspace_root_hash")) return true;
  return hasNonEmptyString(args, "url") || hasNonEmptyString(args, "origin") || hasNonEmptyString(args, "route_key");
}

function assertionMatches(mark: Annotation, args: Record<string, unknown>): boolean {
  const projectId = stringArg(args, "project_id");
  if (projectId !== undefined && mark.project.project_id !== projectId) return false;
  return scopeMatches(mark, args, projectId !== undefined);
}

async function resolveMark(store: MarkStore, args: Record<string, unknown>): Promise<{ kind: "ok"; value: ResolveMarkResponse } | { kind: "error"; error: { code: string; message: string } }> {
  const result = findAssertedMark(store, args, "resolve");
  if (result.kind === "error") return result;
  const now = new Date().toISOString();
  result.mark.lifecycle.task_status = "resolved";
  result.mark.lifecycle.updated_at = now;
  result.mark.lifecycle.task_resolved_at = now;
  await saveStore(store);
  return { kind: "ok", value: { ok: true, task_status: "resolved" } };
}

async function deleteMark(store: MarkStore, args: Record<string, unknown>): Promise<{ kind: "ok"; value: DeleteMarkResponse } | { kind: "error"; error: { code: string; message: string } }> {
  const result = findAssertedMark(store, args, "delete");
  if (result.kind === "error") return result;
  const deletedAt = new Date().toISOString();
  for (const session of Object.values(result.project.sessions)) {
    const index = session.marks.findIndex((mark) => mark.id === result.mark.id);
    if (index !== -1) {
      session.marks.splice(index, 1);
      break;
    }
  }
  if (!result.project.tombstones.includes(result.mark.id)) result.project.tombstones.push(result.mark.id);
  await saveStore(store);
  return { kind: "ok", value: { ok: true, deleted_at: deletedAt } };
}

function toAgentMark(annotation: Annotation): AgentMark {
  const framework = annotation.context.framework;
  const sourceHint = framework?.source_hint;
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
    intent: {
      comment: annotation.intent.comment,
      kind: annotation.intent.kind,
    },
    target,
    media: {
      has_screenshot: annotation.media.has_screenshot,
    },
    lifecycle: {
      task_status: annotation.lifecycle.task_status,
      created_at: annotation.lifecycle.created_at,
      updated_at: annotation.lifecycle.updated_at,
    },
  };

  if (framework !== undefined) {
    const agentFramework: NonNullable<AgentMark["framework"]> = { name: framework.name };
    if (framework.component !== undefined) agentFramework.component = framework.component;
    if (sourceHint?.file !== undefined) agentFramework.source_hint = sourceHint.line === undefined ? sourceHint.file : `${sourceHint.file}:${sourceHint.line}`;
    mark.framework = agentFramework;
  }

  return mark;
}

function emptyScopeProject(args: Record<string, unknown>): ProjectScopeCandidate {
  const projectId = stringArg(args, "project_id");
  if (projectId !== undefined) return pickProject(args, projectId);
  const workspaceRootHash = stringArg(args, "workspace_root_hash");
  if (workspaceRootHash !== undefined) return pickProject(args, projectIdForWorkspaceRootHash(workspaceRootHash));
  return pickProject(args, "");
}

function pickProject(args: Record<string, unknown>, fallbackProjectId: string): ProjectScopeCandidate {
  const project: ProjectScopeCandidate = { project_id: fallbackProjectId };
  copyString(args, project, "workspace_root_hash");
  copyString(args, project, "branch");
  copyString(args, project, "origin");
  copyString(args, project, "url");
  copyString(args, project, "route_key");
  copyString(args, project, "session_id");
  return project;
}

function copyString<T extends Record<string, unknown>, K extends string>(source: Record<string, unknown>, target: T, key: K): void {
  const value = source[key];
  if (typeof value === "string") {
    (target as Record<string, string>)[key] = value;
  }
}

async function readRequestBody(request: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of request) {
    const buffer = typeof chunk === "string" ? Buffer.from(chunk) : chunk;
    total += buffer.byteLength;
    if (total > MAX_BODY_BYTES) throw new Error("request body too large");
    chunks.push(buffer);
  }
  return Buffer.concat(chunks).toString("utf8");
}

function writeCorsHeaders(response: ServerResponse): void {
  response.setHeader("access-control-allow-origin", "*");
  response.setHeader("access-control-allow-methods", "GET,POST,DELETE,OPTIONS");
  response.setHeader("access-control-allow-headers", "authorization,content-type");
  response.setHeader("access-control-max-age", "600");
}

function writeJson(response: ServerResponse, statusCode: number, payload: unknown): void {
  const body = JSON.stringify(payload);
  response.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(body),
  });
  response.end(body);
}

async function handleRequestError(request: IncomingMessage, response: ServerResponse, home: string, error: unknown): Promise<void> {
  await appendDaemonLog(home, "ERROR", `request failed ${request.method ?? "UNKNOWN"} ${new URL(request.url ?? "/", "http://127.0.0.1").pathname}: ${error instanceof Error ? error.name : "non-error throw"}`);
  if (response.headersSent) {
    response.destroy();
    return;
  }
  writeJson(response, 500, { error: { code: error_codes.internal_error, message: "Internal server error." } });
}

async function appendDaemonLog(home: string, level: "ERROR" | "WARN", message: string): Promise<void> {
  try {
    await mkdir(home, { recursive: true, mode: 0o700 });
    await appendFile(serverLogPathForHome(home), `${new Date().toISOString()} ${level} ${message}\n`, { encoding: "utf8", mode: 0o600 });
  } catch {
    // Daemon logs are best-effort diagnostics only.
  }
}

function jsonRpcError(id: string | number | null, code: number, message: string, data?: JsonValue): unknown {
  return { jsonrpc: "2.0", id, error: data === undefined ? { code, message } : { code, message, data } };
}

function stringArg(args: Record<string, unknown>, key: string): string | undefined {
  const value = args[key];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function hasNonEmptyString(args: Record<string, unknown>, key: string): boolean {
  return stringArg(args, key) !== undefined;
}

function matchesOptional(actual: string | undefined, args: Record<string, unknown>, key: string): boolean {
  const expected = stringArg(args, key);
  return expected === undefined || actual === expected;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isJsonRpcId(value: unknown): value is string | number | null {
  return typeof value === "string" || typeof value === "number" || value === null;
}

function isNodeErrorCode(error: unknown, code: string): boolean {
  return error instanceof Error && "code" in error && (error as NodeJS.ErrnoException).code === code;
}
