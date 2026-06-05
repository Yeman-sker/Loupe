import { appendFile, mkdir, readFile, stat, writeFile } from "node:fs/promises";

import { serverLogPathForHome } from "./loupe-home.js";
import { isNodeErrorCode } from "./node-errors.js";

const LOG_MAX_BYTES = 1_048_576;
const LOG_TRUNCATE_TO_BYTES = 524_288;

export async function appendDaemonLog(home: string, level: "INFO" | "ERROR" | "WARN", message: string, options: { fields?: Record<string, string | undefined>; console?: Pick<NodeJS.WriteStream, "write"> | undefined } = {}): Promise<void> {
  const line = formatDaemonLogLine(level, message, options.fields);
  try {
    await mkdir(home, { recursive: true, mode: 0o700 });
    const path = serverLogPathForHome(home);
    await truncateDaemonLogIfNeeded(path);
    await appendFile(path, `${line}\n`, { encoding: "utf8", mode: 0o600 });
  } catch {
    // Daemon logs are best-effort diagnostics only.
  }
  if ((level === "WARN" || level === "ERROR") && options.console !== undefined) options.console.write(`${line}\n`);
}

function formatDaemonLogLine(level: "INFO" | "ERROR" | "WARN", message: string, fields: Record<string, string | undefined> = {}): string {
  const parts = [new Date().toISOString(), level];
  for (const [key, value] of Object.entries(fields)) {
    if (value !== undefined && value.length > 0) parts.push(`${key}=${value}`);
  }
  parts.push(message);
  return parts.join(" ");
}

async function truncateDaemonLogIfNeeded(path: string): Promise<void> {
  let size: number;
  try {
    size = (await stat(path)).size;
  } catch (error) {
    if (isNodeErrorCode(error, "ENOENT")) return;
    throw error;
  }
  if (size <= LOG_MAX_BYTES) return;
  const raw = await readFile(path);
  await writeFile(path, raw.subarray(Math.max(0, raw.byteLength - LOG_TRUNCATE_TO_BYTES)), { mode: 0o600 });
}
