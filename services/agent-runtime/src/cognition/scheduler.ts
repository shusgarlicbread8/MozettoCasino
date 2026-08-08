/**
 * Continuous cognition scheduler (WP-073).
 *
 * Event-driven background updates + priority queue.
 * Debits Energy only after successful execution; cancelled/preempted = no debit.
 * Never stores raw chain-of-thought in AgentState.
 */

import { keccak256, toBytes, type Hex } from "viem";
import {
  EnergyOperationType,
  canAfford,
  debitEnergy,
  grantHandEnergy,
  spendableBackground,
  combinedFinalDebit,
  type EnergyLedger,
  type EnergyLedgerStore,
} from "../energy/index.js";
import type {
  BackgroundCognitionKind,
  DecisionRequest,
  PokerModelProvider,
} from "../provider/types.js";
import {
  applyPublicEventDeterministic,
  createEmptyAgentState,
  setEnergyRemaining,
} from "../state/create.js";
import type { AgentStateStore, AgentStateV1, PublicTableEvent } from "../state/types.js";
import { applyBackgroundPatch, deterministicStructuredPatch } from "./apply.js";
import { selectSchedulerMode } from "./policy.js";
import { CognitionPriorityQueue } from "./queue.js";
import type {
  CognitionDrainStats,
  CognitionEventResult,
  CognitionJob,
  ContinuousCognitionSchedulerOptions,
  FinalActionResult,
  PreemptResult,
  SchedulerContext,
  SchedulerMode,
} from "./types.js";
import { MODEL_BACKGROUND_MODES } from "./types.js";

function asHex32(label: string): Hex {
  return keccak256(toBytes(label));
}

function observationHashFor(event: PublicTableEvent, mode: SchedulerMode): Hex {
  return asHex32(`obs:${event.cursor}:${event.kind}:${mode}:${event.eventId ?? ""}`);
}

function resultHashFor(applied: boolean, note: string): Hex {
  return asHex32(`result:${applied ? 1 : 0}:${note.slice(0, 64)}`);
}

function mapModeToBackgroundKind(mode: SchedulerMode): BackgroundCognitionKind {
  switch (mode) {
    case "LIGHT_UPDATE":
      return "light_update";
    case "OPPONENT_UPDATE":
      return "opponent_update";
    case "STREET_PLAN":
      return "street_plan";
    case "DEEP_REEVALUATION":
      return "deep_reevaluation";
    default:
      return "stub";
  }
}

export class ContinuousCognitionScheduler {
  readonly sessionId: string;
  readonly handId: string;
  readonly seat: number;

  private readonly provider: PokerModelProvider;
  private readonly store: AgentStateStore;
  private readonly energyStore: EnergyLedgerStore | null;
  private readonly profileHash: string;
  private readonly axes: ContinuousCognitionSchedulerOptions["axes"];
  private readonly profile: ContinuousCognitionSchedulerOptions["profile"];
  private readonly profileKey: ContinuousCognitionSchedulerOptions["profileKey"];
  private readonly now: () => number;
  private readonly createJobId: () => string;
  private readonly autoDrain: boolean;
  private readonly buildObservation: ContinuousCognitionSchedulerOptions["buildObservation"];

  private ledger: EnergyLedger;
  private state: AgentStateV1;
  private readonly queue = new CognitionPriorityQueue();
  private inFlight: CognitionJob | null = null;
  private draining = false;
  private seatActive = true;
  private proximityToOwnTurn = false;
  private providerCongested = false;
  private uncertainty = 40;
  private jobSeq = 0;

