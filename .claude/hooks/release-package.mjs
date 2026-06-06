#!/usr/bin/env node
import { createHash } from "node:crypto";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, relative } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";

const root = process.cwd();
const statePath = join(root, ".claude", "release-state.json");

const packageConfigs = {
  shared: {
    key: "shared",
    name: "@loupe-server/shared",
    path: "packages/shared",
    command: "/publish-share",
    publishCommand: "npm publish ./packages/shared --access public",
    build: ["pnpm", ["--filter", "@loupe-server/shared", "build"]],
    test: ["pnpm", ["--filter", "@loupe-server/shared", "test"]],
    packFiles: ["dist/index.js"],
    expectedBin: null,
    inputRoots: ["packages/shared/src", "packages/shared/package.json", "packages/shared/tsconfig.build.json"],
  },
  server: {
    key: "server",
    name: "@loupe-server/server",
    path: "packages/server",
    command: "/publish-server",
    publishCommand: "npm publish ./packages/server --access public",
    build: ["pnpm", ["--filter", "@loupe-server/server", "build"]],
    test: ["pnpm", ["--filter", "@loupe-server/server", "test"]],
    packFiles: ["dist/cli.js", "dist/index.js", "dist/server.js"],
    expectedBin: { "loupe-server": "dist/cli.js", loupe: "dist/cli.js" },
    inputRoots: ["packages/server/src", "packages/server/package.json", "packages/server/tsconfig.build.json"],
  },
};

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd || root,
    encoding: "utf8",
    stdio: options.inherit ? "inherit" : ["ignore", "pipe", "pipe"],
  });
  if (result.status !== 0) {
    const stderr = result.stderr?.trim?.();
    const stdout = result.stdout?.trim?.();
    throw new Error([stdout, stderr].filter(Boolean).join("\n") || `${command} ${args.join(" ")} failed`);
  }
  if (options.inherit) return "";
  return [result.stdout, result.stderr].filter(Boolean).join("\n").trim();
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

function bumpVersion(version, kind) {
  const [major, minor, patch] = version.split(".").map((part) => Number.parseInt(part, 10));
  if (kind === "minor") return `${major}.${minor + 1}.0`;
  return `${major}.${minor}.${patch + 1}`;
}

function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
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
    if (!existsSync(join(root, inputRoot))) continue;
    files.push(...(inputRoot.endsWith(".json") ? [inputRoot] : await listFiles(inputRoot)));
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

async function writePackageJson(pkg, packageJson) {
  await writeFile(join(root, pkg.path, "package.json"), `${JSON.stringify(packageJson, null, 2)}\n`);
}

async function readState() {
  if (!existsSync(statePath)) return { packages: {} };
  return JSON.parse(await readFile(statePath, "utf8"));
}

async function writeState(state) {
  await writeFile(statePath, `${JSON.stringify(state, null, 2)}\n`);
}

async function collectDts(base) {
  async function walk(dir) {
    const entries = await readdir(dir, { withFileTypes: true });
    const files = [];
    for (const entry of entries) {
      const child = join(dir, entry.name);
      if (entry.isDirectory()) files.push(...await walk(child));
      else if (entry.name.endsWith(".d.ts")) files.push(child);
    }
    return files;
  }
  const dist = join(base, "dist");
  if (!existsSync(dist)) return new Map();
  const files = await walk(dist);
  const surfaces = new Map();
  for (const file of files.sort()) {
    surfaces.set(relative(dist, file), await readFile(file, "utf8"));
  }
  return surfaces;
}

function packageSurface(packageJson) {
  return stableStringify({ exports: packageJson.exports || null, bin: packageJson.bin || null, dependencies: packageJson.dependencies || null });
}

function classifyDeclarationChange(oldDts, currentDts) {
  let changed = false;
  for (const [file, oldText] of oldDts) {
    const currentText = currentDts.get(file);
    if (currentText === undefined) return "breaking";
    if (currentText === oldText) continue;
    changed = true;
    const oldLines = oldText.split("\n").filter((line) => line.trim() !== "");
    const currentLines = new Set(currentText.split("\n").filter((line) => line.trim() !== ""));
    for (const line of oldLines) {
      if (!currentLines.has(line)) return "breaking";
    }
  }
  if (currentDts.size > oldDts.size || changed) return "minor";
  return "patch";
}

async function extractPublishedPackage(pkg, publishedVersion) {
  const temp = await mkdtemp(join(tmpdir(), "loupe-release-"));
  const tarball = run("npm", ["pack", `${pkg.name}@${publishedVersion}`, "--pack-destination", temp, "--silent"])
    .split("\n")
    .map((line) => line.trim())
    .find((line) => line.endsWith(".tgz"));
  if (!tarball) throw new Error(`Unable to locate npm pack tarball for ${pkg.name}@${publishedVersion}.`);
  const tarballPath = join(temp, tarball);
  run("tar", ["-xzf", tarballPath, "-C", temp]);
  return { temp, path: join(temp, "package") };
}

