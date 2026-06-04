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

export type ContentHostAuthorizationState = Readonly<{
  authorized: boolean;
}>;

export type OriginAuthorizationResponse = Readonly<{
  ok?: boolean;
  authorized?: boolean;
}>;

type ChromeRuntimeLike = {
  readonly lastError?: { readonly message?: string };
  sendMessage(message: unknown, response_callback: (response: unknown) => void): unknown;
};

export type ContentBootstrapEnvironment = Readonly<{
  readonly chrome?: { readonly runtime?: ChromeRuntimeLike };
  readonly document?: DocumentLike;
  readonly location?: { readonly origin?: string };
}>;

type DocumentLike = {
  getElementById(id: string): unknown;
  createElement(tag: string): {
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


export function can_inject_content_root(authorization_state?: ContentHostAuthorizationState): boolean {
  return authorization_state?.authorized === true;
}

export async function bootstrap_content_root(environment: ContentBootstrapEnvironment = global_content_environment()): Promise<boolean> {
  const document_like = environment.document;
  const origin = environment.location?.origin;
  const runtime = environment.chrome?.runtime;
  if (document_like === undefined || origin === undefined || runtime === undefined || typeof runtime.sendMessage !== "function") return false;

  const response = await get_origin_authorization(runtime, origin);
  if (!is_authorized_origin_response(response)) return false;

  return install_content_root(document_like, { authorized: true });
}

export function install_content_root(document_like: DocumentLike | undefined = global_document(), authorization_state?: ContentHostAuthorizationState): boolean {
  if (!can_inject_content_root(authorization_state)) return false;
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


function global_document(): DocumentLike | undefined {
  return typeof document === "undefined" ? undefined : (document as unknown as DocumentLike);
}

function global_content_environment(): ContentBootstrapEnvironment {
  const global_value = globalThis as typeof globalThis & { readonly chrome?: { readonly runtime?: ChromeRuntimeLike } };
  const environment: { chrome?: { readonly runtime?: ChromeRuntimeLike }; document?: DocumentLike; location?: { readonly origin?: string } } = {};
  if (global_value.chrome !== undefined) environment.chrome = global_value.chrome;
  const document_like = global_document();
  if (document_like !== undefined) environment.document = document_like;
  if (typeof location !== "undefined") environment.location = location;
  return environment;
}

async function get_origin_authorization(runtime: ChromeRuntimeLike, origin: string): Promise<unknown> {
  try {
    return await new Promise<unknown>((resolve) => {
      const maybe_promise = runtime.sendMessage({ type: "loupe.origin_auth.get", origin }, (response: unknown) => {
        if (runtime.lastError !== undefined) {
          resolve(undefined);
          return;
        }
        resolve(response);
      });

      if (is_promise_like(maybe_promise)) void maybe_promise.then(resolve, () => resolve(undefined));
    });
  } catch {
    return undefined;
  }
}

function is_authorized_origin_response(value: unknown): value is OriginAuthorizationResponse {
  return typeof value === "object" && value !== null && (value as OriginAuthorizationResponse).ok === true && (value as OriginAuthorizationResponse).authorized === true;
}

function is_promise_like(value: unknown): value is PromiseLike<unknown> {
  return typeof value === "object" && value !== null && typeof (value as { then?: unknown }).then === "function";
}

void bootstrap_content_root();
