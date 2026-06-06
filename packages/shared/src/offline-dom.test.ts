import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { capture_locator, resolve, type ResolveResult } from "./schema.js";
import { find_anomaly_target, install_offline_dom_globals, parse_snapshot_html } from "./offline-dom.js";

install_offline_dom_globals();

type ResolveResultWithElement = ResolveResult & { element?: unknown };

describe("offline snapshot DOM parser", () => {
  it("parses elements, attributes, and entity-escaped text", () => {
    const root = parse_snapshot_html(
      `<main data-testid="settings-panel"><button data-testid="primary-action" aria-label="Save &amp; close" data-loupe-target="">Save &amp; close</button></main>`,
    );

    const button = find_anomaly_target(root);
    assert.ok(button, "expected the data-loupe-target element");
    assert.equal(button.localName, "button");
    assert.equal(button.getAttribute("data-testid"), "primary-action");
    assert.equal(button.getAttribute("aria-label"), "Save & close");
    assert.equal(button.textContent, "Save & close");
    assert.equal(button.parentElement?.getAttribute("data-testid"), "settings-panel");
  });

  it("reconstructs an open shadow root from a declarative template", () => {
    const root = parse_snapshot_html(
      `<loupe-card data-testid="shadow-host"><template shadowrootmode="open"><button data-testid="shadow-action" data-loupe-target="">Shadow save</button></template></loupe-card>`,
    );

    const host = root.querySelector('[data-testid="shadow-host"]');
    assert.ok(host, "expected the host element");
    assert.ok(host.shadowRoot, "expected an attached shadow root");
    const target = find_anomaly_target(root);
    assert.ok(target, "expected the shadow target via the marker");
    assert.equal(target.getAttribute("data-testid"), "shadow-action");
    assert.equal(target.getRootNode(), host.shadowRoot);
  });

  it("skips comments such as the truncation marker", () => {
    const root = parse_snapshot_html(`<section data-testid="panel"><!-- loupe: snapshot truncated at 100 chars --></section>`);
    const section = root.querySelector('[data-testid="panel"]');
    assert.ok(section);
    assert.equal(section.children.length, 0);
    assert.equal(section.textContent, "");
  });

  it("round-trips a captured locator: capture, parse, resolve to the same target", () => {
    const html = `<main data-testid="settings-panel"><button data-testid="primary-action" aria-label="Publish" data-loupe-target="">Publish</button></main>`;
    const captureRoot = parse_snapshot_html(html);
    const target = find_anomaly_target(captureRoot);
    assert.ok(target);

    const locator = capture_locator(target as unknown as Element, { max_parent_depth: 6 });

    const replayRoot = parse_snapshot_html(html);
    const replayTarget = find_anomaly_target(replayRoot);
    const result = resolve(locator, replayRoot as unknown as Document) as ResolveResultWithElement;

    assert.equal(result.locator_status, "resolved");
    assert.equal(result.element, replayTarget);
  });

  it("round-trips a shadow-DOM target through shadow_path", () => {
    const html = `<loupe-card data-testid="shadow-host"><template shadowrootmode="open"><button data-testid="shadow-action" aria-label="Shadow save" data-loupe-target="">Shadow save</button></template></loupe-card>`;
    const captureRoot = parse_snapshot_html(html);
    const target = find_anomaly_target(captureRoot);
    assert.ok(target);
    const locator = capture_locator(target as unknown as Element, { max_parent_depth: 6 });
    assert.ok(locator.evidence.shadow_path?.length, "expected shadow_path evidence");

    const replayRoot = parse_snapshot_html(html);
    const result = resolve(locator, replayRoot as unknown as Document) as ResolveResultWithElement;
    assert.equal(result.locator_status, "resolved");
    assert.equal(result.element, find_anomaly_target(replayRoot));
  });
});
