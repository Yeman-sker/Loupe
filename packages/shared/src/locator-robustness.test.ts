import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  capture_locator,
  is_locator,
  is_resolve_result,
  resolve,
  type BoundaryKind,
  type Locator,
  type LocatorStatus,
  type ResolveResult,
} from "./schema.js";
import { FakeDocument, FakeElement, FakeShadowRoot, install_offline_dom_globals } from "./offline-dom.js";

type ResolveResultWithElement = ResolveResult & {
  downgrade_reason?: string;
};

type FixtureExpectation = {
  status: LocatorStatus;
  target_should_be_top_1: boolean;
  counts_for_top_1: boolean;
  counts_for_false_resolved: boolean;
  counts_for_ambiguity: boolean;
  counts_for_classification: boolean;
  expected_ambiguity_reason?: "close_score" | "duplicate_evidence";
};

type Fixture = {
  name: string;
  build: () => FixtureContext;
  mutate: (context: FixtureContext) => void;
  root: (context: FixtureContext) => FakeDocument | FakeShadowRoot | FakeElement;
  expectation: FixtureExpectation;
  assert_locator?: (locator: Locator, context: FixtureContext) => void;
};

type FixtureContext = {
  root: FakeDocument;
  target: FakeElement;
  notes?: Record<string, FakeElement | FakeDocument | FakeShadowRoot>;
};

type Outcome = {
  name: string;
  expected: FixtureExpectation;
  result: ResolveResultWithElement;
  target: FakeElement;
  top_1_correct: boolean;
};

const EXPLAINABLE_MATCH_REASONS: Record<string, true> = {
  primary: true,
  primary_selector: true,
  alternate: true,
  alternate_selector: true,
  stable_attr: true,
  stable_attrs: true,
  stable_id: true,
  role: true,
  role_name: true,
  accessible_name: true,
  text: true,
  text_hash: true,
  tag: true,
  stable_class: true,
  parent_chain: true,
  nth_path: true,
  shadow_path: true,
  geometry: true,
  frame_path: true,
  already_in_frame: true,
  boundary: true,
  ambiguous: true,
  duplicate_evidence: true,
  close_score: true,
  no_candidates: true,
};

describe("Loupe Phase 1 offline locator robustness", () => {
  it("offline robustness fixtures meet PRD metrics", async (t) => {
    const outcomes: Outcome[] = [];

    for (const fixture of fixtures()) {
      await t.test(fixture.name, () => {
        const context = fixture.build();
        const locator = capture_locator(context.target as unknown as Element, {
          max_parent_depth: 6,
        });

        assert.equal(is_locator(locator), true, `${fixture.name}: capture_locator returned invalid Locator`);
        fixture.assert_locator?.(locator, context);

        fixture.mutate(context);
        const result = resolve(locator, fixture.root(context) as unknown as Document | ShadowRoot | Element) as ResolveResultWithElement;
        assert_resolve_result_contract(result, fixture.name);

        const top_1_correct = result.element === (context.target as unknown as Element);
        outcomes.push({ name: fixture.name, expected: fixture.expectation, result, target: context.target, top_1_correct });

        assert.equal(
          result.locator_status,
          fixture.expectation.status,
          `${fixture.name}: expected ${fixture.expectation.status}, got ${result.locator_status}`,
        );

        if (fixture.expectation.target_should_be_top_1) {
          assert.equal(result.element, context.target as unknown as Element, `${fixture.name}: did not resolve the captured target`);
        }

        if (fixture.expectation.counts_for_ambiguity) {
          assert.ok(result.ambiguity, `${fixture.name}: expected ambiguity metadata`);
          assert.ok(
            result.ambiguity.reason === fixture.expectation.expected_ambiguity_reason,
            `${fixture.name}: expected ${fixture.expectation.expected_ambiguity_reason} ambiguity reason, got ${result.ambiguity.reason}`,
          );
        }
      });
    }

    const falseResolvedDenominator = outcomes.filter((outcome) => outcome.expected.counts_for_false_resolved).length;
    const ambiguityDenominator = outcomes.filter((outcome) => outcome.expected.counts_for_ambiguity).length;
    const driftLostDenominator = outcomes.filter((outcome) => outcome.expected.counts_for_classification).length;

    assert.ok(falseResolvedDenominator >= 4, `false_resolved denominator ${falseResolvedDenominator} < 4`);
    assert.ok(ambiguityDenominator >= 3, `ambiguity denominator ${ambiguityDenominator} < 3`);
    assert.ok(driftLostDenominator >= 7, `drift/lost denominator ${driftLostDenominator} < 7`);

    const metrics = compute_metrics(outcomes);
    console.log(`locator_robustness_metrics=${JSON.stringify(metrics)}`);

    assert.ok(metrics.top_1_target_accuracy >= 0.99, `top_1_target_accuracy ${metrics.top_1_target_accuracy} < 0.99`);
    assert.ok(metrics.false_resolved_rate <= 0.005, `false_resolved_rate ${metrics.false_resolved_rate} > 0.005`);
    assert.ok(
      metrics.ambiguity_downgrade_correctness >= 0.95,
      `ambiguity_downgrade_correctness ${metrics.ambiguity_downgrade_correctness} < 0.95`,
    );
    assert.ok(
      metrics.offline_drift_lost_classification >= 0.95,
      `offline_drift_lost_classification ${metrics.offline_drift_lost_classification} < 0.95`,
    );
  });
});

