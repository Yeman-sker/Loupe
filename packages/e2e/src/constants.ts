// Shared, fixed ports for the e2e test platform.
//
// DAEMON_PORT is hard-coded at 7373 because the extension UI's health probe
// (packages/extension/src/ui/lib-storage.ts: LOUPE_DAEMON_BASE_URL) targets
// http://127.0.0.1:7373 unconditionally. The sandboxed daemon MUST bind this
// port for the UI to see it online and for background sync to reach it. This is
// also why tests run with workers:1 (one daemon owns the port at a time).
export const DAEMON_PORT = 7373;
export const DAEMON_ORIGIN = `http://127.0.0.1:${DAEMON_PORT}`;

// FIXTURE_PORT is fixed so the test-copy manifest can grant host permission for
// the exact origin pattern the background expects (`${protocol}//${host}/*`),
// auto-authorizing the content script without a user gesture. Serve fixtures on
// 127.0.0.1 (not localhost) so the origin matches the granted pattern exactly.
export const FIXTURE_PORT = 5990;
export const FIXTURE_HOST = "127.0.0.1";
export const FIXTURE_ORIGIN = `http://${FIXTURE_HOST}:${FIXTURE_PORT}`;

// Origin patterns to inject into the test-copy manifest's host_permissions so
// the fixture origin is authorized at install time. Mirrors background.js
// originPattern(): `${url.protocol}//${url.host}/*`.
export const FIXTURE_HOST_PERMISSIONS = [
  `http://${FIXTURE_HOST}:${FIXTURE_PORT}/*`,
  `http://localhost:${FIXTURE_PORT}/*`,
];
