import { ControlStubPage } from "../../components/control/ControlStubPage";

export default function ChainPage() {
  return (
    <ControlStubPage
      title="Chain"
      description="Manifest, contract code hashes, RPC health, indexer lag. API: GET /v1/admin/chain."
      wave="Wave C8 (MC-081)"
    />
  );
}
