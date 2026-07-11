import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The legacy pages run imperative DOM scripts that must execute exactly once.
  // Strict Mode double-invokes effects in dev, which would re-run the global
  // legacy scripts (redeclaring `let`/`const` at top level → errors), so we
  // disable it. The LegacyView component also guards against double execution.
  reactStrictMode: false,
};

export default nextConfig;
