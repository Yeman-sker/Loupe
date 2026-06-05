// Surface 6 — Pin detail card. Opened by clicking a pin. Shows target label,
// comment, meta tokens, and three actions: Mark done, Copy Markdown, Delete.
// All feedback is in-place; no toast or dialog.

import { type Dom } from "./dom.js";
import { type Translate } from "./i18n.js";
import { type PinRecord } from "./surface-pin.js";

export type DetailOpts = {
  t: Translate;
  onDone: (pinId: string) => void;
  onDelete: (pinId: string) => void;
  onCopyMarkdown: (pinId: string) => Promise<boolean>;
  onClose: () => void;
  onViewAll: () => void;
  onRetry?: (pinId: string) => void;
};

function makeTok(dom: Dom, glyph: string, label: string, cls: string): HTMLElement {
  return dom.el("span", { class: `tok tok--${cls}` }, [
    dom.el("span", { class: "g", attrs: { "aria-hidden": "true" }, text: glyph }),
    dom.el("span", { text: label }),
  ]);
}

export function renderDetail(dom: Dom, pin: PinRecord, opts: DetailOpts): HTMLElement {
  const { t } = opts;
  const isDone = pin.task === "done";

  // Target label
  const tag = (pin.element as Element).tagName?.toLowerCase() ?? "?";
  const sel = selectorPreview(pin.element as Element);
  const targetEl = dom.el("div", { class: "d-target" }, [
    dom.el("span", { class: "ix mono", text: `#${pin.num}` }),
    dom.el("span", { text: `${tag} ${sel}` }),
  ]);

  // Comment
  const commentEl = dom.el("div", { class: "d-comment", text: pin.comment ?? "" });

  // Meta tokens
  const taskTok = isDone
    ? makeTok(dom, "✓", t("task.done"), "good")
    : makeTok(dom, "○", t("task.open"), "open");
  const locTok = pin.loc === "lost"
    ? makeTok(dom, "✕", t("loc.lost"), "bad")
    : pin.loc === "drifted"
      ? makeTok(dom, "△", pin.confidence !== undefined ? `drifted ${pin.confidence}%` : t("loc.drifted"), "warn")
      : makeTok(dom, "✓", pin.confidence !== undefined ? `located ${pin.confidence}%` : t("loc.located"), "good");
  const syncTok = pin.sync === "failed"
    ? makeTok(dom, "✕", t("sync.failed"), "bad")
    : pin.sync === "local"
      ? makeTok(dom, "•", t("sync.local"), "neutral")
      : pin.sync === "syncing"
        ? makeTok(dom, "◌", t("sync.syncing"), "open")
        : makeTok(dom, "✓", t("sync.synced"), "good");
  const kindTok = dom.el("span", { class: `tok tok--kind`, data: { kind: pin.kind }, text: pin.kind });
  const metaEl = dom.el("div", { class: "d-meta" }, [taskTok, locTok, syncTok, kindTok]);

  // Actions
  const doneBtn = dom.el("button", {
    class: isDone ? "btn ghost" : "btn primary",
    attrs: isDone ? { disabled: "" } : {},
  });
  if (isDone) {
    doneBtn.innerHTML =
      `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="m5 12 5 5L20 7"/></svg>`;
    doneBtn.appendChild(dom.el("span", { text: t("detail.doneOk") }));
  } else {
    doneBtn.textContent = t("detail.done");
  }

  const copyBtn = dom.el("button", { class: "btn ghost", text: t("detail.copy") });

  // Retry — only for sync-failed marks (re-queues; actual sync is daemon-driven)
  const isFailed = pin.sync === "failed";
  const retryBtn = isFailed
    ? dom.el("button", { class: "btn ghost", text: t("fb.retry") })
    : null;

  const deleteBtn = dom.el("button", {
    class: "btn danger",
    text: t("detail.del"),
  });

  const spacer = dom.el("span", { class: "spacer" });
  const actionChildren: HTMLElement[] = [doneBtn, copyBtn];
  if (retryBtn !== null) actionChildren.push(retryBtn);
  actionChildren.push(spacer, deleteBtn);
  const actionsEl = dom.el("div", { class: "d-actions" }, actionChildren);

  const cls = ["detail", "card", ...(isDone ? ["is-done"] : [])].join(" ");
  const el = dom.el("div", {
    class: cls,
    data: { kind: pin.kind },
    attrs: { role: "dialog", "aria-label": `Mark ${pin.num}` },
  }, [targetEl, commentEl, metaEl, actionsEl]);

  // Mark done
  if (!isDone) {
    doneBtn.addEventListener("click", () => {
      doneBtn.className = "btn ghost";
      doneBtn.setAttribute("disabled", "");
      doneBtn.innerHTML = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="m5 12 5 5L20 7"/></svg>`;
      doneBtn.appendChild(dom.el("span", { text: t("detail.doneOk") }));
      el.classList.add("is-done");
      taskTok.className = "tok tok--good";
      taskTok.querySelector(".g")!.textContent = "✓";
      taskTok.lastElementChild!.textContent = t("task.done");
      setTimeout(() => opts.onDone(pin.id), 620);
    });
  }

  // Copy Markdown — two-state inline feedback
  copyBtn.addEventListener("click", () => {
    copyBtn.setAttribute("disabled", "");
    opts.onCopyMarkdown(pin.id).then((ok) => {
      copyBtn.textContent = ok ? t("detail.copyOk") : t("detail.copyErr");
      if (ok) {
        setTimeout(() => {
          copyBtn.textContent = t("detail.copy");
          copyBtn.removeAttribute("disabled");
        }, 1200);
      } else {
        copyBtn.removeAttribute("disabled");
      }
    });
  });

  // Retry sync — delegates to app (re-probes daemon, re-queues the mark)
  if (retryBtn !== null) {
    retryBtn.addEventListener("click", () => {
      retryBtn.setAttribute("disabled", "");
      opts.onRetry?.(pin.id);
    });
  }

  // Delete — two-step armed confirm
  let armed = false;
  let armTimer: ReturnType<typeof setTimeout> | null = null;
  const disarm = (): void => {
    armed = false;
    if (armTimer !== null) { clearTimeout(armTimer); armTimer = null; }
    deleteBtn.textContent = t("detail.del");
    deleteBtn.removeAttribute("data-armed");
  };
  deleteBtn.addEventListener("click", () => {
    if (armed) {
      if (armTimer !== null) clearTimeout(armTimer);
      deleteBtn.textContent = t("detail.delOk");
      deleteBtn.removeAttribute("data-armed");
      setTimeout(() => opts.onDelete(pin.id), 480);
    } else {
      armed = true;
      deleteBtn.textContent = t("detail.delArm");
      deleteBtn.setAttribute("data-armed", "1");
      armTimer = setTimeout(disarm, 2600);
    }
  });

  // Esc to close or disarm
  el.addEventListener("keydown", (e) => {
    const ke = e as KeyboardEvent;
    if (ke.key === "Escape") {
      if (armed) disarm();
      else opts.onClose();
    }
  });

  return el;
}

function selectorPreview(element: Element): string {
  const tag = element.tagName?.toLowerCase() ?? "?";
  if (element.id?.length > 0) return `${tag}#${element.id}`;
  const cls = Array.from(element.classList ?? [])
    .filter((c) => c.length < 32)
    .slice(0, 2)
    .join(".");
  return cls.length > 0 ? `${tag}.${cls}` : tag;
}
