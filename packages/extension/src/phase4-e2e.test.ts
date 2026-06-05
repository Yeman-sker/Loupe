import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import vm from "node:vm";
import { describe, it } from "node:test";
import { LOUPE_AUTH_SCHEME, storage_keys, type AgentMark, type Annotation, type Locator, type ProjectScopeWithUrl, type ResolveResult } from "@loupe-server/shared";
import {
  LOUPE_EXTENSION_ROOT_ID,
  bootstrap_content_root,
  install_content_root,
  origin_permission_pattern,
  page_bridge_exposure,
} from "./content.js";
import {
  MESSAGE_TYPES,
  decide_origin_authorization,
  request_origin_authorization,
} from "./background.js";
import {
  create_annotation,
  delete_annotation,
  fetch_and_reconcile_daemon_marks,
  session_marks_key,
  sync_annotation_to_daemon,
  type DaemonFetch,
  type MarkStore,
} from "./phase2-storage.js";

const PROJECT_ID = "project-alpha";
const OTHER_PROJECT_ID = "project-beta";
const SESSION_ID = "session-1";
const NOW = "2026-05-31T12:00:00.000Z";
const LATER = "2026-05-31T12:05:00.000Z";
const EXTENSION_ROOT = path.resolve(".");
const MANIFEST_PATH = path.join(EXTENSION_ROOT, "manifest.json");


