export type RecoveryLocatorStatus = "resolved" | "drifted" | "lost";
export type RecoveryStartReason = "route_change" | "target_detached";
export type RecoveryQuietSignal = "dom_quiet" | "dom_timeout";
export type RecoveryLifecycleStatus = "active" | "resolved" | "deleted";

export type StableRecoveryState = {
  state: "stable";
  epoch: number;
  route_key: string;
  locator_status: RecoveryLocatorStatus;
  lifecycle_status: "active";
};

export type RoutePendingRecoveryState = {
  state: "route_pending";
  epoch: number;
  route_key: string;
  locator_status: RecoveryLocatorStatus;
  lifecycle_status: "active";
};

export type DomPendingRecoveryState = {
  state: "dom_pending";
  epoch: number;
  route_key: string;
  locator_status: RecoveryLocatorStatus;
  lifecycle_status: "active";
};

export type ResolvingRecoveryState = {
  state: "resolving";
  epoch: number;
  route_key: string;
  locator_status: RecoveryLocatorStatus;
  lifecycle_status: "active";
  reason: RecoveryStartReason;
  started_by: RecoveryQuietSignal;
};

export type TerminalRecoveryState = {
  state: "terminal";
  epoch: number;
  route_key: string;
  locator_status: RecoveryLocatorStatus;
  lifecycle_status: Exclude<RecoveryLifecycleStatus, "active">;
};

export type RouteRecoveryState =
  | StableRecoveryState
  | RoutePendingRecoveryState
  | DomPendingRecoveryState
  | ResolvingRecoveryState
  | TerminalRecoveryState;

export type RouteChangeDetectedInput = {
  type: "route_change_detected";
  route_key: string;
};

export type TargetDetachedInput = {
  type: "target_detached";
};

export type DomQuietInput = {
  type: "dom_quiet";
};

export type DomTimeoutInput = {
  type: "dom_timeout";
};

export type ResolveCompletedInput = {
  type: "resolve_completed";
  epoch: number;
  route_key: string;
  locator_status: RecoveryLocatorStatus;
};

export type ExplicitResolveInput = {
  type: "explicit_resolve";
};

export type ExplicitDeleteInput = {
  type: "explicit_delete";
};

export type RouteRecoveryInput =
  | RouteChangeDetectedInput
  | TargetDetachedInput
  | DomQuietInput
  | DomTimeoutInput
  | ResolveCompletedInput
  | ExplicitResolveInput
  | ExplicitDeleteInput;

export type CommittedRecoveryResult = {
  epoch: number;
  route_key: string;
  locator_status: RecoveryLocatorStatus;
  reason: RecoveryStartReason;
};

export type RouteRecoveryStep = {
  state: RouteRecoveryState;
  commit?: CommittedRecoveryResult;
};

export function create_route_recovery_state(
  route_key: string,
  locator_status: RecoveryLocatorStatus = "resolved",
): StableRecoveryState {
  return {
    state: "stable",
    epoch: 0,
    route_key,
    locator_status,
    lifecycle_status: "active",
  };
}

export function reduce_route_recovery(state: RouteRecoveryState, input: RouteRecoveryInput): RouteRecoveryStep {
  if (state.lifecycle_status !== "active") {
    return { state };
  }

  switch (input.type) {
    case "route_change_detected":
      return {
        state: {
          state: "route_pending",
          epoch: state.epoch + 1,
          route_key: input.route_key,
          locator_status: state.locator_status,
          lifecycle_status: "active",
        },
      };
    case "target_detached":
      return {
        state: {
          state: "dom_pending",
          epoch: state.epoch,
          route_key: state.route_key,
          locator_status: state.locator_status,
          lifecycle_status: "active",
        },
      };
    case "dom_quiet":
    case "dom_timeout":
      return start_resolving(state, input.type);
    case "resolve_completed":
      return complete_resolve(state, input);
    case "explicit_resolve":
      return { state: terminal_state(state, "resolved") };
    case "explicit_delete":
      return { state: terminal_state(state, "deleted") };
  }
}

function start_resolving(state: RouteRecoveryState, started_by: RecoveryQuietSignal): RouteRecoveryStep {
  if (state.state !== "route_pending" && state.state !== "dom_pending") {
    return { state };
  }

  return {
    state: {
      state: "resolving",
      epoch: state.epoch,
      route_key: state.route_key,
      locator_status: state.locator_status,
      lifecycle_status: "active",
      reason: state.state === "route_pending" ? "route_change" : "target_detached",
      started_by,
    },
  };
}

function complete_resolve(state: RouteRecoveryState, input: ResolveCompletedInput): RouteRecoveryStep {
  if (state.state !== "resolving" || state.epoch !== input.epoch || state.route_key !== input.route_key) {
    return { state };
  }

  const commit = {
    epoch: state.epoch,
    route_key: state.route_key,
    locator_status: input.locator_status,
    reason: state.reason,
  } as const;

  return {
    state: {
      state: "stable",
      epoch: state.epoch,
      route_key: state.route_key,
      locator_status: input.locator_status,
      lifecycle_status: "active",
    },
    commit,
  };
}

function terminal_state(
  state: RouteRecoveryState,
  lifecycle_status: Exclude<RecoveryLifecycleStatus, "active">,
): TerminalRecoveryState {
  return {
    state: "terminal",
    epoch: state.epoch,
    route_key: state.route_key,
    locator_status: state.locator_status,
    lifecycle_status,
  };
}
