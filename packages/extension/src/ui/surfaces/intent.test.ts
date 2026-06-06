import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { renderIntent, type IntentHandlers, type Viewport } from "./intent.js";
import type { IntentKind } from "../storage/lib-storage.js";

/* ------------------------------------------------------------------ *
 * Fake DOM for intent tests. Extended from ui-2-picker pattern to add:
 *   - classList.add / remove / contains / toggle
 *   - style.setProperty for CSS custom properties
 *   - focus() tracking
 *   - multiple-listener dispatch
 * ------------------------------------------------------------------ */

type Listener = (e: unknown) => void;

class FakeClassList {
  private readonly list: string[] = [];
  add(...cls: string[]): void { for (const c of cls) if (!this.list.includes(c)) this.list.push(c); }
  remove(...cls: string[]): void { for (const c of cls) { const i = this.list.indexOf(c); if (i >= 0) this.list.splice(i, 1); } }
  contains(c: string): boolean { return this.list.includes(c); }
  toggle(c: string): boolean { if (this.list.includes(c)) { this.remove(c); return false; } else { this.add(c); return true; } }
}

class FakeStyle {
  private readonly _map = new Map<string, string>();
  setProperty(k: string, v: string): void { this._map.set(k, v); }
  getPropertyValue(k: string): string { return this._map.get(k) ?? ""; }
  get(k: string): string { return this._map.get(k) ?? (this as unknown as Record<string, string>)[k] ?? ""; }
  [key: string]: unknown;
}

class FakeEl {
  tagName: string;
  id = "";
  readonly classList = new FakeClassList();
  readonly attributes = new Map<string, string>();
  textContent: string | null = null;
  innerHTML = "";
  parentElement: FakeEl | null = null;
  readonly style = new FakeStyle();
  focusCalled = false;
  value = "";
  scrollHeight = 0;
  private readonly _listeners = new Map<string, Listener[]>();

  constructor(tag: string) {
    this.tagName = tag.toUpperCase();
  }

  setAttribute(k: string, v: string): void { this.attributes.set(k, v); }
  getAttribute(k: string): string | null { return this.attributes.get(k) ?? null; }
  removeAttribute(k: string): void { this.attributes.delete(k); }

  addEventListener(type: string, listener: Listener): void {
    const arr = this._listeners.get(type) ?? [];
    arr.push(listener);
    this._listeners.set(type, arr);
  }
  removeEventListener(type: string, listener: Listener): void {
    const arr = this._listeners.get(type) ?? [];
    this._listeners.set(type, arr.filter((l) => l !== listener));
  }
  dispatch(type: string, event: unknown): void {
    for (const l of this._listeners.get(type) ?? []) l(event);
  }
  focus(): void { this.focusCalled = true; }
  append(..._nodes: unknown[]): void { /* no-op */ }
}

class FakeDoc {
  createElement(tag: string): FakeEl { return new FakeEl(tag); }
  getElementById(_id: string): null { return null; }
}

function makeDom(fakeDoc: FakeDoc): import("../core/dom.js").Dom {
  const created: FakeEl[] = [];
  const el = (tag: string, props: { class?: string; text?: string; attrs?: Record<string, string>; data?: Record<string, string>; style?: Record<string, string> } = {}, children: FakeEl[] = []): FakeEl => {
    const node = fakeDoc.createElement(tag);
    if (props.class !== undefined) node.classList.add(...props.class.split(" "));
    if (props.text !== undefined) node.textContent = props.text;
    if (props.attrs !== undefined) {
      for (const [k, v] of Object.entries(props.attrs)) node.setAttribute(k, v);
    }
    if (props.data !== undefined) {
      for (const [k, v] of Object.entries(props.data)) node.setAttribute(`data-${k}`, v);
    }
    if (props.style !== undefined) {
      for (const [k, v] of Object.entries(props.style)) {
        if (k.startsWith("--")) node.style.setProperty(k, v);
        else (node.style as unknown as Record<string, string>)[k] = v;
      }
    }
    for (const child of children) child.parentElement = node;
    created.push(node);
    return node;
  };
  return { el: el as unknown as import("../core/dom.js").Dom["el"], clear: () => {} };
}

const fakeTrans = (key: string): string => key;

