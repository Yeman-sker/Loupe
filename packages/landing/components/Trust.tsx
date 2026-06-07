"use client";

import { useLanding } from "./context";
import type { DictKey } from "../app/i18n";

const CARDS: { t: DictKey; b: DictKey; glyph: string }[] = [
  { t: "trust.c1.t", b: "trust.c1.b", glyph: "◎" },
  { t: "trust.c2.t", b: "trust.c2.b", glyph: "▣" },
  { t: "trust.c3.t", b: "trust.c3.b", glyph: "◇" },
  { t: "trust.c4.t", b: "trust.c4.b", glyph: "✓" },
];

export function Trust() {
  const { t } = useLanding();
  return (
    <section className="sec sec-trust" id="trust">
      <div className="sec-head">
        <span className="eyebrow">{t("trust.eyebrow")}</span>
        <h2>{t("trust.title")}</h2>
      </div>
      <div className="trust-grid">
        {CARDS.map((c) => (
          <div className="trust-card" key={c.t}>
            <span className="trust-glyph" aria-hidden="true">
              {c.glyph}
            </span>
            <h3>{t(c.t)}</h3>
            <p>{t(c.b)}</p>
          </div>
        ))}
      </div>
    </section>
  );
}
