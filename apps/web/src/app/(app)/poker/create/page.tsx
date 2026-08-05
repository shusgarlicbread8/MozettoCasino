"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/** Ranked Arena uses Find Match — free table creation is retired for now. */
export default function CreateTableRedirect() {
  const router = useRouter();
  useEffect(() => {
    router.replace("/poker");
  }, [router]);
  return (
    <main style={{ padding: 40, color: "#7A7A7A", fontSize: 14 }}>
      Redirecting to Ranked Arena…
    </main>
  );
}
