(() => {
  const ROOT_ID = "loupe-extension-root";
  const MESSAGE_GET_AUTH = "loupe.origin_auth.get";
  const MESSAGE_TOGGLE_STATUS = "loupe.status_bar.toggle";
  const MESSAGE_PROBE = "loupe.content.probe";

  // Holds the mounted surface app so action messages from the service worker
  // can drive it (status-bar toggle). No in-page interaction lives here.
  let mountedApp = null;

  if (!canBootstrapContentRuntime() || document.getElementById(ROOT_ID)) return;
  installActionMessageListener();
  void bootstrapAuthorizedContent();

  function installActionMessageListener() {
    if (typeof chrome?.runtime?.onMessage?.addListener !== "function") return;
    chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
      if (!message || typeof message.type !== "string") return false;
      if (message.type === MESSAGE_PROBE) {
        sendResponse({ mounted: mountedApp !== null });
        return false;
      }
      if (message.type === MESSAGE_TOGGLE_STATUS) {
        if (mountedApp !== null && typeof mountedApp.toggleStatusBar === "function") {
          mountedApp.toggleStatusBar();
          sendResponse({ ok: true, mounted: true });
        } else {
          sendResponse({ ok: false, mounted: false });
        }
        return false;
      }
      return false;
    });
  }

  async function bootstrapAuthorizedContent() {
    const response = await runtimeMessage({ type: MESSAGE_GET_AUTH, origin: location.origin });
    if (document.getElementById(ROOT_ID)) return;
    const authorized = isAuthorizedOriginResponse(response);
    // Inert auth marker stays authorized-only. Unauthorized onboarding is shown
    // only for local project candidates; ordinary public websites stay silent.
    if (!authorized && !isLocalProjectCandidateOrigin(location.origin)) return;
    if (authorized) installContentRoot();
    loadSurfaceRuntime(authorized);
  }

  function loadSurfaceRuntime(authorized) {
    if (typeof chrome?.runtime?.getURL !== "function") return;
    try {
      void import(chrome.runtime.getURL("dist/ui/runtime/app.js"))
        .then((mod) => mod.mount({ baseUrl: chrome.runtime.getURL(""), document, storage: chrome.storage && chrome.storage.local, authorized }))
        .then((app) => { mountedApp = app; })
        .catch(() => {});
    } catch (_e) {}
  }

  function installContentRoot() {
    const root = document.createElement("div");
    root.id = ROOT_ID;
    root.hidden = true;
    root.dataset.loupeRoot = "true";
    root.dataset.exposesTokenToPage = "false";
    root.dataset.exposesPageWindowApi = "false";
    root.style.pointerEvents = "none";

    const shadow = root.attachShadow?.({ mode: "closed" });
    if (shadow) {
      const marker = document.createElement("span");
      marker.textContent = "Loupe extension root";
      shadow.append(marker);
    }

    document.documentElement.append(root);
  }

  function canBootstrapContentRuntime() {
    return (
      typeof document !== "undefined" &&
      document &&
      document.documentElement &&
      typeof document.getElementById === "function" &&
      typeof document.createElement === "function" &&
      typeof location !== "undefined" &&
      typeof location.origin === "string" &&
      typeof chrome !== "undefined" &&
      chrome?.runtime &&
      typeof chrome.runtime.sendMessage === "function"
    );
  }

  function isAuthorizedOriginResponse(value) {
    return Boolean(value && value.ok === true && value.authorized === true);
  }

  function isLocalProjectCandidateOrigin(origin) {
    try {
      const url = new URL(origin);
      if (url.protocol !== "http:" && url.protocol !== "https:") return false;
      return isLocalProjectCandidateHostname(url.hostname);
    } catch {
      return false;
    }
  }

  function isLocalProjectCandidateHostname(hostname) {
    const host = hostname.toLowerCase();
    if (host === "localhost" || host.endsWith(".localhost")) return true;
    if (host === "host.docker.internal" || host.endsWith(".local")) return true;
    if (host === "::1" || host === "[::1]") return true;

    const parts = host.split(".");
    if (parts.length !== 4) return false;
    const nums = parts.map((part) => Number(part));
    if (nums.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return false;
    const [a, b] = nums;
    return a === 10 || a === 127 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 169 && b === 254);
  }

  function runtimeMessage(message) {
    return new Promise((resolve) => {
      try {
        const maybePromise = chrome.runtime.sendMessage(message, (response) => {
          if (chrome.runtime.lastError) {
            resolve(undefined);
            return;
          }
          resolve(response);
        });
        if (maybePromise && typeof maybePromise.then === "function") maybePromise.then(resolve, () => resolve(undefined));
      } catch {
        resolve(undefined);
      }
    });
  }
})();
