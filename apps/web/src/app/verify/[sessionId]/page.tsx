import Link from "next/link";
import { CliEvidence } from "@/components/verify/CliEvidence";
import { ComponentGrid } from "@/components/verify/ComponentGrid";
import { HashRow } from "@/components/verify/HashRow";
import { Section, VerifyShell } from "@/components/verify/VerifyShell";
import { StatusBadge } from "@/components/verify/StatusBadge";
import { explorerTx, fetchVerifySession, shortHash } from "@/lib/verify/api";

export async function generateMetadata({ params }: { params: Promise<{ sessionId: string }> }) {
  const { sessionId } = await params;
  return { title: `Verify ${shortHash(sessionId, 10, 6)} — Mozetto` };
}

export default async function VerifySessionPage({ params }: { params: Promise<{ sessionId: string }> }) {
  const { sessionId } = await params;
  let data = null as Awaited<ReturnType<typeof fetchVerifySession>>;
  let error: string | null = null;
  try {
    data = await fetchVerifySession(sessionId);
  } catch (e) {
    error = e instanceof Error ? e.message : "failed";
  }

  if (!data && !error) {
    return (
      <VerifyShell title="Session not found" subtitle={<span className="font-mono break-all">{sessionId}</span>}>
        <p className="text-sm text-[#8A8A8A]">No on-chain session mirror matched this id.</p>
      </VerifyShell>
    );
  }

  const chainId = data?.chainId ?? 0;

  return (
    <VerifyShell
      title="Verify match"
      subtitle={<span className="font-mono break-all text-[13px]">{sessionId}</span>}
    >
      {error ? <p className="mb-6 text-sm text-red-400">{error}</p> : null}

      {data ? (
        <div className="space-y-8 text-sm">
          <StatusBadge result={data.result} legacy={data.status} />
          <div className="text-[#8A8A8A]">
            session <span className="text-[#cfcfcf]">{data.sessionStatus}</span>
            {data.protocolVersion ? (
              <>
                {" "}
                · protocol <span className="font-mono text-[#cfcfcf]">{data.protocolVersion}</span>
              </>
            ) : null}
          </div>

          <Section title="Component status">
            <ComponentGrid components={data.components} />
          </Section>

          <Section title="Chain & contracts">
            <dl>
              <HashRow label="network" value={`${data.chainName} (${data.chainId})`} />
              <HashRow label="vault" value={data.vaultAddress} />
              <HashRow label="template" value={data.gameTemplateId} />
              {data.contracts
                ? Object.entries(data.contracts)
                    .filter(([, v]) => Boolean(v))
                    .map(([k, v]) => <HashRow key={k} label={k} value={v} />)
                : null}
            </dl>
          </Section>

          <Section title="Public hashes">
            <dl>
              <HashRow label="engine" value={data.hashes?.engineHash} />
              <HashRow label="profiles" value={data.hashes?.profileSetHash} />
              <HashRow
                label="dealer root"
                value={data.hashes?.dealerRoot ?? data.dealerCommitment.dealer_root}
              />
              <HashRow label="event root" value={data.hashes?.lastEventRoot} />
              <HashRow label="balance root" value={data.hashes?.lastBalanceRoot} />
              <HashRow label="sequence" value={data.hashes?.lastSequence} />
            </dl>
          </Section>

          <Section title="VRF / randomness">
            {data.vrf.length === 0 ? (
              <p className="text-[#8A8A8A]">No VRF requests published for this session.</p>
            ) : (
              <ul className="space-y-2 font-mono text-[12.5px]">
                {data.vrf.map((v) => {
                  const tx = v.fulfill_tx ? explorerTx(chainId, v.fulfill_tx) : null;
                  return (
                    <li key={v.epoch_id} className="break-all">
                      <span className="text-[#666]">{v.epoch_id}</span> — {v.status}
                      {v.vrf_word ? <span className="text-[#8A8A8A]"> · word {shortHash(v.vrf_word)}</span> : null}
                      {tx ? (
                        <>
                          {" "}
                          <a href={tx} target="_blank" rel="noreferrer">
                            fulfill tx
                          </a>
                        </>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            )}
          </Section>

          <Section title="Hand roots">
            {data.handRoots.length === 0 ? (
              <p className="text-[#8A8A8A]">None yet.</p>
            ) : (
              <ul className="space-y-1.5 font-mono text-[12.5px]">
                {data.handRoots.map((h) => (
                  <li key={h.hand_id}>
                    <Link href={`/verify/hand/${encodeURIComponent(h.hand_id)}`}>
                      #{h.hand_number} {shortHash(h.hand_root, 18, 8)}
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Section>

          <Section title="Checkpoints">
            {data.checkpoints.length === 0 ? (
              <p className="text-[#8A8A8A]">None yet.</p>
            ) : (
              <ul className="space-y-2 font-mono text-[12.5px]">
                {data.checkpoints.map((c) => {
                  const tx = c.tx_hash ? explorerTx(chainId, c.tx_hash) : null;
                  return (
                    <li key={String(c.sequence)} className="break-all">
                      seq {c.sequence}
                      <span className="text-[#666]">
                        {" "}
                        · event {shortHash(c.event_root)} · bal {shortHash(c.balance_root)}
                      </span>
                      {tx ? (
                        <>
                          {" "}
                          <a href={tx} target="_blank" rel="noreferrer">
                            tx
                          </a>
                        </>
                      ) : (
                        <span className="text-amber-500/80"> · unanchored</span>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </Section>

          <Section title="Proof-batch inclusion">
            {!data.proofBatchInclusion || data.proofBatchInclusion.count === 0 ? (
              <p className="text-[#8A8A8A]">
                {data.proofBatchInclusion?.note ??
                  "No proof-batch inclusion proofs published for this session yet."}
              </p>
            ) : (
              <div className="space-y-3">
                <p className="text-[#8A8A8A]">{data.proofBatchInclusion.note}</p>
                <ul className="space-y-3 font-mono text-[12px]">
                  {data.proofBatchInclusion.proofs.map((p) => {
                    const batchTx = p.txHash ? explorerTx(chainId, p.txHash) : null;
                    return (
                      <li
                        key={`${p.batchSequence}-${p.leafIndex}-${p.checkpointRoot}`}
                        className="break-all rounded border border-white/[0.06] px-3 py-2"
                      >
                        <div>
                          batch #{p.batchSequence} · leaf {p.leafIndex}
                          {p.verifiedLocally ? (
                            <span className="text-emerald-500/80"> · verified locally</span>
                          ) : (
                            <span className="text-red-400"> · local verify failed</span>
                          )}
                        </div>
                        <div className="text-[#666] mt-1">
                          checkpoint {shortHash(p.checkpointRoot, 14, 8)} · global{" "}
                          {shortHash(p.globalRoot, 14, 8)}
                        </div>
                        {p.proofBatchHash ? (
                          <div className="text-[#666]">
                            proofBatchHash {shortHash(p.proofBatchHash, 14, 8)}
                          </div>
                        ) : null}
                        <div className="text-[#5A5A5A] mt-1">
                          merkle path ({p.proof.length} step{p.proof.length === 1 ? "" : "s"})
                          {p.proof.length > 0
                            ? `: ${p.proof
                                .map(
                                  (s) =>
                                    `${s.isLeft ? "L" : "R"}(${shortHash(s.sibling, 8, 4)})`,
                                )
                                .join(" → ")}`
                            : ""}
                        </div>
                        {batchTx ? (
                          <a href={batchTx} target="_blank" rel="noreferrer">
                            registry tx
                          </a>
                        ) : null}
                      </li>
                    );
                  })}
                </ul>
              </div>
            )}
          </Section>

          <Section title="Event tip">
            {!data.eventTip || data.eventTip.length === 0 ? (
              <p className="text-[#8A8A8A]">No canonical events indexed yet.</p>
            ) : (
              <ul className="space-y-1.5 font-mono text-[12px] text-[#9A9A9A]">
                {data.eventTip.map((e) => (
                  <li key={`${e.sequence}-${e.event_hash}`} className="break-all">
                    #{e.sequence} {e.event_type} {shortHash(e.event_hash)}
                  </li>
                ))}
              </ul>
            )}
          </Section>

          <Section title="Settlement digest">
            <dl>
              <HashRow
                label="attestors"
                value={`${data.settlement.attestorCount} · ${data.settlement.proposalStatus ?? "—"}`}
              />
              {data.settlement.digest ? (
                <>
                  <HashRow label="final seq" value={data.settlement.digest.finalSequence} />
                  <HashRow label="event root" value={data.settlement.digest.eventRoot} />
                  <HashRow label="hand root" value={data.settlement.digest.handRoot} />
                  <HashRow label="balance root" value={data.settlement.digest.balanceRoot} />
                  <HashRow label="rake" value={data.settlement.digest.totalRake} />
                </>
              ) : null}
              <HashRow
                label="settle tx"
                value={data.settlement.txHash}
                href={
                  data.settlement.txHash ? explorerTx(chainId, data.settlement.txHash) : null
                }
              />
              <HashRow
                label="open tx"
                value={data.openTxHash}
                href={data.openTxHash ? explorerTx(chainId, data.openTxHash) : null}
              />
            </dl>
          </Section>

          <Section title="Players">
            <ul className="font-mono text-[12.5px]">
              {data.players.map((p) => (
                <li key={p.wallet_address} className="break-all py-0.5">
                  seat {p.seat ?? "?"} — {p.wallet_address}
                  {p.agent_profile_hash ? (
                    <span className="text-[#5A5A5A]"> · profile {shortHash(p.agent_profile_hash)}</span>
                  ) : null}
                </li>
              ))}
            </ul>
          </Section>

          <Section title="Local verification">
            <CliEvidence hints={data.localVerify} />
          </Section>
        </div>
      ) : null}
    </VerifyShell>
  );
}
