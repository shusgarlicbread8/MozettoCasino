#!/usr/bin/env bash
# WP-054 — Nitro EIF build stub.
#
# REQUIRES: Amazon Linux + nitro-cli + Nitro-capable EC2.
# This script exits non-zero on non-Nitro hosts so CI never invents PCRs.

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
IMAGE_TAG="${ENCLAVE_DOCKER_URI:-mozetto-dealer-enclave:local}"
OUT_EIF="${ENCLAVE_EIF_PATH:-$ROOT/services/dealer-enclave/nitro/mozetto-dealer.eif}"

if ! command -v nitro-cli >/dev/null 2>&1; then
  cat <<'EOF' >&2
[WP-054] nitro-cli not found.

This scaffold cannot produce a production enclave image without AWS Nitro Enclaves.
Use ENCLAVE_ATTESTATION_MODE=mock for Anvil/local.

On a Nitro host:
  1. docker build -f services/dealer-enclave/Dockerfile.enclave -t mozetto-dealer-enclave:local .
  2. nitro-cli build-enclave --docker-uri mozetto-dealer-enclave:local --output-file mozetto-dealer.eif
  3. nitro-cli describe-eif --eif-path mozetto-dealer.eif
  4. Publish PCR0/1/2 and bind KMS key policy
EOF
  exit 2
fi

echo "[WP-054] Building EIF from ${IMAGE_TAG} → ${OUT_EIF}"
nitro-cli build-enclave --docker-uri "${IMAGE_TAG}" --output-file "${OUT_EIF}"
nitro-cli describe-eif --eif-path "${OUT_EIF}"
echo "[WP-054] Publish the PCR measurements above before enabling production KMS."