describe("Loupe Phase 4 support matrix locator runtime", () => {
  it("same-origin iframe resolves internal target through frame_path", () => {
    const context = build_iframe_fixture();
    const locator = capture_locator(context.target as unknown as Element, { max_parent_depth: 6 });

    assert.equal(is_locator(locator), true, "same-origin iframe: invalid locator");
    assert.equal(locator.evidence.tag, "button", "same-origin iframe: target evidence must describe internal element");
    assert.ok(locator.frame_path?.length, "same-origin iframe: expected frame_path evidence");
    assert.equal(locator.frame_path[0]?.selector, '[data-testid=\"preview-frame\"]', "same-origin iframe: expected shell selector in frame_path");
    assert.equal(locator.evidence.boundary, undefined, "same-origin iframe: same-origin internals must not be boundary shells");
    assert.deepEqual(context.root.querySelectorAll(locator.primary.selector), [], "same-origin iframe: top query must not pierce contentDocument");

    const result = resolve(locator, context.root as unknown as Document) as ResolveResultWithElement;
    assert_resolve_result_contract(result, "support matrix same-origin iframe");
    assert.equal(result.locator_status, "resolved");
    assert.equal(result.element, context.target as unknown as Element);
    assert_matched_by_prefix(result, ["stable_attrs", "accessible_name"], "same-origin iframe: expected internal target evidence match");
  });

  it("cross-origin iframe boundary resolves the iframe shell", () => {
    const context = build_cross_origin_iframe_boundary_fixture();
    const locator = capture_locator(context.target as unknown as Element, { max_parent_depth: 6 });
    locator.evidence.boundary = {
      kind: "cross_origin_iframe",
      target_scope: "boundary_shell",
      internal_target_supported: false,
      shell_selector: locator.primary.selector,
      reason: "Cross-origin iframe contentDocument is inaccessible; mark the iframe shell.",
    };

    assert.equal(is_locator(locator), true, "cross-origin iframe: invalid boundary locator");
    assert.equal(locator.evidence.tag, "iframe");
    assert.equal(locator.frame_path, undefined, "cross-origin iframe: shell locator must not claim internal frame_path");
    assert_boundary(locator, "cross_origin_iframe", "boundary_shell");

    const result = resolve(locator, context.root as unknown as Document) as ResolveResultWithElement;
    assert_resolve_result_contract(result, "support matrix cross-origin iframe");
    assert.equal(result.locator_status, "resolved");
    assert.equal(result.element, context.target as unknown as Element);
    assert_matched_by_prefix(result, ["stable_attrs", "primary_selector"], "cross-origin iframe: expected shell selector match");
  });

  it("SVG text element captures geometry and resolves the internal element", () => {
    const context = build_svg_text_fixture();
    const locator = capture_locator(context.target as unknown as Element, { max_parent_depth: 6 });

    assert.equal(is_locator(locator), true, "SVG: invalid locator");
    assert.equal(locator.evidence.tag, "text");
    assert.equal(locator.evidence.text?.normalized, "Q4 revenue");
    assert.ok(locator.evidence.geometry, "SVG: expected geometry evidence");
    assert.equal(locator.evidence.geometry?.x, 96);
    assert.equal(locator.evidence.geometry?.width, 84);
    assert.equal(locator.evidence.boundary, undefined, "SVG text is supported as an internal target");

    const result = resolve(locator, context.root as unknown as Document) as ResolveResultWithElement;
    assert_resolve_result_contract(result, "support matrix SVG");
    assert.equal(result.locator_status, "resolved");
    assert.equal(result.element, context.target as unknown as Element);
    assert_matched_by_prefix(result, ["geometry", "text"], "SVG: expected geometry or text match");
  });

  it("canvas internal target is represented by the canvas boundary shell", () => {
    const context = build_canvas_boundary_fixture();
    const locator = capture_locator(context.target as unknown as Element, { max_parent_depth: 6 });
    locator.evidence.boundary = {
      kind: "canvas_internal_target",
      target_scope: "boundary_shell",
      internal_target_supported: false,
      shell_selector: locator.primary.selector,
      reason: "Canvas pixels are not DOM elements; mark the canvas shell.",
    };

    assert.equal(is_locator(locator), true, "canvas: invalid boundary locator");
    assert.equal(locator.evidence.tag, "canvas");
    assert.ok(locator.evidence.geometry, "canvas: expected shell geometry evidence");
    assert_boundary(locator, "canvas_internal_target", "boundary_shell");

    const result = resolve(locator, context.root as unknown as Document) as ResolveResultWithElement;
    assert_resolve_result_contract(result, "support matrix canvas");
    assert.equal(result.locator_status, "resolved");
    assert.equal(result.element, context.target as unknown as Element);
    assert_matched_by_prefix(result, ["stable_attrs", "primary_selector"], "canvas: expected canvas shell match");
  });

  it("open Shadow DOM resolves internal target via shadow_path", () => {
    const context = build_shadow_fixture();
    const locator = capture_locator(context.target as unknown as Element, { max_parent_depth: 6 });

    assert.equal(is_locator(locator), true, "open Shadow DOM: invalid locator");
    assert.ok(locator.evidence.shadow_path?.length, "open Shadow DOM: expected shadow_path evidence");
    assert.equal(locator.evidence.boundary, undefined, "open Shadow DOM: internal target should not be downgraded to boundary shell");

    const result = resolve(locator, context.root as unknown as Document) as ResolveResultWithElement;
    assert_resolve_result_contract(result, "support matrix open Shadow DOM");
    assert.equal(result.locator_status, "resolved");
    assert.equal(result.element, context.target as unknown as Element);
    assert_matched_by_prefix(result, ["shadow_path", "stable_attrs"], "open Shadow DOM: expected shadow_path/internal evidence match");
  });

  it("closed Shadow DOM boundary resolves the host shell", () => {
    const context = build_closed_shadow_boundary_fixture();
    const locator = capture_locator(context.target as unknown as Element, { max_parent_depth: 6 });
    locator.evidence.boundary = {
      kind: "closed_shadow_root",
      target_scope: "boundary_shell",
      internal_target_supported: false,
      shell_selector: locator.primary.selector,
      reason: "Closed shadow root internals are inaccessible; mark the host shell.",
    };

    assert.equal(is_locator(locator), true, "closed Shadow DOM: invalid boundary locator");
    assert.equal(locator.evidence.tag, "secure-card");
    assert.equal(locator.evidence.shadow_path, undefined, "closed Shadow DOM: host shell must not expose internal shadow_path");
    assert_boundary(locator, "closed_shadow_root", "boundary_shell");

    const result = resolve(locator, context.root as unknown as Document) as ResolveResultWithElement;
    assert_resolve_result_contract(result, "support matrix closed Shadow DOM");
    assert.equal(result.locator_status, "resolved");
    assert.equal(result.element, context.target as unknown as Element);
    assert_matched_by_prefix(result, ["stable_attrs", "primary_selector"], "closed Shadow DOM: expected host shell match");
  });

  it("portal teleport uses actual DOM container for parent_chain and resolve", () => {
    const context = build_portal_teleport_fixture();
    const locator = capture_locator(context.target as unknown as Element, { max_parent_depth: 6 });

    assert.equal(is_locator(locator), true, "portal teleport: invalid locator");
    assert.equal(locator.evidence.parent_chain[0]?.stable_attr, "data-testid=portal-root", "portal teleport: parent_chain must reflect actual host container");
    assert.notEqual(locator.evidence.parent_chain[0]?.stable_attr, "data-testid=logical-owner", "portal teleport: logical owner must not replace actual DOM parent");

    const result = resolve(locator, context.root as unknown as Document) as ResolveResultWithElement;
    assert_resolve_result_contract(result, "support matrix portal teleport");
    assert.equal(result.locator_status, "resolved");
    assert.equal(result.element, context.target as unknown as Element);
    assert_matched_by_prefix(result, ["parent_chain", "stable_attrs"], "portal teleport: expected actual DOM evidence match");
  });

  it("nested scroll preserves viewport rect geometry for capture and resolve", () => {
    const context = build_nested_scroll_fixture();
    const locator = capture_locator(context.target as unknown as Element, { max_parent_depth: 6 });

    assert.equal(is_locator(locator), true, "nested scroll: invalid locator");
    assert.equal(locator.evidence.geometry?.x, 42);
    assert.equal(locator.evidence.geometry?.y, 320);
    assert.equal(locator.evidence.geometry?.viewport_width, 1280);
    assert.equal(locator.evidence.geometry?.viewport_height, 720);

    const result = resolve(locator, context.root as unknown as Document) as ResolveResultWithElement;
    assert_resolve_result_contract(result, "support matrix nested scroll");
    assert.equal(result.locator_status, "resolved");
    assert.equal(result.element, context.target as unknown as Element);
    assert_matched_by_prefix(result, ["geometry", "stable_attrs"], "nested scroll: expected geometry or stable evidence match");
  });
});

