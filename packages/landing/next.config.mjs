import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Monorepo deploy: the landing package imports the canonical token file from
  // ../../docs, so tracing must root at the repo, not the package.
  outputFileTracingRoot: join(here, "..", ".."),
};

export default nextConfig;
