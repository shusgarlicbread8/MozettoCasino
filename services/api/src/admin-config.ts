/**
 * MC-105 — Configuration metadata (env key names present/missing only).
 * Never returns secret values to the browser.
 */

export type ConfigKeyMeta = {
  key: string;
  category: string;
  description: string;
  required: boolean;
  configured: boolean;
  /** Present only when we cannot infer rotation — never a secret value. */
  note?: string;
};

/** Curated Control-relevant env keys — names only in API responses. */
export const CONTROL_CONFIG_KEYS: Array<{
  key: string;
  category: string;
  description: string;
  required?: boolean;
}> = [
  { key: "DATABASE_URL", category: "data", description: "Primary Postgres DSN", required: true },
  { key: "REDIS_URL", category: "data", description: "Redis / queue backend" },
  { key: "ADMIN_SESSION_SECRET", category: "auth", description: "Admin SIWE session signing secret", required: true },
  { key: "ADMIN_SUPERADMIN_ADDRESSES", category: "auth", description: "Wallet allowlist for Control login" },
  { key: "ADMIN_READ_TOKEN", category: "auth", description: "Break-glass read token" },
  { key: "ADMIN_MUTATE_TOKEN", category: "auth", description: "Break-glass mutate token" },
  { key: "ADMIN_TOKEN", category: "auth", description: "Legacy combined admin token" },
  { key: "GROQ_API_KEY", category: "ai", description: "Groq provider API key" },
  { key: "SESSION_SECRET", category: "auth", description: "Player session signing secret" },
  { key: "SIWE_DOMAIN", category: "auth", description: "SIWE domain binding" },
  { key: "SIWE_URI", category: "auth", description: "SIWE URI binding" },
  { key: "WEB_ORIGIN", category: "platform", description: "Primary web origin" },
  { key: "WEB_ORIGINS", category: "platform", description: "Allowed web origins (CSV)" },
  { key: "API_URL", category: "platform", description: "Public API base URL" },
  { key: "RPC_URL", category: "chain", description: "Primary chain RPC endpoint" },
  { key: "CHAIN_ID", category: "chain", description: "Active chain id" },
  { key: "ARENA_VAULT_ADDRESS", category: "chain", description: "Arena vault contract" },
  { key: "INDEXER_URL", category: "services", description: "Chain indexer health URL" },
  { key: "GAME_SERVER_URL", category: "services", description: "Game server health URL" },
  { key: "AGENT_RUNTIME_URL", category: "services", description: "Agent runtime health URL" },
  { key: "DEALER_URL", category: "services", description: "Dealer service health URL" },
  { key: "REPLAY_VERIFIER_URL", category: "services", description: "Replay verifier health URL" },
  { key: "SUPABASE_URL", category: "data", description: "Supabase project URL" },
  { key: "SUPABASE_SERVICE_ROLE_KEY", category: "data", description: "Supabase service role key" },
];

function envConfigured(key: string): boolean {
  const value = process.env[key];
  return typeof value === "string" && value.trim().length > 0;
}

export function buildConfigMetadataSnapshot(): {
  generatedAt: string;
  keys: ConfigKeyMeta[];
  summary: { total: number; configured: number; missingRequired: number };
  note: string;
} {
  const keys: ConfigKeyMeta[] = CONTROL_CONFIG_KEYS.map((def) => {
    const configured = envConfigured(def.key);
    return {
      key: def.key,
      category: def.category,
      description: def.description,
      required: def.required ?? false,
      configured,
      note: configured ? "configured" : def.required ? "missing (required)" : "not set",
    };
  });

  const configured = keys.filter((k) => k.configured).length;
  const missingRequired = keys.filter((k) => k.required && !k.configured).length;

  return {
    generatedAt: new Date().toISOString(),
    keys,
    summary: {
      total: keys.length,
      configured,
      missingRequired,
    },
    note: "Secret values are never returned — key presence only.",
  };
}
