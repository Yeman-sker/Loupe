import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { bootstrap_content_root, can_inject_content_root, install_content_root, LOUPE_EXTENSION_ROOT_ID } from "./content.js";
import {
  CLAUDE_PLUGIN_MESSAGE,
  DAEMON_OFFLINE_MESSAGE,
  GENERIC_MCP_CLIENT_MESSAGE_PREFIX,
  GENERIC_MCP_CLIENT_MESSAGE_SUFFIX,
  HOST_NOT_AUTHORIZED_MESSAGE_PREFIX,
  NO_MCP_MESSAGE,
  ONBOARDING_BRANCH_IDS,
  compute_onboarding_state,
  type OnboardingInput,
} from "./onboarding.js";

describe("Phase 5 onboarding state", () => {
  it("uses Claude plugin guidance when plugin is detected", () => {
    assert.deepEqual(compute_onboarding_state(base_input({ claude_plugin_detected: true })), {
      branch_id: ONBOARDING_BRANCH_IDS.CLAUDE_PLUGIN_DETECTED,
      message: CLAUDE_PLUGIN_MESSAGE,
      primary_action_label: "开始标记",
      marking_blocked: false,
      allows_local_only_marking: false,
    });
  });

  it("uses generic MCP configuration guidance when a non-Claude MCP client is detected", () => {
    const mcp_url = "http://127.0.0.1:7373/mcp";

    assert.deepEqual(compute_onboarding_state(base_input({ mcp_client_detected: true, mcp_url })), {
      branch_id: ONBOARDING_BRANCH_IDS.GENERIC_MCP_CLIENT,
      message: `${GENERIC_MCP_CLIENT_MESSAGE_PREFIX}${mcp_url}${GENERIC_MCP_CLIENT_MESSAGE_SUFFIX}`,
      primary_action_label: "复制 MCP 配置",
      marking_blocked: false,
      allows_local_only_marking: false,
    });
  });

  it("allows local-only marking and Copy Markdown when no MCP client is detected", () => {
    assert.deepEqual(compute_onboarding_state(base_input()), {
      branch_id: ONBOARDING_BRANCH_IDS.NO_MCP,
      message: NO_MCP_MESSAGE,
      primary_action_label: "Copy Markdown",
      marking_blocked: false,
      allows_local_only_marking: true,
    });
  });

  it("blocks marking and shows chrome.permissions.request guidance when host is not authorized", () => {
    const origin_permission_pattern = "https://app.example.test/*";

    assert.deepEqual(compute_onboarding_state(base_input({ host_authorized: false, origin_permission_pattern })), {
      branch_id: ONBOARDING_BRANCH_IDS.HOST_NOT_AUTHORIZED,
      message: `${HOST_NOT_AUTHORIZED_MESSAGE_PREFIX}${origin_permission_pattern}`,
      primary_action_label: "授权当前 host",
      marking_blocked: true,
      allows_local_only_marking: false,
    });
  });

  it("allows local-only marking when daemon is offline", () => {
    assert.deepEqual(compute_onboarding_state(base_input({ daemon_online: false })), {
      branch_id: ONBOARDING_BRANCH_IDS.DAEMON_OFFLINE,
      message: DAEMON_OFFLINE_MESSAGE,
      primary_action_label: "保存本地标记",
      marking_blocked: false,
      allows_local_only_marking: true,
    });
  });
});

describe("Phase 5 content host authorization gating", () => {
  it("does not inject the content root when host authorization is absent", () => {
    const document = new FakeDocument();

    assert.equal(can_inject_content_root({ authorized: false }), false);
    assert.equal(install_content_root(document, { authorized: false }), false);
    assert.equal(document.getElementById(LOUPE_EXTENSION_ROOT_ID), null);

    assert.equal(can_inject_content_root(), false);
    assert.equal(install_content_root(document), false);
    assert.equal(document.getElementById(LOUPE_EXTENSION_ROOT_ID), null);
  });

  it("does not inject the content root on unauthorized runtime bootstrap", async () => {
    const document = new FakeDocument();
    const chrome = {
      runtime: {
        sendMessage(message: unknown, response_callback: (response: unknown) => void) {
          assert.deepEqual(message, { type: "loupe.origin_auth.get", origin: "https://app.example.test" });
          response_callback({ ok: true, authorized: false });
        },
      },
    };

    assert.equal(await bootstrap_content_root({ chrome, document, location: { origin: "https://app.example.test" } }), false);
    assert.equal(document.getElementById(LOUPE_EXTENSION_ROOT_ID), null);
  });

  it("preserves explicit authorized content root injection for pure tests", () => {
    const document = new FakeDocument();

    assert.equal(can_inject_content_root({ authorized: true }), true);
    assert.equal(install_content_root(document, { authorized: true }), true);
    assert.ok(document.getElementById(LOUPE_EXTENSION_ROOT_ID));
  });
});

function base_input(overrides: Partial<OnboardingInput> = {}): OnboardingInput {
  return {
    host_authorized: true,
    daemon_online: true,
    claude_plugin_detected: false,
    mcp_client_detected: false,
    mcp_url: "http://127.0.0.1:7373/mcp",
    ...overrides,
  };
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
