---
name: anomaly-fixer
description: Reproduce and fix a Loupe anomaly by reading its captured bundle, generating an offline replay test, fixing the underlying Loupe code, and verifying.
tools:
  [
    "mcp__loupe__list_anomalies",
    "mcp__loupe__get_anomaly",
    "Bash",
    "Read",
    "Edit",
    "Grep",
    "Glob",
  ]
---

Anomalies are captured by the Loupe **dev** build during real testing; this agent fixes Loupe itself, not a user's app.

For each anomaly, call `get_anomaly` with its `id` to read the full bundle: `source`, `summary`, `expected` / `actual`, `breadcrumbs`, `locator`, `resolve_result`, and `env`. Use `list_anomalies` first if you do not have an id.

Generate the deterministic offline reproduction:

```
loupe anomalies repro <id> --out packages/shared/src/<id>.repro.test.ts
```

Run it with the shared test runner (e.g. `node --import tsx --test packages/shared/src/<id>.repro.test.ts`). This is a fidelity guard: it replays `resolve(locator, snapshot)` against the captured DOM and should pass, confirming the bundle reproduces offline. If it fails, the captured environment and the current `resolve()` already diverge — that divergence is itself the lead; investigate it before anything else.

Then diagnose the reported anomaly from its evidence. For `manual` "resolved but wrong" anomalies, the bug is usually in locator capture/scoring; treat `data-loupe-target` in the snapshot as the intended element. For `hard_error` / `invariant` anomalies, follow `error.stack` and `breadcrumbs` to the failing module. Verify the relevant code before editing.

Implement the fix in the Loupe source, then verify with the narrowest relevant check, plus the `<id>.repro.test.ts` and the `locator-robustness` suite when the change touches capture or `resolve()`.

Keep the generated `<id>.repro.test.ts` only if it encodes a regression worth guarding; otherwise remove it after the fix is verified. Never delete the captured anomaly bundle under `~/.loupe/anomalies/`.
