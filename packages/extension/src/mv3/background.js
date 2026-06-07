const MESSAGE_TYPES = Object.freeze({
  GET_ORIGIN_AUTH: "loupe.origin_auth.get",
  REQUEST_ORIGIN_AUTH: "loupe.origin_auth.request",
  SERVICE_WORKER_WAKE: "loupe.service_worker.wake",
  TOGGLE_STATUS_BAR: "loupe.status_bar.toggle",
  CONTENT_PROBE: "loupe.content.probe",
  PAIR_DAEMON: "loupe.daemon.pair",
  RESOLVE_MARK: "loupe.mark.resolve",
  DELETE_MARK: "loupe.mark.delete",
});

const LOUPE_AUTH_SCHEME = "Bearer";
const LOUPE_DAEMON_STORAGE_KEY = "loupe:v1:daemon";
const LOUPE_DAEMON_BASE_URL = "http://127.0.0.1:7373";
const LOUPE_DAEMON_PAIRING_PATH = "/v1/extension-pairing";
const LOUPE_DAEMON_NAME = "loupe";
const MARK_STREAM_PORT_NAME = "loupe.mark_stream";

chrome.runtime.onInstalled.addListener(() => {
  void chrome.storage.session.set({
    loupe_phase: "phase_2_extension_capture",
    exposes_token_to_page: false,
    exposes_page_window_api: false,
  });
});

// The toolbar action is state-aware (ADP local-project-gated onboarding):
//   - On an already-authorized origin it TOGGLES the in-page floating status
//     bar — the toolbar click is no longer the host-permission CTA.
//   - On an un-granted origin it requests host permission, kept purely as the
//     MV3 grant fallback (action.onClicked is a valid user gesture, unlike a
//     content-script-relayed message).
// We mirror granted origin patterns into an in-memory set so onClicked can
// branch SYNCHRONOUSLY: awaiting permissions.contains() first would consume the
// transient user gesture and make a later permissions.request() silently fail.
const authorizedOriginPatterns = new Set();

void seedAuthorizedOrigins();
if (chrome.permissions && chrome.permissions.onAdded && chrome.permissions.onAdded.addListener) {
  chrome.permissions.onAdded.addListener((p) => addOriginPatterns(p && p.origins));
}
if (chrome.permissions && chrome.permissions.onRemoved && chrome.permissions.onRemoved.addListener) {
  chrome.permissions.onRemoved.addListener((p) => removeOriginPatterns(p && p.origins));
}

if (chrome.action && chrome.action.onClicked) {
  chrome.action.onClicked.addListener((tab) => {
    handleActionClick(tab);
  });
}

function handleActionClick(tab) {
  const origin = tabOrigin(tab);
  if (!origin) return;
  const pattern = originPattern(origin);

  if (authorizedOriginPatterns.has(pattern)) {
    void toggleStatusBar(tab);
    return;
  }

  // Not known-authorized → request the grant. This must be the first permission
  // API touched in the gesture, so do not await anything before it.
  chrome.permissions
    .request({ origins: [pattern] })
    .then(async (granted) => {
      if (!granted) return;
      authorizedOriginPatterns.add(pattern);
      // Cold SW start can miss a real grant in the cache above; if Loupe is
      // already running on the page, toggle instead of a spurious reload.
      const mounted = await probeContent(tab);
      if (mounted) await toggleStatusBar(tab);
      else if (typeof tab?.id === "number") await chrome.tabs.reload(tab.id).catch(() => {});
    })
    .catch(() => {});
}

async function seedAuthorizedOrigins() {
  try {
    const all = await chrome.permissions.getAll();
    addOriginPatterns(all && all.origins);
  } catch (_e) {}
}

function addOriginPatterns(origins) {
  if (Array.isArray(origins)) for (const o of origins) authorizedOriginPatterns.add(o);
}

function removeOriginPatterns(origins) {
  if (Array.isArray(origins)) for (const o of origins) authorizedOriginPatterns.delete(o);
}

function toggleStatusBar(tab) {
  if (typeof tab?.id !== "number") return Promise.resolve();
  return sendTabMessage(tab.id, { type: MESSAGE_TYPES.TOGGLE_STATUS_BAR });
}

