// Minimal vanilla render core reused by every surface. No framework, no
// reactivity — surfaces build a tree with el(), and re-render by replacing it.
// createDom takes the page's document so surfaces never touch a global (keeps
// them unit-testable against a fake document).

export type ElProps = {
  class?: string;
  text?: string;
  attrs?: Record<string, string>;
  data?: Record<string, string>;
  style?: Record<string, string>;
  on?: Record<string, (event: Event) => void>;
};

export type Dom = {
  el: (tag: string, props?: ElProps, children?: Array<Node | string>) => HTMLElement;
  clear: (node: Node) => void;
};

export function createDom(doc: Document): Dom {
  const el = (tag: string, props: ElProps = {}, children: Array<Node | string> = []): HTMLElement => {
    const node = doc.createElement(tag);
    if (props.class !== undefined) node.className = props.class;
    if (props.text !== undefined) node.textContent = props.text;
    if (props.attrs !== undefined) {
      for (const [key, value] of Object.entries(props.attrs)) node.setAttribute(key, value);
    }
    if (props.data !== undefined) {
      for (const [key, value] of Object.entries(props.data)) node.dataset[key] = value;
    }
    if (props.style !== undefined) {
      for (const [key, value] of Object.entries(props.style)) {
        if (key.startsWith("--")) node.style.setProperty(key, value);
        else (node.style as unknown as Record<string, string>)[key] = value;
      }
    }
    if (props.on !== undefined) {
      for (const [type, handler] of Object.entries(props.on)) node.addEventListener(type, handler);
    }
    for (const child of children) node.append(child);
    return node;
  };

  const clear = (node: Node): void => {
    while (node.firstChild !== null) node.removeChild(node.firstChild);
  };

  return { el, clear };
}

type ReducedMotionEnv = { matchMedia?: (query: string) => { matches: boolean } };

export function prefersReducedMotion(env: ReducedMotionEnv = globalThis as ReducedMotionEnv): boolean {
  if (typeof env.matchMedia !== "function") return false;
  return env.matchMedia("(prefers-reduced-motion: reduce)").matches === true;
}
