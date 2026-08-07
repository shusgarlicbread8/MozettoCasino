/** True when the web app is pointed at local Anvil. */
export function isLocalAnvilDebug(): boolean {
  const env = (process.env.NEXT_PUBLIC_CHAIN_ENV || "").toLowerCase();
  return env === "anvil" || env === "local";
}
