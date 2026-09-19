import type { PlayerId } from "./types";

export type PlayerModel = { model: string; reasoningEffort?: string };
export type PlayerModels = Record<PlayerId, PlayerModel>;

const allowedModels = new Set(["gpt-6-astra", "gpt-5.6-sol", "gpt-5.6-terra", "gpt-5.6-luna", "gpt-5.5"]);
const allowedEfforts = new Set(["low", "medium", "high", "xhigh", "max"]);

export function getPlayerModels(): PlayerModels {
  const model = process.env.CODEX_MODEL ?? "gpt-5.6-luna";
  const effort = process.env.CODEX_REASONING_EFFORT ?? "medium";
  return {
    codex: {
      model: allowedModels.has(model) ? model : "gpt-5.6-luna",
      reasoningEffort: allowedEfforts.has(effort) ? effort : "medium",
    },
    jev: { model: process.env.OPENROUTER_MODEL || "~typesafe/jev-latest" },
  };
}
