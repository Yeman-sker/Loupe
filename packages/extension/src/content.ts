export const LOUPE_EXTENSION_ROOT_ID = "loupe-extension-root";

export type ExtensionPageExposure = Readonly<{
  exposes_token_to_page: false;
  exposes_page_window_api: false;
  bridge_nonce_readonly: true;
}>;

export const LOUPE_EXTENSION_PAGE_EXPOSURE: ExtensionPageExposure = Object.freeze({
  exposes_token_to_page: false,
  exposes_page_window_api: false,
  bridge_nonce_readonly: true,
});

type ElementLike = {
  readonly nodeType?: number;
  readonly id?: string;
  readonly localName?: string;
  readonly dataset?: Record<string, string | undefined>;
  getRootNode?: () => unknown;
};

type ShadowRootLike = {
  readonly host?: unknown;
};

type DocumentLike = {
  getElementById(id: string): unknown;
  createElement(tag: string): Omit<ElementLike, "id"> & {
    id?: string;
    hidden?: boolean;
    textContent?: string;
    style?: Record<string, string>;
    dataset: Record<string, string | undefined>;
    attachShadow?: (init: { mode: "closed" }) => { append: (node: unknown) => void };
    append?: (node: unknown) => void;
  };
  readonly documentElement?: { append: (node: unknown) => void };
  append?: (node: unknown) => void;
};

export function page_bridge_exposure(): ExtensionPageExposure {
  return LOUPE_EXTENSION_PAGE_EXPOSURE;
}

export function is_extension_host_eligible(origin: string): boolean {
  try {
    const url = new URL(origin);
    return (url.protocol === "http:" || url.protocol === "https:") && url.origin === origin;
  } catch {
    return false;
  }
}

export function origin_permission_pattern(origin: string): string | undefined {
  if (!is_extension_host_eligible(origin)) return undefined;
  const url = new URL(origin);
  return `${url.protocol}//${url.host}/*`;
}

export function is_loupe_extension_element(value: unknown): boolean {
  if (!is_element_like(value)) return false;
  return value.id === LOUPE_EXTENSION_ROOT_ID || value.dataset?.loupeRoot === "true" || value.dataset?.loupePhase === "phase_0_placeholder";
}

export function is_picker_candidate(value: unknown): boolean {
  if (!is_element_like(value)) return false;
  if (is_loupe_extension_element(value)) return false;
  const root = typeof value.getRootNode === "function" ? (value.getRootNode() as ShadowRootLike | undefined) : undefined;
  return !is_loupe_extension_element(root?.host);
}

export function install_content_root(document_like: DocumentLike | undefined = global_document()): boolean {
  if (document_like === undefined || document_like.getElementById(LOUPE_EXTENSION_ROOT_ID) !== null) return false;

  const root = document_like.createElement("div");
  root.id = LOUPE_EXTENSION_ROOT_ID;
  root.hidden = true;
  root.dataset.loupeRoot = "true";
  root.dataset.exposesTokenToPage = "false";
  root.dataset.exposesPageWindowApi = "false";
  if (root.style !== undefined) root.style.pointerEvents = "none";

  const shadow = root.attachShadow?.({ mode: "closed" });
  if (shadow !== undefined) {
    const marker = document_like.createElement("span");
    marker.textContent = "Loupe extension root";
    shadow.append(marker);
  }

  (document_like.documentElement ?? document_like).append?.(root);
  return true;
}

function is_element_like(value: unknown): value is ElementLike {
  return typeof value === "object" && value !== null && (value as ElementLike).nodeType === 1;
}

function global_document(): DocumentLike | undefined {
  return typeof document === "undefined" ? undefined : (document as unknown as DocumentLike);
}

install_content_root();
