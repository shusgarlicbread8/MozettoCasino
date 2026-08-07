export type { HashResult } from "@mozetto/protocol-vectors";

export type {
  AppendEventInput,
  CanonicalEventRow,
  ChainVerifyIssue,
  ChainVerifyResult,
  PokerEventV1,
  StoredEvent,
} from "./types.js";

export {
  EVENT_TYPE,
  eventTypeName,
  eventTypeRequiresActor,
  isKnownEventType,
  type EventTypeCode,
} from "./event-types.js";

export {
  assertActorSeatValid,
  EventStoreError,
  hashActionPayload,
  hashBlindPayload,
  hashPokerEventV1,
  hashStreetPayload,
  PROTOCOL_V3_ENGINE_BUILD_ID,
  protocolV3EngineHash,
  ZERO_EVENT_HASH,
} from "./hash.js";

export { EventHashChain, verifyEventHashChain } from "./store.js";
