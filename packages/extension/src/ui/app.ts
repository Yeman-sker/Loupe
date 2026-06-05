// Surface runtime entry. content.js dynamically imports this after host
// authorization and calls mount(). Renders the golden-path flow:
//   ready → picking → intent → pin (saved to chrome.storage.local)
// All surfaces live inside the Shadow DOM host from host.ts.

import { createSurfaceHost, SURFACE_ROOT_ID, type Theme } from "./host.js";
import { createI18n, type Lang } from "./i18n.js";
import { capture_locator, resolve } from "./schema.js";
import {
  create_annotation,
  project_scope_from_url,
  session_marks_key,
  type AnnotationContextDraft,
  type AnnotationDraft,
  type IntentKind,
} from "./lib-storage.js";
import { renderReady } from "./surface-ready.js";
import { attachPicker, type HoverTarget, type Picker } from "./surface-picker.js";
import { renderIntent, type Viewport } from "./surface-intent.js";
import { renderPin, type PinRecord } from "./surface-pin.js";

export type UiStorage = {
  get: (key: string) => Promise<Record<string, unknown>>;
  set: (items: Record<string, unknown>) => Promise<void>;
};

export type MountOptions = {
  baseUrl: string;
  document: Document;
  storage?: UiStorage;
};

export type SurfaceApp = {
  unmount: () => void;
};

const PREFS_KEY = "loupe:v1:ui:prefs";

type Prefs = { theme: Theme; lang: Lang };

type AppState = {
  picking: boolean;
  hover: HoverTarget | null;
  intent: HoverTarget | null;
  pins: PinRecord[];
  markCount: number;
};

