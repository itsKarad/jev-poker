# Jev vs Codex Poker

A local app for watching Jev and Codex play heads-up Texas Hold'em. Jev makes decisions through OpenRouter, and Codex uses your locally installed Codex CLI. The table streams each hand as it happens and saves match history in your browser.

## Requirements

- Node.js 20.9 or newer and npm.
- The Codex CLI installed, authenticated, and available as `codex` in your terminal.
- An OpenRouter API key with access to the Jev model.

The app runs on your computer. Both players need an internet connection to reach their model services. No database is required.

## Run locally

```bash
git clone https://github.com/itsKarad/jev-poker.git
cd jev-poker
npm ci
cp .env.example .env.local
```

Edit `.env.local` and set `OPENROUTER_API_KEY` to your key. Keep that file private; Git ignores it. Then start the app:

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) and start a match. Press Ctrl+C in the terminal to stop the server.

## Player settings

The Codex seat runs the locally installed and authenticated Codex CLI once per decision. It defaults to `gpt-5.6-luna` with medium reasoning. Override either setting in `.env.local` if needed:

```bash
CODEX_MODEL=gpt-5.6-luna
CODEX_REASONING_EFFORT=medium
```

If the `codex` command is missing, unauthenticated, or returns an invalid action, the match stops and shows the error. It does not silently replace Codex with a simulated player.

The Jev seat sends one typed Choice request per decision to OpenRouter's Decisions API. Copy `.env.example` to `.env.local` and provide `OPENROUTER_API_KEY`. `OPENROUTER_MODEL` defaults to OpenRouter's `~typesafe/jev-latest` alias. If OpenRouter fails or returns an illegal action, the match stops instead of substituting a simulated player.

## Live play

The table streams the deal and each action as it happens. The active agent has a live thinking timer; completed actions retain their measured decision times in the action log and saved history. Only the board revealed so far is streamed before settlement. Stop after hand finishes and saves the current hand before pausing. Replay remains a separate accelerated view.

## Persistence

Blinds start at $2/$4 and rise every six hands: $3/$6, $5/$10, $8/$16, $12/$24, $18/$36, $27/$54, $40/$80, then $60/$120 for hands 49–54. Later levels increase the small blind by 50%, rounded to a whole chip, with the big blind twice that amount. Minimum bets and raises follow the current big blind. Blind payments never exceed a player's remaining stack. Resumed matches use the schedule for their next hand; older saved hands retain their original $1/$2 display.

The app saves up to 20 matches in the browser after every hand. Each saved hand includes Jev's two cards, Codex's two cards, all five board cards, the action log, result, pot, and bankroll. Use the download button beside the match picker to export the current match as a JSON file.

Browser storage belongs to one browser profile and device. Clearing site data removes its saved matches, so export any history you want to keep as a file.

## Checks

```bash
npm run typecheck
npm test
npm run build
```

To run the production build locally after building:

```bash
npm start
```

This repository is intended for local use. There is no deployment workflow. `vercel.json` disables automatic Vercel deployments from Git pushes using [`git.deploymentEnabled`](https://vercel.com/docs/project-configuration/git-configuration).
