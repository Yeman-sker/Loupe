import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { FIXTURE_HOST_PERMISSIONS } from "../src/constants.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// This file lives at <repo>/packages/e2e/scripts/prep-ext.ts
// so repo root is three levels up.
const repoRoot = path.resolve(__dirname, "../../..");
const extDir = path.join(repoRoot, "packages/extension");
const destDir = path.join(repoRoot, "packages/e2e/.test-ext");

function buildExtension(): void {
  const result = spawnSync("pnpm", ["--filter", "@loupe/extension", "build"], {
    cwd: repoRoot,
    stdio: "inherit",
    shell: true,
  });
  if (result.status !== 0) {
    throw new Error(
      `Extension build failed with exit code ${result.status ?? "unknown"}`
    );
  }
}

function copyExtension(): void {
  fs.rmSync(destDir, { recursive: true, force: true });
  fs.mkdirSync(destDir, { recursive: true });

  const entries = [
    "manifest.json",
    "src",
    "dist",
    "assets",
  ] as const;

  for (const entry of entries) {
    const src = path.join(extDir, entry);
    const dest = path.join(destDir, entry);
    if (fs.existsSync(src)) {
      fs.cpSync(src, dest, { recursive: true });
    }
  }
}

function patchClosedToOpen(filePath: string): void {
  if (!fs.existsSync(filePath)) {
    throw new Error(`Expected file for patching does not exist: ${filePath}`);
  }

  const original = fs.readFileSync(filePath, "utf8");

  if (!original.includes('mode: "closed"')) {
    // Already patched (idempotent) or file doesn't have the expected content.
    // Only throw if it also doesn't have the open mode — means something is wrong.
    if (!original.includes('mode: "open"')) {
      throw new Error(
        `File does not contain 'mode: "closed"' or 'mode: "open"' — unexpected content: ${filePath}`
      );
    }
    return;
  }

  const patched = original.replaceAll('mode: "closed"', 'mode: "open"');

  if (patched.includes('mode: "closed"')) {
    throw new Error(`Patch failed — 'mode: "closed"' still present after replace: ${filePath}`);
  }
  if (!patched.includes('mode: "open"')) {
    throw new Error(`Patch failed — 'mode: "open"' not found after replace: ${filePath}`);
  }

  fs.writeFileSync(filePath, patched, "utf8");
}

// Grant the fixture origin host permission at install time so the content
// script self-authorizes without a user gesture (chrome.permissions.request
// requires a gesture that headless tests can't supply). Test-copy only.
function patchManifestHostPermissions(): void {
  const manifestPath = path.join(destDir, "manifest.json");
  if (!fs.existsSync(manifestPath)) {
    throw new Error(`Expected manifest does not exist: ${manifestPath}`);
  }
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8")) as {
    host_permissions?: string[];
  };
  const existing = Array.isArray(manifest.host_permissions) ? manifest.host_permissions : [];
  manifest.host_permissions = [...new Set([...existing, ...FIXTURE_HOST_PERMISSIONS])];
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n", "utf8");
}

export async function prepExtension(): Promise<string> {
  buildExtension();
  copyExtension();

  const contentJs = path.join(destDir, "src/content.js");
  const hostJs = path.join(destDir, "dist/ui/host.js");

  patchClosedToOpen(contentJs);
  patchClosedToOpen(hostJs);
  patchManifestHostPermissions();

  return destDir;
}

// Run as CLI when executed directly.
const isMain =
  process.argv[1] != null &&
  path.resolve(process.argv[1]) === path.resolve(__filename);

if (isMain) {
  prepExtension()
    .then((result) => console.log(result))
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
