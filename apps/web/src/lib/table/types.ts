export type EngineCard = { rank: string; suit: string };

export type LiveSeat = {
  seatIndex: number;
  playerId: string;
  agentId: string;
  stack: number;
  bet: number;
  folded: boolean;
  allIn: boolean;
  sitOut: boolean;
  hasCards: boolean;
  /** Assessed rake owed by this seat until leave/settle. */
  rakeOwed?: number;
};

export type SessionHandResult = {
  handNumber: number;
  handPnl: number;
  fees: number;
  stackAfter: number;
};

/** Owner session economics — stacks already net of per-hand rake. */
export type SessionEconomics = {
  buyIn: number;
  stack: number;
  feesPaid: number;
  sessionPnl: number;
  grossSessionPnl: number;
  handsPlayed: number;
  lastHand: SessionHandResult | null;
  leaveQueued?: boolean;
};

export type LiveTableState = {
  handId: string | null;
  handNumber?: number;
  street: string;
  pot: number;
  board: EngineCard[];
  seats: LiveSeat[];
  actingIndex: number | null;
  deadlineAt: number | null;
  /** Owner hole cards only — never filled for opponents. */
  holeCards: EngineCard[];
  button: number | null;
  legalActions: { action: string; minAmount?: number; maxAmount?: number }[];
  revealed: Record<number, EngineCard[]>;
  equity: { seatIndex: number; winPct: number; tiePct: number; equityPct: number }[];
  handLabels: { seatIndex: number; label: string | null }[];
  allInRunout: boolean;
  myHand: string | null;
  myEquity: number | null;
  /** Cumulative platform rake taken from this seat's winning pots. */
  feesOnTab: number;
  sessionEconomics?: SessionEconomics | null;
  leaveQueued?: boolean;
  /** Server bust-rebuy deadline (epoch ms); null when not in a rebuy window. */
  rebuyDeadlineAt?: number | null;
  rebuyRemainingMs?: number | null;
};

export type SeatActionFx = {
  seatIndex: number;
  text: string;
  color: string;
  key: number;
  /** WP-132 presentation token (2D/3D avatar consumers). */
  avatarState?: string;
};

export type WinFx = {
  key: number;
  kind: "showdown" | "fold";
  title: string;
  subtitle: string;
  winners: { seatIndex: number; amount: number; label: string }[];
  revealed: Record<number, EngineCard[]>;
};

export type SeatMeta = {
  seat_index?: number;
  status?: string;
  owner_id?: string | null;
  agent_id?: string | null;
  stack?: string | number;
  owner_display_name?: string | null;
  agent_display_name?: string | null;
  agent_handle?: string | null;
  owner_handle?: string | null;
  glyph?: string | null;
  current_version?: string | null;
  agent_color?: string | null;
};

export type TableMeta = {
  name?: string;
  league_name?: string;
  league_color?: string;
  display_game?: string;
  max_seats?: number;
  small_blind?: number;
  big_blind?: number;
  min_buy_in?: number;
  max_buy_in?: number;
  seated?: number;
  variant_name?: string;
  /** On-chain session id when sealed (WP-128 trust → Verify). */
  onchain_session_id?: string | null;
};
