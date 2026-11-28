<script lang="ts">
  import {
    buildFullCourtGameReport,
    unitNameForPlayerIds,
    type FullCourtGameHealthOutcome,
    type FullCourtGameResult,
  } from '@hoop-rush/engine';
  import type { BroadcastFeedRow } from '#lib/gamecast/GamecastFeed.svelte';
  import GamecastLiveLayout from '#lib/gamecast/GamecastLiveLayout.svelte';
  import GamecastPlaybackControls from '#lib/gamecast/GamecastPlaybackControls.svelte';
  import {
    gamecastBoxScoreColumns,
    gamecastBoxScoreLineTotals,
    gamecastBoxScoreTotals,
  } from '#lib/gamecast/gamecast-box-score.js';
  import { gamecastPeriodLabel } from '#lib/gamecast/gamecast-broadcast-view.js';
  import { onMount } from 'svelte';
  import GameScoreboard from '#lib/components/GameScoreboard.svelte';
  import PlayerStatsSection from '#lib/components/basketball/PlayerStatsSection.svelte';
  import type { PlayerStatColumn, PlayerStatsTotals } from '#lib/components/player-stats-table.js';
  import Button from '#lib/components/ui/Button.svelte';
  import Panel from '#lib/components/ui/Panel.svelte';
  import SectionHeading from '#lib/components/ui/SectionHeading.svelte';
  import FullCourtPortrait from './FullCourtPortrait.svelte';
  import type { FullCourtArt } from './full-court-art.ts';
  import {
    fullCourtBestLineup,
    fullCourtGamecastFrames,
    fullCourtPossessionCursor,
    fullCourtRotationSummary,
  } from './full-court-gamecast.ts';

  let {
    game,
    userTeamId,
    replayNote = null,
    onClose,
    art = null,
  }: {
    game: Extract<FullCourtGameHealthOutcome, { kind: 'played' }>;
    userTeamId: string;
    replayNote?: string | null;
    onClose: () => void;
    art?: FullCourtArt | null;
  } = $props();

  type PlayerLine = FullCourtGameResult['home']['players'][number];
  type LineupReportRow = NonNullable<typeof lineupReport>['lineupRows'][number];
  const columns: PlayerStatColumn<PlayerLine>[] = [
    { key: 'minutes', label: 'MIN', value: (player) => player.minutes.toFixed(1) },
    ...(gamecastBoxScoreColumns([
      'points',
      'rebounds',
      'assists',
      'steals',
      'blocks',
      'turnovers',
      'fouls',
      'fieldGoals',
      'threes',
      'freeThrows',
      'fieldGoalPct',
      'trueShootingPct',
    ]) as PlayerStatColumn<PlayerLine>[]),
    {
      key: 'energy',
      label: 'ENERGY',
      value: (player) => `${String(Math.round(player.energyRemaining * 100))}%`,
    },
  ];

  function totalsForTeam(team: FullCourtGameResult['home']): PlayerStatsTotals<PlayerLine> {
    const lineTotals = gamecastBoxScoreLineTotals(team.players);
    const totals = gamecastBoxScoreTotals({
      ...lineTotals,
      points: team.box.points,
    }) as PlayerStatsTotals<PlayerLine>;
    return {
      label: 'Team',
      value: (column) =>
        column.key === 'minutes' ? lineTotals.minutes.toFixed(1) : totals.value(column),
    };
  }
  const lineupColumns: PlayerStatColumn<LineupReportRow>[] = [
    { key: 'min', label: 'MIN', value: (lineup) => lineup.minutes.toFixed(1) },
    { key: 'poss', label: 'POSS', value: (lineup) => lineup.pacePossessions },
    {
      key: 'net',
      label: 'NET RTG',
      value: (lineup) =>
        `${lineup.netRatingPer100?.toFixed(1) ?? '—'}${lineup.sampleMet ? '' : ' *'}`,
    },
  ];
  const teams = $derived([game.result.home, game.result.away] as const);
  const frames = $derived(
    game.tape === null ? [] : fullCourtGamecastFrames(game.result, game.tape),
  );
  let cursor = $state(0);
  let paused = $state(false);
  let speed = $state(1);
  const frame = $derived(frames[cursor]);
  const finished = $derived(cursor >= frames.length - 1);
  const visibleFeed = $derived.by(() => {
    const rows: BroadcastFeedRow[] = [];
    for (let index = cursor; index > 0 && rows.length < 10; index -= 1) {
      const item = frames[index];
      const previous = frames[index - 1];
      if (!item || !previous || item.caption === null || item.side === null) continue;
      const team = teams[item.side];
      const local = team.teamId === userTeamId;
      rows.push({
        key: index,
        period: item.period + 1,
        clockSeconds: item.clockSeconds,
        side: local ? 'local' : 'opponent',
        team: local ? 'You' : 'Opp',
        tag: item.kind === 'substitution' ? 'SUB' : item.kind === 'trip' ? 'PLAY' : 'FT',
        summary: item.caption,
        points:
          item.side === 0
            ? item.homeScore - previous.homeScore
            : item.awayScore - previous.awayScore,
      });
    }
    return rows;
  });

  function step(direction: -1 | 1): void {
    paused = true;
    cursor = fullCourtPossessionCursor(frames, cursor, direction);
  }

  const lineupReport = $derived.by(() => {
    if (!finished || game.tape === null) return null;
    const userSide = game.result.home.teamId === userTeamId ? 'home' : 'away';
    try {
      const result = buildFullCourtGameReport({
        kind: 'played',
        gameId: game.result.seed,
        userSide,
        result: game.result,
        tape: game.tape,
      });
      return result.status === 'played' ? result : null;
    } catch {
      return null;
    }
  });

  const userTeam = $derived(
    game.result.home.teamId === userTeamId ? game.result.home : game.result.away,
  );
  const userSideIndex = $derived.by((): 0 | 1 => (game.result.home.teamId === userTeamId ? 0 : 1));
  const rotation = $derived(fullCourtRotationSummary(userTeam, userSideIndex, game.tape));
  const bestLineup = $derived(fullCourtBestLineup(lineupReport?.lineupRows ?? []));

  onMount(() => {
    const timer = setInterval(() => {
      if (!paused && !finished) cursor = Math.min(frames.length - 1, cursor + speed);
    }, 240);
    return () => clearInterval(timer);
  });

  function playerNameOf(team: FullCourtGameResult['home'], playerId: string): string {
    return team.players.find((player) => player.playerId === playerId)?.displayName ?? 'Player';
  }

  function clockLabel(secondsRemaining: number): string {
    const seconds = Math.ceil(secondsRemaining);
    return `${String(Math.floor(seconds / 60))}:${String(seconds % 60).padStart(2, '0')}`;
  }

  function namedUnitSeconds(team: FullCourtGameResult['home']): Map<string, number> {
    const secondsByUnit = new Map(
      team.units.filter((unit) => unit.plannedMinutes).map((unit) => [unit.name, 0]),
    );
    for (const stint of team.stints) {
      const name = unitNameFor(team, stint.playerIds);
      if (name !== null) secondsByUnit.set(name, (secondsByUnit.get(name) ?? 0) + stint.seconds);
    }
    return secondsByUnit;
  }

  function unitNameFor(
    team: FullCourtGameResult['home'],
    playerIds: readonly string[],
  ): string | null {
    return unitNameForPlayerIds(
      team.units,
      team.players.map((player) => player.playerId),
      playerIds,
    );
  }
