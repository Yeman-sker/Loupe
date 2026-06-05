// Status tokens — glyph + text, NEVER colour-only (spec §1.4 / §12).
// Maps the real snake_case wire enums from @loupe-server/shared to the locked
// display tokens (glyphs: located/synced/done ✓ · drifted △ · lost/failed ✕ ·
// open ○ · neutral • · syncing ◌). UI-1+ feeds store values straight in.

import type { Translate } from "./i18n.js";
import type { IntentKind, LocatorStatus } from "@loupe-server/shared";

export type TaskStatus = "open" | "resolved" | "archived";
export type SyncStatus = "local_only" | "syncing" | "synced" | "failed" | "delete_pending";

export type TokenClass = "good" | "warn" | "bad" | "open" | "neutral" | "kind";

export type TokenSpec = {
  cls: TokenClass;
  glyph: string;
  label: string;
  kind?: IntentKind;
};

export function taskToken(t: Translate, status: TaskStatus): TokenSpec {
  if (status === "resolved") return { cls: "good", glyph: "✓", label: t("task.done") };
  if (status === "archived") return { cls: "neutral", glyph: "▢", label: t("task.archived") };
  return { cls: "open", glyph: "○", label: t("task.open") };
}

// confidence is the 0..1 locator confidence; rendered as a percent for
// located/drifted. lost never shows a (false) percent.
export function formatConfidencePercent(confidence: number): string {
  const percent = confidence <= 1 ? confidence * 100 : confidence;
  return `${Math.round(percent)}%`;
}

export function locatorToken(t: Translate, status: LocatorStatus, confidence?: number): TokenSpec {
  if (status === "lost") return { cls: "bad", glyph: "✕", label: t("loc.lost") };
  const pct = confidence === undefined ? "" : ` ${formatConfidencePercent(confidence)}`;
  if (status === "drifted") return { cls: "warn", glyph: "△", label: t("loc.drifted") + pct };
  return { cls: "good", glyph: "✓", label: t("loc.located") + pct };
}

export function syncToken(t: Translate, status: SyncStatus): TokenSpec {
  if (status === "failed") return { cls: "bad", glyph: "✕", label: t("sync.failed") };
  if (status === "local_only") return { cls: "neutral", glyph: "•", label: t("sync.local") };
  if (status === "syncing") return { cls: "open", glyph: "◌", label: t("sync.syncing") };
  if (status === "delete_pending") return { cls: "open", glyph: "◌", label: t("sync.deleting") };
  return { cls: "good", glyph: "✓", label: t("sync.synced") };
}

export function kindToken(t: Translate, kind: IntentKind): TokenSpec {
  return { cls: "kind", glyph: "•", label: t("kind." + kind), kind };
}

export type MarkStatus = {
  task: TaskStatus;
  locator: LocatorStatus;
  confidence?: number;
  sync: SyncStatus;
};

export function metaTokens(t: Translate, m: MarkStatus): { task: TokenSpec; loc: TokenSpec; sync: TokenSpec } {
  return {
    task: taskToken(t, m.task),
    loc: locatorToken(t, m.locator, m.confidence),
    sync: syncToken(t, m.sync),
  };
}