describe("Phase 4 MV3 E2E/regression scenarios", () => {
  it("MV3 bridge exposes no page token or writable page window API", () => {
    const exposure = page_bridge_exposure();

    assert.equal(exposure.exposes_token_to_page, false);
    assert.equal(exposure.exposes_page_window_api, false);
    assert.equal(exposure.bridge_nonce_readonly, true);
    assert.equal(Object.isFrozen(exposure), true);
    assert.throws(() => {
      (exposure as unknown as { exposes_token_to_page: true }).exposes_token_to_page = true;
    }, TypeError);
  });

  it("MV3 content root is closed, hidden, and exposes no page token", () => {
    const document = new FakeDocument();

    assert.equal(install_content_root(document, { authorized: false }), false);
    assert.equal(install_content_root(document), false);
    assert.equal(document.getElementById(LOUPE_EXTENSION_ROOT_ID), null);

    assert.equal(install_content_root(document, { authorized: true }), true);
    assert.equal(install_content_root(document, { authorized: true }), false);

    const root = document.getElementById(LOUPE_EXTENSION_ROOT_ID);
    assert.ok(root);
    assert.equal(root.hidden, true);
    assert.equal(root.dataset.loupeRoot, "true");
    assert.equal(root.dataset.exposesTokenToPage, "false");
    assert.equal(root.dataset.exposesPageWindowApi, "false");
    assert.equal(root.style.pointerEvents, "none");
    assert.deepEqual(root.shadow_modes, ["closed"]);
  });

  it("MV3 runtime bootstrap waits for host authorization before content root injection", async () => {
    const document = new FakeDocument();
    const messages: unknown[] = [];
    const chrome = {
      runtime: {
        sendMessage(message: unknown, response_callback: (response: unknown) => void) {
          messages.push(message);
          response_callback({ ok: true, authorized: false, origin: "https://app.example.test", origin_pattern: "https://app.example.test/*" });
        },
      },
    };

    assert.equal(await bootstrap_content_root({ chrome, document, location: { origin: "https://app.example.test" } }), false);

    assert.deepEqual(messages, [{ type: "loupe.origin_auth.get", origin: "https://app.example.test" }]);
    assert.equal(document.getElementById(LOUPE_EXTENSION_ROOT_ID), null);
  });

  it("MV3 runtime bootstrap injects content root only after host authorization", async () => {
    const document = new FakeDocument();
    const chrome = {
      runtime: {
        sendMessage(message: unknown, response_callback: (response: unknown) => void) {
          assert.deepEqual(message, { type: "loupe.origin_auth.get", origin: "https://app.example.test" });
          response_callback({ ok: true, authorized: true, origin: "https://app.example.test", origin_pattern: "https://app.example.test/*" });
        },
      },
    };

    assert.equal(await bootstrap_content_root({ chrome, document, location: { origin: "https://app.example.test" } }), true);
    assert.ok(document.getElementById(LOUPE_EXTENSION_ROOT_ID));
  });

  it("MV3 manifest content script is an API-only authorization bootstrap", async () => {
    const manifest = JSON.parse(await readFile(MANIFEST_PATH, "utf8")) as { content_scripts: Array<{ js: string[] }> };
    assert.deepEqual(manifest.content_scripts.flatMap((script) => script.js), ["src/content.js"]);
    const content_path = path.join(EXTENSION_ROOT, manifest.content_scripts[0]?.js[0] ?? "");
    const source = await readFile(content_path, "utf8");
    const bootstrap_body = function_body(source, "bootstrapAuthorizedContent");
    const install_body = function_body(source, "installContentRoot");

    assert.match(source, /if \(!canBootstrapContentRuntime\(\) \|\| document\.getElementById\(ROOT_ID\)\) return;/);
    assert.match(bootstrap_body, /runtimeMessage\(\{ type: MESSAGE_GET_AUTH, origin: location\.origin \}\)/);
    // Inert marker is installed only when authorized; the surface runtime loads
    // in both states (unauthorized → host-authorization CTA only).
    assert.match(bootstrap_body, /const authorized = isAuthorizedOriginResponse\(response\)/);
    assert.match(bootstrap_body, /if \(authorized\) installContentRoot\(\)/);
    assert.match(install_body, /root\.hidden = true/);
    assert.match(install_body, /root\.dataset\.exposesTokenToPage = "false"/);
    assert.match(install_body, /root\.dataset\.exposesPageWindowApi = "false"/);
    assert.match(install_body, /root\.style\.pointerEvents = "none"/);
    assert.doesNotMatch(source, /launcher|panel|composer|pin|detail|toolbar|overlay|Option\+L|keydown|mouseover|mouseenter|click/i);
    assert.doesNotMatch(source, /sessionStorage\.setItem\([^)]*token|daemon\.token|authorization:|Bearer|LOUPE_AUTH_SCHEME/i);
  });

  it("MV3 manifest content script no-ops before authorized runtime response", async () => {
    const manifest = JSON.parse(await readFile(MANIFEST_PATH, "utf8")) as { content_scripts: Array<{ js: string[] }> };
    const content_path = path.join(EXTENSION_ROOT, manifest.content_scripts[0]?.js[0] ?? "");
    const source = await readFile(content_path, "utf8");
    const document = new FakeDocument();
    const messages: unknown[] = [];
    const context = vm.createContext({
      chrome: {
        runtime: {
          sendMessage(message: unknown, response_callback: (response: unknown) => void) {
            messages.push(message);
            response_callback({ ok: true, authorized: false });
          },
        },
      },
      document,
      location: { origin: "https://app.example.test" },
    });

    new vm.Script(source, { filename: content_path }).runInContext(context);
    await flush_promises(2);

    assert.deepEqual(JSON.parse(JSON.stringify(messages)), [{ type: "loupe.origin_auth.get", origin: "https://app.example.test" }]);
    assert.equal(document.getElementById(LOUPE_EXTENSION_ROOT_ID), null);
  });

  it("MV3 manifest content script injects only after authorized runtime response", async () => {
    const manifest = JSON.parse(await readFile(MANIFEST_PATH, "utf8")) as { content_scripts: Array<{ js: string[] }> };
    const content_path = path.join(EXTENSION_ROOT, manifest.content_scripts[0]?.js[0] ?? "");
    const source = await readFile(content_path, "utf8");
    const document = new FakeDocument();
    const context = vm.createContext({
      chrome: {
        runtime: {
          sendMessage(_message: unknown, response_callback: (response: unknown) => void) {
            response_callback({ ok: true, authorized: true });
          },
        },
      },
      document,
      location: { origin: "https://app.example.test" },
    });

    new vm.Script(source, { filename: content_path }).runInContext(context);
    await flush_promises(4);

    assert.ok(document.getElementById(LOUPE_EXTENSION_ROOT_ID));
  });


  it("MV3 extension host authorization helper grants only eligible http origins", async () => {
    const seen: string[][] = [];
    const decision = await decide_origin_authorization({ origin: "https://app.example.test" }, {}, async (origins) => {
      seen.push([...origins]);
      return true;
    });

    assert.deepEqual(seen, [["https://app.example.test/*"]]);
    assert.deepEqual(decision, { ok: true, authorized: true, origin: "https://app.example.test", origin_pattern: "https://app.example.test/*" });
    assert.equal(origin_permission_pattern("chrome://extensions"), undefined);

    let request_count = 0;
    const requested = await request_origin_authorization(
      {},
      { tab: { url: "http://localhost:5173/dashboard" } },
      async () => false,
      async (origins) => {
        request_count += 1;
        assert.deepEqual(origins, ["http://localhost:5173/*"]);
        return true;
      },
    );
    assert.equal(request_count, 1);
    assert.equal(requested.ok, true);
    assert.equal(requested.authorized, true);

    const denied = await decide_origin_authorization({ origin: "file://tmp/index.html" }, {}, async () => true);
    assert.deepEqual(denied, { ok: false, authorized: false, origin: "file://tmp", error: "Unsupported page origin: file://tmp" });
  });


  it("MV3 manifest background service-worker wake retries locals then reconciles daemon-only marks", async () => {
    const manifest = JSON.parse(await readFile(MANIFEST_PATH, "utf8")) as { background: { service_worker: string } };
    assert.equal(manifest.background.service_worker, "src/background.js");
    const local = sample_annotation({ id: "mark-local-retry" });
    const failed_newer = {
      ...sample_annotation({ id: "mark-preserve-local" }),
      sync: { status: "failed" as const, retry_count: 2, last_error: "offline" },
      lifecycle: { ...local.lifecycle, updated_at: LATER },
    };
    const daemon_older = sample_agent_mark(failed_newer, { updated_at: NOW });
    const daemon_only = sample_agent_mark(sample_annotation({ id: "mark-daemon-only" }), { updated_at: LATER });
    const fetch = fetch_sequence([
      { ok: true, body: { ok: true } },
      { ok: false, status: 503, body: { error: "offline" } },
      { ok: true, body: { project: local.project, marks: [daemon_older, daemon_only] } },
    ]);
    const chrome = manifest_background_chrome({ [session_marks_key(PROJECT_ID, SESSION_ID)]: [local, failed_newer] });
    const listener = await load_manifest_background(chrome, fetch);

    const handled = listener(
      { type: MESSAGE_TYPES.SERVICE_WORKER_WAKE, scope: sample_project(), daemon: daemon_options() },
      {},
      (response: unknown) => chrome.responses.push(response),
    );
    assert.equal(handled, true);
    await flush_promises(16);

    assert.equal(JSON.stringify(chrome.responses.at(-1)), JSON.stringify({ ok: true, reconciled: true, retried: 2, stored: 3 }));
    assert.equal(fetch.calls.length, 3);
    assert.equal(fetch.calls[0]?.input, "http://127.0.0.1:7373/v1/marks");
    assert.equal(header_value(fetch.calls[0]?.init?.headers, "authorization"), `${LOUPE_AUTH_SCHEME} token-123`);
    assert.equal(header_value(fetch.calls[1]?.init?.headers, "authorization"), `${LOUPE_AUTH_SCHEME} token-123`);
    assert.equal(new URL(fetch.calls[2]?.input ?? "").searchParams.get("project_id"), PROJECT_ID);
    assert.equal(new URL(fetch.calls[2]?.input ?? "").searchParams.get("session_id"), SESSION_ID);
    const stored = chrome.local_items[session_marks_key(PROJECT_ID, SESSION_ID)] as Annotation[];
    assert.equal(stored.find((mark) => mark.id === local.id)?.sync.status, "synced");
    assert.equal(stored.find((mark) => mark.id === failed_newer.id)?.sync.status, "failed");
    assert.equal(stored.find((mark) => mark.id === failed_newer.id)?.intent.comment, failed_newer.intent.comment);
    assert.equal(stored.find((mark) => mark.id === daemon_only.id)?.sync.status, "synced");
    assert.equal(chrome.session_items.exposes_token_to_page, false);
    assert.equal(JSON.stringify(chrome.session_items).includes("token-123"), false);
  });

  it("MV3 chrome.storage.local project-scoped keys and tombstones do not mutate bare ids or sibling projects", async () => {
    const mark = sample_annotation({ id: "mark-1" });
    const sibling = sample_annotation({ id: "mark-1", project_id: OTHER_PROJECT_ID });
    const store = new MemoryStore({
      [session_marks_key(PROJECT_ID, SESSION_ID)]: [mark],
      [session_marks_key(OTHER_PROJECT_ID, SESSION_ID)]: [sibling],
      ["mark-1"]: { unsafe: true },
    });

    await delete_annotation(store, PROJECT_ID, SESSION_ID, mark.id);

    assert.deepEqual(store.data.get(session_marks_key(PROJECT_ID, SESSION_ID)), []);
    assert.deepEqual(store.data.get(session_marks_key(OTHER_PROJECT_ID, SESSION_ID)), [sibling]);
    assert.deepEqual(store.data.get(storage_keys.project_tombstones(PROJECT_ID)), ["mark-1"]);
    assert.equal(store.data.has(storage_keys.project_tombstones(OTHER_PROJECT_ID)), false);
    assert.deepEqual(store.data.get("mark-1"), { unsafe: true });
  });

  it("MV3 daemon sync sends token header then keeps local-first failed retry state on outage", async () => {
    const mark = sample_annotation({ id: "mark-sync" });
    const store = new MemoryStore({ [session_marks_key(PROJECT_ID, SESSION_ID)]: [mark] });
    const fetch = fetch_sequence([{ ok: false, status: 503, body: { error: "offline" } }]);

    const result = await sync_annotation_to_daemon({ fetch, store, now: () => LATER }, daemon_options(), mark);

    assert.equal(result.ok, false);
    assert.equal(fetch.calls.length, 1);
    assert.equal(fetch.calls[0]?.input, "http://127.0.0.1:7373/v1/marks");
    assert.equal(header_value(fetch.calls[0]?.init?.headers, "authorization"), `${LOUPE_AUTH_SCHEME} token-123`);
    assert.equal(header_value(fetch.calls[0]?.init?.headers, "content-type"), "application/json");
    const stored = stored_marks(store)[0];
    assert.equal(stored?.id, mark.id);
    assert.equal(stored?.sync.status, "failed");
    assert.equal(stored?.sync.retry_count, 1);
    assert.equal(stored?.project.project_id, PROJECT_ID);
  });

  it("MV3 MCP read/resolve reconciliation maps AgentMark status without cross-project mutation", async () => {
    const local = sample_annotation({ id: "mark-resolve" });
    const sibling = sample_annotation({ id: "mark-other", project_id: OTHER_PROJECT_ID });
    const store = new MemoryStore({
      [session_marks_key(PROJECT_ID, SESSION_ID)]: [{ ...local, sync: { status: "synced", retry_count: 0 } }],
      [session_marks_key(OTHER_PROJECT_ID, SESSION_ID)]: [sibling],
    });
    const agent_mark = sample_agent_mark(local, { task_status: "resolved", updated_at: LATER });
    const fetch = fetch_sequence([{ ok: true, body: { project: local.project, marks: [agent_mark] } }]);

    const reconciled = await fetch_and_reconcile_daemon_marks({ fetch, store }, daemon_options(), local.project);

    assert.equal(fetch.calls.length, 1);
    assert.equal(header_value(fetch.calls[0]?.init?.headers, "authorization"), `${LOUPE_AUTH_SCHEME} token-123`);
    assert.equal(new URL(fetch.calls[0]?.input ?? "").searchParams.get("project_id"), PROJECT_ID);
    assert.equal(new URL(fetch.calls[0]?.input ?? "").searchParams.get("session_id"), SESSION_ID);
    assert.equal(reconciled.length, 1);
    assert.equal(reconciled[0]?.lifecycle.task_status, "resolved");
    assert.equal(reconciled[0]?.lifecycle.task_resolved_at, LATER);
    assert.equal(reconciled[0]?.sync.status, "synced");
    assert.deepEqual(store.data.get(session_marks_key(OTHER_PROJECT_ID, SESSION_ID)), [sibling]);
  });
});