function probeContent(tab) {
  if (typeof tab?.id !== "number") return Promise.resolve(false);
  return sendTabMessage(tab.id, { type: MESSAGE_TYPES.CONTENT_PROBE }).then(
    (resp) => Boolean(resp && resp.mounted),
  );
}

function sendTabMessage(tabId, message) {
  return new Promise((resolve) => {
    try {
      chrome.tabs.sendMessage(tabId, message, (response) => {
        if (chrome.runtime.lastError) {
          resolve(undefined);
          return;
        }
        resolve(response);
      });
    } catch (_e) {
      resolve(undefined);
    }
  });
}

function tabOrigin(tab) {
  const url = tab?.url;
  if (typeof url !== "string") return null;
  try {
    const origin = new URL(url).origin;
    return isHttpOrigin(origin) ? origin : null;
  } catch {
    return null;
  }
}

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

  if (message.type === MESSAGE_TYPES.PAIR_DAEMON) {
    void pairDaemon(message).then(sendResponse, (error) => {
      sendResponse({ ok: false, paired: false, error: errorMessage(error) });
    });
    return true;
  }

  if (message.type === MESSAGE_TYPES.SERVICE_WORKER_WAKE) {
    void handleServiceWorkerWake(message).then(sendResponse, (error) => {
      sendResponse({ ok: false, error: errorMessage(error) });
    });
    return true;
  }

  if (message.type === MESSAGE_TYPES.RESOLVE_MARK || message.type === MESSAGE_TYPES.DELETE_MARK) {
    const action = message.type === MESSAGE_TYPES.RESOLVE_MARK ? "resolve" : "delete";
    void handleMarkMutation(message, action).then(sendResponse, (error) => {
      sendResponse({ ok: false, error: errorMessage(error) });
    });
    return true;
  }

  return false;
});

// Page-originated resolve / delete write path. The page stays token-free: it
// sends {id, scope} after its optimistic local update and the SW performs the
// authenticated daemon write, which the daemon echoes back over SSE.
async function handleMarkMutation(message, action) {
  const now = new Date().toISOString();
  const scope = wakeScope(message);
  const id = isObject(message) && typeof message.id === "string" ? message.id : undefined;
  if (id === undefined || !scope) return { ok: false, error: "mark id and scope are required" };
  const daemon = await storedDaemon();
  if (!daemon) return { ok: true, token_missing: true };
  const marksKey = sessionMarksKey(scope.project_id, scope.session_id);
  const mark = { id, project: scope };
  if (action === "delete") {
    await retryDeleteMark(marksKey, mark, daemon);
    return { ok: true, deleted: true };
  }
  await retryResolveMark(marksKey, mark, daemon, now);
  return { ok: true, resolved: true };
}

// Live daemon → page push. The SW owns the token and the SSE connection; the
// page opens a Port and only receives token-free change frames. A connected Port
// keeps the SW alive while a dev tab is open, and lets it idle when none.
chrome.runtime.onConnect?.addListener((port) => {
  if (port.name === MARK_STREAM_PORT_NAME) connectMarkStream(port);
});

function connectMarkStream(port) {
  let scope;
  let started = false;
  let closed = false;
  let controller;
  const backoffMs = (attempt) => Math.min(1000 * 2 ** attempt, 30000);

  port.onDisconnect.addListener(() => {
    closed = true;
    if (controller) controller.abort();
  });

  port.onMessage.addListener((message) => {
    if (started) return;
    const next = wakeScope(message);
    if (next === undefined) return;
    scope = next;
    started = true;
    void run();
  });

  async function run() {
    const daemon = await storedDaemon();
    if (daemon === null || scope === undefined) {
      if (!closed) port.postMessage({ type: "stream_status", status: "unpaired" });
      return;
    }
    const marksKey = sessionMarksKey(scope.project_id, scope.session_id);
    let attempt = 0;
    while (!closed) {
      controller = new AbortController();
      let opened = false;
      try {
        const response = await fetch(markStreamUrl(daemon.base_url, scope), { headers: authorizedHeaders(daemon.token), signal: controller.signal });
        if (!response.ok || response.body === null) throw new Error(`GET /v1/marks/stream failed with ${response.status}`);
        opened = true;
        attempt = 0;
        port.postMessage({ type: "stream_status", status: "open" });
        await pumpEventStream(response.body, async (event) => {
          await applyStreamEvent(marksKey, scope, event);
          port.postMessage(event);
        });
      } catch (_e) {
        // Network / abort / stream end; reconnect unless the Port closed.
      }
      if (closed) break;
      if (opened) port.postMessage({ type: "stream_status", status: "reconnecting" });
      await delay(backoffMs(attempt));
      attempt += 1;
    }
  }
}

