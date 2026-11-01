<script lang="ts">
  import type {
    CapRushLeagueGame,
    CapRushMultiplayerSeatId,
    CapRushMultiplayerState,
  } from '@hoop-rush/data-contracts';
  import { capRushMultiplayerSeatRecord } from '@hoop-rush/engine';
  import { capRushMultiplayerPendingH2H } from '@hoop-rush/application/cap-rush-multiplayer';
  import TeamLogo from '#lib/components/TeamLogo.svelte';
  import type { CapRushArt } from '../cap-rush/cap-rush-art.js';
  import { capStatusLabel } from '../cap-rush/cap-rush-presentation.js';
  import { seatLabelFor, seatOrder } from './cap-rush-multiplayer-presentation.js';

  type StepAction = 'watch-h2h' | null;

  interface NextStep {
    readonly title: string;
    readonly detail: string;
    readonly action: StepAction;
    readonly actionLabel: string;
    readonly mine: boolean;
  }

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
    onreviewgame?: (gameId: string) => void;
  } = $props();

  const season = $derived(state.season);
  const locked = $derived(state.locked);
  const orderedSeats = $derived(seatOrder(localSeat));
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
  const progress = $derived(season === null ? 0 : Math.round((season.frontierSlot / 82) * 100));
  const h2hGame = $derived(
    h2h === null || season === null
      ? null
      : (season.games.find((game) => game.gameId === h2h.gameId) ?? null),
  );

  const reviewGames = $derived.by((): CapRushLeagueGame[] => {
    if (season === null || locked === null) return [];
    const localTeamId = locked.seats[localSeat].franchise.franchiseId;
    const humanTeamIds = new Set([
      locked.seats.p1.franchise.franchiseId,
      locked.seats.p2.franchise.franchiseId,
    ]);
    const localGames = season.games
      .filter((game) => game.homeTeamId === localTeamId || game.awayTeamId === localTeamId)
      .sort((left, right) => right.slot - left.slot)
      .slice(0, 5);
    const latestH2H =
      season.games
        .filter((game) => humanTeamIds.has(game.homeTeamId) && humanTeamIds.has(game.awayTeamId))
        .sort((left, right) => right.slot - left.slot)[0] ?? null;
    const merged = new Map(localGames.map((game) => [game.gameId, game]));
    if (latestH2H !== null) merged.set(latestH2H.gameId, latestH2H);
    return [...merged.values()].sort((left, right) => right.slot - left.slot);
  });

  const nextStep = $derived.by((): NextStep => {
    if (season === null) {
      return {
        title: 'The shared season is not ready.',
        detail: '',
        action: null,
        actionLabel: '',
        mine: false,
      };
    }

    if (h2h !== null) {
      const localMissing = h2h.missing.includes(localSeat);
      const otherMissing = h2h.missing.filter((seat) => seat !== localSeat);
      const detail = localMissing
        ? otherMissing.length > 0
          ? `Both seats must finish the head-to-head broadcast before slot ${h2h.slot} can be accepted.`
          : `Finish the head-to-head broadcast to accept slot ${h2h.slot}.`
        : `Waiting for ${otherMissing
            .map((seat) => seatLabelFor(seat, localSeat))
            .join(' and ')} to finish the head-to-head broadcast.`;
      return {
        title: `Head-to-head result ready · slot ${h2h.slot}`,
        detail,
        action: localMissing ? 'watch-h2h' : null,
        actionLabel: 'Watch head-to-head',
        mine: localMissing,
      };
    }

    return {
      title: 'Simulating the season',
      detail:
        'Regular games advance automatically. Simcast opens for head-to-head games between both players.',
      action: null,
      actionLabel: '',
      mine: false,
    };
  });

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

  function isH2H(game: CapRushLeagueGame): boolean {
    if (locked === null) return false;
    const home =
      game.homeTeamId === locked.seats.p1.franchise.franchiseId ||
      game.homeTeamId === locked.seats.p2.franchise.franchiseId;
    const away =
      game.awayTeamId === locked.seats.p1.franchise.franchiseId ||
      game.awayTeamId === locked.seats.p2.franchise.franchiseId;
    return home && away;
  }

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
</script>

