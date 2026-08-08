export type ControlHealth =
  | "HEALTHY"
  | "DEGRADED"
  | "CRITICAL"
  | "PENDING"
  | "STALE"
  | "UNAVAILABLE"
  | "DIVERGED"
  | "UNDER_REVIEW"
  | "PAUSED";

export type ControlEnvironment = "LOCAL" | "SEPOLIA" | "MAINNET" | "UNKNOWN";

export type ControlRange = "1d" | "7d" | "30d";

export type AdminMe = {
  subject: string;
  role: string;
  capabilities: string[];
  authMethod: "wallet" | "token";
  environment?: ControlEnvironment;
};
