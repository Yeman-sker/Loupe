// Dependency-free offline DOM for replaying anomaly snapshots and locator
// robustness fixtures without a browser. Two entry points share one FakeDOM:
//
//   - The locator-robustness suite builds trees programmatically (createElement).
//   - Anomaly repro tests parse a captured `dom.html` snapshot (parse_snapshot_html).
//
// Both feed the same FakeDocument/FakeElement to `resolve()`. The snapshot is
// structural (no per-element geometry), so geometry-based matching does not
// contribute offline; attribute / text / role / shadow_path evidence does.
// `install_offline_dom_globals()` must run before `resolve()` because the
// locator runtime reads globalThis.Element / ShadowRoot / Node / CSS.escape.

export const DEFAULT_TARGET_MARKER = "data-loupe-target";

type FakeRect = { x: number; y: number; width: number; height: number };

type FakeParent = FakeDocument | FakeElement | FakeShadowRoot;

const VOID_TAGS: ReadonlySet<string> = new Set(["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "param", "source", "track", "wbr"]);

export class FakeTextNode {
  readonly nodeType = 3;
  parentNode: FakeParent | null = null;
  ownerDocument: FakeDocument;

  constructor(ownerDocument: FakeDocument, public data: string) {
    this.ownerDocument = ownerDocument;
  }

  get textContent(): string {
    return this.data;
  }
}

class FakeClassList implements Iterable<string> {
  constructor(private readonly element: FakeElement) {}

  get length(): number {
    return this.values().length;
  }

  contains(value: string): boolean {
    return this.values().includes(value);
  }

  item(index: number): string | null {
    return this.values()[index] ?? null;
  }

  values(): string[] {
    const className = this.element.className.trim();
    return className === "" ? [] : className.split(/\s+/);
  }

  toString(): string {
    return this.element.className;
  }

  [Symbol.iterator](): Iterator<string> {
    return this.values()[Symbol.iterator]();
  }
}

export class FakeElement {
  readonly nodeType = 1;
  readonly classList = new FakeClassList(this);
  childNodes: Array<FakeElement | FakeTextNode> = [];
  parentNode: FakeParent | null = null;
  ownerDocument: FakeDocument;
  shadowRoot: FakeShadowRoot | null = null;
  scrollTop = 0;
  scrollLeft = 0;
  contentDocument?: FakeDocument;
  private readonly attrs = new Map<string, string>();
  private rect: FakeRect = { x: 0, y: 0, width: 0, height: 0 };

  constructor(ownerDocument: FakeDocument, readonly localName: string, readonly namespaceURI: string | null = null) {
    this.ownerDocument = ownerDocument;
  }

  get tagName(): string {
    return this.localName.toUpperCase();
  }

  get id(): string {
    return this.getAttribute("id") ?? "";
  }

  set id(value: string) {
    this.setAttribute("id", value);
  }

  get className(): string {
    return this.getAttribute("class") ?? "";
  }

  set className(value: string) {
    this.setAttribute("class", value);
  }

  get children(): FakeElement[] {
    return this.childNodes.filter((node): node is FakeElement => node instanceof FakeElement);
  }

  get parentElement(): FakeElement | null {
    return this.parentNode instanceof FakeElement ? this.parentNode : null;
  }

  get textContent(): string {
    return this.childNodes.map((node) => node.textContent ?? "").join("");
  }

  set textContent(value: string) {
    this.replaceText(value);
  }

  get innerText(): string {
    return this.textContent;
  }

  get attributes(): Array<{ name: string; value: string }> & { item: (index: number) => { name: string; value: string } | null } {
    const attrs = Array.from(this.attrs, ([name, value]) => ({ name, value })) as Array<{ name: string; value: string }> & {
      item: (index: number) => { name: string; value: string } | null;
    };
    attrs.item = (index: number) => attrs[index] ?? null;
    return attrs;
  }

  append(...nodes: Array<FakeElement | FakeTextNode>): void {
    for (const node of nodes) {
      detach_node(node);
      node.parentNode = this;
      node.ownerDocument = this.ownerDocument;
      this.childNodes.push(node);
    }
  }

  insertBefore(node: FakeElement | FakeTextNode, before: FakeElement | FakeTextNode | null): void {
    detach_node(node);
    node.parentNode = this;
    node.ownerDocument = this.ownerDocument;
    const index = before === null ? -1 : this.childNodes.indexOf(before);
    if (index === -1) this.childNodes.push(node);
    else this.childNodes.splice(index, 0, node);
  }

  remove(): void {
    detach_node(this);
  }

  setAttribute(name: string, value: string): void {
    this.attrs.set(name, value);
  }

  getAttribute(name: string): string | null {
    return this.attrs.get(name) ?? null;
  }

  hasAttribute(name: string): boolean {
    return this.attrs.has(name);
  }

  removeAttribute(name: string): void {
    this.attrs.delete(name);
  }

  attachShadow(_init: { mode: "open" | "closed" }): FakeShadowRoot {
    const shadowRoot = new FakeShadowRoot(this.ownerDocument, this);
    this.shadowRoot = shadowRoot;
    return shadowRoot;
  }

  querySelectorAll(selector: string): FakeElement[] {
    return query_selector_all(this, selector);
  }

  querySelector(selector: string): FakeElement | null {
    return this.querySelectorAll(selector)[0] ?? null;
  }

  matches(selector: string): boolean {
    return matches_selector(this, selector);
  }

  closest(selector: string): FakeElement | null {
    let current: FakeElement | null = this;
    while (current !== null) {
      if (current.matches(selector)) return current;
      current = current.parentElement;
    }
    return null;
  }

  contains(other: FakeElement): boolean {
    return this === other || collect_descendants(this).includes(other);
  }

  getRootNode(): FakeDocument | FakeShadowRoot {
    let node: FakeParent | FakeElement = this;
    while (node.parentNode !== null) node = node.parentNode;
    return node instanceof FakeShadowRoot ? node : this.ownerDocument;
  }

  getBoundingClientRect(): DOMRect {
    const { x, y, width, height } = this.rect;
    return {
      x,
      y,
      width,
      height,
      top: y,
      left: x,
      right: x + width,
      bottom: y + height,
      toJSON: () => ({ x, y, width, height }),
    } as DOMRect;
  }

  setRect(rect: FakeRect): void {
    this.rect = rect;
  }

  replaceText(value: string): void {
    for (const child of this.childNodes) child.parentNode = null;
    this.childNodes = [new FakeTextNode(this.ownerDocument, value)];
    const first = this.childNodes[0];
    if (first === undefined) throw new Error("text node must be present after replaceText");
    first.parentNode = this;
  }

  createTextNodeElement(value: string): FakeTextNode {
    return new FakeTextNode(this.ownerDocument, value);
  }
}

export class FakeShadowRoot {
  readonly nodeType = 11;
  childNodes: Array<FakeElement | FakeTextNode> = [];
  parentNode: null = null;

  constructor(readonly ownerDocument: FakeDocument, readonly host: FakeElement) {}

  get children(): FakeElement[] {
    return this.childNodes.filter((node): node is FakeElement => node instanceof FakeElement);
  }

  append(...nodes: Array<FakeElement | FakeTextNode>): void {
    for (const node of nodes) {
      detach_node(node);
      node.parentNode = this;
      node.ownerDocument = this.ownerDocument;
      this.childNodes.push(node);
    }
  }

  querySelectorAll(selector: string): FakeElement[] {
    return query_selector_all(this, selector);
  }

  querySelector(selector: string): FakeElement | null {
    return this.querySelectorAll(selector)[0] ?? null;
  }
}

function detach_node(node: FakeElement | FakeTextNode): void {
  if (node.parentNode === null) return;
  const siblings = node.parentNode.childNodes;
  const index = siblings.indexOf(node as FakeElement & FakeTextNode);
  if (index !== -1) siblings.splice(index, 1);
  node.parentNode = null;
}

export class FakeDocument {
  readonly nodeType = 9;
  readonly documentElement: FakeElement;
  readonly body: FakeElement;
  readonly defaultView: { frameElement: FakeElement | null; innerWidth: number; innerHeight: number; devicePixelRatio: number };
  childNodes: FakeElement[] = [];
  parentNode: null = null;
  ownerDocument: FakeDocument = this;

  constructor(frameElement: FakeElement | null = null) {
    this.defaultView = { frameElement, innerWidth: 1280, innerHeight: 720, devicePixelRatio: 2 };
    this.documentElement = new FakeElement(this, "html");
    this.body = new FakeElement(this, "body");
    this.documentElement.append(this.body);
    this.childNodes = [this.documentElement];
  }

  get children(): FakeElement[] {
    return this.childNodes;
  }

  createElement(tagName: string): FakeElement {
    return new FakeElement(this, tagName.toLowerCase());
  }

  createElementNS(namespaceURI: string, tagName: string): FakeElement {
    return new FakeElement(this, tagName.toLowerCase(), namespaceURI);
  }

  createTextNodeElement(value: string): FakeTextNode {
    return new FakeTextNode(this, value);
  }

  querySelectorAll(selector: string): FakeElement[] {
    return query_selector_all(this, selector);
  }

  querySelector(selector: string): FakeElement | null {
    return this.querySelectorAll(selector)[0] ?? null;
  }

  elementFromPoint(x: number, y: number): FakeElement | null {
    const matches = collect_descendants(this).filter((element) => {
      const rect = element.getBoundingClientRect();
      return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
    });
    return matches[matches.length - 1] ?? null;
  }
}

function query_selector_all(root: FakeDocument | FakeElement | FakeShadowRoot, selector: string): FakeElement[] {
  const selectors = selector.split(",").map((part) => part.trim()).filter(Boolean);
  const descendants = collect_descendants(root);
  return descendants.filter((element) => selectors.some((part) => matches_selector(element, part)));
}

function collect_descendants(root: FakeDocument | FakeElement | FakeShadowRoot): FakeElement[] {
  const result: FakeElement[] = [];
  const visit = (node: FakeDocument | FakeElement | FakeShadowRoot): void => {
    for (const child of node.children) {
      result.push(child);
      visit(child);
      if (child.shadowRoot !== null) visit(child.shadowRoot);
      // Browser querySelectorAll/contains traversal stops at iframe shells; contentDocument
      // is a separate document and must be entered explicitly through Locator.frame_path.
    }
  };
  visit(root);
  return result;
}

function matches_selector(element: FakeElement, selector: string): boolean {
  const directParts = selector.split(">").map((part) => part.trim()).filter(Boolean);
  if (directParts.length > 1) return matches_direct_selector(element, directParts.length - 1, directParts);
  return matches_simple_selector(element, selector.trim());
}

function matches_direct_selector(element: FakeElement, index: number, parts: string[]): boolean {
  if (!matches_simple_selector(element, parts[index] ?? "")) return false;
  if (index === 0) return true;
  const parent = element.parentElement;
  return parent !== null && matches_direct_selector(parent, index - 1, parts);
}

function matches_simple_selector(element: FakeElement, selector: string): boolean {
  if (selector === "" || selector === "*") return true;

  const nthMatch = /:nth-of-type\((\d+)\)/.exec(selector);
  const withoutNth = selector.replace(/:nth-of-type\(\d+\)/g, "");
  if (nthMatch !== null) {
    const expectedIndex = Number(nthMatch[1]);
    const siblings = element.parentElement?.children.filter((sibling) => sibling.localName === element.localName) ?? [];
    if (siblings.indexOf(element) + 1 !== expectedIndex) return false;
  }

  const idMatch = /#([A-Za-z0-9_-]+)/.exec(withoutNth);
  if (idMatch !== null && element.id !== idMatch[1]) return false;

  for (const classMatch of withoutNth.matchAll(/\.([A-Za-z0-9_-]+)/g)) {
    const className = classMatch[1];
    if (className === undefined || !element.classList.contains(className)) return false;
  }

  for (const attrMatch of withoutNth.matchAll(/\[([^=\]\s]+)(?:=["']?([^"'\]]+)["']?)?\]/g)) {
    const attrName = attrMatch[1];
    const attrValue = attrMatch[2];
    if (attrName === undefined || !element.hasAttribute(attrName)) return false;
    if (attrValue !== undefined && element.getAttribute(attrName) !== attrValue) return false;
  }

  const tag = withoutNth.replace(/#[A-Za-z0-9_-]+/g, "").replace(/\.[A-Za-z0-9_-]+/g, "").replace(/\[[^\]]+\]/g, "").trim();
  return tag === "" || tag.toLowerCase() === element.localName;
}

export function install_offline_dom_globals(): void {
  const globals = globalThis as Record<string, unknown>;
  globals.Element = FakeElement;
  globals.HTMLElement = FakeElement;
  globals.SVGElement = FakeElement;
  globals.ShadowRoot = FakeShadowRoot;
  globals.Document = FakeDocument;
  globals.DocumentFragment = FakeShadowRoot;
  globals.Node = { ELEMENT_NODE: 1, TEXT_NODE: 3, DOCUMENT_NODE: 9, DOCUMENT_FRAGMENT_NODE: 11 };
  globals.CSS = { escape: (value: string) => value.replace(/(["'\\#.:\[\]>])/g, "\\$1") };
  globals.getComputedStyle = () => ({ getPropertyValue: () => "" });
}

// --- Snapshot HTML parser ---------------------------------------------------
// Reconstructs the FakeDocument tree from `serializeAnomalySnapshot` output:
// structural tags + attributes, text nodes, and open shadow roots expanded as
// `<template shadowrootmode="open">`. Comments (e.g. the truncation marker) are
// skipped. The parsed subtree is appended under document.body.

/** Parse a captured anomaly snapshot into an offline FakeDocument. */
export function parse_snapshot_html(html: string): FakeDocument {
  const doc = new FakeDocument();
  const stack: Array<FakeElement | FakeShadowRoot> = [doc.body];
  let cursor = 0;

  const currentParent = (): FakeElement | FakeShadowRoot => {
    const top = stack[stack.length - 1];
    if (top === undefined) throw new Error("snapshot parser: empty element stack");
    return top;
  };

  while (cursor < html.length) {
    const lt = html.indexOf("<", cursor);
    if (lt === -1) {
      append_text(doc, currentParent(), html.slice(cursor));
      break;
    }
    if (lt > cursor) append_text(doc, currentParent(), html.slice(cursor, lt));

    if (html.startsWith("<!--", lt)) {
      const end = html.indexOf("-->", lt + 4);
      cursor = end === -1 ? html.length : end + 3;
      continue;
    }

    const gt = html.indexOf(">", lt);
    if (gt === -1) {
      append_text(doc, currentParent(), html.slice(lt));
      break;
    }
    const rawTag = html.slice(lt + 1, gt).trim();
    cursor = gt + 1;

    if (rawTag.startsWith("/")) {
      const name = rawTag.slice(1).trim().toLowerCase();
      pop_to_tag(stack, name);
      continue;
    }

    const selfClosing = rawTag.endsWith("/");
    const body = selfClosing ? rawTag.slice(0, -1).trim() : rawTag;
    const { name, attrs } = parse_open_tag(body);

    if (name === "template" && attrs.some(([attrName]) => attrName === "shadowrootmode")) {
      const host = currentParent();
      if (host instanceof FakeElement) {
        const shadow = host.attachShadow({ mode: "open" });
        stack.push(shadow);
      }
      continue;
    }

    const element = doc.createElement(name);
    for (const [attrName, attrValue] of attrs) element.setAttribute(attrName, attrValue);
    currentParent().append(element);

    if (!selfClosing && !VOID_TAGS.has(name)) stack.push(element);
  }

  return doc;
}

/** Find the element flagged as the anomaly target by the snapshot serializer. */
export function find_anomaly_target(root: FakeDocument, marker: string = DEFAULT_TARGET_MARKER): FakeElement | null {
  return root.querySelector(`[${marker}]`);
}

function append_text(doc: FakeDocument, parent: FakeElement | FakeShadowRoot, raw: string): void {
  if (raw.length === 0) return;
  const text = unescape_html(raw);
  if (text.length === 0) return;
  parent.append(new FakeTextNode(doc, text));
}

function pop_to_tag(stack: Array<FakeElement | FakeShadowRoot>, name: string): void {
  // A `</template>` closes the open shadow root on the stack top.
  if (name === "template") {
    if (stack.length > 1 && stack[stack.length - 1] instanceof FakeShadowRoot) stack.pop();
    return;
  }
  for (let i = stack.length - 1; i >= 1; i -= 1) {
    const node = stack[i];
    if (node instanceof FakeElement && node.localName === name) {
      stack.length = i;
      return;
    }
  }
}

function parse_open_tag(body: string): { name: string; attrs: Array<[string, string]> } {
  const nameMatch = /^([A-Za-z][A-Za-z0-9:-]*)/.exec(body);
  const name = (nameMatch?.[1] ?? body).toLowerCase();
  const attrs: Array<[string, string]> = [];
  const attrRe = /([^\s=/]+)(?:\s*=\s*"([^"]*)")?/g;
  attrRe.lastIndex = name.length;
  let match: RegExpExecArray | null;
  while ((match = attrRe.exec(body)) !== null) {
    const attrName = match[1];
    if (attrName === undefined || attrName.length === 0) break;
    attrs.push([attrName, unescape_html(match[2] ?? "")]);
  }
  return { name, attrs };
}

function unescape_html(value: string): string {
  return value
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}
