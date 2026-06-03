import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  can_inject_content_root,
  install_content_root,
  is_extension_host_eligible,
  is_loupe_extension_element,
  is_picker_candidate,
  LOUPE_EXTENSION_PAGE_EXPOSURE,
  LOUPE_EXTENSION_ROOT_ID,
  origin_permission_pattern,
  page_bridge_exposure,
  type ContentHostAuthorizationState,
} from "./content.js";

describe("content page_bridge_exposure", () => {
  it("returns the frozen exposure object", () => {
    const exposure = page_bridge_exposure();
    assert.equal(exposure, LOUPE_EXTENSION_PAGE_EXPOSURE);
    assert.equal(exposure.exposes_token_to_page, false);
    assert.equal(exposure.exposes_page_window_api, false);
    assert.equal(exposure.bridge_nonce_readonly, true);
    assert.ok(Object.isFrozen(exposure));
  });
});

describe("content is_extension_host_eligible", () => {
  it("accepts http origins", () => {
    assert.equal(is_extension_host_eligible("http://localhost:5173"), true);
    assert.equal(is_extension_host_eligible("http://127.0.0.1:4172"), true);
  });

  it("accepts https origins", () => {
    assert.equal(is_extension_host_eligible("https://app.example.test"), true);
    assert.equal(is_extension_host_eligible("https://example.com"), true);
  });

  it("rejects chrome:// origins", () => {
    assert.equal(is_extension_host_eligible("chrome://extensions"), false);
  });

  it("rejects chrome-extension:// origins", () => {
    assert.equal(is_extension_host_eligible("chrome-extension://abcdefghijklmnop"), false);
  });

  it("rejects file:// origins", () => {
    assert.equal(is_extension_host_eligible("file:///home/user/page.html"), false);
  });

  it("rejects empty string", () => {
    assert.equal(is_extension_host_eligible(""), false);
  });

  it("rejects invalid URL", () => {
    assert.equal(is_extension_host_eligible("not-a-url"), false);
  });

  it("rejects origin with trailing path", () => {
    assert.equal(is_extension_host_eligible("https://example.com/path"), false);
  });
});

describe("content origin_permission_pattern", () => {
  it("returns wildcard pattern for eligible http origin", () => {
    assert.equal(origin_permission_pattern("http://localhost:5173"), "http://localhost:5173/*");
  });

  it("returns wildcard pattern for eligible https origin", () => {
    assert.equal(origin_permission_pattern("https://app.example.test"), "https://app.example.test/*");
  });

  it("returns undefined for ineligible origin", () => {
    assert.equal(origin_permission_pattern("chrome://extensions"), undefined);
  });

  it("returns undefined for invalid URL", () => {
    assert.equal(origin_permission_pattern("not-a-url"), undefined);
  });

  it("returns undefined for empty string", () => {
    assert.equal(origin_permission_pattern(""), undefined);
  });
});

describe("content is_loupe_extension_element", () => {
  it("returns false for non-objects", () => {
    assert.equal(is_loupe_extension_element(null), false);
    assert.equal(is_loupe_extension_element(undefined), false);
    assert.equal(is_loupe_extension_element("string"), false);
    assert.equal(is_loupe_extension_element(42), false);
  });

  it("returns false for objects without nodeType 1", () => {
    assert.equal(is_loupe_extension_element({ nodeType: 3 }), false);
    assert.equal(is_loupe_extension_element({}), false);
  });

  it("returns true for element with Loupe root id", () => {
    assert.equal(is_loupe_extension_element({ nodeType: 1, id: LOUPE_EXTENSION_ROOT_ID, dataset: {} }), true);
  });

  it("returns true for element with loupeRoot dataset", () => {
    assert.equal(is_loupe_extension_element({ nodeType: 1, dataset: { loupeRoot: "true" } }), true);
  });

  it("returns true for element with loupePhase dataset", () => {
    assert.equal(is_loupe_extension_element({ nodeType: 1, dataset: { loupePhase: "phase_0_placeholder" } }), true);
  });

  it("returns false for regular element without loupe markers", () => {
    assert.equal(is_loupe_extension_element({ nodeType: 1, id: "other", dataset: {} }), false);
  });
});

