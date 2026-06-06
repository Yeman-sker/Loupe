import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

import { createAnomalyInstrumentation, postAnomaly, readDaemonCredentials } from "./anomaly-capture.js";

const creds = { base_url: "http://127.0.0.1:7373", token: "secret-token" };
const fakeGet = (store: Record<string, unknown>) => async (key: string) => ({ [key]: store[key] });
if (!("ShadowRoot" in globalThis)) (globalThis as { ShadowRoot?: unknown }).ShadowRoot = class ShadowRoot {};

type Listener = (event: unknown) => void;

class TestElement {
  nodeType = 1;
  tagName = "BUTTON";
  localName = "button";
  attributes = [{ name: "id", value: "save" }];
  childNodes: Array<{ nodeType: number; textContent: string }> = [{ nodeType: 3, textContent: "Save" }];
  parentElement = null;
  shadowRoot = null;
  id = "save";
  className = "";
  classList: string[] = [];
  textContent = "Save";
  ownerDocument: unknown = null;
  previousElementSibling = null;

  getRootNode(): unknown {
    return this.ownerDocument;
  }

  getAttribute(name: string): string | null {
    return this.attributes.find((attr) => attr.name === name)?.value ?? null;
  }

  hasAttribute(name: string): boolean {
    return this.attributes.some((attr) => attr.name === name);
  }

  getBoundingClientRect(): DOMRect {
    return { x: 10, y: 20, width: 30, height: 40, top: 20, left: 10, right: 40, bottom: 60, toJSON: () => ({}) } as DOMRect;
  }
}

function testApi(target: Element | null, listeners: Record<string, Listener[]> = {}) {
  const win = {
    location: { href: "http://example.test/page" },
    navigator: { userAgent: "test" },
    innerWidth: 800,
    innerHeight: 600,
    devicePixelRatio: 1,
    addEventListener: (type: string, listener: Listener) => (listeners[type] ??= []).push(listener),
    removeEventListener: (type: string, listener: Listener) => {
      const bucket = listeners[type] ?? [];
      const index = bucket.indexOf(listener);
      if (index !== -1) bucket.splice(index, 1);
    },
    prompt: () => null,
  };
  const doc = {
    nodeType: 9,
    title: "Test Page",
    defaultView: win,
    location: win.location,
    activeElement: null,
    addEventListener: (type: string, listener: Listener) => (listeners[type] ??= []).push(listener),
    removeEventListener: (type: string, listener: Listener) => {
      const bucket = listeners[type] ?? [];
      const index = bucket.indexOf(listener);
      if (index !== -1) bucket.splice(index, 1);
    },
    querySelector: () => target,
    querySelectorAll: () => (target === null ? [] : [target]),
  };
  if (target !== null && "ownerDocument" in target) (target as { ownerDocument: unknown }).ownerDocument = doc;
  return {
    document: doc as unknown as Document,
    getCurrentTarget: () => target,
    getScopeInput: () => ({ url: "http://example.test/page", title: "Test Page", project_id: "project-1" }),
  };
}

async function flush(): Promise<void> {
  for (let i = 0; i < 5; i += 1) await new Promise((resolve) => setTimeout(resolve, 0));
}

describe("readDaemonCredentials", () => {
  it("reads the paired daemon credentials from storage", async () => {
    const result = await readDaemonCredentials(fakeGet({ "loupe:v1:daemon": creds }));
    assert.deepEqual(result, creds);
  });

  it("returns undefined when unpaired or malformed", async () => {
    assert.equal(await readDaemonCredentials(fakeGet({})), undefined);
    assert.equal(await readDaemonCredentials(fakeGet({ "loupe:v1:daemon": { base_url: "x" } })), undefined);
    assert.equal(await readDaemonCredentials(fakeGet({ "loupe:v1:daemon": { base_url: "", token: "t" } })), undefined);
  });
});

describe("postAnomaly", () => {
  const report = { schema_version: 1, source: "manual", summary: "wrong pin", breadcrumbs: [], env: {} };

  it("POSTs with the bearer token and returns the created id", async () => {
    const calls: Array<{ url: string; init: RequestInit | undefined }> = [];
    const result = await postAnomaly(
      async (url, init) => {
        calls.push({ url, init });
        return Response.json({ anomaly: { id: "anomaly-1" } });
      },
      creds,
      report,
    );

    assert.deepEqual(result, { ok: true, id: "anomaly-1" });
    assert.equal(calls[0]?.url, "http://127.0.0.1:7373/v1/anomalies");
    assert.equal(calls[0]?.init?.method, "POST");
    assert.equal((calls[0]?.init?.headers as Record<string, string>).authorization, "Bearer secret-token");
    assert.deepEqual(JSON.parse(String(calls[0]?.init?.body)), report);
  });

  it("returns an error on a non-ok response without throwing", async () => {
    const result = await postAnomaly(async () => new Response("nope", { status: 500 }), creds, report);
    assert.equal(result.ok, false);
    assert.match(String(result.error), /500/);
  });

  it("returns an error when the fetch throws", async () => {
    const result = await postAnomaly(async () => {
      throw new Error("network down");
    }, creds, report);
    assert.equal(result.ok, false);
    assert.match(String(result.error), /network down/);
  });
});

