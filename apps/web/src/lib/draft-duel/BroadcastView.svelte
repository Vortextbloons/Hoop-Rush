<script lang="ts">
  import {
    DRAFT_DUEL_TAPE_STAT_FIELDS,
    type DraftDuelGameOutput,
    type DraftDuelParticipantId,
    type DraftDuelTapeStatLine,
  } from '@hoop-rush/data-contracts';
  import type { DraftDuelVisibleState } from '$lib/draft-duel-playback';
  import { draftDuelPeriodLabel, type DraftDuelFeedLine } from './draft-duel-broadcast-view';

  let {
    output,
    visible,
    progress,
    localParticipantId,
    feed,
  }: {
    output: DraftDuelGameOutput;
    visible: DraftDuelVisibleState;
    progress: number;
    localParticipantId: DraftDuelParticipantId;
    feed: DraftDuelFeedLine[];
  } = $props();

  const POINTS = DRAFT_DUEL_TAPE_STAT_FIELDS.indexOf('points');
  const FIELD_GOAL_MAKES = DRAFT_DUEL_TAPE_STAT_FIELDS.indexOf('fieldGoalMakes');
  const FIELD_GOAL_ATTEMPTS = DRAFT_DUEL_TAPE_STAT_FIELDS.indexOf('fieldGoalAttempts');
  const THREE_MAKES = DRAFT_DUEL_TAPE_STAT_FIELDS.indexOf('threeMakes');
  const THREE_ATTEMPTS = DRAFT_DUEL_TAPE_STAT_FIELDS.indexOf('threeAttempts');
  const OFFENSIVE_REBOUNDS = DRAFT_DUEL_TAPE_STAT_FIELDS.indexOf('offensiveRebounds');
  const DEFENSIVE_REBOUNDS = DRAFT_DUEL_TAPE_STAT_FIELDS.indexOf('defensiveRebounds');
  const ASSISTS = DRAFT_DUEL_TAPE_STAT_FIELDS.indexOf('assists');
  const TURNOVERS = DRAFT_DUEL_TAPE_STAT_FIELDS.indexOf('turnovers');

  interface PlayerRow {
    key: string;
    label: string;
    points: number;
    rebounds: number;
    assists: number;
    turnovers: number;
    fieldGoals: string;
    threes: string;
  }

  interface SideView {
    key: 'home' | 'away';
    label: string;
    score: number;
    rows: PlayerRow[];
  }

  function formatClock(clockSeconds: number): string {
    const total = Math.max(0, Math.floor(clockSeconds));
    const minutes = Math.floor(total / 60);
    const seconds = total % 60;
    return `${String(minutes)}:${String(seconds).padStart(2, '0')}`;
  }

  function playerRowsOf(
    lines: readonly DraftDuelTapeStatLine[],
    playerIds: readonly string[],
  ): PlayerRow[] {
    return lines.map((line, slot) => {
      const playerId = playerIds[slot];
      return {
        key: playerId ?? `slot-${String(slot + 1)}`,
        label: playerId ?? `Slot ${String(slot + 1)}`,
        points: line[POINTS] ?? 0,
        rebounds: (line[OFFENSIVE_REBOUNDS] ?? 0) + (line[DEFENSIVE_REBOUNDS] ?? 0),
        assists: line[ASSISTS] ?? 0,
        turnovers: line[TURNOVERS] ?? 0,
        fieldGoals: `${String(line[FIELD_GOAL_MAKES] ?? 0)}-${String(line[FIELD_GOAL_ATTEMPTS] ?? 0)}`,
        threes: `${String(line[THREE_MAKES] ?? 0)}-${String(line[THREE_ATTEMPTS] ?? 0)}`,
      };
    });
  }

  const localSide = $derived(output.homeParticipantId === localParticipantId ? 'home' : 'away');
  const localScore = $derived(localSide === 'home' ? visible.homeScore : visible.awayScore);
  const opponentScore = $derived(localSide === 'home' ? visible.awayScore : visible.homeScore);
  const lastTrip = $derived(feed.length > 0 ? (feed[feed.length - 1] ?? null) : null);
  const periodLabel = $derived(
    draftDuelPeriodLabel(lastTrip?.period ?? visible.periods.at(-1)?.period ?? 1),
  );
  const clockLabel = $derived(lastTrip === null ? '—' : formatClock(lastTrip.clockSeconds));
  const progressPct = $derived(
    Math.round(Math.min(1, Math.max(0, Number.isNaN(progress) ? 0 : progress)) * 100),
  );
  const complete = $derived(progress >= 1);
  const recentFeed = $derived([...feed].slice(-10).reverse());

  const sides = $derived.by((): SideView[] => {
    const order: readonly ('home' | 'away')[] =
      localSide === 'home' ? ['home', 'away'] : ['away', 'home'];
    return order.map((key) => {
      const lines = key === 'home' ? visible.homePlayerLines : visible.awayPlayerLines;
      const playerIds = (key === 'home' ? output.result.home : output.result.away).players.map(
        (player) => player.playerId,
      );
      return {
        key,
        label: key === localSide ? 'You' : 'Opponent',
        score: key === 'home' ? visible.homeScore : visible.awayScore,
        rows: playerRowsOf(lines, playerIds),
      };
    });
  });
