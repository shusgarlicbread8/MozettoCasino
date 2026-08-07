import Link from "next/link";
import { CliEvidence } from "@/components/verify/CliEvidence";
import { ComponentGrid } from "@/components/verify/ComponentGrid";
import { HashRow } from "@/components/verify/HashRow";
import { Section, VerifyShell } from "@/components/verify/VerifyShell";
import { StatusBadge } from "@/components/verify/StatusBadge";
import { explorerTx, fetchVerifyHand, shortHash } from "@/lib/verify/api";

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

  return (
    <VerifyShell
      title={`Hand #${data?.handNumber ?? "?"}`}
      subtitle={<span className="font-mono break-all text-[13px]">{data?.handId ?? handId}</span>}
    >
      {error ? <p className="mb-6 text-sm text-red-400">{error}</p> : null}

      {data ? (
        <div className="space-y-8 text-sm">
          {data.session ? (
            <StatusBadge result={data.session.result} legacy={data.session.status} />
          ) : null}

          <p className="text-[#8A8A8A]">
            Session{" "}
            <Link href={data.sessionHref} className="font-mono">
              {shortHash(data.sessionId, 14, 8)}
            </Link>
          </p>

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

          {data.session?.components ? (
            <Section title="Session components">
              <ComponentGrid components={data.session.components} />
            </Section>
          ) : null}

          <Section title="Public events">
            {data.events.length === 0 ? (
              <p className="text-[#8A8A8A]">No canonical events for this hand.</p>
            ) : (
              <ul className="space-y-1.5 font-mono text-[12px] text-[#9A9A9A]">
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

          <Section title="Local verification">
            <CliEvidence hints={data.session?.localVerify} />
          </Section>
        </div>
      ) : null}
    </VerifyShell>
  );
}
