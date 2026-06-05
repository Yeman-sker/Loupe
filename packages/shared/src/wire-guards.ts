const known_camel_case_fields = new Set([
  "schemaVersion",
  "projectId",
  "workspaceRootHash",
  "routeKey",
  "sessionId",
  "framePath",
  "shadowPath",
  "targetScope",
  "stableAttrs",
  "stableId",
  "accessibleName",
  "accesssibleName",
  "nthPath",
  "parentChain",
  "internalTargetSupported",
  "shellSelector",
  "locatorStatus",
  "matchedBy",
  "candidatesConsidered",
  "top1",
  "top2",
  "selectorPreview",
  "hasScreenshot",
  "createdAt",
  "updatedAt",
  "resolvedAt",
  "deletedAt",
]) as ReadonlySet<string>;

export function is_record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function is_string_array(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

export function is_number(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

export function has_no_known_camel_case_fields(value: unknown): boolean {
  if (Array.isArray(value)) return value.every(has_no_known_camel_case_fields);
  if (!is_record(value)) return true;

  for (const [key, child] of Object.entries(value)) {
    if (known_camel_case_fields.has(key) || !has_no_known_camel_case_fields(child)) return false;
  }
  return true;
}

export function has_only_keys(value: Record<string, unknown>, keys: ReadonlySet<string>): boolean {
  return Object.keys(value).every((key) => keys.has(key));
}


export function has_optional_string(record: Record<string, unknown>, key: string): boolean {
  return record[key] === undefined || typeof record[key] === "string";
}

export function is_string_record(value: unknown): value is Record<string, string> {
  return is_record(value) && Object.values(value).every((item) => typeof item === "string");
}
