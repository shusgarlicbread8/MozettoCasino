import { createHash, randomBytes, randomUUID } from "node:crypto";
import {
  applyAction,
  clearSeat,
  computeEquity,
  computeHeroEquity,
  continueRunout,
  createTable,
  foldSeat,
  foldWin,
  getLegalActions,
  isAllInRunout,
  madeHandLabel,
  personalHandLabel,
  privateView,
  publicView,
  seatPlayer,
  setSitOut,
  startHand,
  type EngineEvent,
  type EquityRow,
  type HoldemState,
  buildCanonicalEvent,
  hashEvent,
  hashEngineState,
  GENESIS_EVENT_HASH,
  buildDecisionFacts,
  nextBlindSeats,
  chipsToNumber,
  chipsToUsd,
  usdToChips,
  type DecisionFacts,
  type OpponentStats,
  type SeatActionLog,
} from "@mozetto/game-rules";
import { fetchHandSeed, fallbackHandSeed } from "@mozetto/dealer/client";
import type { Card } from "@mozetto/shared-types";
import {
  query,
  persistWithOutbox,
  lockBuyIn,
  releaseSession,
  recordRatHoleExit,
  markOnchainSessionPlaying,
  markOnchainSessionReadyForSettlement,
  closeOnchainSessionForSettlement,
  abandonUnseatedOnchainPlayer,
  rebalanceEscrowToStacks,
  settleRatedMatch,
  isRankedLeague,
  getOnchainSessionForTable,
  handPhase,
  enqueueSeatChange,
  rotateEpochAtBoundary,
  ensureOpenEpoch,
  markEpochActive,
  listPendingLeaveOwnerIds,
  listPendingSeatChanges,
  type EpochParticipant,
  type DbClient,
} from "@mozetto/database";
import type { PokerAction, TableEvent } from "@mozetto/shared-types";
import { mapHandEventRows, recoverActorTip } from "./lease/index.js";
import {
  MemoryOutboxStore,
  canUsePokerEventV1,
  encodeSinglePokerEventV1,
  getOutboxStore,
  persistThenBroadcast,
  preferredSchemaKind,
  recoverUndeliveredOutbox,
  sessionIdToHex,
  type OutboxStore,
  type SchemaKind,
} from "./outbox/index.js";
import {
  hashObservation,
  notifyAgentRuntimeHandBegin,
  notifyAgentRuntimeHandEnd,
  notifyAgentRuntimeObserve,
  resolveSeatController,
  timeoutFallbackController,
  type SeatController,
} from "./controllers.js";
import {
  buildHandRootForSettledHand,
  buildSettlementRootsFromTip,
  deckRootFromSeedReveal,
  persistHandRoot,
  persistBalanceLeaves,
  persistSessionCheckpoint,
  requireRealRoots,
  type SeatBalanceSnapshot,
} from "./roots/index.js";
import type { Address } from "viem";
import {
  SpectatorDelayBuffer,
  isSpectatorSafeEvent,
  resolveSpectatorDelayMs,
  type SpectatorOutboundMessage,
} from "./spectator-delay.js";
import {
  THINK_CADENCE_MIN_MS,
  buildPublicThinkingLines,
  computeThinkCadenceMs,
} from "./ai-think-cadence.js";

type Hex = `0x${string}`;

function hexToBytes(hex: string): Buffer {
  const h = hex.startsWith("0x") ? hex.slice(2) : hex;
  return Buffer.from(h, "hex");
}

/** Engine money is bigint chips; Postgres JSON / event hashes cannot serialize bigint. */
function jsonStringify(value: unknown): string {
  return JSON.stringify(value, (_key, v) => (typeof v === "bigint" ? v.toString() : v));
}

function jsonSafe<T>(value: T): T {
  return JSON.parse(jsonStringify(value)) as T;
}

/** Action clock for human play (seconds). */
export const TURN_SECONDS = 15;
const TURN_MS = TURN_SECONDS * 1000;

/**
 * Absolute minimum visible AI think time (ms). Difficulty scheduling in
 * `computeThinkCadenceMs` targets ~5s easy → ~13s hard within the 15s clock.
 * PUBLIC_CADENCE_FLOOR_MS still overrides the minimum when set (>0).
 */
const PUBLIC_CADENCE_FLOOR_MS = (() => {
  const raw = process.env.PUBLIC_CADENCE_FLOOR_MS;
  if (raw === "0") return 0;
  if (raw != null && raw !== "" && Number.isFinite(Number(raw))) {
    return Math.max(0, Math.min(TURN_MS, Math.trunc(Number(raw))));
  }
  return THINK_CADENCE_MIN_MS;
})();

/**
 * HUMAN_PLAY=1 allows a bound human on a non-agent seat to act via WS.
 * Agent seats still use agent-runtime / Groq — Mozetto is AI-played poker.
 * Set HUMAN_PLAY=0 only for fully autonomous golden runs with no human clock.
 */
const HUMAN_PLAY = process.env.HUMAN_PLAY !== "0";
const DEALER_URL = process.env.DEALER_URL ?? "http://localhost:4003";
/** WP-129 — ranked spectator WS delay (Plan 07 spectator-delayed). */
const SPECTATOR_DELAY_MS = resolveSpectatorDelayMs();

type PendingHuman = {
  seatIndex: number;
  legal: ReturnType<typeof getLegalActions>;
  resolve: (action: { action: PokerAction; amount?: number; reasonCode: string }) => void;
  timer: NodeJS.Timeout;
};

type Client = {
  send: (data: unknown) => void;
  userId: string;
  role: "player" | "spectator";
  seatIndex?: number;
};

export class TableRuntime {
  tableId: string;
  arenaMode: "demo" | "onchain" = "demo";
  /** game_variants.id — nlhe_hu (Texas Hold'em) or nlhe_6max (Poker Classic). */
  variantId = "nlhe_6max";
  /**
   * Sealed HU match ended by elimination — no new joins / hands until settle.
   * Prevents "bust → leave → instant JOINED with chips" on the same session.
   */
  matchClosed = false;
  state: HoldemState;
  sequence = 0;
  /** WP-080: durable chain verified on load; false ⇒ refuse advancement. */
  durableChainOk = true;
  durableChainIssues: string[] = [];
  /** WP-080 fencing token version when this runtime holds the table lease. */
  leaseVersion: number | null = null;
  leaseActorId: string | null = null;
  /** WP-081 outbox store (Postgres by default; inject memory in tests). */
  outboxStore: OutboxStore = getOutboxStore();
  /** Schema kind preference for canonical/outbox rows. */
  schemaKindPrefer: SchemaKind = preferredSchemaKind();
  /** Tip for poker_event_v1 chain when enabled (on-chain session hex). */
  pokerV1PrevHash: Hex | null = null;
  pokerV1Sequence = 0;
  prevHash: string | null = null;
  clients = new Set<Client>();
  running = false;
  loopTimer: NodeJS.Timeout | null = null;
  agentProfiles = new Map<number, string>();
  /** Last known Energy per seat — avoid null flashes between cognition frames. */
  lastAiEnergy = new Map<number, number>();
  sessions = new Map<string, string>(); // userId -> sessionId
  stackBaseline = new Map<string, number>(); // userId -> stack at last ledger sync
  sessionStartHand = new Map<string, number>(); // sessionId -> handNumber when the session began (for rated match hand counts)
  /** Epoch ms when the current actor must act by. */
  actionDeadlineAt: number | null = null;
  pendingHuman: PendingHuman | null = null;
  /** All-in runout: public equity + revealed holes (HD Poker style). */
  equity: EquityRow[] | null = null;
  runoutRevealed: Record<number, Card[]> = {};
  runoutRevealPublished = false;
  /** Cached private hero odds: `${seat}:${boardLen}:${handId}` → pct */
  privateEquityCache = new Map<string, { hand: string; equity: number }>();
  /**
   * Ordered public action log for the current hand. Feeds the deterministic
   * range engine — without it an opponent's range is only a positional prior.
   */
  handActionLog: SeatActionLog = [];
  /**
   * Seats that asked to sit back in but must wait for their natural big blind.
   *
   * Without this, a player can dodge a blind: sit out as the BB approaches,
   * let it pass, then sit straight back in. That is a real poker-integrity
   * exploit, not UI polish, so re-entry is gated here. The seat stays
   * `sitOut` in the engine (which keeps RC1 state hashing untouched) until the
   * big blind reaches it, at which point it is dealt in as the BB.
   */
  awaitingBigBlind = new Set<number>();
  /**
   * Cross-hand opponent statistics keyed by seat. Public evidence only; reset
   * when a seat changes occupant.
   */
  opponentStats = new Map<
    number,
    OpponentStats & {
      openOpportunities: number;
      opens: number;
      vpipHands: number;
      pfrHands: number;
      threeBetOpportunities: number;
      threeBets: number;
      foldToThreeBetOpportunities: number;
      foldToThreeBets: number;
      volunteeredThisHand: boolean;
      raisedPreflopThisHand: boolean;
    }
  >();
  /** On-chain session id for canonical events + dealer seeds (when arenaMode=onchain). */
  onchainSessionId: string | null = null;
  canonicalPrevHash: Hex = GENESIS_EVENT_HASH;
  canonicalSequence = 0;
  seatControllers = new Map<number, SeatController>();
  /** Owners with a pending leave queued for the next epoch boundary (WP-042). */
  pendingLeaveOwners = new Set<string>();
  /** WP-108: opening state hash captured at HAND_STARTED (for HandRoot). */
  handOpeningStateHash: Hex | null = null;
  /**
   * WP-106 golden / WP-108: last built settlement triple after HAND_SETTLED.
   * Surfaced via GET /v1/tables/:id/settlement-roots (no stub seeds).
   */
  lastSettlementRoots: ReturnType<typeof buildSettlementRootsFromTip> | null = null;
  lastSettlementAt: string | null = null;
  /** WP-108: opening chip stacks (raw units ×1e6 when on-chain) keyed by seat. */
  handOpeningStacks = new Map<number, number>();
  /**
   * WP-129 — delayed public frames for spectator-role WS clients.
   * Shared buffer per table; players/owners bypass entirely.
   */
  spectatorDelayMs = SPECTATOR_DELAY_MS;
  spectatorBuffer = new SpectatorDelayBuffer({ delayMs: SPECTATOR_DELAY_MS });
  spectatorFlushTimer: NodeJS.Timeout | null = null;
  /**
   * Serializes join/leave. Seat selection is a check-then-act across several
   * awaits (buy-in lock, session insert, seat update); without this, two
   * players who find the same match within the same tick both read the same
   * empty seat and the second overwrites the first — the table then reports
   * one seated player forever and the engine loop never reaches its
   * two-player start condition.
   */
  private seatMutex: Promise<unknown> = Promise.resolve();

  /** Run `fn` with exclusive access to seat assignment for this table. */
  private withSeatLock<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.seatMutex.then(fn, fn);
    // Keep the chain alive regardless of individual failures.
    this.seatMutex = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  constructor(
    tableId: string,
    config: { smallBlind: number; bigBlind: number; rakePct: number; rakeCap: number | null; maxSeats?: number },
  ) {
    this.tableId = tableId;
    // DB / API speak USDC dollars; the engine plays integer cent-chips.
    this.state = createTable(
      {
        tableId,
        smallBlind: usdToChips(config.smallBlind),
        bigBlind: usdToChips(config.bigBlind),
        rakePct: Number(config.rakePct),
        rakeCap: config.rakeCap == null ? null : usdToChips(config.rakeCap),
      },
      config.maxSeats ?? 6,
    );
  }

  static async load(tableId: string) {
    const t = await query(
      `select * from tables where id = $1`,
      [tableId],
    );
    if (!t.rows[0]) throw new Error("table not found");
    const row = t.rows[0];
    const variantId = String(row.variant_id ?? "");
    const maxSeats = Number(row.max_seats) || 6;
    if (variantId === "nlhe_hu" && maxSeats !== 2) {
      throw new Error(`Texas Hold'em table ${tableId} must have max_seats=2 (got ${maxSeats})`);
    }
    if (variantId === "nlhe_6max" && maxSeats > 6) {
      throw new Error(`Poker Classic table ${tableId} max_seats=${maxSeats} exceeds 6`);
    }
    const rt = new TableRuntime(tableId, {
      smallBlind: Number(row.small_blind),
      bigBlind: Number(row.big_blind),
      rakePct: Number(row.rake_pct),
      rakeCap: row.rake_cap != null ? Number(row.rake_cap) : null,
      maxSeats,
    });
    rt.variantId = variantId;
    rt.arenaMode = row.arena_mode === "onchain" ? "onchain" : "demo";
    // WP-106/108: on-chain tables emit PokerEventV1 when golden/real-roots gated
    // or CANONICAL_SCHEMA_KIND=poker_event_v1 (required for non-stub HandRoots).
    if (rt.arenaMode === "onchain" && (requireRealRoots() || preferredSchemaKind() === "poker_event_v1")) {
      rt.schemaKindPrefer = "poker_event_v1";
    }
    if (rt.arenaMode === "onchain") {
      await rt.loadOnchainSession();
      const oc = await getOnchainSessionForTable(tableId).catch(() => null);
      if (oc && (oc.status === "settling" || oc.status === "settled" || oc.status === "blocked")) {
        rt.matchClosed = true;
      }
    }
    // WP-080: replay durable hand_events tip (hash chain) after lease reclaim.
    const eventRows = await query(
      `select sequence, event_type, event_hash, prev_event_hash, hand_id, payload, timestamp
       from hand_events where table_id = $1 order by sequence`,
      [tableId],
    );
    let tip = recoverActorTip(mapHandEventRows(eventRows.rows));
    // Partial persists (e.g. BigInt stringify failures) burn a sequence number and
    // leave a gap. Between hands we can truncate the torn suffix and resume.
    if (!tip.chainOk && tip.issues.some((i) => i.startsWith("sequence_gap"))) {
      const cut = tip.sequence;
      const pruned = await query(`delete from hand_events where table_id = $1 and sequence > $2`, [
        tableId,
        cut,
      ]);
      console.warn(
        "[table-runtime] pruned torn hand_events after durable tip",
        tableId,
        { tipSequence: cut, deleted: pruned.rowCount, issues: tip.issues },
      );
      const repairedRows = await query(
        `select sequence, event_type, event_hash, prev_event_hash, hand_id, payload, timestamp
         from hand_events where table_id = $1 order by sequence`,
        [tableId],
      );
      tip = recoverActorTip(mapHandEventRows(repairedRows.rows));
    }
    rt.sequence = tip.sequence;
    rt.prevHash = tip.prevHash;
    rt.durableChainOk = tip.chainOk;
    rt.durableChainIssues = tip.issues;
    if (!tip.chainOk) {
      console.error("[table-runtime] durable event chain broken — refusing actor loop", tableId, tip.issues);
    }

    const seats = await query(`select * from table_seats where table_id = $1 order by seat_index`, [tableId]);
    for (const s of seats.rows) {
      if (s.status === "occupied" && s.agent_id && s.owner_id) {
        rt.state = seatPlayer(rt.state, s.seat_index, s.owner_id, s.agent_id, usdToChips(Number(s.stack)));
        const cfg = await query(
          `select profile_key from agent_configs where agent_id = $1 and is_active = true limit 1`,
          [s.agent_id],
        );
        rt.agentProfiles.set(s.seat_index, cfg.rows[0]?.profile_key ?? "machine");
      }
    }

    const sessions = await query(
      `select id, owner_id, stack from table_sessions where table_id = $1 and status = 'active'`,
      [tableId],
    );
    for (const s of sessions.rows) {
      rt.sessions.set(s.owner_id, s.id);
      rt.stackBaseline.set(s.owner_id, Number(s.stack));
    }
    const hn = await query(
      `select coalesce(max(hand_number), 0)::int as m from hands where table_id = $1`,
      [tableId],
    );
    rt.state = { ...rt.state, handNumber: Number(hn.rows[0]?.m ?? 0), street: "waiting", handId: null, actingIndex: null };
    // Best-effort: hands played before a restart aren't attributable to a session start;
    // treat "now" as the start so only hands going forward count toward rated matches.
    for (const s of sessions.rows) rt.sessionStartHand.set(s.id, rt.state.handNumber);
    try {
      await ensureOpenEpoch(tableId, rt.epochParticipants());
      rt.pendingLeaveOwners = await listPendingLeaveOwnerIds(tableId);
    } catch (err) {
      console.warn("[table-runtime] epoch bootstrap skipped", tableId, err);
    }

    // WP-081: republish undelivered outbox before accepting new authoritative writes.
    try {
      const recovered = await recoverUndeliveredOutbox({
        store: rt.outboxStore,
        tableId,
        sessionId: rt.onchainSessionId ?? undefined,
        publish: async (msg) => {
          const event = msg.payload as TableEvent;
          if (event && typeof event === "object" && "eventType" in event) {
            rt.broadcast(event);
          }
        },
      });
      if (recovered.drained > 0 || recovered.failed > 0) {
        console.info(
          "[table-runtime] outbox recovery",
          tableId,
          `drained=${recovered.drained}`,
          `failed=${recovered.failed}`,
          `remaining=${recovered.remainingPending}`,
        );
      }
    } catch (err) {
      console.warn("[table-runtime] outbox recovery skipped", tableId, err);
    }

    return rt;
  }

