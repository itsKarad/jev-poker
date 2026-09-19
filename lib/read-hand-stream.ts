import type { HandStreamEvent } from "./types";

export async function* readHandStream(response: Response): AsyncGenerator<HandStreamEvent> {
  if (!response.ok) {
    const data = await response.json();
    throw new Error(data.error ?? "Could not play the next hand");
  }
  if (!response.body) throw new Error("The hand stream is unavailable");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let complete = false;
  try {
    while (true) {
      const { value, done } = await reader.read();
      buffer += decoder.decode(value, { stream: !done });
      const lines = buffer.split("\n");
      buffer = lines.pop()!;
      if (done && buffer.trim()) lines.push(buffer);
      for (const line of lines) {
        if (!line.trim()) continue;
        const event = JSON.parse(line) as HandStreamEvent;
        if (event.type === "error") throw new Error(event.error);
        if (event.type === "complete") complete = true;
        yield event;
      }
      if (done) break;
    }
    if (!complete) throw new Error("Connection ended before the hand finished. Resume to retry this hand.");
  } finally {
    await reader.cancel();
    reader.releaseLock();
  }
}