function fixtures(): Fixture[] {
  return [
    {
      name: "class hash changes",
      build: () => build_button_fixture({ className: "Button_root__a1b2 primary-cta", text: "Save changes" }),
      mutate: ({ target }) => target.setAttribute("class", "Button_root__z9y8 primary-cta"),
      root: ({ root }) => root,
      expectation: resolved_target(),
    },
    {
      name: "Tailwind utility noise",
      build: () => build_button_fixture({ className: "rounded bg-blue-600 text-white", text: "Publish" }),
      mutate: ({ target }) => target.setAttribute("class", "rounded bg-blue-600 text-white md:hover:bg-blue-700 focus:ring-2 px-4"),
      root: ({ root }) => root,
      expectation: resolved_target(),
    },
    {
      name: "text change",
      build: () => build_button_fixture({ className: "primary-cta", text: "Submit reimbursement request" }),
      mutate: ({ target }) => target.replaceText("Submit request"),
      root: ({ root }) => root,
      expectation: resolved_target(),
    },
    {
      name: "list insertion",
      build: build_list_fixture,
      mutate: ({ root, notes }) => {
        const list = must_element(notes?.list, "list");
        const inserted = root.createElement("li");
        inserted.setAttribute("data-row-id", "invoice-099");
        inserted.append(root.createTextNodeElement("Inserted invoice"));
        list.insertBefore(inserted, list.children[0] ?? null);
      },
      root: ({ root }) => root,
      expectation: resolved_target(),
    },
    {
      name: "parent container reorder",
      build: build_reorder_fixture,
      mutate: ({ notes }) => {
        const board = must_element(notes?.board, "board");
        const first = must_element(notes?.firstPanel, "firstPanel");
        board.append(first);
      },
      root: ({ root }) => root,
      expectation: resolved_target(),
    },
    {
      name: "open Shadow DOM",
      build: build_shadow_fixture,
      mutate: ({ target }) => target.setAttribute("class", "shadow-action hydrated"),
      root: ({ notes }) => must_shadow_root(notes?.shadowRoot, "shadowRoot"),
      expectation: resolved_target(),
      assert_locator: (locator) => assert.ok(locator.evidence.shadow_path?.length, "open Shadow DOM: expected shadow_path evidence"),
    },
    {
      name: "same-origin iframe frame_path contract",
      build: build_iframe_fixture,
      mutate: ({ target }) => target.setAttribute("data-state", "ready"),
      root: ({ root }) => root,
      expectation: resolved_target(),
      assert_locator: (locator, { root, notes }) => {
        const iframe = must_element(notes?.iframe, "iframe");
        const hidden_from_top_level = root.querySelectorAll('[data-testid="frame-action"]');
        assert.deepEqual(hidden_from_top_level, [], "same-origin iframe: top document querySelectorAll must not pierce iframe contentDocument");
        assert.ok(locator.frame_path?.length, "same-origin iframe: expected frame_path evidence");
        assert.equal(locator.frame_path[0]?.selector, '[data-testid=\"preview-frame\"]', "same-origin iframe: expected stable iframe selector in frame_path");
        assert.equal(root.querySelector(locator.frame_path[0]?.selector ?? ""), iframe, "same-origin iframe: frame_path selector must resolve the iframe shell from the top document");
      },
    },
    {
      name: "same-origin iframe frame document root contract",
      build: build_iframe_fixture,
      mutate: ({ target }) => target.setAttribute("data-state", "ready"),
      root: ({ notes }) => must_document(notes?.frameDocument, "frameDocument"),
      expectation: resolved_target(),
      assert_locator: (locator, { notes }) => {
        assert.ok(locator.frame_path?.length, "same-origin iframe direct root: expected frame_path evidence");
        assert.equal(must_document(notes?.frameDocument, "frameDocument").querySelector(locator.primary.selector), notes?.frameTarget ?? null);
      },
    },
    {
      name: "same-origin iframe bad top root remains lost",
      build: build_iframe_fixture,
      mutate: ({ target }) => target.setAttribute("data-state", "ready"),
      root: () => new FakeDocument(),
      expectation: {
        status: "lost",
        target_should_be_top_1: false,
        counts_for_top_1: false,
        counts_for_false_resolved: true,
        counts_for_ambiguity: false,
        counts_for_classification: true,
      },
      assert_locator: (locator) => assert.ok(locator.frame_path?.length, "same-origin iframe bad root: expected frame_path evidence"),
    },
    {
      name: "SVG",
      build: build_svg_fixture,
      mutate: ({ target }) => target.setAttribute("class", "node selected active"),
      root: ({ root }) => root,
      expectation: resolved_target(),
    },
    {
      name: "nested scroll",
      build: build_nested_scroll_fixture,
      mutate: ({ target, notes }) => {
        must_element(notes?.scroller, "scroller").scrollTop = 180;
        target.setRect({ x: 42, y: 260, width: 120, height: 32 });
      },
      root: ({ root }) => root,
      expectation: resolved_target(),
    },
    {
      name: "implicit role aria-label recovery",
      build: build_implicit_aria_label_fixture,
      mutate: ({ root, notes }) => {
        const wrapper = must_element(notes?.wrapper, "wrapper");
        const duplicate = root.createElement("button");
        duplicate.setAttribute("aria-label", "Delete");
        wrapper.insertBefore(duplicate, wrapper.children[0] ?? null);
      },
      root: ({ root }) => root,
      expectation: resolved_target(),
      assert_locator: (locator) => {
        assert.equal(locator.evidence.role, "button", "implicit role aria-label recovery: expected implicit button role evidence");
        assert.equal(locator.evidence.accessible_name, "Archive", "implicit role aria-label recovery: expected accessible_name evidence");
        assert.equal(locator.evidence.text?.normalized, undefined, "implicit role aria-label recovery: expected no visible text evidence");
        locator.primary = { selector: "[data-missing='archive']", strategy: "stable_attr" };
        locator.alternates = [{ selector: "body > main:nth-of-type(1) > button:nth-of-type(2)", strategy: "nth_path" }];
        locator.evidence.nth_path = "body > main:nth-of-type(1) > button:nth-of-type(2)";
        delete locator.evidence.geometry;
      },
    },
    {
      name: "duplicate evidence ambiguity downgrade",
      build: build_ambiguity_fixture,
      mutate: ({ root, target }) => {
        const duplicate = root.createElement("button");
        duplicate.setAttribute("data-testid", target.getAttribute("data-testid") ?? "duplicate-action");
        duplicate.setAttribute("role", "button");
        duplicate.setAttribute("aria-label", target.getAttribute("aria-label") ?? "Approve invoice");
        duplicate.replaceText(target.textContent ?? "Approve invoice");
        root.body.append(duplicate);
      },
      root: ({ root }) => root,
      expectation: ambiguity_downgrade("close_score"),
    },
    {
      name: "close score ambiguity downgrade",
      build: build_close_score_ambiguity_fixture,
      mutate: ({ root, target }) => {
        const peer = root.createElement("button");
        peer.setAttribute("role", "button");
        peer.setAttribute("aria-label", target.getAttribute("aria-label") ?? "Approve payout");
        peer.setAttribute("class", target.getAttribute("class") ?? "workflow-action");
        peer.setRect({ x: 28, y: 40, width: 148, height: 36 });
        peer.replaceText(target.textContent ?? "Approve payout");
        root.body.append(peer);
      },
      root: ({ root }) => root,
      expectation: ambiguity_downgrade("close_score"),
    },
    {
      name: "duplicate stable evidence ambiguity downgrade",
      build: build_duplicate_evidence_ambiguity_fixture,
      mutate: ({ root, target }) => {
        const duplicate = root.createElement("button");
        duplicate.setAttribute("data-testid", target.getAttribute("data-testid") ?? "archive-report");
        duplicate.setAttribute("role", "button");
        duplicate.setAttribute("aria-label", target.getAttribute("aria-label") ?? "Archive report");
        duplicate.setRect({ x: 420, y: 280, width: 144, height: 36 });
        root.body.append(duplicate);
      },
      root: ({ root }) => root,
      expectation: ambiguity_downgrade("duplicate_evidence"),
    },
    {
      name: "removed target lost classification",
      build: () => build_button_fixture({ className: "danger-action", text: "Delete draft" }),
      mutate: ({ target }) => target.remove(),
      root: ({ root }) => root,
      expectation: lost_target(),
    },
    {
      name: "removed shadow target lost classification",
      build: build_shadow_fixture,
      mutate: ({ target }) => target.remove(),
      root: ({ notes }) => must_shadow_root(notes?.shadowRoot, "shadowRoot"),
      expectation: lost_target(),
    },
    {
      name: "removed iframe target lost classification",
      build: build_iframe_fixture,
      mutate: ({ target }) => target.remove(),
      root: ({ root }) => root,
      expectation: lost_target(),
    },
    {
      name: "removed SVG target lost classification",
      build: build_svg_fixture,
      mutate: ({ target }) => target.remove(),
      root: ({ root }) => root,
      expectation: lost_target(),
    },
  ];
}

