const MESSAGE_TYPES = Object.freeze({
  GET_ORIGIN_AUTH: "loupe.origin_auth.get",
  REQUEST_ORIGIN_AUTH: "loupe.origin_auth.request",
});

chrome.runtime.onInstalled.addListener(() => {
  void chrome.storage.session.set({
    loupe_phase: "phase_2_extension_capture",
    exposes_token_to_page: false,
    exposes_page_window_api: false,
  });
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!isObject(message)) return false;

  if (message.type === MESSAGE_TYPES.GET_ORIGIN_AUTH) {
    void handleGetOriginAuth(message, sender).then(sendResponse, (error) => {
      sendResponse({ ok: false, authorized: false, error: errorMessage(error) });
    });
    return true;
  }

  if (message.type === MESSAGE_TYPES.REQUEST_ORIGIN_AUTH) {
    void handleRequestOriginAuth(message, sender).then(sendResponse, (error) => {
      sendResponse({ ok: false, authorized: false, error: errorMessage(error) });
    });
    return true;
  }

  return false;
});

async function handleGetOriginAuth(message, sender) {
  const origin = originFromMessageOrSender(message, sender);
  if (!origin) return { ok: false, authorized: false, error: "No page origin available" };
  const origins = [originPattern(origin)];
  const authorized = await chrome.permissions.contains({ origins });
  return { ok: true, authorized, origin, origin_pattern: origins[0] };
}

async function handleRequestOriginAuth(message, sender) {
  const origin = originFromMessageOrSender(message, sender);
  if (!origin) return { ok: false, authorized: false, error: "No page origin available" };
  const origins = [originPattern(origin)];
  const alreadyAuthorized = await chrome.permissions.contains({ origins });
  if (alreadyAuthorized) return { ok: true, authorized: true, origin, origin_pattern: origins[0] };
  const granted = await chrome.permissions.request({ origins });
  return { ok: true, authorized: granted, origin, origin_pattern: origins[0] };
}

function originFromMessageOrSender(message, sender) {
  if (typeof message.origin === "string" && isHttpOrigin(message.origin)) return message.origin;
  const senderUrl = sender?.tab?.url ?? sender?.url;
  if (typeof senderUrl !== "string") return null;
  try {
    const url = new URL(senderUrl);
    return isHttpOrigin(url.origin) ? url.origin : null;
  } catch {
    return null;
  }
}

function originPattern(origin) {
  const url = new URL(origin);
  return `${url.protocol}//${url.host}/*`;
}

function isHttpOrigin(origin) {
  try {
    const url = new URL(origin);
    return (url.protocol === "http:" || url.protocol === "https:") && url.origin === origin;
  } catch {
    return false;
  }
}

function isObject(value) {
  return typeof value === "object" && value !== null;
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}
