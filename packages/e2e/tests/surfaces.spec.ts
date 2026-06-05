import { test, expect } from "../src/harness.js";
import { pickTarget } from "./helpers.js";

test("picker shows mode indicator, frame and breadcrumb, and Escape cancels", async ({
  loupe,
}) => {
  const page = await loupe.open();

  await page.locator(".lp-ready-pick").click();
  await expect(page.locator(".lp-mode-ind")).toBeVisible();

  await pickTarget(page, "#cta-secondary");
  await expect(page.locator(".lp-frame")).toBeVisible();
  await expect(page.locator(".lp-breadcrumb")).toBeVisible();

  await page.keyboard.press("Escape");
  await expect(page.locator(".lp-mode-ind")).toBeHidden();
});

test("intent submit is disabled until a comment is typed", async ({ loupe }) => {
  const page = await loupe.open();

  await page.locator(".lp-ready-pick").click();
  const { cx, cy } = await pickTarget(page, "#hero-heading");
  await page.mouse.click(cx, cy);
  await expect(page.locator(".lp-intent")).toBeVisible();

  await expect(page.locator(".lp-intent-submit")).toBeDisabled();

  await page.locator(".lp-intent-field").fill("x");
  await expect(page.locator(".lp-intent-submit")).toBeEnabled();
});

test("kind rail selects a kind", async ({ loupe }) => {
  const page = await loupe.open();

  await page.locator(".lp-ready-pick").click();
  const { cx, cy } = await pickTarget(page, "#cta-secondary");
  await page.mouse.click(cx, cy);
  await expect(page.locator(".lp-intent")).toBeVisible();

  const bugChip = page.locator('.lp-kindrail [role="option"][aria-label="bug"]');
  const styleChip = page.locator('.lp-kindrail [role="option"][aria-label="style"]');

  // Select "bug".
  await bugChip.click();
  await expect(
    bugChip.evaluate((el) => el.classList.contains("lp-kind-btn--sel") || el.getAttribute("aria-selected") === "true")
  ).resolves.toBe(true);

  // Switch to "style" — bug should no longer be selected.
  await styleChip.click();
  await expect(
    styleChip.evaluate((el) => el.classList.contains("lp-kind-btn--sel") || el.getAttribute("aria-selected") === "true")
  ).resolves.toBe(true);
  await expect(
    bugChip.evaluate((el) => el.classList.contains("lp-kind-btn--sel") || el.getAttribute("aria-selected") === "true")
  ).resolves.toBe(false);
});