{#if season === null || locked === null || records === null}
  <p class="text-sm text-muted-foreground">The shared season is not ready yet.</p>
{:else}
  <section
    class="flex min-w-0 flex-col gap-4 rounded-2xl border border-border bg-card p-3 sm:p-4"
    data-cap-rush-shared-progress
  >
    <header class="flex min-w-0 flex-col gap-2">
      <div class="flex flex-wrap items-end justify-between gap-2">
        <div class="min-w-0">
          <p class="font-mono text-[10px] tracking-[0.16em] text-muted-foreground uppercase">
            Shared season
          </p>
          <h2 class="font-display text-xl font-extrabold tracking-tight uppercase sm:text-2xl">
            Through game {season.frontierSlot} of 82
          </h2>
        </div>
        <p class="shrink-0 font-mono text-xs text-muted-foreground tabular-nums">
          {season.games.length} / 1230 results accepted
        </p>
      </div>
      <div
        class="h-2 overflow-hidden rounded-full bg-surface-2"
        role="progressbar"
        aria-label="Shared season progress"
        aria-valuemin={0}
        aria-valuemax={82}
        aria-valuenow={season.frontierSlot}
      >
        <div
          class="h-full bg-primary transition-[width] motion-reduce:transition-none"
          style:width={`${progress}%`}
        ></div>
      </div>
    </header>

    <ul class="grid min-w-0 gap-2 sm:grid-cols-2">
      {#each orderedSeats as seat (seat)}
        {@const record = records[seat]}
        {@const team = art === null ? null : art.teamFor(locked.seats[seat].franchise.franchiseId)}
        <li
          class="min-w-0 rounded-xl border bg-surface-2 p-3 {seat === localSeat
            ? 'border-primary/40'
            : 'border-border'}"
          data-seat={seat}
        >
          <div class="flex items-baseline justify-between gap-2">
            <span class="flex min-w-0 items-center gap-1.5">
              {#if team !== null && art !== null}
                <TeamLogo
                  manifest={art.manifest}
                  franchiseId={team.franchiseId}
                  teamExternalId={team.teamExternalId}
                  className="h-4 w-4"
                />
              {/if}
              <span
                class="truncate font-mono text-[10px] font-semibold tracking-[0.12em] text-muted-foreground uppercase"
              >
                {seatLabelFor(seat, localSeat)}
              </span>
            </span>
            <p class="shrink-0 font-mono text-sm font-semibold tabular-nums">
              {record.wins}–{record.losses}
            </p>
          </div>
          <p class="mt-1 truncate text-[11px] text-muted-foreground">
            {locked.seats[seat].franchise.displayName} · {capStatusLabel(
              locked.seats[seat].payrollStatus,
            )}
          </p>
          <p class="mt-0.5 font-mono text-[10px] text-muted-foreground tabular-nums">
            {record.played} played · {record.pointsFor} for · {record.pointsAgainst} against
          </p>
        </li>
      {/each}
    </ul>

    <div
      class="flex min-w-0 flex-col gap-2 rounded-xl border p-3 {nextStep.mine
        ? 'border-primary/40 bg-primary/5'
        : 'border-border bg-surface-2'}"
      role="status"
      data-step={nextStep.action ?? 'waiting'}
    >
      <p
        class="font-mono text-[10px] font-bold tracking-[0.14em] uppercase {nextStep.mine
          ? 'text-primary'
          : 'text-muted-foreground'}"
      >
        {nextStep.mine ? 'Your move' : h2h === null ? 'Season in progress' : 'Waiting for opponent'}
      </p>
      <p class="font-display text-lg leading-tight font-bold tracking-tight uppercase">
        {nextStep.title}
      </p>
      {#if h2hGame !== null}
        <p class="font-mono text-xs font-semibold tabular-nums">
          {teamName(h2hGame.homeTeamId)}
          {h2hGame.homePoints}–{h2hGame.awayPoints}
          {teamName(h2hGame.awayTeamId)}
        </p>
      {/if}
      <p class="text-xs leading-relaxed text-muted-foreground">{nextStep.detail}</p>
      {#if nextStep.action === 'watch-h2h' && h2hGame !== null}
        <button
          type="button"
          class="inline-flex min-h-11 w-fit items-center justify-center rounded-xl border border-primary/50 bg-primary/10 px-4 text-sm font-bold text-primary outline-none
            focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-40"
          disabled={busy}
          onclick={() => onwatchh2h(h2hGame.gameId)}
        >
          {nextStep.actionLabel}
        </button>
      {/if}
    </div>

    <div class="flex min-w-0 flex-col gap-1.5">
      <div class="flex flex-wrap items-baseline justify-between gap-x-2 gap-y-1">
        <p class="font-mono text-[10px] tracking-[0.14em] text-muted-foreground uppercase">
          Accepted results
        </p>
        <p class="text-[11px] text-muted-foreground">Replays never advance the season.</p>
      </div>
      {#if reviewGames.length === 0}
        <p class="text-xs text-muted-foreground">No results accepted yet.</p>
      {:else}
        <ul class="flex min-w-0 flex-col gap-1">
          {#each reviewGames as game (game.gameId)}
            <li
              class="flex min-w-0 flex-wrap items-center justify-between gap-2 rounded-lg border border-line-soft bg-surface-1 px-2 py-1.5"
            >
              <span
                class="flex min-w-0 flex-1 flex-wrap items-baseline gap-x-1.5 gap-y-0.5 text-xs"
              >
                <span class="shrink-0 font-mono text-[10px] text-muted-foreground"
                  >G{game.slot}</span
                >
                <span class="min-w-0 truncate text-muted-foreground">vs {opponentName(game)}</span>
                {#if isH2H(game)}
                  <span
                    class="shrink-0 rounded border border-accent/50 px-1 py-0.5 font-mono text-[8px] font-bold text-accent uppercase"
                    >H2H</span
                  >
                {/if}
              </span>
              <span class="flex shrink-0 items-center gap-2">
                <span class="font-mono text-xs font-semibold tabular-nums">{resultLabel(game)}</span
                >
                {#if onreviewgame && isH2H(game)}
                  <button
                    type="button"
                    class="inline-flex min-h-11 items-center justify-center rounded-lg border border-border bg-surface-2 px-3 text-xs font-semibold outline-none
                      focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-40"
                    disabled={busy}
                    aria-label={`Review game ${game.slot} against ${opponentName(game)}`}
                    onclick={() => onreviewgame?.(game.gameId)}
                  >
                    Review
                  </button>
                {/if}
              </span>
            </li>
          {/each}
        </ul>
      {/if}
    </div>
  </section>
{/if}
