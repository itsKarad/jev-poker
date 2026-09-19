import test from "node:test";
import assert from "node:assert/strict";
import { bestRank, compareRanks, makeDeck, playNextHand, rng, shuffle } from "../lib/poker";
import { visibleBoardAt } from "../lib/poker-visibility";
import type { PokerDecision, PokerDecisionContext, PokerMatch } from "../lib/types";

const passiveDecision = async (context: PokerDecisionContext): Promise<PokerDecision> => {
  if (context.legalActions.some(({ action }) => action === "check")) return { action: "check", source: "model" };
  if (context.legalActions.some(({ action }) => action === "call")) return { action: "call", source: "model" };
  return { action: "fold", source: "model" };
};

for (const handNumber of [1, 7, 55, 100]) {
  test(`hand ${handNumber} posts fixed $5/$10 blinds and uses them for minimum wagers on every street`, async () => {
    const match: PokerMatch = {
      id: "levels", seed: "levels", requestedHands: 100, status: "running",
      createdAt: "", updatedAt: "", bankroll: { jev: 500, codex: 500 }, hands: [],
    };
    const previous = await playNextHand(match, { decideJev: passiveDecision, decideCodex: passiveDecision });
    // Resume at different hand numbers with equal stacks to isolate blind behavior.
    match.hands = Array.from({ length: handNumber - 1 }, (_, index) => ({ ...previous, number: index + 1 }));
    const contexts: PokerDecisionContext[] = [];
    const decide = async (context: PokerDecisionContext): Promise<PokerDecision> => {
      contexts.push(context);
      if (context.street === "preflop") return passiveDecision(context);
      const bet = context.legalActions.find((action) => action.action === "bet");
      return bet ? { action: "bet", amount: bet.minAmount, source: "model" } : passiveDecision(context);
    };
    const hand = await playNextHand(match, { decideJev: decide, decideCodex: decide });
    assert.deepEqual(hand.blinds, { small: 5, big: 10 });
    assert.deepEqual(contexts[0].streetContributions, handNumber % 2 ? { jev: 5, codex: 10 } : { jev: 10, codex: 5 });
    assert.equal(contexts[0].pot, 15);
    assert.deepEqual(contexts[0].bankroll, handNumber % 2 ? { jev: 495, codex: 490 } : { jev: 490, codex: 495 });
    assert.equal(contexts[0].legalActions.find((action) => action.action === "raise")?.minAmount, 20);
    for (const context of contexts) {
      assert.deepEqual(context.blinds, { small: 5, big: 10 });
      const bet = context.legalActions.find((action) => action.action === "bet");
      if (bet) assert.equal(bet.minAmount, 10);
      const raise = context.legalActions.find((action) => action.action === "raise");
      if (raise) assert.equal(raise.minAmount, 20);
    }
    assert.deepEqual(new Set(contexts.map((context) => context.street)), new Set(["preflop", "flop", "turn", "river"]));
    assert.equal(hand.bankroll.jev + hand.bankroll.codex, 1000);
  });
}

test("blinds exceeding the remaining stacks run out the board without losing chips", async () => {
  const match: PokerMatch = {
    id: "blind-all-in", seed: "blind-all-in", requestedHands: 1, status: "running",
    createdAt: "", updatedAt: "", bankroll: { jev: 1, codex: 3 }, hands: [],
  };
  const unexpectedDecision = async (): Promise<PokerDecision> => { throw new Error("Both players are already all-in"); };
  const hand = await playNextHand(match, { decideJev: unexpectedDecision, decideCodex: unexpectedDecision });
  assert.equal(hand.actions.length, 0);
  assert.equal(hand.pot, 2);
  assert.equal(hand.bankroll.jev + hand.bankroll.codex, 4);
  assert.ok(hand.bankroll.jev >= 0 && hand.bankroll.codex >= 0);
  assert.equal(visibleBoardAt(hand, -1, true).length, 5);
});

test("deck and seeded shuffle are deterministic", () => {
  assert.equal(makeDeck().length, 52);
  assert.deepEqual(shuffle(makeDeck(), rng("a")), shuffle(makeDeck(), rng("a")));
});

