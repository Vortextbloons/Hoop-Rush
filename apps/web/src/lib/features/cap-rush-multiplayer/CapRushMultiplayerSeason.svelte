<script lang="ts">
  import type {
    CapRushMultiplayerSeatId,
    CapRushMultiplayerState,
  } from '@hoop-rush/data-contracts';
  import { CAP_RUSH_MULTIPLAYER_LEAGUE_GAMES } from '@hoop-rush/data-contracts';
  import { capRushMultiplayerSeatRecord, capRushMultiplayerStandings } from '@hoop-rush/engine';
  import TeamLogo from '#lib/components/TeamLogo.svelte';
  import type { CapRushArt } from '../cap-rush/cap-rush-art.js';
  import { initialsOf } from '../cap-rush/cap-rush-presentation.js';
  import CapRushStandings from '../cap-rush/CapRushStandings.svelte';
  import CapRushSeatLedger from './CapRushSeatLedger.svelte';
  import CapRushSharedProgress from './CapRushSharedProgress.svelte';
  import { seatLabelFor, seatOrder } from './cap-rush-multiplayer-presentation.js';

  let {
    state,
    localSeat,
    art = null,
    busy = false,
    onwatchh2h,
    onreviewgame,
  }: {
    state: CapRushMultiplayerState;
    localSeat: CapRushMultiplayerSeatId;
    art?: CapRushArt | null;
    busy?: boolean;
    onwatchh2h: (gameId: string) => void;
    onreviewgame: (gameId: string) => void;
  } = $props();

  const season = $derived(state.season);
  const locked = $derived(state.locked);
  const orderedSeats = $derived(seatOrder(localSeat));
  const localTeamId = $derived(
    locked === null ? null : locked.seats[localSeat].franchise.franchiseId,
  );
  const records = $derived(
    season === null || locked === null
      ? null
      : {
          p1: capRushMultiplayerSeatRecord(locked, season.games, 'p1'),
          p2: capRushMultiplayerSeatRecord(locked, season.games, 'p2'),
        },
  );
  const standings = $derived.by(() => {
    if (season === null || locked === null) return null;
    try {
      return capRushMultiplayerStandings(locked, season.games);
    } catch {
      return null;
    }
  });
</script>

{#if season === null || locked === null || records === null}
  <section class="rounded-2xl border border-border bg-card p-4" data-cap-rush-multiplayer-season>
    <p class="text-sm text-muted-foreground">The shared season is not ready yet.</p>
  </section>
{:else}
  <div class="flex min-w-0 flex-col gap-4" data-cap-rush-multiplayer-season>
    <div class="grid min-w-0 gap-4 lg:grid-cols-[minmax(0,1fr)_18rem]">
      <div class="flex min-w-0 flex-col gap-4">
        <CapRushSharedProgress
          {state}
          {localSeat}
          {art}
          {busy}
          onwatchh2h={(gameId) => onwatchh2h(gameId)}
          onreviewgame={(gameId) => onreviewgame(gameId)}
        />
      </div>

      <aside class="flex min-w-0 flex-col gap-3" aria-label="Team payroll and rosters">
        {#each orderedSeats as seat (seat)}
          {@const franchise = locked.seats[seat].franchise}
          {@const record = records[seat]}
          {@const team = art === null ? null : art.teamFor(franchise.franchiseId)}
          <div class="flex min-w-0 flex-col gap-2" data-seat={seat}>
            <header
              class="flex min-w-0 items-center gap-2 rounded-xl border bg-card px-2.5 py-2 {seat ===
              localSeat
                ? 'border-primary/40'
                : 'border-border'}"
            >
              {#if team !== null && art !== null}
                <TeamLogo
                  manifest={art.manifest}
                  franchiseId={team.franchiseId}
                  teamExternalId={team.teamExternalId}
                  className="h-6 w-6"
                />
              {:else}
                <span
                  class="grid h-6 w-6 shrink-0 place-items-center rounded bg-surface-3 font-display text-[9px] font-extrabold text-muted-foreground"
                  aria-hidden="true">{initialsOf(franchise.displayName)}</span
                >
              {/if}
              <div class="min-w-0 flex-1">
                <p
                  class="font-mono text-[8px] font-bold tracking-[0.1em] text-muted-foreground uppercase"
                >
                  {seatLabelFor(seat, localSeat)}
                </p>
                <p class="truncate font-display text-sm leading-tight font-extrabold uppercase">
                  {franchise.displayName}
                </p>
              </div>
              <p class="shrink-0 font-mono text-xs font-semibold tabular-nums">
                {record.wins}–{record.losses}
              </p>
            </header>
            <CapRushSeatLedger {state} {seat} {localSeat} {art} />
          </div>
        {/each}
        <p class="px-1 text-[11px] leading-relaxed text-muted-foreground">
          Both rosters are locked in for the shared 82-game season.
        </p>
      </aside>
    </div>

    <section class="min-w-0" aria-label="Shared standings">
      {#if standings !== null}
        <CapRushStandings {standings} manifest={art?.manifest ?? null} userTeamId={localTeamId} />
      {:else}
        <div class="rounded-2xl border border-border bg-card p-4">
          <p class="font-mono text-[10px] tracking-[0.16em] text-muted-foreground uppercase">
            Standings
          </p>
          <h2 class="font-display text-2xl font-extrabold tracking-tight uppercase">
            Final standings unlock after the last slot
          </h2>
          <p class="mt-1 text-sm text-muted-foreground">
            All {CAP_RUSH_MULTIPLAYER_LEAGUE_GAMES} shared games must be accepted before seeds can be
            built.
            {season.games.length} accepted so far.
          </p>
        </div>
      {/if}
    </section>
  </div>
{/if}
