import { copyFile, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { basename } from "node:path";

import { assert_storage_envelope, LOUPE_SCHEMA_VERSION, type StorageEnvelope } from "@loupe-server/shared";

import { marksPathForHome } from "./loupe-home.js";
import { isNodeErrorCode } from "./node-errors.js";

export type StoreWarning = { code: string; message: string; file?: string };

export type MarkStore = {
  home: string;
  path: string;
  envelope: StorageEnvelope;
  warnings: StoreWarning[];
  save_chain: Promise<void>;
};

export type MarkStoreSummary = {
  path: string;
  projects: number;
  marks: number;
  open: number;
  warnings: StoreWarning[];
};

export async function summarizeMarkStore(home: string): Promise<MarkStoreSummary> {
  const store = await loadMarkStore(home);
  const counts = countStoreMarks(store.envelope);
  return { path: store.path, projects: counts.projects, marks: counts.marks, open: counts.open, warnings: store.warnings };
}

function countStoreMarks(envelope: StorageEnvelope): { projects: number; marks: number; open: number } {
  let marks = 0;
  let open = 0;
  const projects = Object.values(envelope.projects);
  for (const project of projects) {
    for (const session of Object.values(project.sessions)) {
      for (const mark of session.marks) {
        marks += 1;
        if (mark.lifecycle.task_status === "open") open += 1;
      }
    }
  }
  return { projects: projects.length, marks, open };
}

export async function loadMarkStore(home: string): Promise<MarkStore> {
  await mkdir(home, { recursive: true, mode: 0o700 });
  const path = marksPathForHome(home);
  const warnings: StoreWarning[] = [];
  let envelope = emptyEnvelope();

  try {
    const raw = await readFile(path, "utf8");
    const parsed = JSON.parse(raw) as unknown;
    assert_storage_envelope(parsed);
    envelope = parsed;
  } catch (error) {
    if (isNodeErrorCode(error, "ENOENT")) {
      // Empty first-run store.
    } else if (error instanceof SyntaxError) {
      const backup = `${path}.corrupted.${new Date().toISOString().replace(/[:.]/g, "-")}`;
      await copyOrRenameCorruptFile(path, backup);
      warnings.push({ code: "CORRUPT_MARKS_JSON", message: "marks.json was corrupt JSON and was backed up.", file: basename(backup) });
    } else {
      throw error;
    }
  }

  const store: MarkStore = { home, path, envelope, warnings, save_chain: Promise.resolve() };
  if (warnings.length > 0) await saveStore(store);
  return store;
}

export function emptyEnvelope(): StorageEnvelope {
  return { schema_version: LOUPE_SCHEMA_VERSION, projects: {} };
}

async function copyOrRenameCorruptFile(path: string, backup: string): Promise<void> {
  try {
    await rename(path, backup);
  } catch (error) {
    if (!isNodeErrorCode(error, "EXDEV")) throw error;
    await copyFile(path, backup);
  }
}

export async function saveStore(store: MarkStore): Promise<void> {
  const save = store.save_chain.then(async () => {
    await mkdir(store.home, { recursive: true, mode: 0o700 });
    const tmpPath = `${store.path}.${process.pid}.${Date.now()}.tmp`;
    await writeFile(tmpPath, `${JSON.stringify(store.envelope, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
    await rename(tmpPath, store.path);
  });
  store.save_chain = save.catch(() => undefined);
  await save;
}
