import type { ActionRecord, HandProgressEvent, LegalAction, LivePokerHand, PlayerId, PokerDecision, PokerDecisionContext, PokerHand, PokerMatch, Winner } from "./types";
import { revealedBoard } from "./poker-visibility";
import { BLINDS } from "./poker-blinds";

export const RANKS = "23456789TJQKA";
export const SUITS = "cdhs";

export function makeDeck() {
  return [...RANKS].flatMap((rank) => [...SUITS].map((suit) => `${rank}${suit}`));
}

export function rng(seed: string) {
  let hash = 2166136261;
  for (const character of seed) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return () => {
    hash += 0x6d2b79f5;
    let value = hash;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

export function shuffle<T>(items: T[], random: () => number) {
  const copy = [...items];
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const target = Math.floor(random() * (index + 1));
    [copy[index], copy[target]] = [copy[target], copy[index]];
  }
  return copy;
}

function fiveCardRank(cards: string[]) {
  const values = cards.map((card) => RANKS.indexOf(card[0]) + 2).sort((a, b) => b - a);
  const counts = new Map<number, number>();
  values.forEach((value) => counts.set(value, (counts.get(value) ?? 0) + 1));
  const flush = cards.every((card) => card[1] === cards[0][1]);
  const unique = [...new Set(values)];
  let straight = unique.includes(14) && [2, 3, 4, 5].every((value) => unique.includes(value)) ? 5 : 0;
  for (let index = 0; index <= unique.length - 5 && !straight; index += 1) {
    if (unique[index] - unique[index + 4] === 4) straight = unique[index];
  }
  const groups = [...counts].sort((a, b) => b[1] - a[1] || b[0] - a[0]);
  if (flush && straight) return [8, straight];
  if (groups[0]?.[1] === 4) return [7, groups[0][0], groups[1][0]];
  if (groups[0]?.[1] === 3 && groups[1]?.[1] >= 2) return [6, groups[0][0], groups[1][0]];
  if (flush) return [5, ...values];
  if (straight) return [4, straight];
  if (groups[0]?.[1] === 3) return [3, groups[0][0], ...groups.slice(1).map(([value]) => value).sort((a, b) => b - a)];
  if (groups[0]?.[1] === 2 && groups[1]?.[1] === 2) return [2, groups[0][0], groups[1][0], groups[2][0]];
  if (groups[0]?.[1] === 2) return [1, groups[0][0], ...groups.slice(1).map(([value]) => value).sort((a, b) => b - a)];
  return [0, ...values];
}

export function compareRanks(left: number[], right: number[]) {
  for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
    const difference = (left[index] ?? 0) - (right[index] ?? 0);
    if (difference) return Math.sign(difference);
  }
  return 0;
}

export function bestRank(cards: string[]) {
  let best: number[] | null = null;
  const visit = (start: number, picked: string[]) => {
    if (picked.length === 5) {
      const rank = fiveCardRank(picked);
      if (!best || compareRanks(rank, best) > 0) best = rank;
      return;
    }
    for (let index = start; index < cards.length; index += 1) visit(index + 1, [...picked, cards[index]]);
  };
  visit(0, []);
  if (!best) throw new Error("At least five cards are required");
  return best as number[];
}

const HAND_NAMES = ["High card", "Pair", "Two pair", "Three of a kind", "Straight", "Flush", "Full house", "Four of a kind", "Straight flush"];

export type PlayerDeciders = {
  decideJev: (context: PokerDecisionContext, signal?: AbortSignal) => Promise<PokerDecision>;
  decideCodex: (context: PokerDecisionContext, signal?: AbortSignal) => Promise<PokerDecision>;
};

const otherPlayer = (player: PlayerId): PlayerId => player === "jev" ? "codex" : "jev";

