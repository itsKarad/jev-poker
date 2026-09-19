import test from "node:test";
import assert from "node:assert/strict";
import { streamNextHand } from "../lib/hand-stream";
import { readHandStream } from "../lib/read-hand-stream";
import type { HandStreamEvent, PokerDecision, PokerMatch } from "../lib/types";

function match(): PokerMatch {
  return { id: "stream", seed: "stream", requestedHands: 2, status: "ready", createdAt: "", updatedAt: "", bankroll: { jev: 500, codex: 500 }, hands: [] };
}

test("deal and thinking arrive before the model finishes, then actions and settlement", async () => {
  let answer!: (decision: PokerDecision) => void;
  const pending = new Promise<PokerDecision>((resolve) => { answer = resolve; });
  const response = streamNextHand(match(), {
    decideJev: () => pending,
    decideCodex: async () => { throw new Error("Should not act after fold"); },
  }, new AbortController().signal);
  const events = readHandStream(response);
  const deal = (await events.next()).value!;
  assert.equal(deal.type, "deal");
  if (deal.type !== "deal") throw new Error("Missing deal");
  assert.deepEqual(deal.hand.board, []);
  assert.equal(deal.hand.pot, 15);
  assert.deepEqual(deal.hand.bankroll, { jev: 495, codex: 490 });
  const thinking = (await events.next()).value!;
  assert.equal(thinking.type, "thinking");
  if (thinking.type !== "thinking") throw new Error("Missing thinking");
  assert.equal(thinking.actor, "jev");
  assert.equal(thinking.hand.actions.length, 0);
  answer({ action: "fold", source: "model" });
  const action = (await events.next()).value!;
  assert.equal(action.type, "action");
  if (action.type !== "action") throw new Error("Missing action");
  assert.equal(action.hand.actions[0].action, "fold");
  assert.ok(action.hand.actions[0].durationMs! >= 0);
  assert.equal(deal.hand.actions.length, 0, "Earlier events must remain immutable");
  const complete = (await events.next()).value!;
  assert.equal(complete.type, "complete");
  if (complete.type !== "complete") throw new Error("Missing settlement");
  assert.equal(complete.match.hands.length, 1);
  assert.equal(complete.match.bankroll.jev + complete.match.bankroll.codex, 1000);
  assert.equal((await events.next()).done, true);
});

test("model failure reaches the stream reader without recording a completed hand", async () => {
  const initial = match();
  const fail = async (): Promise<PokerDecision> => { throw new Error("Provider unavailable"); };
  const events: HandStreamEvent[] = [];
  await assert.rejects(async () => {
    for await (const event of readHandStream(streamNextHand(initial, { decideJev: fail, decideCodex: fail }, new AbortController().signal))) events.push(event);
  }, /Provider unavailable/);
  assert.deepEqual(events.map((event) => event.type), ["deal", "thinking"]);
  assert.equal(initial.hands.length, 0);
});

test("disconnect aborts the pending decision and prevents further model calls", async () => {
  let aborted!: () => void;
  const abortedPromise = new Promise<void>((resolve) => { aborted = resolve; });
  let calls = 0;
  const response = streamNextHand(match(), {
    decideJev: async (_context, signal) => {
      calls += 1;
      return new Promise((_resolve, reject) => {
        signal!.addEventListener("abort", () => { aborted(); reject(signal!.reason); }, { once: true });
      });
    },
    decideCodex: async () => { calls += 1; return { action: "check", source: "model" }; },
  }, new AbortController().signal);
  const reader = response.body!.getReader();
  await reader.read();
  await reader.cancel();
  await abortedPromise;
  assert.equal(calls, 1);
});

test("stream parser accepts fragmented UTF-8, heartbeat lines, and a final unterminated line", async () => {
  const terminal: HandStreamEvent = { type: "complete", match: { ...match(), seed: "♠", status: "finished" }, hand: null };
  const bytes = new TextEncoder().encode(`\n${JSON.stringify(terminal)}`);
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const byte of bytes) controller.enqueue(new Uint8Array([byte]));
      controller.close();
    },
  });
  const events = [];
  for await (const event of readHandStream(new Response(stream))) events.push(event);
  assert.deepEqual(events, [terminal]);
});

test("a truncated stream is reported as an interrupted hand", async () => {
  await assert.rejects(async () => {
    for await (const event of readHandStream(new Response("\n"))) void event;
  }, /before the hand finished/);
});
