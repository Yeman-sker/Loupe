import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { createDom, prefersReducedMotion } from "../core/dom.js";
import { createI18n } from "../core/i18n.js";
import { taskToken, locatorToken, syncToken, kindToken, formatConfidencePercent } from "../core/status-tokens.js";
import { mount } from "./app.js";
import { SURFACE_ROOT_ID } from "../core/host.js";

/* ------------------------------------------------------------------ *
 * Minimal but real fake DOM — enough to mount the surface host, walk
 * the rendered tree, fire events, and tear down. Production code is
 * typed against real DOM; the fake is bridged with `as unknown as`.
 * ------------------------------------------------------------------ */
type Child = FakeElement | string;

function createFakeStyle(): Record<string, string> & { setProperty(k: string, v: string): void; getPropertyValue(k: string): string } {
  const store: Record<string, string> = {};
  const handler: ProxyHandler<Record<string, string>> = {
    get(target, prop) {
      if (prop === "setProperty") return (k: string, v: string): void => { target[k] = v; };
      if (prop === "getPropertyValue") return (k: string): string => target[k] ?? "";
      return target[String(prop)];
    },
    set(target, prop, value) {
      target[String(prop)] = String(value);
      return true;
    },
  };
  return new Proxy(store, handler) as Record<string, string> & { setProperty(k: string, v: string): void; getPropertyValue(k: string): string };
}

class FakeElement {
  readonly nodeType = 1;
  id = "";
  className = "";
  readonly dataset: Record<string, string | undefined> = {};
  readonly style = createFakeStyle();
  readonly attributes = new Map<string, string>();
  readonly listeners = new Map<string, Array<(event: unknown) => void>>();
  readonly children: Child[] = [];
  parentNode: FakeElement | null = null;
  shadow: FakeElement | null = null;
  private text = "";

  constructor(readonly tagName: string) {}

  get textContent(): string {
    return this.text;
  }
  set textContent(value: string) {
    this.text = value;
    this.children.length = 0;
  }

  setAttribute(key: string, value: string): void {
    this.attributes.set(key, value);
  }
  getAttribute(key: string): string | null {
    return this.attributes.get(key) ?? null;
  }

  addEventListener(type: string, handler: (event: unknown) => void): void {
    const list = this.listeners.get(type) ?? [];
    list.push(handler);
    this.listeners.set(type, list);
  }
  dispatch(type: string): void {
    for (const handler of this.listeners.get(type) ?? []) handler({ type });
  }

  append(...nodes: Child[]): void {
    for (const node of nodes) {
      if (typeof node !== "string") node.parentNode = this;
      this.children.push(node);
    }
  }
  removeChild(node: FakeElement): FakeElement {
    const index = this.children.indexOf(node);
    if (index >= 0) {
      this.children.splice(index, 1);
      node.parentNode = null;
    }
    return node;
  }
  get firstChild(): Child | null {
    return this.children.length > 0 ? this.children[0] ?? null : null;
  }

  attachShadow(_init: { mode: "closed" }): FakeElement {
    const shadow = new FakeElement("#shadow-root");
    this.shadow = shadow;
    return shadow;
  }
}

class FakeDocument {
  readonly documentElement = new FakeElement("html");
  readonly body = new FakeElement("body");
  defaultView: { matchMedia(query: string): { matches: boolean } } | null = null;

  createElement(tag: string): FakeElement {
    return new FakeElement(tag);
  }
  getElementById(id: string): FakeElement | null {
    return findById(this.documentElement, id);
  }
  // Stubs so app.ts ⌥L global-key listener can attach without error
  addEventListener(_type: string, _listener: unknown): void {}
  removeEventListener(_type: string, _listener: unknown): void {}
}

function findById(node: FakeElement, id: string): FakeElement | null {
  if (node.id === id) return node;
  for (const child of node.children) {
    if (typeof child !== "string") {
      const found = findById(child, id);
      if (found !== null) return found;
    }
  }
  return null;
}