async function pumpEventStream(body, onEvent) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let idx = buffer.indexOf("\n\n");
    while (idx !== -1) {
      const frame = buffer.slice(0, idx);
      buffer = buffer.slice(idx + 2);
      for (const line of frame.split("\n")) {
        if (!line.startsWith("data:")) continue;
        const event = parseStreamEvent(line.slice(5).trim());
        if (event !== undefined) await onEvent(event);
      }
      idx = buffer.indexOf("\n\n");
    }
  }
}

function parseStreamEvent(data) {
  let value;
  try {
    value = JSON.parse(data);
  } catch (_e) {
    return undefined;
  }
  if (!isObject(value)) return undefined;
  if (value.type === "snapshot") return Array.isArray(value.marks) ? { type: "snapshot", marks: value.marks.filter(isObject) } : undefined;
  if (value.type === "upsert" || value.type === "resolve") return isObject(value.mark) ? { type: value.type, mark: value.mark } : undefined;
  if (value.type === "delete") return typeof value.id === "string" ? { type: "delete", id: value.id } : undefined;
  return undefined;
}

async function applyStreamEvent(marksKey, scope, event) {
  if (event.type === "snapshot") {
    await reconcileDaemonMarks(marksKey, scope, event.marks);
    return;
  }
  if (event.type === "delete") {
    const existing = await readStoredMark(marksKey, event.id);
    if (existing !== undefined) await deleteStoredMark(marksKey, existing);
    return;
  }
  const daemonMark = event.mark;
  if (!isDaemonMarkForScope(daemonMark, scope)) return;
  const local = await readStoredMark(marksKey, daemonMark.id);
  if (local !== undefined && shouldPreserveUnsyncedLocal(local, daemonMark)) return;
  const next = local === undefined ? annotationFromDaemonMark(daemonMark) : reconcileLocalMark(local, daemonMark);
  const now = new Date().toISOString();
  await replaceStoredMark(marksKey, { ...next, sync: { status: "synced", retry_count: (next.sync && next.sync.retry_count) || 0, last_synced_at: now } });
}

function markStreamUrl(baseUrl, scope) {
  const url = new URL(joinDaemonUrl(baseUrl, "/v1/marks/stream"));
  appendParam(url, "project_id", scope.project_id);
  appendParam(url, "workspace_root_hash", scope.workspace_root_hash);
  appendParam(url, "branch", scope.branch);
  appendParam(url, "origin", scope.origin);
  appendParam(url, "url", scope.url);
  appendParam(url, "route_key", scope.route_key);
  appendParam(url, "session_id", scope.session_id);
  return url.href;
}

function delay(ms) {
  return new Promise((resolve) => { setTimeout(resolve, ms); });
}

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
  let granted = false;
  try {
    granted = await chrome.permissions.request({ origins });
  } catch (_e) {
    const alreadyAuthorized = await chrome.permissions.contains({ origins });
    if (alreadyAuthorized) return { ok: true, authorized: true, origin, origin_pattern: origins[0] };
    throw _e;
  }
  if (granted && typeof sender?.tab?.id === "number") {
    try {
      await chrome.tabs.reload(sender.tab.id);
    } catch (_e) {}
  }
  return { ok: true, authorized: granted, origin, origin_pattern: origins[0] };
}