function getLegalActions(
  actor: PlayerId,
  bankroll: Record<PlayerId, number>,
  contributions: Record<PlayerId, number>,
  currentBet: number,
  minimumRaise: number,
): LegalAction[] {
  const opponent = otherPlayer(actor);
  const stack = bankroll[actor];
  if (stack <= 0) return [];

  const toCall = Math.max(0, currentBet - contributions[actor]);
  const maximumTarget = contributions[actor] + stack;
  const actions: LegalAction[] = toCall === 0
    ? [{ action: "check" }]
    : [{ action: "fold" }, { action: "call", amount: Math.min(toCall, stack) }];

  if (bankroll[opponent] > 0) {
    if (currentBet === 0 && maximumTarget >= minimumRaise) {
      actions.push({ action: "bet", minAmount: minimumRaise, maxAmount: maximumTarget });
    } else if (currentBet > 0 && maximumTarget >= currentBet + minimumRaise) {
      actions.push({ action: "raise", minAmount: currentBet + minimumRaise, maxAmount: maximumTarget });
    }
  }
  if (bankroll[opponent] > 0 || stack <= toCall) actions.push({ action: "all_in", amount: stack });
  return actions;
}

function validateDecision(decision: PokerDecision, legalActions: LegalAction[]) {
  const legal = legalActions.find((candidate) => candidate.action === decision.action);
  if (!legal) throw new Error(`Model selected illegal action: ${decision.action}`);
  if (decision.action === "bet" || decision.action === "raise") {
    if (!("minAmount" in legal) || !Number.isInteger(decision.amount) || decision.amount < legal.minAmount || decision.amount > legal.maxAmount) {
      throw new Error(`Model selected illegal ${decision.action} amount: ${decision.amount}`);
    }
  }
  return decision;
}

