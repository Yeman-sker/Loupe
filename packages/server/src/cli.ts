#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { createServer, ensureLoupeHome, ensureToken, homeHashForHome, marksPathForHome, resolveLoupeHome, serverLogPathForHome, serverStatusPathForHome, tokenPathForHome, writeServerStatus, type LoupeHttpServer } from "./server.js";
import { assert_storage_envelope, LOUPE_DAEMON_NAME, LOUPE_DEFAULT_PORT, type HealthPayload, type ServerStatusFile, type StorageEnvelope } from "@loupe/shared";

export type CliCommand = "serve" | "ensure" | "init" | "status" | "logs";

export type CliOptions = {
  command: CliCommand;
  port: number;
  home?: string;
};

export type RunCliOptions = {
  argv?: string[];
  stdout?: Pick<NodeJS.WriteStream, "write">;
  stderr?: Pick<NodeJS.WriteStream, "write">;
};

type StatusCode = 0 | 1 | 2;

export async function runCli(options: RunCliOptions = {}): Promise<number> {
  const argv = options.argv ?? process.argv.slice(2);
  const stdout = options.stdout ?? process.stdout;
  const stderr = options.stderr ?? process.stderr;

  let parsed: CliOptions;
  try {
    parsed = parseCli(argv);
  } catch (error) {
    writeUsage(stderr);
    writeLine(stderr, error instanceof Error ? error.message : String(error));
    return 1;
  }

  try {
    if (parsed.command === "serve") {
      await serve(parsed);
      return 0;
    }
    if (parsed.command === "ensure") {
      await ensure(parsed);
      return 0;
    }
    if (parsed.command === "init") return await init(parsed, stdout);
    if (parsed.command === "status") return await status(parsed, stdout);
    return await logs(parsed, stdout, stderr);
  } catch (error) {
    writeLine(stderr, error instanceof Error ? error.message : String(error));
    return 1;
  }
}

export async function serve(options: { port?: number; home?: string }): Promise<LoupeHttpServer> {
  const port = options.port ?? LOUPE_DEFAULT_PORT;
  const home = homeOption(options.home);
  const token = await ensureToken(home);
  const server = createServer({ port, ...home, token });
  await listen(server, port);
  await writeServerStatus({ ...home, port, tokenPath: tokenPathForHome(server.loupe.home) });
  return server;
}

export async function ensure(options: { port?: number; home?: string }): Promise<LoupeHttpServer | undefined> {
  const port = options.port ?? LOUPE_DEFAULT_PORT;
  const health = await probeHealth(port);
  if (health.status === "loupe") {
    const home = homeOption(options.home);
    await ensureToken(home);
    await writeServerStatus({ ...home, port: health.payload.port });
    return undefined;
  }
  if (health.status === "other") {
    throw new Error(`Port ${port} is occupied by a non-Loupe service.`);
  }
  return serve({ ...options, port });
}

export function parseCli(argv: string[]): CliOptions {
  const command = argv[0];
  if (!isCliCommand(command)) {
    throw new Error("Expected command: serve, ensure, init, status, or logs.");
  }

  let port: number | undefined;
  let home: string | undefined;
  for (let index = 1; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--port") {
      const value = argv[index + 1];
      if (value === undefined) throw new Error("--port requires a value.");
      port = parsePort(value);
      index += 1;
      continue;
    }
    if (arg === "--home") {
      const value = argv[index + 1];
      if (value === undefined || value.length === 0) throw new Error("--home requires a value.");
      home = value;
      index += 1;
      continue;
    }
    throw new Error(`Unknown argument: ${arg ?? ""}`);
  }

  return { command, port: port ?? LOUPE_DEFAULT_PORT, ...(home === undefined ? {} : { home }) };
}

