#!/usr/bin/env node
import { runMcpProxy } from "./mcp-proxy.js";

function printUsage(): void {
  process.stderr.write("Usage: mcp-proxy [--url http://127.0.0.1:7373/mcp]\n");
}

try {
  await runMcpProxy(process.argv.slice(2));
} catch (error) {
  printUsage();
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
}
