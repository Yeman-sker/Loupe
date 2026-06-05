import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { renderProjectChooser, type ProjectEntry } from "./ui/surface-project-chooser.js";
import { renderFallback } from "./ui/surface-fallback.js";
import { renderDetail } from "./ui/surface-detail.js";
import { type PinRecord } from "./ui/surface-pin.js";
import { createI18n } from "./ui/i18n.js";

// ------------------------------------------------------------------ //
// Minimal fake DOM — same shape as ui-5-detail.test.ts FakeEl/FakeDoc.
// ------------------------------------------------------------------ //

type Listener = (e: unknown) => void;

class FakeClassList {
  private readonly list: string[] = [];
  add(...cls: string[]): void { for (const c of cls) if (!this.list.includes(c)) this.list.push(c); }
  remove(...cls: string[]): void { for (const c of cls) { const i = this.list.indexOf(c); if (i >= 0) this.list.splice(i, 1); } }
  contains(c: string): boolean { return this.list.includes(c); }
  toggle(c: string, force?: boolean): boolean {
    if (force !== undefined) { if (force) this.add(c); else this.remove(c); return force; }
    if (this.list.includes(c)) { this.remove(c); return false; } else { this.add(c); return true; }
  }
}

class FakeStyle {
  private readonly _map = new Map<string, string>();
  setProperty(k: string, v: string): void { this._map.set(k, v); }
  getPropertyValue(k: string): string { return this._map.get(k) ?? ""; }
  [key: string]: unknown;
}

class FakeEl {
  tagName: string;
  readonly classList = new FakeClassList();
  readonly attributes = new Map<string, string>();
  textContent: string | null = null;
  innerHTML = "";
  parentElement: FakeEl | null = null;
  readonly style = new FakeStyle();
  private readonly _listeners = new Map<string, Listener[]>();
  children: FakeEl[] = [];
  id = "";

  constructor(tag: string) { this.tagName = tag.toUpperCase(); }

  setAttribute(k: string, v: string): void { this.attributes.set(k, v); }
  getAttribute(k: string): string | null { return this.attributes.get(k) ?? null; }
  removeAttribute(k: string): void { this.attributes.delete(k); }

  addEventListener(type: string, listener: Listener): void {
    const arr = this._listeners.get(type) ?? [];
    arr.push(listener);
    this._listeners.set(type, arr);
  }
  dispatch(type: string, event: unknown = {}): void {
    for (const l of this._listeners.get(type) ?? []) l(event);
  }
  append(...nodes: FakeEl[]): void { for (const n of nodes) { n.parentElement = this; this.children.push(n); } }
  appendChild(n: FakeEl): void { n.parentElement = this; this.children.push(n); }
  replaceChild(next: FakeEl, old: FakeEl): void {
    const idx = this.children.indexOf(old);
    if (idx >= 0) { this.children[idx] = next; next.parentElement = this; }
  }
  querySelector(sel: string): FakeEl | null {
    if (sel.startsWith(".")) {
      const cls = sel.slice(1);
      return this._findFirst((n) => n.classList.contains(cls));
    }
    return null;
  }
  querySelectorAll(_sel: string): FakeEl[] { return []; }
  private _findFirst(pred: (n: FakeEl) => boolean): FakeEl | null {
    if (pred(this)) return this;
    for (const c of this.children) { const f = c._findFirst(pred); if (f) return f; }
    return null;
  }
  get lastElementChild(): FakeEl | null { return this.children[this.children.length - 1] ?? null; }
}

class FakeDoc {
  createElement(tag: string): FakeEl { return new FakeEl(tag); }
  getElementById(_id: string): null { return null; }
}

