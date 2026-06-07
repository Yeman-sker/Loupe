import type { AgentMark } from "@loupe-server/shared";

/** Scope fields carried with every change so the SSE handler can filter by session/route. */
export type MarkChangeScope = {
  project_id: string;
  workspace_root_hash: string;
  origin: string;
  url: string;
  route_key: string;
  session_id: string;
};

export type MarkChange =
  | { type: "upsert"; scope: MarkChangeScope; mark: AgentMark }
  | { type: "resolve"; scope: MarkChangeScope; mark: AgentMark }
  | { type: "delete"; scope: MarkChangeScope; id: string };

type Listener = (change: MarkChange) => void;

/**
 * In-process pub/sub for mark mutations, keyed by `project_id`. One bus per daemon
 * process; the SSE `/v1/marks/stream` handler subscribes per connection and the mark
 * mutation choke points publish. No persistence — purely a live fan-out.
 */
export class MarkEventBus {
  private readonly listeners = new Map<string, Set<Listener>>();

  subscribe(projectId: string, listener: Listener): () => void {
    let set = this.listeners.get(projectId);
    if (set === undefined) {
      set = new Set();
      this.listeners.set(projectId, set);
    }
    set.add(listener);
    return () => {
      const current = this.listeners.get(projectId);
      if (current === undefined) return;
      current.delete(listener);
      if (current.size === 0) this.listeners.delete(projectId);
    };
  }

  publish(change: MarkChange): void {
    const set = this.listeners.get(change.scope.project_id);
    if (set === undefined) return;
    for (const listener of [...set]) listener(change);
  }

  subscriberCount(projectId: string): number {
    return this.listeners.get(projectId)?.size ?? 0;
  }
}
