<script lang="ts">
  import { ChevronDown, Crown, Trophy, Sparkles } from '@lucide/svelte';
  import type {
    CapRushLeagueGame,
    CapRushMultiplayerSeatId,
    CapRushMultiplayerState,
    CapRushPostseasonUserOutcome,
  } from '@hoop-rush/data-contracts';
  import { CAP_RUSH_CAP_LINE_DOLLARS, capRushConferenceRoundName } from '@hoop-rush/data-contracts';
  import {
    capRushLeagueMvp,
    capRushMultiplayerSeatRecord,
    havocMutationDefinitionOf,
  } from '@hoop-rush/engine';
  import PlayerFace from '#lib/components/PlayerFace.svelte';
  import TeamLogo from '#lib/components/TeamLogo.svelte';
  import type { CapRushArt } from '../cap-rush/cap-rush-art.js';
  import {
    apronPenaltyRows,
    apronPenaltyTitle,
    capStatusClass,
    capStatusLabel,
    initialsOf,
  } from '../cap-rush/cap-rush-presentation.js';
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
        spins:
          lock === null
            ? []
            : [lock.spin, ...(lock.additionalSpins ?? [])].filter((spin) => spin !== null),
        mutationSpend:
          seatReport?.spinSpendDollars ??
          [lock?.spin, ...(lock?.additionalSpins ?? [])].reduce(
            (sum, spin) => sum + (spin?.priceDollars ?? 0),
            0,
          ),
        pointsFor: seatReport?.pointsFor ?? fallbackRecord?.pointsFor ?? null,
        pointsAgainst: seatReport?.pointsAgainst ?? fallbackRecord?.pointsAgainst ?? null,
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
    return wins === null || losses === null ? '\u2014' : `${wins}\u2013${losses}`;
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
  <div class="final-report" data-cap-rush-multiplayer-results>
    <section class="champion-banner" aria-label="League champion">
      <div class="champion-emblem" aria-hidden="true"><Trophy size={28} strokeWidth={1.5} /></div>
      <div class="min-w-0 flex-1">
        <p class="report-eyebrow">
          Final report <span class="text-muted-foreground"
            >/ {(report?.variant ?? locked?.variant) === 'roulette'
              ? 'Cap Roulette'
              : 'Cap Clash'}</span
          >
        </p>
        <h2 class="champion-name">{championName ?? 'League complete'}</h2>
        <p class="champion-caption">
          {championName === null ? 'Season summary' : 'League champion'}{#if championSeat !== null}
            &middot; {seatLabelFor(championSeat, localSeat)}'s franchise{/if}
        </p>
      </div>
      {#if championTeam !== null && art !== null}
        <TeamLogo
          manifest={art.manifest}
          franchiseId={championTeam.franchiseId}
          teamExternalId={championTeam.teamExternalId}
          className="h-12 w-12 sm:h-16 sm:w-16"
        />
      {/if}
    </section>

    <section class="team-comparison" aria-label="Team results">
      {#each seatViews as detail (detail.seat)}
        {@const team = detail.teamId === null ? null : (art?.teamFor(detail.teamId) ?? null)}
        {@const totalSpend =
          detail.payrollDollars === null ? null : detail.payrollDollars + detail.mutationSpend}
        <article class="team-report" data-local={detail.seat === localSeat} data-seat={detail.seat}>
          <header class="team-heading">
            {#if team !== null && art !== null}
              <TeamLogo
                manifest={art.manifest}
                franchiseId={team.franchiseId}
                teamExternalId={team.teamExternalId}
                className="h-9 w-9"
              />
            {:else}<span class="team-initials" aria-hidden="true"
                >{initialsOf(detail.displayName)}</span
              >{/if}
            <div class="min-w-0 flex-1">
              <p class="report-eyebrow text-muted-foreground">
                {seatLabelFor(detail.seat, localSeat)}
              </p>
              <h3 class="team-name">{detail.displayName}</h3>
            </div>
            {#if detail.isChampion}<Trophy
                size={18}
                class="shrink-0 text-accent"
                aria-label="Champion"
              />{/if}
          </header>
          <div class="team-overview">
            <div>
              <p class="metric-label">Regular season</p>
              <p class="record-value">{recordText(detail.wins, detail.losses)}</p>
            </div>
            <div class="team-finish">
              <p class="metric-label">Postseason</p>
              <p class="outcome-text" class:text-accent={detail.isChampion}>
                {outcomeLabel(detail.outcome)}
              </p>
            </div>
          </div>
          <details class="report-disclosure team-disclosure">
            <summary>
              <span class="disclosure-copy"
                ><span class="disclosure-title">Roster &amp; finances</span><span
                  class="disclosure-note"
                  >{detail.payrollDollars === null
                    ? 'Payroll unavailable'
                    : `${money(detail.payrollDollars)} payroll`}{#if detail.payrollStatus !== null}
                    &middot; {capStatusLabel(detail.payrollStatus)}{/if}</span
                ></span
              >
              <ChevronDown size={16} class="disclosure-chevron" aria-hidden="true" />
            </summary>
            <div class="disclosure-body">
              <dl class="finance-grid">
                <div>
                  <dt>Player salaries</dt>
                  <dd>{detail.payrollDollars === null ? '—' : money(detail.payrollDollars)}</dd>
                </div>
                {#if (report?.variant ?? locked?.variant) === 'roulette'}
                  <div>
                    <dt>Mutation purchases</dt>
                    <dd>{money(detail.mutationSpend)}</dd>
                  </div>
                  <div>
                    <dt>Total spending</dt>
                    <dd>{totalSpend === null ? '—' : money(totalSpend)}</dd>
                  </div>
                  <div>
                    <dt>Unused mutation budget</dt>
                    <dd>
                      {totalSpend === null
                        ? '—'
                        : money(Math.max(0, CAP_RUSH_CAP_LINE_DOLLARS - totalSpend))}
                    </dd>
                  </div>
                {/if}
                {#if detail.pointsFor !== null && detail.pointsAgainst !== null}
                  <div>
                    <dt>Points scored / allowed</dt>
                    <dd>
                      {detail.pointsFor.toLocaleString()} / {detail.pointsAgainst.toLocaleString()}
                    </dd>
                  </div>
                  <div>
                    <dt>Point differential</dt>
                    <dd>
                      {detail.pointsFor >= detail.pointsAgainst ? '+' : ''}{(
                        detail.pointsFor - detail.pointsAgainst
                      ).toLocaleString()}
                    </dd>
                  </div>
                {/if}
              </dl>
              {#if detail.payrollStatus !== null}
                <div class="penalty-note">
                  <span class="cap-badge {capStatusClass(detail.payrollStatus)}"
                    >{capStatusLabel(detail.payrollStatus)}</span
                  >
                  <p class="mt-2 text-xs font-semibold">
                    {apronPenaltyTitle(detail.payrollStatus)}
                  </p>
                  <div class="mt-2 flex flex-wrap gap-x-4 gap-y-1">
                    {#each apronPenaltyRows(detail.payrollStatus) as row (row.label)}<p
                        class="text-xs text-muted-foreground"
                      >
                        {row.label}: -{row.reduction}
                      </p>{/each}
                  </div>
                  {#if (report?.variant ?? locked?.variant) === 'roulette'}<p
                      class="mt-2 text-xs text-muted-foreground"
                    >
                      Apron penalties use player salaries. Mutations only reduce the purchase
                      budget.
                    </p>{/if}
                </div>
              {/if}
              {#if locked !== null}
                <CapRushMultiplayerRoster {state} seat={detail.seat} {localSeat} {art} />
              {:else}<p class="text-xs text-muted-foreground">Roster unavailable.</p>{/if}
            </div>
          </details>
          {#if (report?.variant ?? locked?.variant) === 'roulette'}
            <details class="report-disclosure team-disclosure">
              <summary
                ><span class="disclosure-copy"
                  ><span class="disclosure-title flex items-center gap-2"
                    ><Sparkles size={14} class="text-primary" aria-hidden="true" />Mutations</span
                  ><span class="disclosure-note"
                    >{detail.spins.length} purchases &middot; {money(detail.mutationSpend)}</span
                  ></span
                ><ChevronDown size={16} class="disclosure-chevron" aria-hidden="true" /></summary
              >
              <div class="disclosure-body mutation-list">
                {#if detail.spins.length === 0}<p class="text-xs text-muted-foreground">
                    No mutations purchased.
                  </p>{/if}
                {#each detail.spins as spin (spin.receiptDigest)}
                  {@const target = locked?.seats[detail.seat].team.starters.find(
                    (starter) => starter.source.playerVersionId === spin.target.playerVersionId,
                  )}
                  <details class="mutation-detail">
                    <summary
                      ><span class="disclosure-copy"
                        ><span class="disclosure-title"
                          >{target?.source.displayName ?? spin.target.cardId}</span
                        ><span class="disclosure-note"
                          >{spin.purchase === 'standard' ? 'Mutation Spark' : 'Mutation Surge'} &middot;
                          {money(spin.priceDollars)}</span
                        ><span class="mutation-names"
                          >{[spin.entry, ...(spin.additionalEntries ?? [])]
                            .map((entry) => havocMutationDefinitionOf(entry.mutationId).name)
                            .join(' / ')}</span
                        ></span
                      ><ChevronDown
                        size={14}
                        class="disclosure-chevron"
                        aria-hidden="true"
                      /></summary
                    >
                    <div class="mutation-effects">
                      {#each [spin.entry, ...(spin.additionalEntries ?? [])] as entry (entry.mutationId)}
                        {@const mutation = havocMutationDefinitionOf(entry.mutationId)}
                        <div>
                          <p class="text-sm font-semibold">{mutation.name}</p>
                          <p class="mt-1 text-xs leading-relaxed text-muted-foreground">
                            {mutation.description}
                          </p>
                          {#if mutation.downside}<p
                              class="mt-1 text-xs leading-relaxed text-destructive"
                            >
                              Downside: {mutation.downside}
                            </p>{/if}
                        </div>
                      {/each}
                    </div>
                  </details>
                {/each}
              </div>
            </details>
          {/if}
        </article>
      {/each}
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

    <div class="report-panel stats-body">
      <CapRushMultiplayerStats {state} {localSeat} {art} />
    </div>

    {#if h2hGames.length > 0}
      <details class="report-disclosure report-panel">
        <summary
          ><span class="disclosure-copy"
            ><span class="disclosure-title">Head-to-head</span><span class="disclosure-note"
              >{h2hGames.length} regular-season meetings{#if onreviewgame}
                &middot; Game replays{/if}</span
            ></span
          ><ChevronDown size={18} class="disclosure-chevron" aria-hidden="true" /></summary
        >
        <ul class="disclosure-body meeting-list">
          {#each h2hGames as game (game.gameId)}
            <li class="meeting-row">
              <span class="font-mono text-[10px] text-muted-foreground">G{game.slot}</span>
              <span class="meeting-score"
                ><span>{teamName(game.homeTeamId)}</span><strong
                  >{game.homePoints}&ndash;{game.awayPoints}</strong
                ><span>{teamName(game.awayTeamId)}</span></span
              >
              {#if onreviewgame}<button
                  type="button"
                  class="review-button"
                  aria-label={`Review head-to-head game ${game.slot}`}
                  onclick={() => onreviewgame?.(game.gameId)}>Review</button
                >{/if}
            </li>
          {/each}
        </ul>
      </details>
    {/if}
  </div>
{/if}

<style>
  .final-report {
    display: flex;
    flex-direction: column;
    gap: 1.5rem;
    min-width: 0;
  }
  .champion-banner {
    display: flex;
    align-items: center;
    gap: 1rem;
    padding: 1.25rem;
    border: 1px solid var(--color-border);
    border-left: 3px solid var(--color-accent);
    border-radius: 1rem;
    background: var(--color-card);
  }
  .champion-emblem {
    display: grid;
    place-items: center;
    flex-shrink: 0;
    width: 3rem;
    height: 3rem;
    border-radius: 50%;
    background: color-mix(in srgb, var(--color-accent) 10%, transparent);
    color: var(--color-accent);
  }
  .report-eyebrow {
    font: 700 0.6rem var(--font-mono);
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: var(--color-accent);
  }
  .champion-name {
    margin-top: 0.3rem;
    font: 800 clamp(1.5rem, 3vw, 2.25rem)/1.05 var(--font-display);
    text-transform: uppercase;
    overflow-wrap: anywhere;
  }
  .champion-caption {
    margin-top: 0.4rem;
    font-size: 0.75rem;
    color: var(--color-muted-foreground);
  }
  .team-comparison {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    gap: 0.75rem;
    align-items: start;
  }
  .team-report {
    min-width: 0;
    overflow: hidden;
    border: 1px solid var(--color-border);
    border-radius: 1rem;
    background: var(--color-card);
  }
  .team-report[data-local='true'] {
    border-top: 2px solid var(--color-primary);
  }
  .team-heading {
    display: flex;
    align-items: center;
    gap: 0.65rem;
    padding: 1.5rem 1.5rem 0;
  }
  .team-initials {
    display: grid;
    place-items: center;
    flex-shrink: 0;
    width: 2.25rem;
    height: 2.25rem;
    border-radius: 0.5rem;
    background: var(--color-surface-3);
    font: 800 0.75rem var(--font-display);
  }
  .team-name {
    margin-top: 0.2rem;
    font: 800 1.5rem/1.15 var(--font-display);
    text-transform: uppercase;
    overflow-wrap: anywhere;
  }
  .team-overview {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    align-items: center;
    gap: 1.25rem;
    padding: 1.5rem;
  }
  .metric-label {
    font: 500 0.65rem var(--font-mono);
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--color-muted-foreground);
  }
  .record-value {
    margin-top: 0.25rem;
    font: 800 clamp(2.5rem, 4vw, 3.25rem)/1.1 var(--font-display);
    white-space: nowrap;
    font-variant-numeric: tabular-nums;
  }
  .team-finish {
    padding-top: 1rem;
    border-top: 1px solid var(--color-line-soft);
  }
  .outcome-text {
    margin-top: 0.4rem;
    font-size: 0.75rem;
    font-weight: 600;
    line-height: 1.4;
  }
  .report-panel {
    min-width: 0;
    border: 1px solid var(--color-border);
    border-radius: 0.85rem;
    background: var(--color-card);
  }
  .stats-body {
    padding: 1.25rem;
  }
  .team-disclosure {
    border-top: 1px solid var(--color-line-soft);
  }
  summary {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.75rem;
    min-height: 3.25rem;
    padding: 1rem 1.5rem;
    cursor: pointer;
    list-style: none;
    border-radius: inherit;
  }
  summary::-webkit-details-marker {
    display: none;
  }
  summary:hover {
    background: var(--color-surface-2);
  }
  summary:focus-visible,
  .review-button:focus-visible {
    outline: 2px solid var(--color-ring);
    outline-offset: -3px;
  }
  .disclosure-copy {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    min-width: 0;
  }
  .disclosure-title {
    font-size: 0.8rem;
    font-weight: 700;
  }
  .disclosure-note {
    font-size: 0.65rem;
    line-height: 1.5;
    color: var(--color-muted-foreground);
  }
  :global(.disclosure-chevron) {
    flex-shrink: 0;
    color: var(--color-muted-foreground);
    transition: transform 150ms ease;
  }
  details[open] > summary :global(.disclosure-chevron) {
    transform: rotate(180deg);
  }
  .disclosure-body {
    min-width: 0;
    padding: 0 1.5rem 1.5rem;
  }
  .finance-grid {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 0.75rem;
    padding: 0.75rem 0;
  }
  .finance-grid dt {
    font-size: 0.65rem;
    color: var(--color-muted-foreground);
  }
  .finance-grid dd {
    margin-top: 0.25rem;
    font: 600 0.8rem var(--font-mono);
    font-variant-numeric: tabular-nums;
    overflow-wrap: anywhere;
  }
  .penalty-note {
    margin: 0.5rem 0 1rem;
    padding: 0.75rem;
    border-radius: 0.5rem;
    background: var(--color-surface-1);
  }
  .cap-badge {
    display: inline-flex;
    border-width: 1px;
    border-radius: 2rem;
    padding: 0.2rem 0.5rem;
    font: 700 0.55rem var(--font-mono);
    text-transform: uppercase;
  }
  .mutation-list {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }
  .mutation-detail {
    border: 1px solid var(--color-line-soft);
    border-radius: 0.6rem;
    background: var(--color-surface-1);
  }
  .mutation-detail summary {
    padding: 0.75rem;
  }
  .mutation-names {
    font-size: 0.65rem;
    line-height: 1.5;
    color: var(--color-primary);
  }
  .mutation-effects {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
    padding: 0 0.75rem 0.75rem;
  }
  .meeting-list {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }
  .meeting-row {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.65rem;
    padding: 0.65rem;
    border: 1px solid var(--color-line-soft);
    border-radius: 0.5rem;
    background: var(--color-surface-1);
  }
  .meeting-score {
    display: flex;
    flex: 1;
    min-width: 0;
    flex-wrap: wrap;
    align-items: baseline;
    gap: 0.4rem;
    font-size: 0.7rem;
  }
  .meeting-score strong {
    white-space: nowrap;
    font-variant-numeric: tabular-nums;
  }
  .review-button {
    min-height: 2.75rem;
    padding: 0 0.75rem;
    border: 1px solid var(--color-border);
    border-radius: 0.5rem;
    background: var(--color-surface-2);
    font-size: 0.7rem;
    font-weight: 600;
  }
  @media (min-width: 768px) {
    .team-comparison {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }
    .champion-banner {
      padding: 1.5rem;
    }
  }
  @media (min-width: 1100px) {
    .team-overview {
      grid-template-columns: auto minmax(0, 1fr);
    }
    .team-finish {
      padding-top: 0;
      padding-left: 1.25rem;
      border-top: 0;
      border-left: 1px solid var(--color-line-soft);
    }
  }
  @media (max-width: 400px) {
    .champion-emblem {
      display: none;
    }
    .champion-banner {
      gap: 0.65rem;
      padding: 1rem;
    }
    .stats-body {
      padding-inline: 0.5rem;
    }
  }
  @media (prefers-reduced-motion: reduce) {
    :global(.disclosure-chevron) {
      transition: none;
    }
  }

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
