export const LOUPE_SCHEMA_VERSION = 1 as const;
export const LOUPE_DAEMON_NAME = "loupe" as const;
export const LOUPE_DEFAULT_PORT = 7373 as const;
export const LOUPE_AUTH_SCHEME = "Bearer" as const;
export const LOUPE_TOKEN_MIN_BYTES = 32 as const;
export const LOUPE_HOME_DIR = "~/.loupe" as const;
export const LOUPE_TOKEN_PATH = "~/.loupe/token" as const;
export const LOUPE_SERVER_STATUS_PATH = "~/.loupe/server.json" as const;
export const LOUPE_MARKS_PATH = "~/.loupe/marks.json" as const;
export const LOUPE_SERVER_LOG_PATH = "~/.loupe/server.log" as const;

export const error_codes = {
  scope_required: "SCOPE_REQUIRED",
  multi_project: "MULTI_PROJECT",
  unauthorized: "UNAUTHORIZED",
  not_found: "NOT_FOUND",
  conflict: "CONFLICT",
  invalid_request: "INVALID_REQUEST",
  internal_error: "INTERNAL_ERROR",
} as const;

export type ErrorCode = (typeof error_codes)[keyof typeof error_codes];

export type LoupeError = {
  code: ErrorCode;
  message: string;
  candidates?: ProjectScopeCandidate[];
};

export const storage_key_prefix = "loupe:v1" as const;

export const storage_keys = {
  projects_index: "loupe:v1:projects:index",
  settings: "loupe:v1:settings",
  project_sessions_index: (project_id: string): `loupe:v1:project:${string}:sessions:index` =>
    `loupe:v1:project:${project_id}:sessions:index`,
  session_marks: (project_id: string, session_id: string): `loupe:v1:project:${string}:session:${string}:marks` =>
    `loupe:v1:project:${project_id}:session:${session_id}:marks`,
  project_tombstones: (project_id: string): `loupe:v1:project:${string}:tombstones` =>
    `loupe:v1:project:${project_id}:tombstones`,
} as const;

export type ProjectScope = {
  project_id: string;
  workspace_root_hash: string;
  branch?: string;
  origin: string;
  route_key: string;
  session_id: string;
};

export type ProjectScopeWithUrl = ProjectScope & {
  url: string;
  title?: string;
};

export type ProjectScopeCandidate = Partial<ProjectScopeWithUrl> & {
  project_id: string;
};

export type ProjectIdScopeInput = {
  project_id: string;
  workspace_root_hash?: string;
  branch?: string;
  origin?: string;
  url?: string;
  route_key?: string;
  session_id?: string;
};

export type ExplicitRouteScopeInput = {
  project_id?: never;
  workspace_root_hash: string;
  url: string;
  route_key: string;
  branch?: string;
  origin?: string;
  session_id?: string;
};

export type ProjectScopeInput = ProjectIdScopeInput | ExplicitRouteScopeInput;

export type SelectorStrategy =
  | "shadow_path"
  | "stable_attr"
  | "stable_id"
  | "role_name"
  | "stable_class"
  | "text"
  | "parent_chain"
  | "nth_path"
  | "geometry";

export type FrameLocatorPathItem = {
  selector: string;
  index?: number;
  name?: string;
};

export type FrameLocatorPath = FrameLocatorPathItem[];

export type LocatorStatus = "resolved" | "drifted" | "lost";

export type BoundaryKind =
  | "cross_origin_iframe"
  | "canvas_internal_target"
  | "closed_shadow_root"
  | "svg_internal_target";

export type TargetScope = "internal_element" | "boundary_shell";

export type TargetBoundary = {
  kind: BoundaryKind;
  target_scope: TargetScope;
  internal_target_supported: boolean;
  shell_selector?: string;
  reason: string;
};

export type LocatorSelector = {
  selector: string;
  strategy: SelectorStrategy;
};

export type LocatorGeometry = {
  x: number;
  y: number;
  width: number;
  height: number;
  viewport_width: number;
  viewport_height: number;
  dpr: number;
};

export type LocatorTextEvidence = {
  normalized: string;
  hash: string;
  length: number;
};

export type LocatorClassEvidence = {
  stable: string[];
  total: number;
};

export type LocatorParentEvidence = {
  tag: string;
  role?: string;
  stable_attr?: string;
  stable_class?: string;
};

export type LocatorEvidence = {
  stable_attrs?: Record<string, string>;
  stable_id?: string;
  tag: string;
  role?: string;
  accessible_name?: string;
  classes?: LocatorClassEvidence;
  text?: LocatorTextEvidence;
  nth_path: string;
  parent_chain: LocatorParentEvidence[];
  shadow_path?: string[];
  geometry?: LocatorGeometry;
  boundary?: TargetBoundary;
};

export type Locator = {
  frame_path?: FrameLocatorPath;
  primary: LocatorSelector;
  alternates: LocatorSelector[];
  evidence: LocatorEvidence;
};

export type CaptureLocatorOptions = {
  max_text_length?: number;
  max_parent_depth?: number;
  max_alternates?: number;
  include_geometry?: boolean;
};

const stable_attr_names = ["data-testid", "data-cy", "data-qa", "data-component", "name"] as const;
const default_capture_options = {
  max_text_length: 240,
  max_parent_depth: 5,
  max_alternates: 12,
  include_geometry: true,
} as const;

const utility_class_names: ReadonlySet<string> = new Set([
  "active",
  "block",
  "bold",
  "clearfix",
  "container",
  "disabled",
  "flex",
  "grid",
  "hidden",
  "inline",
  "italic",
  "relative",
  "selected",
  "sr-only",
  "sticky",
  "visible",
]);

const implicit_roles: Readonly<Record<string, string>> = {
  a: "link",
  article: "article",
  aside: "complementary",
  button: "button",
  form: "form",
  h1: "heading",
  h2: "heading",
  h3: "heading",
  h4: "heading",
  h5: "heading",
  h6: "heading",
  header: "banner",
  img: "img",
  input: "textbox",
  main: "main",
  nav: "navigation",
  ol: "list",
  option: "option",
  progress: "progressbar",
  section: "region",
  select: "combobox",
  table: "table",
  textarea: "textbox",
  ul: "list",
};

function get_owner_document(element: Element): Document {
  return element.ownerDocument;
}

function get_view(element: Element): Window | null {
  return get_owner_document(element).defaultView;
}

function css_escape(value: string, view: Window | null): string {
  const css = view ? (view as Window & { CSS?: { escape?: (value: string) => string } }).CSS : undefined;
  if (typeof css?.escape === "function") return css.escape(value);
  return value.replace(/\0/g, "\uFFFD").replace(/(^-?\d)|[^A-Za-z0-9_-]/g, (match) =>
    Array.from(match, (character) => `\\${(character.codePointAt(0) ?? 0).toString(16)} `).join(""),
  );
}