</script>

<section class="broadcast" aria-label={`Game ${String(output.gameNumber)} broadcast`}>
  <header class="scorebug">
    <div class="score-team" data-side="local">
      <span class="score-team-tag">You</span>
      <span class="score-num" data-score="local">{localScore}</span>
    </div>
    <div class="score-mid">
      <span class="sim-live-pill" data-tone={complete ? 'final' : 'live'}>
        <span class="sim-live-dot" aria-hidden="true"></span>
        {complete ? 'Final' : 'Live'}
      </span>
      <span class="score-clock" aria-live="polite">{periodLabel} · {clockLabel}</span>
    </div>
    <div class="score-team" data-side="opponent">
      <span class="score-team-tag">Opp</span>
      <span class="score-num" data-score="opponent">{opponentScore}</span>
    </div>
  </header>

  <div class="progress-track" aria-hidden="true">
    <div
      class="sim-bar-fill"
      data-active={complete ? undefined : 'true'}
      style:width={`${progressPct}%`}
    ></div>
  </div>

  <div class="panels">
    {#each sides as side (side.key)}
      <section class="stat-panel" data-side={side.key} aria-label={`${side.label} player stats`}>
        <header class="stat-head">
          <span class="stat-team" data-side={side.key}>{side.label}</span>
          <strong class="stat-score">{side.score}</strong>
        </header>
        <div class="stat-scroll">
          <table>
            <caption class="sr-only">{side.label} player stats so far</caption>
            <thead>
              <tr>
                <th scope="col" class="is-player">Player</th>
                <th scope="col">PTS</th>
                <th scope="col">REB</th>
                <th scope="col">AST</th>
                <th scope="col">TO</th>
                <th scope="col">FG</th>
                <th scope="col">3P</th>
              </tr>
            </thead>
            <tbody>
              {#each side.rows as row (row.key)}
                <tr data-role="player-row">
                  <th scope="row" class="is-player">{row.label}</th>
                  <td data-stat="pts">{row.points}</td>
                  <td data-stat="reb">{row.rebounds}</td>
                  <td data-stat="ast">{row.assists}</td>
                  <td data-stat="tov">{row.turnovers}</td>
                  <td data-stat="fg">{row.fieldGoals}</td>
                  <td data-stat="tp">{row.threes}</td>
                </tr>
              {/each}
            </tbody>
          </table>
        </div>
      </section>
    {/each}
  </div>

  <section class="feed-panel" aria-label="Play-by-play feed">
    <header class="feed-head">
      <h3>Live feed</h3>
      <span class="feed-count">
        {feed.length}
        {feed.length === 1 ? 'possession' : 'possessions'} shown
      </span>
    </header>
    {#if recentFeed.length > 0}
      <ul class="feed-list" aria-live="polite">
        {#each recentFeed as line (line.key)}
          <li
            class="feed-line"
            data-offense={line.offense === localParticipantId ? 'local' : 'opponent'}
          >
            <span class="feed-meta"
              >{draftDuelPeriodLabel(line.period)} · {formatClock(line.clockSeconds)}</span
            >
            <span
              class="feed-team"
              data-side={line.offense === localParticipantId ? 'local' : 'opponent'}
            >
              {line.offense === localParticipantId ? 'You' : 'Opp'}
            </span>
            <span class="feed-summary">{line.summary}</span>
            {#if line.points > 0}
              <span class="feed-pts">+{line.points}</span>
            {/if}
          </li>
        {/each}
      </ul>
    {:else}
      <p class="feed-empty">Waiting for the first possession…</p>
    {/if}
  </section>
</section>

<style>
  .broadcast {
    display: grid;
    overflow: clip;
    border: 1px solid var(--color-line-soft);
    border-radius: var(--radius);
    background: var(--color-surface-1);
  }

  .scorebug {
    display: flex;
    align-items: stretch;
    background:
      linear-gradient(
        180deg,
        color-mix(in srgb, var(--color-primary) 6%, transparent),
        transparent
      ),
      var(--color-surface-2);
  }

  .score-team {
    display: flex;
    flex: 1 1 0;
    align-items: center;
    justify-content: center;
    gap: 0.6rem;
    min-width: 0;
    padding: 1rem 0.6rem;
  }

  .score-team-tag {
    font-family: var(--font-mono);
    font-size: 0.6rem;
    font-weight: 700;
    letter-spacing: 0.14em;
    color: var(--color-muted-foreground);
    text-transform: uppercase;
  }

  .score-num {
    font-family: var(--font-display);
    font-size: clamp(2rem, 9vw, 2.75rem);
    font-weight: 800;
    line-height: 1;
    font-variant-numeric: tabular-nums;
  }

  .score-team[data-side='local'] .score-num {
    color: var(--color-primary);
  }

  .score-team[data-side='opponent'] {
    flex-direction: row-reverse;
  }

  .score-mid {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 0.35rem;
    padding: 0.7rem 0.5rem;
    text-align: center;
  }

  .score-clock {
    font-family: var(--font-mono);
    font-size: 0.72rem;
    font-weight: 700;
    color: var(--color-muted-foreground);
    white-space: nowrap;
  }

  .progress-track {
    height: 0.3rem;
    overflow: hidden;
    background: var(--color-muted);
  }

  .panels {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 0.75rem;
    padding: 0.85rem;
  }

  .stat-panel {
    min-width: 0;
    overflow: clip;
    border: 1px solid var(--color-line-soft);
    border-radius: 0.6rem;
    background: var(--color-surface-2);
  }

  .stat-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.5rem;
    padding: 0.45rem 0.7rem;
    border-bottom: 1px solid var(--color-line-soft);
  }

  .stat-team {
    font-family: var(--font-display);
    font-size: 0.82rem;
    font-weight: 800;
    letter-spacing: 0.08em;
    text-transform: uppercase;
  }

  .stat-team[data-side='home'] {
    color: var(--color-primary);
  }

  .stat-team[data-side='away'] {
    color: #8bc9e0;
  }

  .stat-score {
    font-family: var(--font-display);
    font-size: 1.2rem;
    font-weight: 800;
    font-variant-numeric: tabular-nums;
  }

  .stat-scroll {
    overflow-x: auto;
  }

  table {
    width: 100%;
    min-width: 19rem;
    border-collapse: collapse;
    font-size: 0.72rem;
    font-variant-numeric: tabular-nums;
  }

  th,
  td {
    padding: 0.34rem 0.45rem;
    white-space: nowrap;
    text-align: right;
  }

  thead th {
    color: var(--color-muted-foreground);
    font-family: var(--font-mono);
    font-size: 0.56rem;
    font-weight: 700;
    letter-spacing: 0.1em;
    border-bottom: 1px solid var(--color-line-soft);
  }

  thead th.is-player,
  th.is-player {
    width: 100%;
    text-align: left;
  }

  tbody tr {
    border-top: 1px solid color-mix(in srgb, var(--color-line-soft) 55%, transparent);
  }

  tbody tr:first-child {
    border-top: 0;
  }

  tbody th.is-player {
    max-width: 9.5rem;
    overflow: hidden;
    font-weight: 600;
    text-overflow: ellipsis;
  }

  tbody td[data-stat='pts'] {
    color: var(--color-foreground);
    font-weight: 800;
  }

  .feed-panel {
    border-top: 1px solid var(--color-line-soft);
    padding: 0.75rem 0.85rem 0.85rem;
  }

  .feed-head {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    justify-content: space-between;
    gap: 0.3rem 1rem;
    margin-bottom: 0.5rem;
  }

  .feed-head h3 {
    margin: 0;
    font-family: var(--font-display);
    font-size: 0.86rem;
    font-weight: 850;
    letter-spacing: 0.06em;
    text-transform: uppercase;
  }

  .feed-count {
    font-family: var(--font-mono);
    font-size: 0.6rem;
    color: var(--color-muted-foreground);
  }

  .feed-list {
    display: grid;
    gap: 0.3rem;
    max-height: 15rem;
    margin: 0;
    padding: 0;
    overflow-y: auto;
    list-style: none;
  }

  .feed-line {
    display: grid;
    grid-template-columns: auto auto minmax(0, 1fr) auto;
    align-items: baseline;
    gap: 0.45rem;
    padding: 0.3rem 0.5rem;
    border-left: 2px solid var(--color-line-strong);
    border-radius: 0.3rem;
    background: var(--color-surface-2);
    font-size: 0.72rem;
  }

  .feed-line[data-offense='local'] {
    border-left-color: var(--color-primary);
  }

  .feed-line[data-offense='opponent'] {
    border-left-color: #8bc9e0;
  }

  .feed-meta {
    font-family: var(--font-mono);
    font-size: 0.62rem;
    color: var(--color-muted-foreground);
    white-space: nowrap;
  }

  .feed-team {
    font-family: var(--font-mono);
    font-size: 0.58rem;
    font-weight: 700;
    letter-spacing: 0.08em;
    text-transform: uppercase;
  }

  .feed-team[data-side='local'] {
    color: var(--color-primary);
  }

  .feed-team[data-side='opponent'] {
    color: #8bc9e0;
  }

  .feed-summary {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .feed-pts {
    font-family: var(--font-mono);
    font-size: 0.62rem;
    font-weight: 700;
    color: var(--color-positive);
    white-space: nowrap;
  }

  .feed-empty {
    margin: 0;
    font-size: 0.75rem;
    color: var(--color-muted-foreground);
  }

  @media (max-width: 720px) {
    .panels {
      grid-template-columns: minmax(0, 1fr);
    }

    .score-team {
      gap: 0.4rem;
      padding: 0.8rem 0.4rem;
    }
  }
</style>
