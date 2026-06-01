const BUTTON_ID = "authorize";
const PAIR_BUTTON_ID = "pair";
const BASE_URL_ID = "base-url";
const TOKEN_ID = "token";
const STATUS_ID = "status";
const DAEMON_SETTINGS_KEY = "loupe:v1:settings";

const authorize_button = document.getElementById(BUTTON_ID);
const pair_button = document.getElementById(PAIR_BUTTON_ID);
const base_url_input = document.getElementById(BASE_URL_ID);
const token_input = document.getElementById(TOKEN_ID);
const status = document.getElementById(STATUS_ID);

if (authorize_button instanceof HTMLButtonElement && status !== null) {
  authorize_button.addEventListener("click", () => {
    void authorize_current_site(authorize_button, status);
  });
}

if (pair_button instanceof HTMLButtonElement && base_url_input instanceof HTMLInputElement && token_input instanceof HTMLInputElement && status !== null) {
  pair_button.addEventListener("click", () => {
    void pair_daemon(pair_button, base_url_input, token_input, status);
  });
}

void hydrate_daemon_pairing(base_url_input, token_input);

async function pair_daemon(button, base_url_input_node, token_input_node, status_node) {
  button.disabled = true;
  set_status(status_node, "Saving daemon pairing…");

  try {
    const base_url = normalize_daemon_base_url(base_url_input_node.value);
    if (!base_url) {
      set_status(status_node, "Daemon URL must be http:// or https://.", true);
      return;
    }
    const token = token_input_node.value.trim();
    if (!token) {
      set_status(status_node, "Daemon token is required.", true);
      return;
    }

    const daemon = { base_url, token };
    await chrome.storage.local.set({ [DAEMON_SETTINGS_KEY]: { daemon } });
    set_status(status_node, "Daemon pairing saved. New marks will sync to Loupe server.");
  } catch (error) {
    set_status(status_node, error instanceof Error ? error.message : String(error), true);
  } finally {
    button.disabled = false;
  }
}

async function hydrate_daemon_pairing(base_url_input_node, token_input_node) {
  if (!(base_url_input_node instanceof HTMLInputElement) || !(token_input_node instanceof HTMLInputElement)) return;
  try {
    const stored = await chrome.storage.local.get(DAEMON_SETTINGS_KEY);
    const daemon = stored?.[DAEMON_SETTINGS_KEY]?.daemon;
    if (daemon && typeof daemon === "object") {
      if (typeof daemon.base_url === "string") base_url_input_node.value = daemon.base_url;
      if (typeof daemon.token === "string") token_input_node.value = daemon.token;
    }
  } catch {}
}

async function authorize_current_site(button, status_node) {
  button.disabled = true;
  set_status(status_node, "Requesting current-site permission…");

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const origin = tab?.url === undefined ? undefined : origin_from_url(tab.url);
    if (origin === undefined) {
      set_status(status_node, "Open an http:// or https:// page first.", true);
      return;
    }

    const origins = [`${origin}/*`];
    const already_authorized = await chrome.permissions.contains({ origins });
    const authorized = already_authorized || (await chrome.permissions.request({ origins }));
    if (!authorized) {
      set_status(status_node, "Permission was not granted.", true);
      return;
    }

    set_status(status_node, "Authorized. Reloading page…");
    if (typeof tab.id === "number") await chrome.tabs.reload(tab.id);
    window.close();
  } catch (error) {
    set_status(status_node, error instanceof Error ? error.message : String(error), true);
  } finally {
    button.disabled = false;
  }
}

function normalize_daemon_base_url(value) {
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

function origin_from_url(value) {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:" ? url.origin : undefined;
  } catch {
    return undefined;
  }
}

function set_status(status_node, message, is_error = false) {
  status_node.textContent = message;
  if (is_error) status_node.dataset.error = "true";
  else delete status_node.dataset.error;
}
