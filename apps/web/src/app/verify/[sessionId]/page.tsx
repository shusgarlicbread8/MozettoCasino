import Link from "next/link";

const API_URL = (process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000").replace(/\/$/, "");

type VerifyPayload = {
  sessionId: string;
  chainId: number;
  chainName: string;
  vaultAddress: string | null;
  gameTemplateId: string;
  dealerCommitment: { dealer_root?: string; secret_count?: number };
  vrf: Array<{ epoch_id: string; status: string; vrf_word?: string; fulfill_tx?: string }>;
  handRoots: Array<{ hand_id: string; hand_number: number; hand_root: string }>;
  checkpoints: Array<{
    sequence: string;
    hand_number: number | null;
    event_root: string;
    balance_root: string;
    tx_hash: string | null;
  }>;
  players: Array<{ wallet_address: string; seat: number | null }>;
  settlement: { txHash: string | null; proposalStatus: string | null; attestorCount: number };
  status: "verified" | "incomplete";
  sessionStatus: string;
  openTxHash: string | null;
  openedAt: string | null;
  settledAt: string | null;
};

function basescanTx(chainId: number, txHash: string) {
  const base = chainId === 8453 ? "https://basescan.org" : "https://sepolia.basescan.org";
  return `${base}/tx/${txHash}`;
}

async function fetchVerify(sessionId: string): Promise<VerifyPayload | null> {
  const res = await fetch(`${API_URL}/v1/verify/session/${encodeURIComponent(sessionId)}`, {
    cache: "no-store",
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`verify fetch ${res.status}`);
  return res.json();
}

export default async function VerifySessionPage({ params }: { params: Promise<{ sessionId: string }> }) {
  const { sessionId } = await params;
  let data: VerifyPayload | null = null;
  let error: string | null = null;
  try {
    data = await fetchVerify(sessionId);
  } catch (e) {
    error = e instanceof Error ? e.message : "failed";
  }

  if (!data && !error) {
    return (
      <div className="mx-auto max-w-3xl px-8 py-16">
        <h1 className="text-2xl font-semibold">Session not found</h1>
        <p className="mt-2 text-[#8A8A8A] text-sm font-mono">{sessionId}</p>
        <Link href="/fairness" className="mt-8 inline-block text-sm">
          Fairness docs →
        </Link>
      </div>
    );
  }

  const showBasescan = data && (data.chainId === 8453 || data.chainId === 84532);

  return (
    <div className="mx-auto max-w-3xl px-8 py-16">
      <h1 className="text-2xl font-semibold tracking-tight">Verify match</h1>
      <p className="mt-1 text-sm text-[#8A8A8A] font-mono break-all">{sessionId}</p>

      {error && <p className="mt-4 text-red-400 text-sm">{error}</p>}

      {data && (
        <div className="mt-8 space-y-6 text-sm">
          <div className="flex items-center gap-3">
            <span
              className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${
                data.status === "verified" ? "bg-emerald-900/40 text-emerald-400" : "bg-amber-900/40 text-amber-400"
              }`}
            >
              {data.status}
            </span>
            <span className="text-[#8A8A8A]">session {data.sessionStatus}</span>
          </div>

          <section>
            <h2 className="text-xs uppercase tracking-wide text-[#666] mb-2">Chain</h2>
            <dl className="grid gap-1 font-mono text-[13px]">
              <div>
                <dt className="inline text-[#666]">network </dt>
                <dd className="inline">{data.chainName} ({data.chainId})</dd>
              </div>
              <div>
                <dt className="inline text-[#666]">vault </dt>
                <dd className="inline break-all">{data.vaultAddress ?? "—"}</dd>
              </div>
              <div>
                <dt className="inline text-[#666]">template </dt>
                <dd className="inline break-all">{data.gameTemplateId}</dd>
              </div>
            </dl>
          </section>

          <section>
            <h2 className="text-xs uppercase tracking-wide text-[#666] mb-2">Dealer commitment</h2>
            <p className="font-mono text-[13px] break-all">{data.dealerCommitment.dealer_root ?? "—"}</p>
          </section>

          {data.vrf.length > 0 && (
            <section>
              <h2 className="text-xs uppercase tracking-wide text-[#666] mb-2">VRF</h2>
              <ul className="space-y-2 font-mono text-[13px]">
                {data.vrf.map((v) => (
                  <li key={v.epoch_id}>
                    {v.epoch_id} — {v.status}
                    {v.fulfill_tx && showBasescan && (
                      <>
                        {" "}
                        <a href={basescanTx(data.chainId, v.fulfill_tx)} target="_blank" rel="noreferrer">
                          tx
                        </a>
                      </>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          )}

          <section>
            <h2 className="text-xs uppercase tracking-wide text-[#666] mb-2">Hand roots</h2>
            {data.handRoots.length === 0 ? (
              <p className="text-[#8A8A8A]">None yet.</p>
            ) : (
              <ul className="font-mono text-[13px] space-y-1">
                {data.handRoots.map((h) => (
                  <li key={h.hand_id}>
                    #{h.hand_number} {h.hand_root.slice(0, 18)}…
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section>
            <h2 className="text-xs uppercase tracking-wide text-[#666] mb-2">Checkpoints</h2>
            {data.checkpoints.length === 0 ? (
              <p className="text-[#8A8A8A]">None yet.</p>
            ) : (
              <ul className="font-mono text-[13px] space-y-1">
                {data.checkpoints.map((c) => (
                  <li key={String(c.sequence)}>
                    seq {c.sequence}
                    {c.tx_hash && showBasescan && (
                      <>
                        {" "}
                        <a href={basescanTx(data.chainId, c.tx_hash)} target="_blank" rel="noreferrer">
                          tx
                        </a>
                      </>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section>
            <h2 className="text-xs uppercase tracking-wide text-[#666] mb-2">Settlement</h2>
            <dl className="font-mono text-[13px] space-y-1">
              <div>
                attestors: {data.settlement.attestorCount} · proposal: {data.settlement.proposalStatus ?? "—"}
              </div>
              {data.settlement.txHash && (
                <div className="break-all">
                  tx:{" "}
                  {showBasescan ? (
                    <a href={basescanTx(data.chainId, data.settlement.txHash)} target="_blank" rel="noreferrer">
                      {data.settlement.txHash}
                    </a>
                  ) : (
                    data.settlement.txHash
                  )}
                </div>
              )}
              {data.openTxHash && showBasescan && (
                <div>
                  open:{" "}
                  <a href={basescanTx(data.chainId, data.openTxHash)} target="_blank" rel="noreferrer">
                    {data.openTxHash.slice(0, 20)}…
                  </a>
                </div>
              )}
            </dl>
          </section>

          <section>
            <h2 className="text-xs uppercase tracking-wide text-[#666] mb-2">Players</h2>
            <ul className="font-mono text-[13px]">
              {data.players.map((p) => (
                <li key={p.wallet_address}>
                  seat {p.seat ?? "?"} — {p.wallet_address}
                </li>
              ))}
            </ul>
          </section>
        </div>
      )}

      <Link href="/fairness" className="mt-10 inline-block text-sm text-[#8A8A8A]">
        How verification works →
      </Link>
    </div>
  );
}
