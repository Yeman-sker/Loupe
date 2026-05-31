import { createServer as createNodeServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { mkdir, open, readFile, rename, writeFile } from "node:fs/promises";
import { constants } from "node:fs";
import { dirname, join } from "node:path";
import { homedir } from "node:os";
import { randomBytes } from "node:crypto";
import {
  error_codes,
  LOUPE_DAEMON_NAME,
  LOUPE_DEFAULT_PORT,
  LOUPE_TOKEN_MIN_BYTES,
  type HealthPayload,
  type ListMarksResponse,
  type ProjectScopeCandidate,
  type ServerStatusFile,
} from "@loupe/shared";

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

const DEFAULT_VERSION = "0.0.0";
const MAX_BODY_BYTES = 1_048_576;

export function resolveLoupeHome(home?: string): string {
  if (!home || home === "~/.loupe") return join(homedir(), ".loupe");
  if (home === "~") return homedir();
  if (home.startsWith("~/")) return join(homedir(), home.slice(2));
  return home;
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

  const server = createNodeServer((request, response) => {
    void handleRequest(request, response, { port, token, version });
  }) as LoupeHttpServer;

  server.loupe = { port, token, home, version };
  return server;
}

async function handleRequest(
  request: IncomingMessage,
  response: ServerResponse,
  context: { port: number; token: string; version: string },
): Promise<void> {
  const url = new URL(request.url ?? "/", "http://127.0.0.1");

  if (request.method === "GET" && url.pathname === "/health") {
    const payload: HealthPayload = {
      ok: true,
      name: LOUPE_DAEMON_NAME,
      version: context.version,
      port: context.port,
      requires_auth: true,
    };
    writeJson(response, 200, payload);
    return;
  }

  if (isProtectedPath(url.pathname) && !isAuthorized(request, context.token)) {
    writeJson(response, 401, { error: { code: error_codes.unauthorized, message: "Authorization bearer token is required." } });
    return;
  }

  if (url.pathname === "/v1/marks" || url.pathname.startsWith("/v1/marks/")) {
    writeJson(response, 200, { marks: [] });
    return;
  }

  if (url.pathname === "/mcp") {
    if (request.method !== "POST") {
      writeJson(response, 405, { error: { code: error_codes.invalid_request, message: "MCP endpoint requires POST." } });
      return;
    }
    await handleMcp(request, response);
    return;
  }

  writeJson(response, 404, { error: { code: error_codes.not_found, message: "Not found." } });
}

function isProtectedPath(pathname: string): boolean {
  return pathname === "/mcp" || pathname === "/v1/marks" || pathname.startsWith("/v1/marks/");
}

function isAuthorized(request: IncomingMessage, token: string): boolean {
  const received = parseBearerToken(request.headers.authorization);
  return token.length > 0 && received === token;
}

async function handleMcp(request: IncomingMessage, response: ServerResponse): Promise<void> {
  let rpc: JsonRpcRequest;
  try {
    rpc = JSON.parse(await readRequestBody(request)) as JsonRpcRequest;
  } catch {
    writeJson(response, 400, jsonRpcError(null, -32700, "Parse error"));
    return;
  }

  const id = isJsonRpcId(rpc.id) ? rpc.id : null;
  if (rpc.jsonrpc !== "2.0" || typeof rpc.method !== "string") {
    writeJson(response, 200, jsonRpcError(id, -32600, "Invalid Request"));
    return;
  }

  if (rpc.method === "tools/list") {
    writeJson(response, 200, {
      jsonrpc: "2.0",
      id,
      result: {
        tools: [
          {
            name: "list_marks",
            description: "List Loupe marks for a required project scope. Phase 0 returns an empty mark set.",
            inputSchema: {
              type: "object",
              properties: {
                project_id: { type: "string" },
                workspace_root_hash: { type: "string" },
                url: { type: "string" },
                route_key: { type: "string" },
                task_status: { type: "string", enum: ["open", "resolved", "archived"] },
              },
              additionalProperties: true,
            },
          },
        ],
      },
    });
    return;
  }

  if (rpc.method === "tools/call") {
    const call = isRecord(rpc.params) ? rpc.params : undefined;
    const name = typeof call?.name === "string" ? call.name : undefined;
    const args = isRecord(call?.arguments) ? call.arguments : {};
    if (name !== "list_marks") {
      writeJson(response, 200, jsonRpcError(id, -32601, "Method not found"));
      return;
    }
    const result = listMarks(args);
    if (result === undefined) {
      writeJson(
        response,
        200,
        jsonRpcError(id, -32000, "Project scope is required.", { code: error_codes.scope_required }),
      );
      return;
    }
    writeJson(response, 200, { jsonrpc: "2.0", id, result });
    return;
  }

  writeJson(response, 200, jsonRpcError(id, -32601, "Method not found"));
}

function listMarks(args: Record<string, unknown>): ListMarksResponse | undefined {
  if (typeof args.project_id === "string" && args.project_id.length > 0) {
    return { project: pickProject(args, args.project_id), marks: [] };
  }
  if (
    typeof args.workspace_root_hash === "string" &&
    args.workspace_root_hash.length > 0 &&
    typeof args.url === "string" &&
    args.url.length > 0 &&
    typeof args.route_key === "string" &&
    args.route_key.length > 0
  ) {
    return { project: pickProject(args, args.workspace_root_hash), marks: [] };
  }
  return undefined;
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

function writeJson(response: ServerResponse, statusCode: number, payload: unknown): void {
  const body = JSON.stringify(payload);
  response.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(body),
  });
  response.end(body);
}

function jsonRpcError(id: string | number | null, code: number, message: string, data?: JsonValue): unknown {
  return { jsonrpc: "2.0", id, error: data === undefined ? { code, message } : { code, message, data } };
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
