<script lang="ts">
  import type { FixedFiveRoomMode, FixedFiveWorkerResultEntry } from '@hoop-rush/data-contracts';
  const SHOW_TICK_MS = 120;
  const DUEL_REVEAL_EVERY = 4;
  const SHARED_REVEAL_DIVISOR = 25;
  let {
    mode,
    progress = null,
    entries = [],
    selfId = 'p1',
  }: {
    mode: FixedFiveRoomMode;
    progress?: {
      completed: number;
      total: number;
    } | null;
    entries?: FixedFiveWorkerResultEntry[];
    selfId?: 'p1' | 'p2';
  } = $props();
  const isDuel = $derived(mode === 'duel');
  const total = $derived(progress?.total ?? (isDuel ? 7 : 161));
  let shownCount = $state(0);
  let spot = $state<'p1' | 'p2'>('p1');
  let duelTick = $state(0);
  $effect(() => {
    shownCount = 0;
    duelTick = 0;
  });
  $effect(() => {
    const target = entries.length;
    if (shownCount >= target) return;
    const step = isDuel
      ? 1
      : Math.max(2, Math.ceil(Math.max(target, total) / SHARED_REVEAL_DIVISOR));
    const timer = setInterval(() => {
      duelTick += 1;
      shownCount = Math.min(
        target,
        shownCount + (isDuel && duelTick % DUEL_REVEAL_EVERY !== 0 ? 0 : step),
      );
      if (shownCount >= entries.length) clearInterval(timer);
    }, SHOW_TICK_MS);
    return () => clearInterval(timer);
  });
  $effect(() => {
    const timer = setInterval(() => {
      spot = spot === 'p1' ? 'p2' : 'p1';
    }, 700);
    return () => clearInterval(timer);
  });
  const visible = $derived(entries.slice(0, shownCount));
  const completed = $derived(shownCount);
  const pct = $derived(Math.min(100, (completed / Math.max(1, total)) * 100));
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

<div
  class="overflow-hidden rounded-2xl border border-line-strong bg-card shadow-[0_0_32px_hsl(13_100%_62%/0.14)]"
