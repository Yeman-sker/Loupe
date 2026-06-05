// Floating daemon status bar — toggled by the toolbar action on an authorized
// page (the toolbar click is no longer a host-permission CTA). Represents daemon
// auth/sync as a status surface, not a form (ADP local-project-gated onboarding,
// Decision #2): connected / daemon offline / token missing / sync failed /
// local-only. Never shows the token value; advanced repair states may show the
// token_path (~/.loupe/token) and `loupe init` guidance.

import { type Dom } from "./dom.js";
import { type Translate } from "./i18n.js";
import { type TokenClass } from "./status-tokens.js";

export type StatusKind = "connected" | "offline" | "token_missing" | "sync_failed" | "local_only";

export type StatusModel = {
  kind: StatusKind;
  syncedCount: number;
  pendingCount: number;
  // Only set for repair states (offline / token_missing). The token VALUE is
  // never exposed — this is the on-disk path for `loupe init` diagnostics.
  tokenPath?: string;
};

export type StatusBarOpts = {
  t: Translate;
  model: StatusModel;
  onRetry: () => void;
  onCopy: () => Promise<boolean>;
  onClose: () => void;
};

type HeadToken = { cls: TokenClass; glyph: string; key: string };

const HEAD: Record<StatusKind, HeadToken> = {
  connected: { cls: "good", glyph: "✓", key: "status.connected" },
  offline: { cls: "warn", glyph: "△", key: "status.offline" },
  token_missing: { cls: "bad", glyph: "✕", key: "status.tokenMissing" },
  sync_failed: { cls: "bad", glyph: "✕", key: "status.syncFailed" },
  local_only: { cls: "neutral", glyph: "•", key: "status.localOnly" },
};

export function renderStatusBar(dom: Dom, opts: StatusBarOpts): HTMLElement {
  const { t, model, onRetry, onCopy, onClose } = opts;
  const head = HEAD[model.kind];

  const headTok = dom.el("span", { class: `tok tok--${head.cls}` }, [
    dom.el("span", { class: "g", attrs: { "aria-hidden": "true" }, text: head.glyph }),
    dom.el("span", { text: t(head.key) }),
  ]);

  // Count summary — synced / pending, only when there are marks to report.
  const counts = countSummary(model);
  const meta = dom.el("span", { class: "lp-status-meta mono", text: counts });

  const retry = dom.el("button", {
    class: "btn ghost lp-status-btn",
    attrs: { type: "button" },
    text: t("status.retry"),
    on: { click: onRetry },
  });

  const copy = dom.el("button", {
    class: "btn ghost lp-status-btn",
    attrs: { type: "button" },
    text: t("status.copy"),
  });
  copy.addEventListener("click", () => {
    void onCopy().then((ok) => {
      if (!ok) return;
      copy.textContent = t("detail.copyOk");
      setTimeout(() => { copy.textContent = t("status.copy"); }, 1200);
    });
  });

  const close = dom.el("button", {
    class: "lp-status-x",
    attrs: { type: "button", "aria-label": t("status.close") },
    text: "×",
    on: { click: onClose },
  });

  const row = dom.el("div", { class: "lp-status-row" }, [headTok, meta, retry, copy, close]);
  const children: HTMLElement[] = [row];

  // Repair guidance — only for states a daemon restart / `loupe init` can fix.
  if (model.kind === "offline" || model.kind === "token_missing") {
    const guide = dom.el("div", { class: "lp-status-guide" }, [
      dom.el("span", { text: t("status.init") }),
      ...(model.tokenPath !== undefined
        ? [dom.el("code", { class: "lp-status-path mono", text: model.tokenPath })]
        : []),
    ]);
    children.push(guide);
  }

  return dom.el("div", {
    class: "lp-status card anim-pop",
    attrs: { role: "status", "aria-live": "polite", "aria-label": t("status.title") },
  }, children);
}

function countSummary(model: StatusModel): string {
  const parts: string[] = [];
  if (model.syncedCount > 0) parts.push(`${model.syncedCount} ✓`);
  if (model.pendingCount > 0) parts.push(`${model.pendingCount} •`);
  return parts.join("  ");
}
