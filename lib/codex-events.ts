export type CodexSummary = { id: string; text: string };

// Read the CLI's public JSONL events. Tool output and raw reasoning are never displayed.
export function createCodexEventReader(onSummary?: (summary: CodexSummary) => void) {
  let buffer = "";
  let message = "";
  let completed = false;
  const summaries = new Map<string, string>();
  function readLine(line: string) {
    if (!line.trim()) return;
    const event = JSON.parse(line);
    if (event.type === "turn.failed" || event.type === "error") {
      throw new Error(event.error?.message ?? event.message ?? "Codex turn failed");
    }
    if (event.type === "turn.completed") completed = true;
    const item = event.item;
    if (!item || !["item.updated", "item.completed"].includes(event.type)) return;
    if (item.type === "reasoning" && typeof item.id === "string" && typeof item.text === "string" && item.text.trim()) {
      if (summaries.get(item.id) !== item.text) {
        summaries.set(item.id, item.text);
        onSummary?.({ id: item.id, text: item.text });
      }
    }
    if (event.type === "item.completed" && item.type === "agent_message" && typeof item.text === "string") {
      message = item.text;
    }
  }
  return {
    push(chunk: string) {
      buffer += chunk;
      const lines = buffer.split("\n");
      buffer = lines.pop()!;
      for (const line of lines) readLine(line);
    },
    finish() {
      if (buffer.trim()) readLine(buffer);
      buffer = "";
      if (!completed || !message.trim()) throw new Error("Codex ended without a completed decision");
      return message;
    },
  };
}
