import Link from "next/link";
import type { ReactNode } from "react";

export function VerifyShell({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="mx-auto max-w-3xl px-6 py-14 sm:px-8 sm:py-16">
      <div className="mb-2 font-mono text-[10px] tracking-[0.16em] text-[#4A4A4A]">VERIFY GAME · WP-090</div>
      <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">{title}</h1>
      {subtitle ? <div className="mt-2 text-sm text-[#8A8A8A]">{subtitle}</div> : null}
      <div className="mt-8">{children}</div>
      <div className="mt-12 flex flex-wrap gap-x-5 gap-y-2 text-sm text-[#8A8A8A]">
        <Link href="/verify">Verify home</Link>
        <Link href="/fairness">Fairness</Link>
        <Link href="/how-it-works">How it works</Link>
      </div>
    </div>
  );
}

export function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="border-t border-white/[0.06] pt-5">
      <h2 className="mb-3 text-[11px] font-medium uppercase tracking-[0.14em] text-[#666]">{title}</h2>
      {children}
    </section>
  );
}
