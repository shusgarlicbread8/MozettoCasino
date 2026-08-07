import { RESULT_COPY, toneClasses } from "@/lib/verify/labels";
import type { PublicVerifyStatus } from "@/lib/verify/types";

export function StatusBadge({
  result,
  legacy,
}: {
  result?: PublicVerifyStatus | null;
  legacy?: "verified" | "incomplete" | "failed";
}) {
  const status: PublicVerifyStatus =
    result ??
    (legacy === "verified"
      ? "VERIFIED"
      : legacy === "failed"
        ? "VERIFICATION_FAILED"
        : "INCOMPLETE_PUBLIC_DATA");
  const copy = RESULT_COPY[status];
  return (
    <div className="space-y-2">
      <span
        className={`inline-block rounded border px-2.5 py-1 text-xs font-medium ${toneClasses(copy.tone)}`}
      >
        {copy.label}
      </span>
      <p className="text-[13px] leading-relaxed text-[#8A8A8A]">{copy.blurb}</p>
    </div>
  );
}
