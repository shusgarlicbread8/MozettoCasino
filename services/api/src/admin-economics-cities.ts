/**
 * MC-041 — Per-city economics (best-effort from leagues / sessions / settlements).
 */

import { query } from "@mozetto/database";
import {
  estimateChainCogsUsdMicro,
  estimateGroqCostUsdMicro,
  estimateInfraCogsUsdMicro,
  placeholdersFromEnv,
  SEASON1_GROQ_TOKEN_PRICING_USD_MICRO_PER_MTOK,
} from "@mozetto/unit-economics";
import {
  ADMIN_ECONOMICS_SCHEMA_VERSION,
  availableCount,
  availableMoney,
  computeContributionMarginPct,
  estimatedMoney,
  unavailableCount,
  unavailableMoney,
  usdcDecimalToUsdMicro,
  type AdminCountField,
  type AdminPercentField,
  type AdminUsdMicroField,
} from "./admin-economics-schema.js";

type CityRow = {
  city_id: string;
  city_name: string;
  sort_order: number;
  small_blind: string | null;
  big_blind: string | null;
  min_buy_in: string | null;
  max_buy_in: string | null;
  hands: string;
  active_users: string;
  sessions: string;
  confirmed_settlements: string;
  gross_rake_usdc: string;
  ai_invocations: string;
  ai_token_usage: string;
};

export type AdminCityEconomicsRow = {
  cityId: string;
  cityName: string;
  sortOrder: number;
  stakes: {
    smallBlind: string | null;
    bigBlind: string | null;
    minBuyIn: string | null;
    maxBuyIn: string | null;
  };
  hands: AdminCountField;
  activeUsers: AdminCountField;
  sessions: AdminCountField;
  grossPotVolumeUsdMicro: AdminUsdMicroField;
  grossRakeUsdMicro: AdminUsdMicroField;
  aiCogsUsdMicro: AdminUsdMicroField;
  chainCogsUsdMicro: AdminUsdMicroField;
  infrastructureCogsUsdMicro: AdminUsdMicroField;
  contributionUsdMicro: AdminUsdMicroField;
  contributionMarginPct: AdminPercentField;
};

function hasSettlementSignal(row: CityRow): boolean {
  return Number(row.confirmed_settlements) > 0;
}

function buildCogsEstimates(hands: number, aiTokenUsage: number) {
  const placeholders = placeholdersFromEnv();
  const chainPerHand = estimateChainCogsUsdMicro(placeholders);
  const infraPerHand = estimateInfraCogsUsdMicro(placeholders);

  const chainCogs = hands > 0 ? chainPerHand * BigInt(hands) : null;
  const infraCogs = hands > 0 ? infraPerHand * BigInt(hands) : null;

  let aiCogs: bigint | null = null;
  if (aiTokenUsage > 0) {
    aiCogs = estimateGroqCostUsdMicro(
      { promptTokens: aiTokenUsage, completionTokens: 0 },
      SEASON1_GROQ_TOKEN_PRICING_USD_MICRO_PER_MTOK,
    );
  }

  return { chainCogs, infraCogs, aiCogs };
}