function elementChildren(node: FakeElement): FakeElement[] {
  return node.children.filter((child): child is FakeElement => typeof child !== "string");
}
function descendants(node: FakeElement): FakeElement[] {
  const out: FakeElement[] = [];
  for (const child of elementChildren(node)) {
    out.push(child);
    out.push(...descendants(child));
  }
  return out;
}
function hasClass(node: FakeElement, cls: string): boolean {
  return node.className.split(" ").includes(cls);
}
function present<T>(value: T | undefined): T {
  assert.ok(value !== undefined, "expected element to be present");
  return value;
}
function findButton(node: FakeElement, ariaLabel: string): FakeElement {
  return present(descendants(node).find((e) => e.tagName === "button" && e.getAttribute("aria-label") === ariaLabel));
}

function makeFakeDocument(): { doc: FakeDocument; asDocument: Document } {
  const doc = new FakeDocument();
  return { doc, asDocument: doc as unknown as Document };
}
function makeFakeStorage(): { storage: { get(k: string): Promise<Record<string, unknown>>; set(i: Record<string, unknown>): Promise<void> }; store: Record<string, unknown> } {
  const store: Record<string, unknown> = {};
  const storage = {
    get: (key: string): Promise<Record<string, unknown>> => Promise.resolve(key in store ? { [key]: store[key] } : {}),
    set: (items: Record<string, unknown>): Promise<void> => {
      for (const [key, value] of Object.entries(items)) store[key] = value;
      return Promise.resolve();
    },
  };
  return { storage, store };
}

/* ------------------------------------------------------------------ */

describe("UI-0 · render core (dom.el / clear)", () => {
  it("builds elements with class, attrs, dataset, style, text and events", () => {
    const { asDocument } = makeFakeDocument();
    const dom = createDom(asDocument);

    const node = dom.el("div", {
      class: "x y",
      attrs: { role: "dialog" },
      data: { kind: "bug" },
      style: { "--k": "red", color: "blue" },
      text: "hi",
    }) as unknown as FakeElement;

    assert.equal(node.className, "x y");
    assert.equal(node.getAttribute("role"), "dialog");
    assert.equal(node.dataset.kind, "bug");
    assert.equal(node.style.getPropertyValue("--k"), "red");
    assert.equal(node.style.color, "blue");
    assert.equal(node.textContent, "hi");
  });

  it("appends children, fires listeners, and clear() empties the node", () => {
    const { asDocument } = makeFakeDocument();
    const dom = createDom(asDocument);

    let clicks = 0;
    const parent = dom.el("div", { on: { click: () => { clicks += 1; } } }, [dom.el("span", { text: "c" })]) as unknown as FakeElement;

    assert.equal(parent.children.length, 1);
    parent.dispatch("click");
    assert.equal(clicks, 1);

    dom.clear(parent as unknown as Node);
    assert.equal(parent.children.length, 0);
  });

  it("prefersReducedMotion reflects the media query, false when unsupported", () => {
    assert.equal(prefersReducedMotion({}), false);
    assert.equal(prefersReducedMotion({ matchMedia: () => ({ matches: true }) }), true);
    assert.equal(prefersReducedMotion({ matchMedia: () => ({ matches: false }) }), false);
  });
});

describe("UI-0 · i18n", () => {
  it("returns zh primary, switches to EN, falls back for unknown keys", () => {
    const i18n = createI18n("zh");
    assert.equal(i18n.t("auth.allow"), "允许本站点");
    i18n.setLang("en");
    assert.equal(i18n.lang(), "en");
    assert.equal(i18n.t("auth.allow"), "Allow site");
    assert.equal(i18n.t("does.not.exist", "fallback"), "fallback");
  });
});

