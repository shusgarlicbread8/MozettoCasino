"use client";

import { Suspense } from "react";
import { useParams, useSearchParams } from "next/navigation";
import { MatchResultPanel } from "@/components/result/MatchResultPanel";
import { color } from "@/lib/design-tokens";

function ResultInner() {
  const params = useParams<{ sessionId: string }>();
  const search = useSearchParams();
  const sessionId = decodeURIComponent(params.sessionId || "");
  const handId = search.get("hand");

  if (!sessionId) {
    return <main style={{ padding: 32, color: color.textMuted }}>Missing session id.</main>;
  }

  return (
    <main style={{ flex: 1 }}>
      <MatchResultPanel sessionId={sessionId} handId={handId} />
    </main>
  );
}

export default function ResultPage() {
  return (
    <Suspense
      fallback={<main style={{ padding: 32, color: color.textMuted }}>Loading result…</main>}
    >
      <ResultInner />
    </Suspense>
  );
}