function sample_annotation(overrides: { id: string; project_id?: string; session_id?: string; route_key?: string }): Annotation {
  return create_annotation({
    id: overrides.id,
    project: sample_project(overrides),
    locator: sample_locator(),
    resolution: sample_resolution(),
    comment: "Needs review",
    context: {
      element: { tag: "button", id: "save-button", role: "button", accessible_name: "Save changes", classes: ["btn", "primary"], text: "Save", selector_preview: "button#save-button" },
      a11y: { role: "button", label: "Save changes", tab_index: 0, expanded: false },
      layout: { display: "inline-flex", position: "relative", box_sizing: "border-box" },
      framework: { name: "react", component: "SaveButton", source_hint: { file: "src/SaveButton.tsx", line: 42, confidence: 0.8 } },
      viewport: { width: 1440, height: 900, dpr: 2 },
      position: { x: 10, y: 20, width: 120, height: 32 },
    },
    now: NOW,
  });
}

function sample_project(overrides: { project_id?: string; session_id?: string; route_key?: string } = {}): ProjectScopeWithUrl {
  return {
    project_id: overrides.project_id ?? PROJECT_ID,
    workspace_root_hash: "workspace-root-hash",
    origin: "https://app.example.test",
    url: "https://app.example.test/dashboard?tab=home",
    route_key: overrides.route_key ?? "/dashboard?tab=home",
    session_id: overrides.session_id ?? SESSION_ID,
  };
}

