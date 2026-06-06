import type { Theme } from "../core/host.js";
import type { Lang } from "../core/i18n.js";
import type { UiStorage } from "./app.js";

const PREFS_KEY = "loupe:v1:ui:prefs";

export type Prefs = { theme: Theme; lang: Lang };

function defaultTheme(doc: Document): Theme {
  const view = doc.defaultView;
  if (view !== null && typeof view.matchMedia === "function") {
    return view.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  }
  return "light";
}

export async function readPrefs(storage: UiStorage | undefined, doc: Document): Promise<Prefs> {
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