function resolved_target(): FixtureExpectation {
  return {
    status: "resolved",
    target_should_be_top_1: true,
    counts_for_top_1: true,
    counts_for_false_resolved: false,
    counts_for_ambiguity: false,
    counts_for_classification: false,
  };
}

function ambiguity_downgrade(expected_ambiguity_reason: "close_score" | "duplicate_evidence"): FixtureExpectation {
  return {
    status: "drifted",
    target_should_be_top_1: false,
    counts_for_top_1: false,
    counts_for_false_resolved: false,
    counts_for_ambiguity: true,
    counts_for_classification: true,
    expected_ambiguity_reason,
  };
}

function lost_target(): FixtureExpectation {
  return {
    status: "lost",
    target_should_be_top_1: false,
    counts_for_top_1: false,
    counts_for_false_resolved: true,
    counts_for_ambiguity: false,
    counts_for_classification: true,
  };
}

function compute_metrics(outcomes: Outcome[]): {
  top_1_target_accuracy: number;
  false_resolved_rate: number;
  ambiguity_downgrade_correctness: number;
  offline_drift_lost_classification: number;
} {
  const top1 = outcomes.filter((outcome) => outcome.expected.counts_for_top_1);
  const falseResolved = outcomes.filter((outcome) => outcome.expected.counts_for_false_resolved);
  const ambiguous = outcomes.filter((outcome) => outcome.expected.counts_for_ambiguity);
  const driftLost = outcomes.filter((outcome) => outcome.expected.counts_for_classification);

  return {
    top_1_target_accuracy: ratio(top1.filter((outcome) => outcome.top_1_correct).length, top1.length),
    false_resolved_rate: ratio(falseResolved.filter((outcome) => outcome.result.locator_status === "resolved").length, falseResolved.length),
    ambiguity_downgrade_correctness: ratio(
      ambiguous.filter((outcome) => outcome.result.locator_status === "drifted" && outcome.result.ambiguity !== undefined).length,
      ambiguous.length,
    ),
    offline_drift_lost_classification: ratio(
      driftLost.filter((outcome) => outcome.result.locator_status === outcome.expected.status).length,
      driftLost.length,
    ),
  };
}

