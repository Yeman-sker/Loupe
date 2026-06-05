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
.lp-intent{position:absolute;pointer-events:auto;z-index:2}
.lp-intent-shell{padding:10px 12px;display:flex;flex-direction:column;gap:8px}
.lp-intent-pip{display:inline-block;width:6px;height:6px;border-radius:50%;
  background:var(--iris);flex-shrink:0;margin-right:5px}
.lp-intent-targ{display:flex;align-items:center;font-size:10.5px;color:var(--ink-3);
  font-family:var(--mono)}
.lp-intent-row{display:flex;align-items:flex-start;gap:8px}
.lp-intent-field{flex:1;min-height:54px;max-height:88px;resize:none;
  font:400 13.5px/1.5 var(--font);color:var(--ink);
  background:var(--field);border:var(--hair) solid var(--field-line);
  border-radius:var(--r-md);padding:8px 10px;letter-spacing:-.006em;
  outline:none;transition:border-color var(--dur) var(--ease),box-shadow var(--dur) var(--ease)}
.lp-intent-field:focus{border-color:var(--iris);box-shadow:var(--ring)}
.lp-intent-submit{width:33px;height:33px;flex-shrink:0;
  border-radius:var(--r-pin);border:none;cursor:pointer;
  background:var(--k,var(--iris));color:var(--iris-fg);
  display:inline-flex;align-items:center;justify-content:center;
  transition:transform var(--dur-fast) var(--ease),background var(--dur) var(--ease)}
.lp-intent-submit:hover:not([disabled]){transform:translateY(-1px)}
.lp-intent-submit[disabled]{opacity:.38;cursor:not-allowed}
.lp-kindrail{display:flex;align-items:center;gap:5px;padding-top:2px}
.lp-kindrail-label{font-size:9.5px;color:var(--ink-3);letter-spacing:.03em;
  text-transform:uppercase;font-family:var(--mono);margin-right:3px}
.lp-kind-btn{width:14px;height:14px;border-radius:50%;border:none;cursor:pointer;
  background:var(--k,var(--iris-veil));padding:0;
  transition:transform var(--dur-fast) var(--ease),box-shadow var(--dur) var(--ease)}
.lp-kind-btn:hover{transform:scale(1.25)}
.lp-kind-btn--sel{box-shadow:0 0 0 2.5px color-mix(in srgb,var(--k,var(--iris)) 28%,transparent)}

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
  const pinDetachers: Array<() => void> = [];

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
      // Mount mode indicator and selection frame into the host wrapper
      host.mount(picker.modeEl);
      host.mount(picker.frameEl);
    }

    // Intent panel
    if (state.intent !== null) {
      const view = doc.defaultView;
      const viewport: Viewport = {
        width: view?.innerWidth ?? 1024,
        height: view?.innerHeight ?? 768,
        scrollY: view?.scrollY ?? 0,
      };
      const intentEl = renderIntent(host.dom, t, state.intent.rect, viewport, {
        onSave: (comment, kind) => {
          void doSave(state.intent!.element, comment, kind);
        },
        onCancel: () => {
          state.intent = null;
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
    try {
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
        await opts.storage.set({ [key]: [...arr, annotation] });
      }

      // Capture pin position before clearing intent
      const rect = state.intent?.rect ?? element.getBoundingClientRect();
      state.markCount += 1;
      state.pins.push({
        id: annotation.id,
        num: state.markCount,
        element,
        rect,
        kind,
      });
      state.intent = null;
      render();
    } catch {
      // Local-only save failure is non-fatal; intent panel stays open
    }
  }

  const app: SurfaceApp = {
    unmount: () => {
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