  /** WP-042: current seated participants for epoch planning. */
  epochParticipants(): EpochParticipant[] {
    return this.state.seats
      .filter((s) => s.playerId)
      .map((s) => ({
        ownerId: s.playerId!,
        seatIndex: s.seatIndex,
        stack: Number(s.stack) || 0,
        allIn: Boolean(s.allIn),
        agentId: s.agentId,
      }));
  }

  currentHandPhase() {
    return handPhase({ handId: this.state.handId, street: this.state.street });
  }

  /**
   * WP-042: apply queued join/leave/top-up at the epoch boundary (between hands).
   * Must run only when participants are mutable (waiting / post-settlement).
   * Rotates the table epoch even when the queue is empty (next-hand checkpoint).
   */
  async applyEpochBoundary(opts?: { onlyIfPending?: boolean }): Promise<void> {
    if (this.currentHandPhase() === "hand_active") {
      console.warn("[table-runtime] applyEpochBoundary blocked mid-hand", this.tableId);
      return;
    }
    if (opts?.onlyIfPending) {
      const pending = await listPendingSeatChanges(this.tableId).catch(() => []);
      if (!pending.length) return;
    }
    // Clear all-in flags for planning — hand has resolved.
    const participants = this.epochParticipants().map((p) => ({ ...p, allIn: false }));
    const maxSeats = this.state.seats.length;
    const rotated = await rotateEpochAtBoundary({
      tableId: this.tableId,
      participants,
      maxSeats,
      handNumberEnd: this.state.handNumber,
    });
    if (!rotated) return;

    const { plan } = rotated;
    // Unlocked variants: applyEpochBoundary is reached from paths that may
    // already hold the seat lock, and re-entering it would deadlock.
    for (const leave of plan.leaves) {
      await this.leaveUnlocked(leave.ownerId, { forceImmediate: true });
    }
    for (const top of plan.topUps) {
      const amount = Number(top.amount ?? 0);
      if (amount > 0) {
        await this.topUp(top.ownerId, amount, { forceImmediate: true });
      }
    }
    for (const join of plan.joins) {
      if (this.matchClosed) {
        console.warn("[table-runtime] skip queued join — match closed", this.tableId, join.id);
        continue;
      }
      const buyIn = Number(join.amount ?? 0);
      const agentConfigId = join.agentConfigId ?? String(join.payload?.agentConfigId ?? "");
      if (!(buyIn > 0) || !join.agentId || !agentConfigId) {
        console.warn("[table-runtime] skip queued join — missing agent fields", join.id);
        continue;
      }
      const payload = join.payload ?? {};
      try {
        await this.joinUnlocked({
          userId: join.ownerId,
          agentId: join.agentId,
          agentConfigId,
          buyIn,
          seatIndex: join.seatIndex ?? undefined,
          profileKey: join.profileKey ?? String(payload.profileKey ?? "machine"),
          stopLoss: payload.stopLoss != null ? Number(payload.stopLoss) : undefined,
          profitTarget: payload.profitTarget != null ? Number(payload.profitTarget) : undefined,
          autoRebuy: Boolean(payload.autoRebuy),
          forceImmediate: true,
        });
      } catch (err) {
        console.warn(
          "[table-runtime] queued join rejected",
          this.tableId,
          join.id,
          err instanceof Error ? err.message : err,
        );
      }
    }

    this.pendingLeaveOwners = await listPendingLeaveOwnerIds(this.tableId).catch(
      () => new Set<string>(),
    );
    if (plan.appliedIds.length || plan.rejected.length) {
      await this.persistEvent("EPOCH_ROTATED", {
        closedEpoch: plan.closedEpoch,
        nextEpoch: plan.nextEpoch,
        applied: plan.appliedIds.length,
        rejected: plan.rejected,
        participants: plan.nextParticipants.map((p) => ({
          ownerId: p.ownerId,
          seatIndex: p.seatIndex,
          stack: p.stack,
        })),
      }).catch(() => null);
      this.broadcastSnapshots();
    }
  }

  async loadOnchainSession() {
    try {
      const row = await query<{ session_id: string }>(
        `select session_id from onchain_sessions
         where table_id = $1 and status in ('opened', 'playing', 'settling')
         order by created_at desc limit 1`,
        [this.tableId],
      );
      this.onchainSessionId = row.rows[0]?.session_id ?? null;
      if (this.onchainSessionId) {
        const last = await query<{ sequence: string; event_hash: string }>(
          `select sequence::text, event_hash from canonical_game_events
           where session_id = $1 order by sequence desc limit 1`,
          [this.onchainSessionId],
        );
        if (last.rows[0]) {
          this.canonicalSequence = Number(last.rows[0].sequence);
          const h = last.rows[0].event_hash;
          this.canonicalPrevHash = (h.startsWith("0x") ? h : `0x${h}`) as Hex;
        }
      }
    } catch (err) {
      console.warn("loadOnchainSession failed", this.tableId, err);
    }
  }

  isHeadsUpTable(): boolean {
    return this.variantId === "nlhe_hu" || this.state.seats.length === 2;
  }

  isBotSeat(seatIndex: number): boolean {
    if (!HUMAN_PLAY) return true;
    const seat = this.state.seats.find((s) => s.seatIndex === seatIndex);
    // Mozetto is AI-played: agent / profile seats use agent-runtime on the clock.
    // Pure human test seats (no agent) wait on the WS action clock.
    if (seat?.agentId || this.agentProfiles.has(seatIndex)) return true;
    return false;
  }

  /**
   * Append a public action to this hand's log and fold it into the seat's
   * cross-hand statistics. Only public information — never hole cards.
   */
  recordHandAction(
    seatIndex: number,
    action: string,
    amountChips: number | undefined,
    street: string,
  ) {
    this.handActionLog.push({ seat: seatIndex, action, amountChips, street });

    const prior = this.opponentStats.get(seatIndex) ?? {
      seat: seatIndex,
      handsObserved: 0,
      openOpportunities: 0,
      opens: 0,
      openPct: null,
      vpipHands: 0,
      pfrHands: 0,
      threeBetOpportunities: 0,
      threeBets: 0,
      foldToThreeBetOpportunities: 0,
      foldToThreeBets: 0,
      volunteeredThisHand: false,
      raisedPreflopThisHand: false,
      vpipPct: null,
      threeBetPct: null,
      foldToThreeBetPct: null,
      avgPublicCadenceMs: null,
    };
    if (street === "preflop") {
      const voluntary =
        action === "call" || action === "bet" || action === "raise" || action === "all_in";
      if (voluntary && !prior.volunteeredThisHand) {
        prior.volunteeredThisHand = true;
        prior.vpipHands += 1;
      }
      const priorRaises = this.handActionLog.filter(
        (a) =>
          a.street === "preflop" &&
          a.seat !== seatIndex &&
          (a.action === "raise" || a.action === "bet" || a.action === "all_in"),
      ).length;
      const priorAggression = priorRaises > 0;
      // An "open" is first-in aggression.
      if (!priorAggression && (action === "raise" || action === "bet" || action === "all_in")) {
        prior.opens += 1;
      }
      if ((action === "raise" || action === "all_in") && !prior.raisedPreflopThisHand) {
        prior.raisedPreflopThisHand = true;
        prior.pfrHands += 1;
      }
      // Facing exactly one prior raise → 3-bet opportunity.
      if (priorRaises === 1) {
        prior.threeBetOpportunities += 1;
        if (action === "raise" || action === "all_in") prior.threeBets += 1;
        if (action === "fold") {
          prior.foldToThreeBetOpportunities += 1;
          prior.foldToThreeBets += 1;
        } else if (action === "call" || action === "raise" || action === "all_in") {
          prior.foldToThreeBetOpportunities += 1;
        }
      }
    }
    prior.openPct =
      prior.openOpportunities > 0 ? prior.opens / prior.openOpportunities : null;
    prior.vpipPct = prior.handsObserved > 0 ? prior.vpipHands / prior.handsObserved : null;
    prior.threeBetPct =
      prior.threeBetOpportunities > 0 ? prior.threeBets / prior.threeBetOpportunities : null;
    prior.foldToThreeBetPct =
      prior.foldToThreeBetOpportunities > 0
        ? prior.foldToThreeBets / prior.foldToThreeBetOpportunities
        : null;
    this.opponentStats.set(seatIndex, prior);
  }

  /** Count one preflop opening opportunity per seat dealt into the hand. */
  notePreflopOpenOpportunities() {
    for (const s of this.state.seats) {
      if (!s.playerId || s.sitOut) continue;
      const prior = this.opponentStats.get(s.seatIndex) ?? {
        seat: s.seatIndex,
        handsObserved: 0,
        openOpportunities: 0,
        opens: 0,
        openPct: null,
        vpipHands: 0,
        pfrHands: 0,
        threeBetOpportunities: 0,
        threeBets: 0,
        foldToThreeBetOpportunities: 0,
        foldToThreeBets: 0,
        volunteeredThisHand: false,
        raisedPreflopThisHand: false,
        vpipPct: null,
        threeBetPct: null,
        foldToThreeBetPct: null,
        avgPublicCadenceMs: null,
      };
      prior.handsObserved += 1;
      prior.openOpportunities += 1;
      prior.volunteeredThisHand = false;
      prior.raisedPreflopThisHand = false;
      prior.openPct =
        prior.openOpportunities > 0 ? prior.opens / prior.openOpportunities : null;
      prior.vpipPct = prior.handsObserved > 0 ? prior.vpipHands / prior.handsObserved : null;
      this.opponentStats.set(s.seatIndex, prior);
    }
  }

  /** Plain `OpponentStats` view for the range engine. */
  opponentStatsForFacts(): Record<number, OpponentStats> {
    const out: Record<number, OpponentStats> = {};
    for (const [seat, s] of this.opponentStats) {
      out[seat] = {
        seat: s.seat,
        handsObserved: s.handsObserved,
        openPct: s.openPct ?? null,
        vpipPct: s.vpipPct ?? null,
        threeBetPct: s.threeBetPct ?? null,
        foldToThreeBetPct: s.foldToThreeBetPct ?? null,
        avgPublicCadenceMs: s.avgPublicCadenceMs ?? null,
      };
    }
    return out;
  }

  /** Deterministic decision facts for the acting seat (WP-131 grounding). */
  decisionFactsFor(seatIndex: number): DecisionFacts {
    return buildDecisionFacts({
      state: this.state,
      seatIndex,
      actions: this.handActionLog,
      stats: this.opponentStatsForFacts(),
      // Keep inside the action clock; ±1% is well within reported confidence.
      equitySamples: 1_500,
    });
  }

  seatControllerFor(seatIndex: number): SeatController {
    const cached = this.seatControllers.get(seatIndex);
    if (cached) return cached;
    const profile = this.agentProfiles.get(seatIndex) ?? "machine";
    const ctrl = resolveSeatController(profile);
    this.seatControllers.set(seatIndex, ctrl);
    return ctrl;
  }

  async persistCanonicalEvent(
    eventType: string,
    publicPayload: Record<string, unknown>,
    privatePayloadCommitment?: string | null,
    client?: DbClient,
  ) {
    if (this.arenaMode !== "onchain" || !this.onchainSessionId) return;
    const q = client?.query.bind(client) ?? query;
    this.canonicalSequence += 1;

    const useV1 = canUsePokerEventV1(eventType, this.schemaKindPrefer, publicPayload);
    if (useV1) {
      const sessionHex = sessionIdToHex(this.onchainSessionId);
      const prev =
        (this.pokerV1PrevHash as Hex | null) ??
        (("0x" + "00".repeat(32)) as Hex);
      const encoded = encodeSinglePokerEventV1({
        sessionId: sessionHex,
        epoch: 0n,
        handNumber: BigInt(this.state.handNumber ?? 0),
        sequence: BigInt(this.pokerV1Sequence),
        eventType,
        publicPayload,
        previousEventHash: prev,
        privatePayloadCommitment: privatePayloadCommitment
          ? (privatePayloadCommitment as Hex)
          : undefined,
      });
      if (encoded) {
        this.pokerV1PrevHash = encoded.eventHash;
        this.pokerV1Sequence += 1;
        this.canonicalPrevHash = encoded.eventHash;
        try {
          await q(
            `insert into canonical_game_events
             (session_id, hand_id, sequence, event_hash, previous_event_hash, event_type, public_payload,
              private_payload_commitment, timestamp_ms, schema_kind, epoch, hand_number, protocol_version,
              event_type_code, has_actor_seat, actor_seat, public_payload_hash, canonical_bytes)
             values ($1,$2,$3,$4,$5,$6,$7,$8,$9,'poker_event_v1',0,$10,3,$11,$12,$13,$14,$15)`,
            [
              this.onchainSessionId,
              this.state.handId,
              this.canonicalSequence,
              encoded.eventHash,
              encoded.previousEventHash,
              eventType,
              jsonStringify(publicPayload),
              privatePayloadCommitment ?? null,
              Date.now(),
              this.state.handNumber ?? 0,
              encoded.eventTypeCode,
              encoded.hasActorSeat,
              encoded.actorSeat,
              encoded.publicPayloadHash,
              hexToBytes(encoded.canonicalBytesHex),
            ],
          );
          await q(
            `insert into public_event_payloads (event_hash, payload)
             values ($1, $2::jsonb)
             on conflict (event_hash) do nothing`,
            [encoded.eventHash, jsonStringify(publicPayload)],
          ).catch(() => null);
        } catch (err) {
          console.warn("canonical_game_events poker_event_v1 insert failed", this.tableId, err);
        }
        return;
      }
    }

    const canonical = buildCanonicalEvent({
      sessionId: this.onchainSessionId,
      handId: this.state.handId,
      sequence: this.canonicalSequence,
      eventType,
      publicPayload,
      privatePayloadCommitment,
      previousEventHash: this.canonicalPrevHash,
    });
    const eventHash = hashEvent(canonical);
    this.canonicalPrevHash = eventHash;
    try {
      await q(
        `insert into canonical_game_events
         (session_id, hand_id, sequence, event_hash, previous_event_hash, event_type, public_payload,
          private_payload_commitment, timestamp_ms, schema_kind, epoch)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,'legacy_json',0)`,
        [
          this.onchainSessionId,
          this.state.handId,
          this.canonicalSequence,
          eventHash,
          canonical.previousEventHash,
          eventType,
          jsonStringify(publicPayload),
          privatePayloadCommitment ?? null,
          canonical.timestampMs,
        ],
      );
      await q(
        `insert into public_event_payloads (event_hash, payload)
         values ($1, $2::jsonb)
         on conflict (event_hash) do nothing`,
        [eventHash, jsonStringify(publicPayload)],
      ).catch(() => null);
    } catch (err) {
      console.warn("canonical_game_events insert failed", this.tableId, err);
    }
  }

  subscribe(client: Client) {
    this.clients.add(client);
    if (client.role === "spectator") {
      this.sendSpectatorSubscribe(client);
      return;
    }
    client.send({
      type: "snapshot",
      sequence: this.sequence,
      state: this.viewFor(client),
    });
  }

  unsubscribe(client: Client) {
    this.clients.delete(client);
    if (![...this.clients].some((c) => c.role === "spectator")) {
      this.clearSpectatorFlushTimer();
    }
  }

