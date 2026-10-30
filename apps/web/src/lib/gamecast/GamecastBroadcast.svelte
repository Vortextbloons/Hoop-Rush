<script lang="ts">
  import './gamecast-broadcast.css';
  import type { GameTapeStatLine, HoopRushManifest } from '@hoop-rush/data-contracts';
  import type { GamecastVisibleState } from './gamecast-playback';
  import type {
    GamecastParticipantId,
    GamecastPlayer,
    GamecastRecordedGame,
  } from './gamecast-types';
  import PlayerFace from '#lib/components/PlayerFace.svelte';
  import GameScoreboard from '#lib/components/GameScoreboard.svelte';
  import TeamLogo from '#lib/components/TeamLogo.svelte';
  import { SLOT_LABELS } from '#lib/player-positions.js';
  import { formatClock, ratioPct } from '#lib/format.js';
  import {
    TAPE_STAT_INDEXES,
    gamecastPeriodLabel,
    type GamecastFeedLine,
  } from './gamecast-broadcast-view';

  let {
    output,
    visible,
    progress,
    localParticipantId,
    feed,
    players = {},
    manifest = null,
  }: {
    output: GamecastRecordedGame;
    visible: GamecastVisibleState;
    progress: number;
    localParticipantId: GamecastParticipantId;
    feed: GamecastFeedLine[];
    players?: Record<string, GamecastPlayer>;
    manifest?: HoopRushManifest | null;
  } = $props();

  const {
    points: POINTS,
    fieldGoalMakes: FIELD_GOAL_MAKES,
    fieldGoalAttempts: FIELD_GOAL_ATTEMPTS,
    threeMakes: THREE_MAKES,
    threeAttempts: THREE_ATTEMPTS,
    offensiveRebounds: OFFENSIVE_REBOUNDS,
    defensiveRebounds: DEFENSIVE_REBOUNDS,
    assists: ASSISTS,
    turnovers: TURNOVERS,
  } = TAPE_STAT_INDEXES;

  interface PlayerRow {
    key: string;
    name: string;
    position: string;
    playerId: string | null;
    player: GamecastPlayer | null;
    points: number;
    rebounds: number;
    assists: number;
    turnovers: number;
    fieldGoals: string;
    threes: string;
    hot: boolean;
  }

  interface SideView {
    key: 'home' | 'away';
    label: string;
    score: number;
    rows: PlayerRow[];
  }

  function playerOf(playerId: string | undefined): GamecastPlayer | null {
    return playerId ? (players[playerId] ?? null) : null;
  }

  function nameOf(playerId: string | undefined, slot: number): string {
    const player = playerOf(playerId);
    if (player) return player.displayName;
    if (playerId) return playerId.replace(/^p-/, '#').slice(0, 7);
    return `Slot ${String(slot + 1)}`;
  }

  function initialsOf(name: string): string {
    return name
      .split(' ')
      .filter((part) => part.length > 0)
      .map((part) => part[0] ?? '')
      .join('')
      .slice(0, 2)
      .toUpperCase();
  }

  const playerIds = $derived(Object.keys(players));

  function displaySummary(summary: string): string {
    let text = summary;
    for (const playerId of playerIds) {
      const player = players[playerId];
      if (player && text.includes(playerId)) text = text.split(playerId).join(player.displayName);
    }
    return text;
  }

  function playerRowsOf(lines: readonly GameTapeStatLine[], ids: readonly string[]): PlayerRow[] {
    const rows = lines.map((line, slot) => {
      const playerId = ids[slot] ?? null;
      const player = playerOf(playerId ?? undefined);
      return {
        key: playerId ?? `slot-${String(slot + 1)}`,
        name: nameOf(playerId ?? undefined, slot),
        position: SLOT_LABELS[slot] ?? '',
        playerId,
        player,
        points: line[POINTS] ?? 0,
        rebounds: (line[OFFENSIVE_REBOUNDS] ?? 0) + (line[DEFENSIVE_REBOUNDS] ?? 0),
        assists: line[ASSISTS] ?? 0,
        turnovers: line[TURNOVERS] ?? 0,
        fieldGoals: ratioPct(line[FIELD_GOAL_MAKES] ?? 0, line[FIELD_GOAL_ATTEMPTS] ?? 0),
        threes: ratioPct(line[THREE_MAKES] ?? 0, line[THREE_ATTEMPTS] ?? 0),
        hot: false,
      };
    });
    return rows;
  }

  const localSide = $derived(output.homeParticipantId === localParticipantId ? 'home' : 'away');
  const localScore = $derived(localSide === 'home' ? visible.homeScore : visible.awayScore);
  const opponentScore = $derived(localSide === 'home' ? visible.awayScore : visible.homeScore);
  const leader = $derived(
    localScore === opponentScore ? null : localScore > opponentScore ? 'local' : 'opponent',
  );
  const lastTrip = $derived(feed.length > 0 ? (feed[feed.length - 1] ?? null) : null);
  const periodLabel = $derived(
    gamecastPeriodLabel(lastTrip?.period ?? visible.periods.at(-1)?.period ?? 1),
  );
  const clockLabel = $derived(
    lastTrip === null ? '—' : formatClock(Math.max(0, Math.floor(lastTrip.clockSeconds))),
  );
  const progressPct = $derived(
    Math.round(Math.min(1, Math.max(0, Number.isNaN(progress) ? 0 : progress)) * 100),
  );
  const complete = $derived(progress >= 1);
  const recentFeed = $derived([...feed].slice(-10).reverse());
  const possession = $derived(
    lastTrip === null
      ? null
      : lastTrip.offense === localParticipantId
        ? 'Your ball'
        : 'Opponent ball',
  );

  const sides = $derived.by((): SideView[] => {
    const order: readonly ('home' | 'away')[] =
      localSide === 'home' ? ['home', 'away'] : ['away', 'home'];
    const panels = order.map((key) => {
      const lines = key === 'home' ? visible.homePlayerLines : visible.awayPlayerLines;
      const ids = (key === 'home' ? output.result.home : output.result.away).players.map(
        (player) => player.playerId,
      );
      return {
        key,
        label: key === localSide ? 'You' : 'Opponent',
        score: key === 'home' ? visible.homeScore : visible.awayScore,
        rows: playerRowsOf(lines, ids),
      };
    });
    for (const panel of panels) {
      const best = Math.max(0, ...panel.rows.map((row) => row.points));
      for (const row of panel.rows) row.hot = best > 0 && row.points === best;
    }
    return panels;
  });

  function feedTag(line: GamecastFeedLine): string {
    if (line.points >= 3) return '3PT';
    if (line.points === 2) return 'BUCKET';
    if (line.points === 1) return 'FT';
    if (line.summary.includes('Turnover')) return 'TO';
    if (line.summary.includes('Rebound')) return 'REB';
    return '—';
  }

  function teamLogoSlot(player: GamecastPlayer | null) {
    if (!player?.franchiseId || !manifest) return null;
    return (
      manifest.modernFranchiseSlots.find((slot) => slot.franchiseId === player.franchiseId) ?? null
    );
  }
