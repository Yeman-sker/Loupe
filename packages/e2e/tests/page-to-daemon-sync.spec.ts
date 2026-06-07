import { test, expect } from "../src/harness.js";
import { pickTarget } from "./helpers.js";

type Scope = Record<string, string>;

// Query the daemon directly for the marks under a given project scope.
async function daemonMarks(baseUrl: string, token: string, scope: Scope): Promise<Array<{ id: string; lifecycle: { task_status: string } }>> {
  const params = new URLSearchParams();
  for (const k of ["project_id", "session_id", "workspace_root_hash", "origin", "url", "route_key"]) {
    if (scope[k]) params.set(k, scope[k]!);
  }
  const res = await fetch(`${baseUrl}/v1/marks?${params.toString()}`, { headers: { authorization: `Bearer ${token}` } });
  if (!res.ok) return [];
  return ((await res.json()) as { marks?: Array<{ id: string; lifecycle: { task_status: string } }> }).marks ?? [];
}

// Poll the daemon up to `ms` for the mark to reach `want` ("open"/"resolved"/"missing").
async function waitDaemon(baseUrl: string, token: string, scope: Scope, id: string, want: string, ms = 4000): Promise<{ reached: boolean; status: string }> {
  const t0 = Date.now();
  let last = "missing";
  while (Date.now() - t0 < ms) {
    const marks = await daemonMarks(baseUrl, token, scope);
    const m = marks.find((x) => x.id === id);
    last = m ? m.lifecycle.task_status : "missing";
    if (want === "missing" ? m === undefined : last === want) return { reached: true, status: last };
    await new Promise((r) => setTimeout(r, 200));
  }
  return { reached: false, status: last };
}

// Verifies page-side writes (create / resolve / delete) reach the daemon in real
// time, and that the page cache and daemon never drift. This is the inverse of
// live-push.spec.ts (which checks daemon → page).
test("page create → page resolve → page delete each reach the daemon (no drift)", async ({ loupe, daemon }) => {
  const page = await loupe.open();

  // ---- 1. CREATE on the page -------------------------------------------------
  await page.locator(".lp-ready-pick").click();
  const { cx, cy } = await pickTarget(page, "#hero-heading");
  await page.mouse.click(cx, cy);
  await page.locator(".lp-intent-field").fill("Roundtrip mark");
  await page.locator(".lp-intent-submit").click();
  await expect(page.locator(".lp-pin")).toHaveCount(1);

  const local = (await loupe.getLocalMarks()) as Array<{ id: string; project: Scope }>;
  const id = local[0]!.id;
  const scope = local[0]!.project;

  const created = await waitDaemon(daemon.baseUrl, daemon.token, scope, id, "open");
  console.log(`[CREATE]  page=open        daemon=${created.status}`);
  expect.soft(created.status, "daemon should receive the CREATE as open").toBe("open");

  // ---- 2. RESOLVE on the page (pin → detail → Done) --------------------------
  await page.locator(".lp-pin").click();
  await expect(page.locator(".detail")).toBeVisible();
  await page.locator(".detail .btn.primary").click();
  await expect(page.locator(".lp-pin.lp-pin--done")).toHaveCount(1);

  const resolved = await waitDaemon(daemon.baseUrl, daemon.token, scope, id, "resolved");
  console.log(`[RESOLVE] page=resolved    daemon=${resolved.status}`);
  expect.soft(resolved.status, "daemon should receive the page RESOLVE as resolved").toBe("resolved");

  // ---- 3. DELETE on the page (pin → detail → armed delete x2) ----------------
  await page.locator(".lp-pin").click();
  await expect(page.locator(".detail")).toBeVisible();
  await page.locator(".detail .btn.danger").click(); // arm
  await page.locator(".detail .btn.danger").click(); // confirm
  await expect(page.locator(".lp-pin")).toHaveCount(0);

  const deleted = await waitDaemon(daemon.baseUrl, daemon.token, scope, id, "missing");
  console.log(`[DELETE]  page=removed     daemon=${deleted.status === "missing" ? "removed" : deleted.status}`);
  expect.soft(deleted.reached, "daemon should receive the page DELETE (mark removed)").toBe(true);

  // ---- 4. Final drift check: page cache and daemon agree ---------------------
  const finalLocal = (await loupe.getLocalMarks()) as Array<{ id: string }>;
  const finalDaemon = await daemonMarks(daemon.baseUrl, daemon.token, scope);
  console.log(`[FINAL]   page marks=${finalLocal.length}  daemon marks=${finalDaemon.length}`);
  expect.soft(finalDaemon.length, "daemon must not retain a mark the page deleted (drift)").toBe(0);
});