  /**
   * Spectator subscribe: never send the live tip. Catch up with the latest
   * delayed snapshot when the buffer has aged past SPECTATOR_DELAY_MS.
   */
  private sendSpectatorSubscribe(client: Client) {
    client.send({
      type: "spectator_delay",
      workPacket: "WP-129",
      delayMs: this.spectatorDelayMs,
      channel: `table:${this.tableId}:spectator-delayed`,
    });
    if (this.spectatorDelayMs === 0) {
      client.send({
        type: "snapshot",
        sequence: this.sequence,
        state: this.spectatorView(),
      });
      return;
    }
    const snap = this.spectatorBuffer.latestDueSnapshot();
    if (snap) {
      client.send(snap);
    }
    this.scheduleSpectatorFlush();
  }

  /** Public-only table view for spectators (no holeCards / legalActions / owner equity). */
  spectatorView() {
    const base = this.wireViewUsd(publicView(this.state));
    const labels = Object.entries(this.runoutRevealed).map(([seat, hole]) => ({
      seatIndex: Number(seat),
      label: madeHandLabel(hole, this.state.board),
    }));
    return {
      ...base,
      actionClock: this.actionClock(),
      equity: this.equity,
      // Legal all-in / showdown reveals only — still delayed with the spectator buffer.
      runoutRevealed: this.runoutRevealed,
      handLabels: labels,
      allInRunout: isAllInRunout(this.state) || this.state.street === "showdown" || this.state.street === "settlement",
      holeCards: [],
      myHand: null,
      myEquity: null,
    };
  }

  private spectatorClients(): Client[] {
    return [...this.clients].filter((c) => c.role === "spectator");
  }

  private enqueueSpectatorMessages(messages: SpectatorOutboundMessage[]) {
    if (messages.length === 0) return;
    if (this.spectatorDelayMs === 0) {
      for (const c of this.spectatorClients()) {
        for (const msg of messages) c.send(msg);
      }
      return;
    }
    this.spectatorBuffer.enqueue(messages);
    this.scheduleSpectatorFlush();
  }

  private flushSpectatorBuffer() {
    const due = this.spectatorBuffer.takeDue();
    if (due.length === 0) {
      this.scheduleSpectatorFlush();
      return;
    }
    const spectators = this.spectatorClients();
    for (const frame of due) {
      for (const c of spectators) {
        for (const msg of frame.messages) c.send(msg);
      }
    }
    this.scheduleSpectatorFlush();
  }

  private scheduleSpectatorFlush() {
    this.clearSpectatorFlushTimer();
    if (this.spectatorDelayMs === 0) return;
    if (this.spectatorClients().length === 0 && this.spectatorBuffer.msUntilNextDue() == null) {
      return;
    }
    const wait = this.spectatorBuffer.msUntilNextDue();
    if (wait == null) return;
    this.spectatorFlushTimer = setTimeout(() => {
      this.spectatorFlushTimer = null;
      this.flushSpectatorBuffer();
    }, wait);
    // Avoid keeping the event loop alive solely for idle spectator timers in tests.
    this.spectatorFlushTimer.unref?.();
  }

  private clearSpectatorFlushTimer() {
    if (this.spectatorFlushTimer) {
      clearTimeout(this.spectatorFlushTimer);
      this.spectatorFlushTimer = null;
    }
  }

  actionClock() {
    if (this.state.actingIndex == null || this.actionDeadlineAt == null) return null;
    return {
      seatIndex: this.state.actingIndex,
      deadlineAt: this.actionDeadlineAt,
      turnSeconds: TURN_SECONDS,
      remainingMs: Math.max(0, this.actionDeadlineAt - Date.now()),
    };
  }

  /** Convert engine cent-chips in a public/private view back to USDC dollars for clients. */
  private wireViewUsd<T extends ReturnType<typeof publicView>>(view: T): T {
    const usd = (n: number) => n / 100;
    return {
      ...view,
      pot: usd(view.pot),
      currentBet: usd(view.currentBet),
      rake: usd(view.rake),
      sessionRake: usd(view.sessionRake ?? 0),
      seats: view.seats.map((s) => ({ ...s, stack: usd(s.stack), bet: usd(s.bet) })),
      winners: view.winners.map((w) => ({ ...w, amount: usd(w.amount) })),
      ...( "legalActions" in view && Array.isArray((view as { legalActions?: unknown }).legalActions)
        ? {
            legalActions: (
              view as { legalActions: { action: string; minAmount?: number; maxAmount?: number }[] }
            ).legalActions.map((a) => ({
              ...a,
              minAmount: a.minAmount != null ? usd(a.minAmount) : undefined,
              maxAmount: a.maxAmount != null ? usd(a.maxAmount) : undefined,
            })),
          }
        : {}),
    };
  }

  viewFor(client: Client) {
    const base = this.wireViewUsd(
      client.role === "player" && client.seatIndex != null
        ? privateView(this.state, client.seatIndex)
        : publicView(this.state),
    );
    const labels = Object.entries(this.runoutRevealed).map(([seat, hole]) => ({
      seatIndex: Number(seat),
      label: madeHandLabel(hole, this.state.board),
    }));

    let myHand: string | null = null;
    let myEquity: number | null = null;
    if (client.role === "player" && client.seatIndex != null) {
      const seat = this.state.seats.find((s) => s.seatIndex === client.seatIndex);
      if (seat?.hole?.length === 2 && this.state.street !== "waiting") {
        myHand = personalHandLabel(seat.hole, this.state.board);
        const known = this.equity?.find((e) => e.seatIndex === client.seatIndex);
        if (known) {
          myEquity = known.equityPct;
        } else {
          const cacheKey = `${client.seatIndex}:${this.state.board.length}:${this.state.handId}:${this.state.seats.filter((s) => !s.folded && s.playerId).length}`;
          const cached = this.privateEquityCache.get(cacheKey);
          if (cached) {
            myHand = cached.hand;
            myEquity = cached.equity;
          } else {
            const opps = this.state.seats.filter(
              (s) => !s.folded && s.playerId && s.seatIndex !== client.seatIndex,
            ).length;
            myEquity = opps > 0 ? computeHeroEquity(seat.hole, this.state.board, opps, { samples: 1200 }) : 100;
            this.privateEquityCache.set(cacheKey, { hand: myHand, equity: myEquity });
          }
        }
      }
    }

    return {
      ...base,
      actionClock: this.actionClock(),
      equity: this.equity,
      runoutRevealed: this.runoutRevealed,
      handLabels: labels,
      allInRunout: isAllInRunout(this.state) || this.state.street === "showdown" || this.state.street === "settlement",
      myHand,
      myEquity,
    };
  }

  broadcast(event: TableEvent, privatePayloads?: Map<number, unknown>) {
    for (const c of this.clients) {
      if (c.role === "spectator") continue;
      // Owner-private events only go to the matching seated player (never opponents).
      if (event.visibility === "owner_private") {
        const seat = Number((event.payload as { seatIndex?: number } | undefined)?.seatIndex);
        if (c.role !== "player" || c.seatIndex == null || c.seatIndex !== seat) continue;
      }
      c.send({ type: "event", event });
      if (
        c.role === "player" &&
        c.seatIndex != null &&
        privatePayloads?.has(c.seatIndex)
      ) {
        c.send({ type: "private_state", payload: privatePayloads.get(c.seatIndex) });
      }
      c.send({ type: "snapshot", sequence: this.sequence, state: this.viewFor(c) });
    }

    // WP-129: delay public spectator channel; never enqueue hole-card private events.
    if (isSpectatorSafeEvent(event)) {
      this.enqueueSpectatorMessages([
        { type: "event", event },
        { type: "snapshot", sequence: this.sequence, state: this.spectatorView() },
      ]);
    }
  }

  /**
   * WP-126 — push owner-only AI Energy / public cognition phase.
   * Never includes CoT; only the seat owner (matching userId or seatIndex) receives it.
   */
  sendOwnerAiCognition(
    seatIndex: number,
    status: {
      phase:
        | "OBSERVING"
        | "ANALYSING"
        | "UPDATING_OPPONENT_MODEL"
        | "DECISION_READY"
        | "ACTING";
      energyRemaining?: number | null;
      energyPerHand?: number;
      publicCadenceMs?: number | null;
      signalSource?: string;
      handId?: string | null;
      sessionId?: string;
      atMs?: number;
      modelId?: string | null;
      intentAction?: string | null;
      intentAmount?: number | null;
      publicNarrative?: string | null;
      publicThinkingLog?: string[] | null;
      fallbackUsed?: boolean;
    },
  ) {
    const ownerId = this.state.seats.find((s) => s.seatIndex === seatIndex)?.playerId;
    if (!ownerId) return;
    let energy: number | null =
      status.energyRemaining == null || !Number.isFinite(status.energyRemaining)
        ? null
        : Math.max(0, Math.trunc(status.energyRemaining));
    if (energy != null) this.lastAiEnergy.set(seatIndex, energy);
    else energy = this.lastAiEnergy.get(seatIndex) ?? null;
    const thinkingLog = Array.isArray(status.publicThinkingLog)
      ? status.publicThinkingLog.filter((l) => typeof l === "string" && l.trim()).slice(-24)
      : null;
    const frame = {
      type: "ai_cognition",
      workPacket: "WP-126",
      seat: seatIndex,
      handId: status.handId ?? this.state.handId,
      sessionId: status.sessionId ?? this.sessionIdForAi(),
      phase: status.phase,
      energyRemaining: energy,
      energyPerHand: status.energyPerHand ?? 100,
      publicCadenceMs: status.publicCadenceMs ?? null,
      signalSource: status.signalSource ?? "cognition",
      atMs: status.atMs ?? Date.now(),
      modelId: status.modelId ?? null,
      intentAction: status.intentAction ?? null,
      intentAmount: status.intentAmount ?? null,
      publicNarrative: status.publicNarrative ?? null,
      publicThinkingLog: thinkingLog,
      fallbackUsed: status.fallbackUsed ?? false,
    };
    for (const c of this.clients) {
      const isOwner =
        c.userId === ownerId || (c.seatIndex != null && c.seatIndex === seatIndex);
      if (!isOwner) continue;
      c.send(frame);
    }
  }

