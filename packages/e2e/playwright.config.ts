import { defineConfig } from "@playwright/test";

// MV3 extension testing constraints:
//  - The extension must be loaded into a *persistent* context launched headed
//    (or with --headless=new). That launch happens per-test inside the harness
//    fixture (src/harness.ts), not here.
//  - The Loupe daemon binds a fixed loopback port (7373, hard-coded in the UI's
//    health probe) and the harness seeds a per-test userDataDir, so tests cannot
//    run in parallel. workers:1 + fullyParallel:false is mandatory.
export default defineConfig({
  testDir: "./tests",
  globalSetup: "./src/global-setup.ts",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  use: {
    trace: "on-first-retry",
  },
});