function sample_locator(): Locator {
  return {
    primary: { selector: "button#save-button", strategy: "stable_id" },
    alternates: [{ selector: "button[data-testid=save]", strategy: "stable_attr" }],
    evidence: {
      tag: "button",
      stable_id: "save-button",
      stable_attrs: { "data-testid": "save" },
      role: "button",
      accessible_name: "Save changes",
      text: { normalized: "Save", hash: "hash-save", length: 4 },
      classes: { stable: ["btn", "primary"], total: 2 },
      nth_path: "html > body > form > button:nth-of-type(1)",
      geometry: { x: 10, y: 20, width: 120, height: 32, viewport_width: 1440, viewport_height: 900, dpr: 2 },
      parent_chain: [{ tag: "form", stable_attr: "id=settings" }],
    },
  };
}

function sample_resolution(): ResolveResult {
  return { locator_status: "resolved", confidence: 0.93, matched_by: ["stable_id"], candidates_considered: 1 };
}

function sample_agent_mark(mark: Annotation, overrides: { task_status?: "open" | "resolved" | "archived"; updated_at?: string } = {}): AgentMark {
  return {
    id: mark.id,
    project: {
      project_id: mark.project.project_id,
      workspace_root_hash: mark.project.workspace_root_hash,
      url: mark.project.url,
      route_key: mark.project.route_key,
      session_id: mark.project.session_id,
    },
    intent: { comment: mark.intent.comment, kind: mark.intent.kind },
    target: {
      selector: mark.target.locator.primary.selector,
      selector_preview: mark.context.element.selector_preview,
      tag: mark.context.element.tag,
      ...(mark.context.element.text === undefined ? {} : { text: mark.context.element.text }),
      ...(mark.context.element.classes === undefined ? {} : { classes: mark.context.element.classes }),

      locator_status: mark.target.resolution.locator_status,
      confidence: mark.target.resolution.confidence,
      matched_by: mark.target.resolution.matched_by,
    },
    media: { has_screenshot: mark.media.has_screenshot },
    lifecycle: {
      task_status: overrides.task_status ?? mark.lifecycle.task_status,
      created_at: mark.lifecycle.created_at,
      updated_at: overrides.updated_at ?? mark.lifecycle.updated_at,
    },
  };
}