function makeRect(overrides: Partial<DOMRect> = {}): DOMRect {
  return { left: 100, top: 100, width: 200, height: 40, right: 300, bottom: 140, x: 100, y: 100, toJSON: () => ({}), ...overrides };
}

function makeViewport(overrides: Partial<Viewport> = {}): Viewport {
  return { width: 1024, height: 768, scrollY: 0, ...overrides };
}

function makeHandlers(overrides: Partial<IntentHandlers> = {}): IntentHandlers & { saveArgs: Array<[string, IntentKind]>; cancelCalled: boolean } {
  const out = {
    saveArgs: [] as Array<[string, IntentKind]>,
    cancelCalled: false,
    onSave(comment: string, kind: IntentKind): void { out.saveArgs.push([comment, kind]); },
    onCancel(): void { out.cancelCalled = true; },
    ...overrides,
  };
  return out;
}

function makeFakeEvent(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  let prevented = false;
  return {
    preventDefault() { prevented = true; },
    get _prevented() { return prevented; },
    isComposing: false,
    ...overrides,
  };
}

// ------------------------------------------------------------------ //

describe("UI-3 · surface-intent", () => {
  // Helper: render and get all created elements in order
  function renderAndTrack(handlers?: Partial<IntentHandlers>, targetLabel = ""): {
    el: FakeEl;
    shell: FakeEl;
    textarea: FakeEl;
    submitBtn: FakeEl;
    kindDots: FakeEl[];
    hintEl: FakeEl;
    discardEl: FakeEl;
    errorEl: FakeEl;
    targetLabelEl: FakeEl | undefined;
    dispatch: (type: string, event?: Record<string, unknown>) => void;
    h: ReturnType<typeof makeHandlers>;
  } {
    const doc = new FakeDoc();
    const created: FakeEl[] = [];
    const el2 = (tag: string, props: { class?: string; text?: string; attrs?: Record<string, string>; data?: Record<string, string>; style?: Record<string, string> } = {}, children: FakeEl[] = []): FakeEl => {
      const node = doc.createElement(tag);
      if (props.class !== undefined) node.classList.add(...props.class.split(" ").filter(Boolean));
      if (props.text !== undefined) node.textContent = props.text;
      if (props.attrs !== undefined) for (const [k, v] of Object.entries(props.attrs)) node.setAttribute(k, v);
      if (props.data !== undefined) for (const [k, v] of Object.entries(props.data)) node.setAttribute(`data-${k}`, v);
      if (props.style !== undefined) for (const [k, v] of Object.entries(props.style)) {
        if (k.startsWith("--")) node.style.setProperty(k, v);
        else (node.style as unknown as Record<string, string>)[k] = v;
      }
      for (const child of children) child.parentElement = node;
      created.push(node);
      return node;
    };
    const dom = { el: el2 as unknown as import("../core/dom.js").Dom["el"], clear: () => {} };

    const h = makeHandlers(handlers);
    const rootEl = renderIntent(dom, fakeTrans, makeRect(), makeViewport(), h, targetLabel) as unknown as FakeEl;

    // Created elements in order: pip, targ, textarea, submitBtn, nameSpan×6, dot×6, kindLabel, kindrail, row, intentShell, hintEl, discardEl, errorEl, hintKey, footEl, root
    // Let's identify by tag and position:
    const textareas = created.filter((e) => e.tagName === "TEXTAREA");
    const buttons = created.filter((e) => e.tagName === "BUTTON");
    // submitBtn is first button; kind dots are buttons 1-6
    const textarea = textareas[0] as FakeEl;
    const submitBtn = buttons[0] as FakeEl;
    const kindDots = buttons.slice(1, 7) as FakeEl[];

    // Shell, hint, discard, error from created divs:
    const divs = created.filter((e) => e.tagName === "DIV");
    // Order: targ(0), row(1+), intentShell, root
    // Easier: find by class
    const shell = created.find((e) => e.classList.contains("lp-intent-shell")) as FakeEl;
    const hintEl = created.find((e) => e.classList.contains("lp-intent-hint")) as FakeEl;
    const discardEl = created.find((e) => e.classList.contains("lp-intent-discard")) as FakeEl;
    const errorEl = created.find((e) => e.classList.contains("lp-intent-error")) as FakeEl;
    const targetLabelEl = created.find((e) => e.classList.contains("lp-intent-target-label"));

    void divs;

    // dispatch a keydown on the textarea
    const dispatch = (type: string, event: Record<string, unknown> = {}): void => {
      textarea.dispatch(type, makeFakeEvent(event));
    };

    return { el: rootEl, shell, textarea, submitBtn, kindDots, hintEl, discardEl, errorEl, targetLabelEl, dispatch, h };
  }

  describe("render shell structure", () => {
    it("keeps card styling on the shell only, not the positioned root", () => {
      const { el, shell } = renderAndTrack();

      assert.equal(el.classList.contains("lp-intent"), true);
      assert.equal(el.classList.contains("card"), false, "outer positioned root must not draw a second card border");
      assert.equal(shell.classList.contains("lp-intent-shell"), true);
    });

    it("renders the picked target label in the shell header", () => {
      const { targetLabelEl } = renderAndTrack(undefined, 'button "Save changes"');

      assert.equal(targetLabelEl?.textContent, 'button "Save changes"');
    });
  });

  describe("submit button state", () => {
    it("is disabled initially (empty textarea)", () => {
      const { submitBtn } = renderAndTrack();
      assert.equal(submitBtn.getAttribute("disabled"), "", "submit should be disabled when empty");
    });

    it("becomes enabled after input event with content", () => {
      const { textarea, submitBtn } = renderAndTrack();
      textarea.value = "fix the bug";
      textarea.dispatch("input", {});
      assert.equal(submitBtn.getAttribute("disabled"), null, "submit should be enabled when textarea has content");
    });
  });

  describe("accessible labels", () => {
    it("labels the comment textarea as a comment field, not the save action", () => {
      const { textarea } = renderAndTrack();
      // fakeTrans echoes the i18n key. The comment box must carry the comment
      // label — not the submit-button label "intent.save" ("Save · ⌘↵").
      assert.equal(textarea.getAttribute("aria-label"), "intent.commenta");
    });

    it("keeps the submit button labeled as the save action", () => {
      const { submitBtn } = renderAndTrack();
      assert.equal(submitBtn.getAttribute("aria-label"), "intent.savea");
    });
  });

  describe("⌘/Ctrl+Enter empty → hint + no save", () => {
    it("does not call onSave when textarea is empty", () => {
      const { dispatch, h } = renderAndTrack();
      (global as unknown as Record<string, unknown>).setTimeout ??= () => 0;
      dispatch("keydown", { key: "Enter", metaKey: true });
      assert.equal(h.saveArgs.length, 0, "onSave should not be called for empty textarea");
    });

    it("adds lp-show-hint class on empty ⌘Enter", () => {
      const { el, dispatch } = renderAndTrack();
      dispatch("keydown", { key: "Enter", metaKey: true });
      assert.ok(el.classList.contains("lp-show-hint"), "lp-show-hint class should be added");
    });

    it("removes lp-show-hint on next input", () => {
      const { el, textarea, dispatch } = renderAndTrack();
      dispatch("keydown", { key: "Enter", metaKey: true });
      assert.ok(el.classList.contains("lp-show-hint"), "precondition: hint visible");

      textarea.value = "x";
      textarea.dispatch("input", {});
      assert.ok(!el.classList.contains("lp-show-hint"), "lp-show-hint should be removed after input");
    });
  });

  describe("⌘/Ctrl+Enter with content → collapse + onSave", () => {
    it("starts collapse (adds lp-collapsing) when textarea has content", () => {
      const { el, textarea, dispatch } = renderAndTrack();
      textarea.value = "fix the nav bug";
      textarea.dispatch("input", {});
      dispatch("keydown", { key: "Enter", metaKey: true });
      assert.ok(el.classList.contains("lp-collapsing"), "lp-collapsing should be added on submit");
    });

    it("calls onSave with correct comment + kind after animationend", () => {
      const { textarea, dispatch, shell, h } = renderAndTrack();
      textarea.value = "fix the nav bug";
      textarea.dispatch("input", {});
      dispatch("keydown", { key: "Enter", metaKey: true });

      // Fire animationend on shell to trigger onSave
      shell.dispatch("animationend", {});

      assert.equal(h.saveArgs.length, 1, "onSave should be called once");
      assert.equal(h.saveArgs[0]?.[0], "fix the nav bug", "comment should match");
      assert.equal(h.saveArgs[0]?.[1], "other", "default kind should be 'other'");
    });

    it("Ctrl+Enter also triggers save", () => {
      const { textarea, dispatch, shell, h } = renderAndTrack();
      textarea.value = "improve layout";
      textarea.dispatch("input", {});
      dispatch("keydown", { key: "Enter", ctrlKey: true });
      shell.dispatch("animationend", {});
      assert.equal(h.saveArgs.length, 1, "Ctrl+Enter should trigger save");
    });

    it("plain Enter does NOT trigger save (IME-safe)", () => {
      const { textarea, dispatch, h } = renderAndTrack();
      textarea.value = "some text";
      textarea.dispatch("input", {});
      dispatch("keydown", { key: "Enter" });
      assert.equal(h.saveArgs.length, 0, "plain Enter must not save");
    });

    it("isComposing=true Enter does NOT trigger save", () => {
      const { textarea, dispatch, h } = renderAndTrack();
      textarea.value = "some text";
      textarea.dispatch("input", {});
      dispatch("keydown", { key: "Enter", metaKey: true, isComposing: true });
      assert.equal(h.saveArgs.length, 0, "composing Enter must not save");
    });
  });

  describe("onSave rejects → inline error, no collapse", () => {
    it("shows error and removes lp-collapsing on rejection", async () => {
      const doc = new FakeDoc();
      const created: FakeEl[] = [];
      const el2 = (tag: string, props: Record<string, unknown> = {}, children: FakeEl[] = []): FakeEl => {
        const node = doc.createElement(tag);
        const p = props as { class?: string; text?: string; attrs?: Record<string, string>; data?: Record<string, string> };
        if (p.class !== undefined) node.classList.add(...p.class.split(" ").filter(Boolean));
        if (p.text !== undefined) node.textContent = p.text;
        if (p.attrs !== undefined) for (const [k, v] of Object.entries(p.attrs)) node.setAttribute(k, v);
        if (p.data !== undefined) for (const [k, v] of Object.entries(p.data)) node.setAttribute(`data-${k}`, v);
        for (const child of children) child.parentElement = node;
        created.push(node);
        return node;
      };
      const dom = { el: el2 as unknown as import("../core/dom.js").Dom["el"], clear: () => {} };

      const h: IntentHandlers = {
        onSave: async () => { throw new Error("storage failed"); },
        onCancel: () => {},
      };
      const rootEl = renderIntent(dom, fakeTrans, makeRect(), makeViewport(), h) as unknown as FakeEl;
      const shell = created.find((e) => e.classList.contains("lp-intent-shell")) as FakeEl;
      const errorEl = created.find((e) => e.classList.contains("lp-intent-error")) as FakeEl;
      const textareas = created.filter((e) => e.tagName === "TEXTAREA");
      const textarea = textareas[0] as FakeEl;

      textarea.value = "some task";
      textarea.dispatch("input", {});
      textarea.dispatch("keydown", makeFakeEvent({ key: "Enter", metaKey: true, isComposing: false }));

      // Trigger animationend to call onSave (which rejects)
      shell.dispatch("animationend", {});

      // Wait for the async rejection to propagate
      await new Promise((r) => setTimeout(r, 10));

      assert.ok(!rootEl.classList.contains("lp-collapsing"), "lp-collapsing should be removed on error");
      assert.equal((errorEl.style as unknown as Record<string, string>)["display"], "block", "error element should be visible");
      assert.equal(errorEl.textContent, "intent.saveErr", "error text should come from i18n");
    });
  });

  describe("2-step Esc", () => {
    it("Esc with empty content calls onCancel immediately", () => {
      const { dispatch, h } = renderAndTrack();
      dispatch("keydown", { key: "Escape" });
      assert.ok(h.cancelCalled, "onCancel should be called immediately on Esc with empty content");
    });

    it("first Esc with content does NOT call onCancel", () => {
      const { textarea, dispatch, h } = renderAndTrack();
      textarea.value = "some work";
      textarea.dispatch("input", {});
      dispatch("keydown", { key: "Escape" });
      assert.ok(!h.cancelCalled, "onCancel should NOT be called on first Esc with content");
    });

    it("first Esc with content shows discard hint", () => {
      const { textarea, dispatch, discardEl } = renderAndTrack();
      textarea.value = "some work";
      textarea.dispatch("input", {});
      dispatch("keydown", { key: "Escape" });
      assert.equal((discardEl.style as unknown as Record<string, string>)["display"], "block", "discard hint should be visible after first Esc");
    });

    it("second Esc with content calls onCancel", () => {
      const { textarea, dispatch, h } = renderAndTrack();
      textarea.value = "some work";
      textarea.dispatch("input", {});
      dispatch("keydown", { key: "Escape" }); // first: arm
      dispatch("keydown", { key: "Escape" }); // second: confirm
      assert.ok(h.cancelCalled, "onCancel should be called on second Esc");
    });
  });

  describe("kind rail — click selection", () => {
    it("clicking a kind dot updates kind passed to onSave", () => {
      const { textarea, dispatch, kindDots, shell, h } = renderAndTrack();
      textarea.value = "fix it";
      textarea.dispatch("input", {});

      // Click "bug" dot (index 0)
      kindDots[0]!.dispatch("click", {});

      dispatch("keydown", { key: "Enter", metaKey: true });
      shell.dispatch("animationend", {});

      assert.equal(h.saveArgs[0]?.[1], "bug", "kind should be 'bug' after clicking bug dot");
    });

    it("selected dot gets lp-kind-btn--sel class", () => {
      const { kindDots } = renderAndTrack();
      kindDots[0]!.dispatch("click", {}); // click "bug"
      assert.ok(kindDots[0]!.classList.contains("lp-kind-btn--sel"), "bug dot should be selected");
      assert.ok(!kindDots[5]!.classList.contains("lp-kind-btn--sel"), "other dot should not be selected");
    });
  });

  describe("kind rail — keyboard navigation", () => {
    it("ArrowRight on a dot moves focus to next dot", () => {
      const { kindDots } = renderAndTrack();
      // Dispatch ArrowRight on 'other' (index 5, last) → wraps to bug (index 0)
      kindDots[5]!.dispatch("keydown", makeFakeEvent({ key: "ArrowRight" }));
      assert.ok(kindDots[0]!.focusCalled, "focus should move to first dot on ArrowRight from last");
    });

    it("ArrowLeft on first dot wraps to last", () => {
      const { kindDots } = renderAndTrack();
      kindDots[0]!.dispatch("keydown", makeFakeEvent({ key: "ArrowLeft" }));
      assert.ok(kindDots[5]!.focusCalled, "focus should wrap to last dot on ArrowLeft from first");
    });

    it("ArrowRight also selects the kind", () => {
      const { kindDots, textarea, dispatch, shell, h } = renderAndTrack();
      // Start at index 0 (bug), ArrowRight to copy
      kindDots[0]!.dispatch("click", {}); // select bug first
      kindDots[0]!.dispatch("keydown", makeFakeEvent({ key: "ArrowRight" })); // move to copy (index 1)

      textarea.value = "copy issue";
      textarea.dispatch("input", {});
      dispatch("keydown", { key: "Enter", metaKey: true });
      shell.dispatch("animationend", {});
      assert.equal(h.saveArgs[0]?.[1], "copy", "kind should be 'copy' after ArrowRight from bug");
    });

    it("Tab from a kind dot focuses textarea", () => {
      const { textarea, kindDots } = renderAndTrack();
      kindDots[0]!.dispatch("keydown", makeFakeEvent({ key: "Tab", shiftKey: false }));
      assert.ok((textarea as unknown as { focusCalled: boolean }).focusCalled, "Tab from kind dot should focus textarea");
    });
  });

  describe("bottom dock fallback", () => {
    it("uses fixed positioning when target is off-screen", () => {
      const doc = new FakeDoc();
      const dom = makeDom(doc);
      const h = makeHandlers();
      const rect = makeRect({ top: 10, bottom: 50 }); // very little space above or below
      const viewport = makeViewport({ height: 100 }); // tiny viewport → both spaceBelow and spaceAbove < PANEL_HEIGHT+PAD

      const el = renderIntent(dom, fakeTrans, rect, viewport, h) as unknown as FakeEl;
      assert.equal((el.style as unknown as Record<string, string>)["position"], "fixed", "should use fixed positioning for bottom dock");
      assert.ok((el.style as unknown as Record<string, string>)["bottom"] !== undefined, "should set bottom property");
    });
  });
});
