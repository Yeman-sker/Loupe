import { test, expect } from "../src/harness.js";
import { pickTarget } from "./helpers.js";

type AnomalySummary = { id: string; source: string; has_dom: boolean; locator_status?: string };
type AnomalyReport = AnomalySummary & { summary: string; resolve_result?: { locator_status?: string }; dom_html?: string };

test("manual anomaly hotkey (⌥⇧A) ships a replayable bundle to the daemon", async ({ loupe, daemon }) => {
  // Pairing: seed the daemon credentials the service worker reads to authenticate
  // the UI-triggered POST (PRD §10.4 pairing is simulated here, like the prefs seed).
  await loupe.seedStorage({ "loupe:v1:daemon": { base_url: daemon.baseUrl, token: daemon.token } });

  const page = await loupe.open();

  // Enter picking and hover a real fixture element so it becomes the anomaly target.
  await page.locator(".lp-ready-pick").click();
  await pickTarget(page, "#card-pricing-heading");
  await expect(page.locator(".lp-frame")).toBeVisible();

  // Flag "this is wrong" — the content runtime messages the SW, which POSTs the bundle.
  await page.keyboard.press("Alt+Shift+A");

  const auth = { authorization: `Bearer ${daemon.token}` };

  // The POST is async after the keypress; poll the daemon until the bundle lands.
  await expect
    .poll(
      async () => {
        const res = await fetch(`${daemon.baseUrl}/v1/anomalies`, { headers: auth });
        if (!res.ok) return 0;
        return ((await res.json()) as { anomalies: AnomalySummary[] }).anomalies.length;
      },
      { timeout: 10_000 },
    )
    .toBeGreaterThanOrEqual(1);

  // Read the summary, then the full report — the offline replay seed.
  const list = (await (await fetch(`${daemon.baseUrl}/v1/anomalies`, { headers: auth })).json()) as { anomalies: AnomalySummary[] };
  const summary = list.anomalies[0]!;
  expect(summary.source).toBe("manual");
  expect(summary.has_dom).toBe(true);
  expect(summary.locator_status).toBe("resolved");

  const report = (await (await fetch(`${daemon.baseUrl}/v1/anomalies/${summary.id}`, { headers: auth })).json()) as { anomaly: AnomalyReport };
  expect(report.anomaly.summary).toContain("Manual anomaly");
  expect(report.anomaly.resolve_result?.locator_status).toBe("resolved");
  // dom_html is split into a sibling file on disk; the report carries the flag, not the blob.
  expect(report.anomaly.dom_html).toBeUndefined();
});
