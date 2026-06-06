#!/usr/bin/env node
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { execFileSync } from "node:child_process";

const root = process.cwd();
const statePath = join(root, ".claude", "release-state.json");

const packages = [
  {
    key: "shared",
    name: "@loupe-server/shared",
    path: "packages/shared",
    command: "/publish-share",
    publishCommand: "npm publish ./packages/shared --access public",
    inputRoots: ["packages/shared/src", "packages/shared/package.json", "packages/shared/tsconfig.build.json"],
  },
  {
    key: "server",
    name: "@loupe-server/server",
    path: "packages/server",
    command: "/publish-server",
    publishCommand: "npm publish ./packages/server --access public",
    inputRoots: ["packages/server/src", "packages/server/package.json", "packages/server/tsconfig.build.json"],
  },
];

function run(command, args) {
  try {
    return execFileSync(command, args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  } catch (error) {
    const stderr = error?.stderr?.toString?.().trim();
    const stdout = error?.stdout?.toString?.().trim();
    throw new Error([stdout, stderr].filter(Boolean).join("\n") || `${command} ${args.join(" ")} failed`);
  }
}

function compareSemver(a, b) {
  const pa = a.split(".").map((part) => Number.parseInt(part, 10));
  const pb = b.split(".").map((part) => Number.parseInt(part, 10));
  for (let index = 0; index < 3; index += 1) {
    const delta = (pa[index] || 0) - (pb[index] || 0);
    if (delta !== 0) return delta;
  }
  return 0;
}

async function listFiles(path) {
  const absolute = join(root, path);
  if (!existsSync(absolute)) return [];
  const entries = await readdir(absolute, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const child = join(path, entry.name);
    if (entry.isDirectory()) {
      files.push(...await listFiles(child));
    } else if (!entry.name.endsWith(".test.ts") && !entry.name.endsWith(".js") && !entry.name.endsWith(".js.map")) {
      files.push(child);
    }
  }
  return files;
}

function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

async function normalizedFileContent(file) {
  const text = await readFile(join(root, file), "utf8");
  if (file.endsWith("package.json")) {
    const parsed = JSON.parse(text);
    delete parsed.version;
    return `${stableStringify(parsed)}\n`;
  }
  return text;
}

async function inputHash(pkg) {
  const hash = createHash("sha256");
  const files = [];
  for (const inputRoot of pkg.inputRoots) {
    const absolute = join(root, inputRoot);
    if (!existsSync(absolute)) continue;
    const statFiles = inputRoot.endsWith(".json") ? [inputRoot] : await listFiles(inputRoot);
    files.push(...statFiles);
  }
  files.sort();
  for (const file of files) {
    hash.update(relative(root, join(root, file)));
    hash.update("\0");
    hash.update(await normalizedFileContent(file));
    hash.update("\0");
  }
  return `sha256:${hash.digest("hex")}`;
}

async function readPackageJson(pkg) {
  return JSON.parse(await readFile(join(root, pkg.path, "package.json"), "utf8"));
}

async function readState() {
  if (!existsSync(statePath)) return { packages: {} };
  return JSON.parse(await readFile(statePath, "utf8"));
}

let npmIdentity;
try {
  npmIdentity = run("npm", ["whoami"]);
} catch {
  process.stderr.write("Release check skipped: npm is not authenticated. Run npm login.\n");
  process.exit(1);
}

const state = await readState();
const pendingPrep = [];
const pendingPublish = [];

for (const pkg of packages) {
  const packageJson = await readPackageJson(pkg);
  const publishedVersion = run("npm", ["view", pkg.name, "version"]);
  const currentHash = await inputHash(pkg);
  const stored = state.packages?.[pkg.name];

  if (compareSemver(packageJson.version, publishedVersion) > 0) {
    pendingPublish.push({ pkg, localVersion: packageJson.version, publishedVersion });
    continue;
  }

  if (stored?.lastPublishedInputHash && stored.lastPublishedInputHash !== currentHash) {
    pendingPrep.push({ pkg, localVersion: packageJson.version, publishedVersion });
  }
}

if (pendingPublish.length === 0 && pendingPrep.length === 0) {
  process.stdout.write(`No Loupe package release needed. npm identity: ${npmIdentity}.\n`);
  process.exit(0);
}

if (pendingPublish.length > 0) {
  process.stderr.write("Publish pending.\n\n");
  for (const item of pendingPublish) {
    process.stderr.write(`${item.pkg.name} local ${item.localVersion} > npm ${item.publishedVersion}\n`);
    process.stderr.write(`Publish command:\n${item.pkg.publishCommand}\n\n`);
  }
}

if (pendingPrep.length > 0) {
  process.stderr.write("Release prep required.\n\n");
  const ordered = pendingPrep.sort((a, b) => a.pkg.key === "shared" && b.pkg.key === "server" ? -1 : a.pkg.key === "server" && b.pkg.key === "shared" ? 1 : 0);
  process.stderr.write("Run in order:\n");
  for (let index = 0; index < ordered.length; index += 1) {
    process.stderr.write(`${index + 1}. ${ordered[index].pkg.command}\n`);
  }
  process.stderr.write("\nDo not run npm publish directly. Commands stop after dry-run and print the exact publish command.\n");
}

process.exit(1);
