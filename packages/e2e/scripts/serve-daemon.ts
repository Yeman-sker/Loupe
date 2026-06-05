import { spawn } from "node:child_process";
import fs from "node:fs";
import fsp from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { DAEMON_PORT, FIXTURE_HOST, FIXTURE_PORT } from "../src/constants.js";
import { prepExtension } from "./prep-ext.js";
import { homeHashForHome } from "../../server/src/server.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// This file lives at <repo>/packages/e2e/scripts/serve-daemon.ts
// so repo root is three levels up.
const repoRoot = path.resolve(__dirname, "../../..");

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

async function pickDaemonPort(preferredPort: number, expectedHomeHash: string): Promise<number> {
  const probe = await probeDaemonPort(preferredPort);
  if (probe === "free" || probe.home_hash === expectedHomeHash) return preferredPort;
  return await freeLoopbackPort();
}

async function probeDaemonPort(port: number): Promise<"free" | { home_hash?: unknown }> {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/health`);
    const body = (await res.json().catch(() => null)) as { home_hash?: unknown } | null;
    return body ?? {};
  } catch {
    return "free";
  }
}

async function freeLoopbackPort(): Promise<number> {
  const server = http.createServer();
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });
  const address = server.address();
  const port = typeof address === "object" && address !== null ? address.port : undefined;
  await new Promise<void>((resolve) => server.close(() => resolve()));
  if (typeof port !== "number") throw new Error("Could not allocate a loopback port for Loupe daemon");
  return port;
}

export interface DaemonHandle {
  port: number;
  baseUrl: string;
  token: string;
  stop: () => Promise<void>;
}

export async function startDaemon(opts: { home: string; port?: number }): Promise<DaemonHandle> {
  const expectedHomeHash = await homeHashForHome(opts.home);
  const port = opts.port ?? await pickDaemonPort(DAEMON_PORT, expectedHomeHash);
  const cliPath = path.join(repoRoot, "packages/server/src/cli.ts");
  // Run the daemon under tsx. The `--import tsx` bare specifier resolves relative
  // to cwd, so cwd must be a package that has tsx installed (the e2e package does;
  // the repo root does not — pnpm keeps tsx unhoisted). cli.ts's own imports
  // resolve relative to its own file location, independent of cwd.
  const e2eDir = path.resolve(__dirname, "..");

  const child = spawn(
    "node",
    ["--import", "tsx", cliPath, "serve", "--port", String(port), "--home", opts.home],
    { cwd: e2eDir, stdio: ["ignore", "pipe", "pipe"] }
  );

  let stderr = "";
  child.stderr?.on("data", (chunk: Buffer) => {
    stderr += chunk.toString();
  });

  const baseUrl = `http://127.0.0.1:${port}`;
  const deadline = Date.now() + 15_000;

  // Wait for this daemon's /health to return 200. A stale daemon can already own
  // the fixed e2e port; require the requested home hash so we do not pair a new
  // token file with an old process.
  let healthy = false;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`Daemon exited early (code ${child.exitCode}):\n${stderr}`);
    }
    try {
      const res = await fetch(`${baseUrl}/health`);
      const body = (await res.json().catch(() => null)) as { home_hash?: unknown } | null;
      if (res.status === 200 && body?.home_hash === expectedHomeHash) {
        healthy = true;
        break;
      }
    } catch {
      // not up yet
    }
    await sleep(150);
  }
  if (!healthy) {
    child.kill("SIGTERM");
    throw new Error(`Daemon did not become healthy within 15s:\n${stderr}`);
  }

  // Read the token (written before listening, but poll defensively).
  const tokenPath = path.join(opts.home, "token");
  let token = "";
  while (Date.now() < deadline) {
    try {
      token = (await fsp.readFile(tokenPath, "utf8")).trim();
      if (token.length > 0) break;
    } catch {
      // not written yet
    }
    await sleep(100);
  }
  if (token.length === 0) {
    child.kill("SIGTERM");
    throw new Error(`Daemon token file never appeared at ${tokenPath}:\n${stderr}`);
  }

  const stop = async (): Promise<void> => {
    if (child.exitCode !== null || child.signalCode !== null) return;
    await new Promise<void>((resolve) => {
      child.once("exit", () => resolve());
      child.kill("SIGTERM");
    });
  };

  return { port, baseUrl, token, stop };
}

export interface FixtureServerHandle {
  origin: string;
  url: (p?: string) => string;
  close: () => Promise<void>;
}

const CONTENT_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
};

export async function startFixtureServer(
  opts?: { port?: number; dir?: string }
): Promise<FixtureServerHandle> {
  const port = opts?.port ?? FIXTURE_PORT;
  const dir = opts?.dir ?? path.join(repoRoot, "packages/e2e/fixtures");

  const server = http.createServer((req, res) => {
    const rawPath = decodeURIComponent((req.url ?? "/").split("?")[0] ?? "/");
    const relPath = rawPath === "/" ? "index.html" : rawPath.replace(/^\/+/, "");
    const filePath = path.join(dir, relPath);

    // Path safety: resolved file must stay inside `dir`.
    const resolved = path.resolve(filePath);
    if (resolved !== dir && !resolved.startsWith(dir + path.sep)) {
      res.writeHead(403);
      res.end("Forbidden");
      return;
    }

    fs.readFile(resolved, (err, data) => {
      if (err) {
        res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
        res.end("Not Found");
        return;
      }
      const ext = path.extname(resolved);
      const type = CONTENT_TYPES[ext] ?? "application/octet-stream";
      res.writeHead(200, { "content-type": type });
      res.end(data);
    });
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, FIXTURE_HOST, () => {
      server.off("error", reject);
      resolve();
    });
  });

  const origin = `http://127.0.0.1:${port}`;
  const url = (p = "index.html"): string => `${origin}/${p.replace(/^\//, "")}`;
  const close = (): Promise<void> =>
    new Promise((resolve) => server.close(() => resolve()));

  return { origin, url, close };
}

// ---- CLI: interactive loop for chrome-devtools-mcp -------------------------

async function main(): Promise<void> {
  const extPath = await prepExtension();
  const fixture = await startFixtureServer();
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "loupe-mcp-home-"));
  const daemon = await startDaemon({ home });

  console.log("");
  console.log("=== Loupe e2e interactive harness ===");
  console.log(`  --load-extension : ${extPath}`);
  console.log(`  fixture URL      : ${fixture.url("index.html")}`);
  console.log(`  daemon baseUrl   : ${daemon.baseUrl}`);
  console.log(`  daemon token     : ${daemon.token}`);
  console.log(`  daemon home      : ${home}`);
  console.log("=====================================");
  console.log("Press Ctrl-C to stop.");

  let shuttingDown = false;
  const shutdown = async (): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log("\nShutting down...");
    await daemon.stop();
    await fixture.close();
    fs.rmSync(home, { recursive: true, force: true });
    process.exit(0);
  };

  process.on("SIGINT", () => void shutdown());
  process.on("SIGTERM", () => void shutdown());
}

const isMain =
  process.argv[1] != null &&
  path.resolve(process.argv[1]) === path.resolve(__filename);

if (isMain) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
