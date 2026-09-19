# Jev vs Codex Poker

A local heads-up Texas Hold'em table where two model-backed players make every decision. Jev is called through OpenRouter's Decisions API. Codex runs through the locally installed Codex CLI. The app deals the cards, enforces the rules, streams the hand to the browser, and keeps a small local match archive. Neither player gets to peek at the other player's cards.

This is more interesting as a game engine than as a benchmark. The models get the same public betting state and their own hole cards, then have to manage a 500-chip stack over a match.

## Run it

You need Node.js 20.9 or later, npm, an authenticated `codex` command on your PATH, and an OpenRouter API key that can use the Jev model.

```bash
git clone https://github.com/itsKarad/jev-poker.git
cd jev-poker
npm ci
cp .env.example .env.local
```

Set `OPENROUTER_API_KEY` in `.env.local`, then start the app.

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000), choose 1 to 250 hands, and deal. Match history lives in browser storage, so it stays on that browser and disappears if you clear site data. The app retains the 20 most recent matches.

## How a hand works

Every match starts with Jev and Codex at 500 chips. The engine uses fixed $5/$10 blinds for every hand. The button alternates: Jev has it on odd-numbered hands, Codex on even-numbered hands. The button posts the $5 small blind and acts first before the flop. The big blind posts $10 and acts first after the flop.

Each hand deals two private cards to each player and five community cards. Betting runs through preflop, flop, turn, and river. The browser reveals the board as it becomes public: zero cards before the flop, then three, four, and five. If a player folds, the rest of the board and the opponent's cards stay hidden. If the action reaches showdown, the engine compares the best five-card hands from each player's seven cards and awards the pot. Ties split it, with the odd chip going to Codex.

Stacks can be shorter than a blind. In that case the engine posts only the chips available, runs out the board when both players are all-in, and refunds unmatched all-in chips. Chips are conserved across every hand.

### Actions the players can take

The engine computes legal actions from the current street, stack sizes, and amount owed. A model cannot invent a move outside this list.

| Situation | Legal choices |
| --- | --- |
| Nothing to call | `check`, and when stacks allow it, `bet` or `all_in` |
| Facing a bet | `fold`, `call`, `raise`, or `all_in` |
| Betting or raising | An integer target for this street, within the engine's supplied minimum and maximum |

A `bet` or `raise` amount is the player's total contribution on that street, not the extra chips put in now. The minimum opening bet is $10. A full raise must be at least the big blind, and later full raises must be at least as large as the previous full raise. Calls and blind payments are capped at the remaining stack.

## The two players

Both adapters receive a decision context with the current board, their own hole cards, stacks, pot, street contributions, amount to call, legal actions, prior actions, and up to eight recent hands. A folded hand only exposes to a player what that player could have known at the time.

Jev receives a typed choice request through OpenRouter. It selects an action, and, for a bet or raise, scores a size from minimum to maximum. The adapter converts that score to a legal integer target.

Codex receives the same game state in a prompt and returns JSON under [`codex-action.schema.json`](./codex-action.schema.json). It must provide an exact integer target for a bet or raise. Codex runs in a read-only, ephemeral CLI session and is told not to inspect the project or use tools.

When the Codex CLI emits public reasoning summaries, the app streams them in muted gray before the matching action, with elapsed decision time. These summaries stay with that action in saved history and replay. Some models or turns may emit none; the app does not expose a full private thinking trace. Summaries are excluded from both players' prompts because they can mention private cards. Interrupted decisions are labeled and never attached to a later action.

During a live match, click any completed hand in the hand ribbon to inspect it while the next hand continues in the background. The `Current hand` button returns the table to the active hand.

Small gray labels above the logos show the configured models and Codex reasoning effort. New hands retain these settings for replay; old hands without metadata show "Model not recorded."

The engine validates either response before it changes the hand. An unavailable service, malformed response, or illegal action stops the match with an error. There is no pretend opponent waiting in the wings.

Defaults and optional overrides belong in `.env.local`:

```bash
OPENROUTER_API_KEY=your-key
OPENROUTER_MODEL=~typesafe/jev-latest
CODEX_MODEL=gpt-5.6-luna
CODEX_REASONING_EFFORT=medium
```

The Codex adapter accepts `gpt-6-astra`, `gpt-5.6-sol`, `gpt-5.6-terra`, `gpt-5.6-luna`, and `gpt-5.5`. Reasoning effort can be `low`, `medium`, `high`, `xhigh`, or `max`. Invalid values fall back to the defaults.

## Code path

The flow is deliberately plain:

```text
Poker dashboard in the browser
  -> POST /api/matches creates a 500/500 match
  -> POST /api/matches/[id]/hands streams one hand as NDJSON
  -> playNextHand deals, requests decisions, validates actions, and settles the pot
  -> Jev adapter calls OpenRouter; Codex adapter starts the local CLI
  -> complete event returns the updated match
  -> dashboard saves it in localStorage and draws the next hand
```

The useful places to start are:

| File | What it owns |
| --- | --- |
| [`app/page.tsx`](./app/page.tsx) | Loads the dashboard and current model settings. |
| [`components/poker-dashboard.tsx`](./components/poker-dashboard.tsx) | Match controls, live table, replay, browser persistence, and stream consumption. |
| [`app/api/matches/route.ts`](./app/api/matches/route.ts) | Creates a fresh match. |
| [`app/api/matches/[id]/hands/route.ts`](./app/api/matches/%5Bid%5D/hands/route.ts) | Runs the next hand with the two live player adapters. |
| [`lib/hand-stream.ts`](./lib/hand-stream.ts) and [`lib/read-hand-stream.ts`](./lib/read-hand-stream.ts) | Write and read the newline-delimited event stream. |
| [`lib/poker.ts`](./lib/poker.ts) | Deck, deterministic shuffle, betting loop, legal moves, showdown, and payouts. |
| [`lib/types.ts`](./lib/types.ts) | Shared match, hand, action, and decision shapes. |
| [`lib/poker-blinds.ts`](./lib/poker-blinds.ts) | The fixed $5/$10 blind definition. |
| [`lib/poker-visibility.ts`](./lib/poker-visibility.ts) | Prevents folded or unrevealed cards from leaking into the UI or later decisions. |
| [`lib/jev-player.ts`](./lib/jev-player.ts) | OpenRouter request, retry handling, and Jev's size conversion. |
| [`lib/codex-player.ts`](./lib/codex-player.ts) | Read-only Codex CLI call and structured response checks. |
| [`lib/player-models.ts`](./lib/player-models.ts) | Environment-backed model selection and safe defaults. |
| [`tests/poker.test.ts`](./tests/poker.test.ts) | Rule tests for blinds, legal moves, all-ins, visibility, and chip conservation. |

`lib/poker-strategy.ts` supplies advice to the model prompts. Its blind guidance uses the same fixed $5/$10 definition as the engine.

## Checks

```bash
npm run typecheck
npm test
npm run build
```

Run `npm start` after a production build. This repository is set up for local play. `vercel.json` turns off automatic Vercel deployments from Git pushes.
