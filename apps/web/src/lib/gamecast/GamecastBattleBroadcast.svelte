<script lang="ts">
  import type { Snippet } from 'svelte';
  import { formatHavocClock, havocPeriodLabel } from '#lib/features/havoc/havoc-presentation.js';
  import type {
    GamecastBattleFeedLine,
    GamecastBattleVisibleState,
  } from '#lib/gamecast/gamecast-battle-playback.js';
  import { gamecastBattleLiveBoxFold } from '#lib/gamecast/gamecast-battle-view.js';
  import GamecastBattleBox from '#lib/gamecast/GamecastBattleBox.svelte';
  import { gamecastBattleAbilityLines } from '#lib/gamecast/gamecast-battle-playback.js';

  let {
    result,
    gameNumber = undefined,
    localSide,
    visible,
    feed,
    progress,
    minimal = false,
    theme = 'havoc',
    teamIdentity,
  }: {
    result: import('@hoop-rush/data-contracts').HavocBattleResult;
    gameNumber?: number;
    localSide: 'home' | 'away';
    visible: GamecastBattleVisibleState;
    feed: readonly GamecastBattleFeedLine[];
    progress: number;
    minimal?: boolean;
    theme?: 'havoc' | 'duel';
    teamIdentity?: Snippet<['home' | 'away']>;
  } = $props();

  let boxResult: import('@hoop-rush/data-contracts').HavocBattleResult | null = null;
  let boxFold: ReturnType<typeof gamecastBattleLiveBoxFold> | null = null;
  const boxes = $derived.by(() => {
    if (boxResult !== result || boxFold === null) {
      boxResult = result;
      boxFold = gamecastBattleLiveBoxFold(result);
    }
    return boxFold.boxesAt(visible);
  });
  const localBox = $derived(boxes.find((box) => box.side === localSide));
  const opponentBox = $derived(boxes.find((box) => box.side !== localSide));
  const complete = $derived(progress >= 1);
  const leader = $derived(
    localBox?.score === opponentBox?.score
      ? null
      : (localBox?.score ?? 0) > (opponentBox?.score ?? 0)
        ? 'local'
        : 'opponent',
  );
  const abilities = $derived(gamecastBattleAbilityLines(result, visible.events));
  const progressPct = $derived(
    Math.round(Math.min(1, Math.max(0, Number.isNaN(progress) ? 0 : progress)) * 100),
  );
  const recentFeed = $derived([...feed].slice(minimal ? -6 : -14).reverse());
  const lastFeed = $derived(feed.at(-1) ?? null);
  const periodLabel = $derived(havocPeriodLabel(lastFeed?.period ?? visible.period));
  const clockLabel = $derived(formatHavocClock(lastFeed?.clockSeconds ?? visible.clockSeconds));

  function feedPoints(points: number): string {
    return points > 0 ? `+${points}` : String(points);
  }
</script>

<section
  class="hm-broadcast"
  data-minimal={minimal}
  data-theme={theme}
  data-gamecast-battle-broadcast={gameNumber}
  aria-label={gameNumber === undefined ? 'Game broadcast' : `Game ${gameNumber} broadcast`}