export async function init(options: { port?: number; home?: string }, stdout: Pick<NodeJS.WriteStream, "write"> = process.stdout): Promise<StatusCode> {
  const home = await ensureLoupeHome(homeOption(options.home));
  const port = options.port ?? LOUPE_DEFAULT_PORT;
  const health = await probeHealth(port);
  if (health.status === "loupe" && health.payload.home_hash !== await homeHashForHome(home)) {
    writeLine(stdout, `Error: Loupe daemon on port ${health.payload.port} is running for a different or unverifiable home.`);
    writeLine(stdout, `Repair: stop that daemon, rerun loupe init --home ${home} with --port <free-port>, or initialize against the daemon's original Loupe home.`);
    return 1;
  }

  await ensureToken({ home });
  if (health.status === "loupe") await writeServerStatus({ home, port: health.payload.port });
  else await writeServerStatus({ home, port, tokenPath: tokenPathForHome(home) });

  writeLine(stdout, `Loupe initialized at ${home}.`);
  if (health.status === "loupe") {
    writeLine(stdout, `Daemon: running on port ${health.payload.port}.`);
    writeWarnings(stdout, health.payload.warnings);
    writeLine(stdout, "Next: run /loupe:marks from Claude or configure your MCP client to use this Loupe daemon.");
    return hasWarnings(health.payload.warnings) ? 2 : 0;
  }
  if (health.status === "other") {
    writeLine(stdout, `Warning: port ${port} is occupied by a non-Loupe service; choose another --port before starting Loupe.`);
    writeLine(stdout, "Next: start the Loupe daemon/MCP setup, then run /loupe:marks from Claude.");
    return 2;
  }
  writeLine(stdout, "Daemon: not running yet.");
  writeLine(stdout, `Next: start the Loupe daemon with loupe serve --port ${port}, then run /loupe:marks from Claude or configure MCP.`);
  return 0;
}

export async function status(options: { port?: number; home?: string }, stdout: Pick<NodeJS.WriteStream, "write"> = process.stdout): Promise<StatusCode> {
  const port = options.port ?? LOUPE_DEFAULT_PORT;
  const home = resolveLoupeHome(options.home);
  const token = await readTokenStatus(home);
  const serverStatus = await readServerStatus(home);
  const marks = await readMarksStatus(home);
  const health = await probeHealth(port);
  let code: StatusCode = 0;

  writeLine(stdout, `Loupe home: ${home}`);
  if (health.status === "loupe") {
    let requestedHomeHash: string | undefined;
    try {
      requestedHomeHash = await homeHashForHome(home);
    } catch {
      requestedHomeHash = undefined;
    }

    if (health.payload.home_hash === undefined || requestedHomeHash === undefined || health.payload.home_hash !== requestedHomeHash) {
      writeLine(stdout, `Daemon: Loupe running on port ${health.payload.port}, but not for requested home.`);
      writeLine(stdout, `Error: daemon home is different from or unverifiable for ${home}.`);
      writeLine(stdout, `Repair: stop that daemon, run loupe serve --port ${port}${options.home === undefined ? "" : ` --home ${home}`}, or run loupe status with the daemon's Loupe home.`);
      code = 1;
    } else {
      writeLine(stdout, `Daemon: Loupe running on port ${health.payload.port}.`);
      writeWarnings(stdout, health.payload.warnings);
      if (hasWarnings(health.payload.warnings)) code = 2;
    }
  } else if (health.status === "other") {
    writeLine(stdout, `Daemon: port ${port} is occupied by a non-Loupe service.`);
    writeLine(stdout, `Repair: stop that service or rerun Loupe with --port <free-port>.`);
    code = 1;
  } else {
    writeLine(stdout, `Daemon: unreachable on port ${port}.`);
    writeLine(stdout, `Repair: run loupe serve --port ${port}${options.home === undefined ? "" : ` --home ${home}`}.`);
    code = 1;
  }

  if (token.status === "present") {
    writeLine(stdout, `Token: present at ${token.path}.`);
  } else if (token.status === "empty") {
    writeLine(stdout, `Token: empty at ${token.path}.`);
    writeLine(stdout, `Repair: run loupe init${homeArgs(options.home)} to regenerate a token.`);
    code = 1;
  } else {
    writeLine(stdout, `Token: missing at ${token.path}.`);
    writeLine(stdout, `Repair: run loupe init${homeArgs(options.home)} to create one.`);
    code = 1;
  }

  if (serverStatus.status === "present") {
    writeLine(stdout, `Server status: present at ${serverStatus.path} (pid ${serverStatus.file.pid}, port ${serverStatus.file.port}).`);
  } else if (serverStatus.status === "invalid") {
    writeLine(stdout, `Server status: invalid JSON at ${serverStatus.path}.`);
    writeLine(stdout, `Repair: run loupe init${homeArgs(options.home)} to rewrite server metadata.`);
    code = 1;
  } else {
    writeLine(stdout, `Server status: missing at ${serverStatus.path}.`);
    writeLine(stdout, `Repair: run loupe init${homeArgs(options.home)} to write server metadata.`);
    if (code === 0) code = 2;
  }

  if (marks.status === "present") {
    writeLine(stdout, `Marks store: ${marks.projects} project(s), ${marks.marks} mark(s) at ${marks.path}.`);
  } else if (marks.status === "missing") {
    writeLine(stdout, `Marks store: not created yet at ${marks.path}.`);
  } else {
    writeLine(stdout, `Marks store: warning ${marks.message} at ${marks.path}.`);
    writeLine(stdout, "Repair: back up or remove marks.json, then restart Loupe to recreate an empty store.");
    if (code === 0) code = 2;
  }

  writeLine(stdout, "Extension: install/enable the Loupe browser extension and confirm it can reach this daemon.");
  writeLine(stdout, "Next: run /loupe:marks from Claude after the daemon is running.");
  return code;
}

