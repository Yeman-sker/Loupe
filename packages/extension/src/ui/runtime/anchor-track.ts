// Keeps an element-anchored surface (intent panel, detail card, "add another")
// glued to its live page element. The surface host root is position:fixed, so a
// one-shot position drifts away from the element as soon as the page scrolls,
// drags, or reflows — exactly the reason pins moved to a rAF/transform layer
// (see docs/adp-20260606-pin-live-element-tracking.md). This re-reads the live
// getBoundingClientRect() each frame and lets the caller place the surface.
//
// While the element is disconnected (e.g. a restored pin whose node is gone) it
// freezes at the provided fallback rect rather than collapsing to (0,0).

export function trackAnchor(
  win: Window,
  element: Element,
  fallbackRect: DOMRect,
  place: (rect: DOMRect) => void,
): () => void {
  let rafHandle: number | null = null;

  function apply(): void {
    place(element.isConnected ? element.getBoundingClientRect() : fallbackRect);
  }

  function frame(): void {
    apply();
    rafHandle = win.requestAnimationFrame(frame);
  }

  apply();
  rafHandle = win.requestAnimationFrame(frame);

  return () => {
    if (rafHandle !== null) {
      win.cancelAnimationFrame(rafHandle);
      rafHandle = null;
    }
  };
}
