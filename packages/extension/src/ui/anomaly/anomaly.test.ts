import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { serializeAnomalySnapshot } from "./snapshot.js";
import { BreadcrumbBuffer } from "./breadcrumbs.js";
import { buildAnomalyReport, captureEnv } from "./report.js";
import { installAnomalyHotkey, isAnomalyChord } from "./hotkey.js";

// Minimal DOM doubles structurally matching the SnapshotElement interface.
type Node = { nodeType: number; textContent?: string | null };

function text(value: string): Node {
  return { nodeType: 3, textContent: value };
}

class El {
  nodeType = 1;
  attributes: Array<{ name: string; value: string }> = [];
  childNodes: Node[] = [];
  parentElement: El | null = null;
  shadowRoot: { childNodes: Node[] } | null = null;
  textContent: string | null = null;

  constructor(public tagName: string) {}

  attr(name: string, value: string): this {
    this.attributes.push({ name, value });
    return this;
  }

  append(...children: Node[]): this {
    for (const child of children) {
      if (child instanceof El) child.parentElement = this;
      this.childNodes.push(child);
    }
    return this;
  }
}

describe("anomaly snapshot serializer", () => {
  it("serializes the bounded subtree and marks the target", () => {
    const target = new El("BUTTON").attr("data-testid", "go").append(text("Go"));
    const wrapper = new El("DIV").attr("class", "row").append(target);
    const section = new El("SECTION").append(wrapper);
    void section;

    const html = serializeAnomalySnapshot(target, { maxAncestors: 1 });
    assert.equal(html, '<div class="row"><button data-testid="go" data-loupe-target="">Go</button></div>');
  });

  it("expands open shadow roots as declarative shadow DOM", () => {
    const inner = new El("SPAN").append(text("shadow"));
    const host = new El("DIV").attr("id", "host");
    host.shadowRoot = { childNodes: [inner] };

    const html = serializeAnomalySnapshot(host, { maxAncestors: 0 });
    assert.equal(html, '<div id="host" data-loupe-target=""><template shadowrootmode="open"><span>shadow</span></template></div>');
  });

  it("embeds same-origin iframe document roots when accessible", () => {
    const frameRoot = new El("HTML").append(new El("BODY").append(new El("MAIN").append(text("inside"))));
    const iframe = new El("IFRAME") as El & { contentDocument?: { documentElement: El } };
    iframe.contentDocument = { documentElement: frameRoot };

    const html = serializeAnomalySnapshot(iframe, { maxAncestors: 0 });

    assert.equal(html, '<iframe data-loupe-target=""><template data-loupe-frame="same-origin"><html><body><main>inside</main></body></html></template></iframe>');
  });

  it("escapes text and attribute values and closes void elements", () => {
    const img = new El("IMG").attr("alt", 'a "b" <c>');
    const root = new El("P").append(text("1 < 2 & 3"), img);

    const html = serializeAnomalySnapshot(root, { maxAncestors: 0 });
    assert.equal(html, '<p data-loupe-target="">1 &lt; 2 &amp; 3<img alt="a &quot;b&quot; &lt;c&gt;"></p>');
  });

  it("truncates output past the char cap", () => {
    const root = new El("DIV").append(text("x".repeat(50)));
    const html = serializeAnomalySnapshot(root, { maxAncestors: 0, maxChars: 20 });
    assert.match(html, /snapshot truncated at 20 chars/);
    assert.ok((html.match(/x/g)?.length ?? 0) < 50);
  });
});

describe("breadcrumb buffer", () => {
  it("keeps only the most recent entries and snapshots immutably", () => {
    let tick = 0;
    const buffer = new BreadcrumbBuffer(2, () => `t${tick++}`);
    buffer.push("pick", "button");
    buffer.push("route_change");
    buffer.push("save");

    const snapshot = buffer.snapshot();
    assert.deepEqual(snapshot, [
      { at: "t1", kind: "route_change" },
      { at: "t2", kind: "save" },
    ]);
    snapshot.push({ at: "x", kind: "mutate" });
    assert.equal(buffer.snapshot().length, 2);
  });
});

describe("anomaly report builder", () => {
  it("stamps schema_version, defaults breadcrumbs, and omits absent optionals", () => {
    const report = buildAnomalyReport({ source: "manual", summary: "wrong pin", env: { url: "http://localhost:5173/" } });
    assert.equal(report.schema_version, 1);
    assert.deepEqual(report.breadcrumbs, []);
    assert.equal("expected" in report, false);
    assert.equal("dom_html" in report, false);
  });

  it("carries blobs and expected/actual through when present", () => {
    const report = buildAnomalyReport({
      source: "manual",
      summary: "wrong pin",
      expected: "pin on button B",
      actual: "pin on button A",
      dom_html: "<main></main>",
      storage: { marks: [] },
      env: {},
    });
    assert.equal(report.expected, "pin on button B");
    assert.equal(report.dom_html, "<main></main>");
    assert.deepEqual(report.storage, { marks: [] });
  });

  it("captures env from a window-like", () => {
    const env = captureEnv({ location: { href: "http://localhost:5173/x" }, navigator: { userAgent: "UA" }, innerWidth: 1280, innerHeight: 800, devicePixelRatio: 2 });
    assert.deepEqual(env, { url: "http://localhost:5173/x", user_agent: "UA", viewport: { width: 1280, height: 800, dpr: 2 } });
  });
});

describe("anomaly hotkey", () => {
  it("recognizes the ⌥⇧A chord only", () => {
    assert.equal(isAnomalyChord({ altKey: true, shiftKey: true, key: "a" }), true);
    assert.equal(isAnomalyChord({ altKey: true, shiftKey: true, key: "A" }), true);
    assert.equal(isAnomalyChord({ altKey: true, key: "a" }), false);
    assert.equal(isAnomalyChord({ altKey: true, shiftKey: true, key: "l" }), false);
  });

  it("triggers on the chord, prevents default, and disposes", () => {
    const listeners: Array<(e: unknown) => void> = [];
    const doc = {
      addEventListener: (_t: string, l: (e: unknown) => void) => listeners.push(l),
      removeEventListener: (_t: string, l: (e: unknown) => void) => {
        const index = listeners.indexOf(l);
        if (index !== -1) listeners.splice(index, 1);
      },
    } as unknown as Parameters<typeof installAnomalyHotkey>[0];

    let triggers = 0;
    let prevented = 0;
    const dispose = installAnomalyHotkey(doc, () => triggers++);
    listeners[0]?.({ altKey: true, shiftKey: true, key: "a", preventDefault: () => prevented++ });
    listeners[0]?.({ altKey: false, key: "a", preventDefault: () => prevented++ });
    assert.equal(triggers, 1);
    assert.equal(prevented, 1);

    dispose();
    assert.equal(listeners.length, 0);
  });
});