  async persistEvent(eventType: string, payload: Record<string, unknown>, visibility: "public" | "owner_private" | "system" = "public") {
    // Advance the tip only after a durable write succeeds — failed persists must
    // not burn sequence numbers (that creates sequence_gap on restart).
    const nextSequence = this.sequence + 1;
    const prevEventHash = this.prevHash;
    const safePayload = jsonSafe(payload);
    const body = {
      tableId: this.tableId,
      handId: this.state.handId,
      sequence: nextSequence,
      eventType,
      timestamp: new Date().toISOString(),
      payload: safePayload,
      prevEventHash,
    };
    const eventHash = createHash("sha256").update(jsonStringify(body)).digest("hex");
    const full: TableEvent = { ...body, eventHash, visibility };

    const sessionId = this.onchainSessionId ?? this.tableId;
    const schemaKind: SchemaKind = canUsePokerEventV1(eventType, this.schemaKindPrefer, safePayload)
      ? "poker_event_v1"
      : "legacy_json";

    // WP-081: durable hand_events (+ optional canonical) + outbox in one transaction,
    // then broadcast, then mark published.
    const useMemoryOutbox = this.outboxStore instanceof MemoryOutboxStore;

    try {
      if (useMemoryOutbox) {
        await persistThenBroadcast({
          store: this.outboxStore,
          durableWrite: async () => {
            await query(
              `insert into hand_events (table_id, hand_id, sequence, event_type, timestamp, payload, visibility, prev_event_hash, event_hash)
               values ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
              [
                this.tableId,
                this.state.handId,
                nextSequence,
                eventType,
                body.timestamp,
                jsonStringify(safePayload),
                visibility,
                prevEventHash,
                eventHash,
              ],
            );
            if (this.arenaMode === "onchain" && visibility !== "owner_private") {
              await this.persistCanonicalEvent(eventType, safePayload);
            }
          },
          outbox: {
            sessionId,
            tableId: this.tableId,
            sequence: nextSequence,
            eventHash,
            channel: `table:${this.tableId}:public`,
            payload: full as unknown as Record<string, unknown>,
            schemaKind,
            visibility,
          },
          publish: async () => {
            this.broadcast(full);
          },
        });
      } else {
        await persistThenBroadcast({
          store: this.outboxStore,
          durableWrite: async () => {
            /* atomicPersist below owns the write */
          },
          outbox: {
            sessionId,
            tableId: this.tableId,
            sequence: nextSequence,
            eventHash,
            channel: `table:${this.tableId}:public`,
            payload: full as unknown as Record<string, unknown>,
            schemaKind,
            visibility,
          },
          atomicPersist: async () => {
            const { outbox } = await persistWithOutbox({
              outbox: {
                sessionId,
                tableId: this.tableId,
                sequence: nextSequence,
                eventHash,
                channel: `table:${this.tableId}:public`,
                payload: full as unknown as Record<string, unknown>,
                schemaKind,
                visibility,
              },
              write: async (client) => {
                await client.query(
                  `insert into hand_events (table_id, hand_id, sequence, event_type, timestamp, payload, visibility, prev_event_hash, event_hash)
                   values ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
                  [
                    this.tableId,
                    this.state.handId,
                    nextSequence,
                    eventType,
                    body.timestamp,
                    jsonStringify(safePayload),
                    visibility,
                    prevEventHash,
                    eventHash,
                  ],
                );
                if (this.arenaMode === "onchain" && visibility !== "owner_private") {
                  await this.persistCanonicalEvent(eventType, safePayload, null, client);
                }
              },
            });
            return {
              id: outbox.id,
              sessionId: outbox.sessionId,
              tableId: outbox.tableId,
              epoch: outbox.epoch,
              sequence: outbox.sequence,
              eventHash: outbox.eventHash,
              channel: outbox.channel,
              payload: outbox.payload,
              schemaKind: outbox.schemaKind,
              visibility: outbox.visibility,
              status: outbox.status,
              attempts: outbox.attempts,
              lastError: outbox.lastError,
              createdAtMs: Date.parse(outbox.createdAt) || Date.now(),
              publishedAtMs: outbox.publishedAt ? Date.parse(outbox.publishedAt) : null,
            };
          },
          publish: async () => {
            this.broadcast(full);
          },
        });
      }
    } catch (err) {
      // Tip unchanged — next persist retries the same sequence.
      throw err;
    }

    this.sequence = nextSequence;
    this.prevHash = eventHash;

    // WP-107: fan out public events to agent-runtime cognition (no hole cards / CoT).
    if (visibility === "public") {
      void this.notifyAiObservation(eventType, safePayload, nextSequence, eventHash);
    }
    return full;
  }

  /** AI seats currently occupied (profile-bound). */
  aiSeatIndexes(): number[] {
    return [...this.agentProfiles.keys()].filter((seat) => {
      const s = this.state.seats.find((x) => x.seatIndex === seat);
      return Boolean(s?.playerId);
    });
  }

  sessionIdForAi(): string {
    return this.onchainSessionId ?? `table:${this.tableId}`;
  }

  async notifyAiHandBegin(handId: string): Promise<void> {
    const seats = this.aiSeatIndexes().map((seat) => ({
      seat,
      profileKey: this.agentProfiles.get(seat) ?? "machine",
    }));
    if (!seats.length) return;
    await notifyAgentRuntimeHandBegin({
      sessionId: this.sessionIdForAi(),
      handId,
      seats,
    });
    // WP-126: fresh hand → OBSERVING + Season 1 starting Energy (100).
    for (const s of seats) {
      this.sendOwnerAiCognition(s.seat, {
        phase: "OBSERVING",
        energyRemaining: 100,
        energyPerHand: 100,
        signalSource: "energy",
        handId,
        publicNarrative: "── New hand",
        publicThinkingLog: ["── New hand"],
      });
    }
  }

  async notifyAiObservation(
    eventType: string,
    payload: Record<string, unknown>,
    cursor: number,
    eventId?: string,
  ): Promise<void> {
    const handId = this.state.handId;
    if (!handId) return;
    const seats = this.aiSeatIndexes();
    if (!seats.length) return;
    const profiles: Record<string, string> = {};
    for (const seat of seats) {
      profiles[String(seat)] = this.agentProfiles.get(seat) ?? "machine";
    }
    const actorSeat =
      typeof payload.seatIndex === "number"
        ? payload.seatIndex
        : typeof payload.actorSeat === "number"
          ? payload.actorSeat
          : null;
    const rake =
      typeof payload.rake === "number" || typeof payload.rake === "string"
        ? payload.rake
        : null;
    // Prefer immutable event-time pot. Never narrate this.state.pot after a
    // settle/reset — checks that end a hand would otherwise show $0.00.
    const potUsdFromPayload = (key: "potAfter" | "potBefore" | "pot"): number | null => {
      const raw = payload[key];
      if (typeof raw === "number" || typeof raw === "string") {
        const n = Number(raw);
        if (Number.isFinite(n)) return chipsToUsd(BigInt(Math.trunc(n)));
      }
      return null;
    };
    const eventPotUsd =
      potUsdFromPayload("potAfter") ??
      potUsdFromPayload("pot") ??
      (eventType === "HAND_SETTLED" || eventType === "HAND_COMPLETE"
        ? null
        : chipsToUsd(this.state.pot));

    const statuses = await notifyAgentRuntimeObserve({
      sessionId: this.sessionIdForAi(),
      handId,
      seats,
      profiles,
      event: {
        cursor,
        eventId,
        eventType,
        street:
          typeof payload.street === "string" ? payload.street : this.state.street,
        actorSeat,
        amount:
          typeof payload.amount === "number" || typeof payload.amount === "string"
            ? payload.amount
            : null,
        pot: eventPotUsd ?? chipsToUsd(this.state.pot),
        rake,
        boardCardCount: this.state.board.length,
        activeSeats: this.state.seats
          .filter((s) => s.playerId && !s.folded)
          .map((s) => s.seatIndex),
        stacksBySeat: Object.fromEntries(
          this.state.seats.filter((s) => s.playerId).map((s) => [String(s.seatIndex), chipsToUsd(s.stack)]),
        ),
        summaryCode: eventType,
      },
    });
    // WP-126: forward public cognition phases + Energy to seat owners only.
    for (const st of statuses) {
      if (typeof st.seat !== "number" || !st.phase) continue;
      // Background observe must not clobber the live action-clock pipeline
      // (ANALYSING → DECISION_READY → ACTING) for the seat that is to act.
      if (
        this.state.actingIndex === st.seat &&
        this.actionDeadlineAt != null &&
        (st.phase === "OBSERVING" ||
          st.phase === "ANALYSING" ||
          st.phase === "UPDATING_OPPONENT_MODEL")
      ) {
        continue;
      }
      const patternRead = st.phase === "UPDATING_OPPONENT_MODEL";
      const action = String(payload.action ?? "").toUpperCase();
      // Engine payloads carry chip units ($0.01); narrate dollars for owners.
      const amountChips =
        typeof payload.amount === "number" || typeof payload.amount === "string"
          ? Number(payload.amount)
          : null;
      const amountUsd =
        amountChips != null && Number.isFinite(amountChips)
          ? chipsToUsd(BigInt(Math.trunc(amountChips)))
          : null;
      const potUsd = eventPotUsd ?? 0;
      const money = (n: number) =>
        n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
      const actorLabel = actorSeat == null ? "The table" : `Seat ${actorSeat + 1}`;
      let observation: string | undefined;
      if (eventType === "HAND_STARTED") {
        observation = `── Hand · position, stacks, opening price`;
      } else if (eventType === "BLINDS_POSTED") {
        observation = `Blinds posted · pot $${money(potUsd)}`;
      } else if (eventType === "STREET_DEALT") {
        const street = String(payload.street ?? this.state.street);
        observation = `${street[0]?.toUpperCase() ?? ""}${street.slice(1)} dealt · recalculating strength and range`;
      } else if (eventType === "HAND_SETTLED") {
        const winners = Array.isArray(payload.winners)
          ? (payload.winners as Array<{ seatIndex?: number; amount?: number | string }>)
          : [];
        if (winners.length === 1 && winners[0]?.seatIndex != null) {
          const wAmt =
            winners[0].amount != null
              ? chipsToUsd(BigInt(Math.trunc(Number(winners[0].amount))))
              : 0;
          observation = `── Hand complete · Seat ${Number(winners[0].seatIndex) + 1} wins $${money(wAmt)}`;
        } else {
          observation = `── Hand complete`;
        }
      } else if (eventType === "PLAYER_ACTED" && action) {
        const sized = amountUsd != null && amountUsd > 0 ? ` $${money(amountUsd)}` : "";
        observation =
          actorSeat === st.seat
            ? amountUsd != null && amountUsd > 0
              ? `My ${action}${sized} is in · pot $${money(potUsd)}`
              : `My ${action} is in · pot $${money(potUsd)}`
            : `${actorLabel} ${action}${sized} · updating range`;
      } else if (patternRead) {
        observation = "Opponent range updated from bets, checks, calls, and folds.";
      }
      this.sendOwnerAiCognition(st.seat, {
        phase: st.phase,
        energyRemaining: st.energyRemaining,
        energyPerHand: st.energyPerHand,
        publicCadenceMs: st.publicCadenceMs,
        signalSource: st.signalSource ?? "cognition",
        handId: st.handId ?? handId,
        sessionId: st.sessionId,
        atMs: st.atMs,
        publicNarrative: observation,
        publicThinkingLog: observation ? [observation] : undefined,
      });
    }
    // WP-111 — explicit hand/end so rake is recorded even if observe mapping misses.
    if (eventType === "HAND_SETTLED") {
      void notifyAgentRuntimeHandEnd({
        sessionId: this.sessionIdForAi(),
        handId,
        rakeRevenue: rake,
      });
    }
  }

  /**
   * Seat a player. Externally reachable (HTTP / WS), so it takes the seat lock;
   * table-loop callers use {@link joinUnlocked} because they already run inside
   * the single-threaded loop.
   */
  async join(opts: Parameters<TableRuntime["joinUnlocked"]>[0]) {
    return this.withSeatLock(() => this.joinUnlocked(opts));
  }

  async joinUnlocked(opts: {
    userId: string;
    agentId: string;
    agentConfigId: string;
    buyIn: number;
    seatIndex?: number;
    profileKey: string;
    stopLoss?: number;
    profitTarget?: number;
    autoRebuy?: boolean;
    /** WP-042: skip queue when applying an epoch-boundary flush. */
    forceImmediate?: boolean;
  }) {
    // Enforce table buy-in window (ranked arena uses fixed equal stacks).
    const limits = await query(`select min_buy_in, max_buy_in, arena_mode from tables where id=$1`, [this.tableId]);
    const minBuy = Number(limits.rows[0]?.min_buy_in ?? 0);
    const maxBuy = Number(limits.rows[0]?.max_buy_in ?? Number.POSITIVE_INFINITY);
    this.arenaMode = limits.rows[0]?.arena_mode === "onchain" ? "onchain" : "demo";
    if (opts.buyIn < minBuy || opts.buyIn > maxBuy) {
      throw new Error(`Buy-in must be $${minBuy}–$${maxBuy}`);
    }

    if (this.matchClosed) {
      throw new Error("Match over — this table is settling. Find a new match to buy in again.");
    }

    if (this.arenaMode === "onchain") {
      const onchain = await getOnchainSessionForTable(this.tableId);
      if (!onchain || (onchain.status !== "opened" && onchain.status !== "playing")) {
        throw new Error(
          onchain?.status === "pending"
            ? "Session opening on-chain — wait for confirmation before joining"
            : onchain?.status === "settling" || onchain?.status === "settled"
              ? "Match over — session is settling. Find a new match to buy in again."
              : "On-chain session not opened for this table",
        );
      }
      // New custody session on this table ⇒ new match (clear elimination freeze).
      if (this.onchainSessionId && this.onchainSessionId !== onchain.session_id) {
        this.matchClosed = false;
      }
      this.onchainSessionId = onchain.session_id;
      // Sealed HU: only the original session players may sit. No outsider refill.
      if (this.isHeadsUpTable()) {
        const sealed = await query<{ profile_id: string }>(
          `select profile_id from onchain_session_players where session_id = $1`,
          [onchain.session_id],
        );
        if (sealed.rows.length > 0) {
          const allowed = new Set(sealed.rows.map((r) => String(r.profile_id)));
          if (!allowed.has(opts.userId)) {
            throw new Error("This heads-up match is sealed — only the original players may sit.");
          }
          // Already cashed out / busted out of THIS session — must Find Match again
          // (new ticket + buy-in), not refill the eliminated seat for free.
          const priorInSession = await query<{ id: string }>(
            `select ts.id from table_sessions ts
             where ts.table_id = $1 and ts.owner_id = $2 and ts.status = 'completed'
               and ts.ended_at is not null
               and ts.ended_at >= (select created_at from onchain_sessions where session_id = $3)
             limit 1`,
            [this.tableId, opts.userId, onchain.session_id],
          );
          if (priorInSession.rows[0]) {
            throw new Error(
              "You already left this match. Commit a new buy-in via Find Match — seats are not free refills.",
            );
          }
        }
      }
    }

    const already = this.state.seats.find((s) => s.playerId === opts.userId && !s.sitOut);
    if (already) {
      // Idempotent: prior join may have seated the player but failed before the client navigated.
      return {
        seatIndex: already.seatIndex,
        sessionId: this.sessions.get(opts.userId) ?? null,
        seated: this.state.seats.filter((s) => s.playerId && !s.sitOut).length,
        alreadySeated: true,
        queued: false,
      };
    }
    // Still seated but sat out / busted — resume via top-up, don't create a second seat.
    const selfSitOut = this.state.seats.find((s) => s.playerId === opts.userId);
    if (selfSitOut) {
      throw new Error("Already seated — use top-up to add chips");
    }

    // WP-042: mid-hand joins are queued for the next epoch — no participant mutation.
    const phase = this.currentHandPhase();
    if (phase === "hand_active" && !opts.forceImmediate) {
      const enqueued = await enqueueSeatChange({
        tableId: this.tableId,
        changeType: "join",
        ownerId: opts.userId,
        phase,
        participants: this.epochParticipants(),
        agentId: opts.agentId,
        agentConfigId: opts.agentConfigId,
        seatIndex: opts.seatIndex ?? null,
        amount: opts.buyIn,
        profileKey: opts.profileKey,
        payload: {
          agentConfigId: opts.agentConfigId,
          profileKey: opts.profileKey,
          stopLoss: opts.stopLoss ?? null,
          profitTarget: opts.profitTarget ?? null,
          autoRebuy: opts.autoRebuy ?? false,
        },
      });
      if (enqueued.queued === false) throw new Error(enqueued.reason);
      await this.persistEvent("JOIN_QUEUED", {
        userId: opts.userId,
        buyIn: opts.buyIn,
        targetEpoch: enqueued.targetEpoch,
        changeId: enqueued.change.id,
      }).catch(() => null);
      this.broadcastSnapshots();
      return {
        seatIndex: null,
        sessionId: null,
        seated: this.state.seats.filter((s) => s.playerId && !s.sitOut).length,
        alreadySeated: false,
        queued: true,
        targetEpoch: enqueued.targetEpoch,
        changeId: enqueued.change.id,
      };
    }

    // On-chain, the seat is not ours to choose: matchmaking committed a
    // randomized seat order (WP-040) into onchain_session_players before
    // custody was sealed, and settlement maps payouts back through it. Taking
    // the first free seat instead would silently disagree with the sealed
    // session whenever two players seat in an order the pairer did not pick.
    let assignedSeat = opts.seatIndex ?? null;
    if (assignedSeat == null && this.arenaMode === "onchain") {
      if (!this.onchainSessionId) await this.loadOnchainSession();
      if (this.onchainSessionId) {
        const row = await query<{ seat: number | null }>(
          `select seat from onchain_session_players where session_id = $1 and profile_id = $2 limit 1`,
          [this.onchainSessionId, opts.userId],
        ).catch(() => ({ rows: [] as { seat: number | null }[] }));
        const seat = row.rows[0]?.seat;
        if (seat != null) assignedSeat = Number(seat);
      }
    }

    // Only truly empty seats. Never steal another player's sit-out / busted seat.
    const empty = this.state.seats.find(
      (s) => (assignedSeat == null || s.seatIndex === assignedSeat) && !s.playerId,
    );
    if (!empty) {
      throw new Error(
        assignedSeat == null
          ? "No open seat"
          : `Seat ${assignedSeat} is not available on this table`,
      );
    }
    const sessionId = randomUUID();
    await lockBuyIn(opts.userId, opts.buyIn, sessionId, this.arenaMode);
    await query(
      `insert into table_sessions (id, table_id, owner_id, agent_id, agent_config_id, seat_index, buy_in, stack, stop_loss, profit_target, auto_rebuy, server_seed_commit)
       values ($1,$2,$3,$4,$5,$6,$7,$7,$8,$9,$10,$11)`,
      [
        sessionId,
        this.tableId,
        opts.userId,
        opts.agentId,
        opts.agentConfigId,
        empty.seatIndex,
        opts.buyIn,
        opts.stopLoss ?? null,
        opts.profitTarget ?? null,
        opts.autoRebuy ?? false,
        null,
      ],
    );
    await query(
      `update table_seats set status='occupied', agent_id=$1, owner_id=$2, stack=$3, updated_at=now()
       where table_id=$4 and seat_index=$5`,
      [opts.agentId, opts.userId, opts.buyIn, this.tableId, empty.seatIndex],
    );
    this.state = seatPlayer(this.state, empty.seatIndex, opts.userId, opts.agentId, usdToChips(opts.buyIn));
    this.agentProfiles.set(empty.seatIndex, opts.profileKey);
    this.sessions.set(opts.userId, sessionId);
    this.stackBaseline.set(opts.userId, opts.buyIn);
    this.sessionStartHand.set(sessionId, this.state.handNumber);
    try {
      await this.persistEvent("PLAYER_JOINED", {
        seatIndex: empty.seatIndex,
        userId: opts.userId,
        agentId: opts.agentId,
        buyIn: opts.buyIn,
      });
    } catch (err) {
      // Seat + escrow already committed — don't fail the join for logging/event issues.
      console.error("PLAYER_JOINED event failed", this.tableId, err);
      this.broadcastSnapshots();
    }
    const seatedCount = this.state.seats.filter((s) => s.playerId && !s.sitOut).length;
    if (this.arenaMode === "onchain" && this.onchainSessionId && seatedCount >= 2) {
      await markOnchainSessionPlaying(this.onchainSessionId).catch((err) =>
        console.error("markOnchainSessionPlaying failed", this.tableId, err),
      );
    }
    this.ensureLoop();
    this.broadcastSnapshots();
    return {
      seatIndex: empty.seatIndex,
      sessionId,
      seated: seatedCount,
      alreadySeated: false,
      queued: false,
    };
  }

  /** Push a fresh private/public snapshot to every connected client. */
  broadcastSnapshots() {
    for (const c of this.clients) {
      if (c.role === "spectator") continue;
      c.send({ type: "snapshot", sequence: this.sequence, state: this.viewFor(c) });
    }
    // Spectators receive the same public snapshot on the delayed channel.
    this.enqueueSpectatorMessages([
      { type: "snapshot", sequence: this.sequence, state: this.spectatorView() },
    ]);
  }

  /**
   * Net-on-award (NLHE_ENGINE_RC1): rake is already removed from stacks at hand
   * settle. Kept as a no-op so leave/match-end call sites remain stable.
   */
  async collectSessionRakeTabs(_seatIndexes?: number[]) {
    return 0;
  }

  /** Active session buy-ins keyed by seat (for profit-capped rake collection). */
  private async buyInBySeatIndex(): Promise<Map<number, number>> {
    const map = new Map<number, number>();
    const rows = await query<{ seat_index: number; buy_in: string | number }>(
      `select seat_index, buy_in from table_sessions
       where table_id=$1 and status in ('active','completed')
       order by started_at desc`,
      [this.tableId],
    ).catch(() => ({ rows: [] as { seat_index: number; buy_in: string | number }[] }));
    for (const row of rows.rows) {
      const seat = Number(row.seat_index);
      const buyIn = Number(row.buy_in);
      if (!Number.isFinite(seat) || !Number.isFinite(buyIn) || buyIn <= 0) continue;
      if (!map.has(seat)) map.set(seat, buyIn);
    }
    for (const [userId, baseline] of this.stackBaseline) {
      const seat = this.state.seats.find((s) => s.playerId === userId);
      if (seat && !map.has(seat.seatIndex) && baseline > 0) {
        map.set(seat.seatIndex, baseline);
      }
    }
    return map;
  }

  /**
   * If a hand is live and only one non-folded player remains, award the pot.
   * Used when someone leaves / folds out the field.
   */
  async settleIfOnePlayerLeft(reason: string) {
    const live = this.state.seats.filter((s) => !s.folded && s.playerId && !s.sitOut);
    if (live.length !== 1) return false;
    if (!this.state.handId || this.state.street === "waiting" || this.state.street === "settlement") return false;
    this.clearPendingHuman();
    this.actionDeadlineAt = null;
    const { state, events } = foldWin(this.state);
    this.state = state;
    for (const ev of events) await this.emitEngine(ev);
    await this.syncStacks();
    await this.persistEvent("HAND_COMPLETE", { reason, winnerSeat: live[0].seatIndex, potWon: true }).catch(() => null);
    this.resetToWaiting();
    await this.applyEpochBoundary();
    return true;
  }

  /** External unseat path — see {@link join} for why this is serialized. */
  async leave(userId: string, opts?: { forceImmediate?: boolean }) {
    return this.withSeatLock(() => this.leaveUnlocked(userId, opts));
  }

  async leaveUnlocked(userId: string, opts?: { forceImmediate?: boolean }) {
    const seat = this.state.seats.find((s) => s.playerId === userId);
    if (!seat || !seat.playerId) {
      // Still close any orphaned DB session so the lobby doesn't think we're seated.
      await this.completeSessionsForUser(userId, 0);
      // Custody may exist even when join never seated the player (stuck CONNECTING).
      if (this.arenaMode === "onchain") {
        if (!this.onchainSessionId) await this.loadOnchainSession();
        const abandoned = await abandonUnseatedOnchainPlayer({
          profileId: userId,
          tableId: this.tableId,
        }).catch((err) => {
          console.error("abandonUnseatedOnchainPlayer failed", this.tableId, err);
          return { abandoned: false as const };
        });
        if (abandoned.abandoned && abandoned.sessionId) {
          await markOnchainSessionReadyForSettlement(abandoned.sessionId).catch(() => null);
        }
      }
      this.pendingLeaveOwners.delete(userId);
      return {
        queued: false,
        ok: true,
        abandoned: true,
        handsPlayed: Math.max(0, Number(this.state.handNumber) || 0),
      };
    }

    // WP-042: mid-hand leave is queued — player remains exposed until hand finishes.
    const phase = this.currentHandPhase();
    if (phase === "hand_active" && !opts?.forceImmediate) {
      const enqueued = await enqueueSeatChange({
        tableId: this.tableId,
        changeType: "leave",
        ownerId: userId,
        phase,
        participants: this.epochParticipants(),
        agentId: seat.agentId,
        seatIndex: seat.seatIndex,
      });
      if (enqueued.queued === false) {
        // Idempotent: already queued
        if (enqueued.reason === "leave_already_queued") {
          this.pendingLeaveOwners.add(userId);
          return { queued: true, ok: true, reason: enqueued.reason };
        }
        throw new Error(enqueued.reason);
      }
      this.pendingLeaveOwners.add(userId);
      await this.persistEvent("LEAVE_QUEUED", {
        seatIndex: seat.seatIndex,
        userId,
        targetEpoch: enqueued.targetEpoch,
        changeId: enqueued.change.id,
        allIn: Boolean(seat.allIn),
      }).catch(() => null);
      this.broadcastSnapshots();
      return { queued: true, ok: true, targetEpoch: enqueued.targetEpoch, changeId: enqueued.change.id };
    }

    const seatIndex = seat.seatIndex;
    const agentId = seat.agentId;
    // Collect this seat's fee tab before cash-out so payouts are net of platform rake.
    await this.collectSessionRakeTabs([seatIndex]);
    const seatAfter = this.state.seats.find((s) => s.seatIndex === seatIndex);
    const stack = Math.max(0, chipsToUsd(seatAfter?.stack ?? seat.stack));
    let sessionId = this.sessions.get(userId);
    if (!sessionId) {
      const row = await query(
        `select id from table_sessions where table_id=$1 and owner_id=$2 and status='active' limit 1`,
        [this.tableId, userId],
      );
      sessionId = row.rows[0]?.id;
    }
    const midHand =
      Boolean(this.state.handId) && this.state.street !== "waiting" && this.state.street !== "settlement";
    const wasActing = this.state.actingIndex === seatIndex;

    // Legacy force path only: mid-hand leave = fold + forfeit (should not run under WP-042 queue).
    if (midHand && !seat.folded) {
      this.state = foldSeat(this.state, seatIndex);
      if (wasActing) this.clearPendingHuman();
      const awarded = await this.settleIfOnePlayerLeft("opponent_left");
      if (!awarded && wasActing) {
        const legalNext = this.state.seats.find(
          (s) => !s.folded && !s.allIn && s.playerId && !s.sitOut && s.seatIndex !== seatIndex,
        );
        this.state = { ...this.state, actingIndex: legalNext?.seatIndex ?? null };
      }
    }

    // Rebalance escrow to the chips still in front of the player before cash-out.
    // Pot contributions (baseline − stack) move to clearing so AT TABLES can hit $0.
    const baseline = this.stackBaseline.get(userId) ?? stack;
    if (baseline !== stack) {
      try {
        await rebalanceEscrowToStacks(
          `leave_${this.tableId}_${userId}_${Date.now()}`,
          [{ userId, prevStack: baseline, nextStack: stack }],
          this.arenaMode,
        );
        this.stackBaseline.set(userId, stack);
      } catch (err) {
        console.error("leave escrow rebalance failed", this.tableId, err);
      }
    }

    // Fully vacate — never leave a dimmed $0 "ghost" card behind.
    this.state = clearSeat(this.state, seatIndex);
    await query(
      `update table_seats set status='empty', agent_id=null, owner_id=null, stack=0, updated_at=now() where table_id=$1 and seat_index=$2`,
      [this.tableId, seatIndex],
    );
    if (sessionId) {
      try {
        if (stack > 0) await releaseSession(userId, stack, sessionId, this.arenaMode);
      } catch (err) {
        console.error("releaseSession failed on leave", this.tableId, err);
      }
      await query(`update table_sessions set status='completed', stack=$1, ended_at=now() where id=$2`, [
        stack,
        sessionId,
      ]);
      try {
        await this.maybeSettleHeadsUpMatch(userId, agentId, sessionId, stack);
      } catch (err) {
        console.error("rated match settlement failed", this.tableId, err);
      }
      this.sessions.delete(userId);
      this.stackBaseline.delete(userId);
      this.sessionStartHand.delete(sessionId);
    } else {
      await this.completeSessionsForUser(userId, stack);
    }
    this.agentProfiles.delete(seatIndex);
    this.pendingLeaveOwners.delete(userId);
    for (const c of this.clients) {
      if (c.userId === userId) c.seatIndex = undefined;
    }

    try {
      const meta = await query<{ league_id: string; variant_id: string }>(
        `select league_id, variant_id from tables where id=$1`,
        [this.tableId],
      );
      const cityId = String(meta.rows[0]?.league_id ?? "");
      const format = String(meta.rows[0]?.variant_id ?? "").includes("6max") ? "sixmax" : "hu";
      if (cityId) {
        await recordRatHoleExit({
          ownerId: userId,
          cityId,
          format,
          leavingStackUsd: stack,
        });
      }
    } catch (err) {
      console.error("rat-hole exit record failed", this.tableId, err);
    }

    try {
      await this.persistEvent("PLAYER_LEFT", { seatIndex, userId, stack, midHand });
    } catch (err) {
      console.error("PLAYER_LEFT event failed", this.tableId, err);
    }

    const remaining = this.state.seats.filter((s) => s.playerId && !s.sitOut && s.stack > 0n);
    if (remaining.length < 2 && this.state.street !== "waiting" && this.state.street !== "settlement") {
      await this.settleIfOnePlayerLeft("table_abandoned");
      this.resetToWaiting();
    }

    // On-chain HU/cash: one leaver must not leave the opponent (often AI) alone
    // holding everyone's activeGames slot forever. Cash out leftovers and settle.
    const seatedAfter = this.state.seats.filter((s) => s.playerId);
    if (this.arenaMode === "onchain" && seatedAfter.length < 2) {
      await this.closeOnchainTableAfterUndermannedLeave("opponent_left").catch((err) =>
        console.error("closeOnchainTableAfterUndermannedLeave failed", this.tableId, err),
      );
    } else if (this.arenaMode === "onchain" && this.onchainSessionId) {
      await markOnchainSessionReadyForSettlement(this.onchainSessionId).catch((err) =>
        console.error("markOnchainSessionReadyForSettlement failed", this.tableId, err),
      );
    }

    // Always push a fresh snapshot so every client flips the seat to SEAT OPEN.
    this.broadcastSnapshots();
    const startHand = sessionId ? (this.sessionStartHand.get(sessionId) ?? 0) : 0;
    const handsPlayed = Math.max(0, (Number(this.state.handNumber) || 0) - startHand);
    return { queued: false, ok: true, handsPlayed };
  }

  /**
   * After a leave leaves fewer than two seats occupied, end the custody match:
   * cash out remaining seats, mark settling, deactivate the table (unless a
   * queue ticket is still waiting to sit before any hand has started).
   */
  async closeOnchainTableAfterUndermannedLeave(reason: string) {
    if (!this.onchainSessionId) await this.loadOnchainSession();
    const sessionId = this.onchainSessionId;
    if (!sessionId) return;

    // Pre-hand progressive fill: someone still in queue → keep table warm.
    const hands = await query<{ n: string }>(
      `select count(*)::text as n from hands where table_id = $1`,
      [this.tableId],
    );
    const queued = await query(
      `select 1 from seat_tickets
       where session_id = $1 and status in ('queued', 'matched')
       limit 1`,
      [sessionId],
    );
    if (Number(hands.rows[0]?.n ?? 0) === 0 && queued.rows[0]) {
      await markOnchainSessionReadyForSettlement(sessionId).catch(() => null);
      return;
    }

    for (const s of [...this.state.seats]) {
      if (!s.playerId) continue;
      const uid = s.playerId;
      const seatIndex = s.seatIndex;
      try {
        await this.collectSessionRakeTabs([seatIndex]);
      } catch {
        /* ignore */
      }
      const seatAfter = this.state.seats.find((x) => x.seatIndex === seatIndex);
      const stack = Math.max(0, chipsToUsd(seatAfter?.stack ?? s.stack));
      let sid = this.sessions.get(uid);
      if (!sid) {
        const row = await query(
          `select id from table_sessions where table_id=$1 and owner_id=$2 and status='active' limit 1`,
          [this.tableId, uid],
        );
        sid = row.rows[0]?.id;
      }
      const baseline = this.stackBaseline.get(uid) ?? stack;
      if (baseline !== stack) {
        try {
          await rebalanceEscrowToStacks(
            `leave_cleanup_${this.tableId}_${uid}_${Date.now()}`,
            [{ userId: uid, prevStack: baseline, nextStack: stack }],
            this.arenaMode,
          );
        } catch (err) {
          console.error("cleanup escrow rebalance failed", this.tableId, err);
        }
      }
      this.state = clearSeat(this.state, seatIndex);
      await query(
        `update table_seats set status='empty', agent_id=null, owner_id=null, stack=0, updated_at=now()
         where table_id=$1 and seat_index=$2`,
        [this.tableId, seatIndex],
      );
      if (sid) {
        try {
          if (stack > 0) await releaseSession(uid, stack, sid, this.arenaMode);
        } catch (err) {
          console.error("cleanup releaseSession failed", this.tableId, err);
        }
        await query(`update table_sessions set status='completed', stack=$1, ended_at=now() where id=$2`, [
          stack,
          sid,
        ]);
        this.sessions.delete(uid);
        this.stackBaseline.delete(uid);
        this.sessionStartHand.delete(sid);
      } else {
        await this.completeSessionsForUser(uid, stack);
      }
      this.agentProfiles.delete(seatIndex);
      this.pendingLeaveOwners.delete(uid);
      for (const c of this.clients) {
        if (c.userId === uid) c.seatIndex = undefined;
      }
    }

    await closeOnchainSessionForSettlement(sessionId).catch((err) =>
      console.error("closeOnchainSessionForSettlement failed", this.tableId, err),
    );
    await query(`update tables set is_active = false where id = $1`, [this.tableId]);
    this.matchClosed = true;
    this.resetToWaiting();
    await this.persistEvent("MATCH_COMPLETE", {
      reason,
      message: "Match closed — fewer than two players remain. Find Match starts a new session.",
    }).catch(() => null);
  }

  /**
   * When a session ends and exactly one other active session remains at this
   * table, that pair just played a heads-up stretch — settle it as a rated
   * HU match so Arena Rating actually moves with real game results. Margin
   * of victory is ignored per spec: only who ended up ahead matters.
   */
  async maybeSettleHeadsUpMatch(userId: string, agentId: string | undefined, sessionId: string, finalStack: number) {
    // On-chain rated matches are settled after hub confirmation (settlement-worker).
    if (this.arenaMode === "onchain") {
      if (this.onchainSessionId) {
        const oc = await query<{ status: string }>(
          `select status from onchain_sessions where session_id = $1 limit 1`,
          [this.onchainSessionId],
        );
        if (oc.rows[0]?.status !== "settled") return;
      } else {
        return;
      }
    }

    const others = [...this.sessions.entries()].filter(([uid]) => uid !== userId);
    if (others.length !== 1) return; // only rate clean 1-on-1 stretches for now
    const [opponentId, opponentSessionId] = others[0];
    if (!opponentId || !opponentSessionId) return;

    // Casual / unranked tables never move Arena Rating.
    const leagueRow = await query<{ league_id: string }>(
      `select league_id::text as league_id from tables where id = $1 limit 1`,
      [this.tableId],
    );
    const leagueId = leagueRow.rows[0]?.league_id ?? "bronze";
    if (!isRankedLeague(leagueId)) return;

    // Texas Hold'em → HU pool. Poker Classic → 6-max pool only for degenerate HU sessions.
    const poolId =
      this.variantId === "nlhe_hu"
        ? "hu_holdem_standard"
        : this.variantId === "nlhe_6max"
          ? "nlhe_6max_standard"
          : null;
    if (!poolId) return;

    const startHand = this.sessionStartHand.get(sessionId) ?? this.state.handNumber;
    const hands = Math.max(0, this.state.handNumber - startHand);
    if (hands < 1) return; // never actually played a hand together

    const rows = await query(`select id, buy_in, stack, agent_id from table_sessions where id in ($1,$2)`, [
      sessionId,
      opponentSessionId,
    ]);
    const mine = rows.rows.find((r: { id: string }) => r.id === sessionId);
    const theirs = rows.rows.find((r: { id: string }) => r.id === opponentSessionId);
    if (!mine || !theirs) return;

    const myProfit = finalStack - Number(mine.buy_in);
    const theirProfit = Number(theirs.stack) - Number(theirs.buy_in);
    const scoreA: 0 | 0.5 | 1 = myProfit > theirProfit ? 1 : myProfit < theirProfit ? 0 : 0.5;

    await settleRatedMatch({
      poolId,
      ownerA: userId,
      ownerB: opponentId,
      agentA: agentId ?? null,
      agentB: theirs.agent_id ?? null,
      scoreA,
      hands,
      tableId: this.tableId,
      stake: Number(mine.buy_in),
      eventLogRoot: this.prevHash,
      reason: "session_end",
      gate: { matchClass: "ranked_public" },
    });
  }

  async completeSessionsForUser(userId: string, stack: number) {
    const rows = await query(
      `select id from table_sessions where table_id=$1 and owner_id=$2 and status='active'`,
      [this.tableId, userId],
    );
    for (const r of rows.rows) {
      try {
        await releaseSession(userId, stack, r.id, this.arenaMode);
      } catch {
        /* already released */
      }
      await query(`update table_sessions set status='completed', stack=$1, ended_at=now() where id=$2`, [
        stack,
        r.id,
      ]);
      this.sessions.delete(userId);
      this.stackBaseline.delete(userId);
    }
  }

  /** WP-080: bind fencing token from lease manager after acquire. */
  bindLease(actorInstanceId: string, leaseVersion: number) {
    this.leaseActorId = actorInstanceId;
    this.leaseVersion = leaseVersion;
  }

  clearLease() {
    this.leaseActorId = null;
    this.leaseVersion = null;
  }

  ensureLoop() {
    if (!this.durableChainOk) {
      console.error("[table-runtime] ensureLoop blocked — durable chain not ok", this.tableId, this.durableChainIssues);
      return;
    }
    if (this.running) return;
    this.running = true;
    void this.loop();
  }

  /** Stop the actor loop after lease loss (split-brain prevention). */
  stopLoop() {
    this.running = false;
    this.clearLease();
  }

  resetToWaiting(opts?: { restoreStacks?: Map<number, bigint> }) {
    const orphanHandId = this.state.handId;
    this.clearPendingHuman();
    this.actionDeadlineAt = null;
    this.equity = null;
    this.runoutRevealed = {};
    this.runoutRevealPublished = false;
    this.privateEquityCache.clear();
    const restore = opts?.restoreStacks;
    this.state = {
      ...this.state,
      street: "waiting",
      handId: null,
      actingIndex: null,
      board: [],
      pot: 0n,
      currentBet: 0n,
      winners: [],
      deck: [],
      seats: this.state.seats.map((s) => ({
        ...s,
        stack: restore?.get(s.seatIndex) ?? s.stack,
        bet: 0n,
        totalBet: 0n,
        hole: undefined,
        folded: s.sitOut || !s.playerId || (restore?.get(s.seatIndex) ?? s.stack) <= 0n,
        allIn: false,
      })),
    };
    if (orphanHandId) {
      void query(`update hands set status = 'void', settled_at = now() where id = $1 and status = 'running'`, [
        orphanHandId,
      ]).catch(() => null);
    }
  }

  async publishRunoutEquity(revealCards: boolean) {
    const live = this.state.seats.filter((s) => !s.folded && s.playerId && s.hole?.length === 2);
    if (live.length < 2) return;
    const players = live.map((s) => ({ seatIndex: s.seatIndex, hole: s.hole! }));
    this.equity = computeEquity(players, this.state.board);
    this.runoutRevealed = Object.fromEntries(players.map((p) => [p.seatIndex, p.hole]));
    const labels = players.map((p) => ({
      seatIndex: p.seatIndex,
      label: madeHandLabel(p.hole, this.state.board),
    }));
    if (revealCards && !this.runoutRevealPublished) {
      this.runoutRevealPublished = true;
      await this.persistEvent("RUNOUT_REVEALED", {
        reveals: players.map((p) => ({ seatIndex: p.seatIndex, cards: p.hole })),
        equity: this.equity,
      });
    } else {
      await this.persistEvent("EQUITY_UPDATED", { equity: this.equity, labels });
    }
  }

  async advanceRunout() {
    // Show odds (and reveal holes once) before each board segment / showdown.
    await this.publishRunoutEquity(!this.runoutRevealPublished);
    await sleep(1600);
    if (this.state.street === "settlement" || !this.state.handId) return;
    const { state, events } = continueRunout(this.state);
    this.state = state;
    for (const ev of events) await this.emitEngine(ev);
    if (this.state.street !== "settlement" && this.state.board.length > 0) {
      // Refresh equity after the new street lands.
      await this.publishRunoutEquity(false);
    }
  }

  async loop() {
    while (this.running) {
      try {
        const seated = this.state.seats.filter((s) => !s.sitOut && s.playerId && s.stack > 0n);
        if (seated.length < 2) {
          if (this.state.street !== "waiting" && this.state.street !== "settlement") {
            await this.settleIfOnePlayerLeft("alone_at_table");
            this.resetToWaiting();
            this.broadcastSnapshots();
          } else if (this.state.street !== "waiting") {
            this.resetToWaiting();
            this.broadcastSnapshots();
          }
          await sleep(1500);
          continue;
        }
        if (this.state.street === "waiting" || this.state.street === "settlement" || !this.state.handId) {
          await this.beginHand();
        }
        while (this.state.actingIndex !== null && this.state.street !== "settlement") {
          await this.actForCurrent();
          await sleep(250);
        }
        // All-in runout: reveal cards, show equity bars, deal flop/turn/river with pauses.
        while (
          this.state.handId &&
          this.state.street !== "settlement" &&
          this.state.street !== "waiting" &&
          this.state.actingIndex === null &&
          (isAllInRunout(this.state) || this.state.board.length >= 5)
        ) {
          await this.advanceRunout();
          await sleep(400);
        }
        if (this.state.street === "settlement") {
          await this.syncStacks();
          // Broke players sit out until they top up (UI prompts rebuy).
          this.state = {
            ...this.state,
            seats: this.state.seats.map((s) =>
              s.playerId && s.stack <= 0n ? { ...s, sitOut: true, folded: true, hole: undefined } : s,
            ),
          };
          for (const s of this.state.seats) {
            if (s.playerId && s.stack <= 0n) {
              await query(`update table_seats set stack=0, updated_at=now() where table_id=$1 and seat_index=$2`, [
                this.tableId,
                s.seatIndex,
              ]);
            }
          }
          this.resetToWaiting();
          await this.persistEvent("HAND_COMPLETE", {
            seated: this.state.seats.filter((x) => x.playerId && !x.sitOut && x.stack > 0).length,
            needTopUp: this.state.seats.filter((x) => x.playerId && x.stack <= 0).map((x) => x.playerId),
          }).catch(() => null);
          // Hold so clients can play win / reveal animations — and busted players can top up.
          await sleep(3200);
          // Anyone still at $0 vacates: open seat, not a dimmed ghost card.
          // They do NOT get free chips — a new buy-in (top-up before vacate, or
          // Find Match after) is required.
          const broke = this.state.seats.filter((s) => s.playerId && s.stack <= 0n).map((s) => s.playerId!);
          // Hold the seat lock across the whole boundary so an inbound join
          // cannot land between vacating busted seats and the epoch flush.
          await this.withSeatLock(async () => {
            for (const uid of broke) {
              await this.leaveUnlocked(uid, { forceImmediate: true });
            }
            // Heads-up: elimination ends the sealed match. Do not flush queued
            // joins that would refill the seat with "mystery" chips.
            if (this.isHeadsUpTable() && broke.length > 0) {
              await this.closeMatchForElimination(broke);
            } else {
              // WP-042: apply queued join/leave/top-up before the next hand.
              await this.applyEpochBoundary();
            }
          });
        }
      } catch (err) {
        console.error("table loop error", this.tableId, err);
        // Recover from partial hand starts (orphan handId / duplicate hand_number).
        try {
          const hn = await query(`select coalesce(max(hand_number), 0)::int as m from hands where table_id = $1`, [
            this.tableId,
          ]);
          this.state = { ...this.state, handNumber: Number(hn.rows[0]?.m ?? 0) };
        } catch {
          /* ignore */
        }
        // Prefer DB stacks after a failed deal — in-memory blinds must not stick.
        try {
          const rows = await query<{ seat_index: number; stack: string }>(
            `select seat_index, stack::text from table_seats where table_id = $1 and status = 'occupied'`,
            [this.tableId],
          );
          const fromDb = new Map<number, bigint>();
          for (const r of rows.rows) {
            fromDb.set(Number(r.seat_index), usdToChips(Number(r.stack)));
          }
          if (fromDb.size > 0) this.resetToWaiting({ restoreStacks: fromDb });
          else this.resetToWaiting();
        } catch {
          this.resetToWaiting();
        }
        this.broadcastSnapshots();
        await sleep(1500);
      }
    }
  }

  /**
   * HU elimination: close the sealed custody session and freeze the table so
   * nobody can sit back with a fresh stack without a new Find Match buy-in.
   */
  async closeMatchForElimination(eliminated: string[]) {
    this.matchClosed = true;
    // Winner may still be seated with gross stacks — claw back all tabs before settle.
    await this.collectSessionRakeTabs();
    if (this.arenaMode === "onchain") {
      if (!this.onchainSessionId) await this.loadOnchainSession();
      if (this.onchainSessionId) {
        await closeOnchainSessionForSettlement(this.onchainSessionId).catch((err) =>
          console.error("closeOnchainSessionForSettlement failed", this.tableId, err),
        );
      }
    }
    await this.persistEvent("MATCH_COMPLETE", {
      reason: "elimination",
      eliminated,
      message: "Heads-up match over — eliminated players must Find Match to buy in again.",
    }).catch(() => null);
    this.broadcastSnapshots();
  }

  async beginHand() {
    if (this.matchClosed) return;
    // Deal back in anyone whose natural big blind has arrived (wait-for-BB).
    // Runs BEFORE the seated-count gate: a returning player may be the second
    // player the table needs, and releasing later would deadlock the table.
    this.releaseSeatsAwaitingBigBlind();
    const seated = this.state.seats.filter((s) => !s.sitOut && s.playerId && s.stack > 0n);
    if (seated.length < 2) return;

    // WP-042 safety net: flush pending queue only (avoid double epoch rotate).
    await this.withSeatLock(() => this.applyEpochBoundary({ onlyIfPending: true }));

    const seatedAfter = this.state.seats.filter((s) => !s.sitOut && s.playerId && s.stack > 0n);
    if (seatedAfter.length < 2) return;

    // On-chain: hard-gate first deal on confirmed V2 custody locks (not ledger mirror alone).
    if (this.arenaMode === "onchain") {
      if (!this.onchainSessionId) await this.loadOnchainSession();
      if (!this.onchainSessionId) {
        console.warn("[table-runtime] beginHand blocked — no onchain session", this.tableId);
        return;
      }
      const oc = await query<{ status: string; player_count: string; lock_count: string }>(
        `select os.status,
                (select count(*)::text from onchain_session_players osp where osp.session_id = os.session_id) as player_count,
                (select count(*)::text from onchain_seat_locks osl
                  where osl.session_id = os.session_id and osl.status in ('locked','opened','active')) as lock_count
         from onchain_sessions os
         where os.session_id = $1
         limit 1`,
        [this.onchainSessionId],
      ).catch(() => ({ rows: [] as { status: string; player_count: string; lock_count: string }[] }));
      const row = oc.rows[0];
      if (!row || !["opened", "playing"].includes(row.status)) {
        console.warn("[table-runtime] beginHand blocked — custody not ready", this.tableId, row?.status);
        return;
      }
      const players = Number(row.player_count ?? 0);
      const locks = Number(row.lock_count ?? 0);
      // Prefer seat-lock rows when present; otherwise trust opened status after openSession receipt.
      if (locks > 0 && locks < Math.min(players, 2)) {
        console.warn("[table-runtime] beginHand blocked — incomplete V2 locks", this.tableId, {
          players,
          locks,
        });
        return;
      }
      if (row.status === "opened") {
        await markOnchainSessionPlaying(this.onchainSessionId).catch(() => undefined);
      }
    }

    // Always continue from DB so restarts / failed inserts cannot collide.
    const hn = await query(`select coalesce(max(hand_number), 0)::int as m from hands where table_id = $1`, [
      this.tableId,
    ]);
    this.state = { ...this.state, handNumber: Number(hn.rows[0]?.m ?? 0) };

    const nextHandNumber = this.state.handNumber + 1;
    let seed: string;
    if (this.arenaMode === "onchain" && this.onchainSessionId) {
      const vrfRow = await query<{ vrf_word: string }>(
        `select vrf_word::text from randomness_fulfillments where session_id = $1 order by fulfilled_at desc limit 1`,
        [this.onchainSessionId],
      ).catch(() => ({ rows: [] as { vrf_word: string }[] }));
      const vrfWord = vrfRow.rows[0]?.vrf_word ?? "0";
      const secretIndex = nextHandNumber % 256;
      const fromDealer = await fetchHandSeed(
        {
          sessionId: this.onchainSessionId,
          handNumber: nextHandNumber,
          vrfWord,
          secretIndex,
        },
        DEALER_URL,
      );
      if (fromDealer?.handSeed) {
        seed = fromDealer.handSeed;
      } else {
        console.warn(
          "[table-runtime] dealer hand-seed unavailable — using deterministic fallback",
          this.tableId,
          this.onchainSessionId,
        );
        seed = fallbackHandSeed({
          sessionId: this.onchainSessionId,
          handNumber: nextHandNumber,
          vrfWord,
          secretIndex,
        });
      }
    } else {
      seed = randomBytes(32).toString("hex");
    }

    const handId = `hand_${this.tableId}_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
    // Range evidence is per-hand; cross-hand stats in `opponentStats` persist.
    this.handActionLog = [];
    this.notePreflopOpenOpportunities();
    // WP-108: capture opening hash/stacks before blinds mutate stacks.
    this.handOpeningStateHash = hashEngineState(this.state);
    this.handOpeningStacks = new Map(
      this.state.seats.filter((s) => s.playerId).map((s) => [s.seatIndex, chipsToUsd(s.stack)]),
    );
    // startHand deducts blinds in memory before events are durable — keep a restore point.
    const stacksBeforeDeal = new Map(this.state.seats.map((s) => [s.seatIndex, s.stack]));
    try {
      const { state, events } = startHand(this.state, seed, handId);

      // Persist hand row BEFORE exposing handId to event writers.
      await query(
        `insert into hands (id, table_id, hand_number, status, button_seat, board, pot, street, seed_commit)
         values ($1,$2,$3,'running',$4,'[]'::jsonb,0,'preflop',$5)`,
        [handId, this.tableId, state.handNumber, state.button, state.seedCommit],
      );
      this.state = state;
      await markEpochActive(this.tableId, state.handNumber);
      await this.refreshSessionEquityDisplay().catch(() => null);
      void this.notifyAiHandBegin(handId);
      for (const ev of events) await this.emitEngine(ev);
    } catch (err) {
      console.error("beginHand failed — restoring stacks", this.tableId, handId, err);
      this.state = { ...this.state, handId };
      this.resetToWaiting({ restoreStacks: stacksBeforeDeal });
      throw err;
    }
  }

  /**
   * Sit out (keep chips, skip future deals) or return.
   * Season 1 return policy: wait for the big blind before being dealt in again.
   */
  async setPlayerSitOut(userId: string, sitOut: boolean) {
    const seat = this.state.seats.find((s) => s.playerId === userId);
    if (!seat) throw new Error("Not seated");

    if (sitOut) {
      this.awaitingBigBlind.delete(seat.seatIndex);
      this.state = setSitOut(this.state, seat.seatIndex, true);
      await this.persistEvent("PLAYER_SIT_OUT", {
        seatIndex: seat.seatIndex,
        userId,
        policy: "effective_next_hand",
      }).catch(() => null);
      this.broadcastSnapshots();
      return { ok: true, sitOut: true, seatIndex: seat.seatIndex, waitingForBigBlind: false };
    }

    // Sitting back in: Season 1 policy is wait-for-big-blind. The seat is only
    // dealt in once the BB reaches it naturally, so a sit-out cannot be used
    // to skip a blind. `beginHand` clears the flag when that hand arrives.
    const wouldBeBb = nextBlindSeats(this.state, {
      extraEligibleSeats: [seat.seatIndex],
    })?.bb;
    const dealInNow = wouldBeBb === seat.seatIndex;

    if (dealInNow) {
      this.awaitingBigBlind.delete(seat.seatIndex);
      this.state = setSitOut(this.state, seat.seatIndex, false);
    } else {
      this.awaitingBigBlind.add(seat.seatIndex);
    }

    await this.persistEvent("PLAYER_SIT_IN", {
      seatIndex: seat.seatIndex,
      userId,
      policy: "wait_for_big_blind",
      waitingForBigBlind: !dealInNow,
    }).catch(() => null);
    this.broadcastSnapshots();
    return {
      ok: true,
      sitOut: !dealInNow,
      seatIndex: seat.seatIndex,
      waitingForBigBlind: !dealInNow,
    };
  }

  /**
   * Deal back in any seat whose natural big blind has now arrived.
   * Called immediately before a hand is dealt.
   */
  releaseSeatsAwaitingBigBlind() {
    if (!this.awaitingBigBlind.size) return;
    for (const seatIndex of [...this.awaitingBigBlind]) {
      const seat = this.state.seats.find((s) => s.seatIndex === seatIndex);
      if (!seat || !seat.playerId || seat.stack <= 0n) {
        this.awaitingBigBlind.delete(seatIndex);
        continue;
      }
      const blinds = nextBlindSeats(this.state, { extraEligibleSeats: [seatIndex] });
      if (blinds?.bb === seatIndex) {
        this.awaitingBigBlind.delete(seatIndex);
        this.state = setSitOut(this.state, seatIndex, false);
      }
    }
  }

  /** Add chips to a seated (possibly busted) player mid-session. */
  async topUp(userId: string, amount: number, opts?: { forceImmediate?: boolean }) {
    if (!(amount > 0)) throw new Error("Invalid top-up");
    const seat = this.state.seats.find((s) => s.playerId === userId);
    if (!seat) throw new Error("Not seated");

    // Never top up above the city's 100BB entry cap via fresh funds.
    const tableRow = await query<{ league_id: string; big_blind: string | number }>(
      `select league_id, big_blind from tables where id=$1`,
      [this.tableId],
    );
    const bb = Number(tableRow.rows[0]?.big_blind ?? chipsToUsd(this.state.config.bigBlind));
    const maxStackUsd = bb * 100;
    const currentUsd = chipsToUsd(seat.stack);
    if (currentUsd + amount > maxStackUsd + 1e-9) {
      const room = Math.max(0, maxStackUsd - currentUsd);
      throw new Error(
        room <= 0
          ? `Already at or above the 100BB table cap ($${maxStackUsd.toFixed(2)})`
          : `Top-up would exceed 100BB; maximum add is $${room.toFixed(2)}`,
      );
    }

    // WP-042: mid-hand top-ups queue for the next epoch (stack mutation deferred).
    const phase = this.currentHandPhase();
    if (phase === "hand_active" && !opts?.forceImmediate) {
      const enqueued = await enqueueSeatChange({
        tableId: this.tableId,
        changeType: "top_up",
        ownerId: userId,
        phase,
        participants: this.epochParticipants(),
        agentId: seat.agentId,
        seatIndex: seat.seatIndex,
        amount,
        idempotencyKey: `top_up:${this.tableId}:${userId}:${Date.now()}`,
      });
      if (enqueued.queued === false) throw new Error(enqueued.reason);
      await this.persistEvent("TOP_UP_QUEUED", {
        seatIndex: seat.seatIndex,
        userId,
        amount,
        targetEpoch: enqueued.targetEpoch,
        changeId: enqueued.change.id,
      }).catch(() => null);
      this.broadcastSnapshots();
      return { stack: seat.stack, queued: true, targetEpoch: enqueued.targetEpoch };
    }

    let sessionId = this.sessions.get(userId);
    if (!sessionId) {
      const row = await query(
        `select id from table_sessions where table_id=$1 and owner_id=$2 and status='active' limit 1`,
        [this.tableId, userId],
      );
      sessionId = row.rows[0]?.id;
      if (!sessionId) throw new Error("No active session");
      this.sessions.set(userId, sessionId);
    }
    await lockBuyIn(userId, amount, `${sessionId}-topup-${Date.now()}`, this.arenaMode);
    const chipAmount = usdToChips(amount);
    const nextStack = seat.stack + chipAmount;
    this.state = {
      ...this.state,
      seats: this.state.seats.map((s) =>
        s.seatIndex === seat.seatIndex
          ? { ...s, stack: nextStack, sitOut: false, folded: this.state.street !== "waiting" ? s.folded : false }
          : s,
      ),
    };
    this.stackBaseline.set(userId, (this.stackBaseline.get(userId) ?? 0) + amount);
    const nextUsd = chipsToUsd(nextStack);
    await query(`update table_seats set stack=$1, updated_at=now() where table_id=$2 and seat_index=$3`, [
      nextUsd,
      this.tableId,
      seat.seatIndex,
    ]);
    await query(`update table_sessions set stack=$1, buy_in = buy_in + $2 where id=$3`, [nextUsd, amount, sessionId]);
    await this.persistEvent("PLAYER_TOP_UP", { seatIndex: seat.seatIndex, userId, amount, stack: nextUsd });
    this.ensureLoop();
    return { stack: nextUsd, queued: false };
  }

  clearPendingHuman(reason: "cancelled" | "replaced" = "cancelled") {
    if (!this.pendingHuman) return;
    const pending = this.pendingHuman;
    this.pendingHuman = null;
    clearTimeout(pending.timer);
    // Prefer fold when cancelling a turn — never auto-check for a human.
    const fold = pending.legal.find((l) => l.action === "fold");
    const check = pending.legal.find((l) => l.action === "check");
    const fallback = fold ?? check ?? pending.legal[0];
    pending.resolve({
      action: fallback?.action ?? "fold",
      amount: fallback?.minAmount != null ? chipsToUsd(fallback.minAmount) : undefined,
      reasonCode: reason === "replaced" ? "turn_replaced" : "turn_cancelled",
    });
  }

  /** Human (or timeout) action while a seat is to act. */
  submitPlayerAction(userId: string, action: PokerAction, amount?: number) {
    if (!this.pendingHuman) throw new Error("No action pending — wait for your clock");
    const seat = this.state.seats.find((s) => s.playerId === userId && !s.sitOut);
    if (!seat) throw new Error("Not seated");
    if (this.state.actingIndex !== seat.seatIndex || this.pendingHuman.seatIndex !== seat.seatIndex) {
      throw new Error("Not your turn");
    }
    // Always validate against live engine state (client legalActions can be stale).
    const legal = getLegalActions(this.state);
    const match = legal.find((l) => l.action === action);
    if (!match) {
      const opts = legal.map((l) => l.action).join(", ") || "none";
      throw new Error(`Illegal action: ${action}. Legal now: ${opts}`);
    }
    let amtUsd = amount;
    if (action === "call" || action === "check" || action === "fold") {
      amtUsd = match.minAmount != null ? chipsToUsd(match.minAmount) : undefined;
    }
    if ((action === "bet" || action === "raise" || action === "all_in") && amtUsd == null) {
      amtUsd = match.minAmount != null ? chipsToUsd(match.minAmount) : undefined;
    }
    if (match.minAmount != null && amtUsd != null && usdToChips(amtUsd) < match.minAmount) {
      amtUsd = chipsToUsd(match.minAmount);
    }
    if (match.maxAmount != null && amtUsd != null && usdToChips(amtUsd) > match.maxAmount) {
      amtUsd = chipsToUsd(match.maxAmount);
    }
    const resolve = this.pendingHuman.resolve;
    const timer = this.pendingHuman.timer;
    this.pendingHuman = null;
    clearTimeout(timer);
    resolve({ action, amount: amtUsd, reasonCode: "human" });
  }

  async actForCurrent() {
    const seatIndex = this.state.actingIndex!;
    const seat = this.state.seats.find((s) => s.seatIndex === seatIndex)!;
    const legal = getLegalActions(this.state);
    if (!legal.length) {
      this.state = { ...this.state, actingIndex: null };
      return;
    }

    let decided: { action: PokerAction; amount?: number; reasonCode: string };
    const useController = !HUMAN_PLAY || this.isBotSeat(seatIndex);

    this.actionDeadlineAt = Date.now() + TURN_MS;

    if (!useController && HUMAN_PLAY) {
      // Arm pendingHuman BEFORE broadcasting ACTION_CLOCK so clients can act as soon as
      // they see YOUR TURN (avoids "No action pending — wait for your clock").
      const humanWait = new Promise<{ action: PokerAction; amount?: number; reasonCode: string }>((resolve) => {
        if (this.pendingHuman) this.clearPendingHuman("replaced");
        const timer = setTimeout(async () => {
          if (this.pendingHuman?.seatIndex !== seatIndex) return;
          const pending = this.pendingHuman;
          this.pendingHuman = null;
          const timeoutDecision = await timeoutFallbackController.decide({
            state: this.state,
            seatIndex,
            profileKey: this.agentProfiles.get(seatIndex) ?? "machine",
            computeRemainingMs: 0,
            sessionId: this.onchainSessionId ?? undefined,
            handId: this.state.handId,
          });
          pending.resolve({
            action: timeoutDecision.action,
            amount: timeoutDecision.amount,
            reasonCode: timeoutDecision.reasonCode,
          });
        }, TURN_MS);
        this.pendingHuman = { seatIndex, legal, resolve, timer };
      });
      await this.persistEvent("ACTION_CLOCK", {
        seatIndex,
        deadlineAt: this.actionDeadlineAt,
        turnSeconds: TURN_SECONDS,
        humanPlay: HUMAN_PLAY,
      });
      decided = await humanWait;
    } else if (useController) {
      await this.persistEvent("ACTION_CLOCK", {
        seatIndex,
        deadlineAt: this.actionDeadlineAt,
        turnSeconds: TURN_SECONDS,
        humanPlay: HUMAN_PLAY,
      });
      // WP-126: owner sees ANALYSING while runtime decides.
      const profile = this.agentProfiles.get(seatIndex) ?? "machine";
      const street = String(this.state.street ?? "preflop");
      const opponents = this.state.seats.filter(
        (s) => s.playerId && !s.folded && s.seatIndex !== seatIndex,
      ).length;
      const toCallChips =
        this.state.currentBet > seat.bet ? this.state.currentBet - seat.bet : 0n;
      const toCall = chipsToUsd(toCallChips);
      // Deterministic grounding: equity is measured against the opponent's
      // modelled range, not against a random hand. Falls back to the
      // vs-random number only when no range model applies (multiway), and the
      // narration says so rather than passing it off as a range read.
      const facts = this.decisionFactsFor(seatIndex);
      const rangeEquity = facts.heroEquityVsRange;
      const estimatedEquity =
        rangeEquity != null
          ? rangeEquity.value * 100
          : seat.hole?.length === 2 && opponents > 0
            ? computeHeroEquity(seat.hole, this.state.board, opponents, { samples: 800 })
            : null;
      const equityBasis: "range" | "random" | null =
        rangeEquity != null ? "range" : estimatedEquity != null ? "random" : null;
      const handLabel =
        seat.hole?.length === 2 ? personalHandLabel(seat.hole, this.state.board) : null;
      const narrationOpts = {
        profileKey: profile,
        pot: chipsToUsd(this.state.pot),
        toCall,
        stack: chipsToUsd(seat.stack),
        equityPct: estimatedEquity,
        equityBasis,
        equityConfidence: rangeEquity?.confidence ?? null,
        rangeSummary: facts.villain?.rangeSummary ?? null,
        rangeKind: facts.villain?.rangeKind ?? null,
        predictedContinueSummary: facts.villain?.predictedContinueSummary ?? null,
        handLabel,
        opponents,
      };
      const analysingLines = buildPublicThinkingLines({
        ...narrationOpts,
        street,
        action: "think",
      }).slice(0, 2);
      this.sendOwnerAiCognition(seatIndex, {
        phase: "ANALYSING",
        signalSource: "cadence",
        publicCadenceMs: PUBLIC_CADENCE_FLOOR_MS || THINK_CADENCE_MIN_MS,
        modelId: "openai/gpt-oss-120b",
        publicNarrative: analysingLines[1] ?? analysingLines[0]!,
        publicThinkingLog: analysingLines,
      });
      const controller = this.seatControllerFor(seatIndex);
      const botDecision = await controller.decide({
        state: this.state,
        seatIndex,
        profileKey: profile,
        facts,
        computeRemainingMs: TURN_MS,
        sessionId:
          this.onchainSessionId ??
          this.sessions.get(seat.playerId ?? "") ??
          this.sessionIdForAi(),
        handId: this.state.handId,
      });
      decided = {
        action: botDecision.action,
        amount: botDecision.amount,
        reasonCode: botDecision.reasonCode,
      };
      const modelLabel = botDecision.modelId ?? "openai/gpt-oss-120b";
      const intentLabel =
        botDecision.amount != null && botDecision.amount > 0
          ? `${botDecision.action.toUpperCase()} ${botDecision.amount}`
          : botDecision.action.toUpperCase();
      const thinkMs = Math.max(
        PUBLIC_CADENCE_FLOOR_MS,
        computeThinkCadenceMs({
          action: botDecision.action,
          legal: legal.map((l) => ({
            action: l.action,
            minAmount: l.minAmount != null ? chipsToUsd(l.minAmount) : undefined,
            maxAmount: l.maxAmount != null ? chipsToUsd(l.maxAmount) : undefined,
          })),
          street,
          profileKey: profile,
          modelCadenceMs: botDecision.publicCadenceMs,
          turnMs: TURN_MS,
        }),
      );
      const thinkingLines = buildPublicThinkingLines({
        ...narrationOpts,
        street,
        action: botDecision.action,
        amount: botDecision.amount,
        fallbackUsed: botDecision.fallbackUsed,
        fallbackErrorClass: botDecision.fallbackErrorClass ?? null,
      });
      this.sendOwnerAiCognition(seatIndex, {
        phase: "DECISION_READY",
        energyRemaining: botDecision.energyRemaining ?? null,
        publicCadenceMs: thinkMs,
        signalSource:
          botDecision.energyRemaining != null ? "cognition" : "cadence",
        modelId: modelLabel,
        intentAction: botDecision.action,
        intentAmount: botDecision.amount ?? null,
        fallbackUsed: botDecision.fallbackUsed ?? false,
        publicNarrative: thinkingLines[2] ?? thinkingLines[1]!,
        publicThinkingLog: thinkingLines.slice(0, 3),
      });
      try {
        const obsHash = hashObservation({
          state: this.state,
          seatIndex,
          profileKey: profile,
          computeRemainingMs: TURN_MS,
          sessionId: this.onchainSessionId ?? undefined,
          handId: this.state.handId,
        });
        await query(
          `insert into agent_invocations
           (session_id, hand_id, sequence, model_id, observation_hash, response_hash, legal_action, fallback_used, latency_ms)
           values ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
          [
            this.onchainSessionId ?? this.sessions.get(seat.playerId ?? "") ?? "demo",
            this.state.handId,
            this.sequence + 1,
            botDecision.modelId ?? profile,
            obsHash,
            createHash("sha256").update(JSON.stringify(decided)).digest("hex"),
            botDecision.action,
            botDecision.fallbackUsed ?? false,
            botDecision.latencyMs ?? null,
          ],
        );
      } catch (err) {
        console.warn("agent_invocations insert failed", this.tableId, err);
      }
      // WP-107 / WP-075: wait remaining public cadence on the table clock.
      // Easy spots ~5s, hard spots ~13s (profile tempo + model cadence blend).
      const providerMs = Math.max(0, botDecision.providerLatencyMs ?? botDecision.latencyMs ?? 0);
      let cadenceWait =
        botDecision.cadenceSleptMs && botDecision.cadenceSleptMs > 0
          ? Math.max(0, thinkMs - botDecision.cadenceSleptMs - providerMs)
          : Math.max(0, thinkMs - providerMs);
      const remaining = Math.max(0, (this.actionDeadlineAt ?? Date.now()) - Date.now() - 250);
      cadenceWait = Math.min(cadenceWait, remaining, TURN_MS);

      // Stream owner-safe thinking lines across the wait window.
      const chunkMs = 1_600;
      let elapsed = 0;
      let lineIdx = 3;
      while (elapsed < cadenceWait) {
        const slice = Math.min(chunkMs, cadenceWait - elapsed);
        const phase =
          elapsed + slice >= cadenceWait || lineIdx >= thinkingLines.length - 1
            ? ("ACTING" as const)
            : ("DECISION_READY" as const);
        const logEnd = Math.min(thinkingLines.length, Math.max(3, lineIdx + 1));
        this.sendOwnerAiCognition(seatIndex, {
          phase,
          energyRemaining: botDecision.energyRemaining ?? null,
          publicCadenceMs: Math.max(0, cadenceWait - elapsed),
          signalSource:
            botDecision.publicCadenceMs == null && !botDecision.modelId ? "inferred" : "cadence",
          modelId: modelLabel,
          intentAction: botDecision.action,
          intentAmount: botDecision.amount ?? null,
          fallbackUsed: botDecision.fallbackUsed ?? false,
          publicNarrative:
            thinkingLines[Math.min(lineIdx, thinkingLines.length - 1)] ??
            `Committing ${intentLabel} on the public clock.`,
          publicThinkingLog: thinkingLines.slice(0, logEnd),
        });
        lineIdx += 1;
        await sleep(slice);
        elapsed += slice;
        if (this.state.actingIndex !== seatIndex || this.state.street === "waiting" || !this.state.handId) {
          return;
        }
      }
      if (cadenceWait <= 0) {
        this.sendOwnerAiCognition(seatIndex, {
          phase: "ACTING",
          energyRemaining: botDecision.energyRemaining ?? null,
          publicCadenceMs: thinkMs,
          signalSource: "cadence",
          modelId: modelLabel,
          intentAction: botDecision.action,
          intentAmount: botDecision.amount ?? null,
          fallbackUsed: botDecision.fallbackUsed ?? false,
          publicNarrative: thinkingLines[thinkingLines.length - 1]!,
          publicThinkingLog: thinkingLines,
        });
      }
    } else {
      await this.persistEvent("ACTION_CLOCK", {
        seatIndex,
        deadlineAt: this.actionDeadlineAt,
        turnSeconds: TURN_SECONDS,
        humanPlay: HUMAN_PLAY,
      });
      const fold = legal.find((l) => l.action === "fold");
      const check = legal.find((l) => l.action === "check");
      const fallback = fold ?? check ?? legal[0];
      decided = {
        action: fallback.action,
        amount: fallback.minAmount != null ? chipsToUsd(fallback.minAmount) : undefined,
        reasonCode: "auto",
      };
      await sleep(400);
    }

    // If the wait was cancelled because the hand reset, bail without applying.
    if (this.state.actingIndex !== seatIndex || this.state.street === "waiting" || !this.state.handId) {
      return;
    }

    if (!legal.some((l) => l.action === decided.action)) {
      const fold = legal.find((l) => l.action === "fold");
      const check = legal.find((l) => l.action === "check");
      const fallback = fold ?? check ?? legal[0];
      decided = {
        action: fallback.action,
        amount: fallback.minAmount != null ? chipsToUsd(fallback.minAmount) : undefined,
        reasonCode: "forced_legal",
      };
    }

    this.actionDeadlineAt = null;
    if (this.pendingHuman?.seatIndex === seatIndex) {
      clearTimeout(this.pendingHuman.timer);
      this.pendingHuman = null;
    }
    // WP-126: after public commit, owner AI returns to OBSERVING (keep last Energy).
    if (this.agentProfiles.has(seatIndex)) {
      this.sendOwnerAiCognition(seatIndex, {
        phase: "OBSERVING",
        signalSource: "cadence",
        publicNarrative: "Action complete. Tracking the next board card, pot size, and opponent response.",
      });
    }
    // Record the public line before the state advances — the range engine
    // needs the street the action was taken on, not the street after it.
    this.recordHandAction(
      seatIndex,
      decided.action,
      decided.amount != null ? chipsToNumber(usdToChips(decided.amount)) : undefined,
      this.state.street,
    );
    const { state, events } = applyAction(
      this.state,
      decided.action,
      decided.amount != null ? usdToChips(decided.amount) : undefined,
    );
    this.state = state;
    await this.refreshSessionEquityDisplay().catch((err) => {
      console.warn("refreshSessionEquityDisplay failed", this.tableId, err);
    });
    try {
      await query(
        `insert into agent_decisions (hand_id, agent_id, sequence, legal_actions, action, amount, reason_code, compute_used)
         values ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [
          this.state.handId,
          seat.agentId,
          this.sequence + 1,
          jsonStringify(legal),
          decided.action,
          decided.amount ?? null,
          decided.reasonCode,
          TURN_MS,
        ],
      );
    } catch (err) {
      console.error("agent_decisions insert failed", this.tableId, err);
    }
    for (const ev of events) await this.emitEngine(ev);
  }

  async emitEngine(ev: EngineEvent) {
    if (ev.type === "HOLE_CARDS_DEALT") {
      await this.persistEvent("HOLE_CARDS_DEALT", { seats: ev.private.map((p) => p.seatIndex) }, "system");
      for (const p of ev.private) {
        await this.persistEvent("HOLE_CARDS_PRIVATE", { seatIndex: p.seatIndex, cards: p.cards }, "owner_private");
      }
      return;
    }
    if (ev.type === "HAND_SETTLED") {
      await this.persistEvent(ev.type, ev as unknown as Record<string, unknown>);
      // Gross awards already equal contested pot (rake is deferred on winner tabs).
      const awardTotal = (ev.winners ?? []).reduce((sum, w) => sum + chipsToUsd(w.amount), 0);
      const potAtSettle = awardTotal;
      await query(
        `update hands set status='settled', board=$1::jsonb, pot=$2, street='settlement', seed_reveal=$3, settled_at=now() where id=$4`,
        [JSON.stringify(this.state.board), potAtSettle, ev.seedReveal, this.state.handId],
      );
      await this.persistCanonicalRootsAfterHand(ev.seedReveal, chipsToUsd(ev.rake)).catch((err) => {
        const msg = err instanceof Error ? err.message : String(err);
        console.warn("[wp-108] persistCanonicalRootsAfterHand failed", this.tableId, msg);
        if (requireRealRoots()) {
          throw err;
        }
      });
      return;
    }
    await this.persistEvent(ev.type, ev as unknown as Record<string, unknown>);
    if (ev.type === "STREET_DEALT") {
      this.privateEquityCache.clear();
      await query(`update hands set board=$1::jsonb, street=$2, pot=$3 where id=$4`, [
        JSON.stringify(this.state.board),
        ev.street,
        chipsToUsd(this.state.pot),
        this.state.handId,
      ]);
    }
  }

  /**
   * WP-108: write hand_roots (+ optional balance_leaves / checkpoint) from PokerEventV1 tip.
   * Production settlement path — no keccak(seed) stubs.
   */
  async persistCanonicalRootsAfterHand(seedReveal: string, handRake: number) {
    if (this.arenaMode !== "onchain" || !this.onchainSessionId || !this.state.handId) return;
    if (this.schemaKindPrefer !== "poker_event_v1") {
      if (requireRealRoots()) {
        throw new Error(
          "REQUIRE_REAL_ROOTS: CANONICAL_SCHEMA_KIND=poker_event_v1 required to emit real roots",
        );
      }
      return;
    }

    const tip = this.pokerV1PrevHash ?? this.canonicalPrevHash;
    if (!tip || tip === GENESIS_EVENT_HASH) {
      if (requireRealRoots()) {
        throw new Error("REQUIRE_REAL_ROOTS: missing PokerEventV1 tip after hand settle");
      }
      return;
    }

    const opening =
      this.handOpeningStateHash ?? hashEngineState(this.state);
    const ending = hashEngineState(this.state);
    const deckRoot = deckRootFromSeedReveal(seedReveal);
    const hand = buildHandRootForSettledHand({
      sessionId: this.onchainSessionId,
      handNumber: this.state.handNumber,
      eventChainTip: tip,
      deckRoot,
      openingStateHash: opening,
      endingStateHash: ending,
      handRake: BigInt(Math.max(0, Math.trunc(handRake))),
    });

    await persistHandRoot({
      sessionId: this.onchainSessionId,
      handId: this.state.handId,
      handNumber: this.state.handNumber,
      handRoot: hand.handRoot,
      eventChainTip: tip,
      deckRoot,
    });

    const seats = await this.loadSeatBalanceSnapshots();
    if (seats.length === 0) return;

    const roots = buildSettlementRootsFromTip({
      sessionId: this.onchainSessionId,
      finalEventRoot: tip,
      finalSequence: BigInt(Math.max(0, this.pokerV1Sequence - 1)),
      handNumber: this.state.handNumber,
      deckRoot,
      openingStateHash: opening,
      endingStateHash: ending,
      handRake: BigInt(Math.max(0, Math.trunc(handRake))),
      seats,
    });

    this.lastSettlementRoots = roots;
    this.lastSettlementAt = new Date().toISOString();

    await persistBalanceLeaves({
      sessionId: this.onchainSessionId,
      sequence: roots.finalSequence,
      seats,
      leafHashes: roots.balance.leaves.map((l) => l.leafHash),
    });
    await persistSessionCheckpoint({
      sessionId: this.onchainSessionId,
      sequence: roots.finalSequence,
      handNumber: this.state.handNumber,
      eventRoot: roots.finalEventRoot,
      balanceRoot: roots.balanceRoot,
    });
  }

  /**
   * WP-106 golden API — expose last real settlement roots (no keccak stubs).
   * Prefer in-memory tip after HAND_SETTLED; optionally rebuild from live tip + seats.
   */
  async getSettlementRootsForGolden(): Promise<{
    ok: true;
    source: "cached" | "rebuild";
    sessionId: string;
    finalEventRoot: Hex;
    handRoot: Hex;
    balanceRoot: Hex;
    finalSequence: string;
    handNumber: number;
    players: { wallet: Address; seat: number; startLocked: string; endBalance: string }[];
    totalRake: string;
    openingTotal: string;
    endingPlayerTotal: string;
  } | { ok: false; error: string }> {
    if (this.arenaMode !== "onchain" || !this.onchainSessionId) {
      return { ok: false, error: "table_not_onchain" };
    }
    if (this.schemaKindPrefer !== "poker_event_v1") {
      return {
        ok: false,
        error: "CANONICAL_SCHEMA_KIND=poker_event_v1 required (or MOZETTO_GOLDEN/REQUIRE_REAL_ROOTS)",
      };
    }

    let roots = this.lastSettlementRoots;
    let source: "cached" | "rebuild" = "cached";

    const buyIns = await query<{ wallet_address: string; seat: number | null; buy_in_raw: string }>(
      `select wallet_address, seat::int as seat, buy_in_raw::text as buy_in_raw
       from onchain_session_players where session_id = $1 order by seat nulls last`,
      [this.onchainSessionId],
    ).catch(() => ({ rows: [] as { wallet_address: string; seat: number | null; buy_in_raw: string }[] }));

    if (!roots) {
      const tip = this.pokerV1PrevHash ?? this.canonicalPrevHash;
      if (!tip || tip === GENESIS_EVENT_HASH) {
        return { ok: false, error: "missing_event_tip_play_at_least_one_hand" };
      }
      const seats = await this.loadSeatBalanceSnapshots();
      if (seats.length < 2) {
        return { ok: false, error: "insufficient_seat_balances" };
      }
      const opening = this.handOpeningStateHash ?? hashEngineState(this.state);
      const ending = hashEngineState(this.state);
      const deckRoot = deckRootFromSeedReveal(`rebuild:${this.tableId}:${this.state.handNumber}`);
      roots = buildSettlementRootsFromTip({
        sessionId: this.onchainSessionId,
        finalEventRoot: tip,
        finalSequence: BigInt(Math.max(0, this.pokerV1Sequence - 1)),
        handNumber: Math.max(1, this.state.handNumber),
        deckRoot,
        openingStateHash: opening,
        endingStateHash: ending,
        handRake: 0n,
        seats,
      });
      source = "rebuild";
    }

    // Hub settle: startLocked = session buy-in; endBalance = current table stack (raw USDC).
    const players: { wallet: Address; seat: number; startLocked: string; endBalance: string }[] = [];
    for (const row of buyIns.rows) {
      const seatIdx =
        row.seat != null
          ? Number(row.seat)
          : this.state.seats.findIndex((s) => s.playerId);
      const seatState = this.state.seats.find((s) => s.seatIndex === seatIdx);
      const startLocked = BigInt(row.buy_in_raw);
      const endChips =
        seatState?.stack != null ? chipsToUsd(seatState.stack) : Number(row.buy_in_raw) / 1e6;
      const endBalance = BigInt(Math.round(endChips * 1e6));
      players.push({
        wallet: row.wallet_address as Address,
        seat: seatIdx,
        startLocked: startLocked.toString(),
        endBalance: endBalance.toString(),
      });
    }
    if (players.length < 2) {
      return { ok: false, error: "insufficient_onchain_players" };
    }

    const openingTotal = players.reduce((a, p) => a + BigInt(p.startLocked), 0n);
    const endingPlayerTotal = players.reduce((a, p) => a + BigInt(p.endBalance), 0n);
    if (endingPlayerTotal > openingTotal) {
      return {
        ok: false,
        error: `conservation_broken ending=${endingPlayerTotal} > opening=${openingTotal}`,
      };
    }
    const totalRake = openingTotal - endingPlayerTotal;

    return {
      ok: true,
      source,
      sessionId: this.onchainSessionId,
      finalEventRoot: roots.finalEventRoot,
      handRoot: roots.handRoot,
      balanceRoot: roots.balanceRoot,
      finalSequence: roots.finalSequence.toString(),
      handNumber: Math.max(1, this.state.handNumber),
      players,
      totalRake: totalRake.toString(),
      openingTotal: openingTotal.toString(),
      endingPlayerTotal: endingPlayerTotal.toString(),
    };
  }

  async loadSeatBalanceSnapshots(): Promise<SeatBalanceSnapshot[]> {
    if (!this.onchainSessionId) return [];
    const rows = await query<{
      wallet_address: string;
      seat: number | null;
      buy_in_raw: string;
      owner_id: string;
    }>(
      `select osp.wallet_address, osp.buy_in_raw::text as buy_in_raw,
              ts.seat::int as seat,
              coalesce(osp.profile_id::text, '') as owner_id
       from onchain_session_players osp
       left join lateral (
         select seat from table_sessions
         where table_id = $2 and owner_id = osp.profile_id
         order by case when status = 'active' then 0 else 1 end,
                  coalesce(ended_at, started_at) desc nulls last
         limit 1
       ) ts on true
       where osp.session_id = $1`,
      [this.onchainSessionId, this.tableId],
    ).catch(() => ({ rows: [] as { wallet_address: string; seat: number | null; buy_in_raw: string; owner_id: string }[] }));

    const out: SeatBalanceSnapshot[] = [];
    for (let i = 0; i < rows.rows.length; i++) {
      const row = rows.rows[i]!;
      const seatIdx =
        row.seat != null
          ? Number(row.seat)
          : this.state.seats.find((s) => s.playerId === row.owner_id)?.seatIndex ?? i;
      const seatState = this.state.seats.find((s) => s.seatIndex === seatIdx);
      const openingUsd =
        this.handOpeningStacks.get(seatIdx) ??
        Number(row.buy_in_raw) / 1e6;
      const currentUsd =
        seatState != null ? chipsToUsd(seatState.stack) : openingUsd;
      // Net-on-award: session rake is tracked on the table, not per-seat tabs.
      const seatRakeUsd =
        this.state.sessionRake > 0n
          ? chipsToUsd(this.state.sessionRake) / Math.max(1, this.state.seats.filter((s) => s.playerId).length)
          : 0;
      out.push({
        wallet: row.wallet_address as Address,
        seat: seatIdx,
        openingBalance: BigInt(Math.round(openingUsd * 1e6)),
        currentBalance: BigInt(Math.round(currentUsd * 1e6)),
        cumulativeRake: BigInt(Math.round(seatRakeUsd * 1e6)),
      });
    }
    // Seat-order for leaf hash alignment with buildBalanceRoot.
    out.sort((a, b) => a.seat - b.seat);
    return out;
  }

  /**
   * Mid-hand display sync: `table_sessions.stack` = seat equity (stack + street bet)
   * so wallet "At Tables" / LOCKED matches chips still belonging to the player,
   * including money already in the pot. Does NOT touch escrow (buy-in stays locked
   * until settle / leave).
   */
  async refreshSessionEquityDisplay() {
    for (const s of this.state.seats) {
      if (!s.playerId) continue;
      const sessionId = this.sessions.get(s.playerId);
      if (!sessionId) continue;
      const equityUsd = chipsToUsd(s.stack + s.bet);
      await query(`update table_sessions set stack=$1 where id=$2`, [equityUsd, sessionId]);
    }
  }

  async syncStacks() {
    const handId = this.state.handId ?? `sync_${this.tableId}_${Date.now()}`;
    const changes: { userId: string; prevStack: number; nextStack: number }[] = [];
    for (const s of this.state.seats) {
      if (!s.playerId) continue;
      const nextUsd = chipsToUsd(s.stack);
      const prev = this.stackBaseline.get(s.playerId) ?? nextUsd;
      changes.push({ userId: s.playerId, prevStack: prev, nextStack: nextUsd });
      this.stackBaseline.set(s.playerId, nextUsd);
      await query(`update table_seats set stack=$1, updated_at=now() where table_id=$2 and seat_index=$3`, [
        nextUsd,
        this.tableId,
        s.seatIndex,
      ]);
      const sessionId = this.sessions.get(s.playerId);
      if (sessionId) {
        await query(`update table_sessions set stack=$1 where id=$2`, [nextUsd, sessionId]);
      }
    }
    try {
      await rebalanceEscrowToStacks(handId, changes, this.arenaMode);
    } catch (e) {
      console.error("escrow rebalance failed", handId, e);
    }
  }

  eventsFrom(after: number) {
    return query(
      `select sequence, event_type as "eventType", timestamp, payload, event_hash as "eventHash",
              prev_event_hash as "prevEventHash", hand_id as "handId", table_id as "tableId", visibility
       from hand_events where table_id=$1 and sequence > $2 and visibility='public' order by sequence`,
      [this.tableId, after],
    );
  }
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}
