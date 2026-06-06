---
description: Prepare @loupe-server/shared for npm publishing without running npm publish.
argument-hint: "[version]"
allowed-tools: ["Bash", "Read", "Edit"]
---

Prepare a release of `@loupe-server/shared`. Do **not** run `npm publish`.

Run the shared release runner:

```bash
node .claude/hooks/release-package.mjs shared $ARGUMENTS
```

Rules:

- If `$ARGUMENTS` is supplied, the runner uses it as the target version.
- Otherwise the runner checks the published version and chooses the next version from package surface changes:
  - patch for implementation-only changes
  - minor for additive public surface changes
  - stop on removed/changed public surface unless an explicit version is supplied
- The runner must build, test, dry-run pack, validate package contents, confirm there is no `bin` field, and stop before publish.
- If `npm whoami` fails, stop and tell the user to run `npm login`.
- Do not change `packages/server/package.json` unless `packages/server/package.json` dependency requirements changed.

Required final publish command printed by the runner:

```bash
npm publish ./packages/shared --access public
```

After the user confirms the publish succeeded, update release state with:

```bash
node .claude/hooks/release-package.mjs mark-published shared
```

Then commit and push only release-prep files that changed.
