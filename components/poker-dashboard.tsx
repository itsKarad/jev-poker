"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CircleStop, Play, RotateCcw, Spade, Trophy } from "lucide-react";
import type { ActionRecord, LivePokerHand, MatchSummary, PlayerId, PokerHand, PokerMatch } from "@/lib/types";
import { visibleBoardAt } from "@/lib/poker-visibility";
import { BLINDS } from "@/lib/poker-blinds";
import { readHandStream } from "@/lib/read-hand-stream";

const STORAGE_KEY = "jev-poker:last-match";
const MATCHES_KEY = "jev-poker:matches";
const REPLAY_ACTION_MS = 145;

function readStoredMatches(): PokerMatch[] {
  try {
    const value = JSON.parse(localStorage.getItem(MATCHES_KEY) ?? "[]");
    return Array.isArray(value) ? value : [];
  } catch {
    return [];
  }
}

function asSummary(match: PokerMatch): MatchSummary {
  return { id: match.id, createdAt: match.createdAt, seed: match.seed, completedHands: match.hands.length };
}

function wait(milliseconds: number) {
  return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
}

function AgentLogo({ player }: { player: PlayerId }) {
  if (player === "jev") {
    return <span className="agent-logo jev-logo" aria-label="Jev"><b>J</b></span>;
  }
  return (
    <span className="agent-logo codex-logo" aria-label="Codex">
      <img src="https://raw.githubusercontent.com/lobehub/lobe-icons/refs/heads/master/packages/static-png/dark/codex-color.png" alt="" />
    </span>
  );
}

function PlayingCard({ code, hidden = false }: { code?: string; hidden?: boolean }) {
  if (hidden || !code) return <span className="card card-back" aria-label="Face-down card"><i /></span>;
  const rank = code[0] === "T" ? "10" : code[0];
  const suits: Record<string, { symbol: string; name: string; red: boolean }> = {
    c: { symbol: "♣", name: "clubs", red: false },
    d: { symbol: "♦", name: "diamonds", red: true },
    h: { symbol: "♥", name: "hearts", red: true },
    s: { symbol: "♠", name: "spades", red: false },
  };
  const suit = suits[code[1]];
  return (
    <span className={`card playing-card ${suit.red ? "red" : ""}`} aria-label={`${rank} of ${suit.name}`}>
      <b>{rank}</b><em>{suit.symbol}</em><strong>{suit.symbol}</strong>
    </span>
  );
}

function ThinkingTimer({ startedAt }: { startedAt: number }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 100);
    return () => window.clearInterval(timer);
  }, []);
  return <span>{(Math.max(0, now - startedAt) / 1000).toFixed(1)}s</span>;
}

function ThinkingBubble() {
  return <span className="thinking-bubble" aria-label="Thinking"><i /><i /><i /></span>;
}

function actionLabel(action: ActionRecord) {
  if (action.action === "bet") return action.amount ? `bets $${action.amount}` : "bets";
  if (action.action === "raise") return action.streetTotal !== undefined ? `raises to $${action.streetTotal}` : "raises";
  if (action.action === "call") return action.amount ? `calls $${action.amount}` : "calls";
  if (action.action === "fold") return "folds";
  if (action.action === "all_in") return action.amount ? `all-in $${action.amount}` : "all-in";
  return "checks";
}

function PlayerSeat({
  player,
  hand,
  bankroll,
  currentAction,
  winner,
  thinkingSince,
}: {
  player: PlayerId;
  hand: Pick<PokerHand, "id" | "holeCards"> | null;
  bankroll: number;
  currentAction: ActionRecord | null;
  winner: boolean;
  thinkingSince?: number;
}) {
  const playerAction = currentAction?.actor === player ? currentAction : null;
  return (
    <section className={`player-seat ${player} ${winner ? "is-winner" : ""}`}>
      <div className="seat-logo-wrap"><AgentLogo player={player} /></div>
      <div className="seat-stack"><strong>${bankroll}</strong><span>bankroll</span></div>
      <div className={`hole-cards ${playerAction?.action === "fold" ? "folded" : ""}`}>
        {hand ? hand.holeCards[player].map((card) => <PlayingCard code={card} key={card} />) : <><PlayingCard hidden /><PlayingCard hidden /></>}
      </div>
      {thinkingSince !== undefined && <span className="action-bubble"><ThinkingBubble /> Thinking <ThinkingTimer startedAt={thinkingSince} /></span>}
      {thinkingSince === undefined && playerAction && <span key={`${hand?.id}-${currentAction?.street}-${currentAction?.action}`} className={`action-bubble ${playerAction.action}`}>{actionLabel(playerAction)}{playerAction.durationMs !== undefined && ` · ${(playerAction.durationMs / 1000).toFixed(1)}s`}</span>}
      {winner && <span className="winner-badge"><Trophy size={14} /> winner</span>}
    </section>
  );
}

