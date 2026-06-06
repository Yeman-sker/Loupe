// DEV-BUILD ONLY entry. content.dev.js imports this instead of app.js so the
// runtime mounts with anomaly-capture instrumentation attached. The production
// content.js imports app.js directly and passes no instrumentation.

import { mount, type MountOptions, type SurfaceApp } from "../runtime/app.js";
import { createAnomalyInstrumentation } from "./anomaly-capture.js";

export function mountDev(opts: MountOptions): Promise<SurfaceApp> {
  return mount({
    ...opts,
    instrumentation: createAnomalyInstrumentation({
      onResult: (result) => console.info(`[loupe] anomaly capture ${result.ok ? `ok ${result.id ?? ""}` : `failed: ${result.error ?? ""}`}`),
    }),
  });
}
