import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AddressInfo } from "node:net";
import { LOUPE_DEFAULT_PORT } from "@loupe-server/shared";
import { init, logs, parseCli, probeHealth, runCli, status, type CliOptions } from "./cli.js";
import { createServer, ensureToken, serverLogPathForHome, tokenPathForHome, writeServerStatus, type LoupeHttpServer } from "./server.js";

class MemoryStream {
  text = "";
  write(chunk: string): boolean {
    this.text += chunk;
    return true;
  }
}

function closeServer(server: LoupeHttpServer): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}

describe("CLI parseCli error handling", () => {
  it("throws on unknown command", () => {
    assert.throws(() => parseCli(["bogus"]), { message: "Expected command: serve, ensure, init, status, logs, or mcp-proxy." });
  });

  it("throws on empty argv", () => {
    assert.throws(() => parseCli([]), { message: "Expected command: serve, ensure, init, status, logs, or mcp-proxy." });
  });

  it("throws when --port has no value", () => {
    assert.throws(() => parseCli(["serve", "--port"]), { message: "--port requires a value." });
  });

  it("throws on non-numeric port", () => {
    assert.throws(() => parseCli(["serve", "--port", "abc"]), { message: "Invalid port: abc" });
  });

  it("throws on port 0", () => {
    assert.throws(() => parseCli(["serve", "--port", "0"]), { message: "Invalid port: 0" });
  });

  it("throws on port exceeding 65535", () => {
    assert.throws(() => parseCli(["serve", "--port", "99999"]), { message: "Invalid port: 99999" });
  });

  it("throws when --home has no value", () => {
    assert.throws(() => parseCli(["serve", "--home"]), { message: "--home requires a value." });
  });

  it("throws when --home has empty value", () => {
    assert.throws(() => parseCli(["serve", "--home", ""]), { message: "--home requires a value." });
  });

  it("throws on unknown argument", () => {
    assert.throws(() => parseCli(["serve", "--unknown"]), /Unknown argument/);
  });

  it("parses --port and --home together", () => {
    const result = parseCli(["serve", "--port", "8080", "--home", "/tmp/loupe"]);
    assert.deepEqual(result, { command: "serve", port: 8080, home: "/tmp/loupe" } satisfies CliOptions);
  });

  it("does not parse flags after mcp-proxy command", () => {
    const result = parseCli(["mcp-proxy", "--url", "http://localhost/mcp"]);
    assert.equal(result.command, "mcp-proxy");
    assert.equal(result.port, LOUPE_DEFAULT_PORT);
  });
});

describe("CLI runCli", () => {
  it("returns 1 and prints usage for unknown command", async () => {
    const stderr = new MemoryStream();
    const code = await runCli({ argv: ["bogus"], stderr });
    assert.equal(code, 1);
    assert.match(stderr.text, /Usage:/);
    assert.match(stderr.text, /Expected command/);
  });

  it("returns 1 for empty argv", async () => {
    const stderr = new MemoryStream();
    const code = await runCli({ argv: [], stderr });
    assert.equal(code, 1);
    assert.match(stderr.text, /Usage:/);
  });
});

