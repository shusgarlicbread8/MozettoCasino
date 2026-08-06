import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ["@mozetto/shared-types"],
  // Existing pages use loose `any` types; don't block production deploys on lint debt.
  eslint: { ignoreDuringBuilds: true },
  webpack: (config) => {
    // Wagmi's optional Tempo connector references `accounts`; stub it for Next builds.
    config.resolve = config.resolve ?? {};
    config.resolve.alias = {
      ...config.resolve.alias,
      accounts: false,
    };
    return config;
  },
};

export default nextConfig;
