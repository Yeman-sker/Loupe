"use client";

import { useLanding } from "./context";
import { buildAgentMark } from "./types";

// Act 2 · Agent side. A mock terminal showing the AgentMark the visitor's mark
// produces when read over MCP (list_marks), then closing the loop with
// resolve_mark. Demo-generated evidence — not a live engine.
export function AgentClose() {
  const { t, mark, resolveMark } = useLanding();
  const resolved = mark?.task === "done";
  const payload = mark ? buildAgentMark(mark) : null;

  return (
    <section className="sec sec-agent" id="agent">
      <div className="sec-head">
        <span className="eyebrow">{t("agent.eyebrow")}</span>
        <h2>{t("agent.title")}</h2>
        <p className="sec-sub">{t("agent.sub")}</p>
      </div>

      <div className="term">
        <div className="term-bar">
          <span className="tb-dot" />
          <span className="tb-dot" />
          <span className="tb-dot" />
          <span className="tb-title mono">agent · loupe mcp</span>
        </div>

        <div className="term-body mono">
          {!payload ? (
            <div className="term-idle">
              <span className="prompt">$</span> <span className="comment"># {t("agent.idle")}</span>
              <span className="caret" />
            </div>
          ) : (
            <>
              <div className="term-line">
                <span className="prompt">›</span> list_marks{" "}
                <span className="json-punc">{"{"}</span> project_id:{" "}
                <span className="json-str">&quot;app-web&quot;</span>, task_status:{" "}
                <span className="json-str">&quot;open&quot;</span>{" "}
                <span className="json-punc">{"}"}</span>
              </div>
              <Json value={{ project: payload.project.project_id, marks: 1 }} compact />
              <div className="term-line term-gap">
                <span className="prompt">›</span> get_mark{" "}
                <span className="json-punc">{"{"}</span> id:{" "}
                <span className="json-str">&quot;{payload.id}&quot;</span>{" "}
                <span className="json-punc">{"}"}</span>
              </div>
              <Json value={payload} />

              {resolved ? (
                <>
                  <div className="term-line term-gap">
                    <span className="prompt">›</span> resolve_mark{" "}
                    <span className="json-punc">{"{"}</span> id:{" "}
                    <span className="json-str">&quot;{payload.id}&quot;</span>, resolution_note:{" "}
                    <span className="json-str">&quot;done&quot;</span>{" "}
                    <span className="json-punc">{"}"}</span>
                  </div>
                  <Json value={{ ok: true, task_status: "resolved" }} compact />
                  <div className="term-ok">✓ {t("agent.resolved")}</div>
                </>
              ) : (
                <button className="term-cta" onClick={resolveMark}>
                  {t("agent.resolve")}
                </button>
              )}
            </>
          )}
        </div>
      </div>
    </section>
  );
}

// Minimal JSON renderer with key/string/number tinting.
function Json({ value, compact }: { value: unknown; compact?: boolean }) {
  const text = JSON.stringify(value, null, compact ? 0 : 2);
  return <pre className={"term-json" + (compact ? " compact" : "")}>{colorize(text)}</pre>;
}

function colorize(json: string) {
  // tokenize on quotes/numbers/punctuation for lightweight syntax color
  const parts = json.split(/("(?:\\.|[^"\\])*"(?:\s*:)?|\b-?\d+(?:\.\d+)?\b|\btrue\b|\bfalse\b|\bnull\b)/g);
  return parts.map((p, i) => {
    if (!p) return null;
    if (/^"/.test(p)) {
      const isKey = /:\s*$/.test(p);
      return (
        <span key={i} className={isKey ? "json-key" : "json-str"}>
          {p}
        </span>
      );
    }
    if (/^(true|false|null)$/.test(p)) return <span key={i} className="json-bool">{p}</span>;
    if (/^-?\d/.test(p)) return <span key={i} className="json-num">{p}</span>;
    return <span key={i} className="json-punc">{p}</span>;
  });
}
