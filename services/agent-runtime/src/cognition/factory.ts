/**
 * Wire cognition scheduler stores from env (WP-110).
 *
 * - AGENT_STATE_STORE=db → DbAgentStateStore
 * - ENERGY_LEDGER_STORE=db → DbEnergyLedgerStore
 * Defaults remain in-memory for local/dev.
 */

import { keccak256, toBytes, type Hex } from "viem";
import {
  createEnergyLedgerStore,
  ENERGY_POLICY_HASH,
  grantHandEnergy,
  type EnergyLedgerStore,
} from "../energy/index.js";
import type { PokerModelProvider } from "../provider/types.js";
import { createAgentStateStore } from "../state/factory.js";
import type { AgentStateStore, AgentStateV1 } from "../state/types.js";
import { ContinuousCognitionScheduler } from "./scheduler.js";
import type { ContinuousCognitionSchedulerOptions } from "./types.js";

function asHex32(label: string): Hex {
  return keccak256(toBytes(label));
}

export interface CreateCognitionSchedulerOptions
  extends Omit<ContinuousCognitionSchedulerOptions, "store" | "energyStore" | "ledger" | "initialState"> {
  provider: PokerModelProvider;
  env?: NodeJS.ProcessEnv;
  store?: AgentStateStore;
  energyStore?: EnergyLedgerStore;
  ledger?: ContinuousCognitionSchedulerOptions["ledger"];
  initialState?: AgentStateV1;
  /** When true (default), hydrate from stores if ledger/state not injected. */
  hydrateFromStores?: boolean;
}

/**
 * Build a scheduler with AgentState + Energy stores selected from env.
 * Hydrates prior snapshots when present (db or memory), else grants fresh Energy.
 */
export async function createCognitionScheduler(
  opts: CreateCognitionSchedulerOptions,
): Promise<ContinuousCognitionScheduler> {
  const env = opts.env ?? process.env;
  const store = opts.store ?? createAgentStateStore({ env });
  const energyStore = opts.energyStore ?? createEnergyLedgerStore({ env });

  const sessionHex = asHex32(`session:${opts.sessionId}`);
  const handHex = asHex32(`hand:${opts.handId}`);
  const hydrate = opts.hydrateFromStores ?? true;

  let ledger = opts.ledger;
  let initialState = opts.initialState;

  if (hydrate) {
    if (!ledger) {
      const loaded = await energyStore.get({
        sessionId: sessionHex,
        handId: handHex,
        seat: opts.seat,
        energyPolicyHash: ENERGY_POLICY_HASH,
      });
      if (loaded) ledger = loaded;
    }
    if (!initialState) {
      const loadedState = await store.get({
        sessionId: opts.sessionId,
        handId: opts.handId,
        seat: opts.seat,
      });
      if (loadedState) initialState = loadedState;
    }
  }

  if (!ledger) {
    ledger = grantHandEnergy({
      sessionId: sessionHex,
      handId: handHex,
      seat: opts.seat,
    });
  }

  return new ContinuousCognitionScheduler({
    ...opts,
    store,
    energyStore,
    ledger,
    initialState,
  });
}
