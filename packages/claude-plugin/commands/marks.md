---
description: List open Loupe DOM marks for the current project/session.
argument-hint: "[project_id or url]"
allowed-tools: ["mcp__loupe__list_marks", "mcp__loupe__get_mark"]
---

Call `list_marks` scoped to the current Loupe project. Prefer `project_id` when the user provides it; otherwise use the current project evidence available in context, such as `workspace_root_hash`, `url`, and `route_key`.

If the path is empty or no scope is known, do not make an unscoped call. Ask the user for a project scope (`project_id`, or URL plus route/project details) because Loupe rejects unscoped `list_marks` with `SCOPE_REQUIRED`.

If Loupe returns an empty `marks` array for a scoped request, say there are no open Loupe marks for that scope and suggest creating one in the browser.

If Loupe returns `MULTI_PROJECT`, present the candidate project scopes and ask the user to choose one; do not merge results across projects.

Summarize each open mark with: `id`, `selector_preview`, `intent.comment`, `locator_status`, and `confidence`. Use `get_mark` only when the user asks for details about a specific mark, and include the same project scope with the `id`.
