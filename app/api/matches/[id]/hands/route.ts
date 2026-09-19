import { NextResponse } from "next/server";
import { streamNextHand } from "@/lib/hand-stream";
import { getCodexDecision } from "@/lib/codex-player";
import { getJevDecision } from "@/lib/jev-player";
import type { PokerMatch } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const body = await request.json() as { match?: PokerMatch };
    const match = body.match;
    if (!match || match.id !== id || !Array.isArray(match.hands)) {
      return NextResponse.json({ error: "Invalid match state" }, { status: 400 });
    }
    return streamNextHand(match, {
      decideJev: getJevDecision,
      decideCodex: getCodexDecision,
    }, request.signal);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not play hand" }, { status: 500 });
  }
}