// CSS for UI-1 surfaces — injected into shadow root alongside host.ts BASE_CSS.
const SURFACES_CSS = `
/* Ready panel */
.lp-ready{position:fixed;right:20px;bottom:20px;padding:14px 16px;
  display:flex;align-items:center;gap:10px;pointer-events:auto;width:auto}
.lp-ready-brand{display:flex;align-items:center;gap:7px;color:var(--ink-2)}
.lp-ready-wm{font-size:14px;font-weight:600;letter-spacing:-.02em;color:var(--ink)}
.lp-ready-pick{padding:8px 14px}

/* Mode indicator */
.lp-mode-ind{position:fixed;bottom:22px;left:50%;transform:translateX(-50%);
  display:inline-flex;align-items:center;gap:8px;padding:8px 14px;
  background:var(--surface);border:var(--hair) solid var(--hairline-2);
  border-radius:100px;box-shadow:var(--shadow);pointer-events:auto;
  font-size:12.5px;color:var(--ink-2);white-space:nowrap;z-index:1}
.lp-mode-dot{width:7px;height:7px;border-radius:50%;background:var(--iris);
  flex-shrink:0;animation:lp-ping 1.4s ease-in-out infinite}
@keyframes lp-ping{0%,100%{opacity:1;transform:scale(1)}50%{opacity:.55;transform:scale(1.6)}}

/* Selection frame — positioned absolute within overlay (scroll-aware) */
.lp-frame{position:absolute;pointer-events:none;
  transition:left var(--dur) var(--ease),top var(--dur) var(--ease),
    width var(--dur) var(--ease),height var(--dur) var(--ease)}
.lp-frame-edge{position:absolute;inset:0;
  background:oklch(from var(--iris) l c h / .07);
  border:var(--hair) solid var(--iris)}
.lp-frame-br{position:absolute;width:13px;height:13px;border:2px solid var(--iris)}
.lp-frame-br--tl{top:-1px;left:-1px;border-right:none;border-bottom:none}
.lp-frame-br--tr{top:-1px;right:-1px;border-left:none;border-bottom:none}
.lp-frame-br--bl{bottom:-1px;left:-1px;border-right:none;border-top:none}
.lp-frame-br--br{bottom:-1px;right:-1px;border-left:none;border-top:none}
.lp-frame-dim{position:absolute;right:0;top:-20px;
  font:500 10.5px/1 var(--mono);color:var(--iris);letter-spacing:0}
.lp-frame-lbl{position:absolute;left:-1px;top:calc(100% + 7px);
  background:var(--iris);color:var(--iris-fg);
  font:500 11px/1 var(--mono);padding:3px 7px;border-radius:var(--r-sm);
  letter-spacing:0;white-space:nowrap;max-width:260px;
  overflow:hidden;text-overflow:ellipsis}

/* Intent panel */
.lp-intent{position:absolute;pointer-events:auto;z-index:2;width:380px;max-width:92vw}
.lp-intent-shell{background:var(--surface);border:var(--hair) solid var(--hairline-2);
  border-radius:var(--r-lg);box-shadow:var(--shadow-pop);padding:11px 11px 9px;
  transition:border-color var(--dur) var(--ease),box-shadow var(--dur) var(--ease),opacity var(--dur) var(--ease)}
.lp-intent-shell:focus-within{border-color:color-mix(in srgb,var(--iris) 50%,var(--hairline-2));box-shadow:var(--shadow-pop),var(--ring)}
.lp-intent-pip{display:inline-block;width:6px;height:6px;border-radius:50%;
  background:var(--iris);flex-shrink:0;margin-right:5px}
.lp-intent-targ{display:flex;align-items:center;font-size:10.5px;color:var(--ink-3);
  font-family:var(--mono);padding:1px 4px 8px;letter-spacing:.01em}
.lp-intent-row{display:flex;align-items:flex-end;gap:9px}
.lp-intent-field{flex:1;resize:none;overflow-y:hidden;border:none;outline:none;
  background:transparent;color:var(--ink);font:400 14px/1.5 var(--font);
  min-height:22px;max-height:88px;padding:5px 4px;letter-spacing:-.006em}
.lp-intent-field::placeholder{color:var(--ink-3)}
.lp-intent-submit{flex:none;width:33px;height:33px;border-radius:var(--r-pin);border:none;cursor:pointer;
  display:grid;place-items:center;background:var(--k,var(--iris));color:var(--iris-fg);
  box-shadow:0 1px 2px color-mix(in srgb,var(--k,var(--iris)) 40%,transparent),0 6px 16px -6px color-mix(in srgb,var(--k,var(--iris)) 50%,transparent);
  transition:transform var(--dur-fast) var(--ease),box-shadow var(--dur) var(--ease),opacity var(--dur) var(--ease)}
.lp-intent-submit:hover:not([disabled]){transform:translateY(-1px) scale(1.05)}
.lp-intent-submit:focus-visible{outline:none;box-shadow:0 0 0 3px color-mix(in srgb,var(--k,var(--iris)) 32%,transparent)}
.lp-intent-submit svg{width:15px;height:15px}
.lp-intent-submit[disabled]{opacity:.34;cursor:not-allowed;transform:none;box-shadow:none;background:var(--ink-3)}
.lp-kindrail{display:flex;align-items:center;gap:3px;margin-top:10px;padding-top:9px;
  border-top:var(--hair) solid var(--hairline)}
.lp-kindrail-label{font:600 9.5px/1 var(--mono);letter-spacing:.12em;text-transform:uppercase;
  color:var(--ink-3);margin-right:6px}
.lp-kind-btn{appearance:none;cursor:pointer;border:none;background:transparent;padding:5px;
  border-radius:999px;display:inline-flex;align-items:center;gap:0;
  transition:gap var(--dur) var(--ease),background var(--dur) var(--ease),transform var(--dur-fast) var(--ease)}
.lp-kind-btn::before{content:"";width:9px;height:9px;border-radius:50%;background:var(--k,var(--iris));flex:none;
  box-shadow:0 0 0 0 color-mix(in srgb,var(--k,var(--iris)) 30%,transparent);
  transition:box-shadow var(--dur) var(--ease)}
.lp-kind-btn:hover{background:var(--surface-2);transform:translateY(-1px)}
.lp-kind-name{max-width:0;overflow:hidden;white-space:nowrap;font:600 11px/1 var(--font);
  color:var(--ink);opacity:0;
  transition:max-width var(--dur) var(--ease),opacity var(--dur) var(--ease),margin var(--dur) var(--ease)}
.lp-kind-btn:hover .lp-kind-name,.lp-kind-btn--sel .lp-kind-name{max-width:80px;opacity:1;margin-left:6px;margin-right:2px}
.lp-kind-btn--sel{background:color-mix(in srgb,var(--k,var(--iris)) 13%,transparent)}
.lp-kind-btn--sel::before{box-shadow:0 0 0 3px color-mix(in srgb,var(--k,var(--iris)) 22%,transparent)}
.lp-kind-btn:focus-visible{outline:none;box-shadow:var(--ring)}
/* hint, discard, error */
.lp-intent-hint{margin:6px 3px 1px;font:600 11px/1.3 var(--font);color:var(--t-bad);display:none}
.lp-intent.lp-show-hint .lp-intent-hint{display:block;animation:lp-shake .3s var(--ease)}
@keyframes lp-shake{0%,100%{transform:translateX(0)}25%{transform:translateX(-3px)}75%{transform:translateX(3px)}}
.lp-intent-discard{margin:6px 3px 1px;font:600 11px/1.3 var(--font);color:var(--ink-2);display:none}
.lp-intent-error{margin:6px 3px 1px;font:600 11px/1.3 var(--font);color:var(--t-bad);display:none}
/* footer */
.lp-intent-foot{display:flex;align-items:center;margin-top:8px;padding:0 2px}
.lp-hintkey{font:500 10.5px/1 var(--mono);color:var(--ink-3);margin-left:auto}
/* collapse-to-pin animation */
@keyframes lp-collapse-to-pin{0%{opacity:1;transform:scale(1)}60%{opacity:.5}100%{opacity:0;transform:scale(.7) translateY(8px)}}
.lp-intent.lp-collapsing .lp-intent-shell{animation:lp-collapse-to-pin var(--dur-slow) var(--ease) forwards;transform-origin:var(--ox,100%) 0;pointer-events:none}
/* add-another button */
.lp-add-another{display:inline-flex;align-items:center;gap:7px;font:600 11.5px/1 var(--font);
  color:var(--ink-2);background:var(--surface);border:var(--hair) dashed var(--hairline-strong);
  border-radius:999px;padding:8px 13px;cursor:pointer;box-shadow:var(--shadow);
  animation:pop-in var(--dur) var(--ease-out) both;pointer-events:auto;
  transition:color var(--dur) var(--ease),border-color var(--dur) var(--ease),background var(--dur) var(--ease)}
.lp-add-another:hover{color:var(--ink);border-color:var(--iris);background:var(--iris-veil-2)}
.lp-add-another-x{font:700 13px/1 var(--mono);color:var(--iris)}

/* Breadcrumb */
.lp-breadcrumb{position:absolute;display:inline-flex;align-items:center;gap:5px;
  font:500 11px/1 var(--font);color:var(--ink-2);background:var(--surface);
  border:var(--hair) solid var(--hairline);padding:6px 10px;border-radius:999px;
  box-shadow:var(--shadow);pointer-events:none;z-index:2;white-space:nowrap}
.lp-breadcrumb i{color:var(--ink-3);font-style:normal}
.lp-breadcrumb b{color:var(--ink);font-weight:600}

/* Pin */
.lp-pin{position:absolute;width:24px;height:24px;
  transform:translate(-50%,-50%);pointer-events:auto;cursor:pointer;
  animation:lp-pin-in var(--dur-slow) var(--ease-out) both}
.lp-pin-ring{width:24px;height:24px;border-radius:50%;
  border:var(--hair) solid var(--hairline-2);background:var(--surface);
  display:flex;align-items:center;justify-content:center;
  box-shadow:var(--shadow-xs);position:relative}
.lp-pin-num{font:600 11px/1 var(--mono);color:var(--ink-2);
  position:relative;z-index:1}
.lp-pin--open .lp-pin-ring::after{content:"";position:absolute;inset:-3px;
  border-radius:50%;border:1.5px solid var(--iris);opacity:.5;
  animation:lp-pin-pulse 2.6s ease-in-out infinite}
@keyframes lp-pin-pulse{0%,100%{opacity:.5;transform:scale(1)}50%{opacity:.15;transform:scale(1.4)}}
@keyframes lp-pin-in{
  from{opacity:0;transform:translate(-50%,-50%) scale(.4)}
  85%{transform:translate(-50%,-50%) scale(1.12)}
  to{opacity:1;transform:translate(-50%,-50%) scale(1)}
}
`;

