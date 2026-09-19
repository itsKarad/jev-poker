import test from "node:test";
import assert from "node:assert/strict";
import { getJevSizingPlan, jevScoreToAmount } from "../lib/jev-sizing";
import type { LegalAction, PokerDecisionContext } from "../lib/types";

const context = (overrides: Partial<PokerDecisionContext> = {}): PokerDecisionContext => ({
  handNumber: 1,
  blinds: { small: 5, big: 10 },
  actor: "jev",
  opponent: "codex",
  matchProgress: { completedHands: 0, requestedHands: 50 },
  street: "flop",
  board: ["As", "7d", "2c"],
  holeCards: ["Kh", "Qh"],
  pot: 60,
  bankroll: { jev: 500, codex: 500 },
  streetContributions: { jev: 0, codex: 0 },
  currentBet: 0,
  toCall: 0,
  legalActions: [],
  actionHistory: [],
  recentHands: [],
  ...overrides,
});

test("Jev's postflop sizing anchors use meaningful pot fractions", () => {
  const legal: LegalAction = { action: "bet", minAmount: 10, maxAmount: 500 };
  const plan = getJevSizingPlan(context(), legal);

  assert.deepEqual(plan.targets, [10, 20, 30, 45, 500]);
  assert.equal(jevScoreToAmount(2, plan), 30);
  assert.equal(jevScoreToAmount(4, plan), 500);
});

test("Jev's preflop raise anchors scale from the current bet", () => {
  const legal: LegalAction = { action: "raise", minAmount: 35, maxAmount: 500 };
  const plan = getJevSizingPlan(context({ street: "preflop", currentBet: 25 }), legal);

  assert.deepEqual(plan.targets, [35, 63, 75, 100, 500]);
  assert.equal(jevScoreToAmount(2.5, plan), 88);
});

test("Jev's sizing stays inside the legal range when the stack is short", () => {
  const legal: LegalAction = { action: "bet", minAmount: 10, maxAmount: 27 };
  const plan = getJevSizingPlan(context(), legal);

  assert.deepEqual(plan.targets, [10, 20, 27, 27, 27]);
  assert.equal(jevScoreToAmount(-10, plan), 10);
  assert.equal(jevScoreToAmount(10, plan), 27);
});