function daemon_options() {
  return { base_url: "http://127.0.0.1:7373", token: "token-123" };
}

function stored_marks(store: MemoryStore): Annotation[] {
  return store.data.get(session_marks_key(PROJECT_ID, SESSION_ID)) as Annotation[];
}

function function_body(source: string, name: string): string {
  const start = source.indexOf(`function ${name}`);
  assert.notEqual(start, -1, `Missing function ${name}`);
  const open = source.indexOf("{", start);
  let depth = 0;
  for (let index = open; index < source.length; index += 1) {
    const char = source[index];
    if (char === "{") depth += 1;
    else if (char === "}") {
      depth -= 1;
      if (depth === 0) return source.slice(open + 1, index);
    }
  }
  throw new Error(`Unterminated function ${name}`);
}

async function load_manifest_background(chrome: ManifestBackgroundChrome, fetch_impl: DaemonFetch) {
  const manifest = JSON.parse(await readFile(MANIFEST_PATH, "utf8")) as { background: { service_worker: string } };
  const background_path = path.join(EXTENSION_ROOT, manifest.background.service_worker);
  const source = await readFile(background_path, "utf8");
  const context = vm.createContext({ chrome, fetch: fetch_impl, URL, Date });
  new vm.Script(source, { filename: background_path }).runInContext(context);
  assert.ok(chrome.messages[0]);
  return chrome.messages[0];
}

function manifest_background_chrome(local_items: Record<string, unknown>): ManifestBackgroundChrome {
  return new ManifestBackgroundChrome(local_items);
}