export async function mount(opts: MountOptions): Promise<SurfaceApp> {
  if (opts.document.getElementById(SURFACE_ROOT_ID) !== null) return { unmount: () => {} };

  const prefs = await readPrefs(opts.storage, opts.document);
  const i18n = createI18n(prefs.lang);
  const host = createSurfaceHost({ document: opts.document, baseUrl: opts.baseUrl, theme: prefs.theme });

  // Inject surface-specific CSS into the shadow root alongside host BASE_CSS
  const surfaceStyle = opts.document.createElement("style");
  surfaceStyle.textContent = SURFACES_CSS;
  host.shadow.append(surfaceStyle);

  const state: AppState = {
    picking: false,
    hover: null,
    intent: null,
    pins: [],
    markCount: 0,
  };

  let currentPicker: Picker | null = null;
  let detachReady: (() => void) | null = null;
  let detachIntent: (() => void) | null = null;
  let detachAddAnother: (() => void) | null = null;
  const pinDetachers: Array<() => void> = [];
  let prevIntentFocus: Element | null = null;

  function clearSurfaces(): void {
    if (currentPicker !== null) {
      currentPicker.detach();
      currentPicker = null;
    }
    if (detachReady !== null) {
      detachReady();
      detachReady = null;
    }
    if (detachIntent !== null) {
      detachIntent();
      detachIntent = null;
    }
    if (detachAddAnother !== null) {
      detachAddAnother();
      detachAddAnother = null;
    }
    for (const d of pinDetachers) d();
    pinDetachers.length = 0;
  }

  function render(): void {
    const { t } = i18n;
    const doc = opts.document;

    clearSurfaces();

    // Always mount the ready panel (hidden during picking)
    const readyEl = renderReady(host.dom, t, { onPick: startPicking }, state.picking);
    detachReady = host.mount(readyEl);

    // Picker mode
    if (state.picking) {
      const picker = attachPicker(doc, host.dom, t, {
        onHover: (target) => {
          state.hover = target;
        },
        onConfirm: (target) => {
          state.picking = false;
          state.hover = null;
          state.intent = target;
          render();
        },
        onEsc: () => {
          state.picking = false;
          state.hover = null;
          render();
        },
      });
      currentPicker = picker;
      // Mount mode indicator, selection frame, and breadcrumb into the host wrapper
      host.mount(picker.modeEl);
      host.mount(picker.frameEl);
      host.mount(picker.breadcrumbEl);
    }

    // Intent panel
    if (state.intent !== null) {
      prevIntentFocus = doc.activeElement;
      const view = doc.defaultView;
      const viewport: Viewport = {
        width: view?.innerWidth ?? 1024,
        height: view?.innerHeight ?? 768,
        scrollY: view?.scrollY ?? 0,
      };
      const intentEl = renderIntent(host.dom, t, state.intent.rect, viewport, {
        onSave: async (comment, kind) => {
          await doSave(state.intent!.element, comment, kind);
        },
        onCancel: () => {
          state.intent = null;
          if (prevIntentFocus !== null && typeof (prevIntentFocus as HTMLElement).focus === "function") {
            (prevIntentFocus as HTMLElement).focus();
          }
          render();
        },
      });
      detachIntent = host.mount(intentEl);
    }

    // Pins
    for (const pin of state.pins) {
      const view = opts.document.defaultView;
      const scrollY = view?.scrollY ?? 0;
      const vw = view?.innerWidth ?? 1024;
      const vh = view?.innerHeight ?? 768;
      const pinEl = renderPin(host.dom, pin, scrollY, vw, vh);
      pinDetachers.push(host.mount(pinEl));
    }
  }

  function startPicking(): void {
    state.picking = true;
    state.intent = null;
    render();
  }

  async function doSave(element: Element, comment: string, kind: IntentKind): Promise<void> {
    const doc = opts.document;
    const project = project_scope_from_url({ url: doc.location.href, title: doc.title });
    const locator = capture_locator(element);
    const resolution = resolve(locator, doc);
    const context = buildContext(element, doc);
    const now = new Date().toISOString();
    const draft: AnnotationDraft = {
      id: crypto.randomUUID(),
      project,
      locator,
      resolution,
      comment,
      intent_kind: kind,
      context,
      now,
    };
    const annotation = create_annotation(draft);
    const key = session_marks_key(project.project_id, project.session_id);

    if (opts.storage !== undefined) {
      const stored = await opts.storage.get(key);
      const existing = stored[key];
      const arr: unknown[] = Array.isArray(existing) ? (existing as unknown[]) : [];
      // Throws on storage failure → surface-intent shows inline error
      await opts.storage.set({ [key]: [...arr, annotation] });
    }

    // Capture pin position before clearing intent
    const rect = state.intent?.rect ?? element.getBoundingClientRect();
    state.markCount += 1;
    const pinRecord = {
      id: annotation.id,
      num: state.markCount,
      element,
      rect,
      kind,
    };
    state.pins.push(pinRecord);
    state.intent = null;
    render();

    // Show "Add another" near the new pin
    showAddAnother(rect);
  }

  function showAddAnother(pinRect: DOMRect): void {
    const { t } = i18n;
    const doc = opts.document;
    const view = doc.defaultView;
    const scrollY = view?.scrollY ?? 0;
    const vw = view?.innerWidth ?? 1024;
    const vh = view?.innerHeight ?? 768;

    const btn = host.dom.el("button", { class: "lp-add-another" }, [
      host.dom.el("span", { class: "lp-add-another-x", text: "+" }),
      host.dom.el("span", { text: t("intent.add") }),
    ]);

    const PAD = 8;
    const PANEL_WIDTH = 200;
    const left = Math.max(PAD, Math.min(pinRect.left + scrollY, vw - PANEL_WIDTH - PAD));
    const top = pinRect.top + scrollY + pinRect.height + PAD;

    btn.style.position = "absolute";
    btn.style.top = `${top}px`;
    btn.style.left = `${left}px`;

    btn.addEventListener("click", () => {
      if (detachAddAnother !== null) { detachAddAnother(); detachAddAnother = null; }
      startPicking();
    });

    // Auto-dismiss after 4s
    const timer = setTimeout(() => {
      if (detachAddAnother !== null) { detachAddAnother(); detachAddAnother = null; }
    }, 4000);

    const origDetach = host.mount(btn);
    detachAddAnother = () => {
      clearTimeout(timer);
      origDetach();
    };

    void vw; void vh;
  }

  // ⌥L global toggle: start / stop picking from anywhere on the page
  function onGlobalKey(e: KeyboardEvent): void {
    if (e.altKey && (e.key === "l" || e.key === "L")) {
      e.preventDefault();
      if (state.picking) {
        state.picking = false;
        state.hover = null;
        render();
      } else if (state.intent === null) {
        startPicking();
      }
    }
  }
  opts.document.addEventListener("keydown", onGlobalKey);

  const app: SurfaceApp = {
    unmount: () => {
      opts.document.removeEventListener("keydown", onGlobalKey);
      clearSurfaces();
      host.destroy();
    },
  };

  render();
  return app;
}