  constructor(opts: ContinuousCognitionSchedulerOptions) {
    this.provider = opts.provider;
    this.store = opts.store;
    this.energyStore = opts.energyStore ?? null;
    this.sessionId = opts.sessionId;
    this.handId = opts.handId;
    this.seat = opts.seat;
    this.profileHash = opts.profileHash;
    this.axes = opts.axes;
    this.profile = opts.profile;
    this.profileKey = opts.profileKey;
    this.now = opts.now ?? (() => Date.now());
    this.createJobId =
      opts.createJobId ??
      (() => {
        this.jobSeq += 1;
        return `cog-${this.jobSeq}`;
      });
    this.autoDrain = opts.autoDrain ?? true;
    this.buildObservation = opts.buildObservation;

    const sessionHex = asHex32(`session:${opts.sessionId}`);
    const handHex = asHex32(`hand:${opts.handId}`);
    this.ledger =
      opts.ledger ??
      grantHandEnergy({
        sessionId: sessionHex,
        handId: handHex,
        seat: opts.seat,
      });

    this.state =
      opts.initialState ??
      createEmptyAgentState({
        sessionId: opts.sessionId,
        handId: opts.handId,
        seat: opts.seat,
        profileHash: opts.profileHash,
        energyRemaining: this.ledger.remainingEnergy,
      });
  }

  /** Persist AgentState + optional Energy ledger (WP-110 scheduler hooks). */
  private async persistStores(): Promise<void> {
    await this.store.put(this.state);
    if (this.energyStore) {
      await this.energyStore.put(this.ledger);
    }
  }

  getLedger(): EnergyLedger {
    return this.ledger;
  }

  getState(): AgentStateV1 {
    return this.state;
  }

  getQueueSize(): number {
    return this.queue.size + (this.inFlight ? 1 : 0);
  }

  setSeatActive(active: boolean): void {
    this.seatActive = active;
    this.ledger = { ...this.ledger, seatActive: active };
  }

  setProximityToOwnTurn(near: boolean): void {
    this.proximityToOwnTurn = near;
  }

  setProviderCongested(congested: boolean): void {
    this.providerCongested = congested;
  }

  setUncertainty(value: number): void {
    this.uncertainty = Math.min(100, Math.max(0, Math.round(value)));
  }

  private ctx(): SchedulerContext {
    return {
      sessionId: this.sessionId,
      handId: this.handId,
      seat: this.seat,
      profileHash: this.profileHash,
      profile: this.profile,
      profileKey: this.profileKey,
      axes: this.axes,
      seatActive: this.seatActive,
      proximityToOwnTurn: this.proximityToOwnTurn,
      providerCongested: this.providerCongested,
      energyRemaining: this.ledger.remainingEnergy,
      uncertainty: this.uncertainty,
    };
  }

  /**
   * Ingest a public table event: deterministic apply + optional background job.
   */
  async onPublicEvent(event: PublicTableEvent): Promise<CognitionEventResult> {
    let deterministicApplied = false;
    if (event.cursor > this.state.publicEventCursor) {
      this.state = applyPublicEventDeterministic(this.state, event);
      deterministicApplied = true;
      const ingest = debitEnergy(this.ledger, {
        operationType: EnergyOperationType.DETERMINISTIC_INGEST,
        observationHash: observationHashFor(event, "DETERMINISTIC_UPDATE"),
        resultHash: resultHashFor(true, "deterministic_ingest"),
        executed: true,
      });
      if (ingest.ok) {
        this.ledger = ingest.ledger;
        this.state = setEnergyRemaining(this.state, this.ledger.remainingEnergy);
      }
      await this.persistStores();
    }

    const selection = selectSchedulerMode({
      event,
      ctx: this.ctx(),
      spendableBackground: spendableBackground(this.ledger),
      allowedSchedulerWeights: this.profile?.allowedSchedulerWeights,
    });

    if (selection.mode === "IGNORE" || selection.mode === "DETERMINISTIC_UPDATE") {
      return {
        selection,
        job: null,
        state: this.state,
        ledger: this.ledger,
        deterministicApplied,
      };
    }

    const job: CognitionJob = {
      id: this.createJobId(),
      priority: selection.priority,
      mode: selection.mode,
      operationType: selection.operationType,
      event,
      observationHash: observationHashFor(event, selection.mode),
      enqueuedAtMs: this.now(),
      status: "queued",
      abort: new AbortController(),
    };
    this.queue.enqueue(job);

    if (this.autoDrain) {
      void this.drain();
    }

    return {
      selection,
      job,
      state: this.state,
      ledger: this.ledger,
      deterministicApplied,
    };
  }

