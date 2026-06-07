"use client";

import { useState } from "react";
import { useLanding } from "./context";
import { LoupeMark, Toggles } from "./Chrome";

const GH = "https://github.com/Yeman-sker/Loupe";

export function Footer() {
  const { t } = useLanding();
  const [email, setEmail] = useState("");
  const [joined, setJoined] = useState(false);
  return (
    <footer className="footer" id="footer">
      <div className="footer-top">
        <div className="footer-brand">
          <LoupeMark size={30} />
          <div>
            <div className="footer-wm">Loupe</div>
            <div className="footer-tag">{t("footer.tagline")}</div>
          </div>
        </div>

        <div className="footer-cta">
          <a className="btn primary" href={GH} target="_blank" rel="noreferrer">
            {t("footer.github")}
          </a>
          {/* waitlist is a secondary, no-backend stub for this phase */}
          <form
            className="waitlist"
            onSubmit={(e) => {
              e.preventDefault();
              if (email.trim()) setJoined(true);
            }}
          >
            {joined ? (
              <span className="waitlist-ok">{t("footer.waitlist.ok")}</span>
            ) : (
              <>
                <input
                  type="email"
                  required
                  placeholder={t("footer.waitlist.ph")}
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
                <button className="btn ghost" type="submit">
                  {t("footer.waitlist")}
                </button>
              </>
            )}
          </form>
        </div>
      </div>

      <div className="footer-bot">
        <span className="footer-built mono">{t("footer.built")}</span>
        <Toggles />
      </div>
    </footer>
  );
}
