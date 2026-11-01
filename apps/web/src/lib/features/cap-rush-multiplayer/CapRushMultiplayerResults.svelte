<script lang="ts">
  import { Crown, Trophy } from '@lucide/svelte';
  import type {
    CapRushLeagueGame,
    CapRushMultiplayerSeatId,
    CapRushMultiplayerState,
    CapRushPostseasonUserOutcome,
  } from '@hoop-rush/data-contracts';
  import { capRushConferenceRoundName } from '@hoop-rush/data-contracts';
  import { capRushLeagueMvp, capRushMultiplayerSeatRecord } from '@hoop-rush/engine';
  import PlayerFace from '#lib/components/PlayerFace.svelte';
  import TeamLogo from '#lib/components/TeamLogo.svelte';
  import type { CapRushArt } from '../cap-rush/cap-rush-art.js';
  import { capStatusClass, capStatusLabel, initialsOf } from '../cap-rush/cap-rush-presentation.js';
  import CapRushMultiplayerStats from './CapRushMultiplayerStats.svelte';
  import CapRushMultiplayerRoster from './CapRushMultiplayerRoster.svelte';
  import {
    money,
    seatLabelFor,
    seatOrder,
    teamNameOf,
  } from './cap-rush-multiplayer-presentation.js';

  let {
    state,
    localSeat,
    art = null,
    onreviewgame,
  }: {
    state: CapRushMultiplayerState;
    localSeat: CapRushMultiplayerSeatId;
    art?: CapRushArt | null;
    onreviewgame?: (gameId: string) => void;
  } = $props();

  const seasonMvp = $derived.by(() => {
    if (state.locked === null || state.season === null || state.season.games.length !== 1230)
      return null;
    return capRushLeagueMvp({
      locked: { human: state.locked.seats[localSeat].team, opponents: state.locked.opponents },
      games: [],
      leagueGames: state.season.games,
    }).mvp;
  });
  const finalsMvp = $derived(state.report?.finalsMvp ?? state.postseason?.finalsMvp ?? null);
  const report = $derived(state.report);
  const locked = $derived(state.locked);
  const season = $derived(state.season);
  const postseason = $derived(state.postseason);
  const championTeamId = $derived(
    report?.championTeamId ??
      postseason?.championTeamId ??
      state.completion?.championTeamId ??
      null,
  );
  const championName = $derived(championTeamId === null ? null : teamName(championTeamId));
  const championTeam = $derived(
    championTeamId === null || art === null ? null : art.teamFor(championTeamId),
  );
  const seatViews = $derived.by(() =>
    seatOrder(localSeat).map((seat) => {
      const seatReport = report?.seats[seat] ?? null;
      const lock = locked?.seats[seat] ?? null;
      const fallbackRecord =
        locked !== null && season !== null
          ? capRushMultiplayerSeatRecord(locked, season.games, seat)
          : null;
      const teamId = seatReport?.franchiseId ?? lock?.franchise.franchiseId ?? null;
      return {
        seat,
        teamId,
        displayName:
          seatReport?.displayName ?? lock?.franchise.displayName ?? seatLabelFor(seat, localSeat),
        wins: seatReport?.wins ?? fallbackRecord?.wins ?? null,
        losses: seatReport?.losses ?? fallbackRecord?.losses ?? null,
        payrollDollars: seatReport?.payrollDollars ?? lock?.payrollDollars ?? null,
        payrollStatus: seatReport?.payrollStatus ?? lock?.payrollStatus ?? null,
        outcome: seatReport?.outcome ?? postseason?.outcomes[seat] ?? null,
        isChampion: teamId !== null && teamId === championTeamId,
      };
    }),
  );
  const championSeat = $derived.by((): CapRushMultiplayerSeatId | null => {
    return seatViews.find((detail) => detail.isChampion)?.seat ?? null;
  });
  const h2hGames = $derived.by((): CapRushLeagueGame[] => {
    if (season === null || locked === null) return [];
    const humanTeamIds = new Set([
      locked.seats.p1.franchise.franchiseId,
      locked.seats.p2.franchise.franchiseId,
    ]);
    return season.games
      .filter((game) => humanTeamIds.has(game.homeTeamId) && humanTeamIds.has(game.awayTeamId))
      .sort((left, right) => left.slot - right.slot);
  });

  function teamName(teamId: string): string {
    return teamNameOf(locked, teamId);
  }

  function recordText(wins: number | null, losses: number | null): string {
    return wins === null || losses === null ? '—' : `${wins}–${losses}`;
  }

  function outcomeLabel(outcome: CapRushPostseasonUserOutcome | null): string {
    if (outcome === null) return 'No postseason result recorded';
    switch (outcome.status) {
      case 'champion':
        return 'League champion';
      case 'eliminated':
        return outcome.round === null
          ? 'Eliminated'
          : `Eliminated in the ${capRushConferenceRoundName(outcome.round)}`;
      case 'not-qualified':
        return 'Missed the playoffs';
      default:
        return 'Postseason pending';
    }
  }
