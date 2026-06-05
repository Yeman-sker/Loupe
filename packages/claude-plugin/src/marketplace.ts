import { readFile } from "node:fs/promises";
import { isRecord, isStringArray, requireExactString, requireOptionalString, requireString } from "./manifest-guards.js";

export type MarketplaceValidationResult = { ok: true } | { ok: false; errors: string[] };

const forbiddenPluginFields = ["repositoryUrl", "ref", "path", "type", "subdirectory"] as const;

export async function loadMarketplaceManifest(path: string): Promise<unknown> {
  return JSON.parse(await readFile(path, "utf8")) as unknown;
}

export function validateMarketplaceManifest(value: unknown): MarketplaceValidationResult {
  const errors: string[] = [];

  if (!isRecord(value)) {
    return { ok: false, errors: ["manifest must be an object"] };
  }

  requireString(value, "name", "manifest.name", errors);

  if (!isRecord(value.owner)) {
    errors.push("manifest.owner must be an object");
  } else {
    requireString(value.owner, "name", "manifest.owner.name", errors);
  }

  if (!Array.isArray(value.plugins)) {
    errors.push("manifest.plugins must be an array");
  } else if (value.plugins.length === 0) {
    errors.push("manifest.plugins must contain at least one plugin");
  } else {
    value.plugins.forEach((plugin, index) => validatePlugin(plugin, index, errors));
  }

  return errors.length === 0 ? { ok: true } : { ok: false, errors };
}

function validatePlugin(plugin: unknown, index: number, errors: string[]): void {
  const prefix = `manifest.plugins[${index}]`;

  if (!isRecord(plugin)) {
    errors.push(`${prefix} must be an object`);
    return;
  }

  for (const field of forbiddenPluginFields) {
    if (field in plugin) {
      errors.push(`${prefix}.${field} is not allowed; use ${prefix}.source instead`);
    }
  }

  requireString(plugin, "name", `${prefix}.name`, errors);
  requireOptionalString(plugin, "description", `${prefix}.description`, errors);
  requireOptionalString(plugin, "displayName", `${prefix}.displayName`, errors);
  requireOptionalString(plugin, "version", `${prefix}.version`, errors);
  requireOptionalString(plugin, "homepage", `${prefix}.homepage`, errors);
  requireOptionalString(plugin, "repository", `${prefix}.repository`, errors);
  requireOptionalString(plugin, "license", `${prefix}.license`, errors);
  if ("keywords" in plugin && !isStringArray(plugin.keywords)) {
    errors.push(`${prefix}.keywords must be an array of strings`);
  }

  if (!isRecord(plugin.source)) {
    errors.push(`${prefix}.source must be an object`);
    return;
  }

  requireExactString(plugin.source, "source", "git-subdir", `${prefix}.source.source`, errors);
  requireString(plugin.source, "url", `${prefix}.source.url`, errors);
  requireString(plugin.source, "path", `${prefix}.source.path`, errors);
  requireString(plugin.source, "ref", `${prefix}.source.ref`, errors);
}

