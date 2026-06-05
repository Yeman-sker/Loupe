// Surface runtime entry. content.js dynamically imports this after host
// authorization and calls mount(). For UI-0 it renders a single smoke surface
// that exercises the whole pipeline (render core, Shadow host, tokens, fonts,
// i18n, status tokens, theme switch, reduced-motion entrance). UI-1 replaces
// renderSmoke() with the real auth/picker/intent/pin surfaces.

import { createSurfaceHost, SURFACE_ROOT_ID, type SurfaceHost, type Theme } from "./host.js";
import { createI18n, type Lang } from "./i18n.js";
import { locatorToken, syncToken, taskToken, kindToken, type TokenSpec } from "./status-tokens.js";

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

export async function mount(opts: MountOptions): Promise<SurfaceApp> {
  if (opts.document.getElementById(SURFACE_ROOT_ID) !== null) return { unmount: () => {} };

  const prefs = await readPrefs(opts.storage, opts.document);
  const i18n = createI18n(prefs.lang);
  const host = createSurfaceHost({ document: opts.document, baseUrl: opts.baseUrl, theme: prefs.theme });

  const persist = (): void => {
    void writePrefs(opts.storage, { theme: host.getTheme(), lang: i18n.lang() });
  };

  let detach = (): void => {};
  const render = (): void => {
    detach();
    detach = host.mount(renderSmoke(host, i18n, { onToggleTheme, onToggleLang, onClose }));
  };

  function onToggleTheme(): void {
    host.setTheme(host.getTheme() === "light" ? "dark" : "light");
    persist();
    render();
  }
  function onToggleLang(): void {
    i18n.setLang(i18n.lang() === "zh" ? "en" : "zh");
    persist();
    render();
  }
  function onClose(): void {
    app.unmount();
  }

  const app: SurfaceApp = {
    unmount: () => {
      detach();
      host.destroy();
    },
  };

  render();
  return app;
}

type SmokeHandlers = {
  onToggleTheme: () => void;
  onToggleLang: () => void;
  onClose: () => void;
};

function renderSmoke(host: SurfaceHost, i18n: ReturnType<typeof createI18n>, handlers: SmokeHandlers): HTMLElement {
  const { dom } = host;
  const { t } = i18n;

  const tokenSpecs: TokenSpec[] = [
    taskToken(t, "open"),
    locatorToken(t, "resolved", 1),
    locatorToken(t, "drifted", 0.62),
    locatorToken(t, "lost"),
    syncToken(t, "synced"),
    syncToken(t, "local_only"),
    syncToken(t, "failed"),
    kindToken(t, "style"),
  ];

  const brand = dom.el("div", { class: "lp-brand" }, [
    dom.el("span", { class: "lp-dot" }),
    dom.el("span", { class: "lp-wm", text: "Loupe" }),
    dom.el("button", {
      class: "btn ghost lp-x",
      attrs: { type: "button", "aria-label": t("va.close") },
      text: "✕",
      on: { click: handlers.onClose },
    }),
  ]);

  const sub = dom.el("p", { class: "lp-sub", text: t("auth.body") });

  const toks = dom.el(
    "div",
    { class: "lp-toks" },
    tokenSpecs.map((spec) => tokenEl(dom, spec)),
  );

  const controls = dom.el("div", { class: "lp-controls" }, [
    dom.el("button", {
      class: "btn ghost",
      attrs: { type: "button", "aria-label": t("ui.theme") },
      text: host.getTheme() === "light" ? "☾ Dark" : "☀ Light",
      on: { click: handlers.onToggleTheme },
    }),
    dom.el("button", {
      class: "btn ghost",
      attrs: { type: "button", "aria-label": t("ui.lang") },
      text: i18n.lang() === "zh" ? "EN" : "中",
      on: { click: handlers.onToggleLang },
    }),
  ]);

  return dom.el("div", { class: "card lp-smoke anim-pop", attrs: { role: "dialog", "aria-label": "Loupe" } }, [
    brand,
    sub,
    toks,
    controls,
  ]);
}

function tokenEl(dom: SurfaceHost["dom"], spec: TokenSpec): HTMLElement {
  const props = spec.kind === undefined ? { class: `tok tok--${spec.cls}` } : { class: `tok tok--${spec.cls}`, data: { kind: spec.kind } };
  return dom.el("span", props, [
    dom.el("span", { class: "g", attrs: { "aria-hidden": "true" }, text: spec.glyph }),
    dom.el("span", { text: spec.label }),
  ]);
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
