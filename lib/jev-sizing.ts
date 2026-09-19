import type { LegalAction, PokerDecisionContext } from "./types";

export type JevSizingPlan = {
  targets: [number, number, number, number, number];
  labels: [string, string, string, string, string];
};

type SizingAction = Extract<LegalAction, { action: "bet" | "raise" }>;

function clamp(value: number, minimum: number, maximum: number) {
  return Math.max(minimum, Math.min(maximum, Math.round(value)));
}

function monotonicTargets(values: number[], legal: SizingAction): [number, number, number, number, number] {
  const targets = values.map((value) => clamp(value, legal.minAmount, legal.maxAmount));
  for (let index = 1; index < targets.length; index += 1) {
    targets[index] = Math.max(targets[index], targets[index - 1]);
  }
  targets[targets.length - 1] = legal.maxAmount;
  return targets as [number, number, number, number, number];
}

export function getJevSizingPlan(context: PokerDecisionContext, legal: SizingAction): JevSizingPlan {
  const bigBlind = context.blinds.big;
  const rawTargets = context.street === "preflop"
    ? context.currentBet === 0
      ? [legal.minAmount, bigBlind * 2, bigBlind * 2.5, bigBlind * 3, legal.maxAmount]
      : [legal.minAmount, context.currentBet * 2.5, context.currentBet * 3, context.currentBet * 4, legal.maxAmount]
    : legal.action === "bet"
      ? [legal.minAmount, context.pot * 0.33, context.pot * 0.5, context.pot * 0.75, legal.maxAmount]
      : [legal.minAmount, context.currentBet + context.pot * 0.33, context.currentBet + context.pot * 0.5, context.currentBet + context.pot * 0.75, legal.maxAmount];

  const targets = monotonicTargets(rawTargets, legal);
  const labels = context.street === "preflop"
    ? context.currentBet === 0
      ? [
        `Minimum legal target: ${targets[0]}`,
        `Small open, about 2 big blinds: ${targets[1]}`,
        `Standard open, about 2.5 big blinds: ${targets[2]}`,
        `Large open, about 3 big blinds: ${targets[3]}`,
        `Maximum legal target: ${targets[4]}`,
      ]
      : [
        `Minimum legal raise: ${targets[0]}`,
        `Smaller 3-bet, about 2.5 times the current bet: ${targets[1]}`,
        `Standard 3-bet, about 3 times the current bet: ${targets[2]}`,
        `Large 3-bet, about 4 times the current bet: ${targets[3]}`,
        `Maximum legal target: ${targets[4]}`,
      ]
    : legal.action === "bet"
      ? [
        `Minimum legal bet: ${targets[0]}`,
        `Small bet, about one-third pot: ${targets[1]}`,
        `Standard half-pot bet: ${targets[2]}`,
        `Large bet, about three-quarters pot: ${targets[3]}`,
        `Maximum legal target: ${targets[4]}`,
      ]
      : [
        `Minimum legal raise: ${targets[0]}`,
        `Small raise, about one-third pot added to the current bet: ${targets[1]}`,
        `Standard raise, about half pot added to the current bet: ${targets[2]}`,
        `Large raise, about three-quarters pot added to the current bet: ${targets[3]}`,
        `Maximum legal target: ${targets[4]}`,
      ];

  return { targets, labels: labels as JevSizingPlan["labels"] };
}

export function jevScoreToAmount(score: number, plan: JevSizingPlan) {
  const boundedScore = Math.max(0, Math.min(4, score));
  const lowerIndex = Math.min(3, Math.floor(boundedScore));
  const fraction = boundedScore - lowerIndex;
  return Math.round(plan.targets[lowerIndex] + fraction * (plan.targets[lowerIndex + 1] - plan.targets[lowerIndex]));
}
