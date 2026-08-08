import { ControlPageHeader } from "./ControlPageHeader";

export function ControlStubPage({
  title,
  description,
  wave,
}: {
  title: string;
  description: string;
  wave: string;
}) {
  return (
    <div>
      <ControlPageHeader title={title} description={description} status="PENDING" />
      <div className="ctrl-stub-note">
        Surface scaffolded for Control IA (Plan 03). Full wiring lands in {wave}. Existing
        Plan-13 APIs remain authoritative where already present — this page does not invent
        custody or balance powers.
      </div>
    </div>
  );
}
