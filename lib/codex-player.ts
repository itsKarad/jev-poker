import { spawn } from "node:child_process";
import path from "node:path";
import { BANKROLL_STRATEGY } from "./poker-strategy";
import { isPokerAction, type PokerDecision, type PokerDecisionContext } from "./types";

const allowedModels = new Set(["gpt-6-astra", "gpt-5.6-sol", "gpt-5.6-terra", "gpt-5.6-luna", "gpt-5.5"]);
const allowedEfforts = new Set(["low", "medium", "high", "xhigh", "max"]);

function runCodex(args: string[], prompt: string, cwd: string, signal?: AbortSignal) {
  return new Promise<string>((resolve, reject) => {
    const child = spawn("codex", args, { cwd, signal, stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    const timeout = setTimeout(() => {
      child.kill("SIGTERM");
      reject(new Error("Codex did not answer within 180 seconds"));
    }, 180_000);
    child.stdout.setEncoding("utf8").on("data", (chunk: string) => { stdout += chunk; });
    child.stderr.setEncoding("utf8").on("data", (chunk: string) => { stderr += chunk; });
    child.once("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.once("close", (code) => {
      clearTimeout(timeout);
      if (code === 0) resolve(stdout);
      else reject(new Error(stderr.trim() || `Codex exited with status ${code}`));
    });
    child.stdin.end(prompt);
  });
}

export async function getCodexDecision(context: PokerDecisionContext, signal?: AbortSignal): Promise<PokerDecision> {
  const root = process.cwd();
  const requestedModel = process.env.CODEX_MODEL ?? "gpt-5.6-luna";
  const requestedEffort = process.env.CODEX_REASONING_EFFORT ?? "medium";
  const model = allowedModels.has(requestedModel) ? requestedModel : "gpt-5.6-luna";
  const effort = allowedEfforts.has(requestedEffort) ? requestedEffort : "medium";
  const prompt = [
    "You are Codex playing heads-up Texas Hold'em.",
    "Choose the legal action with the best expected effect on your final bankroll across the whole match. Every action in state.legalActions is available.",
    "Adapt dynamically between tight, conservative, loose, aggressive, and selective bluffing. Do not rotate styles on a schedule.",
    "Bluff only when its deception value and risk budget improve expected final profit; never bluff for variety or chase losses.",
    "Use recent revealed hands to exploit patterns, but never assume current hidden cards.",
    "Do not inspect files, run commands, browse, or invent hidden cards.",
    `Strategy policy: ${JSON.stringify(BANKROLL_STRATEGY)}`,
    "For bet or raise, return an integer amount meaning the target total committed on this street, within that action's minAmount and maxAmount. Return amount as null for every other action.",
    'Return only JSON, such as {"action":"check","amount":null}, {"action":"call","amount":null}, {"action":"fold","amount":null}, {"action":"all_in","amount":null}, {"action":"bet","amount":12}, or {"action":"raise","amount":24}.',
    `State: ${JSON.stringify(context)}`,
  ].join("\n");

  try {
    const stdout = await runCodex([
      "exec",
      "--ephemeral",
      "--skip-git-repo-check",
      "--ignore-rules",
      "--sandbox",
      "read-only",
      "--output-schema",
      path.join(root, "codex-action.schema.json"),
      "--color",
      "never",
      "-m",
      model,
      "-c",
      `model_reasoning_effort=${JSON.stringify(effort)}`,
      "-C",
      root,
      "-",
    ], prompt, root, signal);
    const value = JSON.parse(stdout.trim()) as { action?: string; amount?: number | null };
    if (!isPokerAction(value.action)) throw new Error(`Codex returned an illegal action: ${String(value.action)}`);
    const legal = context.legalActions.find((candidate) => candidate.action === value.action);
    if (!legal) {
      throw new Error(`Codex returned an illegal action: ${String(value.action)}`);
    }
    if (value.action === "bet" || value.action === "raise") {
      const amount = value.amount;
      if (!("minAmount" in legal) || typeof amount !== "number" || !Number.isInteger(amount) || amount < legal.minAmount || amount > legal.maxAmount) {
        throw new Error(`Codex returned an illegal ${value.action} amount: ${String(value.amount)}`);
      }
      return { action: value.action, amount, source: "model" };
    }
    if (value.action === "check" || value.action === "call" || value.action === "fold" || value.action === "all_in") {
      return { action: value.action, source: "model" };
    }
    throw new Error(`Codex returned an unsupported action: ${value.action}`);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`Local Codex CLI failed: ${detail}`);
  }
}
