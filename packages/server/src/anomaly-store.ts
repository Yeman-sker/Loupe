import { mkdir, readdir, readFile, rename, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { join } from "node:path";

import { summarize_anomaly, type AnomalyReplayRecipe, type AnomalyReport, type AnomalyReportInput, type AnomalySummary } from "@loupe-server/shared";

import { isNodeErrorCode } from "./node-errors.js";

const ANOMALY_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function anomaliesDirForHome(home: string): string {
  return join(home, "anomalies");
}

export function anomalyDirForId(home: string, id: string): string {
  if (!isAnomalyId(id)) throw new TypeError("Expected UUID-shaped anomaly id.");
  return join(anomaliesDirForHome(home), id);
}

export function anomalyReplayRecipe(home: string, report: AnomalyReport): AnomalyReplayRecipe {
  const dir = anomalyDirForId(home, report.id);
  return {
    anomaly_id: report.id,
    report_path: join(dir, "report.json"),
    ...(report.has_dom ? { dom_path: join(dir, "dom.html") } : {}),
    ...(report.has_storage ? { storage_path: join(dir, "storage.json") } : {}),
    suggested_test_path: join(home, `${report.id}.repro.test.ts`),
    generator: "loupe anomalies repro",
    ...(report.expected === undefined ? {} : { expected: report.expected }),
    ...(report.actual === undefined ? {} : { actual: report.actual }),
    ...(report.error === undefined ? {} : { error: report.error }),
    breadcrumbs: report.breadcrumbs,
  };
}

export function isAnomalyId(id: string): boolean {
  return ANOMALY_ID_PATTERN.test(id);
}

export async function writeAnomaly(home: string, input: AnomalyReportInput): Promise<AnomalyReport> {
  const { dom_html, storage, ...rest } = input;
  const report: AnomalyReport = {
    ...rest,
    id: randomUUID(),
    created_at: new Date().toISOString(),
    has_dom: typeof dom_html === "string",
    has_storage: storage !== undefined,
  };

  const dir = anomalyDirForId(home, report.id);
  await mkdir(dir, { recursive: true, mode: 0o700 });
  await atomicWrite(join(dir, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  if (report.has_dom) await atomicWrite(join(dir, "dom.html"), dom_html as string);
  if (report.has_storage) await atomicWrite(join(dir, "storage.json"), `${JSON.stringify(storage, null, 2)}\n`);
  return report;
}

export async function listAnomalies(home: string): Promise<AnomalySummary[]> {
  let ids: string[];
  try {
    ids = await readdir(anomaliesDirForHome(home));
  } catch (error) {
    if (isNodeErrorCode(error, "ENOENT")) return [];
    throw error;
  }

  const reports: AnomalyReport[] = [];
  for (const id of ids) {
    if (!isAnomalyId(id)) continue;
    const report = await readAnomaly(home, id);
    if (report !== undefined) reports.push(report);
  }

  return sortReports(reports).map(summarize_anomaly);
}

export async function listAnomalyReports(home: string): Promise<AnomalyReport[]> {
  let ids: string[];
  try {
    ids = await readdir(anomaliesDirForHome(home));
  } catch (error) {
    if (isNodeErrorCode(error, "ENOENT")) return [];
    throw error;
  }

  const reports: AnomalyReport[] = [];
  for (const id of ids) {
    if (!isAnomalyId(id)) continue;
    const report = await readAnomaly(home, id);
    if (report !== undefined) reports.push(report);
  }

  return sortReports(reports);
}

function sortReports(reports: AnomalyReport[]): AnomalyReport[] {
  reports.sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
  return reports;
}

export async function getAnomaly(home: string, id: string): Promise<AnomalyReport | undefined> {
  if (!isAnomalyId(id)) return undefined;
  return readAnomaly(home, id);
}

async function readAnomaly(home: string, id: string): Promise<AnomalyReport | undefined> {
  try {
    const raw = await readFile(join(anomalyDirForId(home, id), "report.json"), "utf8");
    return JSON.parse(raw) as AnomalyReport;
  } catch {
    return undefined;
  }
}

async function atomicWrite(path: string, data: string): Promise<void> {
  const tmp = `${path}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(tmp, data, { encoding: "utf8", mode: 0o600 });
  await rename(tmp, path);
}
