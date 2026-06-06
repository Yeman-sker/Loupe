// Surface runtime entry. content.js dynamically imports this after host
// authorization and calls mount(). Renders the golden-path flow:
//   ready → picking → intent → pin (saved to chrome.storage.local)
// All surfaces live inside the Shadow DOM host from host.ts.

import { createSurfaceHost, SURFACE_ROOT_ID } from "../core/host.js";
import { createI18n } from "../core/i18n.js";
import { capture_locator, resolve } from "../schema.js";
import {
  create_annotation,
  project_scope_from_url,
  session_marks_key,
  storage_keys,
  probe_daemon_health,
  resolve_annotation,
  delete_annotation,
  copy_markdown,
  type Annotation,
  type AnnotationDraft,
  type IntentKind,
} from "../storage/lib-storage.js";
import { renderReady } from "../surfaces/ready.js";
import { attachPicker, semanticLabel, type HoverTarget, type Picker } from "../surfaces/picker.js";
import { renderIntent, type Viewport } from "../surfaces/intent.js";
import { renderPin, type PinRecord, type RenderPinOpts } from "../surfaces/pin.js";
import { renderDetail } from "../surfaces/detail.js";
import { renderViewAll } from "../surfaces/view-all.js";
import { renderProjectChooser } from "../surfaces/project-chooser.js";
import { renderFallback } from "../surfaces/fallback.js";
import { renderHostAuth } from "../surfaces/host-auth.js";
import { renderStatusBar, type StatusModel } from "../surfaces/status-bar.js";
import { annotationToPinRecord, buildContext, rawToProjectEntry, type ProjectEntry } from "./pin-model.js";
import { extensionRuntime, isAuthorizedResponse, runtimeMessage } from "./runtime-bridge.js";
import { readPrefs } from "./prefs.js";

const MESSAGE_SERVICE_WORKER_WAKE = "loupe.service_worker.wake";
export type UiStorage = {
  get: (key: string) => Promise<Record<string, unknown>>;
  set: (items: Record<string, unknown>) => Promise<void>;
};

export type MountOptions = {
  baseUrl: string;
  document: Document;
  storage?: UiStorage;
  // Whether the page's origin already holds host permission. When false, the
  // surface runtime shows only the host-authorization CTA (Surface 1) and gates
  // off everything else until the user grants via the toolbar action + reload.
  // Defaults to true so existing callers/tests keep the authorized golden path.
  authorized?: boolean;
  // Optional dev-build hook for observing the runtime (e.g. anomaly capture).
  // Production callers pass nothing, so this is entirely inert in shipped builds
  // and the dev-only consumer is excluded from the production tsconfig.
  instrumentation?: Instrumentation;
};

export type InstrumentationScopeInput = {
  url: string;
  title: string;
  project_id?: string;
  workspace_root_hash?: string;
  branch?: string;
};

export type InstrumentationApi = {
  document: Document;
  getCurrentTarget: () => Element | null;
  getScopeInput: () => InstrumentationScopeInput;
};

export type Instrumentation = {
  breadcrumb?: (kind: string, detail?: string) => void;
  readonly invariant?: (name: string, detail?: string) => void;
  attach?: (api: InstrumentationApi) => void;
  detach?: () => void;
};

export type SurfaceApp = {
  unmount: () => void;
  // Toggled by the toolbar action (via the content script) on an authorized
  // page. No-op on unauthorized origins, where the toolbar click still grants
  // host permission instead.
  toggleStatusBar: () => void;
};

type AppState = {
  authorized: boolean;
  showHostAuth: boolean;
  picking: boolean;
  hover: HoverTarget | null;
  intent: HoverTarget | null;
  pins: PinRecord[];
  markCount: number;
  openDetail: string | null;
  showViewAll: boolean;
  daemonTokenMissing: boolean;
  daemonOnline: boolean;
  showProjectChooser: boolean;
  showFallback: boolean;
  showStatusBar: boolean;
  projects: ProjectEntry[];
  selectedProject: string | null;
};

