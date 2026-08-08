import { ControlStubPage } from "../../../components/control/ControlStubPage";

export default function SystemConfigPage() {
  return (
    <ControlStubPage
      title="Configuration"
      description="Secret/config metadata only — never secret values (MC-105)."
      wave="Wave C10 (MC-105)"
    />
  );
}