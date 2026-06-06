// Shadow-DOM surface host. Owns an isolated, full-viewport overlay layer that
// is separate from the inert auth marker (#loupe-extension-root). The overlay
// is click-through by default (pointer-events:none); only mounted surfaces opt
// back in. One <style> carries fonts + tokens + shared primitives. Renders a
// .loupe[data-theme] wrapper that every surface lives under. Never inserts UI
// into the host page tree, never mutates host layout, never reads host CSS.

import { createDom, type Dom } from "./dom.js";
import { TOKENS_CSS } from "./tokens.js";
import { fontFaceCss } from "./fonts.js";

export type Theme = "light" | "dark";

export const SURFACE_ROOT_ID = "loupe-surface-root";

// Shared primitives (reset, typography, .card / .btn / .tok / kbd) ported from
// docs/ui-ux/prototypes/loupe.css §1. The overlay wrapper is transparent — only
// cards paint a surface; the prototype's full-page .loupe background is dropped.
const BASE_CSS = `
*,*::before,*::after{box-sizing:border-box}
.loupe{
  font-family:var(--font);color:var(--ink);letter-spacing:-.006em;
  -webkit-font-smoothing:antialiased;text-rendering:optimizeLegibility;
}
.loupe .mono{font-family:var(--mono);font-feature-settings:"ss01","ss02";letter-spacing:0}

.card{background:var(--surface);border:var(--hair) solid var(--hairline);border-radius:var(--r-lg);
  box-shadow:var(--shadow-pop);color:var(--ink)}

.btn{appearance:none;cursor:pointer;font:600 12.5px/1 var(--font);letter-spacing:-.01em;white-space:nowrap;
  border:var(--hair) solid var(--hairline-2);border-radius:var(--r-md);background:var(--surface);color:var(--ink);
  padding:9px 13px;display:inline-flex;align-items:center;gap:7px;box-shadow:var(--shadow-xs);
  transition:transform var(--dur-fast) var(--ease),background var(--dur) var(--ease),
    border-color var(--dur) var(--ease),box-shadow var(--dur) var(--ease),color var(--dur) var(--ease)}
.btn:hover{transform:translateY(-1px);box-shadow:var(--shadow);border-color:var(--hairline-strong)}
.btn:active{transform:translateY(0) scale(.985);box-shadow:var(--shadow-xs)}
.btn:focus-visible{outline:none;box-shadow:var(--ring)}
.btn.primary{background:var(--iris);border-color:transparent;color:var(--iris-fg);
  box-shadow:0 1px 2px var(--iris-veil),0 8px 20px -8px var(--iris-veil)}
.btn.primary:hover{background:var(--iris-hi)}
.btn.primary:active{background:var(--iris-press)}
.btn.ghost{background:transparent;color:var(--ink-2);border-color:var(--hairline);box-shadow:none}
.btn.ghost:hover{color:var(--ink);border-color:var(--hairline-2);background:var(--surface-2)}
.btn[disabled]{opacity:.38;cursor:not-allowed;transform:none;box-shadow:none}

kbd{font:600 10px/1 var(--mono);background:color-mix(in srgb,var(--ink) 8%,transparent);
  border:var(--hair) solid var(--hairline);border-radius:5px;padding:3px 5px;color:var(--ink-2)}

.tok{display:inline-flex;align-items:center;gap:5px;font:600 11px/1 var(--font);color:var(--t-neutral);white-space:nowrap}
.tok .g{font:700 9px/1 var(--mono)}
.tok--good{color:var(--t-good)} .tok--warn{color:var(--t-warn)}
.tok--bad{color:var(--t-bad)} .tok--open{color:var(--t-open)} .tok--neutral{color:var(--t-neutral)}
.tok--kind{color:var(--ink-2)}
.tok--kind .g{width:7px;height:7px;border-radius:50%;background:var(--k,var(--iris));
  box-shadow:0 0 0 2px color-mix(in srgb,var(--k,var(--iris)) 20%,transparent)}

@keyframes pop-in{from{opacity:0;transform:translateY(6px) scale(.98)}to{opacity:1;transform:none}}
.anim-pop{animation:pop-in var(--dur-slow) var(--ease-out) both}

/* UI-0 smoke surface (replaced by real surfaces in UI-1) */
.lp-smoke{position:fixed;left:50%;bottom:24px;transform:translateX(-50%);width:340px;
  padding:16px 18px;display:flex;flex-direction:column;gap:13px;pointer-events:auto}
.lp-smoke .lp-brand{display:flex;align-items:center;gap:8px}
.lp-smoke .lp-dot{width:9px;height:9px;border-radius:50%;background:var(--iris)}
.lp-smoke .lp-wm{font-size:15px;font-weight:600;letter-spacing:-.02em}
.lp-smoke .lp-x{margin-left:auto;padding:6px 9px}
.lp-smoke .lp-sub{font-size:12.5px;color:var(--ink-2);line-height:1.5;margin:0}
.lp-smoke .lp-toks{display:flex;flex-wrap:wrap;gap:9px 14px}
.lp-smoke .lp-controls{display:flex;align-items:center;gap:8px}
`;

export type SurfaceHost = {
  root: HTMLElement;
  shadow: ShadowRoot;
  wrapper: HTMLElement;
  dom: Dom;
  getTheme: () => Theme;
  setTheme: (theme: Theme) => void;
  mount: (node: Node) => () => void;
  destroy: () => void;
};

export type SurfaceHostOptions = {
  document: Document;
  baseUrl: string;
  theme?: Theme;
};

export function createSurfaceHost(opts: SurfaceHostOptions): SurfaceHost {
  const doc = opts.document;
  const dom = createDom(doc);

  const root = doc.createElement("div");
  root.id = SURFACE_ROOT_ID;
  root.dataset.loupeSurface = "true";
  root.style.position = "fixed";
  root.style.inset = "0";
  root.style.zIndex = "2147483647";
  root.style.pointerEvents = "none";

  const shadow = root.attachShadow({ mode: "closed" });

  const style = doc.createElement("style");
  style.textContent = fontFaceCss(opts.baseUrl) + TOKENS_CSS + BASE_CSS;
  shadow.append(style);

  let theme: Theme = opts.theme ?? "light";
  const wrapper = doc.createElement("div");
  wrapper.className = "loupe";
  wrapper.dataset.theme = theme;
  wrapper.style.pointerEvents = "none";
  shadow.append(wrapper);

  (doc.documentElement ?? doc.body).append(root);

  return {
    root,
    shadow,
    wrapper,
    dom,
    getTheme: () => theme,
    setTheme: (next: Theme) => {
      theme = next;
      wrapper.dataset.theme = next;
    },
    mount: (node: Node) => {
      wrapper.append(node);
      return () => {
        if (node.parentNode !== null) node.parentNode.removeChild(node);
      };
    },
    destroy: () => {
      if (root.parentNode !== null) root.parentNode.removeChild(root);
    },
  };
}
