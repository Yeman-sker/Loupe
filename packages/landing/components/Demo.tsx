"use client";

import { useLanding } from "./context";
import { Sandbox } from "./Sandbox";

// Act 2 · the interactive demo, now its own full-width screen below the hero
// (the hero carries the brand animation instead). The mark made here streams
// into the agent terminal in the next act via shared context.
export function Demo() {
  const { t } = useLanding();
  return (
    <section className="sec demo-sec" id="demo">
      <div className="sec-head">
        <span className="eyebrow">{t("demo.eyebrow")}</span>
        <h2>{t("demo.title")}</h2>
        <p className="sec-sub">{t("demo.sub")}</p>
      </div>
      <div className="demo-stage-wrap">
        <Sandbox />
      </div>
    </section>
  );
}