// CSS for UI-1 surfaces — injected into shadow root alongside host.ts BASE_CSS.
const SURFACES_CSS = `
/* Ready HUD — bottom-left launcher pills */
.lp-ready{position:fixed;left:20px;bottom:20px;
  display:flex;align-items:center;gap:8px;pointer-events:auto;width:auto}
.lp-pill{display:inline-flex;align-items:center;gap:9px;font:600 12px/1 var(--font);color:var(--ink);
  background:var(--surface);border:var(--hair) solid var(--hairline);padding:10px 14px;border-radius:999px;
  box-shadow:var(--shadow);cursor:pointer;
  transition:transform var(--dur-fast) var(--ease),box-shadow var(--dur) var(--ease),border-color var(--dur) var(--ease)}
.lp-pill:hover{transform:translateY(-1px);box-shadow:var(--shadow-pop);border-color:var(--hairline-2)}
.lp-pill .ct{font:700 10px/1 var(--mono);color:var(--iris-fg);background:var(--iris);padding:3px 6px;border-radius:999px}
.lp-pill kbd{margin-left:2px}
.lp-pill-icon{display:inline-flex;align-items:center}

/* Mode indicator */
.lp-mode-ind{position:fixed;bottom:22px;left:50%;transform:translateX(-50%);
  display:inline-flex;align-items:center;gap:8px;padding:8px 14px;
  background:var(--surface);border:var(--hair) solid var(--hairline-2);
  border-radius:100px;box-shadow:var(--shadow);pointer-events:auto;
  font-size:12.5px;color:var(--ink-2);white-space:nowrap;z-index:1}
.lp-mode-dot{width:7px;height:7px;border-radius:50%;background:var(--iris);
  flex-shrink:0;animation:lp-ping 1.4s ease-in-out infinite}
.lp-mode-proj{padding-left:8px;margin-left:2px;border-left:var(--hair) solid var(--hairline-2);
  font:500 11.5px/1 var(--font);color:var(--ink-3)}
@keyframes lp-ping{0%,100%{opacity:1;transform:scale(1)}50%{opacity:.55;transform:scale(1.6)}}

/* Selection frame — positioned absolute within overlay (scroll-aware) */
.lp-frame{position:absolute;pointer-events:none;
  transition:left var(--dur) var(--ease),top var(--dur) var(--ease),
    width var(--dur) var(--ease),height var(--dur) var(--ease)}
.lp-frame-edge{position:absolute;inset:0;
  background:oklch(from var(--iris) l c h / .07);
  border:var(--hair) solid var(--iris)}
.lp-frame-br{position:absolute;width:13px;height:13px;border:2px solid var(--iris)}
.lp-frame-br--tl{top:-1px;left:-1px;border-right:none;border-bottom:none}
.lp-frame-br--tr{top:-1px;right:-1px;border-left:none;border-bottom:none}
.lp-frame-br--bl{bottom:-1px;left:-1px;border-right:none;border-top:none}
.lp-frame-br--br{bottom:-1px;right:-1px;border-left:none;border-top:none}
.lp-frame-dim{position:absolute;right:0;top:-20px;
  font:500 10.5px/1 var(--mono);color:var(--iris);letter-spacing:0}
.lp-frame-lbl{position:absolute;left:-1px;top:calc(100% + 7px);
  background:var(--iris);color:var(--iris-fg);
  font:500 11px/1 var(--mono);padding:3px 7px;border-radius:var(--r-sm);
  letter-spacing:0;white-space:nowrap;max-width:260px;
  overflow:hidden;text-overflow:ellipsis}

/* Intent panel */
.lp-intent{position:absolute;pointer-events:auto;z-index:2;width:380px;max-width:92vw}
.lp-intent-shell{background:var(--surface);border:var(--hair) solid var(--hairline-2);
  border-radius:var(--r-lg);box-shadow:var(--shadow-pop);padding:11px 11px 9px;
  transition:border-color var(--dur) var(--ease),box-shadow var(--dur) var(--ease),opacity var(--dur) var(--ease)}
.lp-intent-shell:focus-within{border-color:color-mix(in srgb,var(--iris) 50%,var(--hairline-2));box-shadow:var(--shadow-pop),var(--ring)}
.lp-intent-pip{display:inline-block;width:6px;height:6px;border-radius:50%;
  background:var(--iris);flex-shrink:0;margin-right:5px}
.lp-intent-targ{display:flex;align-items:center;font-size:10.5px;color:var(--ink-3);
  font-family:var(--mono);padding:1px 4px 8px;letter-spacing:.01em}
.lp-intent-row{display:flex;align-items:flex-end;gap:9px}
.lp-intent-field{flex:1;resize:none;overflow-y:hidden;border:none;outline:none;
  background:transparent;color:var(--ink);font:400 14px/1.5 var(--font);
  min-height:22px;max-height:88px;padding:5px 4px;letter-spacing:-.006em}
.lp-intent-field::placeholder{color:var(--ink-3)}
.lp-intent-submit{flex:none;width:33px;height:33px;border-radius:var(--r-pin);border:none;cursor:pointer;
  display:grid;place-items:center;background:var(--k,var(--iris));color:var(--iris-fg);
  box-shadow:0 1px 2px color-mix(in srgb,var(--k,var(--iris)) 40%,transparent),0 6px 16px -6px color-mix(in srgb,var(--k,var(--iris)) 50%,transparent);
  transition:transform var(--dur-fast) var(--ease),box-shadow var(--dur) var(--ease),opacity var(--dur) var(--ease)}
.lp-intent-submit:hover:not([disabled]){transform:translateY(-1px) scale(1.05)}
.lp-intent-submit:focus-visible{outline:none;box-shadow:0 0 0 3px color-mix(in srgb,var(--k,var(--iris)) 32%,transparent)}
.lp-intent-submit svg{width:15px;height:15px}
.lp-intent-submit[disabled]{opacity:.34;cursor:not-allowed;transform:none;box-shadow:none;background:var(--ink-3)}
.lp-kindrail{display:flex;align-items:center;gap:3px;margin-top:10px;padding-top:9px;
  border-top:var(--hair) solid var(--hairline)}
.lp-kindrail-label{font:600 9.5px/1 var(--mono);letter-spacing:.12em;text-transform:uppercase;
  color:var(--ink-3);margin-right:6px}
.lp-kind-btn{appearance:none;cursor:pointer;border:none;background:transparent;padding:5px;
  border-radius:999px;display:inline-flex;align-items:center;gap:0;
  transition:gap var(--dur) var(--ease),background var(--dur) var(--ease),transform var(--dur-fast) var(--ease)}
.lp-kind-btn::before{content:"";width:9px;height:9px;border-radius:50%;background:var(--k,var(--iris));flex:none;
  box-shadow:0 0 0 0 color-mix(in srgb,var(--k,var(--iris)) 30%,transparent);
  transition:box-shadow var(--dur) var(--ease)}
.lp-kind-btn:hover{background:var(--surface-2);transform:translateY(-1px)}
.lp-kind-name{max-width:0;overflow:hidden;white-space:nowrap;font:600 11px/1 var(--font);
  color:var(--ink);opacity:0;
  transition:max-width var(--dur) var(--ease),opacity var(--dur) var(--ease),margin var(--dur) var(--ease)}
.lp-kind-btn:hover .lp-kind-name,.lp-kind-btn--sel .lp-kind-name{max-width:80px;opacity:1;margin-left:6px;margin-right:2px}
.lp-kind-btn--sel{background:color-mix(in srgb,var(--k,var(--iris)) 13%,transparent)}
.lp-kind-btn--sel::before{box-shadow:0 0 0 3px color-mix(in srgb,var(--k,var(--iris)) 22%,transparent)}
.lp-kind-btn:focus-visible{outline:none;box-shadow:var(--ring)}
/* hint, discard, error */
.lp-intent-hint{margin:6px 3px 1px;font:600 11px/1.3 var(--font);color:var(--t-bad);display:none}
.lp-intent.lp-show-hint .lp-intent-hint{display:block;animation:lp-shake .3s var(--ease)}
@keyframes lp-shake{0%,100%{transform:translateX(0)}25%{transform:translateX(-3px)}75%{transform:translateX(3px)}}
.lp-intent-discard{margin:6px 3px 1px;font:600 11px/1.3 var(--font);color:var(--ink-2);display:none}
.lp-intent-error{margin:6px 3px 1px;font:600 11px/1.3 var(--font);color:var(--t-bad);display:none}
/* footer */
.lp-intent-foot{display:flex;align-items:center;margin-top:8px;padding:0 2px}
.lp-hintkey{font:500 10.5px/1 var(--mono);color:var(--ink-3);margin-left:auto}
/* collapse-to-pin animation */
@keyframes lp-collapse-to-pin{0%{opacity:1;transform:scale(1)}60%{opacity:.5}100%{opacity:0;transform:scale(.7) translateY(8px)}}
.lp-intent.lp-collapsing .lp-intent-shell{animation:lp-collapse-to-pin var(--dur-slow) var(--ease) forwards;transform-origin:var(--ox,100%) 0;pointer-events:none}
/* add-another button */
.lp-add-another{display:inline-flex;align-items:center;gap:7px;font:600 11.5px/1 var(--font);
  color:var(--ink-2);background:var(--surface);border:var(--hair) dashed var(--hairline-strong);
  border-radius:999px;padding:8px 13px;cursor:pointer;box-shadow:var(--shadow);
  animation:pop-in var(--dur) var(--ease-out) both;pointer-events:auto;
  transition:color var(--dur) var(--ease),border-color var(--dur) var(--ease),background var(--dur) var(--ease)}
.lp-add-another:hover{color:var(--ink);border-color:var(--iris);background:var(--iris-veil-2)}
.lp-add-another-x{font:700 13px/1 var(--mono);color:var(--iris)}

/* Breadcrumb */
.lp-breadcrumb{position:absolute;display:inline-flex;align-items:center;gap:5px;
  font:500 11px/1 var(--font);color:var(--ink-2);background:var(--surface);
  border:var(--hair) solid var(--hairline);padding:6px 10px;border-radius:999px;
  box-shadow:var(--shadow);pointer-events:none;z-index:2;white-space:nowrap}
.lp-breadcrumb i{color:var(--ink-3);font-style:normal}
.lp-breadcrumb b{color:var(--ink);font-weight:600}

/* Detail card — Surface 6 */
.detail{position:absolute;width:346px;max-width:92vw;z-index:6;padding:16px 16px 14px;overflow:hidden;
  pointer-events:auto;animation:pop-in var(--dur) var(--ease-out) both}
.detail .d-target{display:flex;align-items:center;gap:7px;font:500 10.5px/1.3 var(--mono);color:var(--ink-3);margin-bottom:10px}
.detail .d-target .ix{font-weight:700;color:var(--ink-2)}
.detail .d-comment{font-size:14px;line-height:1.55;color:var(--ink);margin-bottom:14px;letter-spacing:-.008em}
.detail .d-meta{display:flex;flex-wrap:wrap;gap:11px;align-items:center;padding-bottom:14px;margin-bottom:13px;
  border-bottom:var(--hair) solid var(--hairline)}
.detail .d-actions{display:flex;align-items:center;flex-wrap:wrap;gap:8px;row-gap:9px}
.detail .d-actions .spacer{flex:1}
.detail.is-done{opacity:.72}
.detail[data-style="slip"]{border-radius:var(--r-sm);border-left:3px solid var(--k,var(--iris))}
/* Danger button */
.btn.danger{background:transparent;border:var(--hair) solid var(--t-bad);color:var(--t-bad)}
.btn.danger:hover{background:color-mix(in srgb,var(--t-bad) 10%,transparent)}
.btn.danger[data-armed="1"]{background:var(--t-bad);color:#fff}

/* View all panel — Surface 7 */
.viewall{position:fixed;top:0;right:0;bottom:0;width:340px;max-width:92vw;z-index:7;
  background:var(--surface);border-left:var(--hair) solid var(--hairline);box-shadow:var(--shadow-pop);
  pointer-events:auto;display:flex;flex-direction:column;animation:slide-in var(--dur-slow) var(--ease-out) both}
@keyframes slide-in{from{transform:translateX(20px);opacity:0}to{transform:none;opacity:1}}
.va-head{display:flex;align-items:center;gap:10px;padding:15px 16px;border-bottom:var(--hair) solid var(--hairline)}
.va-proj{display:inline-flex;align-items:center;gap:7px;font:600 12px/1 var(--font);color:var(--ink)}
.va-proj::before{content:"";width:7px;height:7px;border-radius:50%;background:var(--iris);
  box-shadow:0 0 0 3px var(--iris-veil-2)}
.va-route{font:500 10.5px/1 var(--mono);color:var(--ink-3);flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.va-x{margin-left:auto;width:28px;height:28px;border-radius:var(--r-sm);border:none;background:transparent;
  color:var(--ink-2);cursor:pointer;display:grid;place-items:center;font-size:15px;flex:none}
.va-x:hover{background:var(--surface-2);color:var(--ink)}
.va-sub{display:flex;align-items:center;gap:10px;padding:10px 16px;border-bottom:var(--hair) solid var(--hairline)}
.va-count{font:600 11px/1 var(--mono);color:var(--ink-2);white-space:nowrap}
.va-toggle{margin-left:auto;display:inline-flex;align-items:center;gap:7px;font:600 11px/1 var(--font);color:var(--ink-2);cursor:pointer;white-space:nowrap;flex:none;appearance:none;border:none;background:transparent;padding:0}
.va-toggle:hover{color:var(--ink)}
.va-toggle:focus-visible{outline:none;box-shadow:var(--ring);border-radius:999px}
.va-switch{width:30px;height:17px;border-radius:999px;background:var(--hairline-2);position:relative;transition:background var(--dur) var(--ease)}
.va-switch::after{content:"";position:absolute;top:2px;left:2px;width:13px;height:13px;border-radius:50%;background:var(--surface);
  box-shadow:var(--shadow-xs);transition:transform var(--dur) var(--ease)}
.va-toggle.on .va-switch{background:var(--iris)}.va-toggle.on .va-switch::after{transform:translateX(13px)}
.va-list{list-style:none;margin:0;padding:7px;overflow-y:auto;flex:1}
.va-item{position:relative;padding:11px 12px 11px 14px;border-radius:var(--r-md);cursor:pointer;overflow:hidden;
  transition:background var(--dur) var(--ease)}
.va-item::before{content:"";position:absolute;left:3px;top:11px;bottom:11px;width:2.5px;border-radius:2px;
  background:var(--k,var(--ink-3));opacity:.5;transition:opacity var(--dur) var(--ease),top var(--dur) var(--ease),bottom var(--dur) var(--ease)}
.va-item:hover{background:var(--surface-2)}.va-item:hover::before{opacity:1;top:7px;bottom:7px}
.va-item:focus-visible{outline:none;box-shadow:var(--ring)}
.va-item.cur{background:var(--iris-veil-2)}
.va-l1{display:flex;gap:8px;font-size:12.5px;font-weight:600;line-height:1.45;color:var(--ink);align-items:baseline}
.va-n{font:700 12px/1.5 var(--mono);color:var(--ink-3);flex:none}
.va-c{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.va-l2{margin-top:7px;font:500 10.5px/1 var(--mono);color:var(--ink-3);display:flex;flex-wrap:wrap;gap:9px;align-items:center}
.va-item.done{opacity:.6}
.va-foot{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:12px 16px;border-top:var(--hair) solid var(--hairline)}
.va-empty{padding:42px 18px;text-align:center;display:flex;flex-direction:column;align-items:center;gap:0}
.va-empty .et{font-size:13.5px;font-weight:600}
.va-empty .es{margin:6px 0 16px;font-size:12px;color:var(--ink-2)}

/* Pin */
.lp-pin{position:absolute;width:24px;height:24px;
  transform:translate(-50%,-50%);pointer-events:auto;cursor:pointer;
  animation:lp-pin-in var(--dur-slow) var(--ease-out) both;
  transition:transform var(--dur-fast) var(--ease)}
.lp-pin:hover{transform:translate(-50%,-50%) scale(1.12)}
.lp-pin:focus-visible{outline:none}
.lp-pin:focus-visible .lp-pin-ring{box-shadow:var(--ring),var(--shadow-xs)}
.lp-pin-ring{width:24px;height:24px;border-radius:50%;
  border:var(--hair) solid var(--hairline-strong);background:var(--surface);
  display:grid;place-items:center;
  box-shadow:0 0 0 2px var(--surface),var(--shadow);position:relative}
.lp-pin-num{font:600 11px/1 var(--mono);color:var(--ink);letter-spacing:-.02em;
  position:relative;z-index:1}
/* iris pulse for open+located pins */
.lp-pin-pulse{position:absolute;inset:0;border-radius:50%;
  box-shadow:0 0 0 1.5px var(--iris-veil);
  animation:lp-pin-ping 2.6s var(--ease-out) infinite}
@keyframes lp-pin-ping{0%{transform:scale(1);opacity:.8}70%{transform:scale(1.8);opacity:0}100%{opacity:0}}
@keyframes lp-pin-in{
  from{opacity:0;transform:translate(-50%,-50%) scale(.4)}
  60%{opacity:1;transform:translate(-50%,-50%) scale(1.12)}
  to{opacity:1;transform:translate(-50%,-50%) scale(1)}
}
/* state badges */
.lp-pin-badge{position:absolute;right:-5px;top:-5px;width:14px;height:14px;border-radius:50%;
  display:grid;place-items:center;font:700 8px/1 var(--mono);color:#fff;
  box-shadow:0 0 0 1.5px var(--surface)}
.lp-pin--done .lp-pin-ring{background:var(--surface-2);border-color:var(--hairline)}
.lp-pin--done .lp-pin-num{color:var(--ink-3)}
.lp-pin--done .lp-pin-arc{opacity:.4}
.lp-pin--done .lp-pin-badge{background:var(--t-good)}
.lp-pin--drift .lp-pin-ring{border-style:dashed;border-color:var(--t-warn)}
.lp-pin--drift .lp-pin-badge{background:var(--t-warn)}
.lp-pin--lost .lp-pin-ring{background:transparent;border-style:dashed;border-color:var(--hairline-strong);box-shadow:0 0 0 2px var(--surface)}
.lp-pin--lost .lp-pin-num{color:var(--ink-3)}
.lp-pin--lost .lp-pin-arc{display:none}
.lp-pin--lost .lp-pin-badge{background:var(--t-bad)}
/* stack chip */
.lp-pin-stackn{position:absolute;right:-6px;bottom:-6px;min-width:14px;height:14px;
  padding:0 3px;border-radius:8px;background:var(--ink);color:var(--paper);
  font:700 8px/14px var(--mono);text-align:center;box-shadow:0 0 0 1.5px var(--surface)}
/* tooltip */
.lp-pin-tip{position:absolute;bottom:calc(100% + 9px);left:50%;
  transform:translateX(-50%) translateY(3px);white-space:nowrap;
  font:600 11px/1 var(--font);color:var(--ink);background:var(--surface);
  border:var(--hair) solid var(--hairline);padding:7px 10px;border-radius:999px;
  box-shadow:var(--shadow-pop);opacity:0;pointer-events:none;
  display:inline-flex;align-items:center;gap:7px;
  transition:opacity var(--dur) var(--ease),transform var(--dur) var(--ease)}
.lp-pin-tip-sep{color:var(--ink-3)}
.lp-pin:hover .lp-pin-tip,.lp-pin:focus-visible .lp-pin-tip{opacity:1;transform:translateX(-50%) translateY(0)}

/* Host authorization CTA — Surface 1 (ported from prototype .cta). The scrim +
   2px veil is the one place blur is intentional (modal gate), per the spec. */
.center-wrap.lp-auth{pointer-events:auto;
  background:color-mix(in srgb,var(--paper) 55%,transparent);backdrop-filter:blur(2px)}
.cta{width:316px;padding:22px}
.cta:focus-visible{outline:none}
.cta-brand{display:flex;align-items:center;gap:9px;margin-bottom:16px}
.cta-mark{display:inline-flex}
.cta-mark svg{display:block;flex:none}
.cta-brand .wm{font-size:16px;font-weight:600;letter-spacing:-.02em;color:var(--ink)}
.cta h3{font-size:16px;font-weight:600;letter-spacing:-.02em;margin:0 0 7px;color:var(--ink)}
.cta p{font-size:13px;line-height:1.55;color:var(--ink-2);margin:0 0 14px}
.cta-hint{display:flex;align-items:center;gap:9px;margin:0 0 16px;padding:9px 11px;
  font:500 12px/1.45 var(--font);color:var(--ink-2);
  background:var(--iris-veil-2);border-radius:var(--r-md);
  border:var(--hair) solid color-mix(in srgb,var(--iris) 30%,var(--hairline))}
.cta-hint .arrow{font-weight:700;color:var(--iris);flex:none}
.cta .cta-row{display:flex;align-items:center;gap:10px}

/* Project chooser — Surface 2 */
.center-wrap{position:fixed;inset:0;display:grid;place-items:center;z-index:8;pointer-events:none}
.center-wrap>.chooser{pointer-events:auto}
.chooser{width:330px;padding:18px}
.chooser h3{font-size:13.5px;font-weight:600;margin:0 0 4px}
.chooser .sub{font-size:11.5px;color:var(--ink-2);margin:0 0 14px}
.proj-list{list-style:none;margin:0 0 14px;padding:0;display:flex;flex-direction:column;gap:5px}
.proj{display:flex;align-items:center;gap:11px;padding:11px 12px;border-radius:var(--r-md);cursor:pointer;
  border:var(--hair) solid transparent;transition:background var(--dur) var(--ease),border-color var(--dur) var(--ease)}
.proj:hover{background:var(--surface-2)}
.proj:focus-visible{outline:none;box-shadow:var(--ring)}
.proj.sel{border-color:color-mix(in srgb,var(--iris) 45%,var(--hairline));background:var(--iris-veil-2)}
.proj .pdot{width:8px;height:8px;border-radius:50%;border:1.5px solid var(--ink-3);flex:none}
.proj.sel .pdot{border-color:var(--iris);background:var(--iris)}
.proj .pmeta{flex:1}
.proj .pname{font-size:13px;font-weight:600}
.proj .ppath{font:500 10.5px/1.2 var(--mono);color:var(--ink-3);margin-top:2px}
.chooser-foot{display:flex;align-items:center;justify-content:space-between;gap:10px;
  border-top:var(--hair) solid var(--hairline);padding-top:13px}

/* Page-level fallback — Surface 8 */
.fallback{position:fixed;left:50%;bottom:84px;transform:translateX(-50%);width:380px;max-width:92vw;z-index:7;padding:15px 16px;
  animation:pop-in var(--dur) var(--ease-out) both}
.fallback h4{font-size:13px;font-weight:600;margin:0 0 4px;display:flex;align-items:center;gap:8px}
.fallback p{font-size:12px;line-height:1.5;color:var(--ink-2);margin:0 0 13px}
.fallback .fb-row{display:flex;align-items:center;gap:11px}

/* Floating daemon status bar — toolbar-toggled strip, bottom-center */
.lp-status{position:fixed;left:50%;bottom:22px;transform:translateX(-50%);
  max-width:92vw;padding:11px 13px;z-index:7;pointer-events:auto;
  display:flex;flex-direction:column;gap:9px;animation:pop-in var(--dur) var(--ease-out) both}
.lp-status-row{display:flex;align-items:center;gap:12px}
.lp-status-meta{font:500 10.5px/1 var(--mono);color:var(--ink-3);white-space:nowrap}
.lp-status-meta:empty{display:none}
.lp-status-btn{padding:7px 11px;font-size:11.5px}
.lp-status-x{margin-left:2px;width:26px;height:26px;flex:none;border:none;background:transparent;
  color:var(--ink-3);cursor:pointer;border-radius:var(--r-sm);font-size:17px;line-height:1;
  display:grid;place-items:center;transition:background var(--dur) var(--ease),color var(--dur) var(--ease)}
.lp-status-x:hover{background:var(--surface-2);color:var(--ink)}
.lp-status-x:focus-visible{outline:none;box-shadow:var(--ring)}
.lp-status-guide{display:flex;align-items:center;gap:9px;flex-wrap:wrap;
  padding-top:9px;border-top:var(--hair) solid var(--hairline);
  font:500 11.5px/1.4 var(--font);color:var(--ink-2)}
.lp-status-path{font:500 10.5px/1 var(--mono);color:var(--ink-3);
  background:color-mix(in srgb,var(--ink) 6%,transparent);
  border:var(--hair) solid var(--hairline);border-radius:5px;padding:3px 6px}

/* Reduced motion (§5/§8/§12). The token media query collapses --dur* to .001s,
   which would (a) teleport the selection frame instead of preserving spatial
   continuity, and (b) NOT stop the two infinite ambient loops (they use literal
   durations, not tokens). Fix both, and drop the error micro-shake amplitude. */
@media (prefers-reduced-motion:reduce){
  .lp-frame{transition-duration:.09s}        /* still slides between rects, just faster */
  .lp-mode-dot{animation:none}               /* stop the picking-mode ping */
  .lp-pin-pulse{animation:none}              /* stop the open-pin ping */
  .lp-intent.lp-show-hint .lp-intent-hint{animation:none}  /* show hint, no shake */
}
`;