function makeDom(): { dom: import("./ui/dom.js").Dom; created: FakeEl[] } {
  const doc = new FakeDoc();
  const created: FakeEl[] = [];
  const el = (
    tag: string,
    props: { class?: string; text?: string; attrs?: Record<string, string>; data?: Record<string, string>; style?: Record<string, string>; on?: Record<string, () => void> } = {},
    children: FakeEl[] = [],
  ): FakeEl => {
    const node = doc.createElement(tag);
    if (props.class !== undefined) node.classList.add(...props.class.split(" ").filter(Boolean));
    if (props.text !== undefined) node.textContent = props.text;
    if (props.attrs !== undefined) for (const [k, v] of Object.entries(props.attrs)) node.setAttribute(k, v);
    if (props.data !== undefined) for (const [k, v] of Object.entries(props.data)) node.setAttribute(`data-${k}`, v);
    if (props.style !== undefined) for (const [k, v] of Object.entries(props.style)) {
      if (k.startsWith("--")) node.style.setProperty(k, v);
      else (node.style as unknown as Record<string, string>)[k] = v;
    }
    if (props.on !== undefined) for (const [evt, fn] of Object.entries(props.on)) node.addEventListener(evt, fn);
    for (const child of children) { child.parentElement = node; node.children.push(child); }
    created.push(node);
    return node;
  };
  return { dom: { el: el as unknown as import("./ui/dom.js").Dom["el"], clear: () => {} }, created };
}

function findByClass(root: FakeEl, cls: string): FakeEl | undefined {
  if (root.classList.contains(cls)) return root;
  for (const c of root.children) {
    const found = findByClass(c, cls);
    if (found !== undefined) return found;
  }
  return undefined;
}

function findAllByClass(root: FakeEl, cls: string): FakeEl[] {
  const results: FakeEl[] = [];
  if (root.classList.contains(cls)) results.push(root);
  for (const c of root.children) results.push(...findAllByClass(c, cls));
  return results;
}

function findButton(root: FakeEl, text: string): FakeEl | undefined {
  const all = findAllByTag(root, "button");
  return all.find((b) => b.textContent === text);
}

function findAllByTag(root: FakeEl, tag: string): FakeEl[] {
  const results: FakeEl[] = [];
  if (root.tagName === tag.toUpperCase()) results.push(root);
  for (const c of root.children) results.push(...findAllByTag(c, tag));
  return results;
}

const PROJECTS: ProjectEntry[] = [
  { id: "app-web", name: "app-web", path: "~/dev/app-web" },
  { id: "marketing", name: "marketing-site", path: "~/dev/marketing" },
];

function makeRect(): DOMRect {
  return { left: 100, top: 100, width: 200, height: 40, right: 300, bottom: 140, x: 100, y: 100, toJSON: () => ({}) };
}

class FakeElement {
  tagName = "BUTTON";
  id = "";
  classList = new FakeClassList();
  scrollIntoView = (): void => { /* no-op */ };
}

function makePin(overrides: Partial<PinRecord> = {}): PinRecord {
  return {
    id: "pin-1",
    num: 1,
    element: new FakeElement() as unknown as Element,
    rect: makeRect(),
    kind: "bug",
    comment: "Fix the submit button colour",
    task: "open",
    loc: "located",
    confidence: 100,
    sync: "local",
    ...overrides,
  };
}

const detailNoops = {
  onDone: () => {}, onDelete: () => {}, onCopyMarkdown: () => Promise.resolve(true),
  onClose: () => {}, onViewAll: () => {},
};

// ------------------------------------------------------------------ //
// Tests
// ------------------------------------------------------------------ //

type FE = FakeEl; // alias for cast readability

