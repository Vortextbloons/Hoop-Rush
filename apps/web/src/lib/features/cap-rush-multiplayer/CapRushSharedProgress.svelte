<script lang="ts">
  import type {
    CapRushLeagueGame,
    CapRushMultiplayerSeatId,
    CapRushMultiplayerState,
  } from '@hoop-rush/data-contracts';
  import { capRushMultiplayerSeatRecord } from '@hoop-rush/engine';
  import {
    capRushMultiplayerPendingH2H,
    capRushMultiplayerSlotAckPending,
  } from '@hoop-rush/application/cap-rush-multiplayer';
  import { seatLabelFor } from './cap-rush-multiplayer-presentation.js';

  let {
    state,
    localSeat,
    busy = false,
    onsimulate,
    onack,
    onfinishBroadcast,
  }: {
    state: CapRushMultiplayerState;
    localSeat: CapRushMultiplayerSeatId;
    busy?: boolean;
    onsimulate: () => void;
    onack: () => void;
    onfinishBroadcast: (gameId: string) => void;
  } = $props();

  const season = $derived(state.season);
  const locked = $derived(state.locked);
  const records = $derived(
    season === null || locked === null
      ? null
      : {
          p1: capRushMultiplayerSeatRecord(locked, season.games, 'p1'),
          p2: capRushMultiplayerSeatRecord(locked, season.games, 'p2'),
        },
  );
  const accepted = $derived(
    season === null || season.games.length === 0
      ? 0
      : Math.max(...season.games.map((game) => game.slot)),
  );
  const h2h = $derived(capRushMultiplayerPendingH2H({ state, locked }));
  const ackPending = $derived(
    season === null ? null : capRushMultiplayerSlotAckPending(season, localSeat),
  );
  const nextSlot = $derived(
    season === null ? null : accepted < season.block.endpoint ? accepted + 1 : null,
  );
  const progress = $derived(season === null ? 0 : Math.round((season.frontierSlot / 82) * 100));

  function teamName(teamId: string): string {
    if (locked === null) return teamId;
    if (locked.seats.p1.franchise.franchiseId === teamId)
      return locked.seats.p1.franchise.displayName;
    if (locked.seats.p2.franchise.franchiseId === teamId)
      return locked.seats.p2.franchise.displayName;
    return (
      locked.opponents.find((entry) => entry.team.teamId === teamId)?.team.displayName ?? teamId
    );
  }

  const latest = $derived(
    season === null || locked === null
      ? []
      : season.games
          .filter((game) => {
            const teamId = locked.seats[localSeat].franchise.franchiseId;
            return game.homeTeamId === teamId || game.awayTeamId === teamId;
          })
          .sort((left, right) => right.slot - left.slot)
          .slice(0, 3),
  );

  function resultLabel(game: CapRushLeagueGame): string {
    if (locked === null) return '';
    const teamId = locked.seats[localSeat].franchise.franchiseId;
    const home = game.homeTeamId === teamId;
    const own = home ? game.homePoints : game.awayPoints;
    const other = home ? game.awayPoints : game.homePoints;
    return own > other ? `W ${own}–${other}` : `L ${own}–${other}`;
  }

  function opponentName(game: CapRushLeagueGame): string {
    if (locked === null) return '';
    const teamId = locked.seats[localSeat].franchise.franchiseId;
    return teamName(game.homeTeamId === teamId ? game.awayTeamId : game.homeTeamId);
  }

  const h2hGame = $derived(
    h2h === null || season === null
      ? null
      : (season.games.find((game) => game.gameId === h2h.gameId) ?? null),
  );
</script>

