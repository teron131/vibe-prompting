/** Keeps the frontend workspace server-only boundary explicit while compiling the local backend package. */

import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  agentRules: false,
  devIndicators: false,
  transpilePackages: ["vibe-prompting"],
};

export default nextConfig;