async function pairDaemon(message) {
  const input = isObject(message.daemon) ? message.daemon : message;
  const baseUrl = typeof input.base_url === "string" && input.base_url.length > 0 ? input.base_url : LOUPE_DAEMON_BASE_URL;
  if (typeof input.token !== "string" || input.token.length === 0) return { ok: false, paired: false, token_missing: true, error: "Daemon token is required" };
  let health;
  try {
    const response = await fetch(joinDaemonUrl(baseUrl, "/health"));
    if (!response.ok) throw new Error(`GET /health failed with ${response.status}`);
    health = await response.json();
  } catch (error) {
    return { ok: false, paired: false, daemon_offline: true, error: errorMessage(error) };
  }
  if (!isObject(health) || health.ok !== true || health.name !== LOUPE_DAEMON_NAME) return { ok: false, paired: false, error: "Health endpoint is not a Loupe daemon" };

  const pairing = {
    base_url: baseUrl,
    token: input.token,
    paired_at: new Date().toISOString(),
    ...(typeof input.token_path === "string" ? { token_path: input.token_path } : {}),
    ...(typeof health.project_id === "string" ? { project_id: health.project_id } : {}),
    ...(typeof health.workspace_root_hash === "string" ? { workspace_root_hash: health.workspace_root_hash } : {}),
    ...(typeof health.workspace_root === "string" ? { workspace_root: health.workspace_root } : {}),
    ...(typeof health.project_name === "string" ? { project_name: health.project_name } : {}),
    ...(typeof health.branch === "string" ? { branch: health.branch } : {}),
  };
  await chrome.storage.local.set({ [LOUPE_DAEMON_STORAGE_KEY]: pairing });
  return {
    ok: true,
    paired: true,
    base_url: baseUrl,
    ...(typeof pairing.project_id === "string" ? { project_id: pairing.project_id } : {}),
    ...(typeof pairing.workspace_root_hash === "string" ? { workspace_root_hash: pairing.workspace_root_hash } : {}),
    ...(typeof pairing.workspace_root === "string" ? { workspace_root: pairing.workspace_root } : {}),
    ...(typeof pairing.project_name === "string" ? { project_name: pairing.project_name } : {}),
    ...(typeof pairing.branch === "string" ? { branch: pairing.branch } : {}),
  };
}

async function handleServiceWorkerWake(message) {
  const now = new Date().toISOString();
  await chrome.storage.session.set(serviceWorkerWakeState(now));

  const scope = wakeScope(message);
  const daemon = wakeDaemon(message) || await storedDaemon() || await pairLocalDaemon(now);
  if (!scope) return { ok: true, reconciled: false, retried: 0, stored: 0, ...daemonIdentity(daemon) };
  if (!daemon) {
    const marksKey = sessionMarksKey(scope.project_id, scope.session_id);
    const stored = await chrome.storage.local.get(marksKey);
    return { ok: true, reconciled: false, retried: 0, stored: readAnnotationArray(stored?.[marksKey]).length, token_missing: true };
  }

  const marksKey = sessionMarksKey(scope.project_id, scope.session_id);
  const stored = await chrome.storage.local.get(marksKey);
  const localMarks = readAnnotationArray(stored?.[marksKey]);
  const deletePending = localMarks.filter((mark) => isScopeMark(mark, scope) && mark.sync?.status === "delete_pending");
  for (const mark of deletePending) await retryDeleteMark(marksKey, mark, daemon);
  const afterDeletes = readAnnotationArray((await chrome.storage.local.get(marksKey))?.[marksKey]);
  const retryable = afterDeletes.filter((mark) => isScopeMark(mark, scope) && !mark.lifecycle?.deleted_at && (mark.sync?.status === "local_only" || mark.sync?.status === "failed"));
  const retriedIds = retryable.map((mark) => mark.id);
  const retryResults = [];
  for (const mark of retryable) retryResults.push(await retryLocalMark(marksKey, mark, daemon, now));

  try {
    const response = await fetch(markListUrl(daemon.base_url, scope), { method: "GET", headers: authorizedHeaders(daemon.token) });
    if (!response.ok) throw new Error(`GET /v1/marks failed with ${response.status}`);
    const payload = await response.json();
    const daemonMarks = Array.isArray(payload?.marks) ? payload.marks : [];
    const merged = await reconcileDaemonMarks(marksKey, scope, daemonMarks, retriedIds);
    return { ok: true, reconciled: true, retried: retryResults.length, stored: merged.length, ...daemonIdentity(daemon), session_id: scope.session_id };
  } catch (error) {
    return { ok: true, reconciled: false, retried: retryResults.length, stored: readAnnotationArray((await chrome.storage.local.get(marksKey))?.[marksKey]).length, error: errorMessage(error), ...daemonIdentity(daemon), session_id: scope.session_id };
  }
}