function ratio(numerator: number, denominator: number): number {
  assert.notEqual(denominator, 0, "metric denominator must not be zero");
  return numerator / denominator;
}

function assert_resolve_result_contract(result: ResolveResultWithElement, fixtureName: string): void {
  const { element: _element, downgrade_reason: _downgradeReason, ...wireResult } = result;
  assert.equal(is_resolve_result(wireResult), true, `${fixtureName}: invalid ResolveResult wire fields`);
  assert.ok(result.confidence >= 0 && result.confidence <= 1, `${fixtureName}: confidence out of range`);
  assert.ok(Number.isInteger(result.candidates_considered), `${fixtureName}: candidates_considered must be an integer`);
  assert.ok(result.candidates_considered >= 0, `${fixtureName}: candidates_considered must be non-negative`);
  assert.ok(result.matched_by.length > 0, `${fixtureName}: matched_by must not be empty`);
  assert.notDeepEqual(result.matched_by, ["score"], `${fixtureName}: matched_by must not only be score`);
  assert.ok(
    result.matched_by.every(is_explainable_match_reason),
    `${fixtureName}: matched_by contains non-explainable evidence: ${result.matched_by.join(",")}`,
  );
}

function is_explainable_match_reason(reason: string): boolean {
  if (EXPLAINABLE_MATCH_REASONS[reason] === true) return true;
  return Object.keys(EXPLAINABLE_MATCH_REASONS).some((prefix) => reason === prefix || reason.startsWith(`${prefix}:`) || reason.startsWith(`${prefix}_`));
}

