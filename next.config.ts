import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  poweredByHeader: false,
  experimental: { typedEnv: true },
  turbopack: { root: process.cwd() },
};

export default nextConfig;