export async function mount(opts: MountOptions): Promise<SurfaceApp> {
  if (opts.document.getElementById(SURFACE_ROOT_ID) !== null) return { unmount: () => {}, toggleStatusBar: () => {} };

  const prefs = await readPrefs(opts.storage, opts.document);
  const i18n = createI18n(prefs.lang);
  const host = createSurfaceHost({ document: opts.document, baseUrl: opts.baseUrl, theme: prefs.theme });

  // Inject surface-specific CSS into the shadow root alongside host BASE_CSS
  const surfaceStyle = opts.document.createElement("style");
  surfaceStyle.textContent = SURFACES_CSS;
  host.shadow.append(surfaceStyle);

  const authorized = opts.authorized !== false;
  const state: AppState = {
    authorized,
    showHostAuth: !authorized,
    picking: false,
    hover: null,
    intent: null,
    pins: [],
    markCount: 0,
    openDetail: null,
    showViewAll: false,
    daemonTokenMissing: false,
    daemonOnline: true,
    showProjectChooser: false,
    showFallback: false,
    showStatusBar: false,
    projects: [],
    selectedProject: null,
  };

  // In-memory annotation store for resolve/delete/copy operations
  const annotations = new Map<string, Annotation>();
  const instrumentation = opts.instrumentation;

  let currentPicker: Picker | null = null;
  let detachReady: (() => void) | null = null;
  let detachIntent: (() => void) | null = null;
  let detachAddAnother: (() => void) | null = null;
  let detachDetail: (() => void) | null = null;
  let detachViewAll: (() => void) | null = null;
  let detachChooser: (() => void) | null = null;
  let detachFallback: (() => void) | null = null;
  let detachHostAuth: (() => void) | null = null;
  let detachStatusBar: (() => void) | null = null;
  const pinDetachers: Array<() => void> = [];
  let prevIntentFocus: Element | null = null;

  function clearSurfaces(): void {
    if (currentPicker !== null) {
      currentPicker.detach();
      currentPicker = null;
    }
    if (detachReady !== null) {
      detachReady();
      detachReady = null;
    }
    if (detachIntent !== null) {
      detachIntent();
      detachIntent = null;
    }
    if (detachAddAnother !== null) {
      detachAddAnother();
      detachAddAnother = null;
    }
    if (detachDetail !== null) {
      detachDetail();
      detachDetail = null;
    }
    if (detachViewAll !== null) {
      detachViewAll();
      detachViewAll = null;
    }
    if (detachChooser !== null) {
      detachChooser();
      detachChooser = null;
    }
    if (detachFallback !== null) {
      detachFallback();
      detachFallback = null;
    }
    if (detachHostAuth !== null) {
      detachHostAuth();
      detachHostAuth = null;
    }
    if (detachStatusBar !== null) {
      detachStatusBar();
      detachStatusBar = null;
    }
    for (const d of pinDetachers) d();
    pinDetachers.length = 0;
  }

  function render(): void {
    const { t } = i18n;
    const doc = opts.document;

    clearSurfaces();

    // Unauthorized origin: show only the host-authorization CTA (Surface 1).
    if (!state.authorized) {
      if (state.showHostAuth) {
        const authEl = renderHostAuth(host.dom, {
          t,
          onAllow: () => { void requestHostAuthorization(doc); },
          onDismiss: () => { state.showHostAuth = false; render(); },
        });
        detachHostAuth = host.mount(authEl);
      }
      return;
    }

    // Always mount the ready panel (hidden during picking)
    const readyEl = renderReady(host.dom, t, {
      onPick: startPicking,
      onViewAll: () => { state.showViewAll = true; render(); },
    }, state.picking, state.markCount);
    detachReady = host.mount(readyEl);

    // Picker mode
    if (state.picking) {
      const projName = currentProjectName();
      const picker = attachPicker(doc, host.dom, t, {
        onHover: (target) => {
          state.hover = target;
        },
        onConfirm: (target) => {
          state.picking = false;
          state.hover = null;
          state.intent = target;
          render();
        },
        onEsc: () => {
          state.picking = false;
          state.hover = null;
          render();
        },
      }, projName !== undefined ? { projectName: projName } : {});
      currentPicker = picker;
      // Mount mode indicator, selection frame, and breadcrumb into the host wrapper
      host.mount(picker.modeEl);
      host.mount(picker.frameEl);
      host.mount(picker.breadcrumbEl);
    }

    // Intent panel
    if (state.intent !== null) {
      prevIntentFocus = doc.activeElement;
      const view = doc.defaultView;
      const viewport: Viewport = {
        width: view?.innerWidth ?? 1024,
        height: view?.innerHeight ?? 768,
        scrollY: view?.scrollY ?? 0,
      };
      const intentEl = renderIntent(host.dom, t, state.intent.rect, viewport, {
        onSave: async (comment, kind) => {
          await doSave(state.intent!.element, comment, kind);
        },
        onCancel: () => {
          state.intent = null;
          if (prevIntentFocus !== null && typeof (prevIntentFocus as HTMLElement).focus === "function") {
            (prevIntentFocus as HTMLElement).focus();
          }
          render();
        },
      }, semanticLabel(state.intent.element));
      detachIntent = host.mount(intentEl);
    }

    // Detail card — Surface 6
    if (state.openDetail !== null) {
      const pin = state.pins.find((p) => p.id === state.openDetail);
      if (pin !== undefined) {
        const view = opts.document.defaultView;
        const scrollY = view?.scrollY ?? 0;
        const vw = view?.innerWidth ?? 1024;
        const PAD = 12;
        const CARD_W = 346;
        const left = Math.max(PAD, Math.min(pin.rect.left, vw - CARD_W - PAD));
        const top = pin.rect.bottom + scrollY + 10;
        const detailEl = renderDetail(host.dom, pin, {
          t,
          onDone: (pinId) => doResolve(pinId),
          onDelete: (pinId) => doDelete(pinId),
          onCopyMarkdown: (pinId) => doCopyMarkdown(pinId),
          onClose: () => { state.openDetail = null; render(); },
          onViewAll: () => { state.showViewAll = true; render(); },
          onRetry: (pinId) => doRetry(pinId),
        });
        detailEl.style.left = `${left}px`;
        detailEl.style.top = `${top}px`;
        detachDetail = host.mount(detailEl);
      }
    }

    // View all panel — Surface 7
    if (state.showViewAll) {
      const doc = opts.document;
      const route = doc.location?.pathname ?? "/";
      // Current project low-noise in header; local/temporary scope → "project not linked".
      const projName = currentProjectName() ?? t("proj.notlink");
      const viewAllEl = renderViewAll(host.dom, state.pins, {
        t,
        route,
        currentId: state.openDetail,
        projectName: projName,
        onClose: () => { state.showViewAll = false; render(); },
        onJump: (pin) => {
          pin.element.scrollIntoView?.({ behavior: "smooth", block: "center" });
          state.openDetail = pin.id;
          render();
        },
        onCopyAll: () => doCopyAll(),
        onStartPicking: startPicking,
      });
      detachViewAll = host.mount(viewAllEl);
    }

    // Project chooser — Surface 2
    if (state.showProjectChooser) {
      const chooserEl = renderProjectChooser(host.dom, state.projects, {
        t,
        onPick: (id) => doPickProject(id),
      });
      detachChooser = host.mount(chooserEl);
    }

    // Page-level fallback — Surface 8
    if (state.showFallback) {
      const fallbackEl = renderFallback(host.dom, {
        t,
        onCopy: () => doCopyAll(),
      });
      detachFallback = host.mount(fallbackEl);
    }

    // Floating daemon status bar — toggled by the toolbar action.
    if (state.showStatusBar) {
      const statusEl = renderStatusBar(host.dom, {
        t,
        model: statusModel(),
        onRetry: () => {
          void probe_daemon_health().then((online) => {
            state.daemonOnline = online;
            render();
          });
        },
        onCopy: () => doCopyAll(),
        onClose: () => { state.showStatusBar = false; render(); },
      });
      detachStatusBar = host.mount(statusEl);
    }

    // Pins — group by element to compute stacking offsets
    {
      const view = opts.document.defaultView;
      const scrollY = view?.scrollY ?? 0;
      const vw = view?.innerWidth ?? 1024;
      const vh = view?.innerHeight ?? 768;
      const elementCount = new Map<Element, number>();
      for (const pin of state.pins) {
        const idx = elementCount.get(pin.element) ?? 0;
        elementCount.set(pin.element, idx + 1);
        const renderOpts: RenderPinOpts = {
          stackOffset: idx * 16,
          t,
          onOpen: (p) => { state.openDetail = p.id; render(); },
        };
        const pinEl = renderPin(host.dom, pin, scrollY, vw, vh, renderOpts);
        if (pinEl !== null) pinDetachers.push(host.mount(pinEl));
      }
    }
  }

  async function requestHostAuthorization(doc: Document): Promise<void> {
    const runtime = extensionRuntime();
    if (runtime === undefined) return;
    const origin = doc.location?.origin;
    if (typeof origin !== "string" || origin.length === 0) return;

    const response = await runtimeMessage(runtime, { type: "loupe.origin_auth.request", origin });
    if (isAuthorizedResponse(response)) {
      doc.defaultView?.location.reload();
    }
  }

  function startPicking(): void {
    if (!state.authorized) return;
    // Show project chooser when multiple projects exist and none selected yet
    if (state.projects.length > 1 && state.selectedProject === null) {
      state.showProjectChooser = true;
      state.openDetail = null;
      state.showViewAll = false;
      render();
      return;
    }
    state.picking = true;
    state.intent = null;
    state.openDetail = null;
    state.showViewAll = false;
    state.showProjectChooser = false;
    instrumentation?.breadcrumb?.("pick_start");
    render();
  }

  function doPickProject(id: string | "local"): void {
    state.selectedProject = id === "local" ? null : id;
    state.showProjectChooser = false;
    state.picking = true;
    state.intent = null;
    state.openDetail = null;
    state.showViewAll = false;
    render();
  }

  // Name of the currently selected project, or undefined when local/not-linked.
  function currentProjectName(): string | undefined {
    if (state.selectedProject === null) return undefined;
    return state.projects.find((p) => p.id === state.selectedProject)?.name;
  }

  function doResolve(pinId: string): void {
    const pin = state.pins.find((p) => p.id === pinId);
    const annotation = annotations.get(pinId);
    if (pin === undefined) return;
    pin.task = "done";
    if (annotation !== undefined) {
      const resolved = resolve_annotation(annotation, new Date().toISOString());
      annotations.set(pinId, resolved);
      if (opts.storage !== undefined) {
        const project = buildProjectFromPin(pin);
        if (project !== null) {
          const key = session_marks_key(project.project_id, project.session_id);
          void opts.storage.get(key).then((stored) => {
            const arr = Array.isArray(stored[key]) ? (stored[key] as unknown[]) : [];
            const updated = arr.map((m) => {
              if (typeof m === "object" && m !== null && (m as Record<string, unknown>).id === pinId) {
                return resolved;
              }
              return m;
            });
            void opts.storage!.set({ [key]: updated });
          });
        }
      }
    }
    state.openDetail = null;
    render();
  }

  function doDelete(pinId: string): void {
    const pin = state.pins.find((p) => p.id === pinId);
    if (pin === undefined) return;
    state.pins = state.pins.filter((p) => p.id !== pinId);
    annotations.delete(pinId);
    state.openDetail = null;
    if (opts.storage !== undefined) {
      const project = buildProjectFromPin(pin);
      if (project !== null) {
        const store = {
          get: (key: string) => opts.storage!.get(key).then((r) => r[key]),
          set: (items: Record<string, unknown>) => opts.storage!.set(items),
        };
        void delete_annotation(store, project.project_id, project.session_id, pinId);
      }
    }
    render();
  }

  // Entry-point Retry: re-probe daemon, re-queue a failed mark as local_only.
  // Actual daemon POST is performed by the background worker (phase 3), which
  // holds the auth token; the UI never sees a token (exposes_token_to_page:false).
  function doRetry(pinId: string): void {
    const pin = state.pins.find((p) => p.id === pinId);
    const annotation = annotations.get(pinId);
    if (pin === undefined) return;
    void probe_daemon_health().then((online) => {
      if (online) {
        state.daemonOnline = true;
        state.showFallback = false;
        pin.sync = "local";
        if (annotation !== undefined) {
          const requeued: Annotation = {
            ...annotation,
            sync: {
              ...annotation.sync,
              status: "local_only",
              retry_count: annotation.sync.retry_count + 1,
            },
          };
          annotations.set(pinId, requeued);
          persistMark(pin, requeued);
        }
      } else {
        state.daemonOnline = false;
        state.showFallback = true;
      }
      render();
    });
  }

  // Replace a single mark in its session's stored array.
  function persistMark(pin: PinRecord, next: Annotation): void {
    if (opts.storage === undefined) return;
    const project = buildProjectFromPin(pin);
    if (project === null) return;
    const key = session_marks_key(project.project_id, project.session_id);
    void opts.storage.get(key).then((stored) => {
      const arr = Array.isArray(stored[key]) ? (stored[key] as unknown[]) : [];
      const updated = arr.map((m) =>
        typeof m === "object" && m !== null && (m as Record<string, unknown>).id === next.id ? next : m,
      );
      void opts.storage!.set({ [key]: updated });
    });
  }

  function doCopyMarkdown(pinId: string): Promise<boolean> {
    const annotation = annotations.get(pinId);
    const pin = state.pins.find((p) => p.id === pinId);
    let text: string;
    if (annotation !== undefined) {
      text = copy_markdown([annotation], {
        project_id: annotation.project.project_id,
        session_id: annotation.project.session_id,
        route_key: annotation.project.route_key,
      });
    } else if (pin !== undefined) {
      text = `- id: ${pin.id}\n  comment: ${pin.comment ?? ""}`;
    } else {
      return Promise.resolve(false);
    }
    return navigator.clipboard.writeText(text).then(() => true).catch(() => false);
  }

  function doCopyAll(): Promise<boolean> {
    const allAnnotations = [...annotations.values()];
    if (allAnnotations.length === 0) return Promise.resolve(false);
    const first = allAnnotations[0]!;
    const text = copy_markdown(allAnnotations, {
      project_id: first.project.project_id,
      session_id: first.project.session_id,
    });
    return navigator.clipboard.writeText(text).then(() => true).catch(() => false);
  }

  // Derive the status-bar model from signals the UI already holds. The UI never
  // sees the daemon token value (exposes_token_to_page:false); background only
  // reports token_missing as a boolean.
  function statusModel(): StatusModel {
    const synced = state.pins.filter((p) => p.sync === "synced").length;
    const pending = state.pins.filter((p) => p.sync === "local" || p.sync === "failed").length;
    const failed = state.pins.some((p) => p.sync === "failed");
    const kind: StatusModel["kind"] = !state.daemonOnline
      ? "offline"
      : state.daemonTokenMissing
        ? "token_missing"
        : failed
          ? "sync_failed"
          : pending > 0
            ? "local_only"
            : "connected";
    const model: StatusModel = { kind, syncedCount: synced, pendingCount: pending };
    if (kind === "offline" || kind === "token_missing") model.tokenPath = "~/.loupe/token";
    return model;
  }

  function toggleStatusBar(): void {
    if (!state.authorized) return;
    state.showStatusBar = !state.showStatusBar;
    render();
  }

  function buildProjectFromPin(pin: PinRecord): { project_id: string; session_id: string } | null {
    const annotation = annotations.get(pin.id);
    if (annotation !== undefined) return annotation.project;
    return null;
  }

  async function doSave(element: Element, comment: string, kind: IntentKind): Promise<void> {
    const doc = opts.document;
    const selectedEntry = state.selectedProject !== null
      ? state.projects.find((p) => p.id === state.selectedProject)
      : undefined;
    const scopeInput: Parameters<typeof project_scope_from_url>[0] = {
      url: doc.location.href,
      title: doc.title,
    };
    if (selectedEntry?.id !== undefined) scopeInput.project_id = selectedEntry.id;
    if (selectedEntry?.workspace_root_hash !== undefined) scopeInput.workspace_root_hash = selectedEntry.workspace_root_hash;
    if (selectedEntry?.branch !== undefined) scopeInput.branch = selectedEntry.branch;
    const project = project_scope_from_url(scopeInput);
    const locator = capture_locator(element);
    const resolution = resolve(locator, doc);
    const context = buildContext(element, doc);
    const now = new Date().toISOString();
    const draft: AnnotationDraft = {
      id: crypto.randomUUID(),
      project,
      locator,
      resolution,
      comment,
      intent_kind: kind,
      context,
      now,
    };
    const annotation = create_annotation(draft);
    const key = session_marks_key(project.project_id, project.session_id);

    if (opts.storage !== undefined) {
      const stored = await opts.storage.get(key);
      const existing = stored[key];
      const arr: unknown[] = Array.isArray(existing) ? (existing as unknown[]) : [];
      // Throws on storage failure → surface-intent shows inline error
      await opts.storage.set({ [key]: [...arr, annotation] });
    }

    // Capture pin position before clearing intent
    const rect = state.intent?.rect ?? element.getBoundingClientRect();
    state.markCount += 1;
    const pinRecord: PinRecord = {
      id: annotation.id,
      num: state.markCount,
      element,
      rect,
      kind,
      comment,
      task: "open",
      loc: "located",
      confidence: 100,
      sync: "local",
    };
    annotations.set(annotation.id, annotation);
    state.pins.push(pinRecord);
    state.intent = null;
    instrumentation?.breadcrumb?.("save", annotation.context.element.selector_preview);
    render();

    // Show "Add another" near the new pin
    showAddAnother(rect);

    void syncSavedAnnotation(annotation.id, project);
  }

  async function syncSavedAnnotation(markId: string, project: Annotation["project"]): Promise<void> {
    const runtime = extensionRuntime();
    if (runtime === undefined || opts.storage === undefined) {
      void updateDaemonHealthAfterSave();
      return;
    }

    const response = await runtimeMessage(runtime, { type: MESSAGE_SERVICE_WORKER_WAKE, scope: project });
    if (isRecord(response) && response.reconciled === true) {
      await refreshStoredAnnotation(markId, project);
      state.daemonOnline = true;
      state.showFallback = false;
      state.daemonTokenMissing = false;
      render();
      return;
    }

    if (isRecord(response) && response.token_missing === true) {
      state.daemonTokenMissing = true;
      state.daemonOnline = true;
      state.showStatusBar = true;
      render();
      return;
    }

    void updateDaemonHealthAfterSave();
  }

  async function refreshStoredAnnotation(markId: string, project: Annotation["project"]): Promise<void> {
    if (opts.storage === undefined) return;
    const key = session_marks_key(project.project_id, project.session_id);
    const stored = await opts.storage.get(key).catch(() => ({} as Record<string, unknown>));
    const raw = stored[key];
    if (!Array.isArray(raw)) return;
    const annotation = (raw as Annotation[]).find((mark) => mark.id === markId);
    if (annotation === undefined) return;
    annotations.set(markId, annotation);
    const pin = state.pins.find((p) => p.id === markId);
    const nextSync = annotationToPinRecord(annotation, pin?.num ?? 1, opts.document).sync;
    if (pin !== undefined && nextSync !== undefined) pin.sync = nextSync;
  }

  async function updateDaemonHealthAfterSave(): Promise<void> {
    if (state.showFallback) return;
    const online = await probe_daemon_health().catch(() => false);
    state.daemonOnline = online;
    state.daemonTokenMissing = false;
    if (!online) {
      state.showFallback = true;
      render();
    }
  }

  function showAddAnother(pinRect: DOMRect): void {
    const { t } = i18n;
    const doc = opts.document;
    const view = doc.defaultView;
    const scrollY = view?.scrollY ?? 0;
    const vw = view?.innerWidth ?? 1024;
    const vh = view?.innerHeight ?? 768;

    const btn = host.dom.el("button", { class: "lp-add-another" }, [
      host.dom.el("span", { class: "lp-add-another-x", text: "+" }),
      host.dom.el("span", { text: t("intent.add") }),
    ]);

    const PAD = 8;
    const PANEL_WIDTH = 200;
    const left = Math.max(PAD, Math.min(pinRect.left + scrollY, vw - PANEL_WIDTH - PAD));
    const top = pinRect.top + scrollY + pinRect.height + PAD;

    btn.style.position = "absolute";
    btn.style.top = `${top}px`;
    btn.style.left = `${left}px`;

    btn.addEventListener("click", () => {
      if (detachAddAnother !== null) { detachAddAnother(); detachAddAnother = null; }
      startPicking();
    });

    // Auto-dismiss after 4s
    const timer = setTimeout(() => {
      if (detachAddAnother !== null) { detachAddAnother(); detachAddAnother = null; }
    }, 4000);

    const origDetach = host.mount(btn);
    detachAddAnother = () => {
      clearTimeout(timer);
      origDetach();
    };

    void vw; void vh;
  }

  function lastPinElement(): Element | null {
    return state.pins[state.pins.length - 1]?.element ?? null;
  }

  // Hand the dev-build instrumentation read-only access to the runtime so it can
  // observe state (current target, project scope) without owning any of it.
  function instrumentationScopeInput(): InstrumentationScopeInput {
    const doc = opts.document;
    const selectedEntry = state.selectedProject !== null ? state.projects.find((p) => p.id === state.selectedProject) : undefined;
    const scopeInput: InstrumentationScopeInput = { url: doc.location.href, title: doc.title };
    if (selectedEntry?.id !== undefined) scopeInput.project_id = selectedEntry.id;
    if (selectedEntry?.workspace_root_hash !== undefined) scopeInput.workspace_root_hash = selectedEntry.workspace_root_hash;
    if (selectedEntry?.branch !== undefined) scopeInput.branch = selectedEntry.branch;
    return scopeInput;
  }

  instrumentation?.attach?.({
    document: opts.document,
    getCurrentTarget: () => state.intent?.element ?? state.hover?.element ?? lastPinElement() ?? (opts.document.activeElement instanceof Element ? opts.document.activeElement : null),
    getScopeInput: instrumentationScopeInput,
  });

  // ⌥L global toggle: start / stop picking from anywhere on the page
  function onGlobalKey(e: KeyboardEvent): void {
    if (!state.authorized) return;
    if (e.altKey && (e.key === "l" || e.key === "L")) {
      e.preventDefault();
      if (state.picking) {
        state.picking = false;
        state.hover = null;
        render();
      } else if (state.intent === null) {
        startPicking();
      }
    }
  }
  opts.document.addEventListener("keydown", onGlobalKey);
  const win = opts.document.defaultView;
  win?.addEventListener("resize", render);
  void opts.document.fonts?.ready.then(() => { render(); });

  const app: SurfaceApp = {
    unmount: () => {
      instrumentation?.detach?.();
      opts.document.removeEventListener("keydown", onGlobalKey);
      win?.removeEventListener("resize", render);
      clearSurfaces();
      host.destroy();
    },
    toggleStatusBar,
  };

  render();

  // Async init: load stored pins, discover projects, check daemon health
  void (async () => {
    if (!state.authorized) return;
    if (opts.storage === undefined) return;
    const doc = opts.document;
    if (!doc.location?.href) return;

    // Load projects from storage index
    const projStored = await opts.storage.get(storage_keys.projects_index).catch(() => ({} as Record<string, unknown>));
    const projRaw = (projStored as Record<string, unknown>)[storage_keys.projects_index];
    if (Array.isArray(projRaw) && projRaw.length > 1) {
      state.projects = projRaw.map(rawToProjectEntry).filter((p) => p !== null) as ProjectEntry[];
    }

    // Load existing annotations for the current session
    const scope = project_scope_from_url({ url: doc.location.href, title: doc.title });
    const marksKey = session_marks_key(scope.project_id, scope.session_id);
    const marksStored = await opts.storage.get(marksKey).catch(() => ({} as Record<string, unknown>));
    const marksRaw = (marksStored as Record<string, unknown>)[marksKey];
    if (Array.isArray(marksRaw) && marksRaw.length > 0) {
      const loaded = (marksRaw as Annotation[]).filter((m) => m.lifecycle?.task_status !== "archived");
      for (const ann of loaded) {
        if (!annotations.has(ann.id)) {
          annotations.set(ann.id, ann);
          state.markCount += 1;
          state.pins.push(annotationToPinRecord(ann, state.markCount, doc));
        }
      }
      render();
    }

    // Passive daemon health check
    const online = await probe_daemon_health().catch(() => false);
    if (!online) {
      state.daemonOnline = false;
      // Only show fallback if there are local-only marks
      if (state.pins.some((p) => p.sync === "local" || p.sync === "failed")) {
        state.showFallback = true;
      }
      render();
    }
  })();

  return app;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
