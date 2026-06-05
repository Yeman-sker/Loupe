import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { createDom, prefersReducedMotion } from "./ui/dom.js";
import { createI18n } from "./ui/i18n.js";
import { taskToken, locatorToken, syncToken, kindToken } from "./ui/status-tokens.js";
import { mount } from "./ui/app.js";
import { SURFACE_ROOT_ID } from "./ui/host.js";

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
    assert.ok(hasClass(card, "lp-ready"), "ready panel card is rendered");
    assert.ok(hasClass(card, "card"), "ready panel uses card class");

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

    // The ready panel has the start-picking button (EN label because lang: "en")
    const card = present(elementChildren(wrapper)[0]);
    assert.ok(hasClass(card, "lp-ready"), "ready panel present");
    const pickBtn = present(
      descendants(card).find((e) => e.tagName === "button" && e.getAttribute("aria-label") === "Start picking"),
    );
    assert.ok(pickBtn !== undefined, "start-picking button rendered with correct EN aria-label");
  });
});