async function chooseBumpKind(pkg, publishedVersion) {
  const currentPackage = await readPackageJson(pkg);
  const published = await extractPublishedPackage(pkg, publishedVersion);
  try {
    const publishedPackage = JSON.parse(await readFile(join(published.path, "package.json"), "utf8"));
    if (packageSurface(currentPackage) !== packageSurface(publishedPackage)) {
      if (pkg.expectedBin && stableStringify(currentPackage.bin) !== stableStringify(pkg.expectedBin)) {
        throw new Error(`${pkg.name} bin changed. Pass an explicit version after reviewing the breaking surface.`);
      }
      return "minor";
    }
    const oldDts = await collectDts(published.path);
    const currentDts = await collectDts(join(root, pkg.path));
    const declarationChange = classifyDeclarationChange(oldDts, currentDts);
    if (declarationChange === "breaking") {
      throw new Error(`${pkg.name} declaration surface removed or changed existing lines. Pass an explicit version after reviewing whether this is major.`);
    }
    return declarationChange;
  } finally {
    await rm(published.temp, { recursive: true, force: true });
  }
}

function validateBin(pkg, packageJson) {
  if (pkg.expectedBin === null) {
    if ("bin" in packageJson) throw new Error(`${pkg.name} must not publish a bin field.`);
    return;
  }
  if (stableStringify(packageJson.bin) !== stableStringify(pkg.expectedBin)) {
    throw new Error(`${pkg.name} bin must remain ${stableStringify(pkg.expectedBin)}.`);
  }
}

function validatePackOutput(pkg, output, targetVersion) {
  if (output.includes("npm WARN") && /bin|auto-correct|correct|remove/i.test(output)) {
    throw new Error("npm pack warned about auto-correcting or removing package fields. Stop before publish.");
  }
  if (!output.includes(`${pkg.name}@${targetVersion}`) && !output.includes(`version: ${targetVersion}`)) {
    throw new Error(`Dry-run output does not include intended version ${targetVersion}.`);
  }
  for (const file of pkg.packFiles) {
    if (!output.includes(file)) throw new Error(`Dry-run output does not include ${file}.`);
  }
}

async function prepareRelease(pkg, explicitVersion) {
  try {
    run("npm", ["whoami"]);
  } catch {
    throw new Error("npm is not authenticated. Run npm login.");
  }
  const publishedVersion = run("npm", ["view", pkg.name, "version"]);
  let packageJson = await readPackageJson(pkg);

  const [buildCommand, buildArgs] = pkg.build;
  run(buildCommand, buildArgs, { inherit: true });

  const targetVersion = explicitVersion || bumpVersion(publishedVersion, await chooseBumpKind(pkg, publishedVersion));
  if (compareSemver(targetVersion, publishedVersion) <= 0) {
    throw new Error(`Target version ${targetVersion} must be greater than published version ${publishedVersion}.`);
  }

  if (packageJson.version !== targetVersion) {
    packageJson.version = targetVersion;
    await writePackageJson(pkg, packageJson);
  }

  packageJson = await readPackageJson(pkg);
  validateBin(pkg, packageJson);

  run(buildCommand, buildArgs, { inherit: true });
  const [testCommand, testArgs] = pkg.test;
  run(testCommand, testArgs, { inherit: true });
  const packOutput = run("npm", ["pack", `./${pkg.path}`, "--dry-run"]);
  process.stdout.write(`${packOutput}\n`);
  validatePackOutput(pkg, packOutput, targetVersion);

  process.stdout.write(`\nTarget version: ${targetVersion}\n`);
  process.stdout.write("Checks passed: npm identity, published version, build, test, dry-run package contents.\n");
  process.stdout.write("Publish command:\n");
  process.stdout.write(`${pkg.publishCommand}\n`);
}

async function markPublished(pkg) {
  const packageJson = await readPackageJson(pkg);
  const publishedVersion = run("npm", ["view", pkg.name, "version"]);
  if (packageJson.version !== publishedVersion) {
    throw new Error(`${pkg.name} local version ${packageJson.version} does not match npm ${publishedVersion}. Publish first.`);
  }
  const state = await readState();
  state.packages ||= {};
  state.packages[pkg.name] = {
    path: pkg.path,
    command: pkg.command,
    publishCommand: pkg.publishCommand,
    lastPublishedVersion: publishedVersion,
    lastPublishedInputHash: await inputHash(pkg),
  };
  await writeState(state);
  process.stdout.write(`Updated release state for ${pkg.name}@${publishedVersion}.\n`);
}

const [actionOrPackage, maybePackageOrVersion, maybeVersion] = process.argv.slice(2);
const action = actionOrPackage === "mark-published" ? "mark-published" : "prepare";
const packageKey = action === "mark-published" ? maybePackageOrVersion : actionOrPackage;
const explicitVersion = action === "mark-published" ? maybeVersion : maybePackageOrVersion;
const pkg = packageConfigs[packageKey];

if (!pkg) {
  process.stderr.write("Usage: node .claude/hooks/release-package.mjs <shared|server> [version]\n");
  process.stderr.write("       node .claude/hooks/release-package.mjs mark-published <shared|server>\n");
  process.exit(2);
}

try {
  if (action === "mark-published") await markPublished(pkg);
  else await prepareRelease(pkg, explicitVersion);
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
}