async function flush_promises(count: number): Promise<void> {
  for (let index = 0; index < count; index += 1) await new Promise((resolve) => setImmediate(resolve));
}

type FetchCall = { input: string; init?: RequestInit };
type FetchFixture = { ok: boolean; status?: number; body: unknown };

function fetch_sequence(fixtures: FetchFixture[]): DaemonFetch & { calls: FetchCall[] } {
  const calls: FetchCall[] = [];
  const fetch_impl = (async (input: string, init?: RequestInit) => {
    calls.push(init === undefined ? { input } : { input, init });
    const fixture = fixtures.shift();
    if (fixture === undefined) throw new Error("Unexpected fetch call");
    return {
      ok: fixture.ok,
      status: fixture.status ?? (fixture.ok ? 200 : 500),
      json: async () => fixture.body,
    } as Response;
  }) as DaemonFetch & { calls: FetchCall[] };
  fetch_impl.calls = calls;
  return fetch_impl;
}

function header_value(headers: HeadersInit | undefined, name: string): string | undefined {
  if (headers === undefined) return undefined;
  if (headers instanceof Headers) return headers.get(name) ?? undefined;
  const lower_name = name.toLowerCase();
  if (Array.isArray(headers)) return headers.find(([key]) => key.toLowerCase() === lower_name)?.[1];
  return Object.entries(headers).find(([key]) => key.toLowerCase() === lower_name)?.[1];
}

class MemoryStore implements MarkStore {
  readonly data = new Map<string, unknown>();

  constructor(items: Record<string, unknown>) {
    for (const [key, value] of Object.entries(items)) this.data.set(key, value);
  }

  async get(key: string): Promise<unknown> {
    return this.data.get(key);
  }

  async set(items: Record<string, unknown>): Promise<void> {
    for (const [key, value] of Object.entries(items)) this.data.set(key, value);
  }
}

class FakeElement {
  readonly nodeType = 1;
  id = "";
  hidden = false;
  textContent = "";
  readonly dataset: Record<string, string | undefined> = {};
  readonly style: Record<string, string> = {};
  readonly shadow_modes: string[] = [];

  constructor(readonly localName: string) {}

  attachShadow(init: { mode: "closed" }) {
    this.shadow_modes.push(init.mode);
    return { append() {} };
  }

  append() {}

}

class FakeDocument {
  private element_by_id: Record<string, FakeElement | undefined> = {};
  readonly documentElement = { append: (node: unknown) => this.append(node) };

  getElementById(id: string): FakeElement | null {
    return this.element_by_id[id] ?? null;
  }

  createElement(tag: string): FakeElement {
    return new FakeElement(tag);
  }

  append(node: unknown): void {
    if (node instanceof FakeElement && node.id !== "") this.element_by_id = { ...this.element_by_id, [node.id]: node };
  }
}

class ManifestBackgroundChrome {
  readonly installed: Array<() => void | Promise<void>> = [];
  readonly messages: Array<(message: unknown, sender: Record<string, unknown>, sendResponse: (response: unknown) => void) => boolean> = [];
  readonly responses: unknown[] = [];
  session_items: Record<string, unknown> = {};
  local_items: Record<string, unknown> = {};

  constructor(local_items: Record<string, unknown>) {
    this.local_items = { ...local_items };
  }

  readonly runtime = {
    onInstalled: { addListener: (listener: () => void) => void this.installed.push(listener) },
    onMessage: { addListener: (listener: (message: unknown, sender: Record<string, unknown>, sendResponse: (response: unknown) => void) => boolean) => void this.messages.push(listener) },
  };

  readonly storage = {
    session: {
      set: async (items: Record<string, unknown>) => {
        this.session_items = { ...this.session_items, ...items };
      },
    },
    local: {
      get: async (key: string | string[] | Record<string, unknown> | null) => {
        if (typeof key === "string") return { [key]: this.local_items[key] };
        if (Array.isArray(key)) return Object.fromEntries(key.map((item) => [item, this.local_items[item]]));
        if (key && typeof key === "object") return Object.fromEntries(Object.keys(key).map((item) => [item, this.local_items[item] ?? key[item]]));
        return { ...this.local_items };
      },
      set: async (items: Record<string, unknown>) => {
        this.local_items = { ...this.local_items, ...items };
      },
    },
  };

  readonly permissions = {
    contains: async () => false,
    request: async () => false,
  };
}

