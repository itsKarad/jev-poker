import type { PlayerModels } from "./player-models";
import type { Blinds } from "./poker-blinds";

export type PlayerId = "jev" | "codex";
export type Winner = PlayerId | "tie";
export type MatchStatus = "ready" | "running" | "finished";
export const POKER_ACTIONS = ["check", "bet", "call", "raise", "fold", "all_in"] as const;
export type PokerAction = typeof POKER_ACTIONS[number];

export function isPokerAction(value: string | undefined): value is PokerAction {
  return POKER_ACTIONS.some((action) => action === value);
}

export type LegalAction =
  | { action: "check" }
  | { action: "fold" }
  | { action: "call"; amount: number }
  | { action: "all_in"; amount: number }
  | { action: "bet"; minAmount: number; maxAmount: number }
  | { action: "raise"; minAmount: number; maxAmount: number };

export type ReasoningSummary = { id: string; text: string; elapsedMs: number };

export type ActionRecord = {
  street: "preflop" | "flop" | "turn" | "river";
  actor: PlayerId;
  action: PokerAction;
  amount: number;
  streetTotal: number;
  source: "model" | "fallback";
  board: string[];
  pot: number;
  durationMs?: number;
  reasoning?: ReasoningSummary[];
};

export type PokerDecision =
  | { action: "check" | "call" | "fold" | "all_in"; source: ActionRecord["source"] }
  | { action: "bet" | "raise"; amount: number; source: ActionRecord["source"] };

export type PokerDecisionContext = {
  handNumber: number;
  blinds: Blinds;
  actor: PlayerId;
  opponent: PlayerId;
  matchProgress: {
    completedHands: number;
    requestedHands: number;
  };
  street: ActionRecord["street"];
  board: string[];
  holeCards: string[];
  pot: number;
  bankroll: Record<PlayerId, number>;
  streetContributions: Record<PlayerId, number>;
  currentBet: number;
  toCall: number;
  legalActions: LegalAction[];
  actionHistory: ActionRecord[];
  recentHands: Array<{
    number: number;
    winner: Winner;
    pot: number;
    // Opponent cards are absent when the hand ended without a showdown.
    holeCards: Partial<Record<PlayerId, string[]>>;
    board: string[];
    actions: ActionRecord[];
  }>;
};

export type PokerHand = {
  id: string;
  number: number;
  playedAt: string;
  button: PlayerId;
  // Older saved hands used fixed $1/$2 blinds.
  blinds?: Blinds;
  models?: PlayerModels;
  holeCards: Record<PlayerId, string[]>;
  board: string[];
  actions: ActionRecord[];
  winner: Winner;
  winningHand: string;
  pot: number;
  bankroll: Record<PlayerId, number>;
};

export type PokerMatch = {
  id: string;
  seed: string;
  requestedHands: number;
  status: MatchStatus;
  createdAt: string;
  updatedAt: string;
  bankroll: Record<PlayerId, number>;
  hands: PokerHand[];
  models?: PlayerModels;
};

export type LivePokerHand = Pick<PokerHand, "id" | "number" | "button" | "blinds" | "models" | "holeCards" | "board" | "actions" | "pot" | "bankroll"> & {
  street: ActionRecord["street"];
};

export type HandProgressEvent =
  | { type: "deal" | "action"; hand: LivePokerHand }
  | { type: "thinking"; hand: LivePokerHand; actor: PlayerId; startedAt: number }
  | { type: "reasoning"; hand: LivePokerHand; actor: PlayerId; startedAt: number; reasoning: ReasoningSummary[] };

export type HandStreamEvent = HandProgressEvent
  | { type: "complete"; match: PokerMatch; hand: PokerHand | null }
  | { type: "error"; error: string };

export type MatchSummary = Pick<PokerMatch, "id" | "createdAt" | "seed"> & {
  completedHands: number;
};
