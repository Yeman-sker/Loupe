"use client";

import { useState } from "react";
import { useLanding } from "./context";

// Step 1 daemon install — opencode-style package-manager tabs. The published
// package is @loupe-server/server@0.4.0 (bin `loupe`). brew has no formula yet.
const MANAGERS: { id: string; label: string; cmd: string; soon?: boolean }[] = [
  { id: "npm", label: "npm", cmd: "npm i -g @loupe-server/server" },
  { id: "pnpm", label: "pnpm", cmd: "pnpm add -g @loupe-server/server" },
  { id: "bun", label: "bun", cmd: "bun add -g @loupe-server/server" },
  { id: "npx", label: "npx", cmd: "npx -y @loupe-server/server serve" },
  { id: "brew", label: "brew", cmd: "# Homebrew formula coming soon", soon: true },
];

const GH = "https://github.com/Yeman-sker/Loupe";

function Copyable({ text }: { text: string }) {
  const { t } = useLanding();
  const [ok, setOk] = useState(false);
  return (
    <button
      className="copy-btn"
      onClick={() => {
        navigator.clipboard?.writeText(text).then(
          () => {
            setOk(true);
            setTimeout(() => setOk(false), 1200);
          },
          () => {},
        );
      }}
      aria-label={t("install.copy")}
    >
      {ok ? t("install.copied") : t("install.copy")}
    </button>
  );
}

function DaemonWidget() {
  const [active, setActive] = useState("npm");
  const cur = MANAGERS.find((m) => m.id === active)!;
  const runLine = active === "npx" ? null : "loupe serve";
  return (
    <div className="iw">
      <div className="iw-tabs" role="tablist">
        {MANAGERS.map((m) => (
          <button
            key={m.id}
            role="tab"
            aria-selected={active === m.id}
            className={"iw-tab" + (active === m.id ? " on" : "")}
            onClick={() => setActive(m.id)}
          >
            {m.label}
          </button>
        ))}
      </div>
      <div className="iw-body">
        <div className="iw-line">
          <code className="mono">
            <span className="iw-prompt">$</span> {cur.cmd}
          </code>
          {!cur.soon ? <Copyable text={cur.cmd} /> : null}
        </div>
        {runLine ? (
          <div className="iw-line iw-run">
            <code className="mono">
              <span className="iw-prompt">$</span> {runLine}{" "}
              <span className="iw-muted"># starts on 127.0.0.1:7373</span>
            </code>
            <Copyable text={runLine} />
          </div>
        ) : null}
      </div>
    </div>
  );
}

export function Install() {
  const { t } = useLanding();
  return (
    <section className="sec sec-install" id="install">
      <div className="sec-head">
        <span className="eyebrow">{t("install.eyebrow")}</span>
        <h2>{t("install.title")}</h2>
        <p className="sec-sub">{t("install.sub")}</p>
      </div>

      <ol className="steps">
        <li className="step">
          <div className="step-k mono">{t("install.s1.k")}</div>
          <div className="step-main">
            <h3>{t("install.s1.t")}</h3>
            <p>{t("install.s1.b")}</p>
            <DaemonWidget />
          </div>
        </li>

        <li className="step">
          <div className="step-k mono">{t("install.s2.k")}</div>
          <div className="step-main">
            <h3>
              {t("install.s2.t")} <span className="step-badge">{t("install.soon")}</span>
            </h3>
            <p>{t("install.s2.b")}</p>
            <a className="step-link" href={`${GH}#chrome-extension`} target="_blank" rel="noreferrer">
              {t("install.s2.cta")} →
            </a>
          </div>
        </li>

        <li className="step">
          <div className="step-k mono">{t("install.s3.k")}</div>
          <div className="step-main">
            <h3>
              {t("install.s3.t")} <span className="step-badge">{t("install.soon")}</span>
            </h3>
            <p>{t("install.s3.b")}</p>
          </div>
        </li>
      </ol>
    </section>
  );
}