export async function playNextHand(
  match: PokerMatch,
  { decideJev, decideCodex }: PlayerDeciders,
  { onEvent, signal }: { onEvent?: (event: HandProgressEvent) => void; signal?: AbortSignal } = {},
): Promise<PokerHand> {
  signal?.throwIfAborted();
  const number = match.hands.length + 1;
  const blinds = { ...BLINDS };
  const random = rng(`${match.seed}:${number}`);
  const deck = shuffle(makeDeck(), random);
  const holeCards = { jev: [deck[0], deck[2]], codex: [deck[1], deck[3]] };
  const board = deck.slice(4, 9);
  const button: PlayerId = number % 2 ? "jev" : "codex";
  const bigBlind: PlayerId = button === "jev" ? "codex" : "jev";
  const bankroll = { ...match.bankroll };
  const smallBlindAmount = Math.min(blinds.small, bankroll[button]);
  bankroll[button] -= smallBlindAmount;
  const bigBlindAmount = Math.min(blinds.big, bankroll[bigBlind]);
  bankroll[bigBlind] -= bigBlindAmount;
  const invested = { jev: 0, codex: 0 };
  invested[button] = smallBlindAmount;
  invested[bigBlind] = bigBlindAmount;
  let pot = smallBlindAmount + bigBlindAmount;
  const actions: ActionRecord[] = [];
  const streets: ActionRecord["street"][] = ["preflop", "flop", "turn", "river"];
  const visibleCards = (street: ActionRecord["street"]) => street === "preflop" ? [] : street === "flop" ? board.slice(0, 3) : street === "turn" ? board.slice(0, 4) : board;
  let foldedWinner: PlayerId | null = null;
  const snapshot = (street: ActionRecord["street"]): LivePokerHand => ({
    id: `${match.id}-${number}`, number, button, blinds, holeCards,
    street, board: visibleCards(street), actions: [...actions], pot, bankroll: { ...bankroll },
  });
  onEvent?.({ type: "deal", hand: snapshot("preflop") });

  for (const street of streets) {
    const contributions: Record<PlayerId, number> = street === "preflop"
      ? { jev: invested.jev, codex: invested.codex }
      : { jev: 0, codex: 0 };
    let currentBet = Math.max(contributions.jev, contributions.codex);
    let minimumRaise = blinds.big;
    let pending: PlayerId[] = street === "preflop" ? [button, bigBlind] : [bigBlind, button];
    if (bankroll.jev === 0 || bankroll.codex === 0) {
      pending = pending.filter((player) => bankroll[player] > 0 && contributions[player] < currentBet);
    }

    while (pending.length > 0) {
      signal?.throwIfAborted();
      const actor = pending.shift()!;
      if (bankroll[actor] === 0) continue;
      const opponent = otherPlayer(actor);
      const visible = visibleCards(street);
      const legalActions = getLegalActions(actor, bankroll, contributions, currentBet, minimumRaise);
      const context: PokerDecisionContext = {
        handNumber: number,
        blinds,
        actor,
        opponent,
        matchProgress: {
          completedHands: match.hands.length,
          requestedHands: match.requestedHands,
        },
        street,
        board: visible,
        holeCards: holeCards[actor],
        pot,
        bankroll: { ...bankroll },
        streetContributions: { ...contributions },
        currentBet,
        toCall: Math.max(0, currentBet - contributions[actor]),
        legalActions,
        actionHistory: actions,
        recentHands: match.hands.slice(-8).map((hand) => ({
          number: hand.number,
          winner: hand.winner,
          pot: hand.pot,
          holeCards: hand.actions.some((action) => action.action === "fold")
            ? { [actor]: hand.holeCards[actor] }
            : hand.holeCards,
          board: revealedBoard(hand),
          actions: hand.actions,
        })),
      };
      const startedAt = Date.now();
      const started = performance.now();
      onEvent?.({ type: "thinking", hand: snapshot(street), actor, startedAt });
      const decision = validateDecision(
        actor === "codex" ? await decideCodex(context, signal) : await decideJev(context, signal),
        legalActions,
      );
      signal?.throwIfAborted();
      const durationMs = Math.round(performance.now() - started);
      const previousContribution = contributions[actor];
      let target = previousContribution;

      if (decision.action === "fold") {
        foldedWinner = opponent;
      } else if (decision.action === "call") {
        target += Math.min(currentBet - previousContribution, bankroll[actor]);
      } else if (decision.action === "bet" || decision.action === "raise") {
        target = decision.amount;
      } else if (decision.action === "all_in") {
        target += bankroll[actor];
      }

      const committed = target - previousContribution;
      if (committed > 0) {
        bankroll[actor] -= committed;
        contributions[actor] = target;
        invested[actor] += committed;
        pot += committed;
      }

      if (target > currentBet) {
        const raiseSize = target - currentBet;
        if (raiseSize >= minimumRaise) minimumRaise = raiseSize;
        currentBet = target;
        pending = bankroll[opponent] > 0 ? [opponent] : [];
      }

      actions.push({
        street,
        actor,
        action: decision.action,
        amount: committed,
        streetTotal: contributions[actor],
        source: decision.source,
        durationMs,
        board: visible,
        pot,
      });
      onEvent?.({ type: "action", hand: snapshot(street) });
      if (foldedWinner) break;
    }
    if (foldedWinner) break;
  }

  const jevRank = bestRank([...holeCards.jev, ...board]);
  const codexRank = bestRank([...holeCards.codex, ...board]);
  if (!foldedWinner && invested.jev !== invested.codex) {
    const refundPlayer: PlayerId = invested.jev > invested.codex ? "jev" : "codex";
    const refund = Math.abs(invested.jev - invested.codex);
    bankroll[refundPlayer] += refund;
    pot -= refund;
  }
  const comparison = compareRanks(jevRank, codexRank);
  const winner: Winner = foldedWinner ?? (comparison > 0 ? "jev" : comparison < 0 ? "codex" : "tie");
  if (winner === "tie") {
    bankroll.jev += Math.floor(pot / 2);
    bankroll.codex += pot - Math.floor(pot / 2);
  } else {
    bankroll[winner] += pot;
  }

  const winningRank = winner === "codex" ? codexRank : jevRank;
  return {
    id: `${match.id}-${number}`,
    number,
    playedAt: new Date().toISOString(),
    button,
    blinds,
    holeCards,
    board,
    actions,
    winner,
    winningHand: foldedWinner ? "Fold" : HAND_NAMES[winningRank[0]],
    pot,
    bankroll,
  };
}
