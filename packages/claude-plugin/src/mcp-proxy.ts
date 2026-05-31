import { createInterface } from "node:readline/promises";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { LOUPE_AUTH_SCHEME } from "@loupe/shared";

const DEFAULT_MCP_URL = "http://127.0.0.1:7373/mcp";
const TOKEN_PATH = join(homedir(), ".loupe", "token");

export type ProxyOptions = {
  url: string;
};

export function parseProxyArgs(args: readonly string[]): ProxyOptions {
  let url = DEFAULT_MCP_URL;

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
    throw new Error(`Unknown argument: ${arg}`);
  }

  return { url };
}

export async function readLoupeToken(): Promise<string> {
  const token = (await readFile(TOKEN_PATH, "utf8")).trim();
  if (!token) {
    throw new Error(`Loupe token file is empty: ${TOKEN_PATH}`);
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
    throw new Error(`Loupe daemon MCP request failed: HTTP ${response.status}${text ? ` ${text}` : ""}`);
  }
  return text.length > 0 ? text : undefined;
}

export async function runMcpProxy(args: readonly string[] = process.argv.slice(2)): Promise<void> {
  const { url } = parseProxyArgs(args);
  const token = await readLoupeToken();
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