function BankrollRail({ match, handNumber }: { match: PokerMatch | null; handNumber: number }) {
  const points = [{ jev: 500, codex: 500 }, ...(match?.hands.slice(0, handNumber).map((hand) => hand.bankroll) ?? [])];
  const width = 620;
  const height = 58;
  const values = points.flatMap((point) => [point.jev, point.codex]);
  const min = Math.min(...values, 490) - 4;
  const max = Math.max(...values, 510) + 4;
  const x = (index: number) => 4 + index * (width - 8) / Math.max(1, points.length - 1);
  const y = (value: number) => 4 + (max - value) * (height - 8) / Math.max(1, max - min);
  const line = (player: PlayerId) => points.map((point, index) => `${x(index)},${y(point[player])}`).join(" ");
  return (
    <div className="bankroll-rail" aria-label="Bankroll throughout the match">
      <div className="rail-labels"><span><i className="jev-swatch" />${points.at(-1)?.jev}</span><small>bankroll</small><span><i className="codex-swatch" />${points.at(-1)?.codex}</span></div>
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Bankroll graph">
        <line x1="4" y1={y(500)} x2={width - 4} y2={y(500)} />
        <polyline points={line("jev")} className="jev-line" />
        <polyline points={line("codex")} className="codex-line" />
      </svg>
    </div>
  );
}

