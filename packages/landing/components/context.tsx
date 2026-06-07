"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { translate, type DictKey, type Lang } from "../app/i18n";
import type { DemoMark } from "./types";

type Theme = "light" | "dark";

type Ctx = {
  theme: Theme;
  setTheme: (t: Theme) => void;
  lang: Lang;
  setLang: (l: Lang) => void;
  t: (key: DictKey) => string;
  // the single demo mark, shared between the hero sandbox and the agent terminal
  mark: DemoMark | null;
  setMark: (m: DemoMark | null) => void;
  resolveMark: () => void;
};

const LandingCtx = createContext<Ctx | null>(null);

export function LandingProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<Theme>("dark");
  const [lang, setLangState] = useState<Lang>("en");
  const [mark, setMark] = useState<DemoMark | null>(null);

  // hydrate persisted prefs (default stays dark/en for SSR)
  useEffect(() => {
    try {
      const st = localStorage.getItem("loupe-theme") as Theme | null;
      const sl = localStorage.getItem("loupe-lang") as Lang | null;
      if (st === "light" || st === "dark") setThemeState(st);
      if (sl === "en" || sl === "zh") setLangState(sl);
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    try {
      localStorage.setItem("loupe-theme", theme);
    } catch {
      /* ignore */
    }
  }, [theme]);

  useEffect(() => {
    document.documentElement.setAttribute("lang", lang);
    try {
      localStorage.setItem("loupe-lang", lang);
    } catch {
      /* ignore */
    }
  }, [lang]);

  const setTheme = useCallback((tn: Theme) => setThemeState(tn), []);
  const setLang = useCallback((l: Lang) => setLangState(l), []);
  const t = useCallback((key: DictKey) => translate(key, lang), [lang]);
  const resolveMark = useCallback(
    () => setMark((m) => (m ? { ...m, task: "done" } : m)),
    [],
  );

  const value = useMemo<Ctx>(
    () => ({ theme, setTheme, lang, setLang, t, mark, setMark, resolveMark }),
    [theme, setTheme, lang, setLang, t, mark, resolveMark],
  );

  return <LandingCtx.Provider value={value}>{children}</LandingCtx.Provider>;
}

export function useLanding(): Ctx {
  const c = useContext(LandingCtx);
  if (!c) throw new Error("useLanding must be used within LandingProvider");
  return c;
}
