<script lang="ts">
  import type {
    CapRushMultiplayerState,
    CapRushMultiplayerSeatId,
    CapRushBoxParticipant,
  } from '@hoop-rush/data-contracts';
  import PlayerFace from '#lib/components/PlayerFace.svelte';
  import PlayerStatsTable from '#lib/components/PlayerStatsTable.svelte';
  import type { PlayerStatColumn } from '#lib/components/player-stats-table.js';
  import SegmentedControl from '#lib/components/ui/SegmentedControl.svelte';
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
      cellClass: 'font-bold text-foreground',
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

<section class="player-stats" aria-label="Season player stats">
  <div class="stats-head">
    <h3>Season player stats</h3>
    <div class="stats-controls">
      <SegmentedControl
        label="Roster"
        value={side}
        onchange={(next) => (side = next)}
        options={[
          { value: 'you', label: 'You' },
          { value: 'opp', label: 'Opponent' },
        ]}
      />
      <SegmentedControl
        label="Stat values"
        value={totals ? 'totals' : 'game'}
        onchange={(next) => (totals = next === 'totals')}
        options={[
          { value: 'game', label: 'Per game' },
          { value: 'totals', label: 'Totals' },
        ]}
      />
    </div>
  </div>
  {#if rows.length > 0}
    <div class="stats-scroll">
      <PlayerStatsTable
        columns={statColumns}
        {rows}
        rowKey={(row) => row.playerId}
        caption={`${side === 'you' ? 'Your' : 'Opponent'} regular season player stats`}
        tableClass="min-w-[38rem] text-xs"
        headClass="border-b border-line-soft font-mono text-[0.56rem] tracking-[0.08em] text-muted-foreground"
        rowClass={() => 'border-t border-line-soft'}
        playerCellClass="w-full max-w-44 overflow-hidden text-left font-semibold"
        playerHeadCellClass="w-full max-w-44 text-left"
        headCellClass="px-[0.42rem] py-[0.32rem] text-right"
        statCellClass="px-[0.42rem] py-[0.32rem] text-right"
      >
        {#snippet identity(row)}
          {@const player = roomState.recruitment?.market.players.find(
            (entry) => entry.playerId === row.playerId,
          )}
          {@const face = player && art ? art.faceFor(player.source) : null}
          <span class="player-cell">
            {#if face && art}
              <PlayerFace
                player={face}
                manifest={art.manifest}
                size="sm"
                fallbackInitials={initialsOf(row.displayName)}
              />
            {:else}
              <span class="player-fallback">{initialsOf(row.displayName)}</span>
            {/if}
            <span>
              <span class="player-name">{row.displayName}</span>
              <span class="player-pos">{row.slot}</span>
            </span>
          </span>
        {/snippet}
      </PlayerStatsTable>
    </div>
    <p class="panel-note">
      {totals ? 'Season totals' : 'Per-game averages'} · {rows.length} players
    </p>
  {:else}<p class="panel-note">Box scores are not available on this device.</p>{/if}
</section>

<style>
  .player-stats {
    padding: 0.85rem 1rem;
    border: 1px solid var(--color-line-soft);
    border-radius: 0.75rem;
    background: var(--color-surface-1);
    min-width: 0;
  }
  h3 {
    margin: 0;
    font-family: var(--font-mono);
    font-size: 0.66rem;
    font-weight: 700;
    letter-spacing: 0.16em;
    color: var(--color-primary);
    text-transform: uppercase;
  }
  .panel-note {
    margin: 0.5rem 0 0;
    font-family: var(--font-mono);
    font-size: 0.6rem;
    color: var(--color-muted-foreground);
  }
  .stats-head {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: 0.5rem 0.75rem;
  }

  .stats-controls {
    display: flex;
    flex-wrap: wrap;
    gap: 0.4rem;
  }

  .stats-scroll {
    margin-top: 0.55rem;
    overflow-x: auto;
  }

  .player-cell {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    min-width: 0;
  }
  .player-name {
    display: block;
    font-weight: 600;
    white-space: nowrap;
  }
  .player-pos {
    display: block;
    color: var(--color-muted-foreground);
    font-family: var(--font-mono);
    font-size: 0.6rem;
  }
  .player-fallback {
    display: grid;
    place-items: center;
    width: 2rem;
    height: 2rem;
    flex-shrink: 0;
    border-radius: 0.4rem;
    background: var(--color-surface-3);
    font-size: 0.65rem;
  }
</style>
