---
description: Prepare @loupe-server/shared for npm publishing without running npm publish.
argument-hint: "[version]"
allowed-tools: ["Bash", "Read", "Edit"]
---

Prepare a release of `@loupe-server/shared`. Do **not** run `npm publish`; stop once the package is ready and print the exact publish command:

```bash
npm publish ./packages/shared --access public
```

Procedure:

1. Check npm identity:
   - Run `npm whoami`.
   - If it fails, stop and tell the user to run `npm login`.

2. Check published version:
   - Run `npm view @loupe-server/shared version`.
   - Read `packages/shared/package.json`.

3. Set the next package version:
   - If the user supplied `$ARGUMENTS`, use it as the target version.
   - Otherwise bump `packages/shared/package.json` to the next patch version greater than the published version.
   - Do not change `packages/server/package.json` unless `packages/server/package.json` dependency requirements changed.

4. Build and verify:
   - Run `pnpm --filter @loupe-server/shared build`.
   - Run `pnpm --filter @loupe-server/shared test`.
   - Run `npm pack ./packages/shared --dry-run`.

5. Validate publish readiness:
   - Confirm dry-run output includes `dist/index.js` and the package version you intend to publish.
   - Confirm package has no `bin` field.
   - If npm warns that it would auto-correct or remove package fields, stop; do not publish.

6. Final output:
   - Report the target version.
   - Report the checks that passed.
   - Print exactly:

```bash
npm publish ./packages/shared --access public
```

After the user confirms the publish succeeded, commit and push only the release-prep files that changed, normally `packages/shared/package.json` plus this command if it changed.
