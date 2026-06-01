const BUTTON_ID = "authorize";
const STATUS_ID = "status";

const authorize_button = document.getElementById(BUTTON_ID);
const status = document.getElementById(STATUS_ID);

if (authorize_button instanceof HTMLButtonElement && status !== null) {
  authorize_button.addEventListener("click", () => {
    void authorize_current_site(authorize_button, status);
  });
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
