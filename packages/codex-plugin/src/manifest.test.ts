import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { validateCodexPluginManifest } from "./manifest.js";

const manifestPath = new URL("../.codex-plugin/plugin.json", import.meta.url).pathname;
const mcpPath = new URL("../.mcp.json", import.meta.url).pathname;
const hooksPath = new URL("../hooks/hooks.json", import.meta.url).pathname;

test("Codex plugin manifest validates", async () => {
  const result = await validateCodexPluginManifest(manifestPath);
  assert.deepEqual(result, { ok: true, errors: [] });
});

test("Codex plugin wires Loupe MCP through server package", async () => {
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  assert.equal(manifest.mcpServers, "./.mcp.json");

  const mcp = JSON.parse(await readFile(mcpPath, "utf8"));
  assert.equal(mcp.loupe.command, "npx");
  assert.deepEqual(mcp.loupe.args, ["-y", "@loupe-server/server", "mcp-proxy", "--url", "http://127.0.0.1:7373/mcp"]);
});

test("Codex plugin hook starts Loupe daemon through server package", async () => {
  const hooks = JSON.parse(await readFile(hooksPath, "utf8"));
  assert.equal(hooks.hooks.SessionStart[0].matcher, "startup");
  assert.equal(hooks.hooks.SessionStart[0].hooks[0].command, "npx -y @loupe-server/server ensure --port 7373");
});
