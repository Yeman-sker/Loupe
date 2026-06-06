import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  test as base,
  expect,
  chromium,
  type BrowserContext,
  type Page,
  type Worker,
} from "@playwright/test";

import {
  startDaemon,
  startFixtureServer,
  type FixtureServerHandle,
} from "../scripts/serve-daemon.js";

export { expect };

// `chrome` is only available inside Playwright's browser/SW evaluate context;
// declare it so the callbacks type-check on the Node side.
declare const chrome: any;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// This file lives at <repo>/packages/e2e/src/ so repo root is three levels up.
const repoRoot = path.resolve(__dirname, "../../..");

export interface DaemonInfo {
  port: number;
  baseUrl: string;
  token: string;
}

export interface LoupeHelper {
  seedStorage: (items: Record<string, unknown>) => Promise<void>;
  pairDaemon: () => Promise<unknown>;
  getDaemonPairing: () => Promise<unknown>;
  open: (fixture?: string) => Promise<Page>;
  getLocalMarks: () => Promise<unknown[]>;
  getDaemonMarks: () => Promise<unknown[]>;
  syncToDaemon: () => Promise<unknown>;
}

export interface WorkerFixtures {
  fixtureServer: FixtureServerHandle;
}

export interface Fixtures {
  context: BrowserContext;
  serviceWorker: Worker;
  extensionId: string;
  daemon: DaemonInfo;
  loupe: LoupeHelper;
}

export const test = base.extend<Fixtures, WorkerFixtures>({
  fixtureServer: [
    async ({}, use: (server: FixtureServerHandle) => Promise<void>) => {
      const server = await startFixtureServer();
      await use(server);
      await server.close();
    },
    { scope: "worker" },
  ],

  context: async ({}, use) => {
    const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "loupe-e2e-ctx-"));
    const extPath = path.join(repoRoot, "packages/e2e/.test-ext");
    const context = await chromium.launchPersistentContext(userDataDir, {
      headless: process.env.LOUPE_E2E_HEADLESS === "1",
      args: [
        `--disable-extensions-except=${extPath}`,
        `--load-extension=${extPath}`,
        "--no-first-run",
        "--no-default-browser-check",
      ],
    });
    await use(context);
    await context.close();
    fs.rmSync(userDataDir, { recursive: true, force: true });
  },

  serviceWorker: async ({ context }, use) => {
    let worker = context.serviceWorkers()[0];
    if (!worker) {
      worker = await context.waitForEvent("serviceworker");
    }
    await use(worker);
  },

  extensionId: async ({ serviceWorker }, use) => {
    const id = new URL(serviceWorker.url()).host;
    await use(id);
  },

  daemon: async ({}, use) => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "loupe-e2e-home-"));
    const handle = await startDaemon({ home });
    await use({ port: handle.port, baseUrl: handle.baseUrl, token: handle.token });
    await handle.stop();
    fs.rmSync(home, { recursive: true, force: true });
  },

  loupe: async ({ context, serviceWorker, fixtureServer, daemon }, use) => {
    const seedStorage = async (items: Record<string, unknown>): Promise<void> => {
      await serviceWorker.evaluate(
        (i: Record<string, unknown>) => chrome.storage.local.set(i),
        items
      );
    };

    const pairDaemon = async (): Promise<unknown> => {
      const health = await fetch(`${daemon.baseUrl}/health`).then((res) => res.json() as Promise<Record<string, unknown>>);
      const pairing = {
        base_url: daemon.baseUrl,
        token: daemon.token,
        paired_at: new Date().toISOString(),
        token_path: "~/.loupe/token",
        ...(typeof health.project_id === "string" ? { project_id: health.project_id } : {}),
        ...(typeof health.workspace_root_hash === "string" ? { workspace_root_hash: health.workspace_root_hash } : {}),
        ...(typeof health.branch === "string" ? { branch: health.branch } : {}),
      };
      await seedStorage({ "loupe:v1:daemon": pairing });
      return { ok: true, paired: true, base_url: daemon.baseUrl };
    };

    const getDaemonPairing = async (): Promise<unknown> => {
      return serviceWorker.evaluate(async () => {
        const stored = await chrome.storage.local.get("loupe:v1:daemon");
        return stored["loupe:v1:daemon"];
      });
    };

    const open = async (fixture = "index.html"): Promise<Page> => {
      // Seed deterministic English UI prefs before the page mounts.
      await seedStorage({ "loupe:v1:ui:prefs": { theme: "light", lang: "en" } });
      await pairDaemon();
      const page = await context.newPage();
      await page.goto(fixtureServer.url(fixture));
      await page
        .locator("#loupe-surface-root")
        .waitFor({ state: "attached", timeout: 10_000 });
      return page;
    };

    const getLocalMarks = async (): Promise<unknown[]> => {
      return serviceWorker.evaluate(async () => {
        const all = await chrome.storage.local.get(null);
        const out: unknown[] = [];
        for (const [k, v] of Object.entries(all)) {
          if (/^loupe:v1:project:.*:session:.*:marks$/.test(k) && Array.isArray(v)) {
            out.push(...v);
          }
        }
        return out;
      });
    };

    // The daemon's GET /v1/marks requires a project scope (it returns a
    // `scope_required` 400 otherwise), so derive the scope from the first locally
    // saved mark and pass it as query params, mirroring background.js markListUrl.
    const getDaemonMarks = async (): Promise<unknown[]> => {
      const local = await getLocalMarks();
      const scope = (local[0] as { project?: Record<string, string> } | undefined)?.project;
      if (!scope?.project_id) return [];
      const params = new URLSearchParams();
      for (const key of ["project_id", "session_id", "workspace_root_hash", "origin", "url", "route_key"]) {
        const value = scope[key];
        if (typeof value === "string" && value.length > 0) params.set(key, value);
      }
      const res = await fetch(`${daemon.baseUrl}/v1/marks?${params.toString()}`, {
        headers: { authorization: `Bearer ${daemon.token}` },
      });
      if (!res.ok) return [];
      const body = (await res.json()) as { marks?: unknown[] };
      return body.marks ?? [];
    };

    const syncToDaemon = async (): Promise<unknown> => {
      const local = await getLocalMarks();
      const scope = (local[0] as { project?: Record<string, string> } | undefined)?.project;
      if (scope === undefined) return { ok: false, error: "No local mark scope" };
      return serviceWorker.evaluate(
        (s: Record<string, string>) => new Promise((resolve) => {
          chrome.runtime.sendMessage({ type: "loupe.service_worker.wake", scope: s }, (response: unknown) => resolve(response));
        }),
        scope,
      );
    };

    await use({ seedStorage, pairDaemon, getDaemonPairing, open, getLocalMarks, getDaemonMarks, syncToDaemon });
  },
});
