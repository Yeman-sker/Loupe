# ADP: Host authorization grant via the browser action, with an in-page CTA

## Context

The prototype defines **Surface 1 · Host authorization CTA**: an in-page card on an
unauthorized origin whose "Allow site" button calls `chrome.permissions.request`, then
advances `auth → project → ready`.

The shipped extension never implemented this. `content.js` asked the background worker
*"is this origin authorized?"* (`permissions.contains`) and, when not, **silently bailed**
— no UI, no way to request permission. The manifest declared an `action` button
(`"Authorize Loupe on this page"`) but had no `default_popup` and no `chrome.action.onClicked`
listener, and the `loupe.origin_auth.request` path had no caller. With `host_permissions: []`,
no origin is granted by default, so in real use the extension could never authorize and
never rendered anything ("打不开" / won't open).

The prototype's design cannot be implemented literally: **MV3 cannot call
`chrome.permissions.request` from an in-page (content-script) click** — the API is not
exposed to content scripts, and relaying the click to the service worker loses the user
gesture the API requires.

## Decision

1. **The browser action is the grant entry point.** `background.js` adds a
   `chrome.action.onClicked` listener (a valid MV3 user gesture) that calls
   `chrome.permissions.request` for the active tab's origin and reloads the tab on grant.
   The content script then re-runs authorized and mounts the full flow.

2. **An in-page host-authorization CTA (Surface 1) is shown on unauthorized origins**, but
   it is *informational*: it routes the user to the browser action rather than granting
   directly. Built as `surface-host-auth.ts`, ported from the prototype's `.cta` markup,
   with a hint line (new string `auth.toolbar`) replacing the prototype's in-page "Allow".

3. **The inert auth marker (`#loupe-extension-root`) stays authorized-only.** The unchanged
   security posture: the marker installs only after an authorized response. What changed is
   that the *surface runtime* (`dist/ui/app.js`) now loads in both states — when
   unauthorized it renders only the CTA via its own shadow host (`#loupe-surface-root`) and
   gates off picking, storage reads, and the `⌥L` shortcut.

## Alternatives considered

- **In-page card grants directly (literal prototype).** Rejected: unreliable in MV3; the
  user gesture is lost across the content→service-worker boundary, so the request is
  rejected.
- **Popup with an "Allow" button (`default_popup`).** Works (gesture valid on the extension
  page) but adds a second styled surface and an extra click; the action-click path is
  simpler and equally reliable. Can still be added later without reversing this decision.
- **Keep "no injection before authorization" and rely on the toolbar only (no in-page
  CTA).** Rejected: the prompt would be undiscoverable in-page, which is the exact gap
  reported. The CTA makes the entry point visible.

## Consequences

- The surface runtime now paints a dismissible CTA overlay on unauthorized http/https
  origins (the inert marker still does not install). This is a deliberate, low-noise
  prompt; dismissal (`auth.not`) is in-memory per page load.
- `chrome.tabs.reload` is used after grant; it needs no extra manifest permission.
- One `phase4-e2e` source-text assertion was updated to the new gating shape (marker
  installs iff authorized); the marker's inert/no-token/no-UI guarantees are unchanged.
- e2e remains green because the test manifest seeds `host_permissions`, so the harness
  always takes the authorized path.

## Status

Accepted
