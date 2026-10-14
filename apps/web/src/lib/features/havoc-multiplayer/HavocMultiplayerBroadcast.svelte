<script lang="ts">
  import type {
    HavocMultiplayerParticipantId,
    HavocMultiplayerSeriesSnapshot,
  } from '@hoop-rush/data-contracts';
  import type { HavocMultiplayerGameOutput } from '@hoop-rush/persistence';
  import { formatHavocClock, havocPeriodLabel } from '$lib/features/havoc/havoc-presentation';
  import type {
    HavocMultiplayerFeedLine,
    HavocMultiplayerVisibleState,
  } from './havoc-multiplayer-playback';
  import { havocMultiplayerLiveBoxes } from './havoc-multiplayer-playback-view';
  import { havocMultiplayerLocalSide } from './havoc-multiplayer-room-view';
  import HavocMultiplayerBoxScore from './HavocMultiplayerBoxScore.svelte';

  let {
    output,
    visible,
    feed,
    progress,
    localParticipantId,
    series,
    minimal = false,
  }: {
    output: HavocMultiplayerGameOutput;
    visible: HavocMultiplayerVisibleState;
    feed: readonly HavocMultiplayerFeedLine[];
    progress: number;
    localParticipantId: HavocMultiplayerParticipantId;
    series: HavocMultiplayerSeriesSnapshot | null;
    minimal?: boolean;
  } = $props();

  const localSide = $derived(
    havocMultiplayerLocalSide(series, output.gameNumber, localParticipantId),
  );
  const boxes = $derived(havocMultiplayerLiveBoxes(output.result, visible));
  const localBox = $derived(boxes.find((box) => box.side === localSide));
  const opponentBox = $derived(boxes.find((box) => box.side !== localSide));
  const complete = $derived(progress >= 1);
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
  data-havoc-multiplayer-broadcast={output.gameNumber}
  aria-label={`Game ${output.gameNumber} broadcast`}
>
  <header class="hm-scoreboard">
    <div class="hm-team" data-align="start">
      <span class="hm-team-label" data-side="local">You</span>
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
    <div class="hm-team" data-align="end">
      <span class="hm-team-label" data-side="opponent">Opponent</span>
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
    <HavocMultiplayerBoxScore {boxes} {localSide} />
  {/if}

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
    border: 1px solid #465273;
    border-radius: 18px;
    background:
      radial-gradient(120% 150% at 0% 0%, rgb(103 157 255 / 16%), transparent 55%),
      radial-gradient(120% 150% at 100% 0%, rgb(242 144 197 / 14%), transparent 55%), #20294c;
  }
  .hm-team {
    display: grid;
    gap: 2px;
  }
  .hm-team[data-align='start'] {
    justify-items: start;
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
  }
  .hm-team-label[data-side='local'] {
    color: #ffd782;
  }
  .hm-team-label[data-side='opponent'] {
    color: #f290c5;
  }
  .hm-score {
    font-family: var(--font-display);
    font-size: clamp(44px, 7vw, 72px);
    font-weight: 900;
    line-height: 0.95;
    font-variant-numeric: tabular-nums;
    animation: hm-score-pop 340ms cubic-bezier(0.22, 1, 0.36, 1);
  }
  .hm-team[data-align='start'] .hm-score {
    color: #ffd782;
    text-shadow: 0 0 30px rgb(255 215 130 / 35%);
  }
  .hm-team[data-align='end'] .hm-score {
    color: #f2f4ff;
  }
  .hm-score[data-negative='true'] {
    color: #f290c5;
  }
  .hm-team-bonus {
    font-family: var(--font-mono);
    font-size: 10px;
    font-weight: 700;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: #ffd782;
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
    border: 1px solid rgb(255 215 130 / 60%);
    border-radius: 999px;
    background: rgb(255 215 130 / 12%);
    color: #ffd782;
    font-family: var(--font-mono);
    font-size: 10px;
    font-weight: 800;
    letter-spacing: 0.18em;
    text-transform: uppercase;
  }
  .hm-live[data-final='true'] {
    border-color: #465273;
    background: #303c63;
    color: #c1cae4;
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
    color: #f2f4ff;
  }
  .hm-progress {
    display: block;
    width: 150px;
    max-width: 100%;
    height: 4px;
    overflow: hidden;
    border-radius: 999px;
    background: #111831;
  }
  .hm-progress-fill {
    display: block;
    height: 100%;
    border-radius: inherit;
    background: linear-gradient(90deg, #679dff, #f290c5);
  }
  .hm-plays {
    font-family: var(--font-mono);
    font-size: 10px;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: #aab9db;
  }
  .hm-feed {
    padding: 14px;
    border: 1px solid #465273;
    border-radius: 16px;
    background: #20294c;
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
    color: #aab9db;
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
    border-left: 3px solid #f290c5;
    border-radius: 9px;
    background: #303c63;
  }
  .hm-feed-line[data-side='local'] {
    border-left-color: #ffd782;
  }
  .hm-feed-line[data-latest='true'] {
    background: #3a4770;
  }
  .hm-feed-clock {
    font-family: var(--font-mono);
    font-size: 10px;
    font-weight: 700;
    font-variant-numeric: tabular-nums;
    color: #aab9db;
  }
  .hm-feed-team {
    padding: 2px 8px;
    border-radius: 999px;
    background: rgb(242 144 197 / 16%);
    color: #f290c5;
    font-family: var(--font-mono);
    font-size: 9px;
    font-weight: 800;
    letter-spacing: 0.08em;
    text-transform: uppercase;
  }
  .hm-feed-line[data-side='local'] .hm-feed-team {
    background: rgb(255 215 130 / 16%);
    color: #ffd782;
  }
  .hm-feed-summary {
    overflow: hidden;
    font-size: 12px;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .hm-feed-points {
    font-family: var(--font-display);
    font-size: 15px;
    font-weight: 900;
    color: #8bceaf;
  }
  .hm-feed-points[data-negative='true'] {
    color: #f290c5;
  }
  .hm-feed-empty {
    font-size: 12px;
    color: #c1cae4;
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
