import test from "node:test";
import assert from "node:assert/strict";
import { markdownToHtml } from "../lib/markdown";

test("Codex markdown is rendered with safe inline and block markup", () => {
  const html = markdownToHtml("## **Call**\n\n- Keep the pot small\n- Use `position`\n\n[board](https://example.com) <script>alert(1)</script>");
  assert.match(html, /<h2><strong>Call<\/strong><\/h2>/);
  assert.match(html, /<ul><li>Keep the pot small<\/li><li>Use <code>position<\/code><\/li><\/ul>/);
  assert.match(html, /href="https:\/\/example\.com"/);
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.doesNotMatch(html, /<script>/);
});