export function PokerDashboard() {
  const [matches, setMatches] = useState<MatchSummary[]>([]);
  const [match, setMatch] = useState<PokerMatch | null>(null);
  const [hands, setHands] = useState(20);
  const [running, setRunning] = useState(false);
  const [fetching, setFetching] = useState(false);
  const [liveHand, setLiveHand] = useState<LivePokerHand | null>(null);
  const [thinking, setThinking] = useState<{ actor: PlayerId; startedAt: number } | null>(null);
  const [stopRequested, setStopRequested] = useState(false);
  const [replaying, setReplaying] = useState(false);
  const [activeHand, setActiveHand] = useState<PokerHand | null>(null);
  const [actionIndex, setActionIndex] = useState(-1);
  const [error, setError] = useState<string | null>(null);
  const replayRun = useRef(0);
  const stopAfterHand = useRef(false);
  const activeRequest = useRef<AbortController | null>(null);
  useEffect(() => () => { activeRequest.current?.abort(); replayRun.current += 1; }, []);

  const saveMatch = useCallback((nextMatch: PokerMatch) => {
    const others = readStoredMatches().filter((item) => item.id !== nextMatch.id);
    const history = [nextMatch, ...others].slice(0, 20);
    localStorage.setItem(MATCHES_KEY, JSON.stringify(history));
    setMatches(history.map(asSummary));
  }, []);

  const openMatch = useCallback((id: string) => {
    const stored = readStoredMatches().find((item) => item.id === id);
    if (!stored) return;
    setMatch(stored);
    setActiveHand(stored.hands.at(-1) ?? null);
    setActionIndex((stored.hands.at(-1)?.actions.length ?? 0) - 1);
    localStorage.setItem(STORAGE_KEY, id);
  }, []);

  useEffect(() => {
    const history = readStoredMatches().map(asSummary);
    setMatches(history);
    const saved = localStorage.getItem(STORAGE_KEY);
    const id = saved && history.some((item) => item.id === saved) ? saved : history[0]?.id;
    if (id) openMatch(id);
  }, [openMatch]);

  const runMatch = async (initialMatch: PokerMatch) => {
    if (activeRequest.current) return;
    const controller = new AbortController();
    activeRequest.current = controller;
    stopAfterHand.current = false;
    setStopRequested(false);
    setError(null);
    setRunning(true);
    let nextMatch = initialMatch;
    try {
      while (!stopAfterHand.current && nextMatch.status !== "finished") {
        controller.signal.throwIfAborted();
        setActiveHand(null);
        setLiveHand(null);
        setActionIndex(-1);
        setFetching(true);
        const response = await fetch(`/api/matches/${nextMatch.id}/hands`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ match: nextMatch }),
          signal: controller.signal,
        });
        for await (const event of readHandStream(response)) {
          controller.signal.throwIfAborted();
          if (event.type === "complete") {
            nextMatch = event.match;
            setMatch(event.match);
            setActiveHand(event.hand);
            setActionIndex((event.hand?.actions.length ?? 0) - 1);
            setLiveHand(null);
            setThinking(null);
            setFetching(false);
            saveMatch(event.match);
          } else if (event.type !== "error") {
            setLiveHand(event.hand);
            setThinking(event.type === "thinking" ? { actor: event.actor, startedAt: event.startedAt } : null);
          }
        }
        if (!stopAfterHand.current && nextMatch.status !== "finished") await wait(1050);
      }
    } catch (reason) {
      if (!controller.signal.aborted) {
        setError(reason instanceof Error ? reason.message : "The match stopped unexpectedly");
      }
    } finally {
      if (activeRequest.current === controller) activeRequest.current = null;
      if (!controller.signal.aborted) {
        setThinking(null);
        setFetching(false);
        setRunning(false);
      }
    }
  };

  const startMatch = async () => {
    if (activeRequest.current) return;
    const controller = new AbortController();
    activeRequest.current = controller;
    replayRun.current += 1;
    setError(null);
    setMatch(null);
    setActiveHand(null);
    setLiveHand(null);
    setActionIndex(-1);
    setFetching(true);
    try {
      const response = await fetch("/api/matches", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ hands }),
        signal: controller.signal,
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Could not create match");
      controller.signal.throwIfAborted();
      setMatch(data.match);
      localStorage.setItem(STORAGE_KEY, data.match.id);
      saveMatch(data.match);
      activeRequest.current = null;
      void runMatch(data.match);
    } catch (reason) {
      activeRequest.current = null;
      if (!controller.signal.aborted) {
        setFetching(false);
        setError(reason instanceof Error ? reason.message : "Could not create match");
      }
    }
  };

  const replayMatch = async () => {
    if (!match?.hands.length) return;
    const run = replayRun.current + 1;
    replayRun.current = run;
    setRunning(false);
    setLiveHand(null);
    setReplaying(true);
    for (const hand of match.hands) {
      if (replayRun.current !== run) return;
      setActiveHand(hand);
      setActionIndex(-1);
      await wait(REPLAY_ACTION_MS);
      for (let index = 0; index < hand.actions.length; index += 1) {
        if (replayRun.current !== run) return;
        setActionIndex(index);
        await wait(REPLAY_ACTION_MS);
      }
      await wait(REPLAY_ACTION_MS * 2);
    }
    if (replayRun.current === run) setReplaying(false);
  };

  const resetTable = () => {
    replayRun.current += 1;
    setMatch(null);
    setActiveHand(null);
    setLiveHand(null);
    setThinking(null);
    setActionIndex(-1);
    setReplaying(false);
    setRunning(false);
    setError(null);
  };

  const currentAction = liveHand ? liveHand.actions.at(-1) ?? null : activeHand?.actions[actionIndex] ?? null;
  const handPosition = activeHand && match ? match.hands.findIndex((hand) => hand.id === activeHand.id) : -1;
  const previousBankroll = handPosition > 0 ? match?.hands[handPosition - 1].bankroll : { jev: 500, codex: 500 };
  const handResolved = Boolean(activeHand && actionIndex >= activeHand.actions.length - 1 && !fetching);
  const visibleBoard = liveHand?.board ?? visibleBoardAt(activeHand, actionIndex, handResolved);
  const displayedBankroll = liveHand?.bankroll ?? (fetching ? match?.bankroll : handResolved ? activeHand?.bankroll : previousBankroll);
  const showingWinner = Boolean(activeHand && handResolved);
  const visibleHandCount = activeHand
    ? Math.max(0, activeHand.number - (handResolved ? 0 : 1))
    : match?.hands.length ?? 0;
  const displayedHandNumber = liveHand?.number ?? (fetching ? (match?.hands.length ?? 0) + 1 : activeHand?.number ?? match?.hands.length ?? 0);
  const displayedBlinds = activeHand && !fetching
    ? activeHand.blinds ?? { small: 1, big: 2 }
    : BLINDS;
  const record = useMemo(() => match?.hands.slice(0, visibleHandCount).reduce((result, hand) => {
    if (hand.winner !== "tie") result[hand.winner] += 1;
    return result;
  }, { jev: 0, codex: 0 }) ?? { jev: 0, codex: 0 }, [match, visibleHandCount]);
  const isLive = running || fetching;
  const tableHand = liveHand ?? activeHand;

  return (
    <main className="poker-room">
      <header className="match-bar">
        <span className={`live-pill ${isLive ? "on" : ""}`}><i />{replaying ? "REPLAY · 5×" : isLive ? "LIVE" : match ? match.status === "finished" ? "MATCH COMPLETE" : "PAUSED" : "TABLE OPEN"}</span>
        <div className="match-details">
          {match && <span className="hand-counter">HAND {displayedHandNumber} / {match.requestedHands}</span>}
          <span className="hand-counter">BLINDS ${displayedBlinds.small} / ${displayedBlinds.big}</span>
        </div>
        {running && <button className="quiet-button" disabled={stopRequested} onClick={() => { stopAfterHand.current = true; setStopRequested(true); }}><CircleStop size={15} /> {stopRequested ? "stopping after hand" : "stop after hand"}</button>}
      </header>

      {error && <div className="error-banner" role="alert">{error}</div>}

      {!match && (
        <section className="match-setup" aria-label="Start a poker match">
          <div className="setup-mark"><Spade /></div>
          <label><span>Number of hands</span><input type="number" min="1" max="250" value={hands} onChange={(event) => setHands(Number(event.target.value))} /></label>
          <button className="deal-button" disabled={fetching} onClick={startMatch}><Play size={18} fill="currentColor" /> Deal the first hand</button>
        </section>
      )}

      {match && (
        <>
          <section className="arena" aria-live="polite">
            <PlayerSeat player="jev" hand={tableHand} bankroll={displayedBankroll?.jev ?? 500} currentAction={currentAction} winner={showingWinner && activeHand?.winner === "jev"} thinkingSince={thinking?.actor === "jev" ? thinking.startedAt : undefined} />

            <div className="table-stage">
              <div className="table-shadow" />
              <div className="poker-table">
                <div className="felt-line" />
                <div className="pot-stack"><span className="chips"><i /><i /><i /></span><small>POT</small><strong>${liveHand?.pot ?? (handResolved ? activeHand?.pot : currentAction?.pot) ?? 0}</strong></div>
                <div className="community-cards">
                  {Array.from({ length: 5 }, (_, index) => visibleBoard[index] ? <PlayingCard code={visibleBoard[index]} key={visibleBoard[index]} /> : <span className="card card-slot" key={index} />)}
                </div>
                <div className="table-status">
                  {thinking ? <><span>{liveHand?.street}</span> {thinking.actor === "jev" ? "Jev" : "Codex"} is thinking</> : handResolved ? activeHand?.winningHand : currentAction ? <><span>{currentAction.street}</span> {actionLabel(currentAction)}</> : fetching ? "Dealing cards…" : liveHand ? "Hand interrupted" : "Waiting for the deal"}
                </div>
              </div>
            </div>

            <PlayerSeat player="codex" hand={tableHand} bankroll={displayedBankroll?.codex ?? 500} currentAction={currentAction} winner={showingWinner && activeHand?.winner === "codex"} thinkingSince={thinking?.actor === "codex" ? thinking.startedAt : undefined} />
          </section>

          <section className="match-footer">
            {tableHand && <ol className="live-actions" aria-label="Actions and decision times">
              {(liveHand?.actions ?? activeHand?.actions.slice(0, actionIndex + 1) ?? []).map((action, index) => (
                <li key={`${tableHand.id}-${index}`}>
                  <span>{action.street} · {action.actor === "jev" ? "Jev" : "Codex"} {actionLabel(action)}</span>
                  {action.durationMs !== undefined && <time>{(action.durationMs / 1000).toFixed(1)}s</time>}
                </li>
              ))}
            </ol>}
            <div className="score-strip"><span><AgentLogo player="jev" /><b>{record.jev}</b></span><small>HANDS WON</small><span><b>{record.codex}</b><AgentLogo player="codex" /></span></div>
            <BankrollRail match={match} handNumber={visibleHandCount} />
            <div className="hand-ribbon" aria-label="Hand history">
              {match.hands.map((hand) => (
                <button key={hand.id} className={`${activeHand?.id === hand.id ? "active" : ""} ${hand.winner}`} disabled={isLive || replaying} onClick={() => { setLiveHand(null); setActiveHand(hand); setActionIndex(hand.actions.length - 1); }} aria-label={`Show hand ${hand.number}`}>
                  <span>{hand.number}</span><i>{hand.winner === "tie" ? "=" : hand.winner === "jev" ? "J" : "C"}</i>
                </button>
              ))}
            </div>
            {!isLive && !replaying && match.status === "finished" && (
              <div className="finished-actions">
                <button className="replay-button" onClick={replayMatch}><RotateCcw size={17} /> Replay at 5×</button>
                <button className="new-match-button" onClick={resetTable}>New match</button>
                {matches.length > 1 && <select aria-label="Open a recent match" value={match.id} onChange={(event) => openMatch(event.target.value)}>{matches.map((item) => <option key={item.id} value={item.id}>{new Date(item.createdAt).toLocaleDateString()} · {item.completedHands} hands</option>)}</select>}
              </div>
            )}
            {!isLive && !replaying && match.status !== "finished" && (
              <div className="finished-actions">
                <button className="replay-button" onClick={() => { if (match) void runMatch(match); }}><Play size={17} fill="currentColor" /> Resume match</button>
                <button className="new-match-button" onClick={resetTable}>New match</button>
              </div>
            )}
          </section>
        </>
      )}
    </main>
  );
}