function serviceWorkerWakeState(now) {
  return {
    loupe_phase: "phase_4_mv3_regression",
    daemon_health_url: "http://127.0.0.1:7373/health",
    last_service_worker_wake_at: now,
    exposes_token_to_page: false,
    exposes_page_window_api: false,
    bridge_nonce_readonly: true,
  };
}

function wakeScope(message) {
  const scope = isObject(message.scope) ? message.scope : message;
  if (typeof scope.project_id !== "string" || typeof scope.session_id !== "string") return null;
  return {
    project_id: scope.project_id,
    session_id: scope.session_id,
    workspace_root_hash: typeof scope.workspace_root_hash === "string" ? scope.workspace_root_hash : undefined,
    branch: typeof scope.branch === "string" ? scope.branch : undefined,
    origin: typeof scope.origin === "string" ? scope.origin : undefined,
    url: typeof scope.url === "string" ? scope.url : undefined,
    route_key: typeof scope.route_key === "string" ? scope.route_key : undefined,
  };
}

function wakeDaemon(message) {
  const daemon = isObject(message.daemon) ? message.daemon : message;
  if (typeof daemon.base_url !== "string" || typeof daemon.token !== "string" || daemon.base_url.length === 0 || daemon.token.length === 0) return null;
  return { base_url: daemon.base_url, token: daemon.token };
}

async function storedDaemon() {
  const stored = await chrome.storage.local.get(LOUPE_DAEMON_STORAGE_KEY);
  const daemon = stored?.[LOUPE_DAEMON_STORAGE_KEY];
  if (!isObject(daemon)) return null;
  if (typeof daemon.base_url !== "string" || typeof daemon.token !== "string" || daemon.base_url.length === 0 || daemon.token.length === 0) return null;
  return {
    base_url: daemon.base_url,
    token: daemon.token,
    ...(typeof daemon.project_id === "string" ? { project_id: daemon.project_id } : {}),
    ...(typeof daemon.workspace_root_hash === "string" ? { workspace_root_hash: daemon.workspace_root_hash } : {}),
    ...(typeof daemon.workspace_root === "string" ? { workspace_root: daemon.workspace_root } : {}),
    ...(typeof daemon.project_name === "string" ? { project_name: daemon.project_name } : {}),
    ...(typeof daemon.branch === "string" ? { branch: daemon.branch } : {}),
  };
}

async function pairLocalDaemon(now) {
  let payload;
  try {
    const response = await fetch(joinDaemonUrl(LOUPE_DAEMON_BASE_URL, LOUPE_DAEMON_PAIRING_PATH));
    if (!response.ok) return null;
    payload = await response.json();
  } catch (_e) {
    return null;
  }
  if (!isObject(payload)) return null;
  const baseUrl = typeof payload.base_url === "string" && payload.base_url.length > 0 ? payload.base_url : LOUPE_DAEMON_BASE_URL;
  if (typeof payload.token !== "string" || payload.token.length === 0) return null;
  const pairing = {
    base_url: baseUrl,
    token: payload.token,
    paired_at: now,
    ...(typeof payload.token_path === "string" ? { token_path: payload.token_path } : {}),
    ...(typeof payload.project_id === "string" ? { project_id: payload.project_id } : {}),
    ...(typeof payload.workspace_root_hash === "string" ? { workspace_root_hash: payload.workspace_root_hash } : {}),
    ...(typeof payload.workspace_root === "string" ? { workspace_root: payload.workspace_root } : {}),
    ...(typeof payload.project_name === "string" ? { project_name: payload.project_name } : {}),
    ...(typeof payload.branch === "string" ? { branch: payload.branch } : {}),
  };
  await chrome.storage.local.set({ [LOUPE_DAEMON_STORAGE_KEY]: pairing });
  return { base_url: pairing.base_url, token: pairing.token, ...(typeof pairing.project_id === "string" ? { project_id: pairing.project_id } : {}), ...(typeof pairing.workspace_root_hash === "string" ? { workspace_root_hash: pairing.workspace_root_hash } : {}), ...(typeof pairing.workspace_root === "string" ? { workspace_root: pairing.workspace_root } : {}), ...(typeof pairing.project_name === "string" ? { project_name: pairing.project_name } : {}), ...(typeof pairing.branch === "string" ? { branch: pairing.branch } : {}) };
}

