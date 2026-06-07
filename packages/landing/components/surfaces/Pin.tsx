import type { DemoMark } from "../types";

// Optical reticle marker: surface-filled ring + mono number + kind-accent arc.
// Open pins emit a slow iris focus pulse; done pins dim with a ✓ badge.
export function Pin({
  mark,
  style,
  onOpen,
}: {
  mark: DemoMark;
  style: { left: number; top: number };
  onOpen?: () => void;
}) {
  const done = mark.task === "done";
  const cls = ["pin", done ? "done" : "open"].join(" ");
  return (
    <button
      className={cls}
      data-kind={mark.kind}
      style={{ position: "absolute", ...style }}
      onClick={(e) => {
        e.stopPropagation();
        onOpen?.();
      }}
      aria-label={`Mark ${mark.num} — ${mark.comment}`}
    >
      {!done ? <span className="pulse" /> : null}
      <span className="ring">
        <span className="num mono">{mark.num}</span>
      </span>
      <svg className="arc" viewBox="0 0 24 24" aria-hidden="true">
        <circle cx="12" cy="12" r="11" strokeDasharray="16 60" transform="rotate(-58 12 12)" />
      </svg>
      {done ? (
        <span className="badge" aria-hidden="true">
          ✓
        </span>
      ) : null}
    </button>
  );
}
