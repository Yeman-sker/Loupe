"use client";

import { useLanding } from "./context";
import { Sandbox } from "./Sandbox";

const GH = "https://github.com/Yeman-sker/Loupe";

export function Hero() {
  const { t } = useLanding();
  // title carries a hard line break in the dictionary
  const title = t("hero.title").split("\n");
  return (
    <section className="hero" id="top">
      <div className="hero-copy">
        <span className="eyebrow">{t("hero.eyebrow")}</span>
        <h1 className="hero-title">
          {title.map((line, i) => (
            <span key={i} className="hero-line">
              {line}
            </span>
          ))}
        </h1>
        <p className="hero-sub">{t("hero.sub")}</p>
        <div className="hero-cta">
          <a className="btn primary" href={GH} target="_blank" rel="noreferrer">
            {t("footer.github")}
          </a>
          <a className="btn ghost" href="#install">
            {t("install.title")} →
          </a>
        </div>
      </div>

      <div className="hero-demo">
        <Sandbox />
      </div>
    </section>
  );
}
