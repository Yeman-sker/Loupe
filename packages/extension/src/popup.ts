import { origin_permission_pattern } from "./content.js";

export type PopupTab = Readonly<{
  id?: number;
  url?: string;
}>;

export type PopupTabs = Readonly<{
  query(query_info: { active: true; currentWindow: true }): Promise<PopupTab[]>;
  reload(tab_id: number): Promise<void>;
}>;

export type PopupPermissions = Readonly<{
  contains(permissions: { origins: string[] }): Promise<boolean>;
  request(permissions: { origins: string[] }): Promise<boolean>;
}>;

export type PopupStorageArea = Readonly<{
  set(values: Record<string, unknown>): Promise<void>;
}>;

export type DaemonPairingInput = Readonly<{
  base_url: string;
  token: string;
}>;

export type DaemonPairingResult =
  | { ok: true; base_url: string; token: string }
  | { ok: false; error: string };

export type PopupAuthorizationResult =
  | { ok: true; authorized: true; origin: string; origin_pattern: string; reloaded: boolean }
  | { ok: true; authorized: false; origin: string; origin_pattern: string; reloaded: false; error: string }
  | { ok: false; authorized: false; reloaded: false; error: string };

export const DAEMON_SETTINGS_KEY = "loupe:v1:settings";

export async function authorize_current_tab_origin(tabs: PopupTabs, permissions: PopupPermissions): Promise<PopupAuthorizationResult> {
  const tab = (await tabs.query({ active: true, currentWindow: true }))[0];
  const origin = origin_from_tab(tab);
  if (origin === undefined) return { ok: false, authorized: false, reloaded: false, error: "Open an http:// or https:// page first." };

  const pattern = origin_permission_pattern(origin);
  if (pattern === undefined) return { ok: false, authorized: false, reloaded: false, error: `Unsupported page origin: ${origin}` };

  const origins = [pattern];
  const authorized = (await permissions.contains({ origins })) || (await permissions.request({ origins }));
  if (!authorized) return { ok: true, authorized: false, origin, origin_pattern: pattern, reloaded: false, error: "Permission was not granted." };

  if (tab?.id !== undefined) await tabs.reload(tab.id);
  return { ok: true, authorized: true, origin, origin_pattern: pattern, reloaded: tab?.id !== undefined };
}

export async function pair_daemon(storage: PopupStorageArea, input: DaemonPairingInput): Promise<DaemonPairingResult> {
  const base_url = normalize_daemon_base_url(input.base_url);
  if (base_url === undefined) return { ok: false, error: "Daemon URL must be http:// or https://." };
  const token = input.token.trim();
  if (token.length === 0) return { ok: false, error: "Daemon token is required." };

  const daemon = { base_url, token };
  await storage.set({ [DAEMON_SETTINGS_KEY]: { daemon } });
  return { ok: true, ...daemon };
}

function normalize_daemon_base_url(value: string): string | undefined {
  try {
    const url = new URL(value.trim());
    if (url.protocol !== "http:" && url.protocol !== "https:") return undefined;
    url.hash = "";
    url.search = "";
    url.pathname = url.pathname === "/" ? "/" : url.pathname.replace(/\/+$/, "");
    return url.href.endsWith("/") ? url.href.slice(0, -1) : url.href;
  } catch {
    return undefined;
  }
}

function origin_from_tab(tab: PopupTab | undefined): string | undefined {
  if (tab?.url === undefined) return undefined;
  try {
    const url = new URL(tab.url);
    return url.protocol === "http:" || url.protocol === "https:" ? url.origin : undefined;
  } catch {
    return undefined;
  }
}