describe("content is_picker_candidate", () => {
  it("returns false for non-element values", () => {
    assert.equal(is_picker_candidate(null), false);
    assert.equal(is_picker_candidate("string"), false);
    assert.equal(is_picker_candidate(42), false);
  });

  it("returns false for loupe extension elements", () => {
    assert.equal(is_picker_candidate({ nodeType: 1, id: LOUPE_EXTENSION_ROOT_ID, dataset: {} }), false);
  });

  it("returns true for regular elements", () => {
    assert.equal(is_picker_candidate({ nodeType: 1, id: "app", dataset: {} }), true);
  });

  it("returns false for elements inside a loupe shadow root host", () => {
    const loupeHost = { nodeType: 1, id: LOUPE_EXTENSION_ROOT_ID, dataset: {} };
    const shadowRoot = { host: loupeHost };
    const element = { nodeType: 1, id: "child", dataset: {}, getRootNode: () => shadowRoot };
    assert.equal(is_picker_candidate(element), false);
  });

  it("returns true for elements inside a non-loupe shadow root", () => {
    const regularHost = { nodeType: 1, id: "other-host", dataset: {} };
    const shadowRoot = { host: regularHost };
    const element = { nodeType: 1, id: "child", dataset: {}, getRootNode: () => shadowRoot };
    assert.equal(is_picker_candidate(element), true);
  });

  it("returns true when getRootNode returns undefined", () => {
    const element = { nodeType: 1, id: "child", dataset: {}, getRootNode: () => undefined };
    assert.equal(is_picker_candidate(element), true);
  });
});

describe("content can_inject_content_root", () => {
  it("returns false when authorization state is undefined", () => {
    assert.equal(can_inject_content_root(undefined), false);
  });

  it("returns false when not authorized", () => {
    assert.equal(can_inject_content_root({ authorized: false }), false);
  });

  it("returns true when authorized", () => {
    assert.equal(can_inject_content_root({ authorized: true }), true);
  });
});

describe("content install_content_root", () => {
  type MockElement = {
    id?: string;
    hidden?: boolean;
    textContent?: string;
    style: Record<string, string>;
    dataset: Record<string, string | undefined>;
    attachShadow: (init: { mode: "closed" }) => { append: (node: unknown) => void };
    append: (node: unknown) => void;
  };

  function createMockDocument(existingRoot?: boolean) {
    const appended: unknown[] = [];
    const created: MockElement[] = [];

    const doc = {
      getElementById(id: string): unknown {
        if (existingRoot && id === LOUPE_EXTENSION_ROOT_ID) return {};
        return null;
      },
      createElement(_tag: string): MockElement {
        const shadowChildren: unknown[] = [];
        const el: MockElement = {
          style: {},
          dataset: {},
          attachShadow: (_init: { mode: "closed" }) => ({
            append: (node: unknown) => shadowChildren.push(node),
          }),
          append: (_node: unknown) => {},
        };
        created.push(el);
        return el;
      },
      documentElement: {
        append: (node: unknown) => appended.push(node),
      },
    };

    return { doc, appended, created };
  }

  it("installs root element when authorized and no existing root", () => {
    const { doc, appended, created } = createMockDocument(false);
    const authorized: ContentHostAuthorizationState = { authorized: true };

    const result = install_content_root(doc, authorized);

    assert.equal(result, true);
    assert.equal(appended.length, 1);
    assert.equal(created.length >= 1, true);
    const root = created[0]!;
    assert.equal(root.id, LOUPE_EXTENSION_ROOT_ID);
    assert.equal(root.hidden, true);
    assert.equal(root.dataset.loupeRoot, "true");
    assert.equal(root.dataset.exposesTokenToPage, "false");
    assert.equal(root.dataset.exposesPageWindowApi, "false");
    assert.equal(root.style?.pointerEvents, "none");
  });

  it("returns false when not authorized", () => {
    const { doc } = createMockDocument(false);
    const result = install_content_root(doc, { authorized: false });
    assert.equal(result, false);
  });

  it("returns false when authorization state is undefined", () => {
    const { doc } = createMockDocument(false);
    const result = install_content_root(doc, undefined);
    assert.equal(result, false);
  });

  it("returns false when root element already exists", () => {
    const { doc, appended } = createMockDocument(true);
    const result = install_content_root(doc, { authorized: true });
    assert.equal(result, false);
    assert.equal(appended.length, 0);
  });

  it("returns false when document is undefined", () => {
    const result = install_content_root(undefined, { authorized: true });
    assert.equal(result, false);
  });
});