describe("UI-6 · Project chooser — Surface 2", () => {
  it("renders project list with names and paths", () => {
    const { dom } = makeDom();
    const { t } = createI18n("zh");
    const el = renderProjectChooser(dom, PROJECTS, { t, onPick: () => {} }) as unknown as FE;
    const items = findAllByClass(el, "proj");
    assert.equal(items.length, 2);
    // Each item should have name and path rendered
    const nameEls0 = findAllByClass(items[0]!, "pname");
    assert.equal(nameEls0[0]?.textContent, "app-web");
    const pathEls0 = findAllByClass(items[0]!, "ppath");
    assert.equal(pathEls0[0]?.textContent, "~/dev/app-web");
  });

  it("first project is selected by default (sel class)", () => {
    const { dom } = makeDom();
    const { t } = createI18n("zh");
    const el = renderProjectChooser(dom, PROJECTS, { t, onPick: () => {} }) as unknown as FE;
    const items = findAllByClass(el, "proj");
    assert.ok(items[0]?.classList.contains("sel"), "first item should be selected");
    assert.ok(!items[1]?.classList.contains("sel"), "second item should not be selected");
  });

  it("clicking an item transfers selection", () => {
    const { dom } = makeDom();
    const { t } = createI18n("zh");
    const el = renderProjectChooser(dom, PROJECTS, { t, onPick: () => {} }) as unknown as FE;
    const items = findAllByClass(el, "proj");
    items[1]!.dispatch("click");
    assert.ok(!items[0]?.classList.contains("sel"), "first should be deselected");
    assert.ok(items[1]?.classList.contains("sel"), "second should be selected");
  });

  it("Continue locally button fires onPick with 'local'", () => {
    const { dom } = makeDom();
    const { t } = createI18n("zh");
    let picked: string | null = null;
    const el = renderProjectChooser(dom, PROJECTS, { t, onPick: (id) => { picked = id; } }) as unknown as FE;
    const localBtn = findButton(el, t("proj.local"));
    assert.ok(localBtn !== undefined);
    localBtn.dispatch("click");
    assert.equal(picked, "local");
  });

  it("Start picking button fires onPick with selected project id", () => {
    const { dom } = makeDom();
    const { t } = createI18n("zh");
    let picked: string | null = null;
    const el = renderProjectChooser(dom, PROJECTS, { t, onPick: (id) => { picked = id; } }) as unknown as FE;
    const confirmBtn = findButton(el, t("proj.confirm"));
    assert.ok(confirmBtn !== undefined);
    confirmBtn.dispatch("click");
    assert.equal(picked, "app-web"); // default selection
  });

  it("Start picking fires the second project after selecting it", () => {
    const { dom } = makeDom();
    const { t } = createI18n("zh");
    let picked: string | null = null;
    const el = renderProjectChooser(dom, PROJECTS, { t, onPick: (id) => { picked = id; } }) as unknown as FE;
    // Select second item
    findAllByClass(el, "proj")[1]!.dispatch("click");
    findButton(el, t("proj.confirm"))!.dispatch("click");
    assert.equal(picked, "marketing");
  });

  it("renders chooser title and subtitle", () => {
    const { dom } = makeDom();
    const { t } = createI18n("zh");
    const el = renderProjectChooser(dom, PROJECTS, { t, onPick: () => {} }) as unknown as FE;
    const h3 = findAllByTag(el, "h3")[0];
    assert.equal(h3?.textContent, t("proj.title"));
    const sub = findByClass(el, "sub");
    assert.equal(sub?.textContent, t("proj.sub"));
  });

  it("renders in English when lang=en", () => {
    const { dom } = makeDom();
    const { t } = createI18n("en");
    const el = renderProjectChooser(dom, PROJECTS, { t, onPick: () => {} }) as unknown as FE;
    assert.ok(findButton(el, "Continue locally") !== undefined);
    assert.ok(findButton(el, "Start picking") !== undefined);
  });
});

