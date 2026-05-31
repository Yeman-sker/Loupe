#!/usr/bin/env node
import { createServer, ensureToken, tokenPathForHome, writeServerStatus, type LoupeHttpServer } from "./server.js";
import { LOUPE_DAEMON_NAME, type HealthPayload } from "@loupe/shared";

export type CliCommand = "serve" | "ensure";

export type CliOptions = {
  command: CliCommand;
  port: number;
  home?: string;
};

export type RunCliOptions = {
  argv?: string[];
  stderr?: Pick<NodeJS.WriteStream, "write">;
};

export async function runCli(options: RunCliOptions = {}): Promise<number> {
  const argv = options.argv ?? process.argv.slice(2);
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
    await ensure(parsed);
    return 0;
  } catch (error) {
    writeLine(stderr, error instanceof Error ? error.message : String(error));
    return 1;
  }
}

export async function serve(options: { port: number; home?: string }): Promise<LoupeHttpServer> {
  const home = homeOption(options.home);
  const token = await ensureToken(home);
  const server = createServer({ port: options.port, ...home, token });
  await listen(server, options.port);
  await writeServerStatus({ ...home, port: options.port, tokenPath: tokenPathForHome(server.loupe.home) });
  return server;
}

export async function ensure(options: { port: number; home?: string }): Promise<LoupeHttpServer | undefined> {
  const health = await probeHealth(options.port);
  if (health.status === "loupe") {
    const home = homeOption(options.home);
    await ensureToken(home);
    await writeServerStatus({ ...home, port: health.payload.port });
    return undefined;
  }
  if (health.status === "other") {
    throw new Error(`Port ${options.port} is occupied by a non-Loupe service.`);
  }
  return serve(options);
}

export function parseCli(argv: string[]): CliOptions {
  const command = argv[0];
  if (command !== "serve" && command !== "ensure") {
    throw new Error("Expected command: serve or ensure.");
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

  if (port === undefined) throw new Error("--port is required.");
  return { command, port, ...(home === undefined ? {} : { home }) };
}

export type HealthProbe =
  | { status: "loupe"; payload: HealthPayload }
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

function isLoupeHealth(payload: unknown): payload is HealthPayload {
  return (
    typeof payload === "object" &&
    payload !== null &&
    !Array.isArray(payload) &&
    (payload as Record<string, unknown>).ok === true &&
    (payload as Record<string, unknown>).name === LOUPE_DAEMON_NAME &&
    typeof (payload as Record<string, unknown>).version === "string" &&
    typeof (payload as Record<string, unknown>).port === "number" &&
    (payload as Record<string, unknown>).requires_auth === true
  );
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
  writeLine(stream, "Usage: loupe-server serve --port <n> [--home <path>]");
  writeLine(stream, "       loupe-server ensure --port <n> [--home <path>]");
}

function writeLine(stream: Pick<NodeJS.WriteStream, "write">, line: string): void {
  stream.write(`${line}\n`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  process.exitCode = await runCli();
}
