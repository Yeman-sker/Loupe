import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { LOUPE_SCHEMA_VERSION, capture_locator, resolve, type ResolveResult } from "./schema.js";
import { find_anomaly_target, install_offline_dom_globals, parse_snapshot_html } from "./offline-dom.js";
import { generate_repro_test } from "./anomaly-repro.js";
import { type AnomalyReport } from "./anomaly.js";

install_offline_dom_globals();

const DOM_HTML = `<main data-testid="settings-panel"><button data-testid="primary-action" aria-label="Publish" data-loupe-target="">Publish</button></main>`;

function sampleReport(overrides: Partial<AnomalyReport> = {}): AnomalyReport {
  const root = parse_snapshot_html(DOM_HTML);
  const target = find_anomaly_target(root);
  assert.ok(target, "fixture snapshot must carry a target marker");
  const locator = capture_locator(target as unknown as Element, { max_parent_depth: 6 });
  const resolve_result = resolve(locator, root as unknown as Document) as ResolveResult & { element?: unknown };
  delete resolve_result.element;

  return {
    schema_version: LOUPE_SCHEMA_VERSION,
    source: "manual",
    summary: "Manual anomaly: Publish button resolved to the wrong element",
    breadcrumbs: [],
    env: {},
    id: "anom-1234",
    created_at: "2026-06-06T00:00:00.000Z",
    has_dom: true,
    has_storage: false,
    locator,
    resolve_result,
    ...overrides,
  };
}

describe("anomaly repro generator", () => {
  it("emits a self-contained replay test with inlined snapshot, locator, and expected status", () => {
    const source = generate_repro_test({ report: sampleReport(), dom_html: DOM_HTML });

    assert.match(source, /import \{ resolve, type Locator, type ResolveResult \} from ".\/schema.js";/);
    assert.match(source, /import \{ parse_snapshot_html, find_anomaly_target, install_offline_dom_globals \} from ".\/offline-dom.js";/);
    assert.match(source, /describe\("anomaly repro anom-1234"/);
    assert.match(source, /const DOM_HTML = `<main data-testid="settings-panel"/);
    assert.match(source, /const LOCATOR: Locator = \{/);
    assert.ok(source.includes("primary-action"), "locator literal should carry the captured selector");
    assert.match(source, /result\.locator_status,\s*"resolved"/);
    // resolved capture => target-equality assertion is emitted.
    assert.match(source, /offline resolve did not return the captured target element/);
  });

  it("the generated assertions hold for the captured bundle (fidelity guard stays green)", () => {
    const report = sampleReport();
    // Mirror exactly what the generated test does, proving its assertions pass.
    const root = parse_snapshot_html(DOM_HTML);
    const result = resolve(report.locator!, root as unknown as Document) as ResolveResult & { element?: unknown };
    const expectedStatus = (report.resolve_result as { locator_status: string }).locator_status;

    assert.equal(result.locator_status, expectedStatus);
    assert.equal(result.element, find_anomaly_target(root));
  });

  it("omits the target-equality assertion when the captured status is not resolved", () => {
    const report = sampleReport({ resolve_result: { locator_status: "lost" } });
    const source = generate_repro_test({ report, dom_html: DOM_HTML });

    assert.match(source, /result\.locator_status,\s*"lost"/);
    assert.doesNotMatch(source, /find_anomaly_target/);
  });

  it("escapes backticks and template-literal interpolation in the snapshot", () => {
    const tricky = "<pre>`code` and ${injected}</pre>";
    const source = generate_repro_test({ report: sampleReport(), dom_html: tricky });
    assert.match(source, /\\`code\\` and \\\$\{injected\}/);
  });

  it("throws when the bundle has no locator", () => {
    const report = sampleReport();
    delete report.locator;
    assert.throws(() => generate_repro_test({ report, dom_html: DOM_HTML }), /no locator/);
  });

  it("throws when the bundle has no captured resolve status", () => {
    const report = sampleReport();
    delete report.resolve_result;
    assert.throws(() => generate_repro_test({ report, dom_html: DOM_HTML }), /no captured resolve_result/);
  });
});
