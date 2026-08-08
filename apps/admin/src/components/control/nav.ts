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

/** Plan 03 IA — evolve existing pages; stubs marked until later waves. */
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
      { href: "/cities", label: "Cities & Stakes", stub: true },
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
      { href: "/settlement", label: "Proofs & Settlement", stub: true },
      { href: "/chain", label: "Chain", stub: true },
    ],
  },
  {
    title: "SECURITY",
    items: [
      { href: "/risk", label: "Risk & Integrity", stub: true },
      { href: "/governance", label: "Governance" },
      { href: "/audit", label: "Audit" },
      { href: "/access", label: "Access", stub: true },
      { href: "/verify", label: "Verify" },
    ],
  },
  {
    title: "SYSTEM",
    items: [
      { href: "/system/services", label: "Services", stub: true },
      { href: "/system/deployments", label: "Deployments", stub: true },
      { href: "/system/config", label: "Configuration" },
    ],
  },
];
