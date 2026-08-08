import Link from "next/link";
import { CliEvidence } from "@/components/verify/CliEvidence";
import { ComponentGrid } from "@/components/verify/ComponentGrid";
import { HashRow } from "@/components/verify/HashRow";
import { Section, VerifyShell } from "@/components/verify/VerifyShell";
import { StatusBadge } from "@/components/verify/StatusBadge";
import { explorerTx, fetchVerifyHand, shortHash } from "@/lib/verify/api";
import { isGameVerified } from "@/lib/verify/trust";

export async function generateMetadata({ params }: { params: Promise<{ handId: string }> }) {
  const { handId } = await params;
  return { title: `Verify hand ${shortHash(handId, 10, 6)} — Mozetto` };
}

export default async function VerifyHandPage({ params }: { params: Promise<{ handId: string }> }) {
  const { handId } = await params;
  let data = null as Awaited<ReturnType<typeof fetchVerifyHand>>;
  let error: string | null = null;
  try {
    data = await fetchVerifyHand(handId);
  } catch (e) {
    error = e instanceof Error ? e.message : "failed";
  }

  if (!data && !error) {
    return (
      <VerifyShell title="Hand not found" subtitle={<span className="font-mono break-all">{handId}</span>}>
        <p className="text-sm text-[#8A8A8A]">No hand root matched this id or hash.</p>
      </VerifyShell>
    );
  }

  const chainId = data?.session?.chainId ?? 0;
  const verified = isGameVerified(data?.session?.result);
  const chainLabel =
    chainId === 31337 ? "Local Anvil" : chainId === 84532 ? "Base Sepolia" : chainId === 8453 ? "Base" : `Chain ${chainId}`;

  return (
    <VerifyShell
      title={`Hand #${data?.handNumber ?? "?"}`}
      subtitle={
        <span>
          Plain-language check for this hand ·{" "}
          <span className="font-mono break-all text-[13px]">{data?.handId ?? handId}</span>
        </span>
      }
    >
      {error ? <p className="mb-6 text-sm text-red-400">{error}</p> : null}

      {data ? (
        <div className="space-y-8 text-sm">
          {data.session ? (
            <StatusBadge result={data.session.result} legacy={data.session.status} />
          ) : null}

          <div className="rounded-xl border border-white/[0.08] bg-white/[0.02] px-4 py-4 space-y-2">
            <p className="text-[15px] leading-relaxed text-[#E8EEE9]">
              {verified
                ? "You can trust this hand’s public outcome for settlement: stacks, attestors, and a chain checkpoint are in place."
                : "This hand is not fully verified yet — settlement or chain anchors may still be publishing."}
            </p>
            <p className="text-[13px] leading-relaxed text-[#8A8A8A]">
              Network: <span className="text-[#cfcfcf]">{chainLabel}</span>
              {chainId === 31337
                ? ". Local Anvil uses committed dealer seeds (not live Chainlink VRF) and does not publish L1 proof-batches — that is expected and still matches the Season 1 Anvil plan."
                : "."}{" "}
              Session{" "}
              <Link href={data.sessionHref} className="font-mono text-[#9AE6C4]">
                {shortHash(data.sessionId, 14, 8)}
              </Link>
            </p>
          </div>

          <Section title="In plain English">
            <ol className="list-decimal space-y-2 pl-5 text-[13.5px] leading-relaxed text-[#cfcfcf]">
              <li>Both players locked buy-ins into the vault before play.</li>
              <li>This hand’s public actions were hashed into a hand digest.</li>
              <li>
                {data.checkpoint?.tx_hash
                  ? "A checkpoint transaction on-chain anchors those digests."
                  : "Waiting for a checkpoint transaction to anchor digests."}
              </li>
              <li>
                {data.session?.settlement?.txHash
                  ? "Settlement paid final stacks (and platform fees) on-chain."
                  : "Settlement has not been confirmed on-chain yet."}
              </li>
            </ol>
          </Section>

          <Section title="Trust checklist">
            {data.session?.components ? (
              <ComponentGrid components={data.session.components} friendly />
            ) : (
              <p className="text-[#8A8A8A]">Session components not loaded.</p>
            )}
          </Section>

          <Section title="Hand digests">
            <dl>
              <HashRow label="hand root" value={data.handRoot} />
              {data.checkpoint ? (
                <>
                  <HashRow label="event root" value={data.checkpoint.event_root} />
                  <HashRow label="balance root" value={data.checkpoint.balance_root} />
                  <HashRow
                    label="checkpoint tx"
                    value={data.checkpoint.tx_hash}
                    href={
                      data.checkpoint.tx_hash
                        ? explorerTx(chainId, data.checkpoint.tx_hash)
                        : null
                    }
                  />
                  <HashRow label="vrf epoch" value={data.checkpoint.randomness_epoch} />
                </>
              ) : (
                <p className="text-[#8A8A8A]">No checkpoint tied to this hand number yet.</p>
              )}
            </dl>
          </Section>

          <Section title="Public events">
            <p className="mb-3 text-[12.5px] text-[#8A8A8A]">
              Technical log of what the table published for this hand (actions, streets, showdown).
            </p>
            {data.events.length === 0 ? (
              <p className="text-[#8A8A8A]">No canonical events for this hand.</p>
            ) : (
              <ul className="max-h-80 space-y-1.5 overflow-y-auto font-mono text-[12px] text-[#9A9A9A]">
                {data.events.map((e) => (
                  <li key={`${e.sequence}-${e.event_hash}`} className="break-all">
                    #{e.sequence} {e.event_type} {shortHash(e.event_hash)}
                    {e.schema_kind ? <span className="text-[#5A5A5A]"> · {e.schema_kind}</span> : null}
                  </li>
                ))}
              </ul>
            )}
          </Section>

          {data.session?.settlement ? (
            <Section title="Settlement">
              <dl>
                <HashRow
                  label="attestors"
                  value={`${data.session.settlement.attestorCount} · ${data.session.settlement.proposalStatus ?? "—"}`}
                />
                <HashRow
                  label="settle tx"
                  value={data.session.settlement.txHash}
                  href={
                    data.session.settlement.txHash
                      ? explorerTx(chainId, data.session.settlement.txHash)
                      : null
                  }
                />
                {data.session.settlement.digest ? (
                  <>
                    <HashRow label="event root" value={data.session.settlement.digest.eventRoot} />
                    <HashRow label="hand root" value={data.session.settlement.digest.handRoot} />
                    <HashRow label="balance root" value={data.session.settlement.digest.balanceRoot} />
                  </>
                ) : null}
              </dl>
            </Section>
          ) : null}

          <Section title="Advanced / local tools">
            <CliEvidence hints={data.session?.localVerify} />
          </Section>
        </div>
      ) : null}
    </VerifyShell>
  );
}