function css_string(value: string): string {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\a ").replace(/\r/g, "\\d ").replace(/\f/g, "\\c ")}"`;
}

function selector_matches(root: Document | ShadowRoot, selector: string): number {
  try {
    return root.querySelectorAll(selector).length;
  } catch {
    return 0;
  }
}

function add_selector(selectors: LocatorSelector[], seen: Set<string>, selector: string, strategy: SelectorStrategy): void {
  if (selector.length === 0 || seen.has(selector)) return;
  seen.add(selector);
  selectors.push({ selector, strategy });
}

function get_parent_element(element: Element): Element | null {
  const parent = element.parentElement;
  if (parent) return parent;
  const root = element.getRootNode();
  return root instanceof ShadowRoot ? root.host : null;
}

function element_index(element: Element): number {
  let index = 1;
  let sibling = element.previousElementSibling;
  while (sibling) {
    if (sibling.localName === element.localName) index += 1;
    sibling = sibling.previousElementSibling;
  }
  return index;
}

function element_path_segment(element: Element, view: Window | null): string {
  const tag = element.localName.toLowerCase();
  const stable_attrs = get_stable_attrs(element);
  for (const name of stable_attr_names) {
    const value = stable_attrs[name];
    if (value) return `${tag}[${name}=${css_string(value)}]`;
  }
  if (is_stable_id(element.id)) return `${tag}#${css_escape(element.id, view)}`;
  const classes = filter_stable_classes(element.classList ? Array.from(element.classList) : []);
  if (classes.length > 0) return `${tag}.${css_escape(classes[0] as string, view)}`;
  return `${tag}:nth-of-type(${element_index(element)})`;
}

function get_root_for_selector(element: Element): Document | ShadowRoot {
  const root = element.getRootNode();
  return root instanceof ShadowRoot ? root : get_owner_document(element);
}

function build_nth_path(element: Element, stop_at_shadow_root: boolean): string {
  const view = get_view(element);
  const segments: string[] = [];
  let current: Element | null = element;
  while (current) {
    segments.unshift(element_path_segment(current, view));
    const parent: Element | null = current.parentElement;
    if (parent) {
      current = parent;
      continue;
    }
    if (stop_at_shadow_root) break;
    const root = current.getRootNode();
    current = root instanceof ShadowRoot ? root.host : null;
  }
  return segments.join(" > ");
}

function build_frame_selector(frame: Element): string {
  const view = get_view(frame);
  const stable_attrs = get_stable_attrs(frame);
  for (const name of stable_attr_names) {
    const value = stable_attrs[name];
    if (value) return `[${name}=${css_string(value)}]`;
  }
  if (is_stable_id(frame.id)) return `#${css_escape(frame.id, view)}`;
  return build_nth_path(frame, false);
}

function frame_document_index(frame: Element): number | undefined {
  const parent_document = get_owner_document(frame);
  const frames = query_elements(parent_document, "iframe, frame");
  const index = frames.indexOf(frame);
  return index >= 0 ? index : undefined;
}

function frame_name(frame: Element): string | undefined {
  const name = frame.getAttribute("name") || frame.getAttribute("id");
  return name || undefined;
}

function capture_frame_path(element: Element): FrameLocatorPath | undefined {
  const path: FrameLocatorPath = [];
  let document: Document | null = get_owner_document(element);
  while (document) {
    let frame: Element | null = null;
    try {
      const view = document.defaultView;
      frame = view?.frameElement ?? null;
    } catch {
      return path.length > 0 ? path : undefined;
    }
    if (!frame) break;
    const item: FrameLocatorPathItem = { selector: build_frame_selector(frame) };
    const index = frame_document_index(frame);
    if (index !== undefined) item.index = index;
    const name = frame_name(frame);
    if (name) item.name = name;
    path.unshift(item);
    document = get_owner_document(frame);
  }
  return path.length > 0 ? path : undefined;
}

function get_stable_attrs(element: Element): Record<string, string> {
  const attrs: Record<string, string> = {};
  for (const name of stable_attr_names) {
    const value = element.getAttribute(name);
    if (value && value.length <= 160) attrs[name] = value;
  }
  return attrs;
}

