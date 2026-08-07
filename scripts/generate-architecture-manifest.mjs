#!/usr/bin/env node
/**
 * WP-001 — Generate machine-readable current V2 architecture manifest.
 * Scans package.json trees, contracts, deployments, migrations, and .env.example.
 * No runtime behavior change.
 *
 * Usage: node ./scripts/generate-architecture-manifest.mjs
 *        pnpm manifest:architecture
 */

import { readFileSync, writeFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const MANIFEST_VERSION = "2.0.0";
const OUT_JSON = join(ROOT, "docs/architecture-manifest.v2.json");
const OUT_MD = join(ROOT, "docs/architecture-manifest.v2.md");

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function listDirs(path) {
  if (!existsSync(path)) return [];
  return readdirSync(path)
    .filter((name) => statSync(join(path, name)).isDirectory())
    .sort();
}

function listFiles(path, predicate = () => true) {
  if (!existsSync(path)) return [];
  return readdirSync(path)
    .filter((name) => predicate(name, join(path, name)))
    .sort();
}

function rel(path) {
  return relative(ROOT, path).split("\\").join("/");
}

function safeExec(cmd) {
  try {
    return execSync(cmd, { cwd: ROOT, encoding: "utf8" }).trim();
  } catch {
    return null;
  }
}

function findEntry(pkgDir) {
  const candidates = [
    "src/index.ts",
    "src/server.ts",
    "src/main.ts",
    "src/app/layout.tsx",
    "index.ts",
  ];
  for (const c of candidates) {
    const p = join(pkgDir, c);
    if (existsSync(p)) return rel(p);
  }
  return null;
}

function parsePortFromScript(script) {
  if (!script || typeof script !== "string") return null;
  const m = script.match(/--port\s+(\d+)/);
  return m ? Number(m[1]) : null;
}

function lockfileVersion(pkgName) {
  const lockPath = join(ROOT, "pnpm-lock.yaml");
  if (!existsSync(lockPath)) return null;
  const lock = readFileSync(lockPath, "utf8");
  const patterns = [
    new RegExp(`'${pkgName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}@([^']+)':`),
    new RegExp(`"${pkgName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}@([^"]+)":`),
    new RegExp(`^\\s{2}${pkgName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}@([^:]+):`, "m"),
  ];
  for (const p of patterns) {
    const m = lock.match(p);
    if (m) return m[1];
  }
  return null;
}

const CONTRACT_ROLES = {
  ArenaAccount: {
    role: "ArenaAccount",
    description: "CREATE2 gaming wallet per owner; holds idle USDC; GamePermission + lockBuyIn",
    generation: "v2",
  },
  ArenaAccountFactory: {
    role: "Factory",
    description: "Deploys ArenaAccount clones via CREATE2",
    generation: "v2",
  },
  ArenaVaultV2: {
    role: "Vault",
    description: "Session lock/settle custody; EIP-712 domain version 2",
    generation: "v2",
  },
  ArenaVaultV1: {
    role: "Vault",
    description: "Legacy InstantPermission vault; kept for smoke/reference",
    generation: "v1-legacy",
  },
  PokerSettlementHubV2: {
    role: "Hub",
    description: "Attestor quorum settle; EIP-712 FinalSettlement version 2",
    generation: "v2",
  },
  PokerSettlementHubV1: {
    role: "Hub",
    description: "Legacy settlement hub",
    generation: "v1-legacy",
  },
  TableRegistryV1: {
    role: "Registry",
    description: "Immutable game templates",
    generation: "v1",
  },
  CheckpointRegistryV1: {
    role: "Registry",
    description: "Sequenced checkpoint roots",
    generation: "v1",
  },
  RandomnessCoordinatorV1: {
    role: "Randomness",
    description: "Stub / mock VRF coordinator",
    generation: "v1",
  },
  MockUSDC: {
    role: "MockUSDC",
    description: "Anvil-only 6-decimal ERC-20 with faucet + EIP-2612 permit",
    generation: "test",
  },
};

const DEPLOYMENT_KEY_MAP = {
  usdc: "MockUSDC / USDC",
  arenaVault: "ArenaVaultV2",
  arenaVaultV1: "ArenaVaultV1",
  arenaAccountFactory: "ArenaAccountFactory",
  arenaAccountImplementation: "ArenaAccount",
  tableRegistry: "TableRegistryV1",
  settlementHub: "PokerSettlementHubV2",
  settlementHubV1: "PokerSettlementHubV1",
  checkpointRegistry: "CheckpointRegistryV1",
  randomnessCoordinator: "RandomnessCoordinatorV1",
  feeTreasury: "FeeTreasury (EOA/Safe address)",
};

const SERVICE_META = {
  "@mozetto/api": {
    id: "api",
    defaultPort: 4000,
    http: true,
    purpose: "REST: auth, lobby, wallet, Arena Account / arena-onchain, admin, verify",
  },
  "@mozetto/game-server": {
    id: "game-server",
    defaultPort: 4001,
    http: true,
    purpose: "Authoritative NLHE runtime + WebSockets",
  },
  "@mozetto/agent-runtime": {
    id: "agent-runtime",
    defaultPort: 4002,
    http: true,
    purpose: "AI seat decisions (shark / professor / fox / machine mock profiles)",
  },
  "@mozetto/dealer": {
    id: "dealer",
    defaultPort: 4003,
    http: true,
    purpose: "Dealer seed commitments, hand seeds, settlement attestation",
  },
  "@mozetto/replay-verifier": {
    id: "replay-verifier",
    defaultPort: 4004,
    http: true,
    purpose: "Replays canonical event hash chain; signs FinalSettlement",
  },
  "@mozetto/chain-indexer": {
    id: "chain-indexer",
    defaultPort: null,
    http: false,
    purpose: "Sole writer of vault→ledger mirrors; net-worth snapshots",
  },
  "@mozetto/settlement-worker": {
    id: "settlement-worker",
    defaultPort: null,
    http: false,
    purpose: "Proposals, attestations, hub settle, fee sweep, Glicko",
  },
};

const APP_META = {
  "@mozetto/web": {
    id: "web",
    defaultPort: 3000,
    purpose: "Next.js player UI (Wagmi/SIWE, Arena Account, seamless play, wallet, arenas, tables)",
  },
  "@mozetto/admin": {
    id: "admin",
    defaultPort: 3001,
    purpose: "Ops dashboard (token-gated)",
  },
};

const PACKAGE_META = {
  "@mozetto/game-rules": "Pure NLHE engine (TypeScript)",
  "@mozetto/database": "Migrations, ledger, matchmaking, on-chain match, arena-accounts, ratings IO",
  "@mozetto/ratings": "Glicko-2 rating math",
  "@mozetto/shared-types": "Zod schemas, seat-ticket hashes, WS types",
  "@mozetto/blockchain": "ABIs (V2), EIP-712 domains, chain config",
  "@mozetto/chain-manifest": "Per-network deployment JSON → generated TypeScript",
  "@mozetto/server-env": "Shared server CORS / cookie helpers",
  "@mozetto/config": "Shared theme + env loader helpers",
  "@mozetto/ui": "Shared brand tokens",
};

const ENV_GROUPS = {
  database: ["DATABASE_URL", "DATABASE_URL_DIRECT"],
  supabase: [
    "NEXT_PUBLIC_SUPABASE_URL",
    "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
    "SUPABASE_SECRET_KEY",
  ],
  demo: ["DEMO_USER_ID", "DEMO_AGENT_ID"],
  web: [
    "NEXT_PUBLIC_API_URL",
    "NEXT_PUBLIC_GAME_HTTP_URL",
    "NEXT_PUBLIC_GAME_WS_URL",
    "NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID",
    "NEXT_PUBLIC_CHAIN_ENV",
    "NEXT_PUBLIC_ANVIL_RPC_URL",
    "NEXT_PUBLIC_USDC_ADDRESS",
    "NEXT_PUBLIC_BASE_SEPOLIA_RPC_URL",
    "NEXT_PUBLIC_BASE_RPC_URL",
    "NEXT_PUBLIC_ARENA_VAULT_ADDRESS",
    "NEXT_PUBLIC_ARENA_ACCOUNT_FACTORY_ADDRESS",
  ],
  api: [
    "API_PORT",
    "SESSION_SECRET",
    "WEB_ORIGIN",
    "WEB_ORIGINS",
    "COOKIE_SAMESITE",
    "COOKIE_SECURE",
    "SIWE_DOMAIN",
    "SIWE_URI",
    "ADMIN_TOKEN",
    "AGENT_RUNTIME_URL",
    "DEALER_URL",
    "REPLAY_VERIFIER_URL",
  ],
  "game-server": ["GAME_SERVER_PORT", "REDIS_URL", "TABLE_LEASE_TTL_SEC"],
  "agent-runtime": [
    "AGENT_PORT",
    "SILICONFLOW_API_KEY",
    "SILICONFLOW_API_URL",
    "SILICONFLOW_MODEL",
  ],
  dealer: ["DEALER_PORT", "DEALER_ATTESTOR_PRIVATE_KEY", "ENABLE_MOCK_VRF"],
  "replay-verifier": ["REPLAY_VERIFIER_PORT", "REPLAY_ATTESTOR_PRIVATE_KEY"],
  chain: [
    "MOZETTO_CHAIN_ENV",
    "CHAIN_ID",
    "ANVIL_RPC_URL",
    "BASE_SEPOLIA_RPC_URL",
    "BASE_RPC_URL",
    "USDC_ADDRESS",
    "ARENA_VAULT_ADDRESS",
    "ARENA_VAULT_V1_ADDRESS",
    "ARENA_ACCOUNT_FACTORY_ADDRESS",
    "ARENA_ACCOUNT_IMPLEMENTATION_ADDRESS",
    "TABLE_REGISTRY_ADDRESS",
    "SETTLEMENT_HUB_ADDRESS",
    "CHECKPOINT_REGISTRY_ADDRESS",
    "RANDOMNESS_COORDINATOR_ADDRESS",
    "FEE_TREASURY_ADDRESS",
    "DEPLOYMENT_BLOCK",
  ],
  custody_keys: [
    "SESSION_RELAYER_PRIVATE_KEY",
    "INSTANT_SESSION_SIGNER_PRIVATE_KEY",
    "SETTLEMENT_PRIVATE_KEY",
    "GAME_ATTESTOR_PRIVATE_KEY",
  ],
  "settlement-worker": ["SETTLEMENT_POLL_MS"],
  "chain-indexer": [
    "INDEXER_CONFIRMATIONS",
    "INDEXER_POLL_MS",
    "INDEXER_RECONCILE_EVERY",
    "INDEXER_HEALTH_PORT",
    "INDEXER_REORG_LOOKBACK",
    "INDEXER_BLOCK_BATCH",
    "INDEXER_REBUILD",
    "INDEXER_NET_WORTH_MS",
  ],
};

function scanWorkspacePackages(kind, baseDir) {
  const out = [];
  for (const name of listDirs(baseDir)) {
    const dir = join(baseDir, name);
    const pjPath = join(dir, "package.json");
    if (!existsSync(pjPath)) continue;
    const pj = readJson(pjPath);
    const scripts = pj.scripts || {};
    const portFromScript =
      parsePortFromScript(scripts.dev) || parsePortFromScript(scripts.start);
    const meta =
      kind === "services"
        ? SERVICE_META[pj.name]
        : kind === "apps"
          ? APP_META[pj.name]
          : null;
    const item = {
      path: rel(dir),
      packageName: pj.name,
      purpose:
        (meta && meta.purpose) ||
        PACKAGE_META[pj.name] ||
        null,
      entrypoint: findEntry(dir),
      scripts,
    };
    if (kind === "services" || kind === "apps") {
      item.id = (meta && meta.id) || name;
      item.defaultPort =
        (meta && meta.defaultPort) ?? portFromScript ?? null;
      if (kind === "services") {
        item.http = meta ? meta.http : item.defaultPort != null;
      }
    }
    if (kind === "packages") {
      item.dependencies = Object.keys(pj.dependencies || {}).sort();
    }
    out.push(item);
  }
  return out.sort((a, b) => a.path.localeCompare(b.path));
}

function scanContracts() {
  const srcDir = join(ROOT, "contracts/src");
  const files = listFiles(srcDir, (n) => n.endsWith(".sol"));
  return files.map((file) => {
    const name = file.replace(/\.sol$/, "");
    const meta = CONTRACT_ROLES[name] || {
      role: "Unknown",
      description: "",
      generation: "unknown",
    };
    return {
      name,
      path: rel(join(srcDir, file)),
      role: meta.role,
      description: meta.description,
      generation: meta.generation,
    };
  });
}

function scanDeployments() {
  const depDir = join(ROOT, "packages/chain-manifest/deployments");
  const files = listFiles(depDir, (n) => n.endsWith(".json"));
  const networks = {};
  for (const file of files) {
    const data = readJson(join(depDir, file));
    const network = file.replace(/\.json$/, "");
    const addressKeys = {};
    for (const [key, contractHint] of Object.entries(DEPLOYMENT_KEY_MAP)) {
      if (key in data) {
        addressKeys[key] = {
          value: data[key],
          contract: contractHint,
        };
      }
    }
    networks[network] = {
      file: rel(join(depDir, file)),
      chainId: data.chainId ?? null,
      protocolVersion: data.protocolVersion ?? null,
      symbol: data.symbol ?? null,
      decimals: data.decimals ?? null,
      isTestAsset: data.isTestAsset ?? null,
      faucetEnabled: data.faucetEnabled ?? null,
      deploymentBlock: data.deploymentBlock ?? null,
      addresses: addressKeys,
      rawKeys: Object.keys(data).sort(),
    };
  }

  // Known networks without deployment files (codegen defaults only)
  for (const missing of ["baseSepolia", "base"]) {
    if (!networks[missing]) {
      networks[missing] = {
        file: null,
        note: "No deployments/*.json present; codegen defaults yield null V2 addresses",
        deployed: false,
      };
    }
  }

  return networks;
}

function scanMigrations() {
  const dir = join(ROOT, "packages/database/migrations");
  return listFiles(dir, (n) => /^\d{3}_.+\.sql$/.test(n)).map((file) => {
    const id = file.slice(0, 3);
    return {
      id,
      filename: file,
      path: rel(join(dir, file)),
    };
  });
}

function scanEnvExample() {
  const path = join(ROOT, ".env.example");
  if (!existsSync(path)) return { source: null, names: [], byGroup: {} };
  const text = readFileSync(path, "utf8");
  const names = [];
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    if (/^[A-Z][A-Z0-9_]*$/.test(key) && !names.includes(key)) {
      names.push(key);
    }
  }

  const assigned = new Set();
  const byGroup = {};
  for (const [group, keys] of Object.entries(ENV_GROUPS)) {
    byGroup[group] = keys.filter((k) => names.includes(k));
    for (const k of byGroup[group]) assigned.add(k);
  }
  byGroup.ungrouped = names.filter((k) => !assigned.has(k));
  return { source: ".env.example", names, byGroup };
}