>
  <header class="hm-scoreboard">
    <div class="hm-team" data-align="start" data-leading={leader === 'local'}>
      <span class="hm-team-label" data-side="local"
        >{#if teamIdentity}{@render teamIdentity(localSide)}{:else}You{/if}</span
      >
      {#if leader === 'local'}<span class="hm-leader">{complete ? 'Winner' : 'Leading'}</span>{/if}
      {#key localBox?.score}
        <span class="hm-score" data-negative={(localBox?.score ?? 0) < 0}
          >{localBox?.score ?? 0}</span
        >
      {/key}
      {#if localBox && localBox.bonusPoints !== 0}
        <span class="hm-team-bonus">Bonus {feedPoints(localBox.bonusPoints)}</span>
      {/if}
    </div>
    <div class="hm-center">
      <span class="hm-live" data-final={complete}>
        <span class="hm-live-dot" aria-hidden="true"></span>
        {complete ? 'Final' : 'Live'}
      </span>
      <span class="hm-clock" aria-live="polite">{periodLabel} · {clockLabel}</span>
      <span
        class="hm-progress"
        role="progressbar"
        aria-label="Broadcast progress"
        aria-valuemin="0"
        aria-valuemax="100"
        aria-valuenow={progressPct}
      >
        <span class="hm-progress-fill" style:width={`${progressPct}%`}></span>
      </span>
      <span class="hm-plays">{visible.events.length + visible.scoring.length} plays shown</span>
    </div>
    <div class="hm-team" data-align="end" data-leading={leader === 'opponent'}>
      <span class="hm-team-label" data-side="opponent"
        >{#if teamIdentity}{@render teamIdentity(
            localSide === 'home' ? 'away' : 'home',
          )}{:else}Opponent{/if}</span
      >
      {#if leader === 'opponent'}<span class="hm-leader">{complete ? 'Winner' : 'Leading'}</span
        >{/if}
      {#key opponentBox?.score}
        <span class="hm-score" data-negative={(opponentBox?.score ?? 0) < 0}
          >{opponentBox?.score ?? 0}</span
        >
      {/key}
      {#if opponentBox && opponentBox.bonusPoints !== 0}
        <span class="hm-team-bonus">Bonus {feedPoints(opponentBox.bonusPoints)}</span>
      {/if}
    </div>
  </header>

  {#if !minimal}
    <GamecastBattleBox {teamIdentity} {boxes} {localSide} {theme} />
  {/if}

  <section class="hm-feed" aria-label="Ability activations">
    <header class="hm-feed-head">
      <h3>Ability activations</h3>
      <span>{abilities.length} events</span>
    </header>
    {#if abilities.length === 0}
      <p class="hm-feed-empty">No ability activations yet.</p>
    {:else}
      <ol class="hm-feed-list" aria-live="polite">
        {#each [...abilities].reverse() as line (line.key)}
          <li
            class="hm-feed-line hm-ability-line"
            data-side={line.side === localSide ? 'local' : 'opponent'}
          >
            <span class="hm-feed-clock"
              >{havocPeriodLabel(line.period)} {formatHavocClock(line.clockSeconds)}</span
            >
            <span class="hm-feed-team"
              >{line.side === null ? 'Game' : line.side === localSide ? 'You' : 'Opp'}</span
            >
            <div class="hm-ability-detail">
              <strong>{line.ability}</strong><span>{line.summary}</span>
            </div>
          </li>
        {/each}
      </ol>
    {/if}
  </section>

  <section class="hm-feed" aria-label="Scoring feed">
    <header class="hm-feed-head">
      <h3>Scoring feed</h3>
      <span>{feed.length} scoring plays</span>
    </header>
    {#if recentFeed.length === 0}
      <p class="hm-feed-empty">Waiting for the first bucket…</p>
    {:else}
      <ol class="hm-feed-list" aria-live="polite">
        {#each recentFeed as line, index (line.key)}
          <li
            class="hm-feed-line"
            data-latest={index === 0}
            data-side={line.side === localSide ? 'local' : 'opponent'}
          >
            <span class="hm-feed-clock"
              >{havocPeriodLabel(line.period)} {formatHavocClock(line.clockSeconds)}</span
            >
            <span class="hm-feed-team">{line.side === localSide ? 'You' : 'Opp'}</span>
            <span class="hm-feed-summary">{line.summary}</span>
            <span class="hm-feed-points" data-negative={line.points < 0}
              >{feedPoints(line.points)}</span
            >
          </li>
        {/each}
      </ol>
    {/if}
  </section>
</section>

<style>
  .hm-broadcast[data-theme='duel'] {
    --broadcast-accent: var(--color-primary);
    --broadcast-opponent: hsl(212 90% 62%);
    --broadcast-muted: var(--color-muted-foreground);
    --broadcast-foreground: var(--color-foreground);
    --broadcast-border: var(--color-line-soft);
    --broadcast-card: var(--color-card);
    --broadcast-surface: var(--color-surface-2);
    --broadcast-inset: var(--color-surface-1);
    --broadcast-positive: var(--color-positive);
  }

  .hm-broadcast {
    display: grid;
    gap: 12px;
    min-width: 0;
  }
  .hm-scoreboard {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr);
    align-items: center;
    gap: 12px;
    padding: 16px 18px;
    border: 1px solid var(--broadcast-border, #465273);
    border-radius: 18px;
    background:
      radial-gradient(
        120% 150% at 0% 0%,
        color-mix(in srgb, var(--broadcast-accent, #679dff) 16%, transparent),
        transparent 55%
      ),
      radial-gradient(
        120% 150% at 100% 0%,
        color-mix(in srgb, var(--broadcast-opponent, hsl(212 90% 62%)) 14%, transparent),
        transparent 55%
      ),
      var(--broadcast-card, #20294c);
  }
  .hm-team {
    display: grid;
    gap: 2px;
    --team-color: var(--broadcast-opponent, hsl(212 90% 62%));
  }
  .hm-team[data-align='start'] {
    justify-items: start;
    --team-color: var(--broadcast-accent, #ffd782);
  }
  .hm-team[data-align='end'] {
    justify-items: end;
    text-align: right;
  }
  .hm-team-label {
    font-family: var(--font-mono);
    font-size: 10px;
    font-weight: 800;
    letter-spacing: 0.2em;
    text-transform: uppercase;
    color: color-mix(in srgb, var(--team-color) 55%, var(--broadcast-muted, #aab9db));
  }
  .hm-team[data-leading='true'] .hm-team-label {
    color: var(--team-color);
  }
  .hm-leader {
    color: var(--team-color);
    font-family: var(--font-mono);
    font-size: 10px;
  }
  .hm-score {
    font-family: var(--font-display);
    font-size: clamp(44px, 7vw, 72px);
    font-weight: 900;
    line-height: 0.95;
    font-variant-numeric: tabular-nums;
    animation: hm-score-pop 340ms cubic-bezier(0.22, 1, 0.36, 1);
  }
  .hm-team[data-leading='true'] .hm-score {
    color: var(--team-color);
    text-shadow: 0 0 30px color-mix(in srgb, var(--team-color) 35%, transparent);
  }
  .hm-team[data-leading='false'] .hm-score {
    color: var(--broadcast-foreground, #f2f4ff);
  }
  .hm-team[data-leading='false'] .hm-score[data-negative='true'] {
    color: var(--broadcast-opponent, hsl(212 90% 62%));
  }
  .hm-team[data-align='end'] .hm-score {
    color: var(--broadcast-opponent, hsl(212 90% 62%));
  }
  .hm-team-bonus {
    font-family: var(--font-mono);
    font-size: 10px;
    font-weight: 700;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--team-color);
  }
  .hm-center {
    display: grid;
    justify-items: center;
    gap: 6px;
    min-width: 0;
  }
  .hm-live {
    display: inline-flex;
    align-items: center;
    gap: 7px;
    padding: 4px 12px;
    border: 1px solid color-mix(in srgb, var(--broadcast-accent, #ffd782) 60%, transparent);
    border-radius: 999px;
    background: color-mix(in srgb, var(--broadcast-accent, #ffd782) 12%, transparent);
    color: var(--broadcast-accent, #ffd782);
    font-family: var(--font-mono);
    font-size: 10px;
    font-weight: 800;
    letter-spacing: 0.18em;
    text-transform: uppercase;
  }
  .hm-live[data-final='true'] {
    border-color: var(--broadcast-border, #465273);
    background: var(--broadcast-surface, #303c63);
    color: var(--broadcast-muted, #c1cae4);
  }
  .hm-live-dot {
    width: 6px;
    height: 6px;
    border-radius: 999px;
    background: currentcolor;
    animation: hm-pulse 1.4s ease-in-out infinite;
  }
  .hm-live[data-final='true'] .hm-live-dot {
    animation: none;
  }
  .hm-clock {
    font-family: var(--font-mono);
    font-size: 12px;
    font-weight: 700;
    color: var(--broadcast-foreground, #f2f4ff);
  }
  .hm-progress {
    display: block;
    width: 150px;
    max-width: 100%;
    height: 4px;
    overflow: hidden;
    border-radius: 999px;
    background: var(--broadcast-inset, #111831);
  }
  .hm-progress-fill {
    display: block;
    height: 100%;
    border-radius: inherit;
    background: linear-gradient(90deg, #679dff, var(--broadcast-opponent, hsl(212 90% 62%)));
  }
  .hm-broadcast[data-theme='duel'] .hm-progress-fill {
    background: linear-gradient(
      90deg,
      var(--broadcast-accent),
      color-mix(in srgb, var(--broadcast-accent) 55%, white)
    );
  }
  .hm-plays {
    font-family: var(--font-mono);
    font-size: 10px;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: var(--broadcast-muted, #aab9db);
  }
  .hm-feed {
    padding: 14px;
    border: 1px solid var(--broadcast-border, #465273);
    border-radius: 16px;
    background: var(--broadcast-card, #20294c);
  }
  .hm-feed-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 10px;
  }
  .hm-feed-head h3 {
    font-family: var(--font-display);
    font-size: 18px;
    font-weight: 800;
    letter-spacing: 0.04em;
    text-transform: uppercase;
  }
  .hm-feed-head span {
    font-family: var(--font-mono);
    font-size: 10px;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--broadcast-muted, #aab9db);
  }
  .hm-feed-list {
    display: grid;
    gap: 6px;
    max-height: 260px;
    margin: 0;
    padding: 0 4px 0 0;
    list-style: none;
    overflow: auto;
  }
  .hm-feed-line {
    display: grid;
    grid-template-columns: auto auto minmax(0, 1fr) auto;
    align-items: center;
    gap: 10px;
    padding: 8px 10px;
    border-left: 3px solid var(--broadcast-opponent, hsl(212 90% 62%));
    border-radius: 9px;
    background: var(--broadcast-surface, #303c63);
  }
  .hm-feed-line[data-side='local'] {
    border-left-color: var(--broadcast-accent, #ffd782);
  }
  .hm-feed-line[data-latest='true'] {
    background: color-mix(in srgb, var(--broadcast-surface, #303c63) 82%, white 7%);
  }
  .hm-feed-clock {
    font-family: var(--font-mono);
    font-size: 10px;
    font-weight: 700;
    font-variant-numeric: tabular-nums;
    color: var(--broadcast-muted, #aab9db);
  }
  .hm-feed-team {
    padding: 2px 8px;
    border-radius: 999px;
    background: color-mix(in srgb, var(--broadcast-opponent, hsl(212 90% 62%)) 16%, transparent);
    color: var(--broadcast-opponent, hsl(212 90% 62%));
    font-family: var(--font-mono);
    font-size: 9px;
    font-weight: 800;
    letter-spacing: 0.08em;
    text-transform: uppercase;
  }
  .hm-feed-line[data-side='local'] .hm-feed-team {
    background: color-mix(in srgb, var(--broadcast-accent, #ffd782) 16%, transparent);
    color: var(--broadcast-accent, #ffd782);
  }
  .hm-feed-summary {
    overflow: hidden;
    font-size: 12px;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .hm-ability-line {
    grid-template-columns: auto auto minmax(0, 1fr);
  }
  .hm-ability-detail {
    display: grid;
    gap: 3px;
    font-size: 12px;
    overflow-wrap: anywhere;
  }
  .hm-ability-detail strong {
    color: var(--broadcast-accent, #ffd782);
  }
  .hm-ability-line[data-side='opponent'] .hm-ability-detail strong {
    color: var(--broadcast-opponent, hsl(212 90% 62%));
  }
  .hm-feed-points {
    font-family: var(--font-display);
    font-size: 15px;
    font-weight: 900;
    color: var(--broadcast-positive, #8bceaf);
  }
  .hm-feed-points[data-negative='true'] {
    color: var(--broadcast-opponent, hsl(212 90% 62%));
  }
  .hm-feed-empty {
    font-size: 12px;
    color: var(--broadcast-muted, #c1cae4);
  }
  @keyframes hm-score-pop {
    0% {
      transform: scale(1);
      filter: brightness(1);
    }
    35% {
      transform: scale(1.07);
      filter: brightness(1.25);
    }
    100% {
      transform: scale(1);
      filter: brightness(1);
    }
  }
  @keyframes hm-pulse {
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
  @media (max-width: 700px) {
    .hm-scoreboard {
      gap: 8px;
      padding: 12px;
    }
    .hm-score {
      font-size: clamp(34px, 12vw, 52px);
    }
    .hm-plays {
      display: none;
    }
    .hm-progress {
      width: 90px;
    }
    .hm-feed-line {
      grid-template-columns: auto auto minmax(0, 1fr);
    }
    .hm-feed-points {
      grid-column: 3;
      justify-self: end;
    }
  }
  @media (max-width: 480px) {
    .hm-scoreboard {
      grid-template-columns: minmax(0, 1fr) 76px minmax(0, 1fr);
      gap: 6px;
      padding: 12px 8px;
    }
    .hm-team {
      min-width: 0;
    }
    .hm-team-label {
      max-width: 100%;
      overflow-wrap: anywhere;
      font-size: 9px;
      letter-spacing: 0.1em;
    }
    .hm-clock {
      font-size: 10px;
      white-space: nowrap;
    }
    .hm-team[data-align='start'],
    .hm-team[data-align='end'] {
      justify-items: center;
      text-align: center;
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .hm-score,
    .hm-live-dot {
      animation: none;
    }
  }
  .hm-broadcast[data-minimal='true'] .hm-score,
  .hm-broadcast[data-minimal='true'] .hm-live-dot {
    animation: none;
  }
</style>
