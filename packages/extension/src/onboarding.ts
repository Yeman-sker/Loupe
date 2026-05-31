export const ONBOARDING_BRANCH_IDS = Object.freeze({
  CLAUDE_PLUGIN_DETECTED: "claude_plugin_detected",
  GENERIC_MCP_CLIENT: "generic_mcp_client",
  NO_MCP: "no_mcp",
  HOST_NOT_AUTHORIZED: "host_not_authorized",
  DAEMON_OFFLINE: "daemon_offline",
} as const);

export type OnboardingBranchId = (typeof ONBOARDING_BRANCH_IDS)[keyof typeof ONBOARDING_BRANCH_IDS];

export type OnboardingInput = Readonly<{
  host_authorized: boolean;
  daemon_online: boolean;
  claude_plugin_detected: boolean;
  mcp_client_detected: boolean;
  mcp_url: string;
  origin_permission_pattern?: string;
}>;

export type OnboardingOutput = Readonly<{
  branch_id: OnboardingBranchId;
  message: string;
  primary_action_label: string;
  marking_blocked: boolean;
  allows_local_only_marking: boolean;
}>;

export const CLAUDE_PLUGIN_MESSAGE = "按 ⌥L 标记元素，然后在 Claude 中运行 /loupe:marks";
export const GENERIC_MCP_CLIENT_MESSAGE_PREFIX = "将 MCP 客户端连接到 Loupe daemon：";
export const GENERIC_MCP_CLIENT_MESSAGE_SUFFIX = "，并在客户端配置 Authorization Bearer token。";
export const NO_MCP_MESSAGE = "未检测到 MCP 客户端。可继续标记元素，并使用 Copy Markdown 复制本地标记。";
export const HOST_NOT_AUTHORIZED_MESSAGE_PREFIX = "当前 host 未授权。请通过 chrome.permissions.request 授权：";
export const DAEMON_OFFLINE_MESSAGE = "Loupe daemon 未在线。运行 loupe init，或等待 Claude 插件自动启动；标记仍可本地保存。";

export function compute_onboarding_state(input: OnboardingInput): OnboardingOutput {
  if (!input.host_authorized) {
    return {
      branch_id: ONBOARDING_BRANCH_IDS.HOST_NOT_AUTHORIZED,
      message: `${HOST_NOT_AUTHORIZED_MESSAGE_PREFIX}${input.origin_permission_pattern ?? "<origin>/*"}`,
      primary_action_label: "授权当前 host",
      marking_blocked: true,
      allows_local_only_marking: false,
    };
  }

  if (!input.daemon_online) {
    return {
      branch_id: ONBOARDING_BRANCH_IDS.DAEMON_OFFLINE,
      message: DAEMON_OFFLINE_MESSAGE,
      primary_action_label: "保存本地标记",
      marking_blocked: false,
      allows_local_only_marking: true,
    };
  }

  if (input.claude_plugin_detected) {
    return {
      branch_id: ONBOARDING_BRANCH_IDS.CLAUDE_PLUGIN_DETECTED,
      message: CLAUDE_PLUGIN_MESSAGE,
      primary_action_label: "开始标记",
      marking_blocked: false,
      allows_local_only_marking: false,
    };
  }

  if (input.mcp_client_detected) {
    return {
      branch_id: ONBOARDING_BRANCH_IDS.GENERIC_MCP_CLIENT,
      message: `${GENERIC_MCP_CLIENT_MESSAGE_PREFIX}${input.mcp_url}${GENERIC_MCP_CLIENT_MESSAGE_SUFFIX}`,
      primary_action_label: "复制 MCP 配置",
      marking_blocked: false,
      allows_local_only_marking: false,
    };
  }

  return {
    branch_id: ONBOARDING_BRANCH_IDS.NO_MCP,
    message: NO_MCP_MESSAGE,
    primary_action_label: "Copy Markdown",
    marking_blocked: false,
    allows_local_only_marking: true,
  };
}
