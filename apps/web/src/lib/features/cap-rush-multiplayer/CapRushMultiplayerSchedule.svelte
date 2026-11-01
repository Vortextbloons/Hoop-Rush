<script lang="ts">
  import type {
    CapRushMultiplayerSeatId,
    CapRushMultiplayerState,
  } from '@hoop-rush/data-contracts';
  import { franchiseAbbreviation } from '@hoop-rush/data-contracts';
  import type { CapRushArt } from '../cap-rush/cap-rush-art.js';
  import {
    type CapRushSeatScheduleCell,
    seatScheduleCells,
  } from './cap-rush-multiplayer-presentation.js';

  let {
    state,
    localSeat,
    art = null,
    busy = false,
    onreviewgame,
  }: {
    state: CapRushMultiplayerState;
    localSeat: CapRushMultiplayerSeatId;
    art?: CapRushArt | null;
    busy?: boolean;
    onreviewgame: (gameId: string) => void;
  } = $props();

  const season = $derived(state.season);
  const locked = $derived(state.locked);
  const teamId = $derived(locked === null ? null : locked.seats[localSeat].franchise.franchiseId);
  const opponentTeamId = $derived(
    locked === null ? null : locked.seats[localSeat === 'p1' ? 'p2' : 'p1'].franchise.franchiseId,
  );
  const cells = $derived(
    season === null || locked === null || teamId === null || opponentTeamId === null
      ? []
      : seatScheduleCells({
          schedule: locked.leagueSchedule,
          games: season.games,
          teamId,
          opponentTeamId,
        }),
  );
  const played = $derived(cells.filter((cell) => cell.played).length);
  const remaining = $derived(cells.length - played);
  const recent = $derived(
    cells
      .filter((cell) => cell.played)
      .sort((left, right) => right.slot - left.slot)
      .slice(0, 5),
  );

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

  function opponentLabel(cell: CapRushSeatScheduleCell): string {
    return art?.teamFor(cell.opponentId)?.abbreviation ?? franchiseAbbreviation(cell.opponentId);
  }

  function cellLabel(cell: CapRushSeatScheduleCell): string {
    const opponent = teamName(cell.opponentId);
    if (!cell.played) {
      return `Game ${String(cell.slot)} ${cell.humanHome ? 'versus' : 'at'} ${opponent}, not played`;
    }
    return `Game ${String(cell.slot)} ${cell.humanHome ? 'versus' : 'at'} ${opponent}, ${
      cell.won ? 'win' : 'loss'
    } ${String(cell.pointsFor)} to ${String(cell.pointsAgainst)}${
      cell.h2h ? ', head-to-head' : ''
    }`;
  }

  function reviewable(cell: CapRushSeatScheduleCell): boolean {
    return cell.played && !busy;
  }
</script>

{#if season === null || locked === null || cells.length === 0}
  <p class="text-sm text-muted-foreground">The shared schedule is not ready yet.</p>
{:else}
  <section
    class="flex min-w-0 flex-col gap-4 rounded-2xl border border-border bg-card p-4 sm:p-5"
    aria-label={`${played} of ${cells.length} games played`}
  >
    <header class="flex flex-wrap items-end justify-between gap-3">
      <div class="min-w-0">
        <p class="font-mono text-[10px] font-bold tracking-[0.16em] text-primary uppercase">
          Your schedule
        </p>
        <h2 class="mt-1 font-display text-3xl font-extrabold tracking-tight uppercase">
          {played} played · {remaining} left
        </h2>
      </div>
      <p class="font-mono text-[10px] tracking-[0.08em] text-muted-foreground uppercase">
        {played > 0 ? 'Select any result to review' : 'Results appear slot by slot'}
      </p>
    </header>

    <ol
      class="grid grid-cols-4 gap-1.5 sm:grid-cols-6 lg:grid-cols-8 2xl:grid-cols-10"
      aria-label="82-game schedule"
    >
      {#each cells as cell (cell.gameId)}
        <li class="min-w-0">
          <button
            type="button"
            aria-label={cellLabel(cell)}
            title={reviewable(cell) ? `Review ${cellLabel(cell)}` : undefined}
            disabled={!reviewable(cell)}
            onclick={() => onreviewgame?.(cell.gameId)}
            class="flex min-h-16 w-full min-w-0 flex-col justify-center gap-0.5 rounded-lg border px-2 py-1.5 text-left outline-none
              focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-default {cell.played
              ? cell.won
                ? 'border-positive/40 bg-positive/10 text-foreground'
                : 'border-negative/40 bg-negative/10 text-foreground'
              : 'border-dashed border-line-soft bg-background/40 text-muted-foreground'} {cell.h2h
              ? 'ring-1 ring-inset ring-accent/40'
              : ''}"
          >
            <span class="flex items-baseline justify-between gap-1">
              <span class="font-mono text-[9px] font-bold tabular-nums opacity-70"
                >G{cell.slot}</span
              >
              {#if cell.h2h}
                <span class="font-mono text-[8px] font-bold text-accent uppercase">H2H</span>
              {:else if cell.played}
                <span
                  class="font-mono text-[9px] font-extrabold uppercase {cell.won
                    ? 'text-positive'
                    : 'text-negative'}">{cell.won ? 'W' : 'L'}</span
                >
              {:else}
                <span class="font-mono text-[9px] font-extrabold uppercase"
                  >{cell.humanHome ? 'vs' : '@'}</span
                >
              {/if}
            </span>
            <span class="truncate font-mono text-[11px] font-bold">{opponentLabel(cell)}</span>
            <span class="truncate font-mono text-[9px] tabular-nums opacity-80">
              {cell.played ? `${cell.pointsFor}–${cell.pointsAgainst}` : '—'}
            </span>
          </button>
        </li>
      {/each}
    </ol>

    {#if recent.length > 0}
      <div class="flex min-w-0 flex-col gap-2 border-t border-line-soft pt-3">
        <p
          class="font-mono text-[10px] font-bold tracking-[0.14em] text-muted-foreground uppercase"
        >
          Recent results
        </p>
        <ul class="grid min-w-0 gap-1.5 sm:grid-cols-2">
          {#each recent as cell (cell.gameId)}
            <li
              class="flex min-w-0 items-center justify-between gap-2 rounded-lg border border-line-soft bg-surface-1 px-2.5 py-2"
            >
              <span class="min-w-0 truncate text-xs">
                <span class="font-mono text-[9px] text-muted-foreground">G{cell.slot}</span>
                <span class="text-muted-foreground"> {cell.humanHome ? 'vs' : '@'} </span>
                <span class="font-semibold">{teamName(cell.opponentId)}</span>
                {#if cell.h2h}
                  <span class="ml-1 font-mono text-[8px] font-bold text-accent uppercase">H2H</span>
                {/if}
              </span>
              <span class="flex shrink-0 items-center gap-2">
                <span class="font-mono text-xs font-semibold tabular-nums">
                  {cell.won ? 'W' : 'L'}
                  {cell.pointsFor}–{cell.pointsAgainst}
                </span>
                <button
                  type="button"
                  class="inline-flex min-h-9 items-center justify-center rounded-lg border border-border bg-surface-2 px-2.5 text-xs font-semibold outline-none
                    focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-40"
                  disabled={busy}
                  aria-label={`Review game ${cell.slot} against ${teamName(cell.opponentId)}`}
                  onclick={() => onreviewgame(cell.gameId)}
                >
                  Review
                </button>
              </span>
            </li>
          {/each}
        </ul>
      </div>
    {/if}
  </section>
{/if}