function daemonIdentity(daemon) {
  if (!daemon || typeof daemon.project_id !== "string" || typeof daemon.workspace_root_hash !== "string") return {};
  return {
    project_id: daemon.project_id,
    workspace_root_hash: daemon.workspace_root_hash,
    ...(typeof daemon.workspace_root === "string" ? { workspace_root: daemon.workspace_root } : {}),
    ...(typeof daemon.project_name === "string" ? { project_name: daemon.project_name } : {}),
    ...(typeof daemon.branch === "string" ? { branch: daemon.branch } : {}),
  };
}

async function retryLocalMark(marksKey, mark, daemon, now) {
  await replaceStoredMark(marksKey, { ...mark, sync: { status: "syncing", retry_count: mark.sync?.retry_count || 0 } });
  try {
    const response = await fetch(joinDaemonUrl(daemon.base_url, "/v1/marks"), {
      method: "POST",
      headers: { ...authorizedHeaders(daemon.token), "content-type": "application/json" },
      body: JSON.stringify(mark),
    });
    if (!response.ok) throw new Error(`POST /v1/marks failed with ${response.status}`);
    const current = (await readStoredMark(marksKey, mark.id)) || mark;
    if (current.lifecycle?.updated_at !== mark.lifecycle?.updated_at) return { ok: true, mark: current };
    const synced = { ...current, sync: { status: "synced", retry_count: current.sync?.retry_count || 0, last_synced_at: now } };
    await replaceStoredMark(marksKey, synced);
    return { ok: true, mark: synced };
  } catch (error) {
    const current = (await readStoredMark(marksKey, mark.id)) || mark;
    const failed = { ...current, sync: { status: "failed", retry_count: (current.sync?.retry_count || 0) + 1, last_error: errorMessage(error) } };
    await replaceStoredMark(marksKey, failed);
    return { ok: false, mark: failed, error: failed.sync.last_error };
  }
}

async function retryDeleteMark(marksKey, mark, daemon) {
  try {
    const response = await fetch(markDeleteUrl(daemon.base_url, mark), { method: "DELETE", headers: authorizedHeaders(daemon.token) });
    if (!response.ok) throw new Error(`DELETE /v1/marks/${mark.id} failed with ${response.status}`);
    const current = (await readStoredMark(marksKey, mark.id)) || mark;
    await deleteStoredMark(marksKey, current);
  } catch (error) {
    const current = (await readStoredMark(marksKey, mark.id)) || mark;
    await replaceStoredMark(marksKey, { ...current, sync: { status: "delete_pending", retry_count: (current.sync?.retry_count || 0) + 1, last_error: errorMessage(error) } });
  }
}

async function retryResolveMark(marksKey, mark, daemon, now) {
  try {
    const response = await fetch(markResolveUrl(daemon.base_url, mark), { method: "POST", headers: authorizedHeaders(daemon.token) });
    if (!response.ok) throw new Error(`POST /v1/marks/${mark.id}/resolve failed with ${response.status}`);
    const current = await readStoredMark(marksKey, mark.id);
    if (current) await replaceStoredMark(marksKey, { ...current, sync: { status: "synced", retry_count: current.sync?.retry_count || 0, last_synced_at: now } });
  } catch (error) {
    const current = await readStoredMark(marksKey, mark.id);
    if (current) await replaceStoredMark(marksKey, { ...current, sync: { status: "failed", retry_count: (current.sync?.retry_count || 0) + 1, last_error: errorMessage(error) } });
  }
}