>
  <div class="flex items-center justify-between gap-3 border-b border-border/60 px-4 py-3 sm:px-5">
    <p class="font-display text-sm font-extrabold tracking-widest uppercase">
      {#if mode === 'duel'}Duel · Best of 7{:else if mode === 'sandbox-shared-82'}Sandbox · Shared
        82{:else}Classic · Shared 82{/if}
    </p>
    <span class="live-pill" role="status">
      <span class="live-dot" aria-hidden="true"></span> SIMMING
    </span>
  </div>

  <div class="px-4 py-4 sm:px-5">
    {#if isDuel}
      <div class="showdown-duel">
        <div class="duel-lane {spot === 'p1' ? 'duel-lane--spot' : ''}">
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
        <div class="duel-lane {spot === 'p2' ? 'duel-lane--spot' : ''}">
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
        {spot === selfId ? 'Your ball…' : "Opponent's ball…"}
      </p>
    {:else}
      <div class="showdown-grid">
        {#each ['p1', 'p2'] as const as pid (pid)}
          {@const wins = pid === 'p1' ? sharedLive.p1Wins : sharedLive.p2Wins}
          {@const diff = pid === 'p1' ? sharedLive.p1Diff : sharedLive.p2Diff}
          <div
            class="showdown-lane rounded-xl border p-3 {pid === selfId
              ? 'border-primary/50 bg-primary/5'
              : 'border-line-soft bg-surface-1'} {spot === pid ? 'showdown-lane--spot' : ''}"
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
      <p class="mt-3 text-xs text-muted-foreground" role="status">
        Warming the worker… games stream in batches of 4.
      </p>
    {/if}
    <p class="mt-3 text-[11px] text-muted-foreground">
      Every game validated. H2H simulates once and mirrors into both records.
    </p>
  </div>
</div>

<style>
  .live-pill {
    display: inline-flex;
    align-items: center;
    gap: 0.4rem;
    border-radius: 999px;
    border: 1px solid color-mix(in srgb, var(--color-primary) 45%, transparent);
    background: color-mix(in srgb, var(--color-primary) 12%, transparent);
    color: var(--color-primary);
    font-family: var(--font-mono);
    font-size: 10px;
    font-weight: 800;
    letter-spacing: 0.16em;
    padding: 0.25rem 0.65rem;
  }
  .live-dot {
    width: 0.5rem;
    height: 0.5rem;
    border-radius: 999px;
    background: currentColor;
    animation: live-pulse 1.2s ease-in-out infinite;
  }
  .showdown-duel {
    position: relative;
    display: flex;
    align-items: stretch;
    justify-content: center;
    gap: 1rem;
  }
  .duel-lane {
    flex: 1;
    max-width: 12rem;
    text-align: center;
    border-radius: 1rem;
    border: 1px solid transparent;
    padding: 0.5rem 0.25rem;
    transition:
      border-color 0.3s ease,
      background 0.3s ease;
  }
  .duel-lane--spot {
    border-color: color-mix(in srgb, var(--color-primary) 55%, transparent);
    background: color-mix(in srgb, var(--color-primary) 8%, transparent);
  }
  .showdown-grid {
    position: relative;
    display: grid;
    gap: 0.75rem;
  }
  @media (min-width: 640px) {
    .showdown-grid {
      grid-template-columns: 1fr 1fr;
    }
  }
  .showdown-lane {
    transition:
      border-color 0.3s ease,
      box-shadow 0.3s ease;
  }
  .showdown-lane--spot {
    box-shadow: 0 0 0 2px color-mix(in srgb, var(--color-primary) 45%, transparent);
  }
  .vs-puck {
    align-self: center;
    display: grid;
    place-items: center;
    flex-shrink: 0;
    width: 2.5rem;
    height: 2.5rem;
    border-radius: 999px;
    background: var(--color-primary);
    color: var(--color-primary-foreground);
    font-family: var(--font-display);
    font-size: 12px;
    font-weight: 800;
    animation: vs-slide 1.4s ease-in-out infinite alternate;
  }
  .vs-puck--grid {
    position: absolute;
    left: 50%;
    top: 50%;
    transform: translate(-50%, -50%);
  }
  .vs-puck--grid {
    animation: vs-nudge 1.4s ease-in-out infinite alternate;
  }
  .race-fill {
    transition: width 0.25s ease;
  }
  .sim-bar {
    height: 0.65rem;
    overflow: hidden;
    border-radius: 999px;
    background: var(--color-muted);
  }
  .sim-bar-fill {
    height: 100%;
    border-radius: 999px;
    background: linear-gradient(
      90deg,
      var(--color-primary),
      color-mix(in srgb, var(--color-primary) 55%, white)
    );
    background-size: 200% 100%;
    animation: sim-shimmer 1.4s linear infinite;
    transition: width 0.25s ease;
  }
  .duel-dot {
    display: grid;
    place-items: center;
    width: 2rem;
    height: 2rem;
    border-radius: 999px;
    border: 1px solid var(--color-border);
    background: var(--color-surface-1);
    font-family: var(--font-mono);
    font-size: 11px;
    font-weight: 800;
    color: var(--color-muted-foreground);
  }
  .duel-dot--win {
    border-color: color-mix(in srgb, var(--color-primary) 60%, transparent);
    background: color-mix(in srgb, var(--color-primary) 16%, transparent);
    color: var(--color-primary);
    animation: dot-pop 0.3s ease both;
  }
  .duel-dot--loss {
    border-color: color-mix(in srgb, var(--color-destructive) 55%, transparent);
    background: color-mix(in srgb, var(--color-destructive) 12%, transparent);
    color: var(--color-destructive);
    animation: dot-pop 0.3s ease both;
  }
  .ticker-card {
    display: flex;
    flex-direction: column;
    gap: 2px;
    border-radius: 0.75rem;
    border: 1px solid var(--color-border);
    background: var(--color-surface-1);
    padding: 0.6rem 0.75rem;
    animation: ticker-in 0.28s ease both;
  }
  .ticker-card--win {
    border-color: color-mix(in srgb, var(--color-primary) 50%, transparent);
  }
  .ticker-card--loss {
    border-color: color-mix(in srgb, var(--color-destructive) 40%, transparent);
  }
  @keyframes live-pulse {
    0%,
    100% {
      opacity: 1;
      transform: scale(1);
    }
    50% {
      opacity: 0.45;
      transform: scale(0.8);
    }
  }
  @keyframes sim-shimmer {
    from {
      background-position: 200% 0;
    }
    to {
      background-position: -200% 0;
    }
  }
  @keyframes dot-pop {
    from {
      transform: scale(1.35);
    }
    to {
      transform: scale(1);
    }
  }
  @keyframes ticker-in {
    from {
      opacity: 0;
      transform: translateY(6px);
    }
    to {
      opacity: 1;
      transform: translateY(0);
    }
  }
  @keyframes vs-slide {
    from {
      transform: translateX(-6px) scale(1);
    }
    to {
      transform: translateX(6px) scale(1.08);
    }
  }
  @keyframes vs-nudge {
    from {
      transform: translate(-58%, -50%) scale(1);
    }
    to {
      transform: translate(-42%, -50%) scale(1.08);
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .live-dot,
    .sim-bar-fill,
    .duel-dot--win,
    .duel-dot--loss,
    .ticker-card,
    .vs-puck {
      animation: none;
    }
    .sim-bar-fill,
    .duel-lane,
    .showdown-lane,
    .race-fill {
      transition: none;
    }
  }
</style>
