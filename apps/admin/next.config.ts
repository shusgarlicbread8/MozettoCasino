import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  eslint: { ignoreDuringBuilds: true },
  transpilePackages: ["@mozetto/governance", "@mozetto/chain-manifest"],
};

export default nextConfig;