</script>

{#if report === null && locked === null && season === null}
  <p class="text-sm text-muted-foreground">No final report has been recorded yet.</p>
{:else}
  <div class="flex min-w-0 flex-col gap-4" data-cap-rush-multiplayer-results>
    <section
      class="flex min-w-0 flex-col gap-3 rounded-2xl border border-accent/40 bg-card p-4 sm:p-5"
    >
      <div class="flex min-w-0 flex-wrap items-center gap-3">
        {#if championTeam !== null && art !== null}
          <TeamLogo
            manifest={art.manifest}
            franchiseId={championTeam.franchiseId}
            teamExternalId={championTeam.teamExternalId}
            className="h-10 w-10"
          />
        {:else if championName !== null}
          <span
            class="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-surface-3 font-display text-sm font-extrabold text-muted-foreground"
            aria-hidden="true">{initialsOf(championName)}</span
          >
        {/if}
        <div class="min-w-0 flex-1">
          <p class="font-mono text-[10px] tracking-[0.16em] text-accent uppercase">Final report</p>
          <h2 class="font-display text-3xl font-extrabold tracking-tight uppercase">
            {championName === null ? 'League complete' : `${championName} win the league`}
          </h2>
          {#if championSeat !== null}
            <p class="mt-1 text-sm text-muted-foreground">
              {seatLabelFor(championSeat, localSeat)}'s franchise
            </p>
          {/if}
        </div>
      </div>
    </section>

    <section class="grid gap-3 sm:grid-cols-2" aria-label="League awards">
      {#each [{ label: 'MVP', winner: seasonMvp }, { label: 'Finals MVP', winner: finalsMvp }] as award (award.label)}
        <article class="award-card" data-finals={award.label === 'Finals MVP'}>
          <header class="award-heading">
            <span class="award-icon" aria-hidden="true">
              {#if award.label === 'Finals MVP'}<Trophy size={24} strokeWidth={1.7} />{:else}<Crown
                  size={24}
                  strokeWidth={1.7}
                />{/if}
            </span>
            <div>
              <p class="award-kicker">
                {award.label === 'Finals MVP' ? 'The championship stage' : 'The regular season'}
              </p>
              <h3 class="award-title">{award.label}</h3>
            </div>
          </header>
          {#if award.winner !== null}
            {@const face = art?.faceForPlayerId(award.winner.playerId) ?? null}
            <div class="award-player">
              <div class="award-portrait">
                {#if art !== null && face !== null}
                  <PlayerFace
                    player={face}
                    manifest={art.manifest}
                    size="xl"
                    fallbackInitials={initialsOf(award.winner.displayName)}
                  />
                {:else}
                  <span
                    class="inline-flex h-20 w-20 items-center justify-center rounded-2xl bg-surface-3 font-display text-xl font-extrabold"
                    aria-hidden="true">{initialsOf(award.winner.displayName)}</span
                  >
                {/if}
              </div>
              <div class="min-w-0 flex-1">
                <h4 class="font-display text-2xl leading-tight font-extrabold uppercase">
                  {award.winner.displayName}
                </h4>
                <p class="text-sm text-muted-foreground">{teamName(award.winner.teamId)}</p>
                <p class="award-statline">
                  {award.winner.averagePoints.toFixed(1)} PPG &middot; {award.winner.averageRebounds.toFixed(
                    1,
                  )} RPG &middot; {award.winner.averageAssists.toFixed(1)} APG
                </p>
              </div>
            </div>
          {:else}
            <p class="mt-2 text-sm text-muted-foreground">Award data unavailable.</p>
          {/if}
        </article>
      {/each}
    </section>

    <div class="grid min-w-0 gap-4 lg:grid-cols-2">
      {#each seatViews as detail (detail.seat)}
        {@const team = art === null || detail.teamId === null ? null : art.teamFor(detail.teamId)}
        <article
          class="flex min-w-0 flex-col gap-3 rounded-2xl border bg-card p-4 {detail.seat ===
          localSeat
            ? 'border-primary/40'
            : 'border-border'}"
          data-seat={detail.seat}
        >
          <header class="flex min-w-0 items-start justify-between gap-2">
            <div class="flex min-w-0 items-center gap-2">
              {#if team !== null && art !== null}
                <TeamLogo
                  manifest={art.manifest}
                  franchiseId={team.franchiseId}
                  teamExternalId={team.teamExternalId}
                  className="h-7 w-7"
                />
              {:else}
                <span
                  class="grid h-7 w-7 shrink-0 place-items-center rounded bg-surface-3 font-display text-[10px] font-extrabold text-muted-foreground"
                  aria-hidden="true">{initialsOf(detail.displayName)}</span
                >
              {/if}
              <div class="min-w-0">
                <p
                  class="font-mono text-[9px] font-semibold tracking-[0.12em] text-muted-foreground uppercase"
                >
                  {seatLabelFor(detail.seat, localSeat)}
                </p>
                <h3 class="truncate font-display text-xl leading-tight font-extrabold uppercase">
                  {detail.displayName}
                </h3>
              </div>
            </div>
            {#if detail.isChampion}
              <span
                class="shrink-0 rounded-full border border-accent/50 bg-accent/10 px-2 py-0.5 font-mono text-[9px] font-bold text-accent uppercase"
                >Champion</span
              >
            {/if}
          </header>

          <dl class="grid min-w-0 grid-cols-2 gap-2">
            <div class="min-w-0 rounded-xl border border-line-soft bg-surface-1 p-2.5">
              <dt class="font-mono text-[9px] tracking-[0.08em] text-muted-foreground uppercase">
                Record
              </dt>
              <dd class="mt-0.5 font-display text-xl font-extrabold tabular-nums">
                {recordText(detail.wins, detail.losses)}
              </dd>
            </div>
            <div class="min-w-0 rounded-xl border border-line-soft bg-surface-1 p-2.5">
              <dt class="font-mono text-[9px] tracking-[0.08em] text-muted-foreground uppercase">
                Payroll
              </dt>
              <dd class="mt-0.5 font-display text-xl font-extrabold tabular-nums">
                {detail.payrollDollars === null ? '—' : money(detail.payrollDollars)}
              </dd>
            </div>
            <div class="min-w-0 rounded-xl border border-line-soft bg-surface-1 p-2.5">
              <dt class="font-mono text-[9px] tracking-[0.08em] text-muted-foreground uppercase">
                Cap status
              </dt>
              <dd class="mt-1">
                {#if detail.payrollStatus === null}
                  <span class="text-xs text-muted-foreground">—</span>
                {:else}
                  <span
                    class="inline-flex rounded-full border px-2 py-0.5 font-mono text-[9px] font-bold uppercase {capStatusClass(
                      detail.payrollStatus,
                    )}">{capStatusLabel(detail.payrollStatus)}</span
                  >
                {/if}
              </dd>
            </div>
            <div class="min-w-0 rounded-xl border border-line-soft bg-surface-1 p-2.5">
              <dt class="font-mono text-[9px] tracking-[0.08em] text-muted-foreground uppercase">
                Outcome
              </dt>
              <dd class="mt-0.5 text-xs leading-snug font-semibold">
                {outcomeLabel(detail.outcome)}
              </dd>
            </div>
          </dl>

          {#if locked !== null}
            <CapRushMultiplayerRoster {state} seat={detail.seat} {localSeat} {art} />
          {:else}
            <p class="text-xs text-muted-foreground">Roster unavailable.</p>
          {/if}
        </article>
      {/each}
    </div>

    <CapRushMultiplayerStats {state} {localSeat} {art} />

    {#if h2hGames.length > 0}
      <section class="flex min-w-0 flex-col gap-2 rounded-2xl border border-border bg-card p-4">
        <header class="flex flex-wrap items-baseline justify-between gap-2">
          <div class="min-w-0">
            <p class="font-mono text-[10px] tracking-[0.16em] text-muted-foreground uppercase">
              Head-to-head
            </p>
            <h2 class="font-display text-2xl font-extrabold tracking-tight uppercase">
              Both seats' meetings
            </h2>
          </div>
        </header>
        <ul class="flex min-w-0 flex-col gap-1">
          {#each h2hGames as game (game.gameId)}
            <li
              class="flex min-w-0 flex-wrap items-center justify-between gap-2 rounded-lg border border-line-soft bg-surface-1 px-2 py-1.5"
            >
              <span class="flex min-w-0 flex-wrap items-baseline gap-x-1.5 gap-y-0.5 text-xs">
                <span class="shrink-0 font-mono text-[10px] text-muted-foreground"
                  >G{game.slot}</span
                >
                <span class="min-w-0 truncate text-muted-foreground">
                  {teamName(game.homeTeamId)}
                  {game.homePoints}–{game.awayPoints}
                  {teamName(game.awayTeamId)}
                </span>
              </span>
              {#if onreviewgame}
                <button
                  type="button"
                  class="inline-flex min-h-11 shrink-0 items-center justify-center rounded-lg border border-border bg-surface-2 px-3 text-xs font-semibold outline-none
                    focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-40"
                  aria-label={`Review head-to-head game ${game.slot}`}
                  onclick={() => onreviewgame?.(game.gameId)}
                >
                  Review
                </button>
              {/if}
            </li>
          {/each}
        </ul>
      </section>
    {/if}
  </div>
{/if}

<style>
  .award-card {
    --award-color: var(--color-primary);
    position: relative;
    min-width: 0;
    overflow: hidden;
    border: 1px solid color-mix(in srgb, var(--award-color) 45%, var(--color-border));
    border-top: 3px solid var(--award-color);
    border-radius: 1rem;
    padding: 1.25rem;
    background: linear-gradient(
      135deg,
      color-mix(in srgb, var(--award-color) 12%, var(--color-card)),
      var(--color-card) 75%
    );
  }
  .award-card[data-finals='true'] {
    --award-color: var(--color-accent);
    background:
      radial-gradient(
        ellipse at top right,
        color-mix(in srgb, var(--award-color) 20%, transparent),
        transparent 70%
      ),
      var(--color-card);
  }
  .award-heading {
    display: flex;
    align-items: center;
    gap: 0.75rem;
  }
  .award-icon {
    display: grid;
    place-items: center;
    width: 3rem;
    height: 3rem;
    flex-shrink: 0;
    border: 1px solid color-mix(in srgb, var(--award-color) 35%, transparent);
    border-radius: 0.75rem;
    background: color-mix(in srgb, var(--award-color) 12%, transparent);
    color: var(--award-color);
  }
  .award-kicker {
    font-family: var(--font-mono);
    font-size: 0.6rem;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: var(--color-muted-foreground);
  }
  .award-title {
    font-family: var(--font-display);
    font-size: 1.8rem;
    font-weight: 800;
    line-height: 1.1;
    text-transform: uppercase;
    color: var(--award-color);
  }
  .award-player {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 1rem;
    margin-top: 1.25rem;
  }
  .award-portrait {
    flex-shrink: 0;
    padding: 0.3rem;
    border-radius: 1.25rem;
    border: 1px solid color-mix(in srgb, var(--award-color) 35%, transparent);
    background: color-mix(in srgb, var(--award-color) 10%, transparent);
  }
  .award-statline {
    margin-top: 0.75rem;
    padding-top: 0.75rem;
    border-top: 1px solid color-mix(in srgb, var(--award-color) 20%, transparent);
    font-family: var(--font-mono);
    font-size: 0.75rem;
    font-weight: 700;
    font-variant-numeric: tabular-nums;
  }
</style>