{#if season === null || locked === null || records === null}
  <p class="text-sm text-muted-foreground">The season has not started.</p>
{:else}
  <section class="flex flex-col gap-4 rounded-2xl border border-border bg-card p-4">
    <header class="flex flex-wrap items-end justify-between gap-2">
      <div>
        <p class="font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
          Shared league
        </p>
        <h2 class="font-display text-2xl font-extrabold uppercase tracking-tight">
          Through game {season.frontierSlot}
        </h2>
      </div>
      <p class="font-mono text-xs text-muted-foreground tabular-nums">
        {season.games.length} / 1230 results accepted
      </p>
    </header>

    <div class="h-2 overflow-hidden rounded-full bg-surface-2">
      <div class="h-full bg-primary transition-[width]" style:width={`${progress}%`}></div>
    </div>

    <div class="grid gap-3 sm:grid-cols-2">
      {#each ['p1', 'p2'] as const as seat (seat)}
        <div class="rounded-xl border border-border bg-surface-2 p-3">
          <div class="flex items-baseline justify-between">
            <p class="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
              {seatLabelFor(seat, localSeat)}
            </p>
            <p class="font-mono text-sm font-semibold tabular-nums">
              {records[seat].wins}–{records[seat].losses}
            </p>
          </div>
          <p class="mt-1 text-[11px] text-muted-foreground">
            {locked.seats[seat].franchise.displayName} · {locked.seats[seat].payrollStatus.replace(
              '-',
              ' ',
            )}
          </p>
        </div>
      {/each}
    </div>

    {#if latest.length > 0}
      <ul class="flex flex-col gap-1.5">
        {#each latest as game (game.gameId)}
          <li class="flex items-center justify-between gap-2 text-xs">
            <span class="truncate text-muted-foreground">
              G{game.slot} vs {opponentName(game)}
            </span>
            <span class="font-mono font-semibold tabular-nums">{resultLabel(game)}</span>
          </li>
        {/each}
      </ul>
    {/if}

    {#if h2hGame !== null && h2h !== null}
      <div class="rounded-xl border border-accent/50 bg-accent/10 p-3">
        <p class="font-mono text-[10px] uppercase tracking-[0.16em] text-accent">
          Head-to-head · 2× broadcast
        </p>
        <p class="mt-1 font-display text-lg font-bold uppercase tracking-tight">
          {teamName(h2hGame.homeTeamId)}
          {h2hGame.homePoints} – {h2hGame.awayPoints}
          {teamName(h2hGame.awayTeamId)}
        </p>
        <p class="mt-1 text-xs text-muted-foreground">
          {h2h.missing.map((seat) => seatLabelFor(seat, localSeat)).join(' and ')} still watching.
        </p>
        {#if h2h.missing.includes(localSeat)}
          <button
            type="button"
            class="mt-2 inline-flex min-h-11 items-center justify-center rounded-xl border border-accent/60 bg-accent/15 px-4 text-sm font-bold text-accent
              disabled:opacity-40"
            disabled={busy}
            onclick={() => onfinishBroadcast(h2hGame.gameId)}
          >
            Continue head-to-head
          </button>
        {:else}
          <p class="mt-2 text-xs text-muted-foreground">
            Waiting for the other seat to finish the broadcast.
          </p>
        {/if}
      </div>
    {:else if localSeat === 'p1' && nextSlot !== null && season.block.status === 'running'}
      <button
        type="button"
        class="inline-flex min-h-11 items-center justify-center rounded-xl border border-primary/50 bg-primary/10 px-4 text-sm font-bold text-primary
          disabled:opacity-40"
        disabled={busy}
        onclick={onsimulate}
      >
        Sim slot {nextSlot}
      </button>
    {:else if ackPending !== null}
      <button
        type="button"
        class="inline-flex min-h-11 items-center justify-center rounded-xl border border-primary/50 bg-primary/10 px-4 text-sm font-bold text-primary
          disabled:opacity-40"
        disabled={busy}
        onclick={onack}
      >
        Ready for slot {ackPending}
      </button>
    {:else}
      <p class="text-xs text-muted-foreground">
        {localSeat === 'p1' ? 'Waiting for the other seat.' : 'Waiting for the host to simulate.'}
      </p>
    {/if}
  </section>
{/if}
