import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ["@mozetto/shared-types"],
};

export default nextConfig;
