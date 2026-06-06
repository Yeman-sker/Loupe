import { test, expect } from "../src/harness.js";
import { pickTarget } from "./helpers.js";

test("golden path: pick → intent → pin → detail → resolve → view-all", async ({
  loupe,
}) => {
  const page = await loupe.open();

  // 1. Ready panel is visible.
  await expect(page.locator(".lp-ready")).toBeVisible();

  // 2. Enter picking mode.
  await page.locator(".lp-ready-pick").click();
  await expect(page.locator(".lp-mode-ind")).toBeVisible();

  // 3. Hover over the hero heading — breadcrumb and frame should appear.
  const { cx, cy } = await pickTarget(page, "#hero-heading");
  await expect(page.locator(".lp-breadcrumb")).toBeVisible();
  await expect(page.locator(".lp-frame")).toBeVisible();

  // 4. Click to confirm the pick — intent panel opens.
  await page.mouse.click(cx, cy);
  await expect(page.locator(".lp-intent")).toBeVisible();

  // 5. Choose kind "bug".
  await page.locator('.lp-kindrail [role="option"][aria-label="bug"]').click();
  const bugChip = page.locator('.lp-kindrail [role="option"][aria-label="bug"]');
  await expect(
    bugChip.evaluate((el) => el.classList.contains("lp-kind-btn--sel") || el.getAttribute("aria-selected") === "true")
  ).resolves.toBe(true);

  // 6. Type the comment — submit becomes enabled.
  await page.locator(".lp-intent-field").fill("Fix the hero heading copy");
  await expect(page.locator(".lp-intent-submit")).toBeEnabled();

  // 7. Submit — one pin appears with number "1".
  await page.locator(".lp-intent-submit").click();
  await expect(page.locator(".lp-pin")).toHaveCount(1);
  await expect(page.locator(".lp-pin-num")).toHaveText("1");

  // 8. Assert chrome.storage.local contains the mark.
  const marks = await loupe.getLocalMarks();
  expect(marks).toHaveLength(1);
  expect(JSON.stringify(marks)).toContain("Fix the hero heading copy");
  expect(JSON.stringify(marks)).toContain("bug");

  // 9. Open detail popover via pin click.
  await page.locator(".lp-pin").click();
  await expect(page.locator(".detail")).toBeVisible();
  await expect(page.locator(".d-comment")).toContainText("Fix the hero heading copy");

  // 10. Mark done — detail closes and pin gets resolved class.
  await page.locator(".detail .btn.primary").click();
  await expect(page.locator(".detail")).toBeHidden();
  await expect(page.locator(".lp-pin.lp-pin--done")).toHaveCount(1);

  // 11. View-all panel lists the mark. Resolved marks are hidden behind the
  //     "Show done" toggle, so enable it before asserting the item is present.
  await page.locator(".lp-ready-viewall").click();
  await expect(page.locator(".viewall")).toBeVisible();
  await page.locator(".va-toggle").click();
  await expect(page.locator(".va-item")).toHaveCount(1);
  await expect(page.locator(".va-c")).toContainText("Fix the hero heading copy");
});

test("mark syncs to the sandbox daemon through stored pairing", async ({ loupe }) => {
  const page = await loupe.open();

  const pairing = await loupe.getDaemonPairing();
  expect(JSON.stringify(pairing)).toContain("token");

  // Drive a minimal save using the secondary CTA (near top of page).
  await page.locator(".lp-ready-pick").click();
  const { cx, cy } = await pickTarget(page, "#cta-secondary");
  await page.mouse.click(cx, cy);
  await page.locator(".lp-intent-field").fill("Sync me");
  await page.locator(".lp-intent-submit").click();
  await expect(page.locator(".lp-pin")).toHaveCount(1);

  // Verify local storage.
  expect(await loupe.getLocalMarks()).toHaveLength(1);

  // The UI wakes the extension service worker after save. The background worker
  // reads chrome.storage.local["loupe:v1:daemon"] and performs authenticated sync;
  // the test never passes a token into the wake message.
  await expect.poll(async () => JSON.stringify(await loupe.getDaemonMarks()), { timeout: 5_000 }).toContain("Sync me");
});
