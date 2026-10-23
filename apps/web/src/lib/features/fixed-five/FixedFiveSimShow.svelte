<script lang="ts">
  import type { FixedFiveRoomMode, FixedFiveWorkerResultEntry } from '@hoop-rush/data-contracts';
  import { arenaGameResult, arenaLeaderChange, arenaStreak } from '#lib/arena-sound.js';
  let {
    mode,
    progress = null,
    entries = [],
    selfId = 'p1',
    h2hPendingGame = null,
    h2hError = null,
    h2hSimulatingGame = null,
    onContinueH2H,
    onRetryH2H,
  }: {
    mode: FixedFiveRoomMode;
    progress?: {
      completed: number;
      total: number;
    } | null;
    entries?: FixedFiveWorkerResultEntry[];
    selfId?: 'p1' | 'p2';
    h2hPendingGame?: number | null;
    h2hError?: string | null;
    h2hSimulatingGame?: number | null;
    onContinueH2H?: () => void;
    onRetryH2H?: () => void;
  } = $props();
  const isDuel = $derived(mode === 'duel');
  const total = $derived(progress?.total ?? (isDuel ? 7 : 161));
  const visible = $derived(entries);
  const completed = $derived(visible.length);
  const pct = $derived(Math.min(100, (completed / Math.max(1, total)) * 100));
  let lastSoundFor = $state(0);
  $effect(() => {
    if (visible.length <= lastSoundFor) {
      lastSoundFor = visible.length;
      return;
    }
    const latest = visible[visible.length - 1];
    if (latest) {
      const g = latest.game;
      let won: boolean | null = null;
      if (latest.tag === 'h2h') won = selfId === 'p1' ? g.winner === 'home' : g.winner === 'away';
      else if (latest.tag === selfId) won = g.winner === 'home';
      else if (latest.tag === 'duel') {
        const homeIsSelf = g.home.teamId === selfId;
        won = homeIsSelf ? g.winner === 'home' : g.winner === 'away';
      }
      if (won !== null) arenaGameResult(won);
    }
    lastSoundFor = visible.length;
  });
  const streak = $derived.by((): { side: 'you' | 'opp' | null; count: number } => {
    let side: 'you' | 'opp' | null = null;
    let count = 0;
    for (let i = visible.length - 1; i >= 0; i--) {
      const entry = visible[i];
      if (!entry) continue;
      const g = entry.game;
      let won: boolean | null = null;
      if (entry.tag === 'h2h') won = selfId === 'p1' ? g.winner === 'home' : g.winner === 'away';
      else if (entry.tag === selfId) won = g.winner === 'home';
      else if (entry.tag === 'duel') {
        const homeIsSelf = g.home.teamId === selfId;
        won = homeIsSelf ? g.winner === 'home' : g.winner === 'away';
      } else continue;
      const s = won ? 'you' : 'opp';
      if (side === null) {
        side = s;
        count = 1;
      } else if (side === s) count += 1;
      else break;
    }
    return { side, count };
  });
  const bottomLine = $derived.by(() =>
    visible.map((entry) => {
      const g = entry.game;
      return `${entry.tag === 'h2h' ? 'H2H' : entry.tag.toUpperCase()} G${g.gameNumber} ${g.home.box.points}-${g.away.box.points}${g.winner === 'home' ? ' H' : ' A'}`;
    }),
  );
  const momentum = $derived.by(() => {
    if (isDuel) return duelScore.p1 - duelScore.p2;
    return sharedLive.p1Diff - sharedLive.p2Diff;
  });
  let lastStreakSoundKey = $state<string | null>(null);
  $effect(() => {
    const current = streak;
    if (current.side === null || current.count < 3) return;
    const key = `${current.side}:${current.count}`;
    if (lastStreakSoundKey === key) return;
    if (current.count === 3 || current.count % 5 === 0) {
      lastStreakSoundKey = key;
      try {
        arenaStreak(current.count);
      } catch {}
    }
  });
  let lastMomentumSign = $state(0);
  $effect(() => {
    const sign = momentum > 0 ? 1 : momentum < 0 ? -1 : 0;
    if (lastMomentumSign === 0) {
      lastMomentumSign = sign;
      return;
    }
    if (sign !== 0 && sign !== lastMomentumSign) {
      lastMomentumSign = sign;
      try {
        arenaLeaderChange();
      } catch {}
    } else if (sign !== 0) {
      lastMomentumSign = sign;
    }
  });
  interface DuelDot {
    winner: 'p1' | 'p2' | null;
  }
  const duelDots = $derived.by((): DuelDot[] => {
    const dots: DuelDot[] = Array.from({ length: 7 }, () => ({ winner: null }));
    visible.forEach((entry, i) => {
      if (entry.tag !== 'duel' || i >= 7) return;
      const game = entry.game;
      const homeIsP1 = game.home.teamId === 'p1';
      const p1Won = (game.winner === 'home') === homeIsP1;
      dots[i] = { winner: p1Won ? 'p1' : 'p2' };
    });
    return dots;
  });
  const duelScore = $derived.by(() => {
    let p1 = 0;
    let p2 = 0;
    for (const d of duelDots) {
      if (d.winner === 'p1') p1 += 1;
      if (d.winner === 'p2') p2 += 1;
    }
    return { p1, p2 };
  });
  const sharedLive = $derived.by(() => {
    let p1Wins = 0;
    let p2Wins = 0;
    let p1Diff = 0;
    let p2Diff = 0;
    let h2hP1 = 0;
    let h2hP2 = 0;
    for (const entry of visible) {
      const g = entry.game;
      const diff = g.home.box.points - g.away.box.points;
      if (entry.tag === 'p1') {
        if (g.winner === 'home') p1Wins += 1;
        p1Diff += diff;
      } else if (entry.tag === 'p2') {
        if (g.winner === 'home') p2Wins += 1;
        p2Diff += diff;
      } else if (entry.tag === 'h2h') {
        if (g.winner === 'home') {
          p1Wins += 1;
          h2hP1 += 1;
        } else {
          p2Wins += 1;
          h2hP2 += 1;
        }
        p1Diff += diff;
        p2Diff -= diff;
      }
    }
    return { p1Wins, p2Wins, p1Diff, p2Diff, h2hP1, h2hP2 };
  });
  const ticker = $derived.by(() => {
    return [...visible]
      .slice(-3)
      .reverse()
      .map((entry) => {
        const g = entry.game;
        const home = g.home.box.points;
        const away = g.away.box.points;
        let youWon: boolean | null = null;
        let label = '';
        if (entry.tag === 'h2h') {
          youWon = selfId === 'p1' ? g.winner === 'home' : g.winner === 'away';
          label = `H2H G${g.gameNumber}`;
        } else if (entry.tag === 'p1' || entry.tag === 'p2') {
          const mine = entry.tag === selfId;
          youWon = mine ? g.winner === 'home' : null;
          label = mine ? `G${g.gameNumber}` : `OPP G${g.gameNumber}`;
        } else {
          youWon = null;
          label = `G${g.gameNumber}`;
        }
        const opponent = entry.tag === 'h2h' ? 'H2H' : (g.away.displayName ?? 'OPP');
        return {
          label,
          score: `${home}–${away}`,
          youWon,
          opponent,
          key: `${entry.tag}-${g.gameNumber}`,
        };
      });
  });
  function laneName(id: 'p1' | 'p2'): string {
    return id === selfId ? 'YOU' : 'OPP';
  }