function scanE2E() {
  const rootPj = readJson(join(ROOT, "package.json"));
  const scripts = rootPj.scripts || {};
  const e2e = [];
  for (const [name, cmd] of Object.entries(scripts)) {
    if (/^(e2e|smoke):/.test(name)) {
      const pathMatch = String(cmd).match(/(\.\/)?scripts\/[^\s]+/);
      e2e.push({
        script: name,
        command: cmd,
        path: pathMatch ? pathMatch[0].replace(/^\.\//, "") : null,
      });
    }
  }

  // Also list known script files even if not wired
  const scriptFiles = listFiles(join(ROOT, "scripts"), (n) =>
    /e2e|smoke|start-local/.test(n),
  ).map((f) => rel(join(ROOT, "scripts", f)));

  return { rootScripts: e2e, scriptFiles };
}

function scanToolVersions() {
  const rootPj = readJson(join(ROOT, "package.json"));
  const foundryToml = existsSync(join(ROOT, "contracts/foundry.toml"))
    ? readFileSync(join(ROOT, "contracts/foundry.toml"), "utf8")
    : "";
  const solc = (foundryToml.match(/solc\s*=\s*"([^"]+)"/) || [])[1] || null;

  const packages = {
    typescript: lockfileVersion("typescript") || rootPj.devDependencies?.typescript || null,
    viem: lockfileVersion("viem") || rootPj.devDependencies?.viem || null,
    next: lockfileVersion("next"),
    react: lockfileVersion("react"),
    "react-dom": lockfileVersion("react-dom"),
    fastify: lockfileVersion("fastify"),
    zod: lockfileVersion("zod"),
    pg: lockfileVersion("pg"),
    "@supabase/supabase-js": lockfileVersion("@supabase/supabase-js"),
    wagmi: lockfileVersion("wagmi"),
    tsx: lockfileVersion("tsx"),
  };

  return {
    packageManager: rootPj.packageManager || null,
    nodeRuntimeObserved: process.version.replace(/^v/, ""),
    pnpmObserved: safeExec("pnpm -v"),
    forgeObserved: safeExec("forge --version")?.split("\n")[0] || null,
    solc,
    foundry: {
      config: "contracts/foundry.toml",
      solc,
      optimizer: /optimizer\s*=\s*true/.test(foundryToml),
      via_ir: /via_ir\s*=\s*true/.test(foundryToml),
    },
    lockfile: existsSync(join(ROOT, "pnpm-lock.yaml"))
      ? "pnpm-lock.yaml"
      : null,
    lockfileVersion: (() => {
      const lock = existsSync(join(ROOT, "pnpm-lock.yaml"))
        ? readFileSync(join(ROOT, "pnpm-lock.yaml"), "utf8")
        : "";
      const m = lock.match(/lockfileVersion:\s*['"]?([^'"\n]+)/);
      return m ? m[1] : null;
    })(),
    packages,
    rust: {
      present: existsSync(join(ROOT, "Cargo.toml")) || existsSync(join(ROOT, "rust-toolchain.toml")),
      note: "No Rust engine workspace yet (Wave 3)",
    },
  };
}

function localTopology() {
  return {
    source: "scripts/start-local.sh + docs/PLATFORM_ARCHITECTURE.md",
    processes: [
      { name: "anvil", port: 8545, http: true, chainId: 31337 },
      { name: "web", port: 3000, http: true, package: "@mozetto/web" },
      { name: "admin", port: 3001, http: true, package: "@mozetto/admin" },
      { name: "api", port: 4000, http: true, package: "@mozetto/api" },
      { name: "game-server", port: 4001, http: true, package: "@mozetto/game-server" },
      { name: "agent-runtime", port: 4002, http: true, package: "@mozetto/agent-runtime" },
      { name: "dealer", port: 4003, http: true, package: "@mozetto/dealer" },
      { name: "replay-verifier", port: 4004, http: true, package: "@mozetto/replay-verifier" },
      { name: "chain-indexer", port: null, http: false, package: "@mozetto/chain-indexer" },
      { name: "settlement-worker", port: null, http: false, package: "@mozetto/settlement-worker" },
    ],
  };
}

function protocolStatus() {
  return {
    custody: "ArenaAccount V2 on Anvil only",
    sepoliaV2: "not deployed (deploy script exists; manifest addresses null)",
    mainnetV2: "not deployed (manifest addresses null; MockUSDC forbidden)",
    engine: "TypeScript NLHE (@mozetto/game-rules)",
    ai: "mock profiles Season-0 (shark / professor / fox / machine); Groq Season-1 not yet",
    products: [
      { id: "texas_holdem", variant: "nlhe_hu", seats: 2 },
      { id: "poker_classic", variant: "nlhe_6max", seats: 6 },
    ],
    vaultEip712Version: "2",
    hubEip712Version: "2",
    proseSource: "docs/PLATFORM_ARCHITECTURE.md",
  };
}

function buildManifest() {
  const generatedAt = new Date().toISOString();
  const gitSha = safeExec("git rev-parse HEAD");
  const gitBranch = safeExec("git rev-parse --abbrev-ref HEAD");

  const contracts = scanContracts();
  const deployments = scanDeployments();
  const services = scanWorkspacePackages("services", join(ROOT, "services"));
  const apps = scanWorkspacePackages("apps", join(ROOT, "apps"));
  const packages = scanWorkspacePackages("packages", join(ROOT, "packages"));
  const migrations = scanMigrations();
  const env = scanEnvExample();
  const e2e = scanE2E();
  const tools = scanToolVersions();

  const deployScripts = listFiles(join(ROOT, "contracts/script"), (n) =>
    n.endsWith(".sol"),
  ).map((f) => rel(join(ROOT, "contracts/script", f)));

  return {
    $schemaNote:
      "Mozetto current-architecture manifest (V2 baseline). Generated by scripts/generate-architecture-manifest.mjs",
    manifestVersion: MANIFEST_VERSION,
    protocolLabel: "Arena Account V2 / NLHE",
    generatedAt,
    git: { branch: gitBranch, sha: gitSha },
    sources: {
      prose: "docs/PLATFORM_ARCHITECTURE.md",
      envExample: ".env.example",
      chainDeployments: "packages/chain-manifest/deployments/",
      localBoot: "scripts/start-local.sh",
    },
    protocolStatus: protocolStatus(),
    localTopology: localTopology(),
    contracts: {
      root: "contracts/",
      src: "contracts/src/",
      foundry: "contracts/foundry.toml",
      deployScripts,
      items: contracts,
    },
    deployments,
    apps,
    services,
    packages,
    migrations: {
      directory: "packages/database/migrations",
      ordered: migrations,
      expectedRange: { from: "001", to: "016" },
      count: migrations.length,
    },
    env: {
      source: env.source,
      names: env.names,
      byGroup: env.byGroup,
      note: "Names only — values must never be committed; see .env.example",
    },
    dependencyVersions: tools,
    e2eAndSmoke: e2e,
    rootScripts: readJson(join(ROOT, "package.json")).scripts || {},
  };
}

function toMarkdown(manifest) {
  const lines = [];
  lines.push(`# Mozetto Architecture Manifest v${manifest.manifestVersion}`);
  lines.push("");
  lines.push(
    `> Auto-generated by \`pnpm manifest:architecture\` from repo inspection. Do not hand-edit; regenerate instead.`,
  );
  lines.push("");
  lines.push(`- **Generated:** ${manifest.generatedAt}`);
  lines.push(
    `- **Git:** \`${manifest.git.branch || "?"}\` @ \`${(manifest.git.sha || "").slice(0, 12)}\``,
  );
  lines.push(`- **Protocol:** ${manifest.protocolLabel}`);
  lines.push("");
  lines.push("## Protocol status");
  lines.push("");
  for (const [k, v] of Object.entries(manifest.protocolStatus)) {
    if (typeof v === "string") lines.push(`- **${k}:** ${v}`);
  }
  lines.push(
    `- **products:** ${manifest.protocolStatus.products.map((p) => `${p.id} (${p.variant}, ${p.seats}-max)`).join("; ")}`,
  );
  lines.push("");
  lines.push("## Local topology");
  lines.push("");
  lines.push("| Process | Port | HTTP | Package |");
  lines.push("|---------|------|------|---------|");
  for (const p of manifest.localTopology.processes) {
    lines.push(
      `| ${p.name} | ${p.port ?? "—"} | ${p.http ? "yes" : "no"} | ${p.package ?? "—"} |`,
    );
  }
  lines.push("");
  lines.push("## Contracts");
  lines.push("");
  lines.push("| Contract | Role | Generation | Path |");
  lines.push("|----------|------|------------|------|");
  for (const c of manifest.contracts.items) {
    lines.push(`| ${c.name} | ${c.role} | ${c.generation} | \`${c.path}\` |`);
  }
  lines.push("");
  lines.push("### Deploy scripts");
  lines.push("");
  for (const s of manifest.contracts.deployScripts) {
    lines.push(`- \`${s}\``);
  }
  lines.push("");
  lines.push("## Deployments");
  lines.push("");
  for (const [network, info] of Object.entries(manifest.deployments)) {
    lines.push(`### ${network}`);
    lines.push("");
    if (info.file) {
      lines.push(`- File: \`${info.file}\``);
      lines.push(`- chainId: ${info.chainId}`);
      lines.push(`- protocolVersion: ${info.protocolVersion}`);
      lines.push(`- asset: ${info.symbol} (decimals=${info.decimals})`);
      lines.push("");
      lines.push("| Manifest key | Contract | Address |");
      lines.push("|--------------|----------|---------|");
      for (const [key, meta] of Object.entries(info.addresses || {})) {
        lines.push(`| ${key} | ${meta.contract} | \`${meta.value}\` |`);
      }
    } else {
      lines.push(`- ${info.note || "not present"}`);
    }
    lines.push("");
  }
  lines.push("## Apps");
  lines.push("");
  lines.push("| Package | Path | Port | Entrypoint |");
  lines.push("|---------|------|------|------------|");
  for (const a of manifest.apps) {
    lines.push(
      `| ${a.packageName} | \`${a.path}\` | ${a.defaultPort ?? "—"} | \`${a.entrypoint ?? "—"}\` |`,
    );
  }
  lines.push("");
  lines.push("## Services");
  lines.push("");
  lines.push("| Package | Path | Port | HTTP | Entrypoint |");
  lines.push("|---------|------|------|------|------------|");
  for (const s of manifest.services) {
    lines.push(
      `| ${s.packageName} | \`${s.path}\` | ${s.defaultPort ?? "—"} | ${s.http ? "yes" : "no"} | \`${s.entrypoint ?? "—"}\` |`,
    );
  }
  lines.push("");
  lines.push("## Packages");
  lines.push("");
  lines.push("| Package | Path | Purpose |");
  lines.push("|---------|------|---------|");
  for (const p of manifest.packages) {
    lines.push(`| ${p.packageName} | \`${p.path}\` | ${p.purpose ?? ""} |`);
  }
  lines.push("");
  lines.push("## Migrations");
  lines.push("");
  for (const m of manifest.migrations.ordered) {
    lines.push(`- \`${m.id}\` — \`${m.filename}\``);
  }
  lines.push("");
  lines.push("## Environment variable names (from `.env.example`)");
  lines.push("");
  for (const [group, keys] of Object.entries(manifest.env.byGroup)) {
    if (!keys.length) continue;
    lines.push(`### ${group}`);
    lines.push("");
    for (const k of keys) lines.push(`- \`${k}\``);
    lines.push("");
  }
  lines.push("## Dependency / tool versions");
  lines.push("");
  lines.push(`- packageManager: \`${manifest.dependencyVersions.packageManager}\``);
  lines.push(`- solc: \`${manifest.dependencyVersions.solc}\``);
  lines.push(
    `- forge (observed): \`${manifest.dependencyVersions.forgeObserved ?? "n/a"}\``,
  );
  lines.push(
    `- node (observed): \`${manifest.dependencyVersions.nodeRuntimeObserved}\``,
  );
  lines.push("");
  lines.push("| Package | Lock version |");
  lines.push("|---------|--------------|");
  for (const [name, ver] of Object.entries(
    manifest.dependencyVersions.packages,
  )) {
    lines.push(`| ${name} | ${ver ?? "—"} |`);
  }
  lines.push("");
  lines.push("## E2E / smoke");
  lines.push("");
  for (const s of manifest.e2eAndSmoke.rootScripts) {
    lines.push(`- \`pnpm ${s.script}\` → \`${s.path ?? s.command}\``);
  }
  lines.push("");
  lines.push("Local boot: `./scripts/start-local.sh` (optionally `--redeploy`).");
  lines.push("");
  return lines.join("\n");
}

function main() {
  const manifest = buildManifest();
  writeFileSync(OUT_JSON, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  writeFileSync(OUT_MD, `${toMarkdown(manifest)}\n`, "utf8");
  console.log(`Wrote ${rel(OUT_JSON)}`);
  console.log(`Wrote ${rel(OUT_MD)}`);
  console.log(
    `Contracts=${manifest.contracts.items.length} services=${manifest.services.length} apps=${manifest.apps.length} packages=${manifest.packages.length} migrations=${manifest.migrations.count}`,
  );
}

main();
