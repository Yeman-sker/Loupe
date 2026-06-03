import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer as createNodeServer, type Server as NodeServer } from "node:http";
import type { AddressInfo } from "node:net";
import {
  parseProxyArgs,
  readLoupeToken,
  resolveLoupeTokenPath,
  forwardJsonRpcMessage,
} from "./mcp-proxy.js";

describe("mcp-proxy parseProxyArgs", () => {
  it("returns defaults when no arguments are provided", () => {
    const result = parseProxyArgs([]);
    assert.equal(result.url, "http://127.0.0.1:7373/mcp");
    assert.equal(result.tokenPath, undefined);
  });

  it("skips the mcp-proxy command word", () => {
    const result = parseProxyArgs(["mcp-proxy"]);
    assert.equal(result.url, "http://127.0.0.1:7373/mcp");
    assert.equal(result.tokenPath, undefined);
  });

  it("parses --url with space-separated value", () => {
    const result = parseProxyArgs(["--url", "http://127.0.0.1:9000/mcp"]);
    assert.equal(result.url, "http://127.0.0.1:9000/mcp");
  });

  it("parses --url= with equals syntax", () => {
    const result = parseProxyArgs(["--url=http://127.0.0.1:9000/mcp"]);
    assert.equal(result.url, "http://127.0.0.1:9000/mcp");
  });

  it("throws when --url has no value", () => {
    assert.throws(() => parseProxyArgs(["--url"]), { message: "Missing value for --url" });
  });

  it("throws when --url= has empty value", () => {
    assert.throws(() => parseProxyArgs(["--url="]), { message: "Missing value for --url" });
  });

  it("parses --token-path with space-separated value", () => {
    const result = parseProxyArgs(["--token-path", "/tmp/token"]);
    assert.equal(result.tokenPath, "/tmp/token");
  });

  it("parses --token-path= with equals syntax", () => {
    const result = parseProxyArgs(["--token-path=/tmp/token"]);
    assert.equal(result.tokenPath, "/tmp/token");
  });

  it("throws when --token-path has no value", () => {
    assert.throws(() => parseProxyArgs(["--token-path"]), { message: "Missing value for --token-path" });
  });

  it("throws on unknown arguments", () => {
    assert.throws(() => parseProxyArgs(["--bogus"]), { message: "Unknown argument: --bogus" });
  });

  it("parses combined --url and --token-path", () => {
    const result = parseProxyArgs(["--url", "http://localhost:8000/mcp", "--token-path", "/tmp/tok"]);
    assert.equal(result.url, "http://localhost:8000/mcp");
    assert.equal(result.tokenPath, "/tmp/tok");
  });

  it("expands tilde in --token-path", () => {
    const result = parseProxyArgs(["--token-path", "~/my-token"]);
    assert.ok(!result.tokenPath!.startsWith("~"));
    assert.ok(result.tokenPath!.endsWith("my-token"));
  });
});

describe("mcp-proxy readLoupeToken", () => {
  let tmpDir: string;

  before(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "loupe-mcp-proxy-test-"));
  });

  after(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("reads and trims a valid token file", async () => {
    const tokenPath = join(tmpDir, "valid-token");
    await writeFile(tokenPath, "  my-secret-token  \n");
    const token = await readLoupeToken(tokenPath);
    assert.equal(token, "my-secret-token");
  });

  it("throws when the token file does not exist", async () => {
    const tokenPath = join(tmpDir, "nonexistent-token");
    await assert.rejects(readLoupeToken(tokenPath), (error: Error) => {
      assert.match(error.message, /Loupe token file is missing/);
      return true;
    });
  });

  it("throws when the token file is empty", async () => {
    const tokenPath = join(tmpDir, "empty-token");
    await writeFile(tokenPath, "   \n");
    await assert.rejects(readLoupeToken(tokenPath), (error: Error) => {
      assert.match(error.message, /Loupe token file is empty/);
      return true;
    });
  });
});

describe("mcp-proxy resolveLoupeTokenPath", () => {
  it("returns the explicit path when provided", async () => {
    const result = await resolveLoupeTokenPath("/tmp/my-token");
    assert.equal(result, "/tmp/my-token");
  });
});

describe("mcp-proxy forwardJsonRpcMessage", () => {
  let echoServer: NodeServer;
  let baseUrl: string;

  before(async () => {
    echoServer = createNodeServer((request, response) => {
      const auth = request.headers.authorization;
      if (!auth || !auth.startsWith("Bearer ")) {
        response.writeHead(401, { "Content-Type": "application/json" });
        response.end(JSON.stringify({ error: "unauthorized" }));
        return;
      }

      let body = "";
      request.on("data", (chunk: Buffer) => {
        body += chunk.toString();
      });
      request.on("end", () => {
        const parsed = JSON.parse(body) as { method?: string };
        if (parsed.method === "error_test") {
          response.writeHead(500, { "Content-Type": "application/json" });
          response.end(JSON.stringify({ error: "server error" }));
          return;
        }
        if (parsed.method === "empty_response") {
          response.writeHead(200, { "Content-Type": "application/json" });
          response.end("");
          return;
        }
        response.writeHead(200, { "Content-Type": "application/json" });
        response.end(JSON.stringify({ jsonrpc: "2.0", id: 1, result: { echo: body } }));
      });
    });

    await new Promise<void>((resolve, reject) => {
      echoServer.once("error", reject);
      echoServer.listen(0, "127.0.0.1", () => {
        echoServer.off("error", reject);
        const address = echoServer.address() as AddressInfo;
        baseUrl = `http://127.0.0.1:${address.port}`;
        resolve();
      });
    });
  });

  after(async () => {
    await new Promise<void>((resolve, reject) => {
      echoServer.close((error) => (error ? reject(error) : resolve()));
    });
  });

  it("forwards a JSON-RPC message and returns the response body", async () => {
    const message = JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" });
    const result = await forwardJsonRpcMessage(baseUrl, "test-token", message);
    assert.ok(result !== undefined);
    const parsed = JSON.parse(result) as { jsonrpc: string; id: number; result: { echo: string } };
    assert.equal(parsed.jsonrpc, "2.0");
    assert.equal(parsed.id, 1);
  });

  it("throws on non-ok HTTP responses", async () => {
    const message = JSON.stringify({ jsonrpc: "2.0", id: 1, method: "error_test" });
    await assert.rejects(forwardJsonRpcMessage(baseUrl, "test-token", message), (error: Error) => {
      assert.match(error.message, /Loupe daemon MCP request failed/);
      assert.match(error.message, /500/);
      return true;
    });
  });

  it("returns undefined for empty response body", async () => {
    const message = JSON.stringify({ jsonrpc: "2.0", id: 1, method: "empty_response" });
    const result = await forwardJsonRpcMessage(baseUrl, "test-token", message);
    assert.equal(result, undefined);
  });

  it("redacts the token in error messages", async () => {
    const token = "super-secret-token";
    const message = JSON.stringify({ jsonrpc: "2.0", id: 1, method: "error_test" });
    await assert.rejects(forwardJsonRpcMessage(baseUrl, token, message), (error: Error) => {
      assert.equal(error.message.includes(token), false);
      return true;
    });
  });
});
