/** Keeps the frontend workspace server-only boundary explicit while compiling the local backend package. */

import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  agentRules: false,
  devIndicators: false,
  // Keep the full server-side Lucide icon registry out of Turbopack's per-route graph.
  serverExternalPackages: ["lucide-react/dynamicIconImports.mjs"],
  transpilePackages: ["vibe-prompting"],
};

export default nextConfig;