function buildContext(element: Element, doc: Document): AnnotationContextDraft {
  const view = doc.defaultView;
  const rect = element.getBoundingClientRect();
  const tag = element.tagName.toLowerCase();
  const classes = Array.from(element.classList).slice(0, 10);
  const rawText = element.textContent?.trim().slice(0, 120);
  const role = element.getAttribute("role");
  const ariaLabel = element.getAttribute("aria-label");

  const elCtx: AnnotationContextDraft["element"] = {
    tag,
    selector_preview: selectorPreview(element),
  };
  if (element.id.length > 0) elCtx.id = element.id;
  if (role !== null) elCtx.role = role;
  if (ariaLabel !== null) elCtx.accessible_name = ariaLabel;
  if (classes.length > 0) elCtx.classes = classes;
  if (rawText !== undefined && rawText.length > 0) elCtx.text = rawText;

  const a11y: NonNullable<AnnotationContextDraft["a11y"]> = {};
  if (role !== null) a11y.role = role;
  if (ariaLabel !== null) a11y.label = ariaLabel;

  return {
    element: elCtx,
    ...(Object.keys(a11y).length > 0 ? { a11y } : {}),
    viewport: {
      width: view?.innerWidth ?? 0,
      height: view?.innerHeight ?? 0,
      dpr: view?.devicePixelRatio ?? 1,
    },
    position: {
      x: Math.round(rect.left),
      y: Math.round(rect.top),
      width: Math.round(rect.width),
      height: Math.round(rect.height),
    },
  };
}

