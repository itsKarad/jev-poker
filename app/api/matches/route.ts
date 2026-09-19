import { NextResponse } from "next/server";
import type { PokerMatch } from "@/lib/types";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const body = await request.json() as { hands?: number; seed?: string };
    const requestedHands = Math.max(1, Math.min(250, Math.floor(Number(body.hands) || 20)));
    const seed = String(body.seed || `match-${Date.now()}`).trim().slice(0, 80);
    const now = new Date().toISOString();
    const match: PokerMatch = {
      id: crypto.randomUUID(),
      seed,
      requestedHands,
      status: "ready",
      createdAt: now,
      updatedAt: now,
      bankroll: { jev: 500, codex: 500 },
      hands: [],
    };
    return NextResponse.json({ match }, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not create match" }, { status: 500 });
  }
}
