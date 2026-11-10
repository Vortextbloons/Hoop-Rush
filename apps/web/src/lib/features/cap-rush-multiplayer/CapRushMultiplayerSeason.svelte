<script lang="ts">
  import { Tween, prefersReducedMotion } from 'svelte/motion';
  import { linear } from 'svelte/easing';
  import type {
    CapRushMultiplayerSeatId,
    CapRushMultiplayerState,
  } from '@hoop-rush/data-contracts';
  import TeamLogo from '#lib/components/TeamLogo.svelte';
  import type { CapRushArt } from '../cap-rush/cap-rush-art.js';
  import { initialsOf } from '../cap-rush/cap-rush-presentation.js';
  import CapRushStandings from '../cap-rush/CapRushStandings.svelte';
  import CapRushMultiplayerSchedule from './CapRushMultiplayerSchedule.svelte';
  import CapRushSeatLedger from './CapRushSeatLedger.svelte';
  import CapRushSharedProgress from './CapRushSharedProgress.svelte';
  import { capRushMultiplayerSeasonWindow } from './cap-rush-multiplayer-derived.js';
  import { seatLabelFor, seatOrder } from './cap-rush-multiplayer-presentation.js';

  let {
    state,
    localSeat,
    art = null,
    busy = false,
    broadcastLoading = false,
    onwatchh2h,
    onreviewgame,
  }: {
    state: CapRushMultiplayerState;
    localSeat: CapRushMultiplayerSeatId;
    art?: CapRushArt | null;
    busy?: boolean;
    broadcastLoading?: boolean;
    onwatchh2h: (gameId: string) => void;
    onreviewgame: (gameId: string) => void;
  } = $props();

  const animatedSlot = Tween.of(() => state.season?.frontierSlot ?? 0, {
    duration: (from, to) =>
      prefersReducedMotion.current ? 0 : Math.min(4000, Math.abs(to - from) * 300),
    easing: linear,
  });
  // The tween is continuous, but presentation only changes when the integer frontier changes.
  // Keeping this as a primitive stops every animation frame from rebuilding the season, records,
  // standings, and seat ledgers.
  const displayedSlot = $derived(Math.floor(animatedSlot.current));
  const displayedState = $derived({
    ...state,
    season:
      state.season === null
        ? null
        : {
            ...state.season,
            frontierSlot: displayedSlot,
            games: state.season.games.filter((game) => game.slot <= displayedSlot),
          },
  });
  const season = $derived(displayedState.season);
  const locked = $derived(state.locked);
  const orderedSeats = $derived(seatOrder(localSeat));
  const localTeamId = $derived(
    locked === null ? null : locked.seats[localSeat].franchise.franchiseId,
  );
  const window = $derived(
    state.season === null || locked === null
      ? null
      : capRushMultiplayerSeasonWindow(locked, state.season.games, displayedSlot),
  );
  const records = $derived(window?.records ?? null);
  const standings = $derived(window?.standings ?? null);
</script>

{#if season === null || locked === null || records === null}
  <section
    class="rounded-2xl border border-border bg-card p-3 sm:p-4"
    data-cap-rush-multiplayer-season
  >
    <p class="text-sm text-muted-foreground">The shared season is not ready yet.</p>
  </section>
{:else}
  <div class="flex min-w-0 flex-col gap-4" data-cap-rush-multiplayer-season>
    <CapRushSharedProgress
      {state}
      {displayedSlot}
      {localSeat}
      {art}
      {busy}
      {broadcastLoading}
      onwatchh2h={(gameId) => onwatchh2h(gameId)}
    />

    <div class="grid min-w-0 items-start gap-4 xl:grid-cols-[minmax(0,1.65fr)_minmax(0,1fr)]">
      <CapRushMultiplayerSchedule
        state={displayedState}
        {localSeat}
        {art}
        {busy}
        onreviewgame={(gameId) => onreviewgame(gameId)}
      />

      <aside
        class="grid min-w-0 gap-3 md:grid-cols-2 xl:grid-cols-1"
        aria-label="Team payroll and rosters"
      >
        {#each orderedSeats as seat (seat)}
          {@const franchise = locked.seats[seat].franchise}
          {@const record = records[seat]}
          {@const team = art === null ? null : art.teamFor(franchise.franchiseId)}
          <div class="flex min-w-0 flex-col gap-2" data-seat={seat}>
            <header
              class="flex min-w-0 items-center gap-3 rounded-2xl border bg-card px-3 py-3 sm:px-4 {seat ===
              localSeat
                ? 'border-primary/40'
                : 'border-border'}"
            >
              {#if team !== null && art !== null}
                <TeamLogo
                  manifest={art.manifest}
                  franchiseId={team.franchiseId}
                  teamExternalId={team.teamExternalId}
                  className="h-10 w-10 shrink-0"
                />
              {:else}
                <span
                  class="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-surface-3 font-display text-xs font-extrabold text-muted-foreground"
                  aria-hidden="true">{initialsOf(franchise.displayName)}</span
                >
              {/if}
              <div class="min-w-0 flex-1">
                <p
                  class="font-mono text-[10px] font-bold tracking-[0.12em] text-muted-foreground uppercase"
                >
                  {seatLabelFor(seat, localSeat)}
                </p>
                <p class="truncate font-display text-lg leading-tight font-extrabold uppercase">
                  {franchise.displayName}
                </p>
              </div>
              <p class="shrink-0 font-display text-2xl font-extrabold tabular-nums sm:text-3xl">
                {record.wins}–{record.losses}
              </p>
            </header>
            <CapRushSeatLedger state={displayedState} {seat} {localSeat} {art} />
          </div>
        {/each}
      </aside>
    </div>

    <section class="min-w-0" aria-label="Shared standings">
      {#if standings !== null}
        <CapRushStandings {standings} manifest={art?.manifest ?? null} userTeamId={localTeamId} />
      {:else}
        <div
          class="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 rounded-2xl border border-border bg-card px-4 py-3"
        >
          <p
            class="font-mono text-[10px] font-bold tracking-[0.14em] text-muted-foreground uppercase"
          >
            Standings
          </p>
          <p class="text-sm text-muted-foreground">
            Final standings unlock after slot 82. {season.games.length} of 1230 results accepted.
          </p>
        </div>
      {/if}
    </section>
  </div>
{/if}
