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

export type PopupAuthorizationResult =
  | { ok: true; authorized: true; origin: string; origin_pattern: string; reloaded: boolean }
  | { ok: true; authorized: false; origin: string; origin_pattern: string; reloaded: false; error: string }
  | { ok: false; authorized: false; reloaded: false; error: string };

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

function origin_from_tab(tab: PopupTab | undefined): string | undefined {
  if (tab?.url === undefined) return undefined;
  try {
    const url = new URL(tab.url);
    return url.protocol === "http:" || url.protocol === "https:" ? url.origin : undefined;
  } catch {
    return undefined;
  }
}
