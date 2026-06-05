(() => {
  const ROOT_ID = "loupe-extension-root";
  const MESSAGE_GET_AUTH = "loupe.origin_auth.get";

  if (!canBootstrapContentRuntime() || document.getElementById(ROOT_ID)) return;
  void bootstrapAuthorizedContent();

  async function bootstrapAuthorizedContent() {
    const response = await runtimeMessage({ type: MESSAGE_GET_AUTH, origin: location.origin });
    if (document.getElementById(ROOT_ID)) return;
    const authorized = isAuthorizedOriginResponse(response);
    // Inert auth marker stays authorized-only (unchanged security posture). The
    // surface runtime loads in both states; when unauthorized it shows only the
    // host-authorization CTA, which routes the grant to the browser action.
    if (authorized) installContentRoot();
    loadSurfaceRuntime(authorized);
  }

  function loadSurfaceRuntime(authorized) {
    if (typeof chrome?.runtime?.getURL !== "function") return;
    try {
      void import(chrome.runtime.getURL("dist/ui/app.js"))
        .then((mod) => mod.mount({ baseUrl: chrome.runtime.getURL(""), document, storage: chrome.storage && chrome.storage.local, authorized }))
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