describe("UI-0 · status tokens (wire enum → glyph + label, never colour-only)", () => {
  const { t } = createI18n("en");

  it("maps task / locator / sync / kind to locked glyphs", () => {
    assert.deepEqual(taskToken(t, "open"), { cls: "open", glyph: "○", label: "open" });
    assert.deepEqual(taskToken(t, "resolved"), { cls: "good", glyph: "✓", label: "done" });
    assert.equal(syncToken(t, "local_only").glyph, "•");
    assert.equal(syncToken(t, "syncing").glyph, "◌");
    assert.equal(syncToken(t, "delete_pending").glyph, "◌");
    assert.equal(syncToken(t, "failed").cls, "bad");
    assert.equal(kindToken(t, "bug").kind, "bug");
  });

  it("shows confidence % for located/drifted but never a false % for lost", () => {
    assert.equal(locatorToken(t, "resolved", 1).label, "located 100%");
    assert.equal(locatorToken(t, "drifted", 0.62).label, "drifted 62%");
    assert.equal(locatorToken(t, "resolved", 0.9333333333333332).label, "located 93%");
    assert.equal(formatConfidencePercent(93.33333333333332), "93%");
    assert.equal(locatorToken(t, "lost").label, "lost");
    assert.equal(locatorToken(t, "lost").glyph, "✕");
  });
});