function assert_matched_by_prefix(result: ResolveResultWithElement, prefixes: readonly string[], message: string): void {
  assert.ok(result.matched_by.some((reason) => prefixes.some((prefix) => reason === prefix || reason.startsWith(`${prefix}:`) || reason.startsWith(`${prefix}_`))), message);
}

function assert_boundary(locator: Locator, kind: BoundaryKind, target_scope: "boundary_shell"): void {
  assert.equal(locator.evidence.boundary?.kind, kind);
  assert.equal(locator.evidence.boundary?.target_scope, target_scope);
  assert.equal(locator.evidence.boundary?.internal_target_supported, false);
  assert.ok(locator.evidence.boundary?.shell_selector, `${kind}: expected shell_selector`);
}

function build_button_fixture(input: { className: string; text: string }): FixtureContext {
  const root = new FakeDocument();
  const wrapper = root.createElement("main");
  wrapper.setAttribute("data-testid", "settings-panel");
  const target = root.createElement("button");
  target.setAttribute("data-testid", "primary-action");
  target.setAttribute("data-action", "save");
  target.setAttribute("role", "button");
  target.setAttribute("aria-label", input.text);
  target.setAttribute("class", input.className);
  target.setRect({ x: 24, y: 40, width: 144, height: 36 });
  target.replaceText(input.text);
  wrapper.append(target);
  root.body.append(wrapper);
  return { root, target, notes: { wrapper } };
}

