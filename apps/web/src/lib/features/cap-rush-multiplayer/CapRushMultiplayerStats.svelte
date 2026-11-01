<script lang="ts">
  import type {
    CapRushMultiplayerState,
    CapRushMultiplayerSeatId,
    CapRushBoxParticipant,
  } from '@hoop-rush/data-contracts';
  import PlayerFace from '#lib/components/PlayerFace.svelte';
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
</script>

<section class="player-stats" aria-label="Season player stats">
  <div class="stats-head">
    <h3>Season player stats</h3>
    <div class="stats-controls">
      <div class="segmented" role="group" aria-label="Roster">
        <button
          type="button"
          class:active={side === 'you'}
          aria-pressed={side === 'you'}
          onclick={() => (side = 'you')}>You</button
        >
        <button
          type="button"
          class:active={side === 'opp'}
          aria-pressed={side === 'opp'}
          onclick={() => (side = 'opp')}>Opponent</button
        >
      </div>
      <div class="segmented" role="group" aria-label="Stat values">
        <button
          type="button"
          class:active={!totals}
          aria-pressed={!totals}
          onclick={() => (totals = false)}>Per game</button
        >
        <button
          type="button"
          class:active={totals}
          aria-pressed={totals}
          onclick={() => (totals = true)}>Totals</button
        >
      </div>
    </div>
  </div>
  {#if rows.length > 0}
    <div class="stats-scroll">
      <table class="stats-table">
        <caption class="sr-only"
          >{side === 'you' ? 'Your' : 'Opponent'} regular season player stats</caption
        >
        <thead
          ><tr
            ><th scope="col" class="is-player">Player</th
            >{#each ['PTS', 'REB', 'AST', 'STL', 'BLK', 'TOV', 'FG%', '3P%', 'FT%', 'TS%', 'USG%'] as label (label)}<th
                scope="col">{label}</th
              >{/each}</tr
          ></thead
        >
        <tbody>
          {#each rows as row (row.playerId)}
            {@const player = roomState.recruitment?.market.players.find(
              (entry) => entry.playerId === row.playerId,
            )}
            {@const face = player && art ? art.faceFor(player.source) : null}
            <tr>
              <th scope="row" class="is-player"
                ><span class="player-cell">
                  {#if face && art}<PlayerFace
                      player={face}
                      manifest={art.manifest}
                      size="sm"
                      fallbackInitials={initialsOf(row.displayName)}
                    />{:else}<span class="player-fallback">{initialsOf(row.displayName)}</span>{/if}
                  <span
                    ><span class="player-name">{row.displayName}</span><span class="player-pos"
                      >{row.slot}</span
                    ></span
                  >
                </span></th
              >
              <td class="is-points">{value(row.points, row.games)}</td><td
                >{value(row.rebounds, row.games)}</td
              ><td>{value(row.assists, row.games)}</td><td>{value(row.steals, row.games)}</td><td
                >{value(row.blocks, row.games)}</td
              ><td>{value(row.turnovers, row.games)}</td>
              <td>{pct(row.fieldGoalsMade, row.fieldGoalsAttempted)}</td><td
                >{pct(row.threesMade, row.threesAttempted)}</td
              ><td>{pct(row.freeThrowsMade, row.freeThrowsAttempted)}</td><td
                >{trueShootingPct(row.points, row.fieldGoalsAttempted, row.freeThrowsAttempted)}</td
              ><td
                >{usagePct(
                  usagePossessions(row.fieldGoalsAttempted, row.freeThrowsAttempted, row.turnovers),
                  teamUsage,
                )}</td
              >
            </tr>
          {/each}
        </tbody>
      </table>
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

  .segmented {
    display: inline-flex;
    padding: 0.12rem;
    border: 1px solid var(--color-line-soft);
    border-radius: 0.5rem;
    background: var(--color-surface-2);
  }

  .segmented button {
    padding: 0.22rem 0.55rem;
    border-radius: 0.35rem;
    font-family: var(--font-mono);
    font-size: 0.6rem;
    font-weight: 700;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--color-muted-foreground);
    cursor: pointer;
    outline: none;
  }

  .segmented button.active {
    background: var(--color-primary);
    color: var(--color-primary-foreground);
  }

  .segmented button:focus-visible {
    outline: 2px solid var(--color-ring);
    outline-offset: 2px;
  }

  .stats-scroll {
    margin-top: 0.55rem;
    overflow-x: auto;
  }

  .stats-table {
    width: 100%;
    min-width: 38rem;
    border-collapse: collapse;
    font-size: 0.72rem;
    font-variant-numeric: tabular-nums;
  }

  .stats-table th,
  .stats-table td {
    padding: 0.32rem 0.42rem;
    text-align: right;
  }

  .stats-table thead th {
    border-bottom: 1px solid var(--color-line-soft);
    color: var(--color-muted-foreground);
    font-family: var(--font-mono);
    font-size: 0.56rem;
    font-weight: 700;
    letter-spacing: 0.08em;
  }

  .stats-table tbody tr {
    border-top: 1px solid color-mix(in srgb, var(--color-line-soft) 55%, transparent);
  }

  .stats-table tbody tr:first-child {
    border-top: 0;
  }

  .stats-table .is-player {
    width: 100%;
    max-width: 11rem;
    overflow: hidden;
    text-align: left;
    text-overflow: ellipsis;
  }

  .stats-table tbody th.is-player {
    font-weight: 600;
  }

  .stats-table .is-points {
    color: var(--color-foreground);
    font-weight: 800;
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
