import { COMPONENT_LABELS, componentTone, toneClasses } from "@/lib/verify/labels";
import type { VerifyComponents } from "@/lib/verify/types";

/** Plain-language notes for optional / network-dependent checks. */
const COMPONENT_HELP: Partial<Record<keyof VerifyComponents, string>> = {
  session: "Sealed custody session exists for this match.",
  dealerCommitment: "Deck commitment was published before cards were dealt.",
  vrf:
    "Chainlink VRF randomness epoch. Local Anvil testing uses committed dealer seeds instead — missing here does not invalidate settlement.",
  eventRoots: "Public action log roots are published for this session.",
  handRoots: "Each settled hand has a digest you can re-check.",
  baseAnchor: "Checkpoint transaction(s) landed on the chain (Anvil or Base).",
  settlement: "Final stacks and rake were settled on-chain.",
  attestors: "Independent attestors signed the settlement proposal.",
  proofBatchInclusion:
    "Optional L1 proof-batch Merkle inclusion. Not published on local Anvil; required for mainnet Stage A batching.",
};

export function ComponentGrid({
  components,
  friendly = false,
}: {
  components?: VerifyComponents | null;
  /** When true, group required vs optional and show help text. */
  friendly?: boolean;
}) {
  if (!components) return null;
  const statuses = components;
  const keys = Object.keys(COMPONENT_LABELS) as (keyof VerifyComponents)[];

  if (!friendly) {
    return (
      <ul className="grid gap-2 sm:grid-cols-2">
        {keys.map((k) => {
          const s = statuses[k] ?? (k === "proofBatchInclusion" ? "missing" : undefined);
          if (!s) return null;
          return (
            <li
              key={k}
              className={`flex items-center justify-between rounded border px-3 py-2 text-[12.5px] ${toneClasses(componentTone(s))}`}
            >
              <span>{COMPONENT_LABELS[k]}</span>
              <span className="font-mono uppercase tracking-wide">{s}</span>
            </li>
          );
        })}
      </ul>
    );
  }

  const required = keys.filter((k) => k !== "vrf" && k !== "proofBatchInclusion");
  const optional = keys.filter((k) => k === "vrf" || k === "proofBatchInclusion");

  function row(k: keyof VerifyComponents) {
    const s = statuses[k] ?? (k === "proofBatchInclusion" ? "missing" : undefined);
    if (!s) return null;
    const optionalMissing = (k === "vrf" || k === "proofBatchInclusion") && s === "missing";
    return (
      <li
        key={k}
        className={`rounded border px-3 py-2.5 ${toneClasses(optionalMissing ? "muted" : componentTone(s))}`}
      >
        <div className="flex items-center justify-between gap-3 text-[12.5px]">
          <span className="font-medium">{COMPONENT_LABELS[k]}</span>
          <span className="font-mono uppercase tracking-wide">
            {optionalMissing ? "n/a here" : s}
          </span>
        </div>
        {COMPONENT_HELP[k] ? (
          <p className="mt-1.5 text-[12px] leading-snug text-[#8A8A8A]">{COMPONENT_HELP[k]}</p>
        ) : null}
      </li>
    );
  }

  return (
    <div className="space-y-4">
      <div>
        <p className="mb-2 text-[12px] text-[#8A8A8A]">
          Checks that matter for trusting this match’s money and public replay.
        </p>
        <ul className="grid gap-2 sm:grid-cols-2">{required.map(row)}</ul>
      </div>
      <div>
        <p className="mb-2 text-[12px] text-[#8A8A8A]">
          Extra network checks — often absent on local Anvil; they do not flip the match to unverified.
        </p>
        <ul className="grid gap-2 sm:grid-cols-2">{optional.map(row)}</ul>
      </div>
    </div>
  );
}
