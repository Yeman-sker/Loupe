import { prepExtension } from "../scripts/prep-ext.js";

// Build + patch the test-copy extension once before any test runs. The harness
// loads `<repo>/packages/e2e/.test-ext` per test; this guarantees it is fresh.
export default async function globalSetup(): Promise<void> {
  const extPath = await prepExtension();
  console.log(`[global-setup] prepared test extension: ${extPath}`);
}