describe("createAnomalyInstrumentation", () => {
  it("requires manual expected text and reports capture failure on blank/cancel", async () => {
    const results: unknown[] = [];
    const listeners: Record<string, Listener[]> = {};
    const instrumentation = createAnomalyInstrumentation({ prompt: () => "", onResult: (result) => results.push(result) });
    instrumentation.attach?.(testApi(new TestElement() as unknown as Element, listeners));

    listeners.keydown?.[0]?.({ altKey: true, shiftKey: true, key: "A", preventDefault: () => {} });
    await flush();

    assert.deepEqual(results, [{ ok: false, error: "Manual anomaly capture requires expected behavior" }]);
  });

  it("posts manual expected text and actual default without exposing daemon token to prompts", async () => {
    const prompts: Array<{ message: string; defaultValue: string | undefined }> = [];
    const reports: unknown[] = [];
    const listeners: Record<string, Listener[]> = {};
    const instrumentation = createAnomalyInstrumentation({
      storageGet: fakeGet({ "loupe:v1:daemon": creds }),
      prompt: (message, defaultValue) => {
        prompts.push({ message, defaultValue });
        return prompts.length === 1 ? "Expected pin on Save" : "";
      },
      fetchImpl: async (_url, init) => {
        reports.push(JSON.parse(String(init?.body)));
        return Response.json({ anomaly: { id: "anomaly-2" } });
      },
      onResult: () => undefined,
    });
    instrumentation.attach?.(testApi(new TestElement() as unknown as Element, listeners));

    listeners.keydown?.[0]?.({ altKey: true, shiftKey: true, key: "a", preventDefault: () => {} });
    await flush();

    const report = reports[0] as { source: string; expected: string; actual: string };
    assert.equal(report.source, "manual");
    assert.equal(report.expected, "Expected pin on Save");
    assert.match(report.actual, /Current target:/);
    assert.equal(JSON.stringify(prompts).includes(creds.token), false);
  });

  it("captures window error and unhandledrejection then detaches listeners", async () => {
    const reports: Array<{ source: string; error?: { message: string } }> = [];
    const listeners: Record<string, Listener[]> = {};
    const instrumentation = createAnomalyInstrumentation({
      storageGet: fakeGet({ "loupe:v1:daemon": creds }),
      fetchImpl: async (_url, init) => {
        reports.push(JSON.parse(String(init?.body)));
        return Response.json({ anomaly: { id: "anomaly-3" } });
      },
      onResult: () => undefined,
    });
    instrumentation.attach?.(testApi(new TestElement() as unknown as Element, listeners));

    listeners.error?.[0]?.({ error: new Error("boom") });
    listeners.unhandledrejection?.[0]?.({ reason: "promise boom" });
    await flush();

    assert.deepEqual(reports.map((report) => [report.source, report.error?.message]), [
      ["hard_error", "boom"],
      ["hard_error", "promise boom"],
    ]);

    instrumentation.detach?.();
    assert.equal(listeners.error?.length, 0);
    assert.equal(listeners.unhandledrejection?.length, 0);
    assert.equal(listeners.keydown?.length, 0);
  });

  it("exposes a real invariant capture hook after attach", async () => {
    const reports: Array<{ source: string; expected?: string; actual?: string }> = [];
    const instrumentation = createAnomalyInstrumentation({
      storageGet: fakeGet({ "loupe:v1:daemon": creds }),
      fetchImpl: async (_url, init) => {
        reports.push(JSON.parse(String(init?.body)));
        return Response.json({ anomaly: { id: "anomaly-4" } });
      },
      onResult: () => undefined,
    });
    instrumentation.attach?.(testApi(new TestElement() as unknown as Element));

    instrumentation.invariant?.("pin-count", "rendered pin count diverged");
    await flush();

    assert.equal(reports[0]?.source, "invariant");
    assert.equal(reports[0]?.expected, "Invariant holds: pin-count");
    assert.equal(reports[0]?.actual, "rendered pin count diverged");
  });
});

describe("product build clean script", () => {
  it("removes stale dev-only dist outputs without touching product output", async () => {
    const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
    const anomalyDir = join(root, "dist", "ui", "anomaly");
    const devDir = join(root, "dist", "ui", "dev");
    const productDir = join(root, "dist", "ui", "runtime");
    const productFile = join(productDir, "keep.js");
    await mkdir(anomalyDir, { recursive: true });
    await mkdir(devDir, { recursive: true });
    await mkdir(productDir, { recursive: true });
    await writeFile(join(anomalyDir, "stale.js"), "stale");
    await writeFile(join(devDir, "stale.js"), "stale");
    await writeFile(productFile, "product");

    const result = spawnSync(process.execPath, [join(root, "scripts", "clean-product-build.mjs")], { cwd: root });
    assert.equal(result.status, 0, result.stderr.toString());

    await assert.rejects(stat(anomalyDir), /ENOENT/);
    await assert.rejects(stat(devDir), /ENOENT/);
    assert.equal(await readFile(productFile, "utf8"), "product");

    await rm(productFile, { force: true });
  });
});
