export type ValidationResult = { ok: true; errors: [] } | { ok: false; errors: string[] };

export function validationResult(errors: string[]): ValidationResult {
  return errors.length === 0 ? { ok: true, errors: [] } : { ok: false, errors };
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string" && item.length > 0);
}

export function requireString(record: Record<string, unknown>, key: string, path: string, errors: string[]): void {
  if (typeof record[key] !== "string" || record[key].length === 0) {
    errors.push(`${path} must be a non-empty string`);
  }
}

export function requireOptionalString(record: Record<string, unknown>, key: string, path: string, errors: string[]): void {
  if (key in record) requireString(record, key, path, errors);
}

export function requireRelativePath(record: Record<string, unknown>, key: string, path: string, errors: string[]): void {
  const value = record[key];
  if (typeof value !== "string" || !value.startsWith("./")) {
    errors.push(`${path} must be a ./-prefixed relative path`);
  }
}

export function requireExactString(
  record: Record<string, unknown>,
  key: string,
  expected: string,
  path: string,
  errors: string[],
): void {
  if (record[key] !== expected) {
    errors.push(`${path} must be ${JSON.stringify(expected)}`);
  }
}
