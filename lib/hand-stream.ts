import { playNextHand, type PlayerDeciders } from "./poker";
import type { HandStreamEvent, PokerMatch } from "./types";

export function streamNextHand(match: PokerMatch, deciders: PlayerDeciders, requestSignal: AbortSignal): Response {
  const cancellation = new AbortController();
  const signal = AbortSignal.any([requestSignal, cancellation.signal]);
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: HandStreamEvent) => {
        signal.throwIfAborted();
        controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
      };
      const heartbeat = setInterval(() => {
        if (!signal.aborted) controller.enqueue(encoder.encode("\n"));
      }, 15_000);
      try {
        if (match.hands.length >= match.requestedHands || match.bankroll.jev === 0 || match.bankroll.codex === 0) {
          send({ type: "complete", match: { ...match, status: "finished" }, hand: match.hands.at(-1) ?? null });
          return;
        }
        const hand = await playNextHand(match, deciders, { onEvent: send, signal });
        const hands = [...match.hands, hand];
        const updated: PokerMatch = {
          ...match, hands, bankroll: hand.bankroll,
          status: hands.length >= match.requestedHands || hand.bankroll.jev === 0 || hand.bankroll.codex === 0 ? "finished" : "running",
          updatedAt: new Date().toISOString(),
        };
        send({ type: "complete", match: updated, hand });
      } catch (error) {
        if (!signal.aborted) send({ type: "error", error: error instanceof Error ? error.message : "Could not play hand" });
      } finally {
        clearInterval(heartbeat);
        if (!cancellation.signal.aborted) controller.close();
      }
    },
    cancel() { cancellation.abort(); },
  });
  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      "X-Accel-Buffering": "no",
    },
  });
}
