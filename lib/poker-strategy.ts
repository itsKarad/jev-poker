import { BLINDS } from "./poker-blinds";

export const BANKROLL_STRATEGY = {
  blindSchedule: `Blinds remain fixed at $${BLINDS.small}/$${BLINDS.big} for the entire match.`,
  objective: "Maximize expected final bankroll across the whole match while minimizing avoidable losses.",
  adaptation: [
    "Choose the style that best fits the current evidence; do not rotate styles on a fixed schedule.",
    "Use tight or conservative play when the edge is weak, information is limited, or downside outweighs expected gain.",
    "Use loose or aggressive pressure when hand strength, board texture, opponent tendencies, bankroll position, and remaining hands support positive expected value.",
    "Learn from recent revealed hands and action patterns, but do not assume any current hidden card.",
  ],
  bluffing: [
    "Bluff selectively when representing strength can improve expected final profit or prevent the strategy from becoming predictable.",
    "Vary bluff frequency with the opponent's recent behavior, the board, match position, and risk budget; never bluff merely for variety.",
    "Do not chase losses. Prefer a smaller loss over a negative-expectation attempt to recover immediately.",
  ],
  gameConstraint: "Use every context-valid no-limit action: check, bet, call, raise, fold, or all-in. For bets and raises, choose an exact legal target amount from the supplied range.",
} as const;
