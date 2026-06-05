import { constants } from "node:fs";
import { mkdir, open, readFile, realpath, rename, writeFile } from "node:fs/promises";
import { createHash, randomBytes } from "node:crypto";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { LOUPE_DEFAULT_PORT, LOUPE_TOKEN_MIN_BYTES, type ServerStatusFile } from "@loupe-server/shared";

import { isNodeErrorCode } from "./node-errors.js";

export type LoupeHomeOptions = {
  home?: string;
};

export type TokenOptions = LoupeHomeOptions;

export type ServerStatusOptions = LoupeHomeOptions & {
  port?: number;
  pid?: number;
  tokenPath?: string;
  startedAt?: string;
};

export function resolveLoupeHome(home?: string): string {
  if (!home || home === "~/.loupe") return resolve(homedir(), ".loupe");
  if (home === "~") return resolve(homedir());
  if (home.startsWith("~/")) return resolve(homedir(), home.slice(2));
  return resolve(home);
}

export async function ensureLoupeHome(options: LoupeHomeOptions = {}): Promise<string> {
  const home = resolveLoupeHome(options.home);
  await mkdir(home, { recursive: true, mode: 0o700 });
  return home;
}

export function tokenPathForHome(home: string): string {
  return join(home, "token");
}

export function serverStatusPathForHome(home: string): string {
  return join(home, "server.json");
}

export function marksPathForHome(home: string): string {
  return join(home, "marks.json");
}

export function serverLogPathForHome(home: string): string {
  return join(home, "server.log");
}

export async function canonicalLoupeHome(home: string): Promise<string> {
  return realpath(resolveLoupeHome(home));
}

export async function homeHashForHome(home: string): Promise<string> {
  return sha256Base64Url(await canonicalLoupeHome(home));
}

export async function canonicalWorkspaceRoot(workspaceRoot: string): Promise<string> {
  return realpath(resolve(workspaceRoot));
}

export async function workspaceRootHashForRoot(workspaceRoot: string): Promise<string> {
  return sha256Base64Url(await canonicalWorkspaceRoot(workspaceRoot));
}

export function projectIdForWorkspaceRootHash(workspaceRootHash: string): string {
  return `loupe_v1_${workspaceRootHash}`;
}

export function sha256Base64Url(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("base64url");
}

export async function ensureToken(options: TokenOptions = {}): Promise<string> {
  const home = await ensureLoupeHome(options);
  const tokenPath = tokenPathForHome(home);
  try {
    const existing = (await readFile(tokenPath, "utf8")).trim();
    if (existing.length > 0) return existing;
  } catch (error) {
    if (!isNodeErrorCode(error, "ENOENT")) throw error;
  }

  const token = randomBytes(LOUPE_TOKEN_MIN_BYTES).toString("base64url");
  const handle = await open(tokenPath, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY, 0o600);
  try {
    await handle.writeFile(`${token}\n`, "utf8");
  } finally {
    await handle.close();
  }
  return token;
}

export async function writeServerStatus(options: ServerStatusOptions = {}): Promise<ServerStatusFile> {
  const home = await ensureLoupeHome(options);
  const tokenPath = options.tokenPath ?? tokenPathForHome(home);
  const status: ServerStatusFile = {
    pid: options.pid ?? process.pid,
    port: options.port ?? LOUPE_DEFAULT_PORT,
    token_path: tokenPath,
    started_at: options.startedAt ?? new Date().toISOString(),
  };
  const statusPath = serverStatusPathForHome(home);
  const tmpPath = `${statusPath}.${process.pid}.tmp`;
  await writeFile(tmpPath, `${JSON.stringify(status, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  await rename(tmpPath, statusPath);
  return status;
}
