declare const chrome: unknown;

import { origin_permission_pattern, page_bridge_exposure } from "./content.js";

export const MESSAGE_TYPES = Object.freeze({
  GET_ORIGIN_AUTH: "loupe.origin_auth.get",
  REQUEST_ORIGIN_AUTH: "loupe.origin_auth.request",
  SERVICE_WORKER_WAKE: "loupe.service_worker.wake",
});

export type ChromeLike = {
  readonly runtime: {
    readonly onInstalled: {
      addListener(listener: () => void): void;
    };
    readonly onMessage: {
      addListener(
        listener: (message: unknown, sender: ChromeMessageSender, sendResponse: (response: unknown) => void) => boolean,
      ): void;
    };
  };
  readonly storage: {
    readonly session: {
      set(items: Record<string, unknown>): Promise<void>;
    };
  };
  readonly permissions: {
    contains(permissions: { origins: string[] }): Promise<boolean>;
    request(permissions: { origins: string[] }): Promise<boolean>;
  };
};

export type ChromeMessageSender = {
  readonly url?: string;
  readonly tab?: { readonly url?: string };
};

export type AuthorizationDecision =
  | { ok: true; authorized: true; origin: string; origin_pattern: string }
  | { ok: true; authorized: false; origin: string; origin_pattern: string; error?: string }
  | { ok: false; authorized: false; error: string; origin?: string };

export type OriginPermissionProbe = (origins: readonly string[]) => Promise<boolean>;

export function origin_from_message_or_sender(message: unknown, sender: ChromeMessageSender): string | undefined {
  if (is_record(message) && typeof message.origin === "string") return origin_from_url_or_origin(message.origin);
  const sender_url = sender.tab?.url ?? sender.url;
  return typeof sender_url === "string" ? origin_from_url_or_origin(sender_url) : undefined;
}

export async function decide_origin_authorization(
  message: unknown,
  sender: ChromeMessageSender,
  contains: OriginPermissionProbe,
): Promise<AuthorizationDecision> {
  const origin = origin_from_message_or_sender(message, sender);
  if (origin === undefined) return { ok: false, authorized: false, error: "No page origin available" };
  const pattern = origin_permission_pattern(origin);
  if (pattern === undefined) return { ok: false, authorized: false, error: `Unsupported page origin: ${origin}`, origin };

  try {
    const authorized = await contains([pattern]);
    return authorized
      ? { ok: true, authorized: true, origin, origin_pattern: pattern }
      : { ok: true, authorized: false, origin, origin_pattern: pattern };
  } catch (error) {
    return { ok: false, authorized: false, error: error_message(error), origin };
  }
}

export async function request_origin_authorization(
  message: unknown,
  sender: ChromeMessageSender,
  contains: OriginPermissionProbe,
  request: OriginPermissionProbe,
): Promise<AuthorizationDecision> {
  const decision = await decide_origin_authorization(message, sender, contains);
  if (!decision.ok || decision.authorized) return decision;

  try {
    const authorized = await request([decision.origin_pattern]);
    return authorized
      ? { ok: true, authorized: true, origin: decision.origin, origin_pattern: decision.origin_pattern }
      : { ...decision, authorized: false, error: "Origin permission request was denied" };
  } catch (error) {
    return { ok: false, authorized: false, error: error_message(error), origin: decision.origin };
  }
}

export function service_worker_wake_state(now: string): Record<string, unknown> {
  return {
    loupe_phase: "phase_4_mv3_regression",
    daemon_health_url: "http://127.0.0.1:7373/health",
    last_service_worker_wake_at: now,
    ...page_bridge_exposure(),
  };
}

export async function persist_service_worker_wake(storage: ChromeLike["storage"], now: string): Promise<void> {
  await storage.session.set(service_worker_wake_state(now));
}

export function install_background_listeners(chrome_like: ChromeLike, now: () => string = () => new Date().toISOString()): void {
  chrome_like.runtime.onInstalled.addListener(() => {
    void persist_service_worker_wake(chrome_like.storage, now());
  });

  chrome_like.runtime.onMessage.addListener((message: unknown, sender, sendResponse) => {
    if (!is_record(message)) return false;

    if (message.type === MESSAGE_TYPES.GET_ORIGIN_AUTH) {
      void decide_origin_authorization(message, sender, (origins) => chrome_like.permissions.contains({ origins: [...origins] })).then(
        sendResponse,
        (error) => sendResponse({ ok: false, authorized: false, error: error_message(error) }),
      );
      return true;
    }

    if (message.type === MESSAGE_TYPES.REQUEST_ORIGIN_AUTH) {
      void request_origin_authorization(
        message,
        sender,
        (origins) => chrome_like.permissions.contains({ origins: [...origins] }),
        (origins) => chrome_like.permissions.request({ origins: [...origins] }),
      ).then(sendResponse, (error) => sendResponse({ ok: false, authorized: false, error: error_message(error) }));
      return true;
    }

    if (message.type === MESSAGE_TYPES.SERVICE_WORKER_WAKE) {
      void persist_service_worker_wake(chrome_like.storage, now()).then(
        () => sendResponse({ ok: true }),
        (error) => sendResponse({ ok: false, error: error_message(error) }),
      );
      return true;
    }

    return false;
  });
}

function origin_from_url_or_origin(value: string): string | undefined {
  try {
    const url = new URL(value);
    return url.origin === "null" ? `${url.protocol}//${url.host}` : url.origin;
  } catch {
    return undefined;
  }
}

function is_record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function error_message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

const chrome_global = typeof chrome === "undefined" ? undefined : (chrome as unknown as ChromeLike);
if (chrome_global !== undefined) install_background_listeners(chrome_global);
