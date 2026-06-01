import type { Annotation, LocatorStatus } from "@loupe-server/shared";

export type TaskStatus = Annotation["lifecycle"]["task_status"];
export type SyncStatus = Annotation["sync"]["status"];
export type VisualStatusKind = "task" | "locator" | "sync";

export type VisualStatusToken = {
  readonly kind: VisualStatusKind;
  readonly value: string;
  readonly class_name: string;
  readonly label: string;
  readonly badge_text: string;
  readonly icon_name: string;
  readonly border_style: "solid" | "dashed" | "double";
  readonly tone: "neutral" | "success" | "warning" | "danger" | "pending";
  readonly aria_label: string;
};

export type MotionTokens = {
  readonly prefers_reduced_motion: boolean;
  readonly transition_duration_ms: number;
  readonly transition_timing: "ease-out" | "linear";
  readonly overlay_transition: string;
  readonly detail_transition: string;
  readonly toolbar_transition: string;
  readonly badge_animation: string;
  readonly css: string;
};

export type VisualPolishTokens = {
  readonly motion: MotionTokens;
  readonly class_names: typeof visual_class_names;
  readonly css: string;
};

export const visual_class_names = {
  overlay: "loupe-overlay",
  toolbar: "loupe-toolbar",
  detail: "loupe-pin-detail",
  badge: "loupe-status-badge",
  action: "loupe-action",
  action_copy_markdown: "loupe-action-copy-markdown",
  action_resolve: "loupe-action-resolve",
  action_delete: "loupe-action-delete",
  copy_fallback: "loupe-copy-fallback",
} as const;

const normal_transition_duration_ms = 140 as const;
const normal_transition = `opacity ${normal_transition_duration_ms}ms ease-out, transform ${normal_transition_duration_ms}ms ease-out` as const;

export const task_status_tokens: Readonly<Record<TaskStatus, VisualStatusToken>> = {
  open: status_token("task", "open", "Open", "OPEN", "circle-dot", "solid", "pending", "Open task"),
  resolved: status_token("task", "resolved", "Resolved", "DONE", "check-circle", "double", "success", "Resolved task"),
  archived: status_token("task", "archived", "Archived", "ARCH", "archive-box", "dashed", "neutral", "Archived task"),
};

export const locator_status_tokens: Readonly<Record<LocatorStatus, VisualStatusToken>> = {
  resolved: status_token("locator", "resolved", "Target found", "FOUND", "crosshair", "solid", "success", "Locator resolved: target found"),
  drifted: status_token("locator", "drifted", "Needs review", "DRIFT", "split-arrows", "dashed", "warning", "Locator drifted: review target before acting"),
  lost: status_token("locator", "lost", "Target lost", "LOST", "broken-link", "double", "danger", "Locator lost: target could not be found"),
};

export const sync_status_tokens: Readonly<Record<SyncStatus, VisualStatusToken>> = {
  local_only: status_token("sync", "local_only", "Local only", "LOCAL", "device-floppy", "dashed", "neutral", "Local only: copy markdown fallback available"),
  syncing: status_token("sync", "syncing", "Syncing", "SYNC", "refresh", "solid", "pending", "Syncing with daemon"),
  synced: status_token("sync", "synced", "Synced", "SYNCED", "cloud-check", "solid", "success", "Synced with daemon"),
  failed: status_token("sync", "failed", "Sync failed", "RETRY", "alert-triangle", "double", "danger", "Sync failed: retry or copy markdown fallback available"),
  delete_pending: status_token("sync", "delete_pending", "Delete pending", "DELETE", "trash-clock", "dashed", "warning", "Delete pending sync"),
};

export function task_status_token(status: TaskStatus): VisualStatusToken {
  return task_status_tokens[status];
}

export function locator_status_token(status: LocatorStatus): VisualStatusToken {
  return locator_status_tokens[status];
}

export function sync_status_token(status: SyncStatus): VisualStatusToken {
  return sync_status_tokens[status];
}

export function status_class_name(kind: "task", status: TaskStatus): string;
export function status_class_name(kind: "locator", status: LocatorStatus): string;
export function status_class_name(kind: "sync", status: SyncStatus): string;
export function status_class_name(kind: VisualStatusKind, status: TaskStatus | LocatorStatus | SyncStatus): string {
  switch (kind) {
    case "task":
      return task_status_tokens[status as TaskStatus].class_name;
    case "locator":
      return locator_status_tokens[status as LocatorStatus].class_name;
    case "sync":
      return sync_status_tokens[status as SyncStatus].class_name;
  }
}

