import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { KINDS, type Kind } from "../types";
import type { Lang } from "../../app/i18n";

type Target = { tag: string; name: string };

const PH: Record<Lang, string> = {
  en: "Tell the agent what to change…",
  zh: "告诉 agent 你想改什么…",
};
const KIND_LABEL: Record<Kind, [string, string]> = {
  bug: ["bug", "缺陷"],
  copy: ["copy", "文案"],
  style: ["style", "样式"],
  layout: ["layout", "布局"],
  question: ["question", "疑问"],
  other: ["other", "其他"],
};

// Floating intent shell anchored to the target. ⌘/Ctrl+Enter saves (plain Enter
// does not, for IME). On save it collapses toward the pin corner.
export function IntentInput({
  anchor,
  target,
  lang,
  onSave,
  onCancel,
}: {
  anchor: { left: number; top: number };
  target: Target;
  lang: Lang;
  onSave: (v: { comment: string; kind: Kind }) => void;
  onCancel: () => void;
}) {
  const [comment, setComment] = useState("");
  const [kind, setKind] = useState<Kind>("other");
  const [hint, setHint] = useState(false);
  const [collapsing, setCollapsing] = useState(false);
  const taRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const id = setTimeout(() => taRef.current?.focus(), 30);
    return () => clearTimeout(id);
  }, []);

  const grow = (el: HTMLTextAreaElement | null) => {
    if (!el) return;
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 88) + "px";
  };
  useLayoutEffect(() => grow(taRef.current));

  const empty = !comment.trim();
  const fire = () => {
    if (empty) {
      setHint(true);
      taRef.current?.focus();
      return;
    }
    setCollapsing(true);
    setTimeout(() => onSave({ comment: comment.trim(), kind }), 320);
  };

  return (
    <div
      className={"intent" + (hint ? " show-hint" : "") + (collapsing ? " collapsing" : "")}
      data-kind={kind}
      style={{ position: "absolute", ...anchor }}
      onKeyDown={(e) => {
        if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
          e.preventDefault();
          fire();
        } else if (e.key === "Escape") {
          e.preventDefault();
          onCancel();
        }
      }}
    >
      <div className="intent-shell">
        <div className="intent-targ">
          <span className="pip" />
          <span className="mono">
            {target.tag} {target.name}
          </span>
        </div>
        <div className="intent-row">
          <textarea
            ref={taRef}
            className="intent-field"
            rows={1}
            placeholder={PH[lang]}
            value={comment}
            onChange={(e) => {
              setComment(e.target.value);
              if (e.target.value.trim()) setHint(false);
              grow(e.target);
            }}
          />
          <button
            className="intent-submit"
            disabled={empty}
            title="Save · ⌘↵"
            aria-label="Save mark"
            onClick={fire}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 19V5" />
              <path d="m6 11 6-6 6 6" />
            </svg>
          </button>
        </div>
        <div className="kindrail" role="listbox" aria-label="Kind">
          <span className="lab">KIND</span>
          {KINDS.map((k) => (
            <button
              key={k}
              className={"kind" + (kind === k ? " sel" : "")}
              data-kind={k}
              role="option"
              aria-selected={kind === k}
              style={{ ["--kc" as string]: `var(--k-${k})` }}
              title={lang === "zh" ? KIND_LABEL[k][1] : KIND_LABEL[k][0]}
              onClick={() => setKind(k)}
            >
              <span className="kd" />
              <span className="kn">{KIND_LABEL[k][0]}</span>
            </button>
          ))}
        </div>
      </div>
      <div className="intent-hint">{lang === "zh" ? "先写一句任务" : "Write a task first"}</div>
      <div className="intent-foot">
        <span className="hintkey mono">⌘↵</span>
      </div>
    </div>
  );
}