  /** Process queued background jobs until empty or preempted. */
  async drain(): Promise<CognitionDrainStats> {
    const stats: CognitionDrainStats = {
      processed: 0,
      completed: 0,
      cancelled: 0,
      skipped: 0,
      failed: 0,
    };
    if (this.draining) return stats;
    this.draining = true;
    try {
      while (this.queue.size > 0) {
        const job = this.queue.dequeue();
        if (!job) break;
        if (job.status === "cancelled") {
          stats.cancelled += 1;
          stats.processed += 1;
          continue;
        }
        stats.processed += 1;
        const outcome = await this.runJob(job);
        if (outcome === "completed") stats.completed += 1;
        else if (outcome === "cancelled") stats.cancelled += 1;
        else if (outcome === "skipped") stats.skipped += 1;
        else stats.failed += 1;
      }
    } finally {
      this.draining = false;
    }
    return stats;
  }

  private async runJob(
    job: CognitionJob,
  ): Promise<"completed" | "cancelled" | "skipped" | "failed"> {
    if (job.abort?.signal.aborted) {
      job.status = "cancelled";
      job.note = "aborted_before_start";
      return "cancelled";
    }

    const afford = canAfford(this.ledger, job.operationType, { spendClass: "background" });
    if (!afford.affordable) {
      job.status = "skipped";
      job.note = `not_affordable:${afford.reason}`;
      return "skipped";
    }

    if (!MODEL_BACKGROUND_MODES.has(job.mode)) {
      job.status = "skipped";
      job.note = "not_model_mode";
      return "skipped";
    }

    this.inFlight = job;
    job.status = "running";

    try {
      const observation =
        this.buildObservation?.({
          state: this.state,
          event: job.event,
          mode: job.mode,
        }) ?? {
          seat: this.seat,
          handId: this.handId,
          sessionId: this.sessionId,
          street: job.event.street,
          pot: this.state.tableImage.pot,
          energyRemaining: this.ledger.remainingEnergy,
          toActSeat: this.proximityToOwnTurn ? this.seat : undefined,
        };

      const bg = await this.provider.updateState({
        kind: mapModeToBackgroundKind(job.mode),
        mode: job.mode,
        observation,
        profile: this.profile,
        profileKey: this.profileKey,
        energyRemaining: this.ledger.remainingEnergy,
        observationHash: job.observationHash,
        signal: job.abort?.signal,
        event: job.event,
      });

      if (bg.cancelled || job.abort?.signal.aborted) {
        job.status = "cancelled";
        job.note = bg.note || "cancelled_no_debit";
        return "cancelled";
      }

      if (!bg.applied && bg.note?.includes("skip_no_debit")) {
        job.status = "skipped";
        job.note = bg.note;
        return "skipped";
      }

      const patch =
        (bg.statePatch as import("./types.js").BackgroundStatePatch | undefined) ??
        (bg.applied
          ? deterministicStructuredPatch(job.event, job.mode, this.seat)
          : undefined);

      // Charge only when the background path actually applied structured work.
      if (bg.applied || (bg.statePatch && Object.keys(bg.statePatch).length > 0)) {
        const effectivePatch =
          patch ?? deterministicStructuredPatch(job.event, job.mode, this.seat);
        this.state = applyBackgroundPatch(this.state, effectivePatch, job.event.cursor);

        const debit = debitEnergy(this.ledger, {
          operationType: job.operationType,
          observationHash: job.observationHash,
          resultHash: resultHashFor(true, bg.note || job.mode),
          providerRequestId: bg.providerRequestId
            ? asHex32(bg.providerRequestId)
            : undefined,
          executed: true,
        });
        if (!debit.ok) {
          job.status = "skipped";
          job.note = `debit_rejected:${debit.reason}`;
          await this.persistStores();
          return "skipped";
        }
        this.ledger = debit.ledger;
        this.state = setEnergyRemaining(this.state, this.ledger.remainingEnergy);
        await this.persistStores();
        job.status = "completed";
        job.note = bg.note || "applied";
        return "completed";
      }

      job.status = "skipped";
      job.note = bg.note || "not_applied";
      return "skipped";
    } catch (err) {
      if (job.abort?.signal.aborted) {
        job.status = "cancelled";
        job.note = "cancelled_on_error";
        return "cancelled";
      }
      job.status = "failed";
      job.note = err instanceof Error ? err.message : "job_failed";
      return "failed";
    } finally {
      if (this.inFlight?.id === job.id) this.inFlight = null;
    }
  }