function selectorPreview(element: Element): string {
  const tag = element.tagName.toLowerCase();
  if (element.id.length > 0) return `${tag}#${element.id}`;
  const cls = Array.from(element.classList)
    .filter((c) => c.length < 32)
    .slice(0, 2)
    .join(".");
  return cls.length > 0 ? `${tag}.${cls}` : tag;
}

function defaultTheme(doc: Document): Theme {
  const view = doc.defaultView;
  if (view !== null && typeof view.matchMedia === "function") {
    return view.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  }
  return "light";
}

async function readPrefs(storage: UiStorage | undefined, doc: Document): Promise<Prefs> {
  const fallback: Prefs = { theme: defaultTheme(doc), lang: "zh" };
  if (storage === undefined) return fallback;
  try {
    const stored = await storage.get(PREFS_KEY);
    const value = stored[PREFS_KEY];
    if (!isRecord(value)) return fallback;
    return {
      theme: value.theme === "dark" ? "dark" : value.theme === "light" ? "light" : fallback.theme,
      lang: value.lang === "en" ? "en" : "zh",
    };
  } catch {
    return fallback;
  }
}

async function writePrefs(storage: UiStorage | undefined, prefs: Prefs): Promise<void> {
  if (storage === undefined) return;
  try {
    await storage.set({ [PREFS_KEY]: prefs });
  } catch {
    // local-only UI preference; persistence failure is non-fatal.
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
