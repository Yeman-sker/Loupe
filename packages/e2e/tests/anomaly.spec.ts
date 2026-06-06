import { test, expect } from "../src/harness.js";
import { project_scope_from_url } from "../../extension/src/ui/storage/lib-storage.js";
import { pickTarget } from "./helpers.js";

type AnomalySummary = { id: string; source: string; has_dom: boolean; locator_status?: string };
type ProjectScope = { project_id: string; session_id: string; workspace_root_hash?: string; origin?: string; url?: string; route_key?: string };
type AnomalyReport = AnomalySummary & { summary: string; expected?: string; actual?: string; project?: ProjectScope; resolve_result?: { locator_status?: string }; dom_html?: string };
type AnomalyGetPayload = { anomaly: AnomalyReport; replay: { anomaly_id: string; dom_path?: string; expected?: string; actual?: string } };

test("manual anomaly hotkey (⌥⇧A) ships a replayable bundle to the daemon", async ({ loupe, daemon }) => {
  // Pairing: seed the daemon credentials the service worker reads to authenticate
  // the UI-triggered POST (PRD §10.4 pairing is simulated here, like the prefs seed).
  await loupe.seedStorage({ "loupe:v1:daemon": { base_url: daemon.baseUrl, token: daemon.token } });

  const page = await loupe.open();

  // Enter picking and hover a real fixture element so it becomes the anomaly target.
  await page.locator(".lp-ready-pick").click();
  await pickTarget(page, "#card-pricing-heading");
  await expect(page.locator(".lp-frame")).toBeVisible();

  let promptCount = 0;
  page.on("dialog", async (dialog) => {
    promptCount += 1;
    if (promptCount === 1) {
      expect(dialog.message()).toContain("what did you expect");
      await dialog.accept("Expected pricing heading to stay selected");
      return;
    }
    await dialog.accept();
  });

  // Flag "this is wrong" — the content runtime messages the SW, which POSTs the bundle.
  await page.keyboard.press("Alt+Shift+A");

  const auth = { authorization: `Bearer ${daemon.token}` };

  // The POST is async after the keypress; poll the daemon until the bundle lands.
  await expect
    .poll(
      async () => {
        const scope = await anomalyScope(page);
        const res = await fetch(`${daemon.baseUrl}/v1/anomalies?${scope.toString()}`, { headers: auth });
        if (!res.ok) return 0;
        return ((await res.json()) as { anomalies: AnomalySummary[] }).anomalies.length;
      },
      { timeout: 15_000 },
    )
    .toBeGreaterThanOrEqual(1);

  // Read the summary, then the full report — the offline replay seed.
  const scope = await anomalyScope(page);
  const list = (await (await fetch(`${daemon.baseUrl}/v1/anomalies?${scope.toString()}`, { headers: auth })).json()) as { anomalies: AnomalySummary[] };
  const summary = list.anomalies[0]!;
  expect(summary.source).toBe("manual");
  expect(summary.has_dom).toBe(true);
  expect(summary.locator_status).toBe("resolved");

  const report = (await (await fetch(`${daemon.baseUrl}/v1/anomalies/${summary.id}?${scope.toString()}`, { headers: auth })).json()) as AnomalyGetPayload;
  expect(report.anomaly.summary).toContain("Manual anomaly");
  expect(report.anomaly.resolve_result?.locator_status).toBe("resolved");
  expect(report.anomaly.expected).toBe("Expected pricing heading to stay selected");
  expect(report.replay.anomaly_id).toBe(summary.id);
  expect(report.replay.dom_path).toContain("dom.html");
  // dom_html is split into a sibling file on disk; the report carries the flag, not the blob.
  expect(report.anomaly.dom_html).toBeUndefined();
});

async function anomalyScope(page: { url: () => string; title: () => Promise<string> }): Promise<URLSearchParams> {
  const project = project_scope_from_url({ url: page.url(), title: await page.title() });
  const params = new URLSearchParams();
  for (const key of ["project_id", "session_id", "workspace_root_hash", "origin", "url", "route_key"] as const) {
    const field = project[key];
    if (typeof field === "string" && field.length > 0) params.set(key, field);
  }
  return params;
}