  /**
   * Cancel queued + in-flight background work when the seat must act.
   * Cancelled work MUST NOT debit Energy.
   */
  preemptForFinalAction(note = "preempt_final_action"): PreemptResult {
    const cancelledJobs = this.queue.cancelAll(note);
    let inFlightCancelled = false;
    if (this.inFlight) {
      this.inFlight.abort?.abort();
      this.inFlight.status = "cancelled";
      this.inFlight.note = note;
      cancelledJobs.push(this.inFlight);
      this.inFlight = null;
      inFlightCancelled = true;
    }
    return {
      cancelledJobs,
      inFlightCancelled,
      ledger: this.ledger,
      state: this.state,
    };
  }

  /**
   * Final on-turn decision: preempt background, call provider.decide, debit Energy.
   * Deadline / cadence remain the caller's responsibility (WP-075).
   */
  async runFinalAction(
    request: DecisionRequest,
    options?: {
      operationType?:
        | typeof EnergyOperationType.STANDARD_FINAL_DECISION
        | typeof EnergyOperationType.DEEP_FINAL_DECISION
        | typeof EnergyOperationType.MAXIMUM_FINAL_DECISION;
      includeMemoryRetrieval?: boolean;
      observationHash?: Hex;
    },
  ): Promise<FinalActionResult> {
    this.proximityToOwnTurn = true;
    const preempt = this.preemptForFinalAction();

    // Event-importance Energy: deeper SPR / larger pots spend more Energy.
    const potBb = Number(request.observation?.potBb ?? request.observation?.pot ?? 0);
    const spr = Number(request.observation?.spr ?? request.observation?.effectiveStackBb ?? 0);
    const important = potBb >= 20 || (spr > 0 && spr <= 8) || request.observation?.street === "river";
    const operationType =
      options?.operationType ??
      (important
        ? EnergyOperationType.DEEP_FINAL_DECISION
        : EnergyOperationType.STANDARD_FINAL_DECISION);
    const memory = options?.includeMemoryRetrieval ?? important;
    const energyDebit = combinedFinalDebit(operationType, memory);

    // Wire live AgentState into the final decision (plan + opponent memory).
    const agentStateSummary = {
      streetPlan: this.state.streetPlan,
      opponentModels: this.state.opponentModels,
      energyRemaining: this.state.energyRemaining,
      publicEventCursor: this.state.publicEventCursor,
    };

    const decision = await this.provider.decide({
      ...request,
      profile: request.profile ?? this.profile,
      profileKey: request.profileKey ?? this.profileKey,
      observation: {
        ...request.observation,
        energyRemaining: this.ledger.remainingEnergy,
        seat: this.seat,
        handId: this.handId,
        sessionId: this.sessionId,
        agentState: agentStateSummary,
      },
    });

    const obsHash =
      options?.observationHash ??
      asHex32(`final-obs:${this.handId}:${this.seat}:${this.now()}`);
    const resHash = asHex32(
      `final-res:${decision.actionType}:${decision.amount}:${decision.fallbackUsed ? 1 : 0}`,
    );

    const afford = canAfford(this.ledger, operationType, {
      energyDebit,
      spendClass: "final",
    });

    let energyDebited = 0;
    if (afford.affordable) {
      const debit = debitEnergy(this.ledger, {
        operationType,
        energyDebit,
        spendClass: "final",
        observationHash: obsHash,
        resultHash: resHash,
        fallbackFlag: decision.fallbackUsed,
        executed: true,
      });
      if (debit.ok) {
        this.ledger = debit.ledger;
        energyDebited = debit.op.energyDebit;
        this.state = setEnergyRemaining(this.state, this.ledger.remainingEnergy);
        await this.persistStores();
      }
    }

    return {
      decision,
      ledger: this.ledger,
      state: this.state,
      energyDebited,
      preempt,
    };
  }
}