export async function logs(options: { home?: string }, stdout: Pick<NodeJS.WriteStream, "write"> = process.stdout, stderr: Pick<NodeJS.WriteStream, "write"> = process.stderr): Promise<StatusCode> {
  const home = resolveLoupeHome(options.home);
  const path = serverLogPathForHome(home);
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch (error) {
    if (!isNodeErrorCode(error, "ENOENT")) throw error;
    writeLine(stderr, `No Loupe server log found at ${path}.`);
    writeLine(stderr, `Repair: start the daemon with loupe serve${homeArgs(options.home)} and retry after it writes logs.`);
    return 1;
  }

  const lines = raw.split(/\r?\n/).map((line) => line.trim()).filter((line) => line.length > 0);
  if (lines.length === 0) {
    writeLine(stdout, `Loupe server log at ${path} is empty.`);
    return 2;
  }
  const diagnostics = lines.filter((line) => /\b(error|failed|exception|fatal|corrupt|warn|warning|unauthorized|unsupported)\b/i.test(line));
  const selected = (diagnostics.length > 0 ? diagnostics : lines).slice(-20);
  writeLine(stdout, `${diagnostics.length > 0 ? "Recent Loupe server errors/warnings" : "Recent Loupe server log lines"} from ${path}:`);
  for (const line of selected) writeLine(stdout, line);
  return diagnostics.length > 0 ? 2 : 0;
}

type HealthWarning = { code: string; message: string; file?: string };
type LoupeHealthPayload = HealthPayload & { warnings?: HealthWarning[] };

export type HealthProbe =
  | { status: "loupe"; payload: LoupeHealthPayload }
  | { status: "other" }
  | { status: "unreachable" };

export async function probeHealth(port: number): Promise<HealthProbe> {
  let response: Response;
  try {
    response = await fetch(`http://127.0.0.1:${port}/health`, { method: "GET" });
  } catch {
    return { status: "unreachable" };
  }

  if (!response.ok) return { status: "other" };

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    return { status: "other" };
  }

  return isLoupeHealth(payload) ? { status: "loupe", payload } : { status: "other" };
}

function isLoupeHealth(payload: unknown): payload is LoupeHealthPayload {
  return (
    typeof payload === "object" &&
    payload !== null &&
    !Array.isArray(payload) &&
    (payload as Record<string, unknown>).ok === true &&
    (payload as Record<string, unknown>).name === LOUPE_DAEMON_NAME &&
    typeof (payload as Record<string, unknown>).version === "string" &&
    typeof (payload as Record<string, unknown>).port === "number" &&
    (payload as Record<string, unknown>).requires_auth === true &&
    ((payload as Record<string, unknown>).home_hash === undefined || typeof (payload as Record<string, unknown>).home_hash === "string") &&
    isHealthWarnings((payload as Record<string, unknown>).warnings)
  );
}

function isHealthWarnings(value: unknown): value is HealthWarning[] | undefined {
  if (value === undefined) return true;
  if (!Array.isArray(value)) return false;
  return value.every(
    (warning) =>
      typeof warning === "object" &&
      warning !== null &&
      !Array.isArray(warning) &&
      typeof (warning as Record<string, unknown>).code === "string" &&
      typeof (warning as Record<string, unknown>).message === "string" &&
      ((warning as Record<string, unknown>).file === undefined || typeof (warning as Record<string, unknown>).file === "string"),
  );
}


function isCliCommand(command: string | undefined): command is CliCommand {
  return command === "serve" || command === "ensure" || command === "init" || command === "status" || command === "logs";
}

type TokenStatus =
  | { status: "present"; path: string }
  | { status: "empty"; path: string }
  | { status: "missing"; path: string };

async function readTokenStatus(home: string): Promise<TokenStatus> {
  const path = tokenPathForHome(home);
  try {
    return (await readFile(path, "utf8")).trim().length > 0 ? { status: "present", path } : { status: "empty", path };
  } catch (error) {
    if (isNodeErrorCode(error, "ENOENT")) return { status: "missing", path };
    throw error;
  }
}