describe("UI-1 · surface host mount → update → unmount", () => {
  it("mounts an isolated shadow host, injects fonts + tokens + surfaces CSS, renders the ready panel", async () => {
    const { doc, asDocument } = makeFakeDocument();
    const { storage } = makeFakeStorage();

    const app = await mount({ baseUrl: "chrome-extension://x/", document: asDocument, storage });

    const root = present(doc.getElementById(SURFACE_ROOT_ID) ?? undefined);
    assert.equal(root.style.pointerEvents, "none");
    assert.equal(root.style.position, "fixed");

    const shadow = present(root.shadow ?? undefined);
    // First style is host CSS (fonts + tokens + base), second is surfaces CSS.
    const styles = elementChildren(shadow).filter((e) => e.tagName === "style");
    assert.ok(styles.length >= 1, "at least one style element injected");
    const hostStyle = present(styles[0]);
    assert.match(hostStyle.textContent, /--iris-h:286/);
    assert.match(hostStyle.textContent, /@font-face/);
    assert.match(hostStyle.textContent, /Space Grotesk/);
    assert.match(hostStyle.textContent, /\.tok--good/);
    assert.match(hostStyle.textContent, /chrome-extension:\/\/x\/assets\/fonts\/space-grotesk\.woff2/);

    const wrapper = present(elementChildren(shadow).find((e) => hasClass(e, "loupe")));
    assert.equal(wrapper.dataset.theme, "light");

    // UI-1 ready panel (not the UI-0 smoke surface)
    const card = present(elementChildren(wrapper)[0]);
    assert.ok(hasClass(card, "lp-ready"), "ready HUD is rendered");

    app.unmount();
    assert.equal(doc.getElementById(SURFACE_ROOT_ID), null);
  });

  it("renders the ready panel with a start-picking button and respects stored theme pref", async () => {
    const { doc, asDocument } = makeFakeDocument();
    const { storage } = makeFakeStorage();
    // Pre-seed a dark theme preference so we can verify prefs are read on mount.
    await storage.set({ "loupe:v1:ui:prefs": { theme: "dark", lang: "en" } });

    await mount({ baseUrl: "chrome-extension://x/", document: asDocument, storage });

    const shadow = present(present(doc.getElementById(SURFACE_ROOT_ID) ?? undefined).shadow ?? undefined);
    const wrapper = present(elementChildren(shadow).find((e) => hasClass(e, "loupe")));
    assert.equal(wrapper.dataset.theme, "dark", "stored theme pref applied on mount");

    // The ready HUD has the pick-element pill (EN label because lang: "en")
    const card = present(elementChildren(wrapper)[0]);
    assert.ok(hasClass(card, "lp-ready"), "ready HUD present");
    const pickBtn = present(
      descendants(card).find((e) => e.tagName === "button" && e.getAttribute("aria-label") === "Pick element"),
    );
    assert.ok(pickBtn !== undefined, "pick-element pill rendered with correct EN aria-label");
  });

  it("unauthorized origin renders only the host-authorization CTA (Surface 1), dismissable", async () => {
    const { doc, asDocument } = makeFakeDocument();
    const { storage } = makeFakeStorage();

    await mount({ baseUrl: "chrome-extension://x/", document: asDocument, storage, authorized: false });

    const shadow = present(present(doc.getElementById(SURFACE_ROOT_ID) ?? undefined).shadow ?? undefined);
    const wrapper = present(elementChildren(shadow).find((e) => hasClass(e, "loupe")));

    // Only the auth CTA is mounted — no ready panel, no picker, when unauthorized.
    const mounted = elementChildren(wrapper);
    assert.equal(mounted.length, 1, "exactly one surface mounted when unauthorized");
    const scrim = present(mounted[0]);
    assert.ok(hasClass(scrim, "center-wrap") && hasClass(scrim, "lp-auth"), "auth scrim wrapper rendered");
    const cta = present(elementChildren(scrim).find((e) => hasClass(e, "cta")));
    assert.ok(hasClass(cta, "card"), "CTA uses the card primitive");
    assert.equal(cta.getAttribute("role"), "dialog");
    assert.ok(!descendants(wrapper).some((e) => hasClass(e, "lp-ready")), "no ready panel when unauthorized");
    assert.ok(
      descendants(cta).some((e) => e.tagName === "button" && hasClass(e, "primary") && e.textContent === "允许本站点"),
      "prototype-faithful Allow site CTA is present",
    );
    assert.equal(descendants(cta).some((e) => hasClass(e, "cta-hint")), false, "toolbar hint is not a separate CTA");

    // "Not now" (auth.not, zh default) dismisses the card → overlay empties.
    const notNow = present(descendants(cta).find((e) => e.tagName === "button" && e.textContent === "以后再说"));
    notNow.dispatch("click");
    assert.equal(elementChildren(wrapper).length, 0, "CTA dismissed, nothing else shown");
  });

  it("toggleStatusBar shows then hides the floating daemon status bar on an authorized page", async () => {
    const { doc, asDocument } = makeFakeDocument();
    const { storage } = makeFakeStorage();

    const app = await mount({ baseUrl: "chrome-extension://x/", document: asDocument, storage });
    const shadow = present(present(doc.getElementById(SURFACE_ROOT_ID) ?? undefined).shadow ?? undefined);
    const wrapper = present(elementChildren(shadow).find((e) => hasClass(e, "loupe")));

    // Hidden by default — the toolbar action toggles it.
    assert.equal(descendants(wrapper).some((e) => hasClass(e, "lp-status")), false, "status bar hidden until toggled");

    app.toggleStatusBar();
    const bar = present(descendants(wrapper).find((e) => hasClass(e, "lp-status")));
    assert.ok(hasClass(bar, "card"), "status bar uses the card primitive");
    assert.equal(bar.getAttribute("role"), "status");
    // No marks + daemon healthy (default) → connected head token (zh label).
    assert.ok(descendants(bar).some((e) => hasClass(e, "tok--good")), "connected uses the good token class");
    assert.ok(descendants(bar).some((e) => e.textContent === "已连接"), "connected label rendered");

    app.toggleStatusBar();
    assert.equal(descendants(wrapper).some((e) => hasClass(e, "lp-status")), false, "status bar hidden after second toggle");
  });

  it("uses daemon workspace identity from service-worker wake for project scope", async () => {
    const { doc, asDocument } = makeFakeDocument();
    const backing = makeFakeStorage();
    const getKeys: unknown[] = [];
    const storage = {
      get: (key: string): Promise<Record<string, unknown>> => {
        getKeys.push(key);
        return backing.storage.get(key);
      },
      set: backing.storage.set,
    };
    (doc as unknown as { location: Location; title: string }).location = { href: "http://localhost:8081/#about", origin: "http://localhost:8081" } as unknown as Location;
    (doc as unknown as { title: string }).title = "Demo";

    const runtimeCalls: unknown[] = [];
    const previousChrome = (globalThis as typeof globalThis & { chrome?: unknown }).chrome;
    const previousRandomUUID = globalThis.crypto.randomUUID;
    (globalThis as typeof globalThis & { chrome?: unknown }).chrome = {
      runtime: {
        sendMessage(message: unknown, callback: (response: unknown) => void): void {
          runtimeCalls.push(message);
          callback({ ok: true, reconciled: false, retried: 0, stored: 0, project_id: "project-daemon", workspace_root_hash: "workspace-daemon", workspace_root: "/Users/yem/dev/demo-app", project_name: "demo-app", branch: "main" });
        },
      },
    };
    Object.defineProperty(globalThis.crypto, "randomUUID", { configurable: true, value: () => "mark-daemon-scope" });

    try {
      await mount({ baseUrl: "chrome-extension://x/", document: asDocument, storage });
      await new Promise((resolve) => setTimeout(resolve, 0));
      const scopeMessage = runtimeCalls.find((message) => typeof message === "object" && message !== null && (message as Record<string, unknown>).type === "loupe.service_worker.wake" && (message as Record<string, unknown>).scope === undefined);
      assert.ok(scopeMessage !== undefined, "runtime requested daemon identity before building a save scope");

      const scopedProject = "loupe:v1:project:project-daemon:session:session_";
      assert.ok(
        getKeys.some((key) => typeof key === "string" && key.startsWith(scopedProject)),
        "daemon identity seeds project-scoped storage lookup",
      );
      assert.equal(runtimeCalls.length > 0, true);

      const shadow = present(present(doc.getElementById(SURFACE_ROOT_ID) ?? undefined).shadow ?? undefined);
      const wrapper = present(elementChildren(shadow).find((e) => hasClass(e, "loupe")));
      assert.ok(
        descendants(wrapper).some((e) => hasClass(e, "pname") && e.textContent === "demo-app") &&
          descendants(wrapper).some((e) => hasClass(e, "ppath") && e.textContent === "/Users/yem/dev/demo-app"),
        "authorized linked site shows project chooser during onboarding",
      );
      const confirm = present(descendants(wrapper).find((e) => e.tagName === "button" && hasClass(e, "primary")));
      confirm.dispatch("click");
      assert.equal(
        descendants(wrapper).some((e) => hasClass(e, "lp-mode-proj")),
        false,
        "confirming project chooser does not start element picking",
      );
      const pick = present(descendants(wrapper).find((e) => e.tagName === "button" && hasClass(e, "lp-ready-pick")));
      pick.dispatch("click");
      assert.ok(
        descendants(wrapper).some((e) => hasClass(e, "lp-mode-proj") && e.textContent === "Project: demo-app"),
        "explicit picking shows readable project context",
      );

      assert.ok(
        getKeys.some((key) => typeof key === "string" && key === "loupe:v1:projects:index"),
        "first linked site checks project metadata after authorization",
      );

      const storedAfterChoice = await backing.storage.get("loupe:v1:project-onboarding:http%3A%2F%2Flocalhost%3A8081:project-daemon");
      assert.equal(storedAfterChoice["loupe:v1:project-onboarding:http%3A%2F%2Flocalhost%3A8081:project-daemon"], true);
      assert.equal(descendants(wrapper).some((e) => e.textContent?.includes("project-daemon")), false);
    } finally {
      (globalThis as typeof globalThis & { chrome?: unknown }).chrome = previousChrome;
      Object.defineProperty(globalThis.crypto, "randomUUID", { configurable: true, value: previousRandomUUID });
    }
  });
});
