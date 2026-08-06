import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ["@mozetto/shared-types", "@mozetto/chain-manifest"],
  // Existing pages use loose `any` types; don't block production deploys on lint debt.
  eslint: { ignoreDuringBuilds: true },
  turbopack: {
    resolveExtensions: [".ts", ".tsx", ".js", ".jsx", ".mjs", ".json"],
  },
  webpack: (config) => {
    // Wagmi's optional Tempo connector references `accounts`; stub it for Next builds.
    config.resolve = config.resolve ?? {};
    config.resolve.alias = {
      ...config.resolve.alias,
      accounts: false,
    };
    config.resolve.extensionAlias = {
      ".js": [".ts", ".tsx", ".js"],
      ...(config.resolve.extensionAlias ?? {}),
    };
    return config;
  },
};

export default nextConfig;
