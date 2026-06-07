export type Kind = "bug" | "copy" | "style" | "layout" | "question" | "other";

export const KINDS: Kind[] = ["bug", "copy", "style", "layout", "question", "other"];

// A mark created inside the demo sandbox. Mirrors the product's mark shape but
// trimmed to what the happy-path demo needs.
export type DemoMark = {
  id: string;
  num: number;
  hostId: string;
  kind: Kind;
  comment: string;
  task: "open" | "done";
  targetTag: string;
  targetSel: string;
  targetName: string;
};

// Low-noise AgentMark payload (PRD §11.1 shape) — what the agent reads over MCP.
// Demo-generated from the visitor's real mark; not a live engine.
export type AgentMark = {
  id: string;
  project: {
    project_id: string;
    workspace_root_hash: string;
    branch: string;
    url: string;
    route_key: string;
    session_id: string;
  };
  intent: { comment: string; kind: string };
  target: {
    selector: string;
    selector_preview: string;
    tag: string;
    text?: string;
    locator_status: "resolved";
    confidence: number;
    matched_by: string[];
  };
  framework: { name: string; component: string };
  media: { has_screenshot: boolean };
  lifecycle: {
    task_status: "open" | "resolved";
    created_at: string;
    updated_at: string;
  };
};

const FRAMEWORK_HINT: Record<string, { component: string }> = {
  title: { component: "AccountSettings/PageTitle" },
  sub: { component: "AccountSettings/PageSubtitle" },
  upgrade: { component: "Billing/UpgradeButton" },
  banner: { component: "Billing/PlanBanner" },
  "f-name": { component: "Profile/NameField" },
  "f-email": { component: "Profile/EmailField" },
  save: { component: "Profile/SaveButton" },
  "nav-set": { component: "Nav/SettingsLink" },
};

export function buildAgentMark(m: DemoMark): AgentMark {
  const now = new Date().toISOString();
  const fw = FRAMEWORK_HINT[m.hostId] ?? { component: "App/Unknown" };
  const cleanName = m.targetName.replace(/[“”"]/g, "");
  return {
    id: m.id,
    project: {
      project_id: "app-web",
      workspace_root_hash: "b1f4c0a9",
      branch: "main",
      url: "https://app.acme.com/settings",
      route_key: "/settings",
      session_id: "9c2e7af0",
    },
    intent: { comment: m.comment, kind: m.kind },
    target: {
      selector: m.targetSel,
      selector_preview: m.targetSel,
      tag: m.targetTag,
      ...(cleanName ? { text: cleanName } : {}),
      locator_status: "resolved",
      confidence: 100,
      matched_by: ["id", "aria-name", "dom-path"],
    },
    framework: { name: "React", component: fw.component },
    media: { has_screenshot: false },
    lifecycle: {
      task_status: m.task === "done" ? "resolved" : "open",
      created_at: now,
      updated_at: now,
    },
  };
}
