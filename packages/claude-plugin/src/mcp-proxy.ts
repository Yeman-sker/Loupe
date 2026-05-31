import { createInterface } from "node:readline/promises";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";
import { isAbsolute, join, resolve } from "node:path";

const DEFAULT_MCP_URL = "http://127.0.0.1:7373/mcp";
const DEFAULT_TOKEN_PATH = join(homedir(), ".loupe", "token");
const SERVER_FILE_PATH = join(homedir(), ".loupe", "server.json");
const FILE_URL_PREFIX = "file://";
const LOUPE_AUTH_SCHEME = "Bearer";

export type ProxyOptions = {
  url: string;
  tokenPath?: string;
};

type ServerFile = {
  token_path?: unknown;
};

export function parseProxyArgs(args: readonly string[]): ProxyOptions {
  let url = DEFAULT_MCP_URL;
  let tokenPath: string | undefined;
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === undefined) {
      continue;
    }
    if (arg === "mcp-proxy") {
      continue;
    }
    if (arg === "--url") {
      const value = args[i + 1];
      if (!value) {
        throw new Error("Missing value for --url");
      }
      url = value;
      i += 1;
      continue;
    }
    if (arg.startsWith("--url=")) {
      url = arg.slice("--url=".length);
      if (!url) {
        throw new Error("Missing value for --url");
      }
      continue;
    }
    if (arg === "--token-path") {
      const value = args[i + 1];
      if (!value) {
        throw new Error("Missing value for --token-path");
      }
      tokenPath = normalizeTokenPath(value);
      i += 1;
      continue;
    }
    if (arg.startsWith("--token-path=")) {
      tokenPath = normalizeTokenPath(arg.slice("--token-path=".length));
      if (!tokenPath) {
        throw new Error("Missing value for --token-path");
      }
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }

  return tokenPath === undefined ? { url } : { url, tokenPath };
}

function normalizeTokenPath(path: string): string {
  if (path.length === 0) {
    return path;
  }
  if (path === "~") {
    return homedir();
  }
  if (path.startsWith("~/")) {
    return join(homedir(), path.slice(2));
  }
  if (path.startsWith(FILE_URL_PREFIX)) {
    return fileURLToPath(path);
  }
  return path;
}

function resolveServerTokenPath(path: string): string {
  const normalized = normalizeTokenPath(path);
  if (isAbsolute(normalized)) {
    return normalized;
  }
  return resolve(join(homedir(), ".loupe"), normalized);
}

async function readServerTokenPath(): Promise<string | undefined> {
  let raw: string;
  try {
    raw = await readFile(SERVER_FILE_PATH, "utf8");
  } catch (error) {
    if (isNotFoundError(error)) {
      return undefined;
    }
    throw new Error(`Unable to read Loupe server file: ${SERVER_FILE_PATH}`);
  }

  let parsed: ServerFile;
  try {
    parsed = JSON.parse(raw) as ServerFile;
  } catch {
    throw new Error(`Unable to parse Loupe server file: ${SERVER_FILE_PATH}`);
  }

  return typeof parsed.token_path === "string" && parsed.token_path.length > 0 ? resolveServerTokenPath(parsed.token_path) : undefined;
}

function isNotFoundError(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}

export async function resolveLoupeTokenPath(explicitTokenPath?: string): Promise<string> {
  if (explicitTokenPath !== undefined) {
    return explicitTokenPath;
  }

  return (await readServerTokenPath()) ?? DEFAULT_TOKEN_PATH;
}

export async function readLoupeToken(tokenPath: string = DEFAULT_TOKEN_PATH): Promise<string> {
  let token: string;
  try {
    token = (await readFile(tokenPath, "utf8")).trim();
  } catch (error) {
    if (isNotFoundError(error)) {
      throw new Error(`Loupe token file is missing: ${tokenPath}`);
    }
    throw new Error(`Unable to read Loupe token file: ${tokenPath}`);
  }
  if (!token) {
    throw new Error(`Loupe token file is empty: ${tokenPath}`);
  }
  return token;
}

export async function forwardJsonRpcMessage(url: string, token: string, message: string): Promise<string | undefined> {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Authorization": `${LOUPE_AUTH_SCHEME} ${token}`,
      "Content-Type": "application/json",
      "Accept": "application/json",
    },
    body: message,
  });

  const text = await response.text();
  if (!response.ok) {
    throw new Error(`Loupe daemon MCP request failed: HTTP ${response.status}${response.statusText ? ` ${response.statusText}` : ""}${text ? ` ${redactToken(text, token)}` : ""}`);
  }
  return text.length > 0 ? text : undefined;
}

function redactToken(text: string, token: string): string {
  return token.length === 0 ? text : text.split(token).join("[redacted]");
}

export async function runMcpProxy(args: readonly string[] = process.argv.slice(2)): Promise<void> {
  const { url, tokenPath: explicitTokenPath } = parseProxyArgs(args);
  const tokenPath = await resolveLoupeTokenPath(explicitTokenPath);
  const token = await readLoupeToken(tokenPath);
  const input = createInterface({ input: process.stdin, crlfDelay: Infinity });

  for await (const line of input) {
    if (line.length === 0) {
      continue;
    }

    const body = await forwardJsonRpcMessage(url, token, line);
    if (body !== undefined) {
      process.stdout.write(body.endsWith("\n") ? body : `${body}\n`);
    }
  }
}