export function motion_tokens(prefers_reduced_motion: boolean): MotionTokens {
  if (prefers_reduced_motion) {
    const css = [
      `.${visual_class_names.overlay}, .${visual_class_names.toolbar}, .${visual_class_names.detail}, .${visual_class_names.badge} {`,
      "  transition: none;",
      "  animation: none;",
      "  scroll-behavior: auto;",
      "}",
      `.${visual_class_names.badge}[data-sync-status="syncing"] {`,
      "  animation: none;",
      "}",
    ].join("\n");

    return {
      prefers_reduced_motion: true,
      transition_duration_ms: 0,
      transition_timing: "linear",
      overlay_transition: "none",
      detail_transition: "none",
      toolbar_transition: "none",
      badge_animation: "none",
      css,
    };
  }

  const css = [
    `.${visual_class_names.overlay} { transition: ${normal_transition}; }`,
    `.${visual_class_names.toolbar} { transition: opacity ${normal_transition_duration_ms}ms ease-out; }`,
    `.${visual_class_names.detail} { transition: ${normal_transition}; }`,
    `.${visual_class_names.badge}[data-sync-status="syncing"] { animation: loupe-sync-pulse 900ms ease-out infinite; }`,
    "@keyframes loupe-sync-pulse {",
    "  0%, 100% { transform: scale(1); }",
    "  50% { transform: scale(1.04); }",
    "}",
  ].join("\n");

  return {
    prefers_reduced_motion: false,
    transition_duration_ms: normal_transition_duration_ms,
    transition_timing: "ease-out",
    overlay_transition: normal_transition,
    detail_transition: normal_transition,
    toolbar_transition: `opacity ${normal_transition_duration_ms}ms ease-out`,
    badge_animation: "loupe-sync-pulse 900ms ease-out infinite",
    css,
  };
}

export function visual_polish_tokens(prefers_reduced_motion: boolean): VisualPolishTokens {
  const motion = motion_tokens(prefers_reduced_motion);
  return {
    motion,
    class_names: visual_class_names,
    css: [base_visual_css, status_css, motion.css].join("\n"),
  };
}

export const base_visual_css = [
  `.${visual_class_names.overlay} {`,
  "  pointer-events: none;",
  "  outline: 2px solid var(--loupe-accent, #2563eb);",
  "  outline-offset: 2px;",
  "  border-radius: 6px;",
  "}",
  `.${visual_class_names.toolbar}, .${visual_class_names.detail} {`,
  "  font: 12px/1.4 system-ui, -apple-system, BlinkMacSystemFont, \"Segoe UI\", sans-serif;",
  "  color: var(--loupe-fg, #111827);",
  "  background: var(--loupe-bg, #ffffff);",
  "  border: 1px solid var(--loupe-border, #d1d5db);",
  "  box-shadow: 0 8px 24px rgba(17, 24, 39, 0.18);",
  "}",
  `.${visual_class_names.detail} {`,
  "  min-width: 280px;",
  "  max-width: 420px;",
  "  padding: 12px;",
  "  border-radius: 10px;",
  "}",
  `.${visual_class_names.action} {`,
  "  min-height: 32px;",
  "  border: 1px solid currentColor;",
  "  border-radius: 8px;",
  "}",
  `.${visual_class_names.copy_fallback} {`,
  "  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;",
  "  white-space: pre-wrap;",
  "}",
].join("\n");

export const status_css = [
  `.${visual_class_names.badge} {`,
  "  display: inline-flex;",
  "  align-items: center;",
  "  gap: 4px;",
  "  border-width: 1px;",
  "  border-color: currentColor;",
  "  padding: 2px 6px;",
  "  border-radius: 999px;",
  "  font-weight: 600;",
  "}",
  ".loupe-tone-neutral { color: #374151; }",
  ".loupe-tone-success { color: #047857; }",
  ".loupe-tone-warning { color: #92400e; }",
  ".loupe-tone-danger { color: #b91c1c; }",
  ".loupe-tone-pending { color: #1d4ed8; }",
].join("\n");

function status_token(
  kind: VisualStatusKind,
  value: string,
  label: string,
  badge_text: string,
  icon_name: string,
  border_style: VisualStatusToken["border_style"],
  tone: VisualStatusToken["tone"],
  aria_label: string,
): VisualStatusToken {
  return {
    kind,
    value,
    class_name: `loupe-status-${kind}-${value.replace(/_/g, "-")}`,
    label,
    badge_text,
    icon_name,
    border_style,
    tone,
    aria_label,
  };
}
