import { readFile } from "node:fs/promises";

export type ValidationResult = {
  ok: boolean;
  errors: string[];
};

export async function validateCodexPluginManifest(path: string): Promise<ValidationResult> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    return { ok: false, errors: [`Unable to read or parse ${path}: ${error instanceof Error ? error.message : String(error)}`] };
  }

  const errors: string[] = [];
  if (!isObject(parsed)) {
    return { ok: false, errors: ["manifest must be an object"] };
  }

  requireString(parsed, "name", errors);
  requireString(parsed, "version", errors);
  requireString(parsed, "description", errors);
  requireRelativePath(parsed, "skills", errors);
  requireRelativePath(parsed, "mcpServers", errors);
  requireRelativePath(parsed, "hooks", errors);

  if ("interface" in parsed) {
    if (!isObject(parsed.interface)) {
      errors.push("interface must be an object");
    } else {
      requireOptionalString(parsed.interface, "displayName", "interface.displayName", errors);
      requireOptionalString(parsed.interface, "shortDescription", "interface.shortDescription", errors);
      requireOptionalString(parsed.interface, "longDescription", "interface.longDescription", errors);
      requireOptionalString(parsed.interface, "developerName", "interface.developerName", errors);
      requireOptionalString(parsed.interface, "category", "interface.category", errors);
      if ("capabilities" in parsed.interface && !isStringArray(parsed.interface.capabilities)) {
        errors.push("interface.capabilities must be an array of strings");
      }
    }
  }

  return { ok: errors.length === 0, errors };
}

function requireString(object: Record<string, unknown>, key: string, errors: string[]): void {
  if (typeof object[key] !== "string" || object[key].length === 0) {
    errors.push(`${key} must be a non-empty string`);
  }
}

function requireOptionalString(object: Record<string, unknown>, key: string, label: string, errors: string[]): void {
  if (key in object && (typeof object[key] !== "string" || object[key].length === 0)) {
    errors.push(`${label} must be a non-empty string`);
  }
}

function requireRelativePath(object: Record<string, unknown>, key: string, errors: string[]): void {
  const value = object[key];
  if (typeof value !== "string" || !value.startsWith("./")) {
    errors.push(`${key} must be a ./-prefixed relative path`);
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string" && item.length > 0);
}
