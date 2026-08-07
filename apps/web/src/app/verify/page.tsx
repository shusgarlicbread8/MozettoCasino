import { CliEvidence } from "@/components/verify/CliEvidence";
import { Section, VerifyShell } from "@/components/verify/VerifyShell";
import { VerifySearch } from "@/components/verify/VerifySearch";
import { WasmFixturePanel } from "@/components/verify/WasmFixturePanel";

export const metadata = {
  title: "Verify Game — Mozetto",
  description: "Resolve session and hand hashes, inspect VRF/proofs/settlement, run local fixture verification.",
};

export default function VerifyHomePage() {
  return (
    <VerifyShell
      title="Verify Game"
      subtitle="Resolve a session or hand by id or public hash. Component statuses stay honest — pending data never shows as verified."
    >
      <div className="space-y-10">
        <VerifySearch />

        <Section title="What you can check">
          <ul className="space-y-2 text-[14px] leading-relaxed text-[#8A8A8A]">
            <li>Session descriptor, chain id, and public contract addresses</li>
            <li>Dealer secret root, VRF request/fulfillment, engine &amp; profile hashes</li>
            <li>Event / hand / balance roots and checkpoint transactions</li>
            <li>Settlement digest, attestor count, settlement tx</li>
            <li>Local WASM or TypeScript fixture replay (WP-030 / WP-035)</li>
          </ul>
        </Section>

        <Section title="Local fixture verifier">
          <WasmFixturePanel />
        </Section>

        <Section title="CLI evidence (no API trust)">
          <CliEvidence />
        </Section>
      </div>
    </VerifyShell>
  );
}
