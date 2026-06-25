# Loupe

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT) [![Release](https://img.shields.io/github/v/release/Yeman-sker/Loupe)](https://github.com/Yeman-sker/Loupe/releases) [![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](https://github.com/Yeman-sker/Loupe/pulls)

**English** | [简体中文](./README.zh-CN.md)

> Pin a real DOM element on your local dev page and write your intent — an AI coding agent reads the exact target and context via MCP, edits the code, and `resolve`s the mark by default.

Loupe turns *"the real DOM element I'm pointing at in my browser"* into an agent-executable, verifiable, completable structured task. It is **not** a web annotation tool, a screenshot markup tool, or an in-page design editor.

Core trust loop:

```text
pick → robust locate/recover → persist/sync → low-noise Agent read → resolve
```

See [`PRD.md`](./PRD.md) and [`CONTEXT.md`](./CONTEXT.md).

## Architecture

Loupe is local-first: the source of interaction truth lives in the browser extension's `chrome.storage.local`; the local daemon only mirrors to disk and bridges to the agent.

| Component | Package | Responsibility |
| --- | --- | --- |
| Browser extension | `@loupe/extension` | Chrome MV3 — picker, composer, locator/context capture, minimal pin overlay, local-first storage |
| Local daemon | `@loupe-server/server` | Listens on `127.0.0.1:7373`, exposes token-authed `/v1/marks*` and `/mcp`, mirrors `~/.loupe/marks.json` |
| Shared schema | `@loupe-server/shared` | Types and mark schema shared across extension, daemon, and plugins |
| Claude plugin | `@loupe/claude-plugin` | Starts the daemon, registers the MCP proxy, provides `/loupe:marks` and the mark-resolver agent |
| Codex plugin | `@loupe/codex-plugin` | Codex-side MCP integration |
| E2E tests | `@loupe/e2e` | Playwright-driven MV3 extension + daemon full-chain tests |

## Requirements

- Node.js ≥ 22 (dev machine runs v24)
- pnpm 9 (`packageManager` is pinned to `pnpm@9.15.4`)
- Chrome / Chromium (to load the MV3 extension)

## Quick Start

```bash
pnpm install

# Build order matters: shared must build before its consumers
# (extension / server / plugins consume shared via dist)
pnpm --filter @loupe-server/shared build
pnpm --filter @loupe/extension build:dev
pnpm --filter @loupe-server/server build
```

In Chrome, open `chrome://extensions`, enable **Developer mode**, then **Load unpacked** and select `packages/extension/dist`.

Once the local daemon is running, the extension syncs marks with `127.0.0.1:7373`, and the agent reads them over MCP.

### Golden Path

1. Run your local app (e.g. `http://localhost:5173`).
2. Install the Loupe extension and the Claude plugin; the plugin checks `/health` on SessionStart and starts the daemon if needed.
3. The extension detects the current host is authorized and generates `project_id` / `route_key` / `session_id`.
4. Press `⌥L` to enter pick mode, select a real DOM node with mouse or keyboard, use `↑/↓` to adjust parent/child depth, and `Enter` to confirm.
5. Write your intent (comment is required) to create a mark.
6. The agent reads the project-scoped mark, locates the code by locator/context, edits it, and calls `resolve_mark` to close the task by default.

## Scripts

At the repo root (runs across all packages):

```bash
pnpm check      # type checking (= typecheck)
pnpm test       # run tests across all packages
```

Per package:

```bash
pnpm --filter @loupe/extension      check        # tsc type check
pnpm --filter @loupe/extension      build        # production build
pnpm --filter @loupe/extension      build:dev    # dev build (includes dev manifest)
pnpm --filter @loupe-server/server  build
pnpm --filter @loupe/e2e            test
```

> After editing `@loupe-server/shared` `src`, you must `build` again — otherwise consumers see the stale exports from `dist`.

## Repository Structure

```text
packages/
  extension/      Chrome MV3 extension (picker / composer / pin overlay)
  server/         Local daemon (HTTP + MCP, marks.json mirror)
  shared/         Shared schema and types
  claude-plugin/  Claude Code plugin
  codex-plugin/   Codex plugin
  e2e/            End-to-end tests
docs/
  adp-*.md        Architecture decision records (ADP)
  phases/         Phased delivery docs
  ui-ux/          Product design prototypes (the single source of truth for UI/UX implementation)
PRD.md            Core product doc
CONTEXT.md        Domain language and glossary
```

## Design Principles (from the PRD)

1. **Locating is trust.** Prefer showing `drifted` / `lost` over silently pointing at the wrong element.
2. **Done defaults to `resolve`, not `delete`.**
3. **project / session isolation is the security boundary.** Marks must not be stored/accessed by route alone.
4. **Local-first, daemon mirrors.**
5. **Low-noise agent payload.** Raw storage keeps evidence; MCP returns only what the current decision needs.
6. **Secure by default.** The loopback interface must carry a token; page scripts have no tokenless write entry point.
