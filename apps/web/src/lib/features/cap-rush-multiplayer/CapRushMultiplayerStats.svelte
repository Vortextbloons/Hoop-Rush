<script lang="ts">
  import type {
    CapRushMultiplayerState,
    CapRushMultiplayerSeatId,
    CapRushBoxParticipant,
  } from '@hoop-rush/data-contracts';
  import PlayerFace from '#lib/components/PlayerFace.svelte';
  import PlayerStatsSection from '#lib/components/basketball/PlayerStatsSection.svelte';
  import type { PlayerStatColumn } from '#lib/components/player-stats-table.js';
  import { trueShootingPct, usagePct, usagePossessions } from '#lib/format.js';
  import type { CapRushArt } from '../cap-rush/cap-rush-art.js';
  import { initialsOf } from '../cap-rush/cap-rush-presentation.js';
  let {
    state: roomState,
    localSeat,
    art = null,
  }: {
    state: CapRushMultiplayerState;
    localSeat: CapRushMultiplayerSeatId;
    art?: CapRushArt | null;
  } = $props();
  let side = $state<'you' | 'opp'>('you');
  let totals = $state(false);
  const sideOptions = [
    { value: 'you', label: 'You' },
    { value: 'opp', label: 'Opponent' },
  ] as const;
  const seat = $derived(side === 'you' ? localSeat : localSeat === 'p1' ? 'p2' : 'p1');
  const rows = $derived.by(() => {
    const teamId = roomState.locked?.seats[seat].team.teamId;
    const players = new Map<string, CapRushBoxParticipant & { games: number }>();
    for (const game of roomState.season?.games ?? []) {
      const box =
        game.box.home.teamId === teamId
          ? game.box.home
          : game.box.away.teamId === teamId
            ? game.box.away
            : null;
      if (box === null) continue;
      const appeared = new Set<string>();
      for (const line of box.participants) {
        const previous = players.get(line.playerId);
        if (!previous) players.set(line.playerId, { ...line, games: 1 });
        else {
          for (const key of [
            'minutes',
            'points',
            'rebounds',
            'assists',
            'steals',
            'blocks',
            'turnovers',
            'fieldGoalsMade',
            'fieldGoalsAttempted',
            'threesMade',
            'threesAttempted',
            'freeThrowsMade',
            'freeThrowsAttempted',
          ] as const)
            previous[key] += line[key];
          if (!appeared.has(line.playerId)) previous.games += 1;
        }
        appeared.add(line.playerId);
      }
    }
    return [...players.values()];
  });
  const teamUsage = $derived(
    rows.reduce(
      (sum, row) =>
        sum + usagePossessions(row.fieldGoalsAttempted, row.freeThrowsAttempted, row.turnovers),
      0,
    ),
  );
  function value(total: number, games: number) {
    return totals ? String(total) : (total / Math.max(1, games)).toFixed(1);
  }
  function pct(made: number, attempted: number) {
    return attempted ? ((100 * made) / attempted).toFixed(1) + '%' : '?';
  }
  type AggregatedLine = CapRushBoxParticipant & { games: number };
  const statColumns: PlayerStatColumn<AggregatedLine>[] = [
    {
      key: 'points',
      label: 'PTS',
      value: (row) => value(row.points, row.games),
      cellClass: 'ui-stats-value-strong',
    },
    { key: 'rebounds', label: 'REB', value: (row) => value(row.rebounds, row.games) },
    { key: 'assists', label: 'AST', value: (row) => value(row.assists, row.games) },
    { key: 'steals', label: 'STL', value: (row) => value(row.steals, row.games) },
    { key: 'blocks', label: 'BLK', value: (row) => value(row.blocks, row.games) },
    { key: 'turnovers', label: 'TOV', value: (row) => value(row.turnovers, row.games) },
    {
      key: 'fieldGoalPct',
      label: 'FG%',
      value: (row) => pct(row.fieldGoalsMade, row.fieldGoalsAttempted),
    },
    {
      key: 'threePointPct',
      label: '3P%',
      value: (row) => pct(row.threesMade, row.threesAttempted),
    },
    {
      key: 'freeThrowPct',
      label: 'FT%',
      value: (row) => pct(row.freeThrowsMade, row.freeThrowsAttempted),
    },
    {
      key: 'trueShootingPct',
      label: 'TS%',
      value: (row) => trueShootingPct(row.points, row.fieldGoalsAttempted, row.freeThrowsAttempted),
    },
    {
      key: 'usagePct',
      label: 'USG%',
      value: (row) =>
        usagePct(
          usagePossessions(row.fieldGoalsAttempted, row.freeThrowsAttempted, row.turnovers),
          teamUsage,
        ),
    },
  ];
</script>

<PlayerStatsSection
  ariaLabel="Season player stats"
  title="Season player stats"
  {sideOptions}
  {side}
  onsidechange={(next) => (side = next)}
  values={totals ? 'totals' : 'game'}
  onvalueschange={(next) => (totals = next === 'totals')}
  rows={rows.length > 0 ? rows : null}
  columns={statColumns}
  rowKey={(row) => row.playerId}
  caption={`${side === 'you' ? 'Your' : 'Opponent'} regular season player stats`}
  note={`${totals ? 'Season totals' : 'Per-game averages'} · ${rows.length} players`}
>
  {#snippet identity(row)}
    {@const player = roomState.recruitment?.market.players.find(
      (entry) => entry.playerId === row.playerId,
    )}
    {@const face = player && art ? art.faceFor(player.source) : null}
    <span class="ui-stats-player">
      {#if face && art}
        <PlayerFace
          player={face}
          manifest={art.manifest}
          size="sm"
          fallbackInitials={initialsOf(row.displayName)}
        />
      {:else}
        <span class="ui-stats-player-fallback">{initialsOf(row.displayName)}</span>
      {/if}
      <span class="ui-stats-player-text">
        <span class="ui-stats-player-name">{row.displayName}</span>
        <span class="ui-stats-player-meta">{row.slot}</span>
      </span>
    </span>
  {/snippet}
  {#snippet empty()}
    <p class="ui-stats-empty">Box scores are not available on this device.</p>
  {/snippet}
</PlayerStatsSection>