describe("UI-6 · Page-level fallback — Surface 8", () => {
  it("renders fallback title, body, and copy button", () => {
    const { dom } = makeDom();
    const { t } = createI18n("zh");
    const el = renderFallback(dom, { t, onCopy: async () => true }) as unknown as FE;
    const h4 = findAllByTag(el, "h4")[0];
    assert.ok(h4 !== undefined, "h4 should exist");
    // h4 contains a span with the title text
    const titleSpan = h4.children.find((c) => c.textContent === t("fb.title"));
    assert.ok(titleSpan !== undefined, "title span should contain fb.title");
    // body text
    const p = findAllByTag(el, "p")[0];
    assert.equal(p?.textContent, t("fb.body"));
    // copy button
    const copyBtn = findButton(el, t("fb.copy"));
    assert.ok(copyBtn !== undefined, "copy button should exist");
  });

  it("copy button shows local token alongside it", () => {
    const { dom } = makeDom();
    const { t } = createI18n("zh");
    const el = renderFallback(dom, { t, onCopy: async () => true }) as unknown as FE;
    const fbRow = findByClass(el, "fb-row");
    assert.ok(fbRow !== undefined);
    const toks = findAllByClass(fbRow, "tok");
    assert.ok(toks.length > 0, "should have at least one tok in fb-row");
  });

  it("copy button text changes to copied on success then reverts", async () => {
    const { dom } = makeDom();
    const { t } = createI18n("zh");
    let resolve!: (v: boolean) => void;
    const copyPromise = new Promise<boolean>((res) => { resolve = res; });
    const el = renderFallback(dom, { t, onCopy: () => copyPromise }) as unknown as FE;
    const copyBtn = findButton(el, t("fb.copy"))!;
    copyBtn.dispatch("click");
    resolve(true);
    await copyPromise;
    // Allow microtask queue to flush
    await Promise.resolve();
    assert.equal(copyBtn.textContent, t("detail.copyOk"));
  });

  it("renders in English when lang=en", () => {
    const { dom } = makeDom();
    const { t } = createI18n("en");
    const el = renderFallback(dom, { t, onCopy: async () => false }) as unknown as FE;
    assert.ok(findButton(el, "Copy Markdown") !== undefined);
    const p = findAllByTag(el, "p")[0];
    assert.equal(p?.textContent, t("fb.body"));
  });

  it("copy failure does not change button text", async () => {
    const { dom } = makeDom();
    const { t } = createI18n("zh");
    let resolve!: (v: boolean) => void;
    const copyPromise = new Promise<boolean>((res) => { resolve = res; });
    const el = renderFallback(dom, { t, onCopy: () => copyPromise }) as unknown as FE;
    const copyBtn = findButton(el, t("fb.copy"))!;
    copyBtn.dispatch("click");
    resolve(false);
    await copyPromise;
    await Promise.resolve();
    assert.equal(copyBtn.textContent, t("fb.copy"), "text should not change on failure");
  });

  it("h4 contains neutral tok glyph before title text", () => {
    const { dom } = makeDom();
    const { t } = createI18n("zh");
    const el = renderFallback(dom, { t, onCopy: async () => true }) as unknown as FE;
    const h4 = findAllByTag(el, "h4")[0]!;
    const tokInH4 = findByClass(h4, "tok--neutral");
    assert.ok(tokInH4 !== undefined, "h4 should have a tok--neutral span");
  });
});

describe("UI-6 · sync-failed Retry affordance (detail)", () => {
  const { t } = createI18n("zh");

  it("shows Retry button only when sync is failed", () => {
    const { dom } = makeDom();
    const failed = renderDetail(dom, makePin({ sync: "failed" }), { t, ...detailNoops }) as unknown as FE;
    assert.ok(findButton(failed, t("fb.retry")) !== undefined, "Retry shown for failed mark");

    const { dom: dom2 } = makeDom();
    const local = renderDetail(dom2, makePin({ sync: "local" }), { t, ...detailNoops }) as unknown as FE;
    assert.ok(findButton(local, t("fb.retry")) === undefined, "no Retry for local mark");

    const { dom: dom3 } = makeDom();
    const synced = renderDetail(dom3, makePin({ sync: "synced" }), { t, ...detailNoops }) as unknown as FE;
    assert.ok(findButton(synced, t("fb.retry")) === undefined, "no Retry for synced mark");
  });

  it("Retry button fires onRetry with the pin id", () => {
    const { dom } = makeDom();
    let retried: string | null = null;
    const el = renderDetail(dom, makePin({ id: "pin-9", sync: "failed" }), {
      t, ...detailNoops, onRetry: (id) => { retried = id; },
    }) as unknown as FE;
    findButton(el, t("fb.retry"))!.dispatch("click");
    assert.equal(retried, "pin-9");
  });

  it("Copy Markdown remains available on a failed mark", () => {
    const { dom } = makeDom();
    const el = renderDetail(dom, makePin({ sync: "failed" }), { t, ...detailNoops }) as unknown as FE;
    assert.ok(findButton(el, t("detail.copy")) !== undefined, "Copy Markdown present alongside Retry");
  });

  it("failed mark renders the sync failed token", () => {
    const { dom } = makeDom();
    const el = renderDetail(dom, makePin({ sync: "failed" }), { t, ...detailNoops }) as unknown as FE;
    const bad = findAllByClass(el, "tok--bad");
    const hasSyncFailed = bad.some((tok) => findAllByTag(tok, "span").some((s) => s.textContent === t("sync.failed")));
    assert.ok(hasSyncFailed, "sync failed token shown in detail meta");
  });
});
