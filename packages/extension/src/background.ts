declare const chrome: unknown;

import { is_extension_host_eligible, origin_permission_pattern, page_bridge_exposure } from "./content.js";

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
  | { ok: true; authorized: boolean; origin: string; origin_pattern: string }
  | { ok: false; authorized: false; error: string };

export type OriginPermissionProbe = (origins: readonly string[]) => Promise<boolean>;

export function origin_from_message_or_sender(message: unknown, sender: ChromeMessageSender): string | undefined {
  if (is_record(message) && typeof message.origin === "string" && is_extension_host_eligible(message.origin)) return message.origin;
  const sender_url = sender.tab?.url ?? sender.url;
  if (typeof sender_url !== "string") return undefined;
  try {
    const url = new URL(sender_url);
    return is_extension_host_eligible(url.origin) ? url.origin : undefined;
  } catch {
    return undefined;
  }
}

export async function decide_origin_authorization(
  message: unknown,
  sender: ChromeMessageSender,
  contains: OriginPermissionProbe,
): Promise<AuthorizationDecision> {
  const origin = origin_from_message_or_sender(message, sender);
  if (origin === undefined) return { ok: false, authorized: false, error: "No page origin available" };
  const pattern = origin_permission_pattern(origin);
  if (pattern === undefined) return { ok: false, authorized: false, error: "Unsupported page origin" };
  return { ok: true, authorized: await contains([pattern]), origin, origin_pattern: pattern };
}

export async function request_origin_authorization(
  message: unknown,
  sender: ChromeMessageSender,
  contains: OriginPermissionProbe,
  request: OriginPermissionProbe,
): Promise<AuthorizationDecision> {
  const decision = await decide_origin_authorization(message, sender, contains);
  if (!decision.ok || decision.authorized) return decision;
  return { ...decision, authorized: await request([decision.origin_pattern]) };
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

function is_record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function error_message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

const chrome_global = typeof chrome === "undefined" ? undefined : (chrome as unknown as ChromeLike);
if (chrome_global !== undefined) install_background_listeners(chrome_global);
