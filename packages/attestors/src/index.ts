export type {
  AttestorRole,
  AttestorKeyMaterial,
  AttestorBundle,
  LoadKeysOptions,
  FinalSettlementV3Message,
  Attestation,
} from "./types.js";

export { ATTESTOR_ROLES, ATTESTOR_ENV_KEYS } from "./types.js";

export {
  AttestorKeyError,
  isProductionAttestorMode,
  loadAttestorKey,
  tryLoadAttestorKey,
  assertDistinctAttestorKeys,
  loadAttestorBundle,
  probeAttestorKeys,
} from "./keys.js";

export {
  SETTLEMENT_EIP712_NAME,
  SETTLEMENT_EIP712_VERSION,
  FINAL_SETTLEMENT_V3_TYPES,
  FINAL_SETTLEMENT_V3_TYPESTRING,
  settlementEip712Domain,
  toTypedDataMessage,
  buildTypedDataSignArgs,
} from "./eip712.js";

export {
  signFinalSettlementV3,
  signSettlementQuorum,
  recoverAttestationSigner,
  recoverDigestSigner,
  AttestorSigner,
  createAttestorSigner,
} from "./sign.js";

export {
  serializeFinalSettlementV3ForHttp,
  parseFinalSettlementV3FromHttp,
  type FinalSettlementV3HttpJson,
} from "./http.js";
