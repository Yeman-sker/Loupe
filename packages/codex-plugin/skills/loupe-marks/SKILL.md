---
name: loupe-marks
description: Use Loupe browser DOM marks as precise frontend tasks in Codex. Load when the user asks about Loupe marks, DOM annotations, browser-selected UI tasks, or resolving marked frontend changes.
---

# Loupe marks

Use the bundled `loupe` MCP server to read DOM marks captured by the browser extension.

## Listing marks

- Call `list_marks` scoped to the current Loupe project/session.
- Prefer `project_id` when the user provides it.
- Otherwise use current project evidence such as `workspace_root_hash`, `url`, and `route_key`.
- Never make an unscoped `list_marks` call; Loupe rejects unscoped reads with `SCOPE_REQUIRED`.
- If Loupe returns `MULTI_PROJECT`, present the candidate project scopes and ask the user to choose one.
- Summarize each open mark with `id`, `selector_preview`, `intent.comment`, `locator_status`, and `confidence`.

## Resolving a mark

1. Call `get_mark` with the mark `id` plus the same project scope used for listing.
2. Treat `framework.source_hint` as a hint only; verify relevant code before editing.
3. If `target.locator_status` is `drifted` or `lost`, or if `target.confidence` is low, surface the uncertainty before editing.
4. Implement the requested frontend change using the narrowest code change that satisfies the mark intent.
5. Verify with the narrowest relevant check available.
6. Call `resolve_mark` only after the implementation is complete and verified, passing the same project scope and a concise `resolution_note`.

Never call `delete_mark` unless the user explicitly asks to delete the mark. Resolving completed work uses `resolve_mark`; deletion is not a completion signal.
