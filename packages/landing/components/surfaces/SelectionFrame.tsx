// Viewfinder corner-brackets that morph between target rects. Rects are
// container-relative (the sandbox overlay is position:absolute, not viewport-fixed).
export type Rect = { x: number; y: number; w: number; h: number };
export type Label = { tag: string; name: string };

export function SelectionFrame({ rect, label }: { rect: Rect | null; label: Label | null }) {
  if (!rect || !label) return null;
  const st = {
    transform: `translate(${rect.x}px,${rect.y}px)`,
    width: rect.w,
    height: rect.h,
  };
  return (
    <div className="selframe" style={st} aria-hidden="true">
      <div className="veil" />
      <div className="edge" />
      <span className="br tl" />
      <span className="br tr" />
      <span className="br bl" />
      <span className="br br2" />
      <span className="dim mono">
        {Math.round(rect.w)}×{Math.round(rect.h)}
      </span>
      <span className="sel-label">
        <span className="tag">{label.tag}</span>
        <span className="sel mono">{label.name}</span>
      </span>
    </div>
  );
}
