"use client";

import { useLanding } from "./context";

export function Pain() {
  const { t } = useLanding();
  return (
    <section className="sec sec-pain" id="why">
      <div className="sec-head">
        <span className="eyebrow">{t("pain.eyebrow")}</span>
        <h2>{t("pain.title")}</h2>
      </div>

      <div className="pain-grid">
        <div className="pain-col before">
          <div className="pain-tag">{t("pain.beforeTitle")}</div>
          <p>{t("pain.before")}</p>
        </div>
        <div className="pain-arrow" aria-hidden="true">
          →
        </div>
        <div className="pain-col after">
          <div className="pain-tag">{t("pain.afterTitle")}</div>
          <p>{t("pain.after")}</p>
        </div>
      </div>

      <div className="pain-lost">
        <span className="pain-lost-k mono">{t("pain.lostLabel")}</span>
        <span className="pain-lost-v">{t("pain.lost")}</span>
      </div>
    </section>
  );
}
