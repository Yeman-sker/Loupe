(() => {
  const ROOT_ID = "loupe-extension-root";
  const SCHEMA_VERSION = 1;
  const MESSAGE_GET_AUTH = "loupe.origin_auth.get";
  const MESSAGE_SERVICE_WORKER_WAKE = "loupe.service_worker.wake";
  const LOUPE_AUTH_SCHEME = "Bearer";
  const SETTINGS_KEY = "loupe:v1:settings";
  const DAEMON_CONFIG_KEYS = Object.freeze([SETTINGS_KEY, "loupe:v1:daemon", "loupe:daemon", "daemon"]);
  const SESSION_ID_KEY = "loupe:v1:extension:session_id";
  const INTERACTIVE_SELECTOR = [
    "a[href]",
    "button",
    "input:not([type='hidden'])",
    "select",
    "textarea",
    "summary",
    "details",
    "label",
    "[role]",
    "[tabindex]:not([tabindex='-1'])",
    "[contenteditable='true']",
    "main",
    "nav",
    "header",
    "footer",
    "section",
    "article",
    "form",
    "img",
    "svg",
  ].join(",");
  const FOCUSABLE_SELECTOR = [
    "a[href]",
    "button:not([disabled])",
    "input:not([type='hidden']):not([disabled])",
    "select:not([disabled])",
    "textarea:not([disabled])",
    "[tabindex]:not([tabindex='-1'])",
  ].join(",");
  const POINTER_SUPPRESS_MS = 700;
  const RECOVERY_QUIET_MS = 250;
  const RECOVERY_TIMEOUT_MS = 1500;
  const IMPLICIT_ROLES = Object.freeze({
    a: "link",
    button: "button",
    input: "textbox",
    select: "combobox",
    textarea: "textbox",
    nav: "navigation",
    main: "main",
    header: "banner",
    footer: "contentinfo",
    form: "form",
    article: "article",
    section: "region",
    img: "img",
    ul: "list",
    ol: "list",
    li: "listitem",
    table: "table",
    tr: "row",
    td: "cell",
    th: "columnheader",
    summary: "button",
  });

  if (!canBootstrapContentRuntime() || document.getElementById(ROOT_ID)) return;
  void bootstrapAuthorizedContent();

  async function bootstrapAuthorizedContent() {
    const response = await runtimeMessage({ type: MESSAGE_GET_AUTH, origin: location.origin });
    if (!isAuthorizedOriginResponse(response) || document.getElementById(ROOT_ID)) return;
    startAuthorizedContent();
  }

  function startAuthorizedContent() {
    const state = {
    authorized: false,
    fullAppInitialized: false,
    picking: false,
    currentTarget: null,
    previousFocus: null,
    childStack: [],
    marks: [],
    showClosed: false,
    showOtherScopes: false,
    pins: new Map(),
    project: null,
    sessionId: "",
    panelOpen: false,
    suppressedPointer: null,
    dialogFocusReturn: null,
    recoveryEpoch: 0,
    recoveryQuietTimer: 0,
    recoveryTimeoutTimer: 0,
    recoveryObservedRouteKey: "",
    recoveryObserver: null,
    lastDaemonRefreshAt: 0,
    refreshingFromDaemon: false,
  };

  const host = document.createElement("div");
  host.id = ROOT_ID;
  host.dataset.loupeRoot = "true";
  host.style.all = "initial";
  host.style.position = "fixed";
  host.style.zIndex = "2147483647";
  host.style.inset = "0";
  host.style.pointerEvents = "none";
  const shadow = host.attachShadow({ mode: "closed" });
  document.documentElement.append(host);

  const style = document.createElement("style");
  style.textContent = `
    :host{all:initial;color-scheme:light dark;}
    *,*::before,*::after{box-sizing:border-box;}
    .loupe{font:13px/1.4 ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#172033;}
    button,textarea,select{font:inherit;}
    button{border:0;border-radius:8px;background:#172033;color:#fff;padding:7px 10px;cursor:pointer;}
    button.secondary{background:#eef2f7;color:#172033;border:1px solid #cfd8e3;}
    button.danger{background:#a51d2d;color:#fff;}
    button.ghost{background:transparent;color:#172033;border:1px solid #cfd8e3;}
    button:focus-visible,textarea:focus-visible,select:focus-visible{outline:2px solid #3b82f6;outline-offset:2px;}
    .launcher{position:fixed;right:16px;bottom:16px;width:310px;pointer-events:auto;background:#fff;border:1px solid rgba(15,23,42,.16);border-radius:14px;box-shadow:0 14px 40px rgba(15,23,42,.18);padding:12px;}
    .launcher header,.panel header,.detail header{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:8px;}
    .brand{font-weight:700;letter-spacing:.01em;}
    .muted{color:#5b677a;font-size:12px;}
    .row{display:flex;gap:8px;align-items:center;flex-wrap:wrap;}
    .status{margin-top:8px;color:#475569;font-size:12px;}
    .highlight{position:fixed;pointer-events:none;border:2px solid #3b82f6;background:rgba(59,130,246,.12);box-shadow:0 0 0 99999px rgba(15,23,42,.06);border-radius:4px;}
    .measure{position:fixed;pointer-events:none;background:#172033;color:#fff;border-radius:6px;padding:4px 6px;font:12px/1.2 ui-monospace,SFMono-Regular,Menlo,monospace;white-space:nowrap;}
    .breadcrumb{position:fixed;left:16px;bottom:16px;max-width:min(760px,calc(100vw - 32px));pointer-events:none;background:#172033;color:#fff;border-radius:10px;padding:8px 10px;font:12px/1.35 ui-monospace,SFMono-Regular,Menlo,monospace;box-shadow:0 12px 30px rgba(15,23,42,.22);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
    .composer,.detail,.panel{position:fixed;pointer-events:auto;background:#fff;color:#172033;border:1px solid rgba(15,23,42,.16);border-radius:14px;box-shadow:0 18px 48px rgba(15,23,42,.22);padding:12px;}
    .composer{width:330px;}
    .composer textarea{width:100%;min-height:96px;resize:vertical;border:1px solid #cfd8e3;border-radius:10px;padding:9px;color:#172033;background:#fff;}
    .composer select{border:1px solid #cfd8e3;border-radius:8px;background:#fff;color:#172033;padding:6px;}
    .error{color:#b42318;font-size:12px;margin-top:6px;}
    .pin{position:fixed;pointer-events:auto;transform:translate(-50%,-100%);min-width:28px;height:28px;border-radius:999px;background:#2563eb;color:#fff;border:2px solid #fff;box-shadow:0 8px 24px rgba(15,23,42,.25);font-weight:800;display:grid;place-items:center;cursor:pointer;}
    .pin[data-status="resolved"]{background:#15803d;}
    .pin[data-status="archived"]{background:#64748b;}
    .pin small{position:absolute;left:24px;top:-6px;background:#172033;color:#fff;border-radius:6px;padding:2px 5px;font-size:10px;font-weight:600;white-space:nowrap;}
    .detail{width:330px;max-width:calc(100vw - 24px);}
    .detail dl{display:grid;grid-template-columns:105px 1fr;gap:5px 8px;margin:8px 0;font-size:12px;}
    .detail dt{color:#64748b;}
    .detail dd{margin:0;overflow-wrap:anywhere;}
    .panel{right:16px;top:16px;width:420px;max-width:calc(100vw - 32px);max-height:calc(100vh - 32px);display:flex;flex-direction:column;}
    .marks{overflow:auto;display:grid;gap:8px;padding-right:2px;}
    .mark-group{border:1px solid #d7dee8;border-radius:12px;padding:8px;background:#fff;display:grid;gap:8px;}
    .mark-group header{display:block;margin:0;color:#334155;}
    .mark-group[data-current="true"]{border-color:#93c5fd;background:#eff6ff;}
    .mark{border:1px solid #d7dee8;border-radius:10px;padding:8px;background:#f8fafc;}
    .mark strong{display:block;margin-bottom:3px;}
    .mark p{margin:4px 0;color:#334155;}
    .kbd{font:11px ui-monospace,SFMono-Regular,Menlo,monospace;background:#eef2f7;border:1px solid #d7dee8;border-radius:5px;padding:1px 4px;}
    @media (prefers-reduced-motion:no-preference){.launcher,.composer,.panel,.detail{animation:loupe-pop 120ms ease-out;}@keyframes loupe-pop{from{opacity:.7;transform:translateY(3px)}to{opacity:1;transform:translateY(0)}}}
    @media (prefers-color-scheme:dark){.launcher,.composer,.panel,.detail{background:#101827;color:#e5e7eb;border-color:#334155}.muted,.status,.detail dt{color:#a3afc2}button.secondary,button.ghost{background:#1e293b;color:#e5e7eb;border-color:#475569}.composer textarea,.composer select{background:#0f172a;color:#e5e7eb;border-color:#475569}.mark{background:#111c2d;border-color:#334155}.mark p{color:#cbd5e1}.kbd{background:#1e293b;border-color:#475569}}
  `;
  const app = document.createElement("div");
  app.className = "loupe";
  shadow.append(style, app);

  boot();

  function boot() {
    state.authorized = true;
    state.sessionId = getOrCreateSessionId();
    state.project = projectScope();
    void initializeFullPickerApp().then(() => renderShell());
  }

  async function initializeFullPickerApp() {
    if (state.fullAppInitialized) return;
    state.fullAppInitialized = true;
    document.addEventListener("keydown", onDocumentKeyDown, true);
    document.addEventListener("pointermove", onPointerMove, true);
    document.addEventListener("pointerdown", blockHostPointerWhilePicking, true);
    document.addEventListener("pointerup", blockHostPointerWhilePicking, true);
    document.addEventListener("click", blockHostPointerWhilePicking, true);
    window.addEventListener("resize", repositionPins, { passive: true });
    window.addEventListener("popstate", handleRouteChange, true);
    window.addEventListener("hashchange", handleRouteChange, true);
    patchHistoryMethod("pushState");
    patchHistoryMethod("replaceState");
    window.addEventListener("scroll", repositionPins, { passive: true, capture: true });
    installStorageChangeListener();
    observeDomForRecovery();
    await loadMarks();
    void refreshFromDaemon("boot");
  }

  function renderShell(status = "") {
    removeByClass("launcher");
    const box = document.createElement("section");
    box.className = "launcher";
    box.setAttribute("role", "dialog");
    box.setAttribute("aria-label", "Loupe capture controls");
    box.innerHTML = `
      <header><span class="brand">Loupe</span><span class="muted">Alt/Option+L</span></header>
      <div class="muted">Project: ${escapeHtml(state.project.project_id)}</div>
      <div class="row" style="margin-top:10px"></div>
      <div class="status" role="status"></div>
    `;
    const row = box.querySelector(".row");
    const statusEl = box.querySelector(".status");
    row.append(button(state.picking ? "Exit picker" : "Pick element", state.picking ? stopPicking : startPicking));
    row.append(button("View all", openPanel, "secondary"));
    row.append(button("Copy Markdown", () => copyMarkdown(), "ghost"));
    statusEl.textContent = status || `${openMarks().length} open local mark${openMarks().length === 1 ? "" : "s"}.`;
    app.append(box);
  }

  function startPicking() {
    if (!state.authorized) {
      renderShell("Authorize this origin before picking.");
      return;
    }
    closeFloating();
    state.picking = true;
    state.previousFocus = activeElementDeep();
    state.childStack = [];
    setCurrentTarget(initialTarget());
    renderShell("Picking: Tab cycles, Enter confirms, Esc cancels, ↑ parent, ↓ child.");
  }

  function stopPicking({ restoreFocus = true } = {}) {
    state.picking = false;
    state.childStack = [];
    removePickerOverlay();
    renderShell();
    if (restoreFocus) restorePreviousFocus();
  }

  function onDocumentKeyDown(event) {
    if (event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey && event.code === "KeyL") {
      event.preventDefault();
      event.stopPropagation();
      state.picking ? stopPicking() : startPicking();
      return;
    }

    if (isInsideExtension(event.target)) return;

    if (!state.picking) return;
    const handled = handlePickerKey(event);
    if (handled) {
      event.preventDefault();
      event.stopPropagation();
    }
  }

  function handlePickerKey(event) {
    if (event.key === "Escape") {
      stopPicking();
      return true;
    }
    if (event.key === "Enter") {
      if (state.currentTarget) confirmTarget(state.currentTarget);
      return true;
    }
    if (event.key === "Tab") {
      const candidates = visibleCandidates();
      if (candidates.length === 0) return true;
      const index = Math.max(0, candidates.indexOf(state.currentTarget));
      const next = candidates[(index + (event.shiftKey ? -1 : 1) + candidates.length) % candidates.length];
      state.childStack = [];
      setCurrentTarget(next);
      return true;
    }
    if (event.key === "ArrowUp") {
      const parent = annotatableParent(state.currentTarget);
      if (parent) {
        state.childStack.push(state.currentTarget);
        setCurrentTarget(parent);
      }
      return true;
    }
    if (event.key === "ArrowDown") {
      const priorChild = state.childStack.pop();
      if (priorChild && isVisible(priorChild) && !isInsideExtension(priorChild)) {
        setCurrentTarget(priorChild);
        return true;
      }
      const child = closestVisibleChild(state.currentTarget);
      if (child) setCurrentTarget(child);
      return true;
    }
    return false;
  }

  function onPointerMove(event) {
    if (!state.picking) return;
    const target = pickTargetFromEvent(event);
    if (target && target !== state.currentTarget) {
      state.childStack = [];
      setCurrentTarget(target);
    }
  }

  function blockHostPointerWhilePicking(event) {
    if (shouldSuppressHostPointer(event)) {
      event.preventDefault();
      event.stopImmediatePropagation();
      return;
    }
    if (!state.picking) return;
    if (isInsideExtension(event.target)) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    if (event.type === "pointerdown") {
      const target = pickTargetFromEvent(event);
      if (target) {
        suppressPointerSequence(event, target);
        confirmTarget(target);
      }
    }
  }

  function suppressPointerSequence(event, target) {
    state.suppressedPointer = { pointerId: event.pointerId, target, deadline: performance.now() + POINTER_SUPPRESS_MS };
  }

  function shouldSuppressHostPointer(event) {
    const suppressed = state.suppressedPointer;
    if (!suppressed) return false;
    if (performance.now() > suppressed.deadline) {
      state.suppressedPointer = null;
      return false;
    }
    if (isInsideExtension(event.target)) return false;
    const samePointer = event.pointerId == null || suppressed.pointerId == null || event.pointerId === suppressed.pointerId;
    const sameTarget = event.target === suppressed.target || (event.target instanceof Node && suppressed.target.contains(event.target));
    if (samePointer || sameTarget || event.type === "click") {
      if (event.type === "click") state.suppressedPointer = null;
      return true;
    }
    return false;
  }

  function pickTargetFromEvent(event) {
    const path = typeof event.composedPath === "function" ? event.composedPath() : [];
    for (const item of path) {
      if (item instanceof Element && !isInsideExtension(item) && isVisible(item)) return item;
    }
    const element = document.elementFromPoint(event.clientX, event.clientY);
    return element && !isInsideExtension(element) && isVisible(element) ? element : null;
  }

  function setCurrentTarget(element) {
    state.currentTarget = element;
    renderPickerOverlay(element);
  }

  function renderPickerOverlay(element) {
    removePickerOverlay();
    if (!element) return;
    const rect = element.getBoundingClientRect();
    const highlight = document.createElement("div");
    highlight.className = "highlight";
    highlight.style.left = `${Math.max(0, rect.left)}px`;
    highlight.style.top = `${Math.max(0, rect.top)}px`;
    highlight.style.width = `${Math.max(0, rect.width)}px`;
    highlight.style.height = `${Math.max(0, rect.height)}px`;

    const measure = document.createElement("div");
    measure.className = "measure";
    measure.textContent = `${Math.round(rect.width)}×${Math.round(rect.height)} ${boxModelSummary(element)}`;
    const labelPos = placeNearRect(rect, 260, 28, 8);
    measure.style.left = `${labelPos.left}px`;
    measure.style.top = `${labelPos.top}px`;

    const crumb = document.createElement("div");
    crumb.className = "breadcrumb";
    crumb.textContent = breadcrumb(element);

    app.append(highlight, measure, crumb);
  }

  function removePickerOverlay() {
    removeByClass("highlight");
    removeByClass("measure");
    removeByClass("breadcrumb");
  }

  function confirmTarget(element) {
    stopPicking({ restoreFocus: false });
    openComposer(element);
  }

  function openComposer(element) {
    closeFloating();
    const rect = element.getBoundingClientRect();
    const pos = placeNearRect(rect, 330, 230, 10);
    const composer = document.createElement("section");
    composer.className = "composer";
    composer.setAttribute("role", "dialog");
    composer.setAttribute("aria-modal", "true");
    composer.setAttribute("aria-label", "Loupe annotation composer");
    composer.style.left = `${pos.left}px`;
    composer.style.top = `${pos.top}px`;
    composer.innerHTML = `
      <header><strong>Annotate ${escapeHtml(selectorPreview(element))}</strong><button class="secondary" type="button" data-action="cancel" aria-label="Cancel annotation">Esc</button></header>
      <label class="muted" for="loupe-kind">Kind</label>
      <select id="loupe-kind" aria-label="Annotation kind">
        <option value="other" selected>Other</option><option value="bug">Bug</option><option value="copy">Copy</option><option value="style">Style</option><option value="layout">Layout</option><option value="question">Question</option>
      </select>
      <div style="height:8px"></div>
      <label class="muted" for="loupe-comment">Required comment</label>
      <textarea id="loupe-comment" aria-label="Annotation comment" required placeholder="Describe what an agent should do here…"></textarea>
      <div class="error" role="alert" hidden>Comment is required.</div>
      <div class="row" style="margin-top:10px"><button type="button" data-action="save">Save</button><button class="secondary" type="button" data-action="cancel">Cancel</button><span class="muted"><span class="kbd">⌘/Ctrl</span>+<span class="kbd">Enter</span></span></div>
    `;
    const textarea = composer.querySelector("textarea");
    const select = composer.querySelector("select");
    const error = composer.querySelector(".error");
    composer.addEventListener("click", (event) => {
      const action = event.target?.dataset?.action;
      if (action === "cancel") cancelComposer();
      if (action === "save") void saveFromComposer(element, textarea, select, error);
    });
    composer.addEventListener("keydown", (event) => {
      if (trapDialogTab(event, composer)) return;
      if (event.key === "Escape") {
        event.preventDefault();
        cancelComposer();
      } else if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        void saveFromComposer(element, textarea, select, error);
      }
    });
    app.append(composer);
    textarea.focus({ preventScroll: true });
  }

  function cancelComposer() {
    closeFloating();
    restorePreviousFocus();
  }

  async function saveFromComposer(element, textarea, select, error) {
    const comment = textarea.value.trim();
    if (!comment) {
      error.hidden = false;
      textarea.setAttribute("aria-invalid", "true");
      textarea.focus();
      return;
    }
    const mark = createAnnotation(element, comment, select.value || "other");
    state.marks.push(mark);
    await persistMarks();
    closeFloating();
    renderPins();
    renderShell("Saved local_only mark.");
    restorePreviousFocus();
    void syncSavedMark(mark);
  }

  function createAnnotation(element, comment, kind) {
    const locator = captureLocator(element);
    const resolved = resolveLocator(locator, document);
    const rect = element.getBoundingClientRect();
    const computed = getComputedStyle(element);
    const now = new Date().toISOString();
    return {
      schema_version: SCHEMA_VERSION,
      id: createId(),
      project: state.project,
      target: {
        locator,
        resolution: {
          locator_status: resolved.locator_status,
          confidence: resolved.confidence,
          matched_by: resolved.matched_by,
          candidates_considered: resolved.candidates_considered,
          resolved_at: now,
        },
      },
      intent: { comment, kind },
      context: {
        element: elementContext(element),
        a11y: a11yContext(element),
        layout: {
          display: computed.display,
          position: computed.position,
          box_sizing: computed.boxSizing,
          flex_direction: computed.flexDirection,
          gap: computed.gap,
        },
        framework: frameworkContext(element),
        viewport: { width: window.innerWidth, height: window.innerHeight, dpr: window.devicePixelRatio || 1 },
        position: { x: round(rect.left + window.scrollX), y: round(rect.top + window.scrollY), width: round(rect.width), height: round(rect.height) },
      },
      sync: { status: "local_only", retry_count: 0 },
      media: { has_screenshot: false },
      replies: { items: [] },
      lifecycle: { task_status: "open", created_at: now, updated_at: now },
    };
  }
  async function loadMarks() {
    const sessionIds = await projectSessionIds();
    const keys = sessionIds.map((sessionId) => sessionMarksKey(state.project.project_id, sessionId));
    const stored = keys.length ? await chrome.storage.local.get(keys) : {};
    applyStoredMarks(stored, sessionIds);
    scheduleMarkRecovery("load");
    renderShell();
  }

  function applyStoredMarks(stored, sessionIds) {
    const loaded = [];
    for (const sessionId of sessionIds) {
      const key = sessionMarksKey(state.project.project_id, sessionId);
      const marks = stored?.[key];
      if (!Array.isArray(marks)) continue;
      for (const mark of marks) {
        if (mark && !mark.lifecycle?.deleted_at) loaded.push(normalizeMarkProject(mark, state.project.project_id, sessionId));
      }
    }
    state.marks = loaded;
  }

  function applyStorageMarkChanges(changes) {
    if (!changes || typeof changes !== "object") return false;
    const prefix = `loupe:v1:project:${state.project.project_id}:session:`;
    const suffix = ":marks";
    let changed = false;
    const byId = new Map(state.marks.map((mark) => [mark.id, mark]));
    for (const key in changes) {
      if (!Object.prototype.hasOwnProperty.call(changes, key)) continue;
      if (!key.startsWith(prefix) || !key.endsWith(suffix)) continue;
      const sessionId = key.slice(prefix.length, -suffix.length);
      if (!sessionId) continue;
      for (const mark of byId.values()) {
        if (mark.project?.session_id === sessionId) byId.delete(mark.id);
      }
      const nextValue = changes[key]?.newValue;
      if (Array.isArray(nextValue)) {
        for (const mark of nextValue) {
          if (mark && !mark.lifecycle?.deleted_at) byId.set(mark.id, normalizeMarkProject(mark, state.project.project_id, sessionId));
        }
      }
      changed = true;
    }
    if (changed) state.marks = Array.from(byId.values());
    return changed;
  }

  function refreshRenderedMarks() {
    renderPins();
    if (state.panelOpen) {
      const list = app.querySelector(".panel .marks");
      if (list) renderPanelList(list);
    }
    renderShell();
  }

  function installStorageChangeListener() {
    const onChanged = chrome.storage?.onChanged;
    if (!onChanged || typeof onChanged.addListener !== "function") return;
    onChanged.addListener((changes, areaName) => {
      if (areaName !== "local" || !applyStorageMarkChanges(changes)) return;
      scheduleMarkRecovery("storage");
      refreshRenderedMarks();
    });
  }

  async function refreshFromDaemon(reason) {
    if (state.refreshingFromDaemon) return;
    const now = Date.now();
    if (reason !== "boot" && now - state.lastDaemonRefreshAt < 1000) return;
    const daemon = await readDaemonConfig();
    if (!daemon) return;
    state.refreshingFromDaemon = true;
    state.lastDaemonRefreshAt = now;
    try {
      await runtimeMessage({ type: MESSAGE_SERVICE_WORKER_WAKE, scope: state.project, daemon });
      await loadMarks();
      refreshRenderedMarks();
    } finally {
      state.refreshingFromDaemon = false;
    }
  }

  async function projectSessionIds() {
    const key = sessionsIndexKey();
    const stored = await chrome.storage.local.get(key);
    const ids = Array.isArray(stored?.[key]) ? stored[key].filter((id) => typeof id === "string" && id) : [];
    if (!ids.includes(state.sessionId)) ids.push(state.sessionId);
    return ids;
  }

  async function ensureCurrentSessionIndexed() {
    const key = sessionsIndexKey();
    const stored = await chrome.storage.local.get(key);
    const ids = Array.isArray(stored?.[key]) ? stored[key].filter((id) => typeof id === "string" && id) : [];
    if (ids.includes(state.sessionId)) return;
    await chrome.storage.local.set({ [key]: [...ids, state.sessionId] });
  }

  async function persistMarks() {
    await ensureCurrentSessionIndexed();
    await persistSessionProject(state.project.project_id, state.sessionId);
  }

  async function persistMarkSession(mark) {
    const project = markProject(mark);
    await persistSessionProject(project.project_id, project.session_id);
  }

  async function persistSessionProject(projectId, sessionId) {
    const marks = state.marks.filter((item) => {
      const itemProject = markProject(item);
      return itemProject.project_id === projectId && itemProject.session_id === sessionId && !item.lifecycle?.deleted_at;
    });
    await chrome.storage.local.set({ [sessionMarksKey(projectId, sessionId)]: marks });
  }

  async function removeStoredMark(marksKey, markId) {
    const stored = await chrome.storage.local.get(marksKey);
    const marks = Array.isArray(stored?.[marksKey]) ? stored[marksKey] : [];
    await chrome.storage.local.set({ [marksKey]: marks.filter((item) => item.id !== markId) });
  }

  async function syncDeletedMark(mark) {
    const daemon = await readDaemonConfig();
    if (!daemon) return false;
    const marksKey = sessionMarksKey(mark.project.project_id, mark.project.session_id);
    await replaceStoredMark(marksKey, { ...mark, sync: { status: "delete_pending", retry_count: mark.sync?.retry_count || 0 } });
    try {
      const response = await fetch(markDeleteUrl(daemon.base_url, mark), {
        method: "DELETE",
        headers: { authorization: `${LOUPE_AUTH_SCHEME} ${daemon.token}` },
      });
      if (!response.ok) throw new Error(`DELETE /v1/marks/${mark.id} failed with ${response.status}`);
      await removeStoredMark(marksKey, mark.id);
      return true;
    } catch (error) {
      const current = (await readStoredMark(marksKey, mark.id)) || mark;
      await replaceStoredMark(marksKey, { ...current, sync: { status: "delete_pending", retry_count: (current.sync?.retry_count || 0) + 1, last_error: errorMessage(error) } });
      return false;
    }
  }

  async function syncSavedMark(mark) {
    const daemon = await readDaemonConfig();
    if (!daemon) return;
    const marksKey = sessionMarksKey(mark.project.project_id, mark.project.session_id);
    await replaceStoredMark(marksKey, { ...mark, sync: { status: "syncing", retry_count: mark.sync?.retry_count || 0 } });
    try {
      const response = await fetch(joinDaemonUrl(daemon.base_url, "/v1/marks"), {
        method: "POST",
        headers: { authorization: `${LOUPE_AUTH_SCHEME} ${daemon.token}`, "content-type": "application/json" },
        body: JSON.stringify(mark),
      });
      if (!response.ok) throw new Error(`POST /v1/marks failed with ${response.status}`);
      const current = (await readStoredMark(marksKey, mark.id)) || mark;
      if (current.lifecycle?.updated_at !== mark.lifecycle?.updated_at) return;
      await replaceStoredMark(marksKey, { ...current, sync: { status: "synced", retry_count: current.sync?.retry_count || 0, last_synced_at: new Date().toISOString() } });
    } catch (error) {
      const current = (await readStoredMark(marksKey, mark.id)) || mark;
      await replaceStoredMark(marksKey, { ...current, sync: { status: "failed", retry_count: (current.sync?.retry_count || 0) + 1, last_error: errorMessage(error) } });
    }
    renderPins();
    if (state.panelOpen) {
      const list = app.querySelector(".panel .marks");
      if (list) renderPanelList(list);
    }
    renderShell();
  }

  async function replaceStoredMark(marksKey, mark) {
    const stored = await chrome.storage.local.get(marksKey);
    const marks = Array.isArray(stored?.[marksKey]) ? stored[marksKey] : [];
    const index = marks.findIndex((item) => item.id === mark.id);
    const next = index === -1 ? [...marks, mark] : [...marks.slice(0, index), mark, ...marks.slice(index + 1)];
    const localIndex = state.marks.findIndex((item) => item.id === mark.id);
    if (mark.lifecycle?.deleted_at) state.marks = state.marks.filter((item) => item.id !== mark.id);
    else if (localIndex === -1) state.marks.push(mark);
    else state.marks = [...state.marks.slice(0, localIndex), mark, ...state.marks.slice(localIndex + 1)];
    await chrome.storage.local.set({ [marksKey]: next });
  }

  async function readStoredMark(marksKey, markId) {
    const stored = await chrome.storage.local.get(marksKey);
    return (Array.isArray(stored?.[marksKey]) ? stored[marksKey] : []).find((mark) => mark.id === markId);
  }

  async function readDaemonConfig() {
    const sessionConfig = await readDaemonConfigFromArea(chrome.storage.session);
    if (sessionConfig) return sessionConfig;
    return readDaemonConfigFromArea(chrome.storage.local);
  }

  async function readDaemonConfigFromArea(area) {
    if (!area || typeof area.get !== "function") return null;
    try {
      const stored = await area.get(DAEMON_CONFIG_KEYS);
      return daemonConfigFromStored(stored);
    } catch {
      return null;
    }
  }

  function daemonConfigFromStored(stored) {
    if (!stored || typeof stored !== "object") return null;
    for (const key of DAEMON_CONFIG_KEYS) {
      const config = daemonConfigFromValue(stored[key]);
      if (config) return config;
    }
    return daemonConfigFromValue(stored);
  }

  function daemonConfigFromValue(value) {
    if (!value || typeof value !== "object") return null;
    const candidate = value.daemon && typeof value.daemon === "object" ? value.daemon : value;
    const baseUrl = typeof candidate.base_url === "string" ? candidate.base_url : typeof candidate.daemon_base_url === "string" ? candidate.daemon_base_url : "";
    const token = typeof candidate.token === "string" ? candidate.token : typeof candidate.daemon_token === "string" ? candidate.daemon_token : "";
    return baseUrl && token ? { base_url: baseUrl, token } : null;
  }

  function markDeleteUrl(baseUrl, mark) {
    const url = new URL(joinDaemonUrl(baseUrl, `/v1/marks/${encodeURIComponent(mark.id)}`));
    appendParam(url, "project_id", mark.project.project_id);
    appendParam(url, "workspace_root_hash", mark.project.workspace_root_hash);
    appendParam(url, "branch", mark.project.branch);
    appendParam(url, "origin", mark.project.origin);
    appendParam(url, "url", mark.project.url);
    appendParam(url, "route_key", mark.project.route_key);
    appendParam(url, "session_id", mark.project.session_id);
    return url.href;
  }

  function appendParam(url, key, value) {
    if (value !== undefined) url.searchParams.set(key, value);
  }

  function joinDaemonUrl(baseUrl, path) {
    return new URL(path, baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`).href;
  }

  function errorMessage(error) {
    return error instanceof Error ? error.message : String(error);
  }

  function normalizeMarkProject(mark, projectId = state.project.project_id, sessionId = state.sessionId) {
    const project = mark.project || {};
    mark.project = {
      ...state.project,
      ...project,
      project_id: project.project_id || projectId,
      session_id: project.session_id || sessionId,
      route_key: project.route_key || state.project.route_key,
    };
    return mark;
  }

  function markProject(mark) {
    return normalizeMarkProject(mark).project;
  }

  async function writeTombstone(mark) {
    const key = tombstonesKey();
    const stored = await chrome.storage.local.get(key);
    const tombstones = Array.isArray(stored?.[key]) ? stored[key] : [];
    if (!tombstones.includes(mark.id)) tombstones.push(mark.id);
    await chrome.storage.local.set({ [key]: tombstones });
  }

  function renderPins() {
    if (!state.fullAppInitialized) return;
    renderPinsForResolvedMarks({ commit: true, epoch: state.recoveryEpoch, routeKey: state.project.route_key });
  }

  function repositionPins() {
    if (!state.fullAppInitialized) return;
    renderPinsForResolvedMarks({ commit: false, epoch: state.recoveryEpoch, routeKey: state.project.route_key });
  }

  function renderPinsForResolvedMarks({ commit, epoch, routeKey }) {
    for (const pin of state.pins.values()) pin.remove();
    state.pins.clear();
    state.marks.forEach((mark, index) => {
      if (!isCurrentRouteMark(mark) || mark.lifecycle?.deleted_at) return;
      const result = resolveLocator(mark.target.locator, document);
      if (!result.element || !isVisible(result.element)) return;
      const rect = result.element.getBoundingClientRect();
      const pin = document.createElement("button");
      pin.className = "pin";
      pin.type = "button";
      pin.dataset.status = mark.lifecycle.task_status;
      pin.setAttribute("aria-label", `Loupe mark ${index + 1}: ${mark.lifecycle.task_status}, ${result.locator_status}, ${mark.sync.status}`);
      pin.style.left = `${rect.left + rect.width / 2}px`;
      pin.style.top = `${rect.top}px`;
      pin.textContent = String(index + 1);
      const status = document.createElement("small");
      status.textContent = `${mark.lifecycle.task_status} · ${result.locator_status} ${Math.round(result.confidence * 100)}% · ${mark.sync.status}`;
      pin.append(status);
      pin.addEventListener("click", () => openDetail(mark, pin));
      app.append(pin);
      state.pins.set(mark.id, pin);
      if (commit) commitMarkResolution(mark, result, epoch, routeKey);
    });
  }

  function commitMarkResolution(mark, result, epoch, routeKey) {
    if (epoch !== state.recoveryEpoch || routeKey !== state.project.route_key || markProject(mark).route_key !== routeKey) return false;
    mark.target.resolution = {
      locator_status: result.locator_status,
      confidence: result.confidence,
      matched_by: result.matched_by,
      candidates_considered: result.candidates_considered,
      resolved_at: new Date().toISOString(),
    };
    return true;
  }

  function openDetail(mark, anchor) {
    closeFloating();
    const rect = anchor.getBoundingClientRect();
    const pos = placeNearRect(rect, 330, 255, 8);
    const detail = document.createElement("section");
    detail.className = "detail";
    detail.setAttribute("role", "dialog");
    detail.setAttribute("aria-label", "Loupe mark detail");
    detail.style.left = `${pos.left}px`;
    detail.style.top = `${pos.top}px`;
    detail.innerHTML = `
      <header><strong>${escapeHtml(selectorPreviewFromMark(mark))}</strong><button class="secondary" type="button" data-action="close" aria-label="Close mark detail">Esc</button></header>
      <p>${escapeHtml(mark.intent.comment)}</p>
      <dl>
        <dt>Task</dt><dd>${escapeHtml(mark.lifecycle.task_status)}</dd>
        <dt>Locator</dt><dd>${escapeHtml(mark.target.resolution.locator_status)} (${Math.round(mark.target.resolution.confidence * 100)}%)</dd>
        <dt>Sync</dt><dd>${escapeHtml(mark.sync.status)}</dd>
        <dt>Kind</dt><dd>${escapeHtml(mark.intent.kind)}</dd>
      </dl>
      <div class="row"><button type="button" data-action="copy">Copy Markdown</button><button class="secondary" type="button" data-action="resolve">Resolve</button><button class="danger" type="button" data-action="delete">Delete</button></div>
    `;
    detail.addEventListener("click", (event) => void handleMarkAction(event.target?.dataset?.action, mark, anchor));
    detail.addEventListener("keydown", (event) => {
      if (trapDialogTab(event, detail)) return;
      if (event.key === "Escape") {
        event.preventDefault();
        closeFloating({ restoreFocus: anchor });
      }
    });
    app.append(detail);
    detail.querySelector("button")?.focus({ preventScroll: true });
  }

  async function handleMarkAction(action, mark, restoreFocusTo = null) {
    if (action === "close") closeFloating({ restoreFocus: restoreFocusTo });
    if (action === "copy") await copyMarkdown(mark);
    if (action === "resolve") await resolveMark(mark);
    if (action === "delete") await deleteMark(mark);
  }

  async function resolveMark(mark) {
    const reopenPanel = state.panelOpen;
    const focusReturn = state.dialogFocusReturn;
    const now = new Date().toISOString();
    mark.lifecycle.task_status = "resolved";
    mark.lifecycle.task_resolved_at = now;
    mark.lifecycle.updated_at = now;
    await persistMarkSession(mark);
    closeFloating();
    renderPins();
    if (reopenPanel) {
      state.dialogFocusReturn = focusReturn;
      openPanel(true);
    }
    renderShell("Resolved mark locally.");
  }
  async function deleteMark(mark) {
    const reopenPanel = state.panelOpen;
    const focusReturn = state.dialogFocusReturn;
    const project = markProject(mark);
    const now = new Date().toISOString();
    mark.lifecycle.deleted_at = now;
    mark.lifecycle.updated_at = now;
    await writeTombstone(mark);
    state.marks = state.marks.filter((item) => item.id !== mark.id);
    await persistSessionProject(project.project_id, project.session_id);
    const deletedRemotely = await syncDeletedMark(mark);
    closeFloating();
    renderPins();
    if (reopenPanel) {
      state.dialogFocusReturn = focusReturn;
      openPanel(true);
    }
    renderShell(deletedRemotely ? "Deleted mark." : "Deleted mark locally; daemon delete pending.");
  }

  async function openPanel(replace = false) {
    const focusReturn = replace ? state.dialogFocusReturn : activeElementDeep();
    if (replace) removeByClass("panel");
    else closeFloating();
    state.panelOpen = true;
    state.dialogFocusReturn = focusReturn;
    void refreshFromDaemon("panel");
    const panel = document.createElement("section");
    panel.className = "panel";
    panel.setAttribute("role", "dialog");
    panel.setAttribute("aria-label", "Loupe marks list");
    panel.innerHTML = `
      <header><strong>Project marks</strong><button class="secondary" type="button" data-action="close" aria-label="Close marks list">Esc</button></header>
      <label class="muted"><input type="checkbox" data-action="toggle-closed"${state.showClosed ? " checked" : ""}> Show resolved/archived</label>
      <label class="muted"><input type="checkbox" data-action="toggle-scope"${state.showOtherScopes ? " checked" : ""}> Show other sessions/routes</label>
      <div class="row" style="margin:8px 0"><button type="button" data-action="copy">Copy Markdown</button></div>
      <div class="marks" role="list"></div>
    `;
    const list = panel.querySelector(".marks");
    renderPanelList(list);
    panel.addEventListener("click", (event) => {
      const action = event.target?.dataset?.action;
      if (action === "close") {
        state.panelOpen = false;
        closeFloating({ restoreFocus: state.dialogFocusReturn || launcherFocusTarget() });
      } else if (action === "copy") {
        void copyMarkdown();
      } else if (action === "toggle-closed") {
        state.showClosed = event.target.checked;
        renderPanelList(list);
      } else if (action === "toggle-scope") {
        state.showOtherScopes = event.target.checked;
        renderPanelList(list);
      } else if (action === "resolve") {
        const mark = state.marks.find((item) => item.id === event.target.dataset.id);
        if (mark) void resolveMark(mark);
      } else if (action === "delete") {
        const mark = state.marks.find((item) => item.id === event.target.dataset.id);
        if (mark) void deleteMark(mark);
      }
    });
    panel.addEventListener("keydown", (event) => {
      if (trapDialogTab(event, panel)) return;
      if (event.key === "Escape") {
        event.preventDefault();
        state.panelOpen = false;
        closeFloating({ restoreFocus: state.dialogFocusReturn || launcherFocusTarget() });
      }
    });
    app.append(panel);
    panel.querySelector("button")?.focus({ preventScroll: true });
  }

  function renderPanelList(list) {
    list.textContent = "";
    const visible = panelMarks();
    if (visible.length === 0) {
      const empty = document.createElement("p");
      empty.className = "muted";
      const scope = state.showOtherScopes ? "loaded sessions/routes" : "current session";
      empty.textContent = state.showClosed ? `No marks in ${scope}.` : `No open marks in ${scope}.`;
      list.append(empty);
      return;
    }

    let renderedIndex = 0;
    for (const group of groupedMarks(visible)) {
      const section = document.createElement("section");
      section.className = "mark-group";
      section.dataset.current = String(group.current);
      section.setAttribute("role", "group");
      section.setAttribute("aria-label", group.label);
      section.innerHTML = `<header><strong>${escapeHtml(group.current ? "Current route" : "Other route")}</strong><div class="muted">${escapeHtml(group.label)}</div></header>`;
      group.marks.forEach((mark) => {
        renderedIndex += 1;
        const item = document.createElement("article");
        item.className = "mark";
        item.setAttribute("role", "listitem");
        item.innerHTML = `
          <strong>${renderedIndex}. ${escapeHtml(selectorPreviewFromMark(mark))}</strong>
          <p>${escapeHtml(mark.intent.comment)}</p>
          <div class="muted">task=${escapeHtml(mark.lifecycle.task_status)} · route=${escapeHtml(mark.project?.route_key || "unknown")} · session=${escapeHtml(mark.project?.session_id || "unknown")} · locator=${escapeHtml(mark.target.resolution.locator_status)} ${Math.round(mark.target.resolution.confidence * 100)}% · sync=${escapeHtml(mark.sync.status)}</div>
          <div class="row" style="margin-top:7px"><button class="secondary" type="button" data-action="resolve" data-id="${escapeHtml(mark.id)}">Resolve</button><button class="danger" type="button" data-action="delete" data-id="${escapeHtml(mark.id)}">Delete</button></div>
        `;
        section.append(item);
      });
      list.append(section);
    }
  }

  async function copyMarkdown(singleMark = null) {
    const marks = singleMark ? [singleMark] : openMarks();
    const markdown = marksToMarkdown(marks);
    await navigator.clipboard.writeText(markdown);
    renderShell(`Copied ${marks.length} mark${marks.length === 1 ? "" : "s"} as Markdown.`);
  }

  function marksToMarkdown(marks) {
    const title = `# Loupe marks for ${location.origin}${location.pathname}`;
    if (marks.length === 0) return `${title}\n\nNo open marks.`;
    return `${title}\n\n${marks.map((mark, index) => {
      const resolution = mark.target.resolution;
      return [
        `## ${index + 1}. ${mark.id}`,
        `- selector_preview: \`${escapeMarkdownInline(selectorPreviewFromMark(mark))}\``,
        `- task_status: ${mark.lifecycle.task_status}`,
        `- locator_status: ${resolution.locator_status}`,
        `- confidence: ${round(resolution.confidence)}`,
        `- sync.status: ${mark.sync.status}`,
        `- intent.comment: ${escapeMarkdownText(mark.intent.comment)}`,
      ].join("\n");
    }).join("\n\n")}`;
  }

  function openMarks() {
    return state.marks.filter((mark) => isCurrentRouteMark(mark) && mark.lifecycle?.task_status === "open" && !mark.lifecycle?.deleted_at);
  }

  function panelMarks() {
    return state.marks.filter((mark) => !mark.lifecycle?.deleted_at && (state.showClosed || mark.lifecycle.task_status === "open") && (state.showOtherScopes || isCurrentSessionMark(mark)));
  }

  function isCurrentSessionMark(mark) {
    return Boolean(mark?.project && mark.project.project_id === state.project.project_id && mark.project.session_id === state.project.session_id);
  }

  function isCurrentRouteMark(mark) {
    return Boolean(
      mark?.project &&
        mark.project.project_id === state.project.project_id &&
        mark.project.session_id === state.project.session_id &&
        mark.project.route_key === state.project.route_key,
    );
  }

  function groupedMarks(marks) {
    const groups = new Map();
    for (const mark of marks) {
      const project = mark.project || {};
      const route = project.route_key || "unknown";
      const session = project.session_id || "unknown";
      const projectId = project.project_id || "unknown";
      const key = `${projectId}\u0000${session}\u0000${route}`;
      let group = groups.get(key);
      if (!group) {
        group = { current: isCurrentRouteMark(mark), label: `project=${projectId} · session=${session} · route=${route}`, marks: [] };
        groups.set(key, group);
      }
      group.marks.push(mark);
    }
    return Array.from(groups.values()).sort((a, b) => Number(b.current) - Number(a.current) || a.label.localeCompare(b.label));
  }

  // MV3 loads this file directly as a content script, so these local implementations intentionally mirror @loupe-server/shared capture_locator/resolve wire output without exposing a bundled page API.
  function captureLocator(element) {
    const tag = element.localName.toLowerCase();
    const normalizedText = normalizeText(element.textContent || "").slice(0, 160);
    const role = roleOf(element);
    const accessibleName = accessibleNameOf(element, normalizedText);
    const stableAttrs = stableAttributes(element);
    const selectorRoot = rootForSelector(element);
    const evidence = {
      tag,
      nth_path: nthPath(element, selectorRoot),
      parent_chain: parentChain(element),
    };
    const shadowPath = shadowPathFor(element);
    if (shadowPath.length) evidence.shadow_path = shadowPath;
    if (Object.keys(stableAttrs).length > 0) evidence.stable_attrs = stableAttrs;
    if (isStableId(element.id)) evidence.stable_id = element.id;
    if (role) evidence.role = role;
    if (accessibleName) evidence.accessible_name = accessibleName;
    if (element.classList.length > 0) evidence.classes = { stable: stableClasses(element), total: element.classList.length };
    if (normalizedText) evidence.text = { normalized: normalizedText, hash: hashText(normalizedText), length: normalizeText(element.textContent || "").length };
    const rect = element.getBoundingClientRect();
    if (rect.width > 0 && rect.height > 0) evidence.geometry = { x: round(rect.left + window.scrollX), y: round(rect.top + window.scrollY), width: round(rect.width), height: round(rect.height), viewport_width: window.innerWidth, viewport_height: window.innerHeight, dpr: window.devicePixelRatio || 1 };
    const selectors = selectorCascade(element, evidence, selectorRoot);
    return { primary: selectors[0] || { selector: evidence.nth_path, strategy: "nth_path" }, alternates: selectors.slice(1), evidence };
  }

  function resolveLocator(locator, root) {
    const selectors = [locator.primary, ...(locator.alternates || [])];
    const hasShadowPath = Array.isArray(locator.evidence?.shadow_path) && locator.evidence.shadow_path.length > 0;
    const shadowRoot = resolveShadowPath(root, locator.evidence?.shadow_path);
    if (hasShadowPath && !shadowRoot) return { element: null, locator_status: "lost", confidence: 0, matched_by: ["shadow_path_not_found"], candidates_considered: 0 };
    if (shadowRoot) {
      for (const selector of selectors) {
        try {
          const found = shadowRoot.querySelector(selector.selector);
          if (found) return { element: found, locator_status: "resolved", confidence: confidenceFor(found, locator, selector.strategy), matched_by: [`open_shadow_path:${selector.strategy}`], candidates_considered: 1 };
        } catch {}
      }
      return { element: null, locator_status: "lost", confidence: 0, matched_by: ["shadow_path_not_found"], candidates_considered: 0 };
    }
    for (const selector of selectors) {
      try {
        const found = root.querySelector(selector.selector);
        if (found) return { element: found, locator_status: "resolved", confidence: confidenceFor(found, locator, selector.strategy), matched_by: [selector.strategy], candidates_considered: 1 };
      } catch {}
    }
    return { element: null, locator_status: "lost", confidence: 0, matched_by: ["not_found"], candidates_considered: 0 };
  }

  function resolveShadowPath(root, shadowPath) {
    if (!Array.isArray(shadowPath) || shadowPath.length === 0) return null;
    let currentRoot = root;
    for (const selector of shadowPath) {
      if (typeof selector !== "string" || !selector || !currentRoot?.querySelector) return null;
      let hostElement = null;
      try {
        hostElement = currentRoot.querySelector(selector);
      } catch {
        return null;
      }
      if (!hostElement?.shadowRoot) return null;
      currentRoot = hostElement.shadowRoot;
    }
    return currentRoot;
  }

  function shadowPathFor(element) {
    const path = [];
    let root = element.getRootNode?.();
    while (root instanceof ShadowRoot) {
      const hostElement = root.host;
      const parentRoot = hostElement.getRootNode?.() || document;
      const selector = uniqueHostSelector(hostElement, parentRoot);
      if (!selector) return [];
      path.unshift(selector);
      root = parentRoot;
    }
    return path;
  }

  function uniqueHostSelector(element, root) {
    const selectors = [];
    const tag = element.localName.toLowerCase();
    if (isStableId(element.id)) selectors.push(`#${cssEscape(element.id)}`);
    for (const [name, value] of Object.entries(stableAttributes(element))) selectors.push(`${tag}[${name}=${cssString(value)}]`);
    const classes = stableClasses(element);
    if (classes.length) selectors.push(`${tag}.${classes.map(cssEscape).join(".")}`);
    selectors.push(nthPath(element, root));
    for (const selector of selectors) {
      try {
        const matches = root.querySelectorAll(selector);
        if (matches.length === 1 && matches[0] === element) return selector;
      } catch {}
    }
    return null;
  }

  function rootForSelector(element) {
    const root = element.getRootNode?.();
    return root && typeof root.querySelectorAll === "function" ? root : document;
  }

  function selectorCascade(element, evidence, selectorRoot) {
    const selectors = [];
    const seen = new Set();
    const add = (selector, strategy) => {
      if (!selector || seen.has(selector)) return;
      try {
        const matches = selectorRoot.querySelectorAll(selector);
        if (matches.length === 1 && matches[0] === element) {
          selectors.push({ selector, strategy });
          seen.add(selector);
        }
      } catch {}
    };
    const tag = element.localName.toLowerCase();
    if (evidence.stable_id) add(`#${cssEscape(evidence.stable_id)}`, "stable_id");
    for (const [name, value] of Object.entries(evidence.stable_attrs || {})) add(`${tag}[${name}=${cssString(value)}]`, "stable_attr");
    if (evidence.role && evidence.accessible_name) add(`[role=${cssString(evidence.role)}][aria-label=${cssString(evidence.accessible_name)}]`, "role_name");
    if (evidence.classes?.stable?.length) add(`${tag}.${evidence.classes.stable.map(cssEscape).join(".")}`, "stable_class");
    selectors.push({ selector: evidence.nth_path, strategy: "nth_path" });
    return selectors.slice(0, 6);
  }

  function confidenceFor(element, locator, strategy) {
    let score = strategy === "nth_path" ? 0.72 : 0.88;
    if (element.localName.toLowerCase() === locator.evidence.tag) score += 0.08;
    if (locator.evidence.stable_id && element.id === locator.evidence.stable_id) score += 0.08;
    if (locator.evidence.text && normalizeText(element.textContent || "").includes(locator.evidence.text.normalized.slice(0, 32))) score += 0.04;
    return Math.min(1, round(score));
  }

  function stableAttributes(element) {
    const attrs = {};
    for (const name of ["data-testid", "data-cy", "data-qa", "data-component", "name"]) {
      const value = element.getAttribute(name);
      if (value) attrs[name] = value;
    }
    return attrs;
  }

  function stableClasses(element) {
    return Array.from(element.classList).filter((name) => /^[A-Za-z][A-Za-z0-9_-]{2,}$/.test(name) && !/^(active|selected|disabled|hidden|open|closed|hover|focus)$/.test(name)).slice(0, 5);
  }

  function parentChain(element) {
    const chain = [];
    let node = element.parentElement;
    for (let depth = 0; node && depth < 4; depth += 1, node = node.parentElement) {
      chain.push({ tag: node.localName.toLowerCase(), nth: elementIndex(node), id: isStableId(node.id) ? node.id : undefined, classes: stableClasses(node) });
    }
    return chain;
  }

  function nthPath(element, root = document) {
    const parts = [];
    let node = element;
    while (node && node.nodeType === Node.ELEMENT_NODE && node !== document.documentElement && node.getRootNode?.() === root) {
      const tag = node.localName.toLowerCase();
      parts.unshift(`${tag}:nth-of-type(${elementIndex(node)})`);
      node = node.parentElement;
    }
    return root === document ? `html > ${parts.join(" > ")}` : parts.join(" > ");
  }

  function elementIndex(element) {
    let index = 1;
    let sibling = element.previousElementSibling;
    while (sibling) {
      if (sibling.localName === element.localName) index += 1;
      sibling = sibling.previousElementSibling;
    }
    return index;
  }

  function elementContext(element) {
    const text = normalizeText(element.textContent || "");
    const context = { tag: element.localName.toLowerCase(), selector_preview: selectorPreview(element) };
    if (element.id) context.id = element.id;
    const role = roleOf(element);
    if (role) context.role = role;
    const name = accessibleNameOf(element, text);
    if (name) context.accessible_name = name;
    const classes = Array.from(element.classList).slice(0, 12);
    if (classes.length) context.classes = classes;
    if (text) context.text = text.slice(0, 240);
    return context;
  }

  function a11yContext(element) {
    const role = roleOf(element);
    const label = accessibleNameOf(element, normalizeText(element.textContent || ""));
    const describedBy = element.getAttribute("aria-describedby") || undefined;
    const tabIndex = element.hasAttribute("tabindex") ? Number(element.getAttribute("tabindex")) : undefined;
    const expanded = element.getAttribute("aria-expanded");
    return {
      ...(role ? { role } : {}),
      ...(label ? { label } : {}),
      ...(describedBy ? { described_by: describedBy } : {}),
      ...(Number.isFinite(tabIndex) ? { tab_index: tabIndex } : {}),
      ...(expanded === null ? {} : { expanded: expanded === "true" }),
    };
  }

  function frameworkContext(element) {
    let node = element;
    while (node) {
      for (const key of Object.keys(node)) {
        if (key.startsWith("__reactFiber$") || key.startsWith("__reactProps$")) return { name: "react" };
        if (key.startsWith("__vueParentComponent")) return { name: "vue" };
      }
      node = node.parentElement;
    }
    if (document.querySelector("[ng-version]")) return { name: "angular" };
    if (document.querySelector("[data-svelte-h]")) return { name: "svelte" };
    return { name: "unknown" };
  }

  function visibleCandidates() {
    return Array.from(document.querySelectorAll(INTERACTIVE_SELECTOR)).filter((element) => !isInsideExtension(element) && isVisible(element));
  }

  function initialTarget() {
    const active = activeElementDeep();
    if (active && active instanceof Element && !isInsideExtension(active) && isVisible(active)) return active;
    return visibleCandidates()[0] || Array.from(document.body.querySelectorAll("body *")).find((element) => !isInsideExtension(element) && isVisible(element)) || document.body;
  }

  function activeElementDeep() {
    let active = document.activeElement;
    while (active?.shadowRoot?.activeElement) active = active.shadowRoot.activeElement;
    return active instanceof Element ? active : null;
  }

  function restorePreviousFocus() {
    const previous = state.previousFocus;
    if (previous?.isConnected && typeof previous.focus === "function") previous.focus({ preventScroll: true });
    state.previousFocus = null;
  }

  function annotatableParent(element) {
    let node = element?.parentElement;
    while (node && node !== document.documentElement) {
      if (!isInsideExtension(node) && isVisible(node)) return node;
      node = node.parentElement;
    }
    return null;
  }

  function closestVisibleChild(element) {
    if (!element) return null;
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_ELEMENT, {
      acceptNode(node) {
        if (node === element || isInsideExtension(node) || !isVisible(node)) return NodeFilter.FILTER_SKIP;
        return NodeFilter.FILTER_ACCEPT;
      },
    });
    return walker.nextNode();
  }

  function isVisible(element) {
    if (!(element instanceof Element)) return false;
    const rect = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    return rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" && style.display !== "none" && rect.bottom >= 0 && rect.right >= 0 && rect.top <= innerHeight && rect.left <= innerWidth;
  }

  function isInsideExtension(value) {
    if (!(value instanceof Node)) return false;
    return value === host || host.contains(value) || value.getRootNode?.() === shadow;
  }

  function closeFloating(options = {}) {
    for (const name of ["composer", "detail", "panel"]) removeByClass(name);
    state.panelOpen = false;
    if (options.restoreFocus) focusElement(options.restoreFocus);
    state.dialogFocusReturn = null;
  }

  function removeByClass(name) {
    for (const element of app.querySelectorAll(`.${name}`)) element.remove();
  }

  function trapDialogTab(event, container) {
    if (event.key !== "Tab") return false;
    const focusable = Array.from(container.querySelectorAll(FOCUSABLE_SELECTOR)).filter((element) => !element.disabled && isVisibleInExtension(element));
    if (focusable.length === 0) {
      event.preventDefault();
      container.focus?.({ preventScroll: true });
      return true;
    }
    const active = activeElementWithin(container);
    const currentIndex = focusable.indexOf(active);
    const nextIndex = event.shiftKey ? (currentIndex <= 0 ? focusable.length - 1 : currentIndex - 1) : (currentIndex < 0 || currentIndex === focusable.length - 1 ? 0 : currentIndex + 1);
    event.preventDefault();
    focusable[nextIndex].focus({ preventScroll: true });
    return true;
  }

  function activeElementWithin(container) {
    const root = container.getRootNode?.();
    const active = root?.activeElement || document.activeElement;
    return active instanceof Element ? active : null;
  }

  function isVisibleInExtension(element) {
    const rect = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    return rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" && style.display !== "none";
  }

  function focusElement(element) {
    if (element?.isConnected && typeof element.focus === "function") element.focus({ preventScroll: true });
    else launcherFocusTarget()?.focus({ preventScroll: true });
  }

  function launcherFocusTarget() {
    return app.querySelector(".launcher button");
  }

  function placeNearRect(rect, width, height, gap) {
    let left = rect.right + gap;
    if (left + width > window.innerWidth - 8) left = rect.left - width - gap;
    if (left < 8) left = Math.max(8, window.innerWidth - width - 8);
    let top = rect.top;
    if (top + height > window.innerHeight - 8) top = window.innerHeight - height - 8;
    if (top < 8) top = 8;
    return { left, top };
  }

  function projectScope() {
    const projectId = `local_${fnv1a(location.origin).toString(36)}`;
    return { project_id: projectId, workspace_root_hash: `origin_${fnv1a(location.origin).toString(36)}`, origin: location.origin, route_key: routeKey(), session_id: state.sessionId || "pending", url: location.href, title: document.title || undefined };
  }

  function observeDomForRecovery() {
    if (state.recoveryObserver || typeof MutationObserver !== "function") return;
    state.recoveryObserver = new MutationObserver((records) => {
      if (!state.fullAppInitialized || !records.some(isRecoveryMutation)) return;
      scheduleMarkRecovery("dom");
    });
    state.recoveryObserver.observe(document.documentElement, { childList: true, subtree: true, attributes: true });
  }

  function isRecoveryMutation(record) {
    if (isInsideExtension(record.target)) return false;
    if (record.type === "childList") {
      for (const node of record.addedNodes) if (!isInsideExtension(node)) return true;
      for (const node of record.removedNodes) if (!isInsideExtension(node)) return true;
      return false;
    }
    return record.target instanceof Element;
  }

  function scheduleMarkRecovery(reason) {
    if (!state.fullAppInitialized) return;
    const routeKeySnapshot = state.project.route_key;
    const epoch = reason === "route" ? state.recoveryEpoch + 1 : state.recoveryEpoch;
    if (reason === "route") state.recoveryEpoch = epoch;
    state.recoveryObservedRouteKey = routeKeySnapshot;
    clearTimeout(state.recoveryQuietTimer);
    state.recoveryQuietTimer = setTimeout(() => runScheduledRecovery(epoch, routeKeySnapshot), RECOVERY_QUIET_MS);
    if (!state.recoveryTimeoutTimer) state.recoveryTimeoutTimer = setTimeout(() => runScheduledRecovery(epoch, routeKeySnapshot), RECOVERY_TIMEOUT_MS);
  }

  function runScheduledRecovery(epoch, routeKeySnapshot) {
    if (epoch !== state.recoveryEpoch || routeKeySnapshot !== state.project.route_key || routeKeySnapshot !== state.recoveryObservedRouteKey) return;
    clearTimeout(state.recoveryQuietTimer);
    clearTimeout(state.recoveryTimeoutTimer);
    state.recoveryQuietTimer = 0;
    state.recoveryTimeoutTimer = 0;
    queueMicrotask(() => {
      if (epoch !== state.recoveryEpoch || routeKeySnapshot !== state.project.route_key) return;
      renderPinsForResolvedMarks({ commit: true, epoch, routeKey: routeKeySnapshot });
      if (state.panelOpen) {
        const list = app.querySelector(".panel .marks");
        if (list) renderPanelList(list);
      }
      renderShell();
    });
  }

  function handleRouteChange() {
    if (state.picking) {
      stopPicking({ restoreFocus: false });
      state.currentTarget = null;
    } else {
      state.currentTarget = null;
      state.childStack = [];
      removePickerOverlay();
    }
    state.suppressedPointer = null;
    state.project = projectScope();
    for (const pin of state.pins.values()) pin.remove();
    state.pins.clear();
    if (state.panelOpen) {
      const list = app.querySelector(".panel .marks");
      if (list) renderPanelList(list);
    }
    renderShell();
    scheduleMarkRecovery("route");
  }

  function patchHistoryMethod(name) {
    const original = history[name];
    if (typeof original !== "function") return;
    history[name] = function patchedHistoryMethod(...args) {
      const result = original.apply(this, args);
      queueMicrotask(handleRouteChange);
      return result;
    };
  }

  function routeKey() {
    const params = new URLSearchParams(location.search);
    params.sort();
    const query = params.toString();
    return `${location.pathname || "/"}${query ? `?${query}` : ""}`;
  }

  function sessionsIndexKey() {
    return `loupe:v1:project:${state.project.project_id}:sessions:index`;
  }


  function sessionMarksKey(projectId, sessionId) {
    return `loupe:v1:project:${projectId}:session:${sessionId}:marks`;
  }

  function tombstonesKey() {
    return `loupe:v1:project:${state.project.project_id}:tombstones`;
  }

  function getOrCreateSessionId() {
    try {
      const existing = sessionStorage.getItem(SESSION_ID_KEY);
      if (existing) return existing;
      const next = createId("session");
      sessionStorage.setItem(SESSION_ID_KEY, next);
      return next;
    } catch {
      return createId("session");
    }
  }

  function createId(prefix = "mark") {
    const bytes = new Uint8Array(8);
    crypto.getRandomValues(bytes);
    return `${prefix}_${Date.now().toString(36)}_${Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
  }

  function selectorPreview(element) {
    const tag = element.localName.toLowerCase();
    if (element.id) return `${tag}#${element.id}`;
    const testId = element.getAttribute("data-testid") || element.getAttribute("data-cy") || element.getAttribute("data-qa");
    if (testId) return `${tag}[data-testid="${testId}"]`;
    const classes = stableClasses(element).slice(0, 2);
    if (classes.length) return `${tag}.${classes.join(".")}`;
    return tag;
  }

  function selectorPreviewFromMark(mark) {
    return mark.context?.element?.selector_preview || mark.target?.locator?.primary?.selector || mark.id;
  }

  function breadcrumb(element) {
    const parts = [];
    let node = element;
    while (node && node instanceof Element && node !== document.documentElement && parts.length < 6) {
      parts.unshift(selectorPreview(node));
      node = node.parentElement;
    }
    return parts.join(" › ");
  }

  function boxModelSummary(element) {
    const style = getComputedStyle(element);
    return `m:${style.marginTop}/${style.marginRight}/${style.marginBottom}/${style.marginLeft} p:${style.paddingTop}/${style.paddingRight}/${style.paddingBottom}/${style.paddingLeft}`;
  }

  function roleOf(element) {
    const explicit = element.getAttribute("role");
    if (explicit) return explicit;
    if (element.localName === "input") {
      const type = element.getAttribute("type") || "text";
      if (type === "checkbox") return "checkbox";
      if (type === "radio") return "radio";
      if (type === "button" || type === "submit") return "button";
    }
    return IMPLICIT_ROLES[element.localName.toLowerCase()];
  }

  function accessibleNameOf(element, fallbackText = "") {
    const aria = element.getAttribute("aria-label");
    if (aria) return normalizeText(aria).slice(0, 160);
    const labelledBy = element.getAttribute("aria-labelledby");
    if (labelledBy) {
      const label = labelledBy.split(/\s+/).map((id) => document.getElementById(id)?.textContent || "").join(" ");
      if (normalizeText(label)) return normalizeText(label).slice(0, 160);
    }
    const alt = element.getAttribute("alt") || element.getAttribute("title");
    if (alt) return normalizeText(alt).slice(0, 160);
    return fallbackText.slice(0, 80) || undefined;
  }

  function isStableId(id) {
    return Boolean(id && /^[A-Za-z][A-Za-z0-9_-]{2,}$/.test(id) && !/[0-9a-f]{8,}|\d{5,}/i.test(id));
  }

  function normalizeText(text) {
    return text.replace(/\s+/g, " ").trim();
  }

  function hashText(text) {
    return fnv1a(text).toString(16);
  }

  function fnv1a(text) {
    let hash = 0x811c9dc5;
    for (let index = 0; index < text.length; index += 1) {
      hash ^= text.charCodeAt(index);
      hash = Math.imul(hash, 0x01000193);
    }
    return hash >>> 0;
  }

  function cssEscape(value) {
    if (window.CSS?.escape) return CSS.escape(value);
    return value.replace(/[^A-Za-z0-9_-]/g, (char) => `\\${char}`);
  }

  function cssString(value) {
    return `"${String(value).replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\a ")}"`;
  }

  function escapeHtml(value) {
    return String(value).replace(/[&<>"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[char]);
  }

  function escapeMarkdownInline(value) {
    return String(value).replace(/`/g, "\\`");
  }

  function escapeMarkdownText(value) {
    return String(value).replace(/\n/g, " ").replace(/\|/g, "\\|");
  }

  function round(value) {
    return Math.round(value * 1000) / 1000;
  }

  function button(label, onClick, variant = "") {
    const item = document.createElement("button");
    item.type = "button";
    item.textContent = label;
    if (variant) item.className = variant;
    item.addEventListener("click", onClick);
    return item;
  }

  }

  function canBootstrapContentRuntime() {
    return typeof document !== "undefined"
      && typeof location !== "undefined"
      && typeof location.origin === "string"
      && typeof chrome !== "undefined"
      && chrome.runtime !== undefined
      && typeof chrome.runtime.sendMessage === "function";
  }

  function isAuthorizedOriginResponse(value) {
    return Boolean(value && value.ok === true && value.authorized === true);
  }

  function runtimeMessage(message) {
    return new Promise((resolveMessage) => {
      try {
        const maybePromise = chrome.runtime.sendMessage(message, (response) => {
          if (chrome.runtime.lastError) resolveMessage({ ok: false, error: chrome.runtime.lastError.message });
          else resolveMessage(response);
        });
        if (maybePromise && typeof maybePromise.then === "function") maybePromise.then(resolveMessage, () => resolveMessage({ ok: false }));
      } catch (error) {
        resolveMessage({ ok: false, error: error instanceof Error ? error.message : String(error) });
      }
    });
  }
})();
