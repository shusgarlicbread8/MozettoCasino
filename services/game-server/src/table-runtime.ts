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
  startHand,
  type EngineEvent,
  type EquityRow,
  type HoldemState,
  buildCanonicalEvent,
  hashEvent,
  GENESIS_EVENT_HASH,
} from "@mozetto/game-rules";
import { fetchHandSeed, fallbackHandSeed } from "@mozetto/dealer/client";
import type { Card } from "@mozetto/shared-types";
import {
  query,
  lockBuyIn,
  releaseSession,
  rebalanceEscrowToStacks,
  settleRatedMatch,
  getOnchainSessionForTable,
} from "@mozetto/database";
import type { PokerAction, TableEvent } from "@mozetto/shared-types";
import {
  hashObservation,
  resolveSeatController,
  timeoutFallbackController,
  type SeatController,
} from "./controllers.js";

type Hex = `0x${string}`;

/** Action clock for human play (seconds). */
export const TURN_SECONDS = 15;
const TURN_MS = TURN_SECONDS * 1000;

/** Temporary: humans play; bots/agents do not auto-act. */
const HUMAN_PLAY = process.env.HUMAN_PLAY !== "0";
const DEALER_URL = process.env.DEALER_URL ?? "http://localhost:4003";

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
  state: HoldemState;
  sequence = 0;
  prevHash: string | null = null;
  clients = new Set<Client>();
  running = false;
  loopTimer: NodeJS.Timeout | null = null;
  agentProfiles = new Map<number, string>();
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
  /** On-chain session id for canonical events + dealer seeds (when arenaMode=onchain). */
  onchainSessionId: string | null = null;
  canonicalPrevHash: Hex = GENESIS_EVENT_HASH;
  canonicalSequence = 0;
  seatControllers = new Map<number, SeatController>();

  constructor(
    tableId: string,
    config: { smallBlind: number; bigBlind: number; rakePct: number; rakeCap: number | null; maxSeats?: number },
  ) {
    this.tableId = tableId;
    this.state = createTable(
      {
        tableId,
        smallBlind: config.smallBlind,
        bigBlind: config.bigBlind,
        rakePct: Number(config.rakePct),
        rakeCap: config.rakeCap,
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
    const rt = new TableRuntime(tableId, {
      smallBlind: Number(row.small_blind),
      bigBlind: Number(row.big_blind),
      rakePct: Number(row.rake_pct),
      rakeCap: row.rake_cap != null ? Number(row.rake_cap) : null,
      maxSeats: Number(row.max_seats) || 6,
    });
    rt.arenaMode = row.arena_mode === "onchain" ? "onchain" : "demo";
    if (rt.arenaMode === "onchain") {
      await rt.loadOnchainSession();
    }
    // Resume event chain after restarts — avoids duplicate (table_id, sequence) inserts.
    const seq = await query(`select coalesce(max(sequence), 0)::int as m from hand_events where table_id = $1`, [tableId]);
    rt.sequence = Number(seq.rows[0]?.m ?? 0);
    const lastHash = await query(
      `select event_hash from hand_events where table_id = $1 order by sequence desc limit 1`,
      [tableId],
    );
    rt.prevHash = lastHash.rows[0]?.event_hash ?? null;

    const seats = await query(`select * from table_seats where table_id = $1 order by seat_index`, [tableId]);
    for (const s of seats.rows) {
      if (s.status === "occupied" && s.agent_id && s.owner_id) {
        rt.state = seatPlayer(rt.state, s.seat_index, s.owner_id, s.agent_id, Number(s.stack));
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
    return rt;
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

  isBotSeat(seatIndex: number): boolean {
    if (!HUMAN_PLAY) return true;
    const seat = this.state.seats.find((s) => s.seatIndex === seatIndex);
    if (!seat?.playerId) return false;
    return !this.clients.some((c) => c.userId === seat.playerId && c.role === "player");
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
  ) {
    if (this.arenaMode !== "onchain" || !this.onchainSessionId) return;
    this.canonicalSequence += 1;
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
      await query(
        `insert into canonical_game_events
         (session_id, hand_id, sequence, event_hash, previous_event_hash, event_type, public_payload, private_payload_commitment, timestamp_ms)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [
          this.onchainSessionId,
          this.state.handId,
          this.canonicalSequence,
          eventHash,
          canonical.previousEventHash,
          eventType,
          JSON.stringify(publicPayload),
          privatePayloadCommitment ?? null,
          canonical.timestampMs,
        ],
      );
    } catch (err) {
      console.warn("canonical_game_events insert failed", this.tableId, err);
    }
  }

  subscribe(client: Client) {
    this.clients.add(client);
    client.send({
      type: "snapshot",
      sequence: this.sequence,
      state: this.viewFor(client),
    });
  }

  unsubscribe(client: Client) {
    this.clients.delete(client);
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

  viewFor(client: Client) {
    const base =
      client.role === "player" && client.seatIndex != null
        ? privateView(this.state, client.seatIndex)
        : publicView(this.state);
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
      c.send({ type: "event", event });
      if (c.seatIndex != null && privatePayloads?.has(c.seatIndex)) {
        c.send({ type: "private_state", payload: privatePayloads.get(c.seatIndex) });
      }
      c.send({ type: "snapshot", sequence: this.sequence, state: this.viewFor(c) });
    }
  }

  async persistEvent(eventType: string, payload: Record<string, unknown>, visibility: "public" | "owner_private" | "system" = "public") {
    this.sequence += 1;
    const body = {
      tableId: this.tableId,
      handId: this.state.handId,
      sequence: this.sequence,
      eventType,
      timestamp: new Date().toISOString(),
      payload,
      prevEventHash: this.prevHash,
    };
    const eventHash = createHash("sha256").update(JSON.stringify(body)).digest("hex");
    this.prevHash = eventHash;
    const full: TableEvent = { ...body, eventHash, visibility };
    await query(
      `insert into hand_events (table_id, hand_id, sequence, event_type, timestamp, payload, visibility, prev_event_hash, event_hash)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [
        this.tableId,
        this.state.handId,
        this.sequence,
        eventType,
        body.timestamp,
        JSON.stringify(payload),
        visibility,
        body.prevEventHash,
        eventHash,
      ],
    );
    if (this.arenaMode === "onchain" && visibility !== "owner_private") {
      await this.persistCanonicalEvent(eventType, payload);
    }
    this.broadcast(full);
    return full;
  }

  async join(opts: {
    userId: string;
    agentId: string;
    agentConfigId: string;
    buyIn: number;
    seatIndex?: number;
    profileKey: string;
    stopLoss?: number;
    profitTarget?: number;
    autoRebuy?: boolean;
  }) {
    // Enforce table buy-in window (ranked arena uses fixed equal stacks).
    const limits = await query(`select min_buy_in, max_buy_in, arena_mode from tables where id=$1`, [this.tableId]);
    const minBuy = Number(limits.rows[0]?.min_buy_in ?? 0);
    const maxBuy = Number(limits.rows[0]?.max_buy_in ?? Number.POSITIVE_INFINITY);
    this.arenaMode = limits.rows[0]?.arena_mode === "onchain" ? "onchain" : "demo";
    if (opts.buyIn < minBuy || opts.buyIn > maxBuy) {
      throw new Error(`Buy-in must be $${minBuy}–$${maxBuy}`);
    }

    if (this.arenaMode === "onchain") {
      const onchain = await getOnchainSessionForTable(this.tableId);
      if (!onchain || onchain.status !== "opened") {
        throw new Error(
          onchain?.status === "pending"
            ? "Session opening on-chain — wait for confirmation before joining"
            : "On-chain session not opened for this table",
        );
      }
      this.onchainSessionId = onchain.session_id;
    }

    const already = this.state.seats.find((s) => s.playerId === opts.userId && !s.sitOut);
    if (already) {
      // Idempotent: prior join may have seated the player but failed before the client navigated.
      return {
        seatIndex: already.seatIndex,
        sessionId: this.sessions.get(opts.userId) ?? null,
        seated: this.state.seats.filter((s) => s.playerId && !s.sitOut).length,
        alreadySeated: true,
      };
    }
    // Still seated but sat out / busted — resume via top-up, don't create a second seat.
    const selfSitOut = this.state.seats.find((s) => s.playerId === opts.userId);
    if (selfSitOut) {
      throw new Error("Already seated — use top-up to add chips");
    }
    // Only truly empty seats. Never steal another player's sit-out / busted seat.
    const empty = this.state.seats.find(
      (s) => (opts.seatIndex == null || s.seatIndex === opts.seatIndex) && !s.playerId,
    );
    if (!empty) throw new Error("No open seat");
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
    this.state = seatPlayer(this.state, empty.seatIndex, opts.userId, opts.agentId, opts.buyIn);
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
    this.ensureLoop();
    this.broadcastSnapshots();
    return {
      seatIndex: empty.seatIndex,
      sessionId,
      seated: this.state.seats.filter((s) => s.playerId && !s.sitOut).length,
      alreadySeated: false,
    };
  }

  /** Push a fresh private/public snapshot to every connected client. */
  broadcastSnapshots() {
    for (const c of this.clients) {
      c.send({ type: "snapshot", sequence: this.sequence, state: this.viewFor(c) });
    }
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
    return true;
  }

  async leave(userId: string) {
    const seat = this.state.seats.find((s) => s.playerId === userId);
    if (!seat || !seat.playerId) {
      // Still close any orphaned DB session so the lobby doesn't think we're seated.
      await this.completeSessionsForUser(userId, 0);
      return;
    }

    const seatIndex = seat.seatIndex;
    const agentId = seat.agentId;
    const stack = Math.max(0, Number(seat.stack) || 0);
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

    // Mid-hand leave = fold + forfeit pot contribution; remaining player scoops.
    if (midHand && !seat.folded) {
      this.state = foldSeat(this.state, seatIndex);
      if (wasActing) this.clearPendingHuman();
      const awarded = await this.settleIfOnePlayerLeft("opponent_left");
      if (!awarded && wasActing) {
        // Hand continues — advance action off the empty actor.
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
    for (const c of this.clients) {
      if (c.userId === userId) c.seatIndex = undefined;
    }

    try {
      await this.persistEvent("PLAYER_LEFT", { seatIndex, userId, stack, midHand });
    } catch (err) {
      console.error("PLAYER_LEFT event failed", this.tableId, err);
    }

    const remaining = this.state.seats.filter((s) => s.playerId && !s.sitOut && s.stack > 0);
    if (remaining.length < 2 && this.state.street !== "waiting" && this.state.street !== "settlement") {
      await this.settleIfOnePlayerLeft("table_abandoned");
      this.resetToWaiting();
    }
    // Always push a fresh snapshot so every client flips the seat to SEAT OPEN.
    this.broadcastSnapshots();
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
      poolId: "hu_holdem_standard",
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

  ensureLoop() {
    if (this.running) return;
    this.running = true;
    void this.loop();
  }

  resetToWaiting() {
    this.clearPendingHuman();
    this.actionDeadlineAt = null;
    this.equity = null;
    this.runoutRevealed = {};
    this.runoutRevealPublished = false;
    this.privateEquityCache.clear();
    this.state = {
      ...this.state,
      street: "waiting",
      handId: null,
      actingIndex: null,
      board: [],
      pot: 0,
      currentBet: 0,
      winners: [],
      deck: [],
      seats: this.state.seats.map((s) => ({
        ...s,
        bet: 0,
        totalBet: 0,
        hole: undefined,
        folded: s.sitOut || !s.playerId || s.stack <= 0,
        allIn: false,
      })),
    };
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
        const seated = this.state.seats.filter((s) => !s.sitOut && s.playerId && s.stack > 0);
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
              s.playerId && s.stack <= 0 ? { ...s, sitOut: true, folded: true, hole: undefined } : s,
            ),
          };
          for (const s of this.state.seats) {
            if (s.playerId && s.stack <= 0) {
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
          const broke = this.state.seats.filter((s) => s.playerId && s.stack <= 0).map((s) => s.playerId);
          for (const uid of broke) {
            await this.leave(uid);
          }
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
        this.resetToWaiting();
        await sleep(1500);
      }
    }
  }

  async beginHand() {
    const seated = this.state.seats.filter((s) => !s.sitOut && s.playerId && s.stack > 0);
    if (seated.length < 2) return;

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
    const { state, events } = startHand(this.state, seed, handId);

    // Persist hand row BEFORE exposing handId to event writers.
    await query(
      `insert into hands (id, table_id, hand_number, status, button_seat, board, pot, street, seed_commit)
       values ($1,$2,$3,'running',$4,'[]'::jsonb,0,'preflop',$5)`,
      [handId, this.tableId, state.handNumber, state.button, state.seedCommit],
    );
    this.state = state;
    for (const ev of events) await this.emitEngine(ev);
  }

  /** Add chips to a seated (possibly busted) player mid-session. */
  async topUp(userId: string, amount: number) {
    if (!(amount > 0)) throw new Error("Invalid top-up");
    const seat = this.state.seats.find((s) => s.playerId === userId);
    if (!seat) throw new Error("Not seated");
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
    const nextStack = seat.stack + amount;
    this.state = {
      ...this.state,
      seats: this.state.seats.map((s) =>
        s.seatIndex === seat.seatIndex
          ? { ...s, stack: nextStack, sitOut: false, folded: this.state.street !== "waiting" ? s.folded : false }
          : s,
      ),
    };
    this.stackBaseline.set(userId, (this.stackBaseline.get(userId) ?? 0) + amount);
    await query(`update table_seats set stack=$1, updated_at=now() where table_id=$2 and seat_index=$3`, [
      nextStack,
      this.tableId,
      seat.seatIndex,
    ]);
    await query(`update table_sessions set stack=$1, buy_in = buy_in + $2 where id=$3`, [nextStack, amount, sessionId]);
    await this.persistEvent("PLAYER_TOP_UP", { seatIndex: seat.seatIndex, userId, amount, stack: nextStack });
    this.ensureLoop();
    return { stack: nextStack };
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
      amount: fallback?.minAmount,
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
    let amt = amount;
    if (action === "call" || action === "check" || action === "fold") amt = match.minAmount;
    if ((action === "bet" || action === "raise" || action === "all_in") && amt == null) amt = match.minAmount;
    if (match.minAmount != null && amt != null && amt < match.minAmount) amt = match.minAmount;
    if (match.maxAmount != null && amt != null && amt > match.maxAmount) amt = match.maxAmount;
    const resolve = this.pendingHuman.resolve;
    const timer = this.pendingHuman.timer;
    this.pendingHuman = null;
    clearTimeout(timer);
    resolve({ action, amount: amt, reasonCode: "human" });
  }

  async actForCurrent() {
    const seatIndex = this.state.actingIndex!;
    const seat = this.state.seats.find((s) => s.seatIndex === seatIndex)!;
    const legal = getLegalActions(this.state);
    if (!legal.length) {
      this.state = { ...this.state, actingIndex: null };
      return;
    }

    this.actionDeadlineAt = Date.now() + TURN_MS;
    await this.persistEvent("ACTION_CLOCK", {
      seatIndex,
      deadlineAt: this.actionDeadlineAt,
      turnSeconds: TURN_SECONDS,
      humanPlay: HUMAN_PLAY,
    });

    let decided: { action: PokerAction; amount?: number; reasonCode: string };
    const useController = !HUMAN_PLAY || this.isBotSeat(seatIndex);

    if (useController) {
      const profile = this.agentProfiles.get(seatIndex) ?? "machine";
      const controller = this.seatControllerFor(seatIndex);
      const botDecision = await controller.decide({
        state: this.state,
        seatIndex,
        profileKey: profile,
        computeRemainingMs: TURN_MS,
        sessionId: this.onchainSessionId ?? this.sessions.get(seat.playerId ?? "") ?? undefined,
        handId: this.state.handId,
      });
      decided = {
        action: botDecision.action,
        amount: botDecision.amount,
        reasonCode: botDecision.reasonCode,
      };
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
      await sleep(Math.min(400, TURN_MS / 4));
    } else if (HUMAN_PLAY) {
      decided = await new Promise((resolve) => {
        // Replace any stranded waiter from a previous turn.
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
    } else {
      const fold = legal.find((l) => l.action === "fold");
      const check = legal.find((l) => l.action === "check");
      const fallback = fold ?? check ?? legal[0];
      decided = { action: fallback.action, amount: fallback.minAmount, reasonCode: "auto" };
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
      decided = { action: fallback.action, amount: fallback.minAmount, reasonCode: "forced_legal" };
    }

    this.actionDeadlineAt = null;
    if (this.pendingHuman?.seatIndex === seatIndex) {
      clearTimeout(this.pendingHuman.timer);
      this.pendingHuman = null;
    }
    const { state, events } = applyAction(this.state, decided.action, decided.amount);
    this.state = state;
    try {
      await query(
        `insert into agent_decisions (hand_id, agent_id, sequence, legal_actions, action, amount, reason_code, compute_used)
         values ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [
          this.state.handId,
          seat.agentId,
          this.sequence + 1,
          JSON.stringify(legal),
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
      await query(
        `update hands set status='settled', board=$1::jsonb, pot=$2, street='settlement', seed_reveal=$3, settled_at=now() where id=$4`,
        [JSON.stringify(this.state.board), this.state.pot, ev.seedReveal, this.state.handId],
      );
      return;
    }
    await this.persistEvent(ev.type, ev as unknown as Record<string, unknown>);
    if (ev.type === "STREET_DEALT") {
      this.privateEquityCache.clear();
      await query(`update hands set board=$1::jsonb, street=$2, pot=$3 where id=$4`, [
        JSON.stringify(this.state.board),
        ev.street,
        this.state.pot,
        this.state.handId,
      ]);
    }
  }

  async syncStacks() {
    const handId = this.state.handId ?? `sync_${this.tableId}_${Date.now()}`;
    const changes: { userId: string; prevStack: number; nextStack: number }[] = [];
    for (const s of this.state.seats) {
      if (!s.playerId) continue;
      const prev = this.stackBaseline.get(s.playerId) ?? s.stack;
      changes.push({ userId: s.playerId, prevStack: prev, nextStack: s.stack });
      this.stackBaseline.set(s.playerId, s.stack);
      await query(`update table_seats set stack=$1, updated_at=now() where table_id=$2 and seat_index=$3`, [
        s.stack,
        this.tableId,
        s.seatIndex,
      ]);
      const sessionId = this.sessions.get(s.playerId);
      if (sessionId) {
        await query(`update table_sessions set stack=$1 where id=$2`, [s.stack, sessionId]);
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