</script>

<section class="broadcast" aria-label={`Game ${String(output.gameNumber)} broadcast`}>
  <GameScoreboard
    teams={[
      { key: 'local', label: 'You', score: localScore },
      { key: 'opponent', label: 'Opponent', score: opponentScore },
    ]}
    label={`Game ${String(output.gameNumber)} score`}
    class="bc-board"
  >
    {#snippet team(entry)}
      <div
        class={entry.key === 'local' ? 'bc-team you' : 'bc-team opp'}
        data-leading={entry.key === leader}
      >
        <span class="bc-team-label">{entry.label}</span>
        {#if entry.key === leader}<span class="bc-leader">{complete ? 'Winner' : 'Leading'}</span
          >{/if}
        {#key entry.score}
          <span class="bc-score" data-score={entry.key === 'local' ? 'local' : 'opponent'}>
            {entry.score}
          </span>
        {/key}
      </div>
    {/snippet}
    {#snippet status()}
      <div class="bc-center">
        <span class="bc-live" data-tone={complete ? 'final' : 'live'}>
          <span class="bc-live-dot" aria-hidden="true"></span>
          {complete ? 'Final' : 'Live'}
        </span>
        <span class="bc-clock" aria-live="polite">{periodLabel} · {clockLabel}</span>
        {#if !complete}
          <span class="bc-possession">{possession ?? 'Tip-off soon'}</span>
        {/if}
        <span class="bc-quarters" aria-hidden="true">
          {#each [1, 2, 3, 4] as quarter (quarter)}
            <span
              class="bc-quarter"
              class:done={quarter < (lastTrip?.period ?? 1)}
              class:now={quarter === (lastTrip?.period ?? 1)}
            ></span>
          {/each}
        </span>
      </div>
    {/snippet}
  </GameScoreboard>

  <div class="bc-progress" aria-hidden="true">
    <div
      class="bc-progress-fill"
      data-active={complete ? undefined : 'true'}
      style:width={`${progressPct}%`}
    ></div>
  </div>

  <div class="bc-panels">
    {#each sides as side (side.key)}
      <section class="bc-panel" data-side={side.key} aria-label={`${side.label} player stats`}>
        <header class="bc-panel-head">
          <span class="bc-panel-team" data-side={side.key}>{side.label}</span>
          <strong class="bc-panel-score">{side.score}</strong>
        </header>
        <div class="bc-panel-cols" aria-hidden="true">
          <span>Player</span>
          <span>PTS</span>
          <span>REB</span>
          <span>AST</span>
          <span>TO</span>
          <span>FG%</span>
          <span>3P%</span>
        </div>
        <ul class="bc-rows">
          {#each side.rows as row (row.key)}
            <li class="bc-row" class:hot={row.hot} data-role="player-row">
              <span class="bc-ident">
                {#if manifest && row.player?.playerExternalId}
                  <PlayerFace
                    player={{
                      playerId: row.player.playerId,
                      playerExternalId: row.player.playerExternalId,
                      altIds: row.player.altIds,
                    }}
                    {manifest}
                    size="sm"
                    fallbackInitials={initialsOf(row.name)}
                  />
                {:else}
                  <span class="bc-face">{initialsOf(row.name)}</span>
                {/if}
                <span class="bc-ident-text">
                  <span class="bc-name">{row.name}</span>
                  <span class="bc-sub">
                    {#if manifest && row.player && teamLogoSlot(row.player)}
                      <TeamLogo
                        {manifest}
                        franchiseId={row.player.franchiseId ?? ''}
                        teamExternalId={teamLogoSlot(row.player)?.teamExternalId ?? ''}
                        logoCandidates={[]}
                        className="h-3 w-3"
                      />
                    {/if}
                    {row.position}
                    {#if row.hot}<span class="bc-hot">Top scorer</span>{/if}
                  </span>
                </span>
              </span>
              <span class="bc-stat big" data-stat="pts">{row.points}</span>
              <span class="bc-stat" data-stat="reb">{row.rebounds}</span>
              <span class="bc-stat" data-stat="ast">{row.assists}</span>
              <span class="bc-stat" data-stat="tov">{row.turnovers}</span>
              <span class="bc-stat" data-stat="fg">{row.fieldGoals}</span>
              <span class="bc-stat" data-stat="tp">{row.threes}</span>
            </li>
          {/each}
        </ul>
      </section>
    {/each}
  </div>

  <section class="bc-feed" aria-label="Play-by-play feed">
    <header class="bc-feed-head">
      <h3>Live feed</h3>
      <span class="bc-feed-count">
        {feed.length}
        {feed.length === 1 ? 'possession' : 'possessions'}
      </span>
    </header>
    {#if recentFeed.length > 0}
      <ul class="bc-feed-list" aria-live="polite">
        {#each recentFeed as line, index (line.key)}
          <li
            class="bc-feed-line"
            class:latest={index === 0}
            data-offense={line.offense === localParticipantId ? 'local' : 'opponent'}
          >
            <span class="bc-feed-clock">
              {gamecastPeriodLabel(line.period)}
              {formatClock(Math.max(0, Math.floor(line.clockSeconds)))}
            </span>
            <span
              class="bc-feed-team"
              data-side={line.offense === localParticipantId ? 'local' : 'opponent'}
            >
              {line.offense === localParticipantId ? 'You' : 'Opp'}
            </span>
            <span class="bc-feed-tag" data-points={line.points > 0 ? 'yes' : 'no'}>
              {feedTag(line)}
            </span>
            <span class="bc-feed-summary">{displaySummary(line.summary)}</span>
            {#if line.points > 0}
              <span class="bc-feed-pts">+{line.points}</span>
            {/if}
          </li>
        {/each}
      </ul>
    {:else}
      <p class="bc-feed-empty">Waiting for the first possession…</p>
    {/if}
  </section>
</section>