test("numeric rank comparison does not use lexicographic strings", () => {
  assert.equal(compareRanks([1, 14, 9, 8, 3], [1, 9, 8, 7, 2]), 1);
  assert.equal(bestRank(["As", "Ks", "9s", "4s", "2s", "3d", "7c"])[0], 5);
});

test("a completed hand records all nine dealt cards", async () => {
  const now = new Date().toISOString();
  const match: PokerMatch = {
    id: "test",
    seed: "fixed",
    requestedHands: 1,
    status: "ready",
    createdAt: now,
    updatedAt: now,
    bankroll: { jev: 500, codex: 500 },
    hands: [],
  };
  const hand = await playNextHand(match, { decideJev: passiveDecision, decideCodex: passiveDecision });
  assert.equal(hand.holeCards.jev.length, 2);
  assert.equal(hand.holeCards.codex.length, 2);
  assert.equal(hand.board.length, 5);
  assert.equal(new Set([...hand.holeCards.jev, ...hand.holeCards.codex, ...hand.board]).size, 9);
  assert.equal(hand.bankroll.jev + hand.bankroll.codex, 1000);
  assert.equal(hand.actions.filter((action) => action.actor === "codex").every((action) => action.source === "model"), true);
  assert.equal(hand.actions.filter((action) => action.actor === "jev").every((action) => action.source === "model"), true);
});

test("both players receive match progress and recent revealed hands", async () => {
  const now = new Date().toISOString();
  const match: PokerMatch = {
    id: "adaptive",
    seed: "strategy",
    requestedHands: 3,
    status: "running",
    createdAt: now,
    updatedAt: now,
    bankroll: { jev: 500, codex: 500 },
    hands: [],
  };
  const firstHand = await playNextHand(match, { decideJev: passiveDecision, decideCodex: passiveDecision });
  const contexts: PokerDecisionContext[] = [];
  const captureContext = async (context: PokerDecisionContext) => {
    contexts.push(context);
    return passiveDecision(context);
  };

  await playNextHand(
    { ...match, hands: [firstHand], bankroll: firstHand.bankroll },
    { decideJev: captureContext, decideCodex: captureContext },
  );

  const firstContext = contexts[0];
  assert.deepEqual(firstContext.matchProgress, { completedHands: 1, requestedHands: 3 });
  assert.equal(firstContext.recentHands.length, 1);
  assert.deepEqual(firstContext.recentHands[0].holeCards, firstHand.holeCards);
  assert.deepEqual(firstContext.recentHands[0].board, firstHand.board);
});

test("betting rounds expose every context-valid action and apply variable sizing", async () => {
  const now = new Date().toISOString();
  const match: PokerMatch = {
    id: "betting",
    seed: "full-actions",
    requestedHands: 1,
    status: "running",
    createdAt: now,
    updatedAt: now,
    bankroll: { jev: 500, codex: 500 },
    hands: [],
  };
  const contexts: PokerDecisionContext[] = [];
  const decide = async (context: PokerDecisionContext): Promise<PokerDecision> => {
    contexts.push(context);
    const streetActions = context.actionHistory.filter((action) => action.street === context.street);
    if (context.street === "preflop" && streetActions.length === 0) return { action: "raise", amount: 25, source: "model" };
    if (context.street === "preflop") return { action: "call", source: "model" };
    if (context.street === "flop" && streetActions.length === 0) return { action: "check", source: "model" };
    if (context.street === "flop" && streetActions.length === 1) return { action: "bet", amount: 15, source: "model" };
    return { action: "fold", source: "model" };
  };

  const hand = await playNextHand(match, { decideJev: decide, decideCodex: decide });

  assert.deepEqual(contexts[0].legalActions.map(({ action }) => action), ["fold", "call", "raise", "all_in"]);
  assert.deepEqual(contexts[1].legalActions.map(({ action }) => action), ["fold", "call", "raise", "all_in"]);
  assert.deepEqual(contexts[2].legalActions.map(({ action }) => action), ["check", "bet", "all_in"]);
  assert.deepEqual(contexts[4].legalActions.map(({ action }) => action), ["fold", "call", "raise", "all_in"]);
  assert.deepEqual(hand.actions.map(({ action, amount }) => [action, amount]), [
    ["raise", 20],
    ["call", 15],
    ["check", 0],
    ["bet", 15],
    ["fold", 0],
  ]);
  assert.equal(hand.winningHand, "Fold");
  assert.equal(hand.bankroll.jev + hand.bankroll.codex, 1000);
});