</script>

<Panel as="section" padding="sm" aria-label="Full Court game report">
  <div class="flex flex-wrap items-center justify-between gap-2">
    <div>
      <SectionHeading level={3} size="sm" title={frames.length > 0 ? 'Gamecast' : 'Game report'} />
      {#if replayNote !== null}
        <p class="mt-0.5 text-xs text-muted-foreground">{replayNote}</p>
      {/if}
    </div>
    <Button tone="secondary" size="sm" onclick={onClose}>Close</Button>
  </div>
  <GamecastLiveLayout
    class="broadcast mt-3"
    label="Full Court Gamecast"
    feed={frames.length > 0 ? visibleFeed : null}
    feedCountLabel={`${frame?.possession ?? 0} ${frame?.possession === 1 ? 'possession' : 'possessions'}`}
  >
    {#snippet scoreboard()}
      <GameScoreboard
        teams={[
          {
            key: 'away',
            label: game.result.away.displayName,
            score: finished ? game.result.away.box.points : (frame?.awayScore ?? 0),
            winner: finished && game.result.winner === 'away',
          },
          {
            key: 'home',
            label: game.result.home.displayName,
            score: finished ? game.result.home.box.points : (frame?.homeScore ?? 0),
            winner: finished && game.result.winner === 'home',
          },
        ]}
      >
        {#snippet status()}
          <span class="ui-micro">
            {#if finished}
              Final
            {:else if frame !== undefined}
              {gamecastPeriodLabel(frame.period + 1)}
              · {clockLabel(frame.clockSeconds)}
            {/if}
          </span>
        {/snippet}
      </GameScoreboard>
    {/snippet}

    {#snippet content()}
      {#if frames.length > 0}
        <GamecastPlaybackControls
          {paused}
          complete={finished}
          ontoggle={() => (paused = !paused)}
          onskip={() => (cursor = frames.length - 1)}
          onreplay={() => {
            cursor = 0;
            paused = false;
          }}
        >
          {#snippet leading()}
            <Button size="sm" tone="secondary" disabled={cursor === 0} onclick={() => step(-1)}>
              Previous possession
            </Button>
            <Button size="sm" tone="secondary" disabled={finished} onclick={() => step(1)}>
              Next possession
            </Button>
          {/snippet}
          {#snippet trailing()}
            <label class="flex items-center gap-2 text-xs text-muted-foreground">
              Speed
              <select
                class="min-h-9 rounded-md border border-line-soft bg-surface-2 px-2"
                bind:value={speed}
              >
                <option value={1}>1×</option>
                <option value={4}>4×</option>
                <option value={12}>12×</option>
              </select>
            </label>
          {/snippet}
        </GamecastPlaybackControls>
        <label class="mt-3 flex items-center gap-3 text-xs text-muted-foreground">
          <span class="shrink-0">Game timeline</span>
          <input
            class="ui-range w-full min-w-0"
            type="range"
            min="0"
            max={Math.max(0, frames.length - 1)}
            value={cursor}
            style={`--ui-range-progress: ${String(frames.length > 1 ? (cursor / (frames.length - 1)) * 100 : 100)}%`}
            aria-label="Game timeline"
            oninput={(event) => {
              paused = true;
              cursor = event.currentTarget.valueAsNumber;
            }}
          />
        </label>
      {/if}

      {#if frame !== undefined}
        <div class="mt-4 grid grid-cols-2 gap-2 sm:gap-3">
          {#each teams as team, index (team.teamId)}
            {@const active = index === 0 ? frame.homeUnit : frame.awayUnit}
            {@const unitName = unitNameFor(team, active)}
            <section
              class="min-w-0 rounded-xl border border-line-soft bg-surface-1 p-2 sm:p-3"
              aria-label={`${team.displayName} active five`}
            >
              <h4 class="flex flex-wrap items-baseline gap-x-1.5 text-sm font-semibold">
                <span>{team.displayName}</span>
                <span class="text-xs font-normal text-muted-foreground"
                  >{finished ? 'final five' : 'on court'}</span
                >
                {#if !finished && frame.kind === 'trip' && frame.side === index}
                  <span class="ui-micro text-primary">On offense</span>
                {/if}
                {#if unitName !== null}
                  <span class="text-xs font-normal text-accent">· {unitName}</span>
                {/if}
              </h4>
              <ul class="mt-2 divide-y divide-line-soft">
                {#each active as id (id)}
                  {@const player = team.players.find((entry) => entry.playerId === id)}
                  <li class="flex min-w-0 items-center gap-2 py-1.5">
                    <div class="flex justify-center">
                      <FullCourtPortrait
                        player={{ playerId: id, displayName: player?.displayName ?? 'Player' }}
                        {art}
                        size="sm"
                        eager
                      />
                    </div>
                    <span
                      class="min-w-0 text-xs font-semibold leading-tight sm:text-sm"
                      title={player?.displayName ?? id}
                    >
                      {player?.displayName ?? 'Player'}
                    </span>
                  </li>
                {/each}
              </ul>
            </section>
          {/each}
        </div>
      {/if}
    {/snippet}
  </GamecastLiveLayout>
  {#if finished}
    {@const topShooter = userTeam.players.reduce<(typeof userTeam.players)[number] | undefined>(
      (leader, player) =>
        player.fieldGoals.attempted > (leader?.fieldGoals.attempted ?? 0) ? player : leader,
      undefined,
    )}
    {@const unitSeconds = namedUnitSeconds(userTeam)}
    {@const firstSubstitution = rotation.firstSubstitution}
    <section class="mt-4 grid gap-1 text-sm" aria-label="How your team played">
      <h3 class="font-semibold">How your team played</h3>
      <p class="text-muted-foreground">
        {userTeam.box.possessions} possessions · {userTeam.box.threes.attempted} of
        {userTeam.box.fieldGoals.attempted} shots from three · {userTeam.box.assists} assists ·
        {userTeam.box.turnovers} turnovers
      </p>
      <p class="text-muted-foreground">
        {rotation.playersUsed} players used · {rotation.starterMinutes.toFixed(1)} starter minutes ·
        {rotation.benchMinutes.toFixed(1)} bench minutes{#if rotation.disqualifications > 0}
          · {rotation.disqualifications} foul out{rotation.disqualifications === 1 ? '' : 's'}{/if}
      </p>
      {#if rotation.foulTrouble.length > 0}
        <p class="text-muted-foreground">
          Foul trouble: {rotation.foulTrouble
            .map(
              (player) =>
                `${player.displayName} (${String(player.fouls)} PF${player.foulsOut ? ', fouled out' : ''})`,
            )
            .join(' · ')}
        </p>
      {/if}
      {#if topShooter !== undefined}
        <p class="text-muted-foreground">
          {topShooter.displayName} led the team with {topShooter.fieldGoals.attempted} shot attempts.
        </p>
      {/if}
      {#if unitSeconds.size > 0}
        <ul class="mt-1 flex flex-wrap gap-2" aria-label="Lineup group minutes">
          {#each unitSeconds as [name, seconds] (name)}
            {@const planned = userTeam.units.find((unit) => unit.name === name)?.plannedMinutes}
            <li class="rounded-md border border-line-soft px-2 py-1 text-xs">
              {name} &middot; {(seconds / 60).toFixed(1)} min played
              {#if planned !== undefined}
                / {planned} planned{/if}
            </li>
          {/each}
        </ul>
      {/if}
      {#if rotation.substitutions.length > 0}
        <p class="text-muted-foreground">
          {rotation.substitutions.length} substitution{rotation.substitutions.length === 1
            ? ''
            : 's'} · {rotation.reasonSummary}
        </p>
        {#if firstSubstitution !== null}
          <p class="text-muted-foreground">
            First change: {playerNameOf(userTeam, firstSubstitution.inPlayerId)} in for
            {playerNameOf(userTeam, firstSubstitution.outPlayerId)} ·
            {gamecastPeriodLabel(firstSubstitution.period + 1)}
            {clockLabel(firstSubstitution.clockSeconds)}
          </p>
        {/if}
      {:else}
        <p class="text-muted-foreground">No substitutions recorded.</p>
      {/if}
      {#if bestLineup !== null}
        <p class="text-muted-foreground">
          Best qualifying lineup: {bestLineup.players
            .map((player) => player.displayName)
            .join(' · ')} · {bestLineup.netRatingPer100 !== null && bestLineup.netRatingPer100 > 0
            ? '+'
            : ''}{bestLineup.netRatingPer100?.toFixed(1) ?? '—'} NET RTG over
          {Math.round(bestLineup.pacePossessions)} possessions.
        </p>
      {/if}
    </section>
    {#if lineupReport !== null}
      <PlayerStatsSection
        surface="none"
        class="mt-4"
        title="Lineup Lab"
        description={`${lineupReport.bench.points} bench points${lineupReport.teamBonusPoints > 0 ? ` · ${lineupReport.teamBonusPoints} team bonus points` : ''}. Asterisk marks lineups below ${lineupReport.sampleThreshold} possessions.`}
        ariaLabel="Lineup Lab"
        caption="Lineup Lab"
        playerLabel="Lineup"
        stickyIdentity
        tableClass="min-w-[36rem] text-sm"
        statCellClass="font-mono"
        columns={lineupColumns}
        rows={lineupReport.lineupRows}
        rowKey={(lineup) => lineup.key}
      >
        {#snippet identity(lineup)}
          {@const unitName = unitNameFor(
            lineupReport.userSide === 'home' ? game.result.home : game.result.away,
            lineup.playerIds,
          )}
          <span class="ui-stats-player">
            <span class="ui-stats-player-text">
              <span class="ui-stats-player-name"
                >{lineup.players
                  .map((player) => player.displayName)
                  .join(' · ')}{#if unitName !== null}<span class="text-accent">
                    · {unitName}</span
                  >{/if}</span
              >
            </span>
          </span>
        {/snippet}
      </PlayerStatsSection>
    {:else if game.tape !== null}
      <p class="mt-4 text-xs text-muted-foreground">
        Lineup details are unavailable for this game.
      </p>
    {/if}
    {#if game.injuries.length > 0}
      <ul aria-label="Injuries" class="mt-3 space-y-1 text-xs text-muted-foreground">
        {#each game.injuries as injury (`${injury.teamId}:${injury.playerId}`)}
          {@const player = teams
            .find((team) => team.teamId === injury.teamId)
            ?.players.find((entry) => entry.playerId === injury.playerId)}
          <li class="flex items-center gap-2">
            {#if player !== undefined}
              <FullCourtPortrait {player} {art} size="sm" />
            {/if}
            <span
              >{player?.displayName ?? 'Player'} is expected to miss {injury.gamesMissed} games.</span
            >
          </li>
        {/each}
      </ul>
    {/if}
    {#each [game.result.away, game.result.home] as team (team.teamId)}
      {@const isUserTeam = team.teamId === userTeamId}
      <PlayerStatsSection
        surface="none"
        class="mt-4"
        title={`${team.displayName} box score`}
        description={`${team.box.points} PTS · ${team.players.filter((player) => player.minutes > 0).length} played`}
        ariaLabel={`${team.displayName} box score`}
        caption={`${team.displayName} box score`}
        stickyIdentity
        tableClass="min-w-[1080px] text-sm"
        statCellClass="font-mono"
        totalsRow={totalsForTeam(team)}
        {columns}
        rows={team.players}
        rowKey={(player) => player.playerId}
      >
        {#snippet identity(player)}
          <span class="ui-stats-player">
            <FullCourtPortrait {player} {art} size="sm" />
            <span class="ui-stats-player-text">
              <span class="ui-stats-player-name {isUserTeam ? 'text-primary' : ''}"
                >{player.displayName}</span
              >
            </span>
          </span>
        {/snippet}
      </PlayerStatsSection>
    {/each}
  {/if}
</Panel>
