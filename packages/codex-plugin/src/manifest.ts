import { readFile } from "node:fs/promises";
import { isRecord, isStringArray, requireOptionalString, requireRelativePath, requireString, validationResult, type ValidationResult } from "../../claude-plugin/src/manifest-guards.js";


export async function validateCodexPluginManifest(path: string): Promise<ValidationResult> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    return { ok: false, errors: [`Unable to read or parse ${path}: ${error instanceof Error ? error.message : String(error)}`] };
  }

  const errors: string[] = [];
  if (!isRecord(parsed)) {
    return { ok: false, errors: ["manifest must be an object"] };
  }

  requireString(parsed, "name", "name", errors);
  requireString(parsed, "version", "version", errors);
  requireString(parsed, "description", "description", errors);
  requireRelativePath(parsed, "skills", "skills", errors);
  requireRelativePath(parsed, "mcpServers", "mcpServers", errors);
  requireRelativePath(parsed, "hooks", "hooks", errors);

  if ("interface" in parsed) {
    if (!isRecord(parsed.interface)) {
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

  return validationResult(errors);
}