function build_list_fixture(): FixtureContext {
  const root = new FakeDocument();
  const list = root.createElement("ol");
  list.setAttribute("data-testid", "invoice-list");
  let target = root.createElement("button");

  for (const id of ["invoice-101", "invoice-102", "invoice-103"]) {
    const item = root.createElement("li");
    item.setAttribute("data-row-id", id);
    const button = root.createElement("button");
    button.setAttribute("data-testid", `pay-${id}`);
    button.setAttribute("aria-label", `Pay ${id}`);
    button.replaceText(`Pay ${id}`);
    item.append(button);
    list.append(item);
    if (id === "invoice-102") target = button;
  }

  root.body.append(list);
  return { root, target, notes: { list } };
}

function build_reorder_fixture(): FixtureContext {
  const root = new FakeDocument();
  const board = root.createElement("section");
  board.setAttribute("data-testid", "dashboard-board");
  const firstPanel = root.createElement("article");
  firstPanel.setAttribute("data-panel", "summary");
  const secondPanel = root.createElement("article");
  secondPanel.setAttribute("data-panel", "actions");
  const target = root.createElement("button");
  target.setAttribute("data-testid", "reorder-safe-action");
  target.setAttribute("aria-label", "Refresh metrics");
  target.replaceText("Refresh metrics");
  secondPanel.append(target);
  board.append(firstPanel, secondPanel);
  root.body.append(board);
  return { root, target, notes: { board, firstPanel, secondPanel } };
}

function build_shadow_fixture(): FixtureContext {
  const root = new FakeDocument();
  const host = root.createElement("loupe-card");
  host.setAttribute("data-testid", "shadow-host");
  const shadowRoot = host.attachShadow({ mode: "open" });
  const target = root.createElement("button");
  target.setAttribute("data-testid", "shadow-action");
  target.setAttribute("aria-label", "Shadow save");
  target.setAttribute("class", "shadow-action");
  target.replaceText("Shadow save");
  shadowRoot.append(target);
  root.body.append(host);
  return { root, target, notes: { host, shadowRoot } };
}

function build_iframe_fixture(): FixtureContext {
  const root = new FakeDocument();
  const iframe = root.createElement("iframe");
  iframe.setAttribute("data-testid", "preview-frame");
  const frameDocument = new FakeDocument(iframe);
  iframe.contentDocument = frameDocument;
  root.body.append(iframe);

  const target = frameDocument.createElement("button");
  target.setAttribute("data-testid", "frame-action");
  target.setAttribute("aria-label", "Frame save");
  target.replaceText("Frame save");
  frameDocument.body.append(target);
  return { root, target, notes: { iframe, frameDocument, frameTarget: target } };
}

function build_cross_origin_iframe_boundary_fixture(): FixtureContext {
  const root = new FakeDocument();
  const target = root.createElement("iframe");
  target.setAttribute("data-testid", "cross-origin-frame");
  target.setAttribute("title", "Billing provider");
  target.setRect({ x: 12, y: 80, width: 640, height: 480 });
  root.body.append(target);
  return { root, target };
}

function build_canvas_boundary_fixture(): FixtureContext {
  const root = new FakeDocument();
  const target = root.createElement("canvas");
  target.setAttribute("data-testid", "sales-chart");
  target.setAttribute("aria-label", "Sales chart");
  target.setRect({ x: 32, y: 120, width: 480, height: 240 });
  root.body.append(target);
  return { root, target };
}

function build_closed_shadow_boundary_fixture(): FixtureContext {
  const root = new FakeDocument();
  const target = root.createElement("secure-card");
  target.setAttribute("data-testid", "closed-shadow-host");
  target.setAttribute("aria-label", "Secure card");
  target.setRect({ x: 18, y: 72, width: 320, height: 180 });
  root.body.append(target);
  return { root, target };
}

function build_svg_fixture(): FixtureContext {
  const root = new FakeDocument();
  const svg = root.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("data-testid", "chart");
  const group = root.createElementNS("http://www.w3.org/2000/svg", "g");
  group.setAttribute("data-series", "revenue");
  const target = root.createElementNS("http://www.w3.org/2000/svg", "circle");
  target.setAttribute("data-point-id", "q4-revenue");
  target.setAttribute("aria-label", "Q4 revenue point");
  target.setAttribute("class", "node selected");
  group.append(target);
  svg.append(group);
  root.body.append(svg);
  return { root, target, notes: { svg, group } };
}