for (const [street, boardLength] of [["preflop", 0], ["flop", 3], ["turn", 4], ["river", 5]] as const) {
  test(`${street} folds keep opponent cards and undealt board out of both agents' history`, async () => {
    const match: PokerMatch = {
      id: "visibility", seed: "visibility", requestedHands: 2, status: "running",
      createdAt: "", updatedAt: "", bankroll: { jev: 500, codex: 500 }, hands: [],
    };
    const decide = async (context: PokerDecisionContext): Promise<PokerDecision> => {
      if (context.street !== street) return passiveDecision(context);
      return context.toCall > 0
        ? { action: "fold", source: "model" }
        : { action: "bet", amount: context.blinds.big, source: "model" };
    };
    const folded = await playNextHand(match, { decideJev: decide, decideCodex: decide });
    assert.equal(folded.winningHand, "Fold");
    const seen = new Set<string>();
    const capture = async (context: PokerDecisionContext) => {
      seen.add(context.actor);
      const history = context.recentHands[0];
      assert.deepEqual(history.holeCards, { [context.actor]: folded.holeCards[context.actor] });
      assert.deepEqual(history.board, folded.board.slice(0, boardLength));
      assert.ok(history.actions.every((action) => action.board.length <= boardLength));
      return passiveDecision(context);
    };
    await playNextHand({ ...match, hands: [folded], bankroll: folded.bankroll }, {
      decideJev: capture, decideCodex: capture,
    });
    assert.equal(seen.size, 2);
    assert.deepEqual(visibleBoardAt(folded, folded.actions.length - 1, true), folded.board.slice(0, boardLength));
    assert.equal(folded.board.length, 5);
  });
}

for (const street of ["preflop", "flop", "turn"] as const) {
  test(`${street} all-in reveals the full board only at settlement`, async () => {
    const match: PokerMatch = {
      id: "showdown", seed: "showdown", requestedHands: 1, status: "running",
      createdAt: "", updatedAt: "", bankroll: { jev: 500, codex: 500 }, hands: [],
    };
    const decide = async (context: PokerDecisionContext): Promise<PokerDecision> => {
      if (context.street !== street) return passiveDecision(context);
      return { action: context.legalActions.some(({ action }) => action === "all_in") ? "all_in" : "call", source: "model" };
    };
    const hand = await playNextHand(match, { decideJev: decide, decideCodex: decide });
    const lastIndex = hand.actions.length - 1;
    assert.deepEqual(visibleBoardAt(hand, -1, false), []);
    assert.deepEqual(visibleBoardAt(hand, lastIndex, false), hand.actions[lastIndex].board);
    assert.ok(hand.actions[lastIndex].board.length < 5);
    assert.deepEqual(visibleBoardAt(hand, lastIndex, true), hand.board);
    assert.equal(visibleBoardAt(hand, lastIndex, true).length, 5);
  });
}

test("all-in calls preserve chips and run directly to showdown", async () => {
  const now = new Date().toISOString();
  const match: PokerMatch = {
    id: "all-in",
    seed: "short-stack",
    requestedHands: 1,
    status: "running",
    createdAt: now,
    updatedAt: now,
    bankroll: { jev: 25, codex: 975 },
    hands: [],
  };
  const decide = async (context: PokerDecisionContext): Promise<PokerDecision> => {
    if (context.actor === "jev") return { action: "all_in", source: "model" };
    return { action: "call", source: "model" };
  };

  const hand = await playNextHand(match, { decideJev: decide, decideCodex: decide });

  assert.deepEqual(hand.actions.map(({ action, amount }) => [action, amount]), [["all_in", 20], ["call", 15]]);
  assert.equal(hand.pot, 50);
  assert.equal(hand.bankroll.jev + hand.bankroll.codex, 1000);
});
