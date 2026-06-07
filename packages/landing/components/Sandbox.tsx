"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useLanding } from "./context";
import { MockHost } from "./surfaces/MockHost";
import { SelectionFrame, type Label, type Rect } from "./surfaces/SelectionFrame";
import { IntentInput } from "./surfaces/IntentInput";
import { Pin } from "./surfaces/Pin";
import type { DemoMark, Kind } from "./types";

type Hover = { id: string; rect: Rect; label: Label };
type Intent = {
  hostId: string;
  target: Label;
  sel: string;
  anchor: { left: number; top: number };
};

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

// Read an element's rect relative to the sandbox container (overlay is
// position:absolute over the container — never viewport-fixed).
function relRect(el: Element, container: HTMLElement): Rect {
  const r = el.getBoundingClientRect();
  const c = container.getBoundingClientRect();
  return { x: r.left - c.left, y: r.top - c.top, w: r.width, h: r.height };
}
function labelOf(el: Element): Label {
  return {
    tag: el.getAttribute("data-tag") || "div",
    name: el.getAttribute("data-name") || "",
  };
}

export function Sandbox() {
  const { t, lang, mark, setMark } = useLanding();
  const stageRef = useRef<HTMLDivElement>(null);

  const [picking, setPicking] = useState(true);
  const [hover, setHover] = useState<Hover | null>(null);
  const [intent, setIntent] = useState<Intent | null>(null);
  const [pinPos, setPinPos] = useState<{ left: number; top: number } | null>(null);

  const pinCorner = useCallback((rect: Rect): { left: number; top: number } => {
    const stage = stageRef.current;
    const maxX = stage ? stage.clientWidth - 14 : rect.x + rect.w;
    const maxY = stage ? stage.clientHeight - 14 : rect.y;
    return { left: clamp(rect.x + rect.w, 14, maxX), top: clamp(rect.y, 14, maxY) };
  }, []);

  // hover tracking — scoped to the stage; only [data-pick] inside it ever resolves
  useEffect(() => {
    const stage = stageRef.current;
    if (!stage || !picking) {
      if (!picking) setHover(null);
      return;
    }
    const onMove = (e: PointerEvent) => {
      const el = (e.target as Element)?.closest?.("[data-pick]");
      if (!el) {
        setHover(null);
        return;
      }
      setHover({ id: el.getAttribute("data-pick")!, rect: relRect(el, stage), label: labelOf(el) });
    };
    const onLeave = () => setHover(null);
    const onClick = (e: MouseEvent) => {
      const el = (e.target as Element)?.closest?.("[data-pick]");
      if (!el) return;
      e.preventDefault();
      e.stopPropagation();
      const rect = relRect(el, stage);
      const w = 380;
      const left = clamp(rect.x, 8, stage.clientWidth - w - 8);
      let top = rect.y + rect.h + 10;
      if (top + 210 > stage.clientHeight - 8) top = Math.max(8, rect.y - 210);
      setHover(null);
      setPicking(false);
      setIntent({
        hostId: el.getAttribute("data-pick")!,
        target: labelOf(el),
        sel: el.getAttribute("data-sel") || "",
        anchor: { left, top },
      });
    };
    stage.addEventListener("pointermove", onMove);
    stage.addEventListener("pointerleave", onLeave);
    stage.addEventListener("click", onClick, true);
    return () => {
      stage.removeEventListener("pointermove", onMove);
      stage.removeEventListener("pointerleave", onLeave);
      stage.removeEventListener("click", onClick, true);
    };
  }, [picking]);

  // re-measure the committed pin on resize (stay container-relative)
  const measurePin = useCallback(() => {
    const stage = stageRef.current;
    if (!stage || !mark) return;
    const el = stage.querySelector(`[data-pick="${mark.hostId}"]`);
    if (el) setPinPos(pinCorner(relRect(el, stage)));
  }, [mark, pinCorner]);
  useLayoutEffect(() => {
    measurePin();
  }, [measurePin]);
  useEffect(() => {
    const on = () => measurePin();
    window.addEventListener("resize", on);
    if (document.fonts?.ready) document.fonts.ready.then(on).catch(() => {});
    return () => window.removeEventListener("resize", on);
  }, [measurePin]);

  const onSave = ({ comment, kind }: { comment: string; kind: Kind }) => {
    if (!intent) return;
    const m: DemoMark = {
      id: "mk_" + Math.random().toString(36).slice(2, 8),
      num: 1,
      hostId: intent.hostId,
      kind,
      comment,
      task: "open",
      targetTag: intent.target.tag,
      targetSel: intent.sel,
      targetName: intent.target.name,
    };
    setIntent(null);
    setMark(m);
  };

  const reset = () => {
    setMark(null);
    setPinPos(null);
    setIntent(null);
    setPicking(true);
  };

  return (
    <div className="loupe-sandbox">
      <div className="sb-caption">
        <span className="sb-dot" />
        {t("hero.try")}
      </div>
      <div className={"sb-stage" + (picking ? " is-picking" : "")} ref={stageRef}>
        <MockHost title="Account settings" sub="Manage your profile, sign-in and notification preferences." />

        <div className="loupe-layer">
          {picking && hover ? <SelectionFrame rect={hover.rect} label={hover.label} /> : null}

          {intent ? (
            <IntentInput
              anchor={intent.anchor}
              target={intent.target}
              lang={lang}
              onSave={onSave}
              onCancel={() => {
                setIntent(null);
                setPicking(true);
              }}
            />
          ) : null}

          {mark && pinPos ? <Pin mark={mark} style={pinPos} /> : null}

          {picking ? (
            <div className="mode-ind">
              <span className="dot" />
              {t("hero.picking")}
            </div>
          ) : null}
        </div>
      </div>

      <div className="sb-foot">
        {mark ? (
          <button className="add-another" onClick={reset}>
            <span className="x">+</span>
            {lang === "zh" ? "再标一个" : "Mark another"}
          </button>
        ) : (
          <span className="sb-hint mono">{t("hero.hint")}</span>
        )}
      </div>
    </div>
  );
}
