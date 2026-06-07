"use client";

import { useLanding } from "./context";

export function LoupeMark({ size = 30 }: { size?: number }) {
  return (
    <svg className="loupe-mark" width={size} height={size} viewBox="0 0 40 40" fill="none" aria-hidden="true">
      <circle cx="17" cy="17" r="13" stroke="var(--ink)" strokeWidth="2.4" />
      <circle cx="17" cy="17" r="6" stroke="var(--iris)" strokeWidth="2.4" />
      <path d="M17 1.5v4M17 28.5v4M1.5 17h4M28.5 17h4" stroke="var(--ink)" strokeWidth="2" strokeLinecap="round" />
      <path d="m26.5 26.5 9 9" stroke="var(--ink)" strokeWidth="3.2" strokeLinecap="round" />
    </svg>
  );
}

// Theme + language toggles. The language toggle switches the shell and the
// sandbox in one move; technical terms stay English in both.
export function Toggles() {
  const { theme, setTheme, lang, setLang, t } = useLanding();
  return (
    <div className="toggles">
      <div className="seg" role="group" aria-label="Theme">
        <button aria-pressed={theme === "light"} onClick={() => setTheme("light")}>
          {t("theme.light")}
        </button>
        <button aria-pressed={theme === "dark"} onClick={() => setTheme("dark")}>
          {t("theme.dark")}
        </button>
      </div>
      <div className="seg" role="group" aria-label="Language">
        <button aria-pressed={lang === "zh"} onClick={() => setLang("zh")}>
          中
        </button>
        <button aria-pressed={lang === "en"} onClick={() => setLang("en")}>
          EN
        </button>
      </div>
    </div>
  );
}

export function TopBar() {
  return (
    <header className="topbar">
      <a className="brand" href="#top">
        <LoupeMark size={26} />
        <span className="brand-wm">Loupe</span>
      </a>
      <Toggles />
    </header>
  );
}
