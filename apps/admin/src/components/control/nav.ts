export type ControlNavItem = {
  href: string;
  label: string;
  /** When true, page may not be fully wired yet */
  stub?: boolean;
};

export type ControlNavSection = {
  title: string;
  items: ControlNavItem[];
};

/** Plan 03 IA — all primary Control surfaces are wired. */
export const CONTROL_NAV: ControlNavSection[] = [
  {
    title: "CONTROL",
    items: [{ href: "/", label: "Command Center" }],
  },
  {
    title: "BUSINESS",
    items: [
      { href: "/economics", label: "Economics" },
      { href: "/players", label: "Players" },
      { href: "/cities", label: "Cities & Stakes" },
    ],
  },
  {
    title: "LIVE OPS",
    items: [
      { href: "/sessions", label: "Tables & Sessions" },
      { href: "/matchmaking", label: "Matchmaking" },
      { href: "/ai", label: "AI Operations" },
      { href: "/incidents", label: "Incidents" },
    ],
  },
  {
    title: "PROTOCOL",
    items: [
      { href: "/solvency", label: "Solvency" },
      { href: "/treasury", label: "Treasury" },
      { href: "/randomness", label: "Randomness" },
      { href: "/settlement", label: "Proofs & Settlement" },
      { href: "/chain", label: "Chain" },
    ],
  },
  {
    title: "SECURITY",
    items: [
      { href: "/risk", label: "Risk & Integrity" },
      { href: "/governance", label: "Governance" },
      { href: "/audit", label: "Audit" },
      { href: "/access", label: "Access" },
      { href: "/verify", label: "Verify" },
    ],
  },
  {
    title: "SYSTEM",
    items: [
      { href: "/system/services", label: "Services" },
      { href: "/system/deployments", label: "Deployments" },
      { href: "/system/config", label: "Configuration" },
    ],
  },
];