async function reconcileDaemonMarks(marksKey, scope, daemonMarks, preserveMissingIds = []) {
  const stored = await chrome.storage.local.get(marksKey);
  const localMarks = readAnnotationArray(stored?.[marksKey]);
  const preservedMissingIds = new Set(preserveMissingIds);
  const tombstonesKey = projectTombstonesKey(scope.project_id);
  const tombstones = readStringArray((await chrome.storage.local.get(tombstonesKey))?.[tombstonesKey]);
  const tombstoneIds = new Set(tombstones);
  const scopedDaemonMarks = daemonMarks.filter((mark) => isDaemonMarkForScope(mark, scope) && !tombstoneIds.has(mark.id));
  const daemonIds = new Set(scopedDaemonMarks.map((mark) => mark.id));
  const next = [];
  const tombstonedIds = [];
  for (const localMark of localMarks) {
    if (!isScopeMark(localMark, scope)) {
      next.push(localMark);
      continue;
    }
    if (!daemonIds.has(localMark.id)) {
      if (preservedMissingIds.has(localMark.id) || localMark.sync?.status === "local_only" || localMark.sync?.status === "failed") next.push(localMark);
      else if (localMark.sync?.status === "synced" || localMark.sync?.status === "delete_pending") tombstonedIds.push(localMark.id);
    }
  }
  const byId = new Map(next.map((mark) => [mark.id, mark]));
  for (const daemonMark of scopedDaemonMarks) {
    const local = byId.get(daemonMark.id) || localMarks.find((mark) => mark.id === daemonMark.id);
    if (local && shouldPreserveUnsyncedLocal(local, daemonMark)) {
      byId.set(local.id, local);
      continue;
    }
    byId.set(daemonMark.id, local ? reconcileLocalMark(local, daemonMark) : annotationFromDaemonMark(daemonMark));
  }
  const reconciled = Array.from(byId.values());
  await chrome.storage.local.set({ [marksKey]: reconciled, [tombstonesKey]: upsertTombstones(tombstones, tombstonedIds) });
  return reconciled;
}

function annotationFromDaemonMark(daemonMark) {
  const now = daemonMark.lifecycle.updated_at;
  const selector = daemonMark.target.selector;
  return {
    schema_version: 1,
    id: daemonMark.id,
    project: { ...daemonMark.project },
    target: { locator: { primary: { selector, strategy: "daemon" }, alternates: [], evidence: { tag: daemonMark.target.tag || "unknown", nth_path: selector, parent_chain: [] } }, resolution: { locator_status: daemonMark.target.locator_status, confidence: daemonMark.target.confidence, matched_by: daemonMark.target.matched_by || ["daemon"], resolved_at: now } },
    intent: { comment: daemonMark.intent.comment, kind: daemonMark.intent.kind || "other" },
    context: { element: { tag: daemonMark.target.tag || "unknown", selector_preview: daemonMark.target.selector_preview || selector, ...(daemonMark.target.text === undefined ? {} : { text: daemonMark.target.text }), ...(daemonMark.target.classes === undefined ? {} : { classes: daemonMark.target.classes }) }, viewport: { width: 0, height: 0, dpr: 1 }, position: { x: 0, y: 0, width: 0, height: 0 } },
    sync: { status: "synced", retry_count: 0 },
    media: daemonMark.media || { has_screenshot: false },
    replies: { items: [] },
    lifecycle: { task_status: daemonMark.lifecycle.task_status, created_at: daemonMark.lifecycle.created_at, updated_at: daemonMark.lifecycle.updated_at },
  };
}

function reconcileLocalMark(localMark, daemonMark) {
  return {
    ...localMark,
    intent: { comment: daemonMark.intent.comment, kind: daemonMark.intent.kind || localMark.intent?.kind || "other" },
    target: { ...localMark.target, resolution: { ...localMark.target?.resolution, locator_status: daemonMark.target.locator_status, confidence: daemonMark.target.confidence, matched_by: daemonMark.target.matched_by || [] } },
    lifecycle: { ...localMark.lifecycle, task_status: daemonMark.lifecycle.task_status, updated_at: daemonMark.lifecycle.updated_at, ...(daemonMark.lifecycle.task_status === "resolved" && localMark.lifecycle?.task_resolved_at === undefined ? { task_resolved_at: daemonMark.lifecycle.updated_at } : {}) },
    sync: { status: "synced", retry_count: localMark.sync?.retry_count || 0 },
  };
}

function shouldPreserveUnsyncedLocal(localMark, daemonMark) {
  return (localMark.sync?.status === "local_only" || localMark.sync?.status === "failed") && localMark.lifecycle?.updated_at >= daemonMark.lifecycle?.updated_at;
}

