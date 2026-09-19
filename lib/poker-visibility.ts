import type { PokerHand } from "./types";

export function revealedBoard(hand: PokerHand): string[] {
  const fold = hand.actions.find((action) => action.action === "fold");
  return fold ? fold.board : hand.board;
}

export function visibleBoardAt(hand: PokerHand | null, actionIndex: number, resolved: boolean): string[] {
  if (!hand) return [];
  return resolved ? revealedBoard(hand) : hand.actions[actionIndex]?.board ?? [];
}
