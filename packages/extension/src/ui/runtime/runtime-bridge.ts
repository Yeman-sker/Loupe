export type ChromeRuntimeBridge = {
  readonly lastError?: { readonly message?: string };
  sendMessage(message: unknown, response_callback: (response: unknown) => void): unknown;
};

export function extensionRuntime(): ChromeRuntimeBridge | undefined {
  const chrome = (globalThis as typeof globalThis & { chrome?: { runtime?: ChromeRuntimeBridge } }).chrome;
  return typeof chrome?.runtime?.sendMessage === "function" ? chrome.runtime : undefined;
}

export function runtimeMessage(runtime: ChromeRuntimeBridge, message: unknown): Promise<unknown> {
  return new Promise((resolve) => {
    try {
      const maybePromise = runtime.sendMessage(message, (response: unknown) => {
        if (runtime.lastError !== undefined) {
          resolve(undefined);
          return;
        }
        resolve(response);
      });
      if (isPromiseLike(maybePromise)) void maybePromise.then(resolve, () => resolve(undefined));
    } catch {
      resolve(undefined);
    }
  });
}

export function isAuthorizedResponse(value: unknown): boolean {
  return isRecord(value) && value.ok === true && value.authorized === true;
}

function isPromiseLike(value: unknown): value is PromiseLike<unknown> {
  return typeof value === "object" && value !== null && typeof (value as { then?: unknown }).then === "function";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
