/**
 * Randomness checks via @mozetto/randomness-verifier (no dealer/operator trust).
 */
import {
  defaultVectorsDir,
  runRandomnessVerification,
  verifyCardOpening,
} from "@mozetto/randomness-verifier";
import type { CheckResult, PublicVerifyPackage } from "./types.js";
import { asHex } from "./util.js";

export function verifyRandomnessSection(
  randomness: NonNullable<PublicVerifyPackage["randomness"]>,
): CheckResult[] {
  const checks: CheckResult[] = [];

  if (randomness.runGoldenSuite) {
    const report = runRandomnessVerification({
      vectorsDir: randomness.vectorsDir ?? defaultVectorsDir(),
    });
    checks.push({
      id: "randomness.goldenSuite",
      ok: report.ok,
      detail: report.ok
        ? `MOZETTO_RANDOMNESS_V2 golden+mutations ${report.passed}/${report.passed + report.failed} pass`
        : `randomness golden suite failed: ${report.failed} check(s)`,
    });
    // Surface first failing golden check for health report clarity
    for (const c of report.checks.filter((x) => !x.ok).slice(0, 3)) {
      checks.push({
        id: `randomness.golden.${c.id}`,
        ok: false,
        detail: c.detail,
      });
    }
  }

  if (randomness.opening) {
    const o = randomness.opening;
    const result = verifyCardOpening({
      handId: asHex(o.handId, "handId"),
      deckRoot: asHex(o.deckRoot, "deckRoot"),
      position: o.position,
      cardCode: o.cardCode,
      cardSalt: asHex(o.cardSalt, "cardSalt"),
      proof: o.proof,
    });
    checks.push({
      id: "randomness.opening",
      ok: result.ok,
      detail: result.ok
        ? `card opening ok leaf=${result.cardLeaf.slice(0, 18)}…`
        : `card opening failed: ${result.detail}`,
    });
  }

  if (!randomness.runGoldenSuite && !randomness.opening) {
    checks.push({
      id: "randomness",
      ok: true,
      skipped: true,
      detail: "randomness section present but empty",
    });
  }

  return checks;
}
