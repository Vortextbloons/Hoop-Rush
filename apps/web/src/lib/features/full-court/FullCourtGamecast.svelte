<script lang="ts">
  import {
    buildFullCourtGameReport,
    fullCourtGameMomentsFromResult,
    unitNameForPlayerIds,
    type FullCourtCatalogIndex,
    type FullCourtGameHealthOutcome,
    type FullCourtGameResult,
  } from '@hoop-rush/engine';
  import type { FullCourtDraftState } from '@hoop-rush/data-contracts';
  import type { BroadcastFeedRow } from '#lib/gamecast/GamecastFeed.svelte';
  import GamecastLiveLayout from '#lib/gamecast/GamecastLiveLayout.svelte';
  import GamecastPlaybackControls from '#lib/gamecast/GamecastPlaybackControls.svelte';
  import {
    gamecastBoxScoreColumns,
    gamecastBoxScoreLineTotals,
    gamecastBoxScoreTotals,
  } from '#lib/gamecast/gamecast-box-score.js';
  import { gamecastPeriodLabel } from '#lib/gamecast/gamecast-broadcast-view.js';
  import { ArrowUpRight } from '@lucide/svelte';
  import { onMount } from 'svelte';
  import GameScoreboard from '#lib/components/GameScoreboard.svelte';
  import PlayerStatsSection from '#lib/components/basketball/PlayerStatsSection.svelte';
  import type { PlayerStatColumn, PlayerStatsTotals } from '#lib/components/player-stats-table.js';
  import Button from '#lib/components/ui/Button.svelte';
  import Panel from '#lib/components/ui/Panel.svelte';
  import SectionHeading from '#lib/components/ui/SectionHeading.svelte';
  import { formatClock } from '#lib/format.js';
  import FullCourtGameMomentsStrip from './FullCourtGameMomentsStrip.svelte';
  import FullCourtPortrait from './FullCourtPortrait.svelte';
  import FullCourtPlayerScoutSheet from './FullCourtPlayerScoutSheet.svelte';
  import type { FullCourtArt } from './full-court-art.ts';
  import {
    fullCourtBestLineup,
    fullCourtGamecastFrames,
    fullCourtLiveBoxFold,
    fullCourtPossessionCursor,
    fullCourtRotationSummary,
  } from './full-court-gamecast.ts';

  let {
    game,
    userTeamId,
    label,
    note = null,
    art = null,
    draft = null,
    index = null,
    onclose,
  }: {
    game: Extract<FullCourtGameHealthOutcome, { kind: 'played' }>;
    userTeamId: string;
    label: string;
    note?: string | null;
    art?: FullCourtArt | null;
    draft?: FullCourtDraftState | null;
    index?: FullCourtCatalogIndex | null;
    onclose: () => void;
  } = $props();

  let scoutPlayerId = $state<string | null>(null);
  const canScout = $derived(draft !== null && index !== null);

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

  const homeIsUser = $derived(game.result.home.teamId === userTeamId);
  const userSide = $derived(homeIsUser ? 'home' : 'away');
  const userSideIndex = $derived(homeIsUser ? 0 : 1);
  const teams = $derived([
    game.result[userSide],
    game.result[homeIsUser ? 'away' : 'home'],
  ] as const);
  const frames = $derived(
    game.tape === null ? [] : fullCourtGamecastFrames(game.result, game.tape),
  );
  const totalFrames = $derived(Math.max(1, frames.length - 1));

  let cursor = $state(0);
  let paused = $state(false);

  const fold = $derived(fullCourtLiveBoxFold(game));
  const liveBox = $derived(fold.linesAt(cursor));
  const frame = $derived(frames[cursor]);
  const finished = $derived(cursor >= frames.length - 1);
  const progress = $derived(cursor / totalFrames);

  const userBox = $derived(homeIsUser ? liveBox.home : liveBox.away);
  const opponentBox = $derived(homeIsUser ? liveBox.away : liveBox.home);
  const userScore = $derived(
    finished
      ? game.result[userSide].box.points
      : userSideIndex === 0
        ? (frame?.homeScore ?? 0)
        : (frame?.awayScore ?? 0),
  );
  const opponentScore = $derived(
    finished
      ? game.result[homeIsUser ? 'away' : 'home'].box.points
      : userSideIndex === 0
        ? (frame?.awayScore ?? 0)
        : (frame?.homeScore ?? 0),
  );
  const leader = $derived(
    userScore === opponentScore ? null : userScore > opponentScore ? 'local' : 'opponent',
  );
  const topUserPoints = $derived(Math.max(0, ...userBox.map((line) => line.points)));
  const topOpponentPoints = $derived(Math.max(0, ...opponentBox.map((line) => line.points)));
  const possession = $derived(
    frame?.kind !== 'trip' || frame.side === null
      ? null
      : frame.side === userSideIndex
        ? 'Your ball'
        : 'Opponent ball',
  );

  const FEED_TAIL = 16;
  const feed = $derived.by((): BroadcastFeedRow[] => {
    const rows: BroadcastFeedRow[] = [];
    for (let position = cursor; position > 0 && rows.length < FEED_TAIL; position -= 1) {
      const item = frames[position];
      const previous = frames[position - 1];
      if (!item || !previous || item.caption === null || item.side === null) continue;
      const local = item.side === userSideIndex;
      rows.push({
        key: position,
        period: item.period + 1,
        clockSeconds: item.clockSeconds,
        side: local ? 'local' : 'opponent',
        team: local ? 'You' : 'Opp',
        tag:
          item.kind === 'substitution'
            ? 'SUB'
            : item.kind === 'technical'
              ? 'TECH'
              : item.side === 0
                ? item.homeScore > previous.homeScore
                  ? 'PTS'
                  : 'PLAY'
                : item.awayScore > previous.awayScore
                  ? 'PTS'
                  : 'PLAY',
        summary: item.caption,
        points:
          item.side === 0
            ? item.homeScore - previous.homeScore
            : item.awayScore - previous.awayScore,
      });
    }
    return rows;
  });

  const lineupReport = $derived.by(() => {
    if (!finished || game.tape === null) return null;
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

  const userTeam = $derived(game.result[userSide]);
  const rotation = $derived(fullCourtRotationSummary(userTeam, userSideIndex as 0 | 1, game.tape));
  const bestLineup = $derived(fullCourtBestLineup(lineupReport?.lineupRows ?? []));
  const gameMoments = $derived(
    finished
      ? fullCourtGameMomentsFromResult({
          result: game.result,
          userTeamId,
          gameId: game.result.seed,
          gameNumber: game.result.gameNumber,
        })
      : [],
  );

  // Cap Rush paces its Simcast to finish in about two and a half seconds; a
  // Full Court tape is a few hundred frames, so step 1% of it per tick.
  onMount(() => {
    const timer = setInterval(() => {
      if (paused || finished) return;
      const step = Math.max(1, Math.ceil(frames.length / 100));
      cursor = Math.min(frames.length - 1, cursor + step);
    }, 100);
    return () => clearInterval(timer);
  });

  function step(direction: -1 | 1): void {
    paused = true;
    cursor = fullCourtPossessionCursor(frames, cursor, direction);
  }

  function seek(value: number): void {
    if (value <= cursor) return;
    paused = true;
    cursor = Math.min(frames.length - 1, value);
  }

  function clockLabel(secondsRemaining: number): string {
    return formatClock(Math.max(0, Math.floor(secondsRemaining)));
  }

  function playerNameOf(team: FullCourtGameResult['home'], playerId: string): string {
    return team.players.find((player) => player.playerId === playerId)?.displayName ?? 'Player';
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

  function pct(made: number, attempted: number): string {
    return attempted === 0 ? '—' : `${((made / attempted) * 100).toFixed(1)}%`;
  }
</script>

<section class="broadcast" aria-label="Full Court gamecast">
  <GamecastLiveLayout
    label="Full Court gamecast"
    progress={finished ? 1 : progress}
    {feed}
    feedCountLabel={`${frame?.possession ?? 0} ${frame?.possession === 1 ? 'possession' : 'possessions'}`}
  >
    {#snippet scoreboard()}
      <GameScoreboard
        teams={[
          { key: 'local', label: 'You', score: userScore },
          { key: 'opponent', label: 'Opponent', score: opponentScore },
        ]}
        label={`${label} score`}
        class="bc-board"
      >
        {#snippet team(entry)}
          {@const team =
            entry.key === 'local' ? userTeam : game.result[homeIsUser ? 'away' : 'home']}
          <div
            class={entry.key === 'local' ? 'bc-team you' : 'bc-team opp'}
            data-leading={entry.key === leader}
          >
            <span class="bc-team-label">{entry.key === 'local' ? 'You' : 'Opp'}</span>
            <span class="simcast-team-name">{team.displayName}</span>
            {#if entry.key === leader}
              <span class="bc-leader">{finished ? 'Winner' : 'Leading'}</span>
            {:else}
              <span class="bc-leader invisible" aria-hidden="true">Leading</span>
            {/if}
            {#key entry.score}<span class="bc-score">{entry.score}</span>{/key}
          </div>
        {/snippet}
        {#snippet status()}
          <div class="bc-center">
            <span class="bc-live" data-tone={finished ? 'final' : 'live'}>
              <span class="bc-live-dot" aria-hidden="true"></span>
              {finished ? 'Final' : paused ? 'Paused' : 'Live'}
            </span>
            <span class="bc-clock">
              {gamecastPeriodLabel((frame?.period ?? 0) + 1)}
              &middot;
              {clockLabel(frame?.clockSeconds ?? 720)}
            </span>
            {#if !finished}
              <span class="bc-possession">{possession ?? 'Tip-off soon'}</span>
            {/if}
            <span class="bc-quarters" aria-hidden="true">
              {#each [1, 2, 3, 4] as quarter (quarter)}
                <span
                  class="bc-quarter"
                  class:done={quarter < (frame?.period ?? 0) + 1}
                  class:now={quarter === (frame?.period ?? 0) + 1}
                ></span>
              {/each}
            </span>
          </div>
        {/snippet}
      </GameScoreboard>
    {/snippet}

    {#snippet content()}
      <div class="flex flex-wrap items-center justify-between gap-2">
        <div class="min-w-0">
          <p class="ui-label" data-tone="muted">{label}</p>
          {#if note !== null}
            <p class="mt-0.5 text-xs font-semibold">{note}</p>
          {/if}
        </div>
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
          {#snippet trailing()}
            <span class="font-mono text-[10px] text-muted-foreground uppercase">2.5s playback</span>
          {/snippet}
        </GamecastPlaybackControls>
      </div>
      {#if !finished}
        <label class="mt-2 flex items-center gap-3 text-xs text-muted-foreground">
          <span class="shrink-0">Game timeline</span>
          <input
            class="ui-range w-full min-w-0"
            type="range"
            min="0"
            max={totalFrames}
            value={cursor}
            style={`--ui-range-progress: ${String(progress * 100)}%`}
            aria-label="Game timeline"
            oninput={(event) => seek(event.currentTarget.valueAsNumber)}
          />
        </label>
      {/if}

      <div class="bc-panels mt-3">
        {#each [{ box: userBox, side: 'local' as const, top: topUserPoints }, { box: opponentBox, side: 'opponent' as const, top: topOpponentPoints }] as side (side.side)}
          <section
            class="bc-panel"
            aria-label={`${side.side === 'local' ? 'You' : 'Opponent'} player stats`}
          >
            <header class="bc-panel-head">
              <span class="bc-panel-team" data-side={side.side}>
                {side.side === 'local' ? 'You' : 'Opponent'}
              </span>
              <strong class="bc-panel-score"
                >{side.side === 'local' ? userScore : opponentScore}</strong
              >
            </header>
            <div class="bc-panel-cols" aria-hidden="true">
              <span>Player</span><span>PTS</span><span>REB</span><span>AST</span><span>TO</span
              ><span>FG%</span><span>3P%</span>
            </div>
            <ul class="bc-rows">
              {#each side.box as row (row.playerId)}
                {@const hot = row.points > 0 && row.points === side.top}
                <li class="bc-row" class:hot>
                  <span class="bc-ident">
                    <FullCourtPortrait
                      player={{ playerId: row.playerId, displayName: row.displayName }}
                      {art}
                      size="sm"
                      eager
                    />
                    <span class="bc-ident-text">
                      <span class="bc-name">{row.displayName}</span>
                      <span class="bc-sub">
                        {row.startedGame ? 'Starter' : 'Bench'}
                        {#if hot}<span class="bc-hot">Top scorer</span>{/if}
                      </span>
                    </span>
                  </span>
                  <span class="bc-stat big" data-stat="pts">{row.points}</span>
                  <span class="bc-stat" data-stat="reb">{row.rebounds}</span>
                  <span class="bc-stat" data-stat="ast">{row.assists}</span>
                  <span class="bc-stat" data-stat="tov">{row.turnovers}</span>
                  <span class="bc-stat" data-stat="fg"
                    >{pct(row.fieldGoalsMade, row.fieldGoalsAttempted)}</span
                  >
                  <span class="bc-stat" data-stat="tp"
                    >{pct(row.threeMade, row.threeAttempted)}</span
                  >
                </li>
              {/each}
            </ul>
          </section>
        {/each}
      </div>
    {/snippet}
  </GamecastLiveLayout>

  <div class="flex flex-wrap items-center gap-2">
    {#if !finished}
      <Button size="sm" tone="secondary" disabled={cursor === 0} onclick={() => step(-1)}>
        Previous possession
      </Button>
      <Button size="sm" tone="secondary" onclick={() => step(1)}>Next possession</Button>
    {/if}
    <Button class="ml-auto" tone={finished ? 'primary' : 'secondary'} onclick={onclose}>
      {finished ? 'Continue' : 'Skip and continue'}
    </Button>
  </div>

  {#if finished}
    {@const topShooter = userTeam.players.reduce<(typeof userTeam.players)[number] | undefined>(
      (leader, player) =>
        player.fieldGoals.attempted > (leader?.fieldGoals.attempted ?? 0) ? player : leader,
      undefined,
    )}
    {@const unitSeconds = namedUnitSeconds(userTeam)}
    {@const firstSubstitution = rotation.firstSubstitution}
    <Panel as="section" padding="sm" aria-label="How your team played">
      <SectionHeading level={3} size="sm" title="How your team played" />
      <div class="grid gap-1 text-sm">
        <p class="text-muted-foreground">
          {userTeam.box.possessions} possessions · {userTeam.box.threes.attempted} of
          {userTeam.box.fieldGoals.attempted} shots from three · {userTeam.box.assists} assists ·
          {userTeam.box.turnovers} turnovers
        </p>
        <p class="text-muted-foreground">
          {rotation.playersUsed} players used · {rotation.starterMinutes.toFixed(1)} starter minutes ·
          {rotation.benchMinutes.toFixed(1)} bench minutes{#if rotation.disqualifications > 0}
            · {rotation.disqualifications} foul out{rotation.disqualifications === 1
              ? ''
              : 's'}{/if}
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
        <FullCourtGameMomentsStrip moments={gameMoments} {art} label="Game notable moments" />
      </div>
    </Panel>

    {#if lineupReport !== null}
      <PlayerStatsSection
        surface="none"
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
      <p class="text-xs text-muted-foreground">Lineup details are unavailable for this game.</p>
    {/if}

    {#if game.injuries.length > 0}
      <ul aria-label="Injuries" class="space-y-1 text-xs text-muted-foreground">
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

    {#each [game.result[userSide], game.result[homeIsUser ? 'away' : 'home']] as team (team.teamId)}
      {@const isUserTeam = team.teamId === userTeamId}
      <PlayerStatsSection
        surface="none"
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
          {#if isUserTeam && canScout}
            <button
              type="button"
              class="ui-stats-player min-h-10 border-0 bg-transparent p-0 text-left outline-none hover:text-accent focus-visible:ring-2 focus-visible:ring-ring"
              aria-haspopup="dialog"
              aria-label={`View ${player.displayName} scouting report`}
              onclick={() => (scoutPlayerId = player.playerId)}
            >
              <FullCourtPortrait {player} {art} size="sm" />
              <span class="ui-stats-player-text">
                <span class="ui-stats-player-name text-primary">{player.displayName}</span>
              </span>
              <ArrowUpRight size={12} aria-hidden="true" class="text-muted-foreground" />
            </button>
          {:else}
            <span class="ui-stats-player">
              <FullCourtPortrait {player} {art} size="sm" />
              <span class="ui-stats-player-text">
                <span class="ui-stats-player-name {isUserTeam ? 'text-primary' : ''}"
                  >{player.displayName}</span
                >
              </span>
            </span>
          {/if}
        {/snippet}
      </PlayerStatsSection>
    {/each}
  {/if}
</section>

{#if canScout && draft !== null && index !== null}
  <FullCourtPlayerScoutSheet
    {draft}
    {index}
    {art}
    playerId={scoutPlayerId}
    onOpenChange={(open) => {
      if (!open) scoutPlayerId = null;
    }}
  />
{/if}

<style>
  .simcast-team-name {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 12px;
    font-weight: 600;
    color: var(--color-muted-foreground);
  }
  .bc-feed-list,
  .bc-feed-empty {
    height: 236px;
  }
</style>
