"use client";

export function ComingSoonBadge() {
  return (
    <span className="rounded-md border border-white/10 bg-white/5 px-2 py-0.5 font-mono text-[9px] tracking-[0.12em] text-[#8a8a8a]">
      COMING SOON
    </span>
  );
}

export function ComingSoonPage({
  title,
  blurb,
}: {
  title: string;
  blurb: string;
}) {
  return (
    <div className="mx-auto max-w-2xl px-8 py-24 text-center">
      <ComingSoonBadge />
      <h1 className="mt-5 text-3xl font-semibold tracking-tight">{title}</h1>
      <p className="mt-3 text-[15px] leading-relaxed text-[#7a7a7a]">{blurb}</p>
      <a
        href="/poker"
        className="mt-8 inline-block rounded-[10px] bg-[#00E676] px-6 py-3 text-sm font-semibold text-[#050505]"
      >
        Play NLHE instead
      </a>
    </div>
  );
}
