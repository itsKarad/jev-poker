import { isPokerAction, type LegalAction, type PokerDecision, type PokerDecisionContext } from "./types";
import { getPlayerModels } from "./player-models";
import { BANKROLL_STRATEGY } from "./poker-strategy";
import { getJevSizingPlan, jevScoreToAmount } from "./jev-sizing";

type JevResponse = {
  answers?: {
    action?: {
      choice?: string;
    };
    sizing?: {
      score?: number;
    };
  };
};

const RETRYABLE_STATUSES = new Set([429, 529]);

function wait(milliseconds: number) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

export async function getJevDecision(context: PokerDecisionContext, signal?: AbortSignal): Promise<PokerDecision> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) throw new Error("OPENROUTER_API_KEY is not configured");

  const model = getPlayerModels().jev.model;
  const describeAction = (legal: LegalAction) => {
    if (legal.action === "check") return "Continue without adding chips; legal only when nothing is owed.";
    if (legal.action === "fold") return "Surrender the hand rather than match the outstanding wager.";
    if (legal.action === "call") return `Match the wager by committing ${legal.amount} more chip${legal.amount === 1 ? "" : "s"}.`;
    if (legal.action === "all_in") return `Commit the entire remaining stack of ${legal.amount} chip${legal.amount === 1 ? "" : "s"}; this may be a bet, raise, or call.`;
    return `${legal.action === "bet" ? "Open the betting" : "Increase the outstanding wager"} to any integer street total from ${legal.minAmount} through ${legal.maxAmount}.`;
  };
  const aggressiveActions = context.legalActions.filter((legal) => legal.action === "bet" || legal.action === "raise");
  const sizingPlan = aggressiveActions[0] ? getJevSizingPlan(context, aggressiveActions[0]) : null;
  const body = {
    model,
    state: {
      role: "Jev playing heads-up Texas Hold'em",
      strategy: BANKROLL_STRATEGY,
      ...context,
    },
    questions: {
      action: {
        type: "choice",
        instructions: {
          question: "Which legal action best advances Jev's bankroll objective in this state?",
          method: "Choose only from the context-valid options in the criteria. Adapt between tight, conservative, loose, aggressive, and selective bluffing based on the supplied current and recent-hand evidence.",
          guardrail: "Maximize expected final profit, not action or bluff frequency. Never assume hidden cards or chase losses.",
        },
        criteria: Object.fromEntries(context.legalActions.map((legal) => [legal.action, describeAction(legal)])),
      },
      ...(aggressiveActions.length > 0 ? {
        sizing: {
          type: "score",
          instructions: "If choosing bet or raise, choose the target amount using these five poker-sized anchors. Score 0 selects the first anchor and score 4 selects the last. Intermediate scores interpolate between adjacent anchors. Optimize expected final bankroll; use larger sizes for value, protection, or credible pressure, and do not choose the maximum merely because it is available. This answer is ignored for other actions.",
          criteria: sizingPlan?.labels ?? [],
        },
      } : {}),
    },
  };

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const response = await fetch("https://openrouter.ai/api/alpha/decisions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "HTTP-Referer": process.env.OPENROUTER_SITE_URL || "http://localhost:3000",
        "X-OpenRouter-Title": process.env.OPENROUTER_APP_NAME || "Jev vs Codex Poker",
      },
      body: JSON.stringify(body),
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(30_000)]) : AbortSignal.timeout(30_000),
    });

    if (RETRYABLE_STATUSES.has(response.status) && attempt < 2) {
      await wait(300 * 2 ** attempt);
      continue;
    }
    if (!response.ok) {
      const detail = (await response.text()).slice(0, 500);
      throw new Error(`OpenRouter Jev request failed with HTTP ${response.status}${detail ? `: ${detail}` : ""}`);
    }

    const result = await response.json() as JevResponse;
    const action = result.answers?.action?.choice;
    if (!isPokerAction(action)) throw new Error(`OpenRouter Jev returned an illegal action: ${String(action)}`);
    const legal = context.legalActions.find((candidate) => candidate.action === action);
    if (!legal) {
      throw new Error(`OpenRouter Jev returned an illegal action: ${String(action)}`);
    }
    if (action === "bet" || action === "raise") {
      if (!("minAmount" in legal)) throw new Error(`OpenRouter Jev returned invalid sizing action: ${action}`);
      const score = result.answers?.sizing?.score;
      if (typeof score !== "number" || !Number.isFinite(score)) throw new Error("OpenRouter Jev did not return a wager size");
      const amount = jevScoreToAmount(score, getJevSizingPlan(context, legal));
      return { action, amount, source: "model" };
    }
    if (action === "check" || action === "call" || action === "fold" || action === "all_in") {
      return { action, source: "model" };
    }
    throw new Error(`OpenRouter Jev returned an unsupported action: ${action}`);
  }

  throw new Error("OpenRouter Jev retry limit reached");
}