type ServerStatusState =
  | { status: "present"; path: string; file: ServerStatusFile }
  | { status: "invalid"; path: string }
  | { status: "missing"; path: string };

async function readServerStatus(home: string): Promise<ServerStatusState> {
  const path = serverStatusPathForHome(home);
  try {
    const parsed = JSON.parse(await readFile(path, "utf8")) as unknown;
    if (isServerStatusFile(parsed)) return { status: "present", path, file: parsed };
    return { status: "invalid", path };
  } catch (error) {
    if (isNodeErrorCode(error, "ENOENT")) return { status: "missing", path };
    if (error instanceof SyntaxError) return { status: "invalid", path };
    throw error;
  }
}

type MarksStatus =
  | { status: "present"; path: string; projects: number; marks: number }
  | { status: "missing"; path: string }
  | { status: "warning"; path: string; message: string };

async function readMarksStatus(home: string): Promise<MarksStatus> {
  const path = marksPathForHome(home);
  try {
    const parsed = JSON.parse(await readFile(path, "utf8")) as unknown;
    assert_storage_envelope(parsed);
    const counts = countMarks(parsed);
    return { status: "present", path, projects: counts.projects, marks: counts.marks };
  } catch (error) {
    if (isNodeErrorCode(error, "ENOENT")) return { status: "missing", path };
    if (error instanceof SyntaxError) return { status: "warning", path, message: "corrupt JSON" };
    if (error instanceof TypeError) return { status: "warning", path, message: "invalid storage schema" };
    throw error;
  }
}

function countMarks(envelope: StorageEnvelope): { projects: number; marks: number } {
  let marks = 0;
  const projects = Object.values(envelope.projects);
  for (const project of projects) {
    for (const session of Object.values(project.sessions)) marks += session.marks.length;
  }
  return { projects: projects.length, marks };
}

function isServerStatusFile(value: unknown): value is ServerStatusFile {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    Number.isInteger((value as Record<string, unknown>).pid) &&
    Number.isInteger((value as Record<string, unknown>).port) &&
    typeof (value as Record<string, unknown>).token_path === "string" &&
    typeof (value as Record<string, unknown>).started_at === "string"
  );
}

function writeWarnings(stream: Pick<NodeJS.WriteStream, "write">, warnings: readonly HealthWarning[] | undefined): void {
  if (warnings === undefined) return;
  for (const warning of warnings) {
    const file = warning.file === undefined ? "" : ` (${warning.file})`;
    writeLine(stream, `Warning: ${warning.code}: ${warning.message}${file}`);
  }
}

function hasWarnings(warnings: readonly HealthWarning[] | undefined): boolean {
  return warnings !== undefined && warnings.length > 0;
}

function homeArgs(home: string | undefined): string {
  return home === undefined ? "" : ` --home ${home}`;
}
function parsePort(value: string): number {
  if (!/^\d+$/.test(value)) throw new Error(`Invalid port: ${value}`);
  const port = Number(value);
  if (!Number.isSafeInteger(port) || port < 1 || port > 65_535) throw new Error(`Invalid port: ${value}`);
  return port;
}

async function listen(server: LoupeHttpServer, port: number): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const onListening = (): void => {
      server.off("error", onError);
      resolve();
    };
    const onError = (error: Error): void => {
      server.off("listening", onListening);
      reject(isNodeErrorCode(error, "EADDRINUSE") ? new Error(`Port ${port} is occupied by a non-Loupe service.`) : error);
    };
    server.once("listening", onListening);
    server.once("error", onError);
    server.listen(port, "127.0.0.1");
  });
}

function homeOption(home: string | undefined): { home?: string } {
  return home === undefined ? {} : { home };
}

function isNodeErrorCode(error: unknown, code: string): boolean {
  return error instanceof Error && "code" in error && (error as NodeJS.ErrnoException).code === code;
}

function writeUsage(stream: Pick<NodeJS.WriteStream, "write">): void {
  writeLine(stream, "Usage: loupe serve [--port <n>] [--home <path>]");
  writeLine(stream, "       loupe ensure [--port <n>] [--home <path>]");
  writeLine(stream, "       loupe init [--port <n>] [--home <path>]");
  writeLine(stream, "       loupe status [--port <n>] [--home <path>]");
  writeLine(stream, "       loupe logs [--home <path>]");
}

function writeLine(stream: Pick<NodeJS.WriteStream, "write">, line: string): void {
  stream.write(`${line}\n`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  process.exitCode = await runCli();
}
