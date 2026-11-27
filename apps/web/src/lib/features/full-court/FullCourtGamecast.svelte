<script lang="ts">
  import {
    buildFullCourtGameReport,
    type FullCourtGameHealthOutcome,
    type FullCourtGameResult,
  } from '@hoop-rush/engine';
  import { onMount } from 'svelte';
  import GameScoreboard from '#lib/components/GameScoreboard.svelte';
  import PlayerStatsTable from '#lib/components/PlayerStatsTable.svelte';
  import type { PlayerStatColumn } from '#lib/components/player-stats-table.js';
  import Button from '#lib/components/ui/Button.svelte';
  import Panel from '#lib/components/ui/Panel.svelte';
  import SectionHeading from '#lib/components/ui/SectionHeading.svelte';
  import { fullCourtGamecastFrames } from './full-court-gamecast.ts';

  let {
    game,
    userTeamId,
    replayNote = null,
    onClose,
  }: {
    game: Extract<FullCourtGameHealthOutcome, { kind: 'played' }>;
    userTeamId: string;
    replayNote?: string | null;
    onClose: () => void;
  } = $props();

  type PlayerLine = FullCourtGameResult['home']['players'][number];
  const columns: PlayerStatColumn<PlayerLine>[] = [
    { key: 'min', label: 'MIN', value: (player) => player.minutes.toFixed(1) },
    { key: 'pts', label: 'PTS', value: (player) => player.points },
    { key: 'reb', label: 'REB', value: (player) => player.rebounds.total },
    { key: 'ast', label: 'AST', value: (player) => player.assists },
    {
      key: 'energy',
      label: 'ENERGY',
      value: (player) => `${String(Math.round(player.energyRemaining * 100))}%`,
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
  const visibleFeed = $derived(
    frames.slice(Math.max(0, cursor - 12), cursor + 1).filter((item) => item.caption !== null),
  );
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

  onMount(() => {
    const timer = setInterval(() => {
      if (!paused && !finished) cursor = Math.min(frames.length - 1, cursor + speed);
    }, 240);
    return () => clearInterval(timer);
  });

  function clockLabel(secondsRemaining: number): string {
    const seconds = Math.ceil(secondsRemaining);
    return `${String(Math.floor(seconds / 60))}:${String(seconds % 60).padStart(2, '0')}`;
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
  <GameScoreboard
    class="mt-3"
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
          {frame.period < 4 ? `Q${String(frame.period + 1)}` : `OT${String(frame.period - 3)}`}
          · {clockLabel(frame.clockSeconds)}
        {/if}
      </span>
    {/snippet}
  </GameScoreboard>

  {#if frames.length > 0}
    <div class="mt-3 flex flex-wrap items-center gap-2">
      {#if finished}
        <Button
          size="sm"
          tone="secondary"
          onclick={() => {
            cursor = 0;
            paused = false;
          }}>Replay</Button
        >
      {:else}
        <Button size="sm" tone="secondary" onclick={() => (paused = !paused)}
          >{paused ? 'Resume' : 'Pause'}</Button
        >
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
        <Button size="sm" tone="secondary" onclick={() => (cursor = frames.length - 1)}
          >Skip to final</Button
        >
      {/if}
    </div>
  {/if}

  {#if !finished && frame !== undefined}
    <div class="mt-4 grid gap-3 sm:grid-cols-2">
      {#each teams as team, index (team.teamId)}
        {@const active = index === 0 ? frame.homeUnit : frame.awayUnit}
        <div>
          <h4 class="text-sm font-semibold">{team.displayName} on court</h4>
          <ul class="mt-1 space-y-1 text-xs text-muted-foreground">
            {#each active as id (id)}
              <li>
                {team.players.find((player) => player.playerId === id)?.displayName ?? 'Player'}
              </li>
            {/each}
          </ul>
        </div>
      {/each}
    </div>
    {#if visibleFeed.length > 0}
      <ul aria-label="Recent game events" class="mt-4 space-y-1 text-xs text-muted-foreground">
        {#each visibleFeed as item (item)}
          <li>{clockLabel(item.clockSeconds)} · {item.caption}</li>
        {/each}
      </ul>
    {/if}
  {:else}
    {#if lineupReport !== null}
      <h4 class="mt-4 text-sm font-semibold">Lineup Lab</h4>
      <p class="mt-1 text-xs text-muted-foreground">
        {lineupReport.bench.points} bench points{#if lineupReport.teamBonusPoints > 0}
          · {lineupReport.teamBonusPoints} team bonus points{/if}. Asterisk marks lineups below {lineupReport.sampleThreshold}
        possessions.
      </p>
      <div class="overflow-x-auto">
        <table class="ui-stats-table mt-1" aria-label="Lineup Lab">
          <thead
            ><tr
              ><th scope="col" data-align="start">Lineup</th><th scope="col">MIN</th><th scope="col"
                >POSS</th
              ><th scope="col">NET RTG</th></tr
            ></thead
          >
          <tbody>
            {#each lineupReport.lineupRows as lineup (lineup.key)}
              <tr>
                <th scope="row" data-align="start"
                  >{lineup.players.map((player) => player.displayName).join(' · ')}</th
                >
                <td>{lineup.minutes.toFixed(1)}</td>
                <td>{lineup.pacePossessions}</td>
                <td>{lineup.netRatingPer100?.toFixed(1) ?? '—'}{lineup.sampleMet ? '' : ' *'}</td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
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
          <li>{player?.displayName ?? 'Player'} is expected to miss {injury.gamesMissed} games.</li>
        {/each}
      </ul>
    {/if}
    {#each teams as team (team.teamId)}
      <h4 class="mt-4 text-sm font-semibold">{team.displayName} box score</h4>
      <div class="overflow-x-auto">
        <PlayerStatsTable {columns} rows={team.players} rowKey={(player) => player.playerId}>
          {#snippet identity(player)}{player.displayName}{/snippet}
        </PlayerStatsTable>
      </div>
    {/each}
  {/if}
</Panel>