export function normalize_locator_text(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

export function hash_locator_text(text: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

export function is_stable_id(id: string | null | undefined): id is string {
  if (!id) return false;
  if (id.length < 2 || id.length > 80) return false;
  if (/\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/i.test(id)) return false;
  if (/(?:^|[-_:])\d{3,}$/.test(id)) return false;
  if (/[a-f0-9]{8,}/i.test(id)) return false;
  if (/^(?:css|sc|_)?[A-Za-z]{0,3}[-_][A-Za-z0-9_-]{5,}$/.test(id)) return false;
  if (/^[A-Za-z0-9_-]*\d[A-Za-z0-9_-]*$/.test(id) && /[-_][A-Za-z0-9]{4,}$/.test(id)) return false;
  return true;
}

export function filter_stable_classes(classes: readonly string[]): string[] {
  const stable: string[] = [];
  for (const class_name of classes) {
    if (class_name.length < 2 || class_name.length > 64) continue;
    if (utility_class_names.has(class_name)) continue;
    if (/^(?:m|p|w|h|min-w|min-h|max-w|max-h|text|bg|border|rounded|shadow|opacity|z|top|right|bottom|left|translate|scale|rotate)-/.test(class_name)) continue;
    if (/^(?:sm|md|lg|xl|2xl):/.test(class_name)) continue;
    if (/^-?\d/.test(class_name)) continue;
    if (/[a-f0-9]{7,}/i.test(class_name)) continue;
    if (/__[A-Za-z0-9_-]{5,}$/.test(class_name) || /_[A-Za-z0-9_-]{6,}$/.test(class_name)) continue;
    stable.push(class_name);
  }
  return stable;
}

function get_role(element: Element): string | undefined {
  const explicit = element.getAttribute("role")?.trim();
  if (explicit) return explicit.split(/\s+/, 1)[0];
  const tag = element.localName.toLowerCase();
  if (tag === "a" && !element.hasAttribute("href")) return undefined;
  if (tag === "input") {
    const type = (element.getAttribute("type") ?? "text").toLowerCase();
    if (type === "button" || type === "submit" || type === "reset") return "button";
    if (type === "checkbox") return "checkbox";
    if (type === "radio") return "radio";
    if (type === "range") return "slider";
    if (type === "search") return "searchbox";
  }
  return implicit_roles[tag];
}

function get_element_text(element: Element): string {
  const tag = element.localName.toLowerCase();
  if (tag === "input") {
    const input = element as HTMLInputElement;
    return input.value || input.placeholder || "";
  }
  if (tag === "textarea") {
    const textarea = element as HTMLTextAreaElement;
    return textarea.value || textarea.placeholder || "";
  }
  if (tag === "img") return (element as HTMLImageElement).alt;
  return element.textContent ?? "";
}

function get_accessible_name(element: Element, normalized_text: string): string | undefined {
  const labelled_by = element.getAttribute("aria-labelledby");
  if (labelled_by) {
    const root = get_root_for_selector(element);
    const parts: string[] = [];
    for (const id of labelled_by.split(/\s+/)) {
      if (!id) continue;
      const label = root.querySelector(`#${css_escape(id, get_view(element))}`);
      if (label) parts.push(normalize_locator_text(label.textContent ?? ""));
    }
    const joined = normalize_locator_text(parts.join(" "));
    if (joined) return joined;
  }
  const aria_label = element.getAttribute("aria-label")?.trim();
  if (aria_label) return normalize_locator_text(aria_label);
  if (element.localName.toLowerCase() === "input") {
    const input = element as HTMLInputElement;
    const value = element.getAttribute("value") ?? input.placeholder;
    if (value) return normalize_locator_text(value);
  }
  return normalized_text || undefined;
}

function capture_geometry(element: Element): LocatorGeometry | undefined {
  const view = get_view(element);
  if (!view || typeof element.getBoundingClientRect !== "function") return undefined;
  const rect = element.getBoundingClientRect();
  return {
    x: rect.x,
    y: rect.y,
    width: rect.width,
    height: rect.height,
    viewport_width: view.innerWidth,
    viewport_height: view.innerHeight,
    dpr: view.devicePixelRatio || 1,
  };
}

function capture_parent_chain(element: Element, max_depth: number): LocatorParentEvidence[] {
  const chain: LocatorParentEvidence[] = [];
  let parent = get_parent_element(element);
  while (parent && chain.length < max_depth) {
    const item: LocatorParentEvidence = { tag: parent.localName.toLowerCase() };
    const role = get_role(parent);
    if (role) item.role = role;
    const stable_attrs = get_stable_attrs(parent);
    for (const name of stable_attr_names) {
      const value = stable_attrs[name];
      if (value) {
        item.stable_attr = `${name}=${value}`;
        break;
      }
    }
    const stable_classes = filter_stable_classes(parent.classList ? Array.from(parent.classList) : []);
    if (stable_classes.length > 0) item.stable_class = stable_classes[0] as string;
    chain.push(item);
    parent = get_parent_element(parent);
  }
  return chain;
}

function capture_shadow_path(element: Element): string[] | undefined {
  const path: string[] = [];
  let current: Element | null = element;
  while (current) {
    const root = current.getRootNode();
    if (root instanceof ShadowRoot) {
      path.unshift(build_nth_path(current, true));
      current = root.host;
      continue;
    }
    if (path.length > 0) path.unshift(build_nth_path(current, true));
    break;
  }
  return path.length > 0 ? path : undefined;
}

function build_selector_cascade(element: Element, evidence: LocatorEvidence, max_alternates: number): LocatorSelector[] {
  const root = get_root_for_selector(element);
  const view = get_view(element);
  const tag = evidence.tag;
  const selectors: LocatorSelector[] = [];
  const seen = new Set<string>();

  for (const name of stable_attr_names) {
    const value = evidence.stable_attrs?.[name];
    if (!value) continue;
    add_selector(selectors, seen, `[${name}=${css_string(value)}]`, "stable_attr");
    add_selector(selectors, seen, `${tag}[${name}=${css_string(value)}]`, "stable_attr");
  }
  if (evidence.stable_id) add_selector(selectors, seen, `#${css_escape(evidence.stable_id, view)}`, "stable_id");
  if (evidence.role) {
    if (element.hasAttribute("role")) {
      add_selector(selectors, seen, `${tag}[role=${css_string(evidence.role)}]`, "role_name");
      add_selector(selectors, seen, `[role=${css_string(evidence.role)}]`, "role_name");
    } else {
      add_selector(selectors, seen, tag, "role_name");
    }
  }
  for (const class_name of evidence.classes?.stable ?? []) {
    add_selector(selectors, seen, `${tag}.${css_escape(class_name, view)}`, "stable_class");
    add_selector(selectors, seen, `.${css_escape(class_name, view)}`, "stable_class");
  }
  if (evidence.text && evidence.text.normalized.length > 0) add_selector(selectors, seen, tag, "text");
  if (evidence.parent_chain.length > 0) {
    const parent = evidence.parent_chain[0];
    if (parent) {
      const stable_attr_index = parent.stable_attr?.indexOf("=") ?? -1;
      const parent_prefix = parent.stable_class
        ? `${parent.tag}.${css_escape(parent.stable_class, view)}`
        : stable_attr_index > 0 && parent.stable_attr
          ? `${parent.tag}[${parent.stable_attr.slice(0, stable_attr_index)}=${css_string(parent.stable_attr.slice(stable_attr_index + 1))}]`
          : parent.tag;
      add_selector(selectors, seen, `${parent_prefix} > ${tag}`, "parent_chain");
    }
  }
  if (evidence.shadow_path && evidence.shadow_path.length > 0) add_selector(selectors, seen, evidence.shadow_path.join(" >>> "), "shadow_path");
  add_selector(selectors, seen, evidence.nth_path, "nth_path");

  const unique = selectors.filter((candidate) => selector_matches(root, candidate.selector) === 1);
  const non_unique = selectors.filter((candidate) => selector_matches(root, candidate.selector) !== 1);
  return unique.concat(non_unique).slice(0, Math.max(1, max_alternates + 1));
}

export function capture_locator(element: Element, options: CaptureLocatorOptions = {}): Locator {
  const max_text_length = options.max_text_length ?? default_capture_options.max_text_length;
  const max_parent_depth = options.max_parent_depth ?? default_capture_options.max_parent_depth;
  const max_alternates = options.max_alternates ?? default_capture_options.max_alternates;
  const include_geometry = options.include_geometry ?? default_capture_options.include_geometry;
  const tag = element.localName.toLowerCase();
  const stable_attrs = get_stable_attrs(element);
  const normalized_full_text = normalize_locator_text(get_element_text(element));
  const normalized_text = normalized_full_text.length > max_text_length ? normalized_full_text.slice(0, max_text_length) : normalized_full_text;
  const role = get_role(element);
  const accessible_name = get_accessible_name(element, normalized_text);
  const stable_classes = filter_stable_classes(element.classList ? Array.from(element.classList) : []);

  const evidence: LocatorEvidence = {
    tag,
    nth_path: build_nth_path(element, false),
    parent_chain: capture_parent_chain(element, max_parent_depth),
  };
  if (Object.keys(stable_attrs).length > 0) evidence.stable_attrs = stable_attrs;
  if (is_stable_id(element.id)) evidence.stable_id = element.id;
  if (role) evidence.role = role;
  if (accessible_name) evidence.accessible_name = accessible_name;
  if (element.classList.length > 0) evidence.classes = { stable: stable_classes, total: element.classList.length };
  if (normalized_text) evidence.text = { normalized: normalized_text, hash: hash_locator_text(normalized_text), length: normalized_full_text.length };
  const shadow_path = capture_shadow_path(element);
  if (shadow_path) evidence.shadow_path = shadow_path;
  if (include_geometry) {
    const geometry = capture_geometry(element);
    if (geometry) evidence.geometry = geometry;
  }

  const selectors = build_selector_cascade(element, evidence, max_alternates);
  const locator: Locator = {
    primary: selectors[0] ?? { selector: evidence.nth_path, strategy: "nth_path" },
    alternates: selectors.slice(1),
    evidence,
  };
  const frame_path = capture_frame_path(element);
  if (frame_path) locator.frame_path = frame_path;
  return locator;
}


export type ResolveResult = {
  element?: Element | null;
  locator_status: LocatorStatus;
  confidence: number;
  matched_by: string[];
  candidates_considered: number;
  ambiguity?: {
    top_1: number;
    top_2: number;
    reason: "close_score" | "duplicate_evidence";
  };
};

type ResolveRoot = Document | ShadowRoot | Element;
type ResolveCollect = (strategy: string, source: Iterable<Element>) => void;

type ResolveScore = {
  element: Element;
  confidence: number;
  matched_by: string[];
  duplicate_key: string;
};

const resolve_strategy_cap = 100;
const resolve_total_cap = 500;
const resolve_ambiguity_delta = 0.1;

export function resolve(locator: Locator, root: ResolveRoot): ResolveResult {
  const frame_root = resolve_frame_path(locator.frame_path, root);
  if (!frame_root.ok) {
    const scoped_result = resolve_in_root(locator, root);
    if (scoped_result.locator_status !== "lost") {
      return {
        ...scoped_result,
        matched_by: concrete_matched_by(["frame_path:already_in_frame", ...scoped_result.matched_by]),
      };
    }
    return {
      element: null,
      locator_status: "lost",
      confidence: 0,
      matched_by: [frame_root.reason],
      candidates_considered: 0,
    };
  }
  return resolve_in_root(locator, frame_root.root);
}

function resolve_in_root(locator: Locator, root: ResolveRoot): ResolveResult {
  const candidates = new Map<Element, string[]>();
  const overflow_reasons: string[] = [];
  const collect: ResolveCollect = (strategy, source) => {
    let strategy_count = 0;
    for (const element of source) {
      if (strategy_count >= resolve_strategy_cap) {
        overflow_reasons.push(`${strategy}: capped at ${resolve_strategy_cap}`);
        return;
      }
      const existing = candidates.get(element);
      if (existing) {
        if (!existing.includes(strategy)) existing.push(strategy);
      } else if (candidates.size >= resolve_total_cap) {
        overflow_reasons.push(`total candidate cap ${resolve_total_cap} reached while collecting ${strategy}`);
        return;
      } else {
        candidates.set(element, [strategy]);
      }
      strategy_count += 1;
    }
  };

  const selectors = [locator.primary, ...locator.alternates];
  for (const selector of selectors) collect(`selector:${selector.strategy}`, query_elements(root, selector.selector));
  for (const selector of selectors) {
    if (selector.strategy === "shadow_path") collect_shadow_path(root, selector.selector.split(" >>> "), collect);
  }
  if (locator.evidence.shadow_path) collect_shadow_path(root, locator.evidence.shadow_path, collect);
  collect_by_stable_id(locator, root, collect);
  collect_by_stable_attrs(locator, root, collect);
  collect_by_role_name(locator, root, collect);
  collect_by_text(locator, root, collect);
  collect_by_stable_classes(locator, root, collect);
  collect_by_parent_chain(locator, root, collect);
  collect_by_nth_path(locator, root, collect);
  collect_by_geometry(locator, root, collect);

  const primary_hits = query_elements(root, locator.primary.selector);
  const overflow = overflow_reasons.length > 0;
  if (primary_hits.length === 1) {
    const primary = primary_hits[0];
    if (primary && tag_matches_locator(locator, primary)) {
      const scored_primary = score_resolve_candidate(locator, primary);
      if (has_primary_validation_evidence(locator, scored_primary.matched_by)) {
        const matched_by = append_overflow(scored_primary.matched_by, overflow_reasons);
        return {
          element: primary,
          locator_status: overflow ? "drifted" : "resolved",
          confidence: overflow ? Math.min(scored_primary.confidence, 0.59) : Math.max(scored_primary.confidence, 0.85),
          matched_by: concrete_matched_by(matched_by),
          candidates_considered: candidates.size,
        };
      }
    }
  }

  if (candidates.size === 0) {
    return {
      element: null,
      locator_status: "lost",
      confidence: 0,
      matched_by: overflow ? append_overflow([], overflow_reasons) : ["no_candidates"],
      candidates_considered: 0,
    };
  }

  const scored = Array.from(candidates.keys(), (element) => score_resolve_candidate(locator, element)).sort(
    (left, right) => right.confidence - left.confidence,
  );
  const best = scored[0];
  if (!best || best.confidence < 0.4) {
    return {
      element: null,
      locator_status: "lost",
      confidence: best?.confidence ?? 0,
      matched_by: best ? concrete_matched_by(append_overflow(best.matched_by, overflow_reasons)) : ["no_candidates"],
      candidates_considered: candidates.size,
    };
  }

  const second = scored[1];
  const ambiguity = resolve_ambiguity(scored, best, second);
  let locator_status: LocatorStatus = best.confidence >= 0.6 ? "resolved" : "drifted";
  let confidence = best.confidence;
  if (ambiguity && locator_status === "resolved") locator_status = "drifted";
  if (overflow) {
    locator_status = "drifted";
    confidence = Math.min(confidence, 0.59);
  }
  const result: ResolveResult = {
    element: best.element,
    locator_status,
    confidence,
    matched_by: concrete_matched_by(append_overflow(best.matched_by, overflow_reasons)),
    candidates_considered: candidates.size,
  };
  if (ambiguity) result.ambiguity = ambiguity;
  return result;
}

function query_elements(root: ResolveRoot | Element, selector: string): Element[] {
  if (!selector) return [];
  try {
    const descendants = Array.from(root.querySelectorAll(selector));
    if (root instanceof Element && root.matches(selector)) return [root, ...descendants];
    return descendants;
  } catch {
    return [];
  }
}

function collect_shadow_path(root: ResolveRoot, path: readonly string[], collect: ResolveCollect): void {
  const element = resolve_shadow_path(root, path);
  if (element) collect("shadow_path", [element]);
}

function resolve_shadow_path(root: ResolveRoot, path: readonly string[]): Element | null {
  let scope: ResolveRoot | null = root;
  let current: Element | null = null;
  for (const selector of path) {
    const hits: Element[] = scope ? query_elements(scope, selector) : [];
    if (hits.length !== 1) return null;
    current = hits[0] ?? null;
    scope = current?.shadowRoot ?? current;
  }
  return current;
}

function resolve_frame_path(frame_path: FrameLocatorPath | undefined, root: ResolveRoot): { ok: true; root: ResolveRoot } | { ok: false; reason: string } {
  if (!frame_path || frame_path.length === 0) return { ok: true, root };
  let scope: ResolveRoot = root;
  for (let depth = 0; depth < frame_path.length; depth += 1) {
    const item = frame_path[depth];
    if (!item) return { ok: false, reason: `frame_path:${depth}:missing_item` };
    const frame = resolve_frame_path_item(scope, item);
    if (!frame) return { ok: false, reason: `frame_path:${depth}:frame_not_found` };
    const document = get_frame_content_document(frame);
    if (!document) return { ok: false, reason: `frame_path:${depth}:content_document_unavailable` };
    scope = document;
  }
  return { ok: true, root: scope };
}

function resolve_frame_path_item(root: ResolveRoot, item: FrameLocatorPathItem): Element | null {
  const hits = query_elements(root, item.selector).filter(is_frame_element);
  if (item.name) {
    const named_hits = hits.filter((hit) => frame_name(hit) === item.name);
    if (named_hits.length === 1) return named_hits[0] ?? null;
  }
  if (hits.length === 1) return hits[0] ?? null;
  if (item.index !== undefined) {
    const frames = query_elements(root, "iframe, frame").filter(is_frame_element);
    const indexed = frames[item.index] ?? null;
    if (indexed && (hits.length === 0 || hits.includes(indexed))) return indexed;
  }
  return null;
}

function is_frame_element(element: Element): boolean {
  const tag = element.localName.toLowerCase();
  return tag === "iframe" || tag === "frame";
}

function get_frame_content_document(frame: Element): Document | null {
  try {
    const maybe_frame = frame as Element & { contentDocument?: Document | null };
    return maybe_frame.contentDocument ?? null;
  } catch {
    return null;
  }
}

function collect_by_stable_id(locator: Locator, root: ResolveRoot, collect: ResolveCollect): void {
  const stable_id = locator.evidence.stable_id;
  if (stable_id) collect("stable_id", query_elements(root, `#${css_escape(stable_id, root_view(root))}`));
}

function collect_by_stable_attrs(locator: Locator, root: ResolveRoot, collect: ResolveCollect): void {
  const attrs = locator.evidence.stable_attrs;
  if (!attrs) return;
  for (const [name, value] of Object.entries(attrs)) {
    if (is_safe_attribute_name(name)) collect(`stable_attr:${name}`, query_elements(root, `[${name}=${css_string(value)}]`));
  }
}

function collect_by_role_name(locator: Locator, root: ResolveRoot, collect: ResolveCollect): void {
  const role = locator.evidence.role;
  if (!role) return;
  const role_hits = query_elements(root, role_candidate_selector(locator.evidence.tag, role)).filter((element) => get_role(element) === role);
  if (locator.evidence.accessible_name) {
    collect("role_name", role_hits.filter((element) => get_accessible_name(element, normalize_locator_text(get_element_text(element))) === locator.evidence.accessible_name));
  } else {
    collect("role", role_hits);
  }
}

function role_candidate_selector(tag: string | undefined, role: string): string {
  const selectors = [`[role=${css_string(role)}]`];
  const seen = new Set(selectors);
  const add = (selector: string): void => {
    if (!seen.has(selector)) {
      seen.add(selector);
      selectors.push(selector);
    }
  };
  if (tag) add(tag);
  for (const [implicit_tag, implicit_role] of Object.entries(implicit_roles)) {
    if (implicit_role === role) add(implicit_tag);
  }
  if (role === "checkbox") add('input[type="checkbox"]');
  else if (role === "radio") add('input[type="radio"]');
  else if (role === "searchbox") add('input[type="search"]');
  else if (role === "slider") add('input[type="range"]');
  else if (role === "button") add('input[type="button"], input[type="submit"], input[type="reset"]');
  return selectors.join(", ");
}

function collect_by_text(locator: Locator, root: ResolveRoot, collect: ResolveCollect): void {
  const text = locator.evidence.text;
  if (!text?.normalized) return;
  collect("text", query_elements(root, locator.evidence.tag || "*").filter((element) => {
    const normalized = normalize_locator_text(get_element_text(element));
    return normalized === text.normalized || hash_locator_text(normalized) === text.hash || text_similarity(normalized, text.normalized) >= 0.75;
  }));
}

function collect_by_stable_classes(locator: Locator, root: ResolveRoot, collect: ResolveCollect): void {
  const stable = locator.evidence.classes?.stable;
  if (!stable?.length) return;
  collect("stable_class", query_elements(root, stable.map((class_name) => `.${css_escape(class_name, root_view(root))}`).join("")));
}

function collect_by_parent_chain(locator: Locator, root: ResolveRoot, collect: ResolveCollect): void {
  for (const parent of locator.evidence.parent_chain) {
    const selector = parent_chain_selector(parent, root_view(root));
    if (selector) {
      for (const anchor of query_elements(root, selector)) collect("parent_chain", query_elements(anchor, locator.evidence.tag || "*"));
    }
  }
}

function collect_by_nth_path(locator: Locator, root: ResolveRoot, collect: ResolveCollect): void {
  const element = resolve_nth_selector(root, locator.evidence.nth_path);
  if (element) collect("nth_path", [element]);
}

function collect_by_geometry(locator: Locator, root: ResolveRoot, collect: ResolveCollect): void {
  const geometry = locator.evidence.geometry;
  if (!geometry) return;
  const document = root_document(root);
  const x = geometry.x + geometry.width / 2;
  const y = geometry.y + geometry.height / 2;
  const point_hit = typeof document?.elementFromPoint === "function" ? document.elementFromPoint(x, y) : null;
  if (point_hit) collect("geometry", [point_hit]);
  collect("geometry_neighborhood", query_elements(root, locator.evidence.tag || "*").filter((element) => geometry_score(element, geometry) >= 0.5));
}

function score_resolve_candidate(locator: Locator, element: Element): ResolveScore {
  let available_weight = 0;
  let matched_weight = 0;
  const matched_by: string[] = [];
  const evidence = locator.evidence;

  if (evidence.stable_attrs && Object.keys(evidence.stable_attrs).length > 0) {
    available_weight += 0.35;
    const entries = Object.entries(evidence.stable_attrs);
    let hits = 0;
    for (const [name, value] of entries) if (element.getAttribute(name) === value) hits += 1;
    if (hits > 0) {
      matched_weight += 0.35 * (hits / entries.length);
      matched_by.push(hits === entries.length ? "stable_attrs:all" : `stable_attrs:${hits}/${entries.length}`);
    }
  }
  if (evidence.stable_id) {
    available_weight += 0.25;
    if (element.id === evidence.stable_id) {
      matched_weight += 0.25;
      matched_by.push("stable_id");
    }
  }
  if (evidence.role || evidence.accessible_name) {
    available_weight += 0.2;
    const normalized = normalize_locator_text(get_element_text(element));
    const role_match = evidence.role !== undefined && get_role(element) === evidence.role;
    const name_match = evidence.accessible_name !== undefined && get_accessible_name(element, normalized) === evidence.accessible_name;
    if ((evidence.role === undefined || role_match) && (evidence.accessible_name === undefined || name_match)) {
      matched_weight += 0.2;
      matched_by.push(evidence.role !== undefined && evidence.accessible_name !== undefined ? "role_accessible_name" : role_match ? "role" : "accessible_name");
    } else if (role_match || name_match) {
      matched_weight += 0.1;
      matched_by.push(role_match ? "role" : "accessible_name");
    }
  }
  if (evidence.text?.normalized) {
    const normalized = normalize_locator_text(get_element_text(element));
    if (normalized === evidence.text.normalized) {
      available_weight += 0.2;
      matched_weight += 0.2;
      matched_by.push("text_exact");
    } else if (hash_locator_text(normalized) === evidence.text.hash) {
      available_weight += 0.15;
      matched_weight += 0.15;
      matched_by.push("text_hash");
    } else {
      available_weight += 0.08;
      const similarity = text_similarity(normalized, evidence.text.normalized);
      if (similarity >= 0.75) {
        matched_weight += 0.08 * similarity;
        matched_by.push("text_fuzzy");
      }
    }
  }
  if (evidence.classes?.stable.length) {
    available_weight += 0.15;
    const jaccard = class_jaccard(element, evidence.classes.stable);
    if (jaccard > 0) {
      matched_weight += 0.15 * jaccard;
      matched_by.push(`stable_class:${jaccard.toFixed(2)}`);
    }
  }
  if (evidence.parent_chain.length > 0) {
    available_weight += 0.15;
    const score = parent_chain_score(element, evidence.parent_chain);
    if (score > 0) {
      matched_weight += 0.15 * score;
      matched_by.push(`parent_chain:${score.toFixed(2)}`);
    }
  }
  if (evidence.tag) {
    available_weight += 0.05;
    if (tag_matches_locator(locator, element)) {
      matched_weight += 0.05;
      matched_by.push("tag");
    }
  }
  if (evidence.geometry) {
    available_weight += 0.1;
    const score = geometry_score(element, evidence.geometry);
    if (score > 0) {
      matched_weight += 0.1 * score;
      matched_by.push(`geometry:${score.toFixed(2)}`);
    }
  }
  if (evidence.nth_path) {
    available_weight += 0.05;
    if (resolve_nth_selector(element_root_for_resolve(element), evidence.nth_path) === element) {
      matched_weight += 0.05;
      matched_by.push("nth_path");
    }
  }

  return {
    element,
    confidence: available_weight === 0 ? 0 : clamp_unit(matched_weight / available_weight),
    matched_by,
    duplicate_key: duplicate_evidence_key(locator, element, matched_by),
  };
}

function resolve_ambiguity(scored: readonly ResolveScore[], best: ResolveScore, second: ResolveScore | undefined): ResolveResult["ambiguity"] | undefined {
  if (second && second.confidence >= 0.6 && best.confidence - second.confidence < resolve_ambiguity_delta) {
    return { top_1: best.confidence, top_2: second.confidence, reason: "close_score" };
  }
  if (best.confidence >= 0.6 && best.duplicate_key) {
    for (let index = 1; index < scored.length; index += 1) {
      const other = scored[index];
      if (other && other.confidence >= 0.6 && other.duplicate_key === best.duplicate_key) {
        return { top_1: best.confidence, top_2: other.confidence, reason: "duplicate_evidence" };
      }
    }
  }
  return undefined;
}

function has_primary_validation_evidence(locator: Locator, matched_by: readonly string[]): boolean {
  const evidence = locator.evidence;
  const has_evidence = Boolean(
    evidence.text?.normalized || evidence.role || evidence.accessible_name || evidence.stable_id || (evidence.stable_attrs && Object.keys(evidence.stable_attrs).length > 0),
  );
  return has_evidence && matched_by.some((label) => label.startsWith("text_") || label === "role" || label === "accessible_name" || label === "role_accessible_name" || label.startsWith("stable_attrs") || label === "stable_id");
}

function append_overflow(matched_by: readonly string[], overflow_reasons: readonly string[]): string[] {
  return overflow_reasons.length === 0 ? [...matched_by] : [...matched_by, ...overflow_reasons.map((reason) => `overflow:${reason}`)];
}

function concrete_matched_by(matched_by: string[]): string[] {
  return matched_by.length === 0 || (matched_by.length === 1 && matched_by[0] === "score") ? ["no_evidence_match"] : matched_by;
}

function tag_matches_locator(locator: Locator, element: Element): boolean {
  return element.localName.toLowerCase() === locator.evidence.tag.toLowerCase();
}

function root_view(root: ResolveRoot): Window | null {
  if (is_element_node(root)) return get_view(root);
  if (is_document_node(root)) return root.defaultView;
  return root.ownerDocument.defaultView;
}

function root_document(root: ResolveRoot): Document | null {
  if (is_element_node(root)) return get_owner_document(root);
  if (is_document_node(root)) return root;
  return root.ownerDocument;
}

function is_safe_attribute_name(name: string): boolean {
  return /^[A-Za-z_][A-Za-z0-9_.:-]*$/.test(name);
}

function parent_chain_selector(parent: LocatorParentEvidence, view: Window | null): string {
  const parts = [parent.tag || "*"];
  if (parent.role) parts.push(`[role=${css_string(parent.role)}]`);
  if (parent.stable_attr) {
    const separator = parent.stable_attr.indexOf("=");
    if (separator > 0) {
      const name = parent.stable_attr.slice(0, separator);
      if (is_safe_attribute_name(name)) parts.push(`[${name}=${css_string(parent.stable_attr.slice(separator + 1))}]`);
    } else if (is_safe_attribute_name(parent.stable_attr)) {
      parts.push(`[${parent.stable_attr}]`);
    }
  }
  if (parent.stable_class) parts.push(`.${css_escape(parent.stable_class, view)}`);
  return parts.join("");
}

function parent_chain_score(element: Element, chain: readonly LocatorParentEvidence[]): number {
  let ancestor = get_parent_element(element);
  let total = 0;
  for (const expected of chain) {
    while (ancestor && ancestor.localName.toLowerCase() !== expected.tag.toLowerCase()) ancestor = get_parent_element(ancestor);
    if (!ancestor) break;
    let available = 1;
    let matched = 1;
    if (expected.role) {
      available += 1;
      if (get_role(ancestor) === expected.role) matched += 1;
    }
    if (expected.stable_attr) {
      available += 1;
      if (stable_attr_evidence_matches(ancestor, expected.stable_attr)) matched += 1;
    }
    if (expected.stable_class) {
      available += 1;
      if (ancestor.classList.contains(expected.stable_class)) matched += 1;
    }
    total += matched / available;
    ancestor = get_parent_element(ancestor);
  }
  return chain.length === 0 ? 0 : total / chain.length;
}

function stable_attr_evidence_matches(element: Element, stable_attr: string): boolean {
  const separator = stable_attr.indexOf("=");
  if (separator < 1) return element.hasAttribute(stable_attr);
  return element.getAttribute(stable_attr.slice(0, separator)) === stable_attr.slice(separator + 1);
}

function class_jaccard(element: Element, stable: readonly string[]): number {
  const expected = new Set(stable);
  let intersection = 0;
  for (const class_name of Array.from(element.classList)) if (expected.has(class_name)) intersection += 1;
  const union = new Set([...stable, ...Array.from(element.classList)]).size;
  return union === 0 ? 0 : intersection / union;
}

function geometry_score(element: Element, expected: LocatorGeometry): number {
  const rect = element.getBoundingClientRect();
  const actual_x = rect.x + rect.width / 2;
  const actual_y = rect.y + rect.height / 2;
  const expected_x = expected.x + expected.width / 2;
  const expected_y = expected.y + expected.height / 2;
  const max_distance = Math.max(expected.viewport_width, expected.viewport_height, 1) * 0.25;
  const center = clamp_unit(1 - Math.hypot(actual_x - expected_x, actual_y - expected_y) / max_distance);
  return center * 0.6 + ratio_score(rect.width, expected.width) * 0.2 + ratio_score(rect.height, expected.height) * 0.2;
}

function ratio_score(actual: number, expected: number): number {
  const largest = Math.max(Math.abs(actual), Math.abs(expected));
  return largest === 0 ? 1 : clamp_unit(1 - Math.abs(actual - expected) / largest);
}

function text_similarity(actual: string, expected: string): number {
  if (!actual || !expected) return 0;
  if (actual.includes(expected) || expected.includes(actual)) return Math.min(actual.length, expected.length) / Math.max(actual.length, expected.length);
  const actual_words = new Set(actual.toLowerCase().split(" ").filter(Boolean));
  const expected_words = new Set(expected.toLowerCase().split(" ").filter(Boolean));
  let intersection = 0;
  for (const word of actual_words) if (expected_words.has(word)) intersection += 1;
  const union = new Set([...Array.from(actual_words), ...Array.from(expected_words)]).size;
  return union === 0 ? 0 : intersection / union;
}

function resolve_nth_selector(root: ResolveRoot, selector: string): Element | null {
  const matches = query_elements(root, selector);
  return matches.length === 1 ? (matches[0] ?? null) : null;
}

function element_root_for_resolve(element: Element): ResolveRoot {
  const root = element.getRootNode();
  if (is_document_node(root) || is_shadow_root_node(root)) return root;
  return get_owner_document(element);
}

function is_element_node(value: unknown): value is Element {
  return typeof Element !== "undefined" ? value instanceof Element : is_record(value) && value.nodeType === 1;
}

function is_document_node(value: unknown): value is Document {
  return typeof Document !== "undefined" ? value instanceof Document : is_record(value) && value.nodeType === 9;
}

function is_shadow_root_node(value: unknown): value is ShadowRoot {
  return typeof ShadowRoot !== "undefined" ? value instanceof ShadowRoot : is_record(value) && value.nodeType === 11;
}

function duplicate_evidence_key(locator: Locator, element: Element, matched_by: readonly string[]): string {
  const parts: string[] = [];
  if (matched_by.includes("stable_id")) parts.push(`id=${element.id}`);
  const attrs = locator.evidence.stable_attrs;
  if (attrs) {
    for (const name of Object.keys(attrs).sort()) {
      const value = element.getAttribute(name);
      if (value !== null) parts.push(`${name}=${value}`);
    }
  }
  if (matched_by.some((label) => label === "role" || label === "role_accessible_name")) parts.push(`role=${get_role(element) ?? ""}`);
  if (matched_by.some((label) => label === "accessible_name" || label === "role_accessible_name")) {
    const accessible_name = get_accessible_name(element, normalize_locator_text(get_element_text(element)));
    if (accessible_name) parts.push(`name=${accessible_name}`);
  }
  if (matched_by.some((label) => label.startsWith("text_"))) parts.push(`text=${hash_locator_text(normalize_locator_text(get_element_text(element)))}`);
  return parts.join("|");
}

function clamp_unit(value: number): number {
  if (value <= 0) return 0;
  if (value >= 1) return 1;
  return value;
}

export type IntentKind = "bug" | "copy" | "style" | "layout" | "question" | "other";

export type FrameworkName = "react" | "vue" | "svelte" | "angular" | "solid" | "unknown";

export type AnnotationPosition = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type Annotation = {
  schema_version: typeof LOUPE_SCHEMA_VERSION;
  id: string;
  project: ProjectScopeWithUrl;
  target: {
    locator: Locator;
    boundary?: TargetBoundary;
    resolution: {
      locator_status: LocatorStatus;
      confidence: number;
      matched_by: string[];
      resolved_at: string;
    };
  };
  intent: {
    comment: string;
    kind: IntentKind;
  };
  context: {
    element: {
      tag: string;
      id?: string;
      role?: string;
      accessible_name?: string;
      classes?: string[];
      text?: string;
      selector_preview: string;
    };
    a11y?: {
      role?: string;
      label?: string;
      described_by?: string;
      tab_index?: number;
      expanded?: boolean;
    };
    layout?: {
      display?: string;
      position?: string;
      box_sizing?: string;
      flex_direction?: string;
      gap?: string;
    };
    framework?: {
      name: FrameworkName;
      component?: string;
      source_hint?: {
        file?: string;
        line?: number;
        confidence: number;
      };
    };
    viewport: {
      width: number;
      height: number;
      dpr: number;
    };
    position: AnnotationPosition;
  };
  sync: {
    status: "local_only" | "syncing" | "synced" | "failed" | "delete_pending";
    last_synced_at?: string;
    last_error?: string;
    retry_count: number;
  };
  media: {
    has_screenshot: boolean;
    screenshot_id?: string;
  };
  replies: {
    items: Array<{
      author: "user" | "agent";
      text: string;
      at: string;
    }>;
  };
  lifecycle: {
    task_status: "open" | "resolved" | "archived";
    created_at: string;
    updated_at: string;
    task_resolved_at?: string;
    deleted_at?: string;
  };
};


export type StorageEnvelope = {
  schema_version: typeof LOUPE_SCHEMA_VERSION;
  projects: Record<
    string,
    {
      sessions: Record<
        string,
        {
          marks: Annotation[];
        }
      >;
      tombstones: string[];
    }
  >;
};

export type AgentMark = {
  id: string;
  project: {
    project_id: string;
    workspace_root_hash: string;
    branch?: string;
    url: string;
    route_key: string;
    session_id: string;
  };
  intent: {
    comment: string;
    kind: IntentKind | string;
  };
  target: {
    frame_path?: FrameLocatorPath;
    shadow_path?: string[];
    boundary?: TargetBoundary;
    selector: string;
    selector_preview: string;
    tag: string;
    text?: string;
    classes?: string[];
    path?: string;
    locator_status: LocatorStatus;
    confidence: number;
    matched_by: string[];
  };
  framework?: {
    name: FrameworkName | string;
    component?: string;
    source_hint?: string;
  };
  media: {
    has_screenshot: boolean;
  };
  lifecycle: {
    task_status: "open" | "resolved" | "archived";
    created_at: string;
    updated_at: string;
  };
};

export type ListMarksRequest = ProjectScopeInput & {
  task_status?: "open" | "resolved" | "archived";
};

export type ListMarksResponse = {
  project: ProjectScopeCandidate;
  marks: AgentMark[];
};

export type GetMarkRequest = {
  id: string;
} & ProjectScopeInput;

export type ResolveMarkRequest = {
  id: string;
  resolution_note?: string;
} & ProjectScopeInput;

export type ResolveMarkResponse = {
  ok: true;
  task_status: "resolved";
};

export type DeleteMarkRequest = {
  id: string;
  reason?: string;
} & ProjectScopeInput;

export type DeleteMarkResponse = {
  ok: true;
  deleted_at: string;
};

export type HealthPayload = {
  ok: true;
  name: typeof LOUPE_DAEMON_NAME;
  version: string;
  port: number;
  requires_auth: true;
};

export type ServerStatusFile = {
  pid: number;
  port: number;
  token_path: string;
  started_at: string;
};

const known_camel_case_fields = new Set([
  "schemaVersion",
  "projectId",
  "workspaceRootHash",
  "routeKey",
  "sessionId",
  "framePath",
  "shadowPath",
  "targetScope",
  "stableAttrs",
  "stableId",
  "accessibleName",
  "accesssibleName",
  "nthPath",
  "parentChain",
  "internalTargetSupported",
  "shellSelector",
  "locatorStatus",
  "matchedBy",
  "candidatesConsidered",
  "top1",
  "top2",
  "selectorPreview",
  "hasScreenshot",
  "createdAt",
  "updatedAt",
  "resolvedAt",
  "deletedAt",
]) as ReadonlySet<string>;

const boundary_kinds: ReadonlySet<string> = new Set([
  "cross_origin_iframe",
  "canvas_internal_target",
  "closed_shadow_root",
  "svg_internal_target",
]);

const locator_statuses: ReadonlySet<string> = new Set(["resolved", "drifted", "lost"]);
const selector_strategies: ReadonlySet<string> = new Set([
  "shadow_path",
  "stable_attr",
  "stable_id",
  "role_name",
  "stable_class",
  "text",
  "parent_chain",
  "nth_path",
  "geometry",
]);
const target_scopes: ReadonlySet<string> = new Set(["internal_element", "boundary_shell"]);

function is_record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function is_string_array(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function is_number(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function has_no_known_camel_case_fields(value: unknown): boolean {
  if (Array.isArray(value)) return value.every(has_no_known_camel_case_fields);
  if (!is_record(value)) return true;

  for (const [key, child] of Object.entries(value)) {
    if (known_camel_case_fields.has(key) || !has_no_known_camel_case_fields(child)) return false;
  }
  return true;
}

function has_optional_string(record: Record<string, unknown>, key: string): boolean {
  return record[key] === undefined || typeof record[key] === "string";
}

function is_string_record(value: unknown): value is Record<string, string> {
  return is_record(value) && Object.values(value).every((item) => typeof item === "string");
}

function is_locator_classes(value: unknown): value is LocatorClassEvidence {
  return is_record(value) && has_no_known_camel_case_fields(value) && is_string_array(value.stable) && is_number(value.total);
}

function is_locator_text(value: unknown): value is LocatorTextEvidence {
  return (
    is_record(value) &&
    has_no_known_camel_case_fields(value) &&
    typeof value.normalized === "string" &&
    typeof value.hash === "string" &&
    is_number(value.length)
  );
}

function is_locator_parent(value: unknown): value is LocatorParentEvidence {
  return (
    is_record(value) &&
    has_no_known_camel_case_fields(value) &&
    typeof value.tag === "string" &&
    has_optional_string(value, "role") &&
    has_optional_string(value, "stable_attr") &&
    has_optional_string(value, "stable_class")
  );
}

function is_annotation_position(value: unknown): value is AnnotationPosition {
  if (!is_record(value) || !has_no_known_camel_case_fields(value)) return false;
  const keys = Object.keys(value);
  return (
    keys.length === 4 &&
    is_number(value.x) &&
    is_number(value.y) &&
    is_number(value.width) &&
    is_number(value.height)
  );
}

function is_frame_path(value: unknown): value is FrameLocatorPath {
  return (
    Array.isArray(value) &&
    value.every(
      (item) =>
        is_record(item) &&
        has_no_known_camel_case_fields(item) &&
        typeof item.selector === "string" &&
        (item.index === undefined || is_number(item.index)) &&
        has_optional_string(item, "name"),
    )
  );
}

function is_boundary(value: unknown): value is TargetBoundary {
  return (
    is_record(value) &&
    has_no_known_camel_case_fields(value) &&
    typeof value.kind === "string" &&
    boundary_kinds.has(value.kind) &&
    typeof value.target_scope === "string" &&
    target_scopes.has(value.target_scope) &&
    typeof value.internal_target_supported === "boolean" &&
    has_optional_string(value, "shell_selector") &&
    typeof value.reason === "string"
  );
}

function is_locator_selector(value: unknown): value is LocatorSelector {
  return (
    is_record(value) &&
    has_no_known_camel_case_fields(value) &&
    typeof value.selector === "string" &&
    typeof value.strategy === "string" &&
    selector_strategies.has(value.strategy)
  );
}

function is_locator_geometry(value: unknown): value is LocatorGeometry {
  return (
    is_record(value) &&
    has_no_known_camel_case_fields(value) &&
    is_number(value.x) &&
    is_number(value.y) &&
    is_number(value.width) &&
    is_number(value.height) &&
    is_number(value.viewport_width) &&
    is_number(value.viewport_height) &&
    is_number(value.dpr)
  );
}

function is_locator_evidence(value: unknown): value is LocatorEvidence {
  return (
    is_record(value) &&
    has_no_known_camel_case_fields(value) &&
    typeof value.tag === "string" &&
    typeof value.nth_path === "string" &&
    (value.stable_attrs === undefined || is_string_record(value.stable_attrs)) &&
    has_optional_string(value, "stable_id") &&
    has_optional_string(value, "role") &&
    has_optional_string(value, "accessible_name") &&
    (value.classes === undefined || is_locator_classes(value.classes)) &&
    (value.text === undefined || is_locator_text(value.text)) &&
    Array.isArray(value.parent_chain) &&
    value.parent_chain.every(is_locator_parent) &&
    (value.shadow_path === undefined || is_string_array(value.shadow_path)) &&
    (value.geometry === undefined || is_locator_geometry(value.geometry)) &&
    (value.boundary === undefined || is_boundary(value.boundary))
  );
}

export function is_locator(value: unknown): value is Locator {
  return (
    is_record(value) &&
    value.schema_version === undefined &&
    has_no_known_camel_case_fields(value) &&
    (value.frame_path === undefined || is_frame_path(value.frame_path)) &&
    is_locator_selector(value.primary) &&
    Array.isArray(value.alternates) &&
    value.alternates.every(is_locator_selector) &&
    is_locator_evidence(value.evidence)
  );
}

export function is_resolve_result(value: unknown): value is ResolveResult {
  if (!is_record(value) || value.schema_version !== undefined || !has_no_known_camel_case_fields(value)) return false;
  if (typeof value.locator_status !== "string" || !locator_statuses.has(value.locator_status)) return false;
  if (!is_number(value.confidence) || !is_string_array(value.matched_by) || !is_number(value.candidates_considered)) {
    return false;
  }
  if (value.element !== undefined && value.element !== null && !is_element_node(value.element)) return false;
  if (value.ambiguity === undefined) return true;
  return (
    is_record(value.ambiguity) &&
    has_no_known_camel_case_fields(value.ambiguity) &&
    is_number(value.ambiguity.top_1) &&
    is_number(value.ambiguity.top_2) &&
    (value.ambiguity.reason === "close_score" || value.ambiguity.reason === "duplicate_evidence")
  );
}

export function is_annotation(value: unknown): value is Annotation {
  if (!is_record(value) || !has_no_known_camel_case_fields(value) || value.schema_version !== LOUPE_SCHEMA_VERSION) return false;
  const project = value.project;
  const target = value.target;
  const intent = value.intent;
  const context = value.context;
  const sync = value.sync;
  const media = value.media;
  const replies = value.replies;
  const lifecycle = value.lifecycle;
  return (
    typeof value.id === "string" &&
    is_record(project) &&
    typeof project.project_id === "string" &&
    typeof project.workspace_root_hash === "string" &&
    typeof project.origin === "string" &&
    typeof project.url === "string" &&
    typeof project.route_key === "string" &&
    typeof project.session_id === "string" &&
    is_record(target) &&
    is_locator(target.locator) &&
    (target.boundary === undefined || is_boundary(target.boundary)) &&
    is_record(target.resolution) &&
    typeof target.resolution.locator_status === "string" &&
    locator_statuses.has(target.resolution.locator_status) &&
    is_number(target.resolution.confidence) &&
    is_string_array(target.resolution.matched_by) &&
    typeof target.resolution.resolved_at === "string" &&
    is_record(intent) &&
    typeof intent.comment === "string" &&
    typeof intent.kind === "string" &&
    is_record(context) &&
    is_record(context.element) &&
    typeof context.element.tag === "string" &&
    typeof context.element.selector_preview === "string" &&
    is_record(context.viewport) &&
    is_number(context.viewport.width) &&
    is_number(context.viewport.height) &&
    is_number(context.viewport.dpr) &&
    is_annotation_position(context.position) &&
    is_record(sync) &&
    typeof sync.status === "string" &&
    is_number(sync.retry_count) &&
    is_record(media) &&
    typeof media.has_screenshot === "boolean" &&
    is_record(replies) &&
    Array.isArray(replies.items) &&
    is_record(lifecycle) &&
    typeof lifecycle.task_status === "string" &&
    typeof lifecycle.created_at === "string" &&
    typeof lifecycle.updated_at === "string" &&
    has_optional_string(lifecycle, "task_resolved_at") &&
    has_optional_string(lifecycle, "deleted_at")
  );
}

export function assert_annotation(value: unknown): asserts value is Annotation {
  if (!is_annotation(value)) throw new TypeError("Expected Annotation wire contract");
}

export function is_storage_envelope(value: unknown): value is StorageEnvelope {
  if (!is_record(value) || !has_no_known_camel_case_fields(value) || value.schema_version !== LOUPE_SCHEMA_VERSION) return false;
  if (!is_record(value.projects)) return false;
  return Object.values(value.projects).every(
    (project) =>
      is_record(project) &&
      is_record(project.sessions) &&
      Object.values(project.sessions).every(
        (session) => is_record(session) && Array.isArray(session.marks) && session.marks.every(is_annotation),
      ) &&
      is_string_array(project.tombstones),
  );
}

export function assert_storage_envelope(value: unknown): asserts value is StorageEnvelope {
  if (!is_storage_envelope(value)) throw new TypeError("Expected StorageEnvelope wire contract");
}

export function is_agent_mark(value: unknown): value is AgentMark {
  if (!is_record(value) || value.schema_version !== undefined || !has_no_known_camel_case_fields(value)) return false;
  const project = value.project;
  const intent = value.intent;
  const target = value.target;
  const media = value.media;
  const lifecycle = value.lifecycle;
  return (
    typeof value.id === "string" &&
    is_record(project) &&
    typeof project.project_id === "string" &&
    typeof project.workspace_root_hash === "string" &&
    typeof project.url === "string" &&
    typeof project.route_key === "string" &&
    typeof project.session_id === "string" &&
    is_record(intent) &&
    typeof intent.comment === "string" &&
    typeof intent.kind === "string" &&
    is_record(target) &&
    (target.frame_path === undefined || is_frame_path(target.frame_path)) &&
    (target.shadow_path === undefined || is_string_array(target.shadow_path)) &&
    (target.boundary === undefined || is_boundary(target.boundary)) &&
    typeof target.selector === "string" &&
    typeof target.selector_preview === "string" &&
    typeof target.tag === "string" &&
    typeof target.locator_status === "string" &&
    locator_statuses.has(target.locator_status) &&
    is_number(target.confidence) &&
    is_string_array(target.matched_by) &&
    is_record(media) &&
    typeof media.has_screenshot === "boolean" &&
    is_record(lifecycle) &&
    typeof lifecycle.task_status === "string" &&
    typeof lifecycle.created_at === "string" &&
    typeof lifecycle.updated_at === "string"
  );
}
