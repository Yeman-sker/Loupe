// Serializes the DOM subtree around an anomaly target into a re-parseable HTML
// string — the seed for the offline replay fixture. Open shadow roots are
// expanded as declarative shadow DOM (<template shadowrootmode="open">) so the
// captured markup reconstructs the same tree offline. Closed shadow roots are
// inaccessible and left as the bare host (best-effort, flagged by absence).

const ELEMENT_NODE = 1;
const TEXT_NODE = 3;

const VOID_TAGS: ReadonlySet<string> = new Set(["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "param", "source", "track", "wbr"]);

type SnapshotNode = {
  readonly nodeType: number;
  readonly textContent?: string | null;
};

type SnapshotAttr = { readonly name: string; readonly value: string };

type SnapshotElement = SnapshotNode & {
  readonly tagName: string;
  readonly attributes: ArrayLike<SnapshotAttr>;
  readonly childNodes: ArrayLike<SnapshotNode>;
  readonly parentElement: SnapshotElement | null;
  readonly shadowRoot?: { readonly childNodes: ArrayLike<SnapshotNode> } | null;
  readonly contentDocument?: { readonly documentElement?: SnapshotElement | null } | null;
};

export type SnapshotOptions = {
  /** How many levels up from the target to root the captured subtree (default 3). */
  maxAncestors?: number;
  /** Hard cap on output size to keep bundles bounded (default 100_000 chars). */
  maxChars?: number;
  /** Attribute injected on the target element so offline replay can find it. */
  markerAttr?: string;
};

export const DEFAULT_TARGET_MARKER = "data-loupe-target";

export function serializeAnomalySnapshot(target: SnapshotElement, options: SnapshotOptions = {}): string {
  const maxAncestors = options.maxAncestors ?? 3;
  const markerAttr = options.markerAttr ?? DEFAULT_TARGET_MARKER;
  const maxChars = options.maxChars ?? 100_000;

  const out: string[] = [];
  serializeNode(ancestorWithin(target, maxAncestors), target, markerAttr, out);
  const html = out.join("");
  return html.length > maxChars ? `${html.slice(0, maxChars)}\n<!-- loupe: snapshot truncated at ${maxChars} chars -->` : html;
}

function ancestorWithin(el: SnapshotElement, up: number): SnapshotElement {
  let node = el;
  for (let i = 0; i < up; i += 1) {
    const parent = node.parentElement;
    if (parent === null) break;
    node = parent;
  }
  return node;
}

function serializeNode(node: SnapshotNode, target: SnapshotElement, markerAttr: string, out: string[]): void {
  if (node.nodeType === TEXT_NODE) {
    out.push(escapeText(node.textContent ?? ""));
    return;
  }
  if (node.nodeType !== ELEMENT_NODE) return;

  const el = node as SnapshotElement;
  const tag = el.tagName.toLowerCase();
  out.push(`<${tag}${serializeAttrs(el, el === target ? markerAttr : undefined)}>`);
  if (VOID_TAGS.has(tag)) return;

  if (el.shadowRoot != null) {
    out.push(`<template shadowrootmode="open">`);
    serializeChildren(el.shadowRoot.childNodes, target, markerAttr, out);
    out.push(`</template>`);
  }
  if (tag === "iframe") {
    const frameRoot = el.contentDocument?.documentElement ?? null;
    if (frameRoot !== null) {
      out.push(`<template data-loupe-frame="same-origin">`);
      serializeNode(frameRoot, target, markerAttr, out);
      out.push(`</template>`);
    }
  }
  serializeChildren(el.childNodes, target, markerAttr, out);
  out.push(`</${tag}>`);
}

function serializeChildren(children: ArrayLike<SnapshotNode>, target: SnapshotElement, markerAttr: string, out: string[]): void {
  for (let i = 0; i < children.length; i += 1) {
    const child = children[i];
    if (child !== undefined) serializeNode(child, target, markerAttr, out);
  }
}

function serializeAttrs(el: SnapshotElement, marker: string | undefined): string {
  const parts: string[] = [];
  for (let i = 0; i < el.attributes.length; i += 1) {
    const attr = el.attributes[i];
    if (attr !== undefined) parts.push(` ${attr.name}="${escapeAttr(attr.value)}"`);
  }
  if (marker !== undefined) parts.push(` ${marker}=""`);
  return parts.join("");
}

function escapeText(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function escapeAttr(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
