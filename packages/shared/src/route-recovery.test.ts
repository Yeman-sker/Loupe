import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  create_route_recovery_state,
  reduce_route_recovery,
  type RouteRecoveryState,
} from "./route-recovery.js";

describe("route recovery state machine", () => {
  it("route change waits for DOM quiet before resolving", () => {
    let state: RouteRecoveryState = create_route_recovery_state("/before");

    let step = reduce_route_recovery(state, { type: "route_change_detected", route_key: "/after" });
    assert.equal(step.commit, undefined);
    assert.equal(step.state.state, "route_pending");
    assert.equal(step.state.epoch, 1);
    assert.equal(step.state.route_key, "/after");
    state = step.state;

    step = reduce_route_recovery(state, {
      type: "resolve_completed",
      epoch: 1,
      route_key: "/after",
      locator_status: "resolved",
    });
    assert.equal(step.commit, undefined);
    assert.equal(step.state.state, "route_pending");
    state = step.state;

    step = reduce_route_recovery(state, { type: "dom_quiet" });
    assert.equal(step.commit, undefined);
    assert_resolving(step.state);
    assert.equal(step.state.started_by, "dom_quiet");
    assert.equal(step.state.reason, "route_change");
  });

  it("stale route result does not commit", () => {
    let state: RouteRecoveryState = create_route_recovery_state("/one");
    state = reduce_route_recovery(state, { type: "route_change_detected", route_key: "/two" }).state;
    state = reduce_route_recovery(state, { type: "dom_quiet" }).state;

    const step = reduce_route_recovery(state, {
      type: "resolve_completed",
      epoch: 1,
      route_key: "/one",
      locator_status: "resolved",
    });

    assert.equal(step.commit, undefined);
    assert.equal(step.state.state, "resolving");
    assert.equal(step.state.route_key, "/two");
  });

  it("stale epoch result does not commit", () => {
    let state: RouteRecoveryState = create_route_recovery_state("/one");
    state = reduce_route_recovery(state, { type: "route_change_detected", route_key: "/two" }).state;
    state = reduce_route_recovery(state, { type: "route_change_detected", route_key: "/two" }).state;
    state = reduce_route_recovery(state, { type: "dom_timeout" }).state;

    const step = reduce_route_recovery(state, {
      type: "resolve_completed",
      epoch: 1,
      route_key: "/two",
      locator_status: "drifted",
    });

    assert.equal(step.commit, undefined);
    assert.equal(step.state.state, "resolving");
    assert.equal(step.state.epoch, 2);
  });

  it("new route cancels old resolve and restarts", () => {
    let state: RouteRecoveryState = create_route_recovery_state("/one");
    state = reduce_route_recovery(state, { type: "route_change_detected", route_key: "/two" }).state;
    state = reduce_route_recovery(state, { type: "dom_quiet" }).state;

    let step = reduce_route_recovery(state, { type: "route_change_detected", route_key: "/three" });
    assert.equal(step.commit, undefined);
    assert.equal(step.state.state, "route_pending");
    assert.equal(step.state.epoch, 2);
    assert.equal(step.state.route_key, "/three");
    state = step.state;

    step = reduce_route_recovery(state, { type: "dom_timeout" });
    assert_resolving(step.state);
    assert.equal(step.state.started_by, "dom_timeout");
    state = step.state;

    step = reduce_route_recovery(state, {
      type: "resolve_completed",
      epoch: 1,
      route_key: "/two",
      locator_status: "lost",
    });
    assert.equal(step.commit, undefined);
    assert.equal(step.state.state, "resolving");

    step = reduce_route_recovery(step.state, {
      type: "resolve_completed",
      epoch: 2,
      route_key: "/three",
      locator_status: "resolved",
    });
    assert.deepEqual(step.commit, {
      epoch: 2,
      route_key: "/three",
      locator_status: "resolved",
      reason: "route_change",
    });
    assert.equal(step.state.state, "stable");
  });

  it("target detach uses current epoch", () => {
    let state: RouteRecoveryState = create_route_recovery_state("/one");
    state = reduce_route_recovery(state, { type: "route_change_detected", route_key: "/two" }).state;
    state = reduce_route_recovery(state, { type: "dom_quiet" }).state;
    state = reduce_route_recovery(state, {
      type: "resolve_completed",
      epoch: 1,
      route_key: "/two",
      locator_status: "resolved",
    }).state;

    let step = reduce_route_recovery(state, { type: "target_detached" });
    assert.equal(step.state.state, "dom_pending");
    assert.equal(step.state.epoch, 1);
    assert.equal(step.state.route_key, "/two");
    state = step.state;

    step = reduce_route_recovery(state, { type: "dom_quiet" });
    assert_resolving(step.state);
    assert.equal(step.state.epoch, 1);
    assert.equal(step.state.reason, "target_detached");
  });

  it("explicit resolve/delete terminal does not commit locator recovery", () => {
    let state: RouteRecoveryState = create_route_recovery_state("/one");
    state = reduce_route_recovery(state, { type: "route_change_detected", route_key: "/two" }).state;
    state = reduce_route_recovery(state, { type: "dom_quiet" }).state;

    let step = reduce_route_recovery(state, { type: "explicit_resolve" });
    assert.equal(step.commit, undefined);
    assert_terminal(step.state);
    assert.equal(step.state.lifecycle_status, "resolved");

    step = reduce_route_recovery(step.state, {
      type: "resolve_completed",
      epoch: 1,
      route_key: "/two",
      locator_status: "resolved",
    });
    assert.equal(step.commit, undefined);
    assert.equal(step.state.state, "terminal");

    state = create_route_recovery_state("/one");
    step = reduce_route_recovery(state, { type: "explicit_delete" });
    assert.equal(step.commit, undefined);
    assert_terminal(step.state);
    assert.equal(step.state.lifecycle_status, "deleted");
  });
});

function assert_resolving(state: RouteRecoveryState): asserts state is Extract<RouteRecoveryState, { state: "resolving" }> {
  assert.equal(state.state, "resolving");
}

function assert_terminal(state: RouteRecoveryState): asserts state is Extract<RouteRecoveryState, { state: "terminal" }> {
  assert.equal(state.state, "terminal");
}
