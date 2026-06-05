import type { Page } from "@playwright/test";

export async function pickTarget(
  page: Page,
  selector: string
): Promise<{ cx: number; cy: number }> {
  const box = await page.locator(selector).boundingBox();
  if (!box) throw new Error(`no bounding box for ${selector}`);
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  await page.mouse.move(cx, cy);
  return { cx, cy };
}