function buildCityRow(row: CityRow): AdminCityEconomicsRow {
  const hands = Number(row.hands);
  const activeUsers = Number(row.active_users);
  const sessions = Number(row.sessions);
  const aiInvocations = Number(row.ai_invocations);
  const aiTokenUsage = Number(row.ai_token_usage);
  const hasSettlements = hasSettlementSignal(row);

  const grossRakeMicro = hasSettlements
    ? usdcDecimalToUsdMicro(row.gross_rake_usdc)
    : null;

  const grossRakeUsdMicro: AdminUsdMicroField = hasSettlements
    ? availableMoney(
        grossRakeMicro,
        "settlement_proposals.status=confirmed",
        sessions === 0 ? "No sessions linked — rake may be historical." : undefined,
      )
    : unavailableMoney(
        sessions > 0
          ? "Sessions exist but no confirmed settlements yet."
          : "No on-chain sessions linked to this city.",
        "settlement_proposals",
      );

  const grossPotVolumeUsdMicro = unavailableMoney(
    "Pot volume not materialized per city in current schema.",
    "canonical_game_events",
  );

  const { chainCogs, infraCogs, aiCogs } = buildCogsEstimates(hands, aiTokenUsage);

  const chainCogsUsdMicro: AdminUsdMicroField =
    hands > 0 && chainCogs != null
      ? estimatedMoney(
          chainCogs,
          "unit-economics placeholders × hand_roots",
          "Season 1 chain COGS placeholders — not Sepolia-calibrated.",
        )
      : unavailableMoney(
          hands === 0 ? "No hands recorded for this city." : "Chain COGS placeholders unavailable.",
          "unit-economics",
        );

  const infrastructureCogsUsdMicro: AdminUsdMicroField =
    hands > 0 && infraCogs != null
      ? estimatedMoney(
          infraCogs,
          "unit-economics placeholders × hand_roots",
          "Season 1 infra COGS placeholders — amortized estimate.",
        )
      : unavailableMoney(
          hands === 0 ? "No hands recorded for this city." : "Infra COGS placeholders unavailable.",
          "unit-economics",
        );

  const aiCogsUsdMicro: AdminUsdMicroField =
    aiTokenUsage > 0 && aiCogs != null
      ? estimatedMoney(
          aiCogs,
          "agent_invocations.token_usage × Groq hypothesis rates",
          "Token usage is aggregate — attribution per city is approximate.",
        )
      : aiInvocations > 0
        ? unavailableMoney(
            "Invocations recorded without token_usage — cannot price AI COGS.",
            "agent_invocations",
          )
        : unavailableMoney("No agent invocations for sessions in this city.", "agent_invocations");

  let contributionUsdMicro: AdminUsdMicroField = unavailableMoney(
    "Contribution requires rake and full COGS.",
    "unit-economics",
  );
  let contributionMarginPct: AdminPercentField = {
    percent: null,
    availability: "UNAVAILABLE",
    note: "Contribution not computed.",
    source: "unit-economics",
  };

  if (
    grossRakeMicro != null &&
    aiCogsUsdMicro.availability !== "UNAVAILABLE" &&
    chainCogsUsdMicro.availability !== "UNAVAILABLE" &&
    infrastructureCogsUsdMicro.availability !== "UNAVAILABLE" &&
    aiCogs != null &&
    chainCogs != null &&
    infraCogs != null
  ) {
    const contribution = grossRakeMicro - aiCogs - chainCogs - infraCogs;
    contributionUsdMicro = {
      usdMicro: contribution.toString(),
      availability: "ESTIMATED",
      source: "grossRakeUsdMicro − COGS (city-scoped estimates)",
      note: "City-level COGS uses placeholders / aggregate token usage.",
    };
    contributionMarginPct = computeContributionMarginPct(contribution, grossRakeMicro);
    contributionMarginPct = {
      ...contributionMarginPct,
      availability: "ESTIMATED",
      note: "Based on estimated city COGS.",
    };
  }

  return {
    cityId: row.city_id,
    cityName: row.city_name,
    sortOrder: row.sort_order,
    stakes: {
      smallBlind: row.small_blind,
      bigBlind: row.big_blind,
      minBuyIn: row.min_buy_in,
      maxBuyIn: row.max_buy_in,
    },
    hands: availableCount(hands, "hand_roots via onchain_sessions"),
    activeUsers: availableCount(
      activeUsers,
      "onchain_session_players",
      activeUsers === 0 ? "Distinct profile_ids with at least one session in city." : undefined,
    ),
    sessions: availableCount(sessions, "onchain_sessions via tables.league_id"),
    grossPotVolumeUsdMicro,
    grossRakeUsdMicro,
    aiCogsUsdMicro,
    chainCogsUsdMicro,
    infrastructureCogsUsdMicro,
    contributionUsdMicro,
    contributionMarginPct,
  };
}

export async function buildCityEconomicsSnapshot() {
  const result = await query<CityRow>(
    `select
       l.id as city_id,
       l.name as city_name,
       l.sort_order,
       l.small_blind::text,
       l.big_blind::text,
       l.min_buy_in::text,
       l.max_buy_in::text,
       count(distinct hr.hand_id)::text as hands,
       count(distinct osp.profile_id) filter (where osp.profile_id is not null)::text as active_users,
       count(distinct os.session_id)::text as sessions,
       count(sp.id) filter (where sp.status = 'confirmed')::text as confirmed_settlements,
       coalesce(sum(sp.total_rake) filter (where sp.status = 'confirmed'), 0)::text as gross_rake_usdc,
       count(distinct ai.id)::text as ai_invocations,
       coalesce(sum(ai.token_usage) filter (where ai.token_usage is not null), 0)::text as ai_token_usage
     from leagues l
     left join tables t
       on t.league_id = l.id and t.arena_mode = 'onchain'
     left join onchain_sessions os on os.table_id = t.id
     left join settlement_proposals sp on sp.session_id = os.session_id
     left join onchain_session_players osp on osp.session_id = os.session_id
     left join hand_roots hr on hr.session_id = os.session_id
     left join agent_invocations ai on ai.session_id = os.session_id
     where l.id in ('casual', 'bronze', 'silver', 'gold', 'platinum', 'diamond')
     group by l.id, l.name, l.sort_order, l.small_blind, l.big_blind, l.min_buy_in, l.max_buy_in
     order by l.sort_order`,
  );

  const cities = result.rows.map(buildCityRow);

  return {
    readOnly: true as const,
    workPacket: "MC-041" as const,
    schemaVersion: ADMIN_ECONOMICS_SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    cities,
    meta: {
      generatedAt: new Date().toISOString(),
      source: "leagues,onchain_sessions,settlement_proposals,hand_roots,agent_invocations",
      stale: false,
    },
    notes: [
      "Per-city rake from confirmed settlement_proposals only.",
      "AI/chain/infra COGS are best-effort — UNAVAILABLE or ESTIMATED when sparse.",
      "Gross pot volume is not yet materialized per city.",
    ],
  };
}