async function replaceStoredMark(marksKey, mark) {
  const stored = await chrome.storage.local.get(marksKey);
  const marks = readAnnotationArray(stored?.[marksKey]);
  const index = marks.findIndex((item) => item.id === mark.id);
  const next = index === -1 ? [...marks, mark] : [...marks.slice(0, index), mark, ...marks.slice(index + 1)];
  await chrome.storage.local.set({ [marksKey]: next });
}

async function deleteStoredMark(marksKey, mark) {
  const stored = await chrome.storage.local.get(marksKey);
  const marks = readAnnotationArray(stored?.[marksKey]);
  const tombstonesKey = projectTombstonesKey(mark.project.project_id);
  const tombstones = readStringArray((await chrome.storage.local.get(tombstonesKey))?.[tombstonesKey]);
  await chrome.storage.local.set({ [marksKey]: marks.filter((item) => item.id !== mark.id), [tombstonesKey]: upsertTombstones(tombstones, [mark.id]) });
}

async function readStoredMark(marksKey, markId) {
  const stored = await chrome.storage.local.get(marksKey);
  return readAnnotationArray(stored?.[marksKey]).find((mark) => mark.id === markId);
}

function isScopeMark(mark, scope) {
  return mark?.project?.project_id === scope.project_id && mark.project.session_id === scope.session_id;
}

function isDaemonMarkForScope(mark, scope) {
  return mark?.project?.project_id === scope.project_id && mark.project.session_id === scope.session_id;
}

function readAnnotationArray(value) {
  return Array.isArray(value) ? value : [];
}

function readStringArray(value) {
  return Array.isArray(value) && value.every((item) => typeof item === "string") ? value : [];
}

function upsertTombstones(tombstones, markIds) {
  if (!markIds.length) return [...tombstones];
  const next = new Set(tombstones);
  for (const markId of markIds) {
    if (typeof markId === "string") next.add(markId);
  }
  return Array.from(next);
}

function projectTombstonesKey(projectId) {
  return `loupe:v1:project:${projectId}:tombstones`;
}

function sessionMarksKey(projectId, sessionId) {
  return `loupe:v1:project:${projectId}:session:${sessionId}:marks`;
}

function markDeleteUrl(baseUrl, mark) {
  const url = new URL(joinDaemonUrl(baseUrl, `/v1/marks/${encodeURIComponent(String(mark.id))}`));
  appendParam(url, "project_id", mark.project?.project_id);
  appendParam(url, "workspace_root_hash", mark.project?.workspace_root_hash);
  appendParam(url, "branch", mark.project?.branch);
  appendParam(url, "origin", mark.project?.origin);
  appendParam(url, "url", mark.project?.url);
  appendParam(url, "route_key", mark.project?.route_key);
  appendParam(url, "session_id", mark.project?.session_id);
  return url.href;
}

function markResolveUrl(baseUrl, mark) {
  const url = new URL(joinDaemonUrl(baseUrl, `/v1/marks/${encodeURIComponent(String(mark.id))}/resolve`));
  appendParam(url, "project_id", mark.project?.project_id);
  appendParam(url, "workspace_root_hash", mark.project?.workspace_root_hash);
  appendParam(url, "branch", mark.project?.branch);
  appendParam(url, "origin", mark.project?.origin);
  appendParam(url, "url", mark.project?.url);
  appendParam(url, "route_key", mark.project?.route_key);
  appendParam(url, "session_id", mark.project?.session_id);
  return url.href;
}

function markListUrl(baseUrl, scope) {
  const url = new URL(joinDaemonUrl(baseUrl, "/v1/marks"));
  appendParam(url, "project_id", scope.project_id);
  appendParam(url, "workspace_root_hash", scope.workspace_root_hash);
  appendParam(url, "branch", scope.branch);
  appendParam(url, "origin", scope.origin);
  appendParam(url, "url", scope.url);
  appendParam(url, "route_key", scope.route_key);
  appendParam(url, "session_id", scope.session_id);
  return url.href;
}

function appendParam(url, key, value) {
  if (value !== undefined) url.searchParams.set(key, value);
}

function authorizedHeaders(token) {
  return { authorization: `${LOUPE_AUTH_SCHEME} ${token}` };
}

function joinDaemonUrl(baseUrl, path) {
  return new URL(path, baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`).href;
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