function build_svg_text_fixture(): FixtureContext {
  const root = new FakeDocument();
  const svg = root.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("data-testid", "chart");
  const target = root.createElementNS("http://www.w3.org/2000/svg", "text");
  target.setAttribute("data-testid", "q4-revenue-label");
  target.setAttribute("class", "axis-label");
  target.setRect({ x: 96, y: 48, width: 84, height: 18 });
  target.replaceText("Q4 revenue");
  svg.append(target);
  root.body.append(svg);
  return { root, target, notes: { svg } };
}

function build_nested_scroll_fixture(): FixtureContext {
  const root = new FakeDocument();
  const outer = root.createElement("section");
  outer.setAttribute("data-testid", "outer-scroll");
  outer.scrollTop = 120;
  const scroller = root.createElement("div");
  scroller.setAttribute("data-testid", "inner-scroll");
  scroller.scrollTop = 80;
  const target = root.createElement("button");
  target.setAttribute("data-testid", "nested-scroll-action");
  target.setAttribute("aria-label", "Reveal nested row");
  target.setRect({ x: 42, y: 320, width: 120, height: 32 });
  target.replaceText("Reveal nested row");
  scroller.append(target);
  outer.append(scroller);
  root.body.append(outer);
  return { root, target, notes: { outer, scroller } };
}

function build_portal_teleport_fixture(): FixtureContext {
  const root = new FakeDocument();
  const logicalOwner = root.createElement("section");
  logicalOwner.setAttribute("data-testid", "logical-owner");
  const portalRoot = root.createElement("div");
  portalRoot.setAttribute("data-testid", "portal-root");
  const target = root.createElement("button");
  target.setAttribute("data-testid", "teleported-action");
  target.setAttribute("aria-label", "Open command palette");
  target.replaceText("Open command palette");
  portalRoot.append(target);
  root.body.append(logicalOwner, portalRoot);
  return { root, target, notes: { logicalOwner, portalRoot } };
}

function build_implicit_aria_label_fixture(): FixtureContext {
  const root = new FakeDocument();
  const wrapper = root.createElement("main");
  wrapper.setAttribute("data-testid", "archive-actions");
  const decoy = root.createElement("button");
  decoy.setAttribute("aria-label", "Archive decoy");
  const target = root.createElement("button");
  target.setAttribute("aria-label", "Archive");
  target.setRect({ x: 24, y: 40, width: 96, height: 36 });
  wrapper.append(decoy, target);
  root.body.append(wrapper);
  return { root, target, notes: { wrapper, decoy } };
}

function build_ambiguity_fixture(): FixtureContext {
  const root = new FakeDocument();
  const target = root.createElement("button");
  target.setAttribute("data-testid", "ambiguous-action");
  target.setAttribute("role", "button");
  target.setAttribute("aria-label", "Approve invoice");
  target.replaceText("Approve invoice");
  root.body.append(target);
  return { root, target };
}

function build_close_score_ambiguity_fixture(): FixtureContext {
  const root = new FakeDocument();
  const target = root.createElement("button");
  target.setAttribute("role", "button");
  target.setAttribute("aria-label", "Approve payout");
  target.setAttribute("class", "workflow-action");
  target.setRect({ x: 24, y: 40, width: 148, height: 36 });
  target.replaceText("Approve payout");
  root.body.append(target);
  return { root, target };
}

function build_duplicate_evidence_ambiguity_fixture(): FixtureContext {
  const root = new FakeDocument();
  const target = root.createElement("button");
  target.setAttribute("data-testid", "archive-report");
  target.setAttribute("role", "button");
  target.setAttribute("aria-label", "Archive report");
  target.setAttribute("class", "archive-primary");
  target.setRect({ x: 24, y: 40, width: 144, height: 36 });
  root.body.append(target);
  return { root, target };
}

function must_element(value: FakeElement | FakeDocument | FakeShadowRoot | undefined, name: string): FakeElement {
  assert.ok(value instanceof FakeElement, `${name} must be a FakeElement`);
  return value;
}

function must_shadow_root(value: FakeElement | FakeDocument | FakeShadowRoot | undefined, name: string): FakeShadowRoot {
  assert.ok(value instanceof FakeShadowRoot, `${name} must be a FakeShadowRoot`);
  return value;
}
function must_document(value: FakeElement | FakeDocument | FakeShadowRoot | undefined, name: string): FakeDocument {
  assert.ok(value instanceof FakeDocument, `${name} must be a FakeDocument`);
  return value;
}

install_offline_dom_globals();
