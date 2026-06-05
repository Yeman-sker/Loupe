const MESSAGE_TYPES = Object.freeze({
  GET_ORIGIN_AUTH: "loupe.origin_auth.get",
  REQUEST_ORIGIN_AUTH: "loupe.origin_auth.request",
  SERVICE_WORKER_WAKE: "loupe.service_worker.wake",
});

const LOUPE_AUTH_SCHEME = "Bearer";

chrome.runtime.onInstalled.addListener(() => {
  void chrome.storage.session.set({
    loupe_phase: "phase_2_extension_capture",
    exposes_token_to_page: false,
    exposes_page_window_api: false,
  });
});

// Toolbar action is the host-permission grant entry point. action.onClicked is a
// valid MV3 user gesture (unlike a content-script message), so permissions.request
// works here. On grant we reload the tab so the content script re-runs authorized.
if (chrome.action && chrome.action.onClicked) {
  chrome.action.onClicked.addListener((tab) => {
    void handleActionClick(tab);
  });
}

async function handleActionClick(tab) {
  const origin = tabOrigin(tab);
  if (!origin) return;
  const origins = [originPattern(origin)];
  // permissions.request must be the first permission API called from the
  // browser-action gesture. Awaiting permissions.contains first can consume the
  // transient user gesture, so Chrome rejects the request and no prompt appears.
  const granted = await chrome.permissions.request({ origins });
  if (granted && typeof tab?.id === "number") {
    try {
      await chrome.tabs.reload(tab.id);
    } catch (_e) {}
  }
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

  if (message.type === MESSAGE_TYPES.SERVICE_WORKER_WAKE) {
    void handleServiceWorkerWake(message).then(sendResponse, (error) => {
      sendResponse({ ok: false, error: errorMessage(error) });
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

async function handleServiceWorkerWake(message) {
  const now = new Date().toISOString();
  await chrome.storage.session.set(serviceWorkerWakeState(now));

  const scope = wakeScope(message);
  const daemon = wakeDaemon(message);
  if (!scope || !daemon) return { ok: true, reconciled: false, retried: 0, stored: 0 };

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
    return { ok: true, reconciled: true, retried: retryResults.length, stored: merged.length };
  } catch (error) {
    return { ok: true, reconciled: false, retried: retryResults.length, stored: readAnnotationArray((await chrome.storage.local.get(marksKey))?.[marksKey]).length, error: errorMessage(error) };
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
