# @loupe/e2e — Loupe extension end-to-end tests

Drives the Loupe Chrome extension as a real user in a real Chromium instance to catch UI/UX regressions and surface behavioural bugs.

## How it works

### Open-shadow test seam

Production source is **never** modified. Before any test run the Playwright `globalSetup` calls `scripts/prep-ext.ts`, which builds a patched copy of the extension at `.test-ext/`. The patch:

- Flips the closed Shadow DOM in `dist/ui/host.js` and `src/content.js` from `{ mode: "closed" }` to `{ mode: "open" }` so Playwright's automatic shadow-piercing works on every locator.
- Updates `manifest.json` to grant the fixture origin (`http://127.0.0.1:5990`) in `host_permissions`.

`.test-ext/` is git-ignored and rebuilt on every run — never commit it.

### Constraints

- The Loupe UI hard-probes daemon port **7373**. The harness binds a sandbox daemon there, so only one test process can run at a time.
- Tests use a persistent Chromium context (required for MV3 extensions). Combined with the fixed port this means:
  - `workers: 1` and `fullyParallel: false` — enforced in `playwright.config.ts`.
  - Tests run **headed** by default. Set `LOUPE_E2E_HEADLESS=1` to force headless.

## Running the specs

```sh
pnpm --filter @loupe/e2e test
# Headless:
LOUPE_E2E_HEADLESS=1 pnpm --filter @loupe/e2e test
```

## Interactive exploration with chrome-devtools-mcp

For manual UI exploration and triaging new bugs before encoding them as specs:

1. **Start the MCP server** (keeps daemon + fixture server alive):
   ```sh
   pnpm --filter @loupe/e2e mcp:serve
   ```
   The command prints:
   - `--load-extension` path (the `.test-ext/` directory)
   - Fixture URL: `http://127.0.0.1:5990/index.html`
   - Sandbox daemon `baseUrl` + `token`

2. **Drive Chrome** via the `chrome-devtools-mcp` tools configured in the root `.mcp.json`:
   - Launch Chrome with `--load-extension=<path>` pointing at the printed path.
   - Open the fixture URL.
   - Screenshot each of the 8 surfaces (ready, picker, intent, pin, detail, view-all, project chooser, fallback).
   - Click/type to exercise flows and note any abnormal behaviour.

3. **Encode confirmed bugs** as new `.spec.ts` files in `tests/` following the patterns in `journey.spec.ts` and `surfaces.spec.ts`.

## Surfaces & selectors reference

| Surface | Root selector | Key child selectors |
|---|---|---|
| Ready panel | `.lp-ready` | `.lp-ready-pick` (start picking), `.lp-ready-viewall` (open view-all) |
| Picking mode | `.lp-mode-ind` | `.lp-frame` (highlight frame), `.lp-breadcrumb` (element path) |
| Intent panel | `.lp-intent` | `.lp-intent-field` (textarea), `.lp-intent-submit` (submit btn), `.lp-kindrail` (kind listbox) |
| Kind chips | `.lp-kind-btn` (role=option) | aria-label: `bug \| copy \| style \| layout \| question \| other`; selected: `.lp-kind-btn--sel` |
| Pin | `.lp-pin` (role=button) | `.lp-pin-num` (number), `.lp-pin--done` (resolved state) |
| Detail popover | `.detail` (role=dialog) | `.d-comment`, `.detail .btn.primary` ("Mark done"), `.detail .btn.danger` ("Delete") |
| View-all panel | `.viewall` (role=dialog) | `.va-item`, `.va-c` (comment), `.va-n` (number), `.va-count`, `.va-x` (close) |

All selectors are inside an **open** Shadow DOM under `#loupe-surface-root`. Playwright pierces open shadow roots automatically — no special handling needed.

## Picking page elements in tests

The extension overlay is `pointer-events: none`, so `locator.click()` is refused by Playwright actionability for underlying page elements. Use the `pickTarget` helper from `tests/helpers.ts`:

```ts
import { pickTarget } from "./helpers.js";

const { cx, cy } = await pickTarget(page, "#hero-heading"); // hover
await page.mouse.click(cx, cy);                            // confirm pick
```

Pick targets near the **top** of the page — the picking-mode indicator sits at bottom-center and may intercept clicks near the bottom.

Interactive surface elements (pick button, kind chips, submit, pin, detail buttons) are inside the shadow and fully actionable with normal `locator.click()`.