describe("CLI init", () => {
  it("initializes a new Loupe home directory", async () => {
    const home = await mkdtemp(join(tmpdir(), "loupe-cli-test-init-"));
    const stdout = new MemoryStream();
    try {
      const code = await init({ home }, stdout);
      assert.equal(code, 0);
      assert.match(stdout.text, /Loupe initialized/);
      assert.match(stdout.text, /Daemon: not running yet/);

      const tokenPath = tokenPathForHome(home);
      const token = (await readFile(tokenPath, "utf8")).trim();
      assert.ok(token.length > 0);
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });
});

describe("CLI status", () => {
  it("reports unreachable daemon for non-existent home", async () => {
    const home = await mkdtemp(join(tmpdir(), "loupe-cli-test-status-"));
    const stdout = new MemoryStream();
    try {
      await ensureToken({ home });
      await writeServerStatus({ home, port: 59999 });
      const code = await status({ home, port: 59999 }, stdout);
      assert.ok(code >= 1);
      assert.match(stdout.text, /Loupe home:/);
      assert.match(stdout.text, /Daemon: unreachable/);
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });

  it("reports running daemon when server is active", async () => {
    const home = await mkdtemp(join(tmpdir(), "loupe-cli-test-status-running-"));
    const token = "cli-test-token";
    let server: LoupeHttpServer | undefined;
    const stdout = new MemoryStream();
    try {
      server = createServer({ home, port: 0, token, version: "cli-test" });
      await new Promise<void>((resolve, reject) => {
        server!.once("error", reject);
        server!.listen(0, "127.0.0.1", () => {
          server!.off("error", reject);
          resolve();
        });
      });
      const address = server.address() as AddressInfo;
      await ensureToken({ home });
      await writeServerStatus({ home, port: address.port, tokenPath: tokenPathForHome(home) });

      const code = await status({ home, port: address.port }, stdout);
      assert.equal(code, 0);
      assert.match(stdout.text, /Daemon: Loupe running on port/);
      assert.match(stdout.text, /Token: present/);
    } finally {
      if (server !== undefined) await closeServer(server);
      await rm(home, { recursive: true, force: true });
    }
  });
});

describe("CLI logs", () => {
  it("returns 1 when no log file exists", async () => {
    const home = await mkdtemp(join(tmpdir(), "loupe-cli-test-logs-"));
    const stdout = new MemoryStream();
    const stderr = new MemoryStream();
    try {
      const code = await logs({ home }, stdout, stderr);
      assert.equal(code, 1);
      assert.match(stderr.text, /No Loupe server log found/);
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });

  it("returns 2 when log file is empty", async () => {
    const home = await mkdtemp(join(tmpdir(), "loupe-cli-test-logs-empty-"));
    const stdout = new MemoryStream();
    const stderr = new MemoryStream();
    try {
      await writeFile(serverLogPathForHome(home), "");
      const code = await logs({ home }, stdout, stderr);
      assert.equal(code, 2);
      assert.match(stdout.text, /empty/);
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });

  it("returns 2 when log file contains errors", async () => {
    const home = await mkdtemp(join(tmpdir(), "loupe-cli-test-logs-err-"));
    const stdout = new MemoryStream();
    const stderr = new MemoryStream();
    try {
      await writeFile(serverLogPathForHome(home), "2026-06-01 INFO started\n2026-06-01 ERROR something failed\n");
      const code = await logs({ home }, stdout, stderr);
      assert.equal(code, 2);
      assert.match(stdout.text, /errors\/warnings/);
      assert.match(stdout.text, /ERROR something failed/);
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });

  it("returns 0 when log file has no diagnostics", async () => {
    const home = await mkdtemp(join(tmpdir(), "loupe-cli-test-logs-ok-"));
    const stdout = new MemoryStream();
    const stderr = new MemoryStream();
    try {
      await writeFile(serverLogPathForHome(home), "2026-06-01 INFO daemon started\n2026-06-01 INFO mark created\n");
      const code = await logs({ home }, stdout, stderr);
      assert.equal(code, 0);
      assert.match(stdout.text, /Recent Loupe server log lines/);
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });

  it("shows all logs with --all flag", async () => {
    const home = await mkdtemp(join(tmpdir(), "loupe-cli-test-logs-all-"));
    const stdout = new MemoryStream();
    const stderr = new MemoryStream();
    try {
      await writeFile(serverLogPathForHome(home), "2026-06-01 INFO started\n2026-06-01 ERROR failed\n2026-06-01 INFO recovered\n");
      const code = await logs({ home, allLogs: true }, stdout, stderr);
      assert.match(stdout.text, /Recent Loupe server log lines/);
      assert.match(stdout.text, /INFO started/);
      assert.match(stdout.text, /ERROR failed/);
      assert.match(stdout.text, /INFO recovered/);
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });
});

describe("CLI probeHealth", () => {
  it("returns unreachable for a port with no listener", async () => {
    const result = await probeHealth(59998);
    assert.equal(result.status, "unreachable");
  });
});
