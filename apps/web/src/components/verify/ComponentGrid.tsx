import { COMPONENT_LABELS, componentTone, toneClasses } from "@/lib/verify/labels";
import type { VerifyComponents } from "@/lib/verify/types";

export function ComponentGrid({ components }: { components?: VerifyComponents | null }) {
  if (!components) return null;
  const keys = Object.keys(COMPONENT_LABELS) as (keyof VerifyComponents)[];
  return (
    <ul className="grid gap-2 sm:grid-cols-2">
      {keys.map((k) => {
        const s = components[k] ?? (k === "proofBatchInclusion" ? "missing" : undefined);
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