</script>

<div class="broadcast overflow-hidden rounded-xl border border-line-strong bg-card">
  <div class="scorebug">
    <span class="scorebug-team scorebug-team--you">
      <span class="scorebug-abbr">YOU</span>
      <span class="scorebug-num"
        >{isDuel
          ? selfId === 'p1'
            ? duelScore.p1
            : duelScore.p2
          : selfId === 'p1'
            ? sharedLive.p1Wins
            : sharedLive.p2Wins}</span
      >
    </span>
    <span class="scorebug-mid">
      <span class="live-pill" role="status">
        <span class="live-dot" aria-hidden="true"></span>
        {completed}/{total}
      </span>
      {#if streak.side && streak.count >= 2}
        <span class="streak" role="status"
          >{streak.side === 'you' ? 'W' : 'L'}{streak.count} streak</span
        >
      {/if}
    </span>
    <span class="scorebug-team scorebug-team--opp">
      <span class="scorebug-num"
        >{isDuel
          ? selfId === 'p1'
            ? duelScore.p2
            : duelScore.p1
          : selfId === 'p1'
            ? sharedLive.p2Wins
            : sharedLive.p1Wins}</span
      >
      <span class="scorebug-abbr">OPP</span>
    </span>
  </div>
  <div class="flex items-center justify-between gap-3 border-b border-border/60 px-4 py-2 sm:px-5">
    <p class="font-display text-sm font-extrabold tracking-widest uppercase">
      {#if mode === 'duel'}Duel · Best of 7{:else}Season · 82 games{/if}
    </p>
    <span class="font-mono text-[10px] tracking-[0.16em] text-muted-foreground uppercase">
      {pct.toFixed(0)}% of games revealed
    </span>
  </div>

  <div class="px-4 py-4 sm:px-5">
    {#if isDuel}
      <div class="showdown-duel">
        <div class="duel-lane">
          <p class="font-mono text-[10px] tracking-[0.16em] text-muted-foreground uppercase">
            {laneName('p1')}
          </p>
          <p
            class="font-display text-5xl font-extrabold tabular-nums sm:text-6xl"
            aria-live="polite"
          >
            {duelScore.p1}
          </p>
        </div>
        <div class="vs-puck" aria-hidden="true"><span>VS</span></div>
        <div class="duel-lane">
          <p class="font-mono text-[10px] tracking-[0.16em] text-muted-foreground uppercase">
            {laneName('p2')}
          </p>
          <p
            class="font-display text-5xl font-extrabold tabular-nums sm:text-6xl"
            aria-live="polite"
          >
            {duelScore.p2}
          </p>
        </div>
      </div>
      <ol class="mt-4 flex items-center justify-center gap-2" aria-label="Duel series progress">
        {#each duelDots as dot, i (i)}
          <li
            class="duel-dot {dot.winner === null
              ? ''
              : dot.winner === selfId
                ? 'duel-dot--win'
                : 'duel-dot--loss'}"
            title={dot.winner === null
              ? `Game ${i + 1} pending`
              : `Game ${i + 1}: ${dot.winner === selfId ? 'you' : 'opp'}`}
          >
            {#if dot.winner !== null}{dot.winner === selfId ? 'W' : 'L'}{:else}{i + 1}{/if}
          </li>
        {/each}
      </ol>
      <p class="mt-2 text-center font-mono text-[11px] text-muted-foreground" role="status">
        First to four wins the series.
      </p>
    {:else}
      <div class="showdown-grid">
        {#each ['p1', 'p2'] as const as pid (pid)}
          {@const wins = pid === 'p1' ? sharedLive.p1Wins : sharedLive.p2Wins}
          {@const diff = pid === 'p1' ? sharedLive.p1Diff : sharedLive.p2Diff}
          <div
            class="showdown-lane rounded-xl border p-3 {pid === selfId
              ? 'border-primary/50 bg-primary/5'
              : 'border-line-soft bg-surface-1'}"
          >
            <div class="flex items-baseline justify-between gap-2">
              <p class="font-mono text-[10px] tracking-[0.16em] text-muted-foreground uppercase">
                {laneName(pid)}
              </p>
              <p class="font-display text-3xl font-extrabold tabular-nums" aria-live="polite">
                {wins}<span class="text-base text-muted-foreground">W</span>
              </p>
            </div>
            <p class="mt-1 font-mono text-[11px] text-muted-foreground tabular-nums">
              Diff {diff >= 0 ? '+' : ''}{diff} · H2H {pid === 'p1'
                ? sharedLive.h2hP1
                : sharedLive.h2hP2}
            </p>
            <div class="mt-2 h-1.5 overflow-hidden rounded-full bg-muted" aria-hidden="true">
              <div
                class="race-fill h-full rounded-full bg-primary"
                style={`width: ${Math.min(100, (wins / 82) * 100)}%`}
              ></div>
            </div>
          </div>
        {/each}
        <div class="vs-puck vs-puck--grid" aria-hidden="true"><span>VS</span></div>
      </div>
    {/if}

    <div class="mt-4">
      <div class="flex items-baseline justify-between gap-2">
        <p class="font-mono text-xs text-muted-foreground tabular-nums" role="status">
          {completed}/{total} games
        </p>
        <p class="font-mono text-xs font-bold tabular-nums">{pct.toFixed(0)}%</p>
      </div>
      <div class="sim-bar mt-2" aria-hidden="true">
        <div class="sim-bar-fill" style={`width: ${pct}%`}></div>
      </div>
    </div>

    {#if h2hPendingGame !== null}
      <div
        class="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-primary/30 bg-primary/5 p-3"
      >
        <p class="text-sm text-muted-foreground" role="status">
          Head-to-head game {h2hPendingGame} is next. Continue when you’re ready.
        </p>
        {#if onContinueH2H}
          <button
            type="button"
            class="rounded-xl border border-primary/40 bg-primary/10 px-3 py-2 text-sm font-semibold"
            onclick={onContinueH2H}
          >
            Continue to head-to-head game
          </button>
        {/if}
      </div>
    {:else if h2hError || h2hSimulatingGame !== null}
      <div
        class={`mt-3 flex flex-wrap items-center justify-between gap-3 rounded-xl border p-3 ${
          h2hError ? 'border-destructive/30 bg-destructive/5' : 'border-line-soft bg-surface-1'
        }`}
      >
        {#if h2hError}
          <p class="text-sm text-destructive" role="alert">{h2hError}</p>
        {:else}
          <p class="text-sm text-muted-foreground" role="status">
            Preparing head-to-head game {h2hSimulatingGame}…
          </p>
        {/if}
        {#if onRetryH2H}
          <button
            type="button"
            class="rounded-xl border border-line-soft bg-card px-3 py-2 text-sm font-semibold"
            onclick={onRetryH2H}
          >
            Retry head-to-head game
          </button>
        {/if}
      </div>
    {/if}

    {#if ticker.length > 0}
      <ul class="mt-4 grid gap-2 sm:grid-cols-3" aria-label="Latest games">
        {#each ticker as t (t.key)}
          <li
            class="ticker-card {t.youWon === null
              ? ''
              : t.youWon
                ? 'ticker-card--win'
                : 'ticker-card--loss'}"
          >
            <span class="font-mono text-[10px] tracking-[0.12em] text-muted-foreground uppercase"
              >{t.label}</span
            >
            <span class="font-display text-lg font-extrabold tabular-nums">{t.score}</span>
            <span class="max-w-full truncate font-mono text-[10px] text-muted-foreground"
              >{t.opponent}</span
            >
          </li>
        {/each}
      </ul>
    {:else}
      <p class="mt-3 text-xs text-muted-foreground" role="status">Preparing your games…</p>
    {/if}
    <p class="mt-3 text-[11px] text-muted-foreground">
      Results appear as your games finish. The head-to-head games count toward both records.
    </p>
  </div>
  {#if bottomLine.length > 0}<details class="game-log">
      <summary>Game log · {completed} games</summary>
      <ol>
        {#each bottomLine as line, i (i)}<li>{line}</li>{/each}
      </ol>
    </details>{/if}
</div>

<style>
  .scorebug {
    display: flex;
    background: var(--color-surface-2);
    border-bottom: 1px solid var(--color-line-soft);
  }
  .scorebug-team {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 12px;
    padding: 20px 12px;
  }
  .scorebug-abbr {
    font-family: var(--font-mono);
    font-size: 10px;
    color: var(--color-muted-foreground);
    letter-spacing: 0.1em;
  }
  .scorebug-num {
    font-family: var(--font-display);
    font-weight: 800;
    font-size: 38px;
    line-height: 1;
    font-variant-numeric: tabular-nums;
  }
  .scorebug-team--you .scorebug-num {
    color: var(--color-primary);
  }
  .scorebug-mid {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 6px;
    padding: 14px;
  }
  .live-pill {
    display: flex;
    align-items: center;
    gap: 6px;
    font-family: var(--font-mono);
    font-size: 11px;
    color: var(--color-muted-foreground);
  }
  .live-dot {
    width: 5px;
    height: 5px;
    border-radius: 50%;
    background: var(--color-primary);
  }
  .streak {
    font-size: 10px;
    color: var(--color-accent);
  }
  .showdown-duel {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 20px;
    padding: 20px 0;
  }
  .duel-lane {
    flex: 1;
    max-width: 220px;
    text-align: center;
  }
  .duel-lane p:first-child {
    margin-bottom: 8px;
  }
  .vs-puck {
    font-family: var(--font-mono);
    font-size: 11px;
    color: var(--color-muted-foreground);
  }
  .vs-puck--grid {
    display: none;
  }
  .showdown-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 16px;
    padding: 10px 0;
  }
  .sim-bar {
    height: 5px;
    border-radius: 3px;
    overflow: hidden;
    background: var(--color-muted);
  }
  .sim-bar-fill {
    height: 100%;
    background: var(--color-primary);
    transition: width 250ms;
  }
  .duel-dot {
    display: grid;
    place-items: center;
    width: 30px;
    height: 30px;
    border-radius: 6px;
    background: var(--color-surface-2);
    border: 1px solid var(--color-line-soft);
    color: var(--color-muted-foreground);
    font-family: var(--font-mono);
    font-size: 11px;
  }
  .duel-dot--win {
    color: var(--color-positive);
    border-color: var(--color-positive);
  }
  .duel-dot--loss {
    color: var(--color-destructive);
    border-color: var(--color-destructive);
  }
  .ticker-card {
    display: flex;
    flex-direction: column;
    gap: 4px;
    padding: 14px;
    border: 1px solid var(--color-line-soft);
    border-radius: 8px;
    background: var(--color-surface-1);
  }
  .ticker-card--win {
    border-left: 3px solid var(--color-positive);
  }
  .ticker-card--loss {
    border-left: 3px solid var(--color-destructive);
  }
  .game-log {
    border-top: 1px solid var(--color-line-soft);
    padding: 16px 20px;
    font-size: 11px;
    color: var(--color-muted-foreground);
  }
  .game-log summary {
    cursor: pointer;
  }
  .game-log ol {
    max-height: 220px;
    overflow: auto;
    display: grid;
    gap: 7px;
    margin-top: 16px;
    font-family: var(--font-mono);
  }
  summary:focus-visible {
    outline: 2px solid var(--color-ring);
    outline-offset: 4px;
  }
  @media (max-width: 640px) {
    .showdown-grid {
      grid-template-columns: 1fr;
    }
    .scorebug-team {
      gap: 7px;
      padding: 16px 8px;
    }
    .scorebug-mid {
      padding: 8px;
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .sim-bar-fill {
      transition: none;
    }
  }
</style>
