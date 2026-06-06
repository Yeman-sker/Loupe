import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { trackAnchor } from "./anchor-track.js";

// Deterministic rAF: queued callbacks run once per flushFrame().
function makeWin() {
  let next = 1;
  const cbs = new Map<number, FrameRequestCallback>();
  return {
    requestAnimationFrame: (cb: FrameRequestCallback): number => { const h = next++; cbs.set(h, cb); return h; },
    cancelAnimationFrame: (h: number): void => { cbs.delete(h); },
    flushFrame(): void {
      const batch = [...cbs.entries()];
      cbs.clear();
      for (const [, cb] of batch) cb(0);
    },
    pending(): number { return cbs.size; },
  };
}

function rect(left: number, top: number, width = 10, height = 10): DOMRect {
  return { left, top, width, height, right: left + width, bottom: top + height, x: left, y: top, toJSON: () => ({}) } as DOMRect;
}

class FakeEl {
  isConnected = true;
  private _rect = rect(0, 0);
  setRect(r: DOMRect): void { this._rect = r; }
  getBoundingClientRect(): DOMRect { return this._rect; }
}

describe("trackAnchor", () => {
  it("places immediately from the live rect, then again each frame", () => {
    const win = makeWin();
    const el = new FakeEl();
    el.setRect(rect(40, 100));
    const seen: Array<{ left: number; top: number }> = [];

    trackAnchor(win as unknown as Window, el as unknown as Element, rect(0, 0), (r) => {
      seen.push({ left: r.left, top: r.top });
    });

    // Initial placement happened synchronously.
    assert.deepEqual(seen.at(-1), { left: 40, top: 100 });

    // Element moves (e.g. scroll); next frame re-places.
    el.setRect(rect(40, 250));
    win.flushFrame();
    assert.deepEqual(seen.at(-1), { left: 40, top: 250 });
  });

  it("uses the fallback rect while the element is disconnected", () => {
    const win = makeWin();
    const el = new FakeEl();
    el.setRect(rect(40, 100));
    el.isConnected = false;
    const seen: DOMRect[] = [];

    trackAnchor(win as unknown as Window, el as unknown as Element, rect(7, 9), (r) => seen.push(r));

    // Disconnected → frozen at fallback, never the live (0/zeroed) rect.
    assert.equal(seen.at(-1)?.left, 7);
    assert.equal(seen.at(-1)?.top, 9);
  });

  it("stop() cancels the loop so no further frames are scheduled", () => {
    const win = makeWin();
    const el = new FakeEl();
    const calls: number[] = [];

    const stop = trackAnchor(win as unknown as Window, el as unknown as Element, rect(0, 0), () => calls.push(1));
    assert.equal(win.pending(), 1, "a frame is queued while tracking");

    stop();
    assert.equal(win.pending(), 0, "stop cancels the queued frame");
    const before = calls.length;
    win.flushFrame();
    assert.equal(calls.length, before, "no further placements after stop");
  });
});
