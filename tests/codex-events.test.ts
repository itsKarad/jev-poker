import test from "node:test";
import assert from "node:assert/strict";
import { createCodexEventReader } from "../lib/codex-events";

const event = (type: string, item?: unknown) => JSON.stringify({ type, ...(item ? { item } : {}) }) + "\n";

test("CLI summary snapshots are streamed once per change, separately from the final decision", () => {
  const seen: string[] = [];
  const reader = createCodexEventReader(({ text }) => seen.push(text));
  const partial = event("item.updated", { id: "r0", type: "reasoning", text: "Considering a call." });
  reader.push(partial.slice(0, 21));
  assert.deepEqual(seen, []);
  reader.push(partial.slice(21));
  assert.deepEqual(seen, ["Considering a call."]);
  reader.push(event("item.completed", { id: "r0", type: "reasoning", text: "Considering a call." }));
  reader.push(event("item.completed", { id: "r1", type: "reasoning", text: "Calling keeps the pot small." }));
  reader.push(event("item.completed", { type: "command_execution", aggregated_output: "Do not display" }));
  reader.push(event("item.completed", { type: "raw_reasoning", text: "Do not display" }));
  reader.push(event("item.completed", { type: "agent_message", text: '{"action":"call","amount":null}' }));
  reader.push(event("turn.completed").trim());
  assert.equal(reader.finish(), '{"action":"call","amount":null}');
  assert.equal(seen.length, 2);
});

test("CLI failures and truncated output never produce a completed decision", () => {
  assert.throws(() => createCodexEventReader().push('{broken}\n'));
  assert.throws(() => createCodexEventReader().push(JSON.stringify({ type: "turn.failed", error: { message: "Unavailable" } }) + "\n"), /Unavailable/);
  const reader = createCodexEventReader();
  reader.push(event("item.completed", { type: "agent_message", text: '{"action":"fold"}' }));
  assert.throws(() => reader.finish(), /without a completed decision/);
});
