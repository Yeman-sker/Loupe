import { test, expect } from "../src/harness.js";
import { pickTarget } from "./helpers.js";

// Verifies the daemon-authoritative live-push loop end-to-end in a real,
// extension-loaded Chrome: the page never polls and the user never interacts —
// a second client resolving the mark through the daemon must flip the open
// page's pin to "done" via the SW-owned SSE stream relayed over the Port.
test("live push: second client resolve flips the open page's pin to done, no interaction", async ({ loupe, daemon }) => {
  const page = await loupe.open();

  // 1. Create a mark on the page (real pick → intent → save).
  await page.locator(".lp-ready-pick").click();
  const { cx, cy } = await pickTarget(page, "#hero-heading");
  await page.mouse.click(cx, cy);
  await page.locator(".lp-intent-field").fill("Live push target");
  await page.locator(".lp-intent-submit").click();
  await expect(page.locator(".lp-pin")).toHaveCount(1);
  await expect(page.locator(".lp-pin.lp-pin--done")).toHaveCount(0);

  // 2. Wait until it has synced to the daemon so a second client can resolve it.
  await expect
    .poll(async () => JSON.stringify(await loupe.getDaemonMarks()), { timeout: 5_000 })
    .toContain("Live push target");

  const marks = (await loupe.getLocalMarks()) as Array<{ id: string; project: { project_id: string } }>;
  const mark = marks[0]!;

  // 3. A SECOND client (agent / CLI / other tab) resolves via the daemon directly.
  //    The page is given no message and the user does nothing.
  const res = await fetch(`${daemon.baseUrl}/v1/marks/${mark.id}/resolve?project_id=${mark.project.project_id}`, {
    method: "POST",
    headers: { authorization: `Bearer ${daemon.token}` },
  });
  expect(res.status).toBe(200);

  // 4. The open page must converge on daemon truth via the SSE push alone.
  await expect(page.locator(".lp-pin.lp-pin--done")).toHaveCount(1, { timeout: 5_000 });
});

// Verifies a second client DELETE is pushed and removes the pin live.
test("live push: second client delete removes the open page's pin", async ({ loupe, daemon }) => {
  const page = await loupe.open();

  await page.locator(".lp-ready-pick").click();
  const { cx, cy } = await pickTarget(page, "#hero-heading");
  await page.mouse.click(cx, cy);
  await page.locator(".lp-intent-field").fill("Delete me live");
  await page.locator(".lp-intent-submit").click();
  await expect(page.locator(".lp-pin")).toHaveCount(1);

  await expect
    .poll(async () => JSON.stringify(await loupe.getDaemonMarks()), { timeout: 5_000 })
    .toContain("Delete me live");

  const marks = (await loupe.getLocalMarks()) as Array<{ id: string; project: { project_id: string } }>;
  const mark = marks[0]!;

  const res = await fetch(`${daemon.baseUrl}/v1/marks/${mark.id}?project_id=${mark.project.project_id}`, {
    method: "DELETE",
    headers: { authorization: `Bearer ${daemon.token}` },
  });
  expect(res.status).toBe(200);

  await expect(page.locator(".lp-pin")).toHaveCount(0, { timeout: 5_000 });
});
