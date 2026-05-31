declare const chrome: {
  readonly runtime: {
    readonly onInstalled: {
      addListener(listener: () => void): void;
    };
    readonly onMessage: {
      addListener(
        listener: (message: unknown, sender: unknown, sendResponse: (response: unknown) => void) => boolean,
      ): void;
    };
  };
  readonly storage: {
    readonly session: {
      set(items: Record<string, unknown>): Promise<void>;
    };
  };
};

const PHASE_ZERO_STATE = Object.freeze({
  daemonHealthUrl: "http://127.0.0.1:7373/health",
  exposesTokenToPage: false,
  exposesPageWindowApi: false,
});

chrome.runtime.onInstalled.addListener(() => {
  void chrome.storage.session.set({
    loupe_phase: "phase_0_placeholder",
    daemon_health_url: PHASE_ZERO_STATE.daemonHealthUrl,
    exposes_token_to_page: PHASE_ZERO_STATE.exposesTokenToPage,
    exposes_page_window_api: PHASE_ZERO_STATE.exposesPageWindowApi,
  });
});

chrome.runtime.onMessage.addListener((message: unknown, _sender, sendResponse) => {
  if (!isPhaseZeroStatusRequest(message)) {
    return false;
  }

  sendResponse({
    phase: "phase_0_placeholder",
    daemon_health_url: PHASE_ZERO_STATE.daemonHealthUrl,
    can_access_marks: false,
    exposes_token_to_page: PHASE_ZERO_STATE.exposesTokenToPage,
    exposes_page_window_api: PHASE_ZERO_STATE.exposesPageWindowApi,
  });

  return false;
});

function isPhaseZeroStatusRequest(message: unknown): message is { readonly type: "loupe.phase0.status" } {
  return typeof message === "object" && message !== null && "type" in message && message.type === "loupe.phase0.status";
}

export {};
