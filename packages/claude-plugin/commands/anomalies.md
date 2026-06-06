---
description: List captured Loupe anomalies (errors flagged during testing) for the local daemon.
argument-hint: "[project_id]"
allowed-tools: ["mcp__loupe__list_anomalies", "mcp__loupe__get_anomaly"]
---

Call `list_anomalies` to read the anomalies captured on this developer machine, newest first. Anomalies are scoped to the local Loupe home, not to a project, so an unscoped call is valid. Pass `project_id` only when the user provides one (or it is clear from context) to filter the list.

If Loupe returns an empty `anomalies` array, say there are no captured anomalies and remind the user that anomaly capture only runs in the Loupe **dev** build (`build:dev`), triggered by the ⌥⇧A hotkey or a hard error.

Summarize each anomaly with: `id`, `source` (`hard_error` | `invariant` | `manual`), `summary`, `locator_status`, `has_dom`, and `created_at`. Use `get_anomaly` with the `id` only when the user asks for details about one anomaly; it returns the full report including the offline replay recipe (`locator`, `resolve_result`, breadcrumbs, env, `expected` / `actual`).

To reproduce and fix an anomaly, hand it to the `anomaly-fixer` agent, or generate the offline replay test yourself with `loupe anomalies repro <id>`.
