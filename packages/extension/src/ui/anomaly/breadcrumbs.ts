// Bounded ring buffer of recent user/runtime actions. On an anomaly we attach a
// snapshot of the last N breadcrumbs so an agent can see what led up to it.

import type { AnomalyBreadcrumb } from "../schema.js";

export class BreadcrumbBuffer {
  private readonly items: AnomalyBreadcrumb[] = [];

  constructor(
    private readonly limit = 30,
    private readonly now: () => string = () => new Date().toISOString(),
  ) {}

  push(kind: string, detail?: string): void {
    const crumb: AnomalyBreadcrumb = { at: this.now(), kind };
    if (detail !== undefined) crumb.detail = detail;
    this.items.push(crumb);
    if (this.items.length > this.limit) this.items.splice(0, this.items.length - this.limit);
  }

  snapshot(): AnomalyBreadcrumb[] {
    return this.items.map((crumb) => ({ ...crumb }));
  }
}
