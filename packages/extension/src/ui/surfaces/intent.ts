// Surface 4 (full) — Intent input panel. UI-3 upgrade adds:
//   - textarea auto-grow (1→4 lines, overflow above 88px)
//   - kind rail: label expand on hover/sel, keyboard navigation (←/→, Enter, Tab→textarea)
//   - root data-kind drives --k CSS var (submit button tint)
//   - ⌘/Ctrl+Enter empty → inline hint + shake; next input clears hint
//   - 2-step Esc: first with content shows discard hint, second confirms
//   - collapse-to-pin animation (animationend → onSave; 600ms fallback)
//   - bottom dock fallback (position:fixed) when target completely off-screen
//   - inline error if onSave rejects; daemon offline is non-fatal (app.ts side)

import { type Dom } from "../core/dom.js";
import { type Translate } from "../core/i18n.js";
import { type IntentKind } from "../storage/lib-storage.js";

export type IntentHandlers = {
  onSave: (comment: string, kind: IntentKind) => void | Promise<void>;
  onCancel: () => void;
};

export type Viewport = { width: number; height: number; scrollY: number };

const KINDS: IntentKind[] = ["bug", "copy", "style", "layout", "question", "other"];

export function renderIntent(
  dom: Dom,
  t: Translate,
  targetRect: DOMRect,
  viewport: Viewport,
  handlers: IntentHandlers,
  targetLabel = "",
): HTMLElement {
  let kind: IntentKind = "other";
  let escPendingDiscard = false;
  let escDiscardTimer: ReturnType<typeof setTimeout> | null = null;

  const pip = dom.el("span", { class: "lp-intent-pip" });
  const targChildren: HTMLElement[] = [pip];
  if (targetLabel.length > 0) {
    targChildren.push(dom.el("span", { class: "lp-intent-target-label", text: targetLabel }));
  }
  const targ = dom.el("div", { class: "lp-intent-targ mono" }, targChildren);

  const textarea = dom.el("textarea", {
    class: "lp-intent-field",
    attrs: {
      rows: "1",
      placeholder: t("intent.ph"),
      "aria-label": t("intent.commenta"),
    },
  }) as HTMLTextAreaElement;

  const submitBtn = dom.el("button", {
    class: "lp-intent-submit",
    attrs: { type: "button", "aria-label": t("intent.savea"), disabled: "" },
  });
  submitBtn.innerHTML =
    '<svg width="15" height="15" viewBox="0 0 14 14" fill="none" aria-hidden="true">' +
    '<path d="M7 11V3M3 7l4-4 4 4" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"/>' +
    "</svg>";

  const hintEl = dom.el("div", { class: "lp-intent-hint", text: t("intent.hint") });
  const discardEl = dom.el("div", { class: "lp-intent-discard", text: t("intent.discard") });
  const errorEl = dom.el("div", { class: "lp-intent-error" });
  const footEl = dom.el("div", { class: "lp-intent-foot" }, [
    dom.el("span", { class: "lp-hintkey mono", text: "⌘↵" }),
  ]);

  function refreshSubmit(): void {
    if ((textarea as HTMLTextAreaElement).value.trim().length > 0) {
      submitBtn.removeAttribute("disabled");
    } else {
      submitBtn.setAttribute("disabled", "");
    }
  }

  function growTextarea(): void {
    (textarea as HTMLTextAreaElement).style.height = "auto";
    const sh = (textarea as HTMLTextAreaElement).scrollHeight;
    (textarea as HTMLTextAreaElement).style.height = Math.min(sh, 88) + "px";
    (textarea as HTMLTextAreaElement).style.overflowY = sh > 88 ? "auto" : "hidden";
  }

  textarea.addEventListener("input", () => {
    growTextarea();
    refreshSubmit();
    el.classList.remove("lp-show-hint");
    discardEl.style.display = "none";
    if (escPendingDiscard) {
      escPendingDiscard = false;
      if (escDiscardTimer !== null) clearTimeout(escDiscardTimer);
    }
    errorEl.style.display = "none";
  });

  // Kind rail
  function selectKind(k: IntentKind): void {
    kind = k;
    el.setAttribute("data-kind", k);
    kindDots.forEach((d, i) => {
      const sel = (KINDS[i] as IntentKind) === k;
      if (sel) {
        d.classList.add("lp-kind-btn--sel");
        d.setAttribute("aria-selected", "true");
        d.setAttribute("tabindex", "0");
      } else {
        d.classList.remove("lp-kind-btn--sel");
        d.setAttribute("aria-selected", "false");
        d.setAttribute("tabindex", "-1");
      }
    });
  }

  const kindDots = KINDS.map((k, i) => {
    const nameSpan = dom.el("span", { class: "lp-kind-name", text: t(`kind.${k}`) });
    const dot = dom.el("button", {
      class: "lp-kind-btn" + (k === "other" ? " lp-kind-btn--sel" : ""),
      attrs: {
        type: "button",
        "aria-label": t(`kind.${k}`),
        role: "option",
        "aria-selected": k === "other" ? "true" : "false",
        tabindex: k === "other" ? "0" : "-1",
      },
      data: { kind: k },
    }, [nameSpan]);

    dot.addEventListener("click", () => selectKind(k));

    dot.addEventListener("keydown", (e: Event) => {
      const ke = e as KeyboardEvent;
      if (ke.key === "ArrowRight" || ke.key === "ArrowDown") {
        ke.preventDefault();
        const next = (i + 1) % KINDS.length;
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        selectKind(KINDS[next]!);
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        kindDots[next]!.focus();
      } else if (ke.key === "ArrowLeft" || ke.key === "ArrowUp") {
        ke.preventDefault();
        const prev = (i - 1 + KINDS.length) % KINDS.length;
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        selectKind(KINDS[prev]!);
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        kindDots[prev]!.focus();
      } else if (ke.key === "Tab" && !ke.shiftKey) {
        ke.preventDefault();
        textarea.focus();
      }
    });

    return dot;
  });

  const kindLabel = dom.el("span", { class: "lp-kindrail-label mono", text: t("intent.kind") });
  const kindrail = dom.el("div", {
    class: "lp-kindrail",
    attrs: { role: "listbox", "aria-label": t("intent.kind") },
  }, [kindLabel, ...kindDots]);

  function doSave(): void {
    const val = (textarea as HTMLTextAreaElement).value.trim();
    if (val.length === 0) {
      el.classList.add("lp-show-hint");
      textarea.focus();
      return;
    }
    startCollapse(val);
  }

  function startCollapse(val: string): void {
    el.classList.add("lp-collapsing");
    (el as HTMLElement).style.pointerEvents = "none";

    let settled = false;
    function finalize(): void {
      if (settled) return;
      settled = true;
      intentShell.removeEventListener("animationend", finalize);
      void afterCollapse(val);
    }
    intentShell.addEventListener("animationend", finalize);
    setTimeout(finalize, 600);
  }

  async function afterCollapse(val: string): Promise<void> {
    try {
      const result = handlers.onSave(val, kind);
      if (result instanceof Promise) await result;
    } catch {
      el.classList.remove("lp-collapsing");
      (el as HTMLElement).style.pointerEvents = "";
      errorEl.textContent = t("intent.saveErr");
      errorEl.style.display = "block";
    }
  }

  submitBtn.addEventListener("click", doSave);

  textarea.addEventListener("keydown", (e: Event) => {
    const ke = e as KeyboardEvent;
    if (ke.isComposing === true) return;
    if (ke.key === "Enter" && (ke.metaKey || ke.ctrlKey)) {
      ke.preventDefault();
      doSave();
    } else if (ke.key === "Escape") {
      ke.preventDefault();
      const val = (textarea as HTMLTextAreaElement).value.trim();
      if (val.length === 0) {
        handlers.onCancel();
      } else if (!escPendingDiscard) {
        escPendingDiscard = true;
        discardEl.style.display = "block";
        escDiscardTimer = setTimeout(() => {
          escPendingDiscard = false;
          discardEl.style.display = "none";
        }, 2600);
      } else {
        if (escDiscardTimer !== null) clearTimeout(escDiscardTimer);
        handlers.onCancel();
      }
    }
  });

  const row = dom.el("div", { class: "lp-intent-row" }, [textarea, submitBtn]);
  const intentShell = dom.el("div", { class: "lp-intent-shell" }, [targ, row, kindrail]);
  const el = dom.el("div", { class: "lp-intent anim-pop" }, [
    intentShell,
    hintEl,
    discardEl,
    errorEl,
    footEl,
  ]);

  // Set initial data-kind for --k CSS var
  el.setAttribute("data-kind", "other");

  // Expose shell for test-only animationend mocking
  (el as unknown as Record<string, unknown>)._shell = intentShell;

  // Position: below target if room, above if room, else bottom dock (fixed)
  const PANEL_HEIGHT = 210;
  const PANEL_WIDTH = 380;
  const PAD = 8;
  const absTop = targetRect.top + viewport.scrollY;
  const absLeft = targetRect.left;

  const spaceBelow = viewport.height - targetRect.bottom;
  const spaceAbove = targetRect.top;

  const bottomDock = spaceBelow < PANEL_HEIGHT + PAD && spaceAbove < PANEL_HEIGHT + PAD;

  const left = Math.max(PAD, Math.min(absLeft, viewport.width - PANEL_WIDTH - PAD));

  // Compute --ox: transform-origin x for collapse animation (target center relative to panel)
  const targetCenterX = targetRect.left + targetRect.width / 2;
  const ox = Math.max(0, Math.min(100, ((targetCenterX - left) / PANEL_WIDTH) * 100));
  const styleDecl = el.style as CSSStyleDeclaration;
  if (typeof styleDecl.setProperty === "function") {
    styleDecl.setProperty("--ox", `${ox.toFixed(1)}%`);
  }

  if (bottomDock) {
    el.style.position = "fixed";
    el.style.bottom = `${PAD}px`;
    el.style.left = `${left}px`;
    el.style.width = `${PANEL_WIDTH}px`;
  } else {
    let top: number;
    if (spaceBelow >= PANEL_HEIGHT + PAD) {
      top = absTop + targetRect.height + PAD;
    } else {
      top = absTop - PANEL_HEIGHT - PAD;
    }
    el.style.position = "absolute";
    el.style.top = `${top}px`;
    el.style.left = `${left}px`;
    el.style.width = `${PANEL_WIDTH}px`;
  }

  setTimeout(() => {
    (textarea as HTMLTextAreaElement).focus();
  }, 0);

  return el;
}
