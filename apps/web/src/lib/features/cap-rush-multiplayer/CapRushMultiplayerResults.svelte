<script lang="ts">
  import { Trophy } from '@lucide/svelte';
  import type {
    CapRushLeagueGame,
    CapRushMultiplayerSeatId,
    CapRushMultiplayerState,
    CapRushPostseasonUserOutcome,
    CapRushSpinReceipt,
  } from '@hoop-rush/data-contracts';
  import { CAP_RUSH_CAP_LINE_DOLLARS, capRushConferenceRoundName } from '@hoop-rush/data-contracts';
  import {
    capRushLeagueMvp,
    capRushMultiplayerSeatRecord,
    havocMutationDefinitionOf,
  } from '@hoop-rush/engine';
  import PlayerFace from '#lib/components/PlayerFace.svelte';
  import TeamLogo from '#lib/components/TeamLogo.svelte';
  import AchievementReveal from '#lib/features/profile/AchievementReveal.svelte';
  import type { ComparisonRow, SeriesRecapGame } from '#lib/components/ui/types.js';
  import ComparisonTable from '#lib/components/screens/ComparisonTable.svelte';
  import Disclosure from '#lib/components/ui/Disclosure.svelte';
  import EmptyState from '#lib/components/ui/EmptyState.svelte';
  import MvpCard from '#lib/components/screens/MvpCard.svelte';
  import Panel from '#lib/components/ui/Panel.svelte';
  import ResultHero from '#lib/components/screens/ResultHero.svelte';
  import ResultScreen from '#lib/components/screens/ResultScreen.svelte';
  import SectionHeading from '#lib/components/ui/SectionHeading.svelte';
  import SeriesRecap from '#lib/components/screens/SeriesRecap.svelte';
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
    bindingId,
    art = null,
    onreviewgame,
  }: {
    state: CapRushMultiplayerState;
    localSeat: CapRushMultiplayerSeatId;
    bindingId: string;
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
            : [lock.spin, ...(lock.additionalSpins ?? [])].filter(
                (spin): spin is CapRushSpinReceipt => spin !== null,
              ),
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
  const championView = $derived(seatViews.find((detail) => detail.isChampion) ?? null);
  const championRecord = $derived(
    recordText(championView?.wins ?? null, championView?.losses ?? null),
  );
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
  const comparisonRows = $derived.by((): ComparisonRow[] => {
    const [left, right] = seatViews;
    if (left === undefined || right === undefined) return [];
    const roulette = (report?.variant ?? locked?.variant) === 'roulette';
    const moneyText = (value: number | null) => (value === null ? '\u2014' : money(value));
    const numberText = (value: number | null) =>
      value === null ? '\u2014' : value.toLocaleString();
    const highlight = left.isChampion ? 'left' : right.isChampion ? 'right' : null;
    const rows: ComparisonRow[] = [
      {
        label: 'Regular season',
        left: recordText(left.wins, left.losses),
        right: recordText(right.wins, right.losses),
        highlight,
      },
      {
        label: 'Postseason',
        left: outcomeLabel(left.outcome),
        right: outcomeLabel(right.outcome),
      },
      { label: 'Points for', left: numberText(left.pointsFor), right: numberText(right.pointsFor) },
      {
        label: 'Points against',
        left: numberText(left.pointsAgainst),
        right: numberText(right.pointsAgainst),
      },
      {
        label: 'Player payroll',
        left: moneyText(left.payrollDollars),
        right: moneyText(right.payrollDollars),
      },
    ];
    if (roulette) {
      rows.push(
        {
          label: 'Mutation spend',
          left: money(left.mutationSpend),
          right: money(right.mutationSpend),
        },
        {
          label: 'Total spend',
          left: moneyText(
            left.payrollDollars === null ? null : left.payrollDollars + left.mutationSpend,
          ),
          right: moneyText(
            right.payrollDollars === null ? null : right.payrollDollars + right.mutationSpend,
          ),
        },
      );
    }
    return rows;
  });
  const h2hRecap = $derived.by((): SeriesRecapGame[] => {
    const localTeamId = locked?.seats[localSeat].franchise.franchiseId ?? null;
    return h2hGames.map((game) => {
      const localHome = game.homeTeamId === localTeamId;
      const pointsFor = localHome ? game.homePoints : game.awayPoints;
      const pointsAgainst = localHome ? game.awayPoints : game.homePoints;
      return {
        gameNumber: game.slot,
        won: pointsFor > pointsAgainst,
        score: `${game.homePoints}\u2013${game.awayPoints}`,
        standout: `${teamName(game.homeTeamId)} vs ${teamName(game.awayTeamId)}`,
      };
    });
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

  function payrollMeta(detail: (typeof seatViews)[number]): string {
    const payroll =
      detail.payrollDollars === null
        ? 'Payroll unavailable'
        : `${money(detail.payrollDollars)} payroll`;
    return detail.payrollStatus === null
      ? payroll
      : `${payroll} \u00b7 ${capStatusLabel(detail.payrollStatus)}`;
  }

  function spinName(seat: CapRushMultiplayerSeatId, spin: CapRushSpinReceipt): string {
    return (
      locked?.seats[seat].team.starters.find(
        (starter) => starter.source.playerVersionId === spin.target.playerVersionId,
      )?.source.displayName ?? spin.target.cardId
    );
  }

  function spinMeta(spin: CapRushSpinReceipt): string {
    const names = [spin.entry, ...(spin.additionalEntries ?? [])]
      .map((entry) => havocMutationDefinitionOf(entry.mutationId).name)
      .join(' / ');
    return `${spin.purchase === 'standard' ? 'Mutation Spark' : 'Mutation Surge'} \u00b7 ${money(
      spin.priceDollars,
    )} \u00b7 ${names}`;
  }

  function reviewHeadToHead(gameNumber: number): void {
    const game = h2hGames.find((entry) => entry.slot === gameNumber);
    if (game !== undefined) onreviewgame?.(game.gameId);
  }
</script>

{#if report === null && locked === null && season === null}
  <EmptyState title="No final report yet" surface="none" />
{:else}
  <ResultScreen
    eyebrow={(report?.variant ?? locked?.variant) === 'roulette'
      ? 'Final report / Cap Roulette'
      : 'Final report / Cap Clash'}
    title={championName ?? 'League complete'}
    aria-label="Final report"
    data-cap-rush-multiplayer-results
  >
    {#snippet hero()}
      <ResultHero
        tone={championName === null ? 'default' : 'champion'}
        score={championRecord}
        scoreLabel="Champion regular-season record"
        caption={championName === null ? 'Season summary' : 'League champion'}
        aria-label="League champion"
        secondary={championSeat === null
          ? undefined
          : `${seatLabelFor(championSeat, localSeat)}'s franchise`}
      >
        {#snippet badges()}
          {#if championTeam !== null && art !== null}
            <TeamLogo
              manifest={art.manifest}
              franchiseId={championTeam.franchiseId}
              teamExternalId={championTeam.teamExternalId}
              className="h-12 w-12 sm:h-16 sm:w-16"
            />
          {/if}
        {/snippet}
      </ResultHero>
    {/snippet}

    <AchievementReveal {bindingId} />

    <Panel as="section" padding="md" class="sm:p-5" aria-label="Season comparison">
      <SectionHeading eyebrow="The league" title="Season comparison" level={3} align="start" />
      <div class="mt-3 overflow-x-auto">
        <ComparisonTable
          rows={comparisonRows}
          leftLabel={seatLabelFor(seatOrder(localSeat)[0], localSeat)}
          rightLabel={seatLabelFor(seatOrder(localSeat)[1], localSeat)}
        />
      </div>
    </Panel>

    <section class="grid items-start gap-3 md:grid-cols-2" aria-label="Team results">
      {#each seatViews as detail (detail.seat)}
        {@const team = detail.teamId === null ? null : (art?.teamFor(detail.teamId) ?? null)}
        {@const totalSpend =
          detail.payrollDollars === null ? null : detail.payrollDollars + detail.mutationSpend}
        <Panel
          as="article"
          padding="md"
          class={['min-w-0', detail.seat === localSeat ? 'border-primary/40' : '']}
          data-local={detail.seat === localSeat}
          data-seat={detail.seat}
        >
          <SectionHeading
            eyebrow={detail.isChampion
              ? `${seatLabelFor(detail.seat, localSeat)} \u00b7 Champion`
              : seatLabelFor(detail.seat, localSeat)}
            title={detail.displayName}
            level={3}
            align="start"
          >
            {#snippet actions()}
              <div class="flex items-center gap-2">
                {#if detail.isChampion}<Trophy
                    size={18}
                    class="shrink-0 text-accent"
                    aria-label="Champion"
                  />{/if}
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
              </div>
            {/snippet}
          </SectionHeading>

          <div class="team-overview">
            <div>
              <p class="ui-micro">Regular season</p>
              <p class="record-value">{recordText(detail.wins, detail.losses)}</p>
            </div>
            <div class="team-finish">
              <p class="ui-micro">Postseason</p>
              <p class="outcome-text" class:text-accent={detail.isChampion}>
                {outcomeLabel(detail.outcome)}
              </p>
            </div>
          </div>

          <Disclosure summary="Roster & finances" meta={payrollMeta(detail)} class="mt-3">
            <dl class="finance-grid">
              <div>
                <dt class="ui-micro">Player salaries</dt>
                <dd>{detail.payrollDollars === null ? '—' : money(detail.payrollDollars)}</dd>
              </div>
              {#if (report?.variant ?? locked?.variant) === 'roulette'}
                <div>
                  <dt class="ui-micro">Mutation purchases</dt>
                  <dd>{money(detail.mutationSpend)}</dd>
                </div>
                <div>
                  <dt class="ui-micro">Total spending</dt>
                  <dd>{totalSpend === null ? '—' : money(totalSpend)}</dd>
                </div>
                <div>
                  <dt class="ui-micro">Unused mutation budget</dt>
                  <dd>
                    {totalSpend === null
                      ? '—'
                      : money(Math.max(0, CAP_RUSH_CAP_LINE_DOLLARS - totalSpend))}
                  </dd>
                </div>
              {/if}
              {#if detail.pointsFor !== null && detail.pointsAgainst !== null}
                <div>
                  <dt class="ui-micro">Points scored / allowed</dt>
                  <dd>
                    {detail.pointsFor.toLocaleString()} / {detail.pointsAgainst.toLocaleString()}
                  </dd>
                </div>
                <div>
                  <dt class="ui-micro">Point differential</dt>
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
                    Apron penalties use player salaries. Mutations only reduce the purchase budget.
                  </p>{/if}
              </div>
            {/if}
            {#if locked !== null}
              <CapRushMultiplayerRoster {state} seat={detail.seat} {localSeat} {art} />
            {:else}<p class="text-xs text-muted-foreground">Roster unavailable.</p>{/if}
          </Disclosure>

          {#if (report?.variant ?? locked?.variant) === 'roulette'}
            <Disclosure
              summary="Mutations"
              meta={`${detail.spins.length} purchases \u00b7 ${money(detail.mutationSpend)}`}
              class="mt-2"
            >
              <div class="mutation-list">
                {#if detail.spins.length === 0}<p class="text-xs text-muted-foreground">
                    No mutations purchased.
                  </p>{/if}
                {#each detail.spins as spin (spin.receiptDigest)}
                  <Disclosure summary={spinName(detail.seat, spin)} meta={spinMeta(spin)}>
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
                  </Disclosure>
                {/each}
              </div>
            </Disclosure>
          {/if}
        </Panel>
      {/each}
    </section>

    <section class="grid gap-3 sm:grid-cols-2" aria-label="League awards">
      {#each [{ label: 'MVP', winner: seasonMvp }, { label: 'Finals MVP', winner: finalsMvp }] as award (award.label)}
        <MvpCard
          label={award.label === 'Finals MVP'
            ? 'Finals MVP \u00b7 The championship stage'
            : 'MVP \u00b7 The regular season'}
          name={award.winner?.displayName ?? null}
          team={award.winner === null ? null : teamName(award.winner.teamId)}
          slot={award.winner?.slot ?? null}
          stats={award.winner === null
            ? []
            : [
                { label: 'PPG', value: award.winner.averagePoints.toFixed(1) },
                { label: 'RPG', value: award.winner.averageRebounds.toFixed(1) },
                { label: 'APG', value: award.winner.averageAssists.toFixed(1) },
              ]}
          emptyCopy="Award data unavailable."
          data-finals={award.label === 'Finals MVP'}
        >
          {#snippet portrait()}
            {@const face =
              award.winner === null ? null : (art?.faceForPlayerId(award.winner.playerId) ?? null)}
            {#if art !== null && face !== null && award.winner !== null}
              <PlayerFace
                player={face}
                manifest={art.manifest}
                size="xl"
                fallbackInitials={initialsOf(award.winner.displayName)}
              />
            {:else if award.winner !== null}
              <span class="mvp-initials" aria-hidden="true"
                >{initialsOf(award.winner.displayName)}</span
              >
            {/if}
          {/snippet}
        </MvpCard>
      {/each}
    </section>

    <CapRushMultiplayerStats {state} {localSeat} {art} />

    {#if h2hGames.length > 0}
      <Disclosure
        summary="Head-to-head"
        meta={`${h2hGames.length} regular-season meetings${onreviewgame ? ' \u00b7 Game replays' : ''}`}
      >
        <SeriesRecap
          games={h2hRecap}
          label="Head-to-head games"
          onselect={onreviewgame === undefined ? undefined : reviewHeadToHead}
        />
      </Disclosure>
    {/if}
  </ResultScreen>
{/if}

<style>
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
  .team-overview {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    align-items: center;
    gap: 1.25rem;
    padding-top: 1rem;
  }
  .record-value {
    margin-top: 0.25rem;
    font: 800 clamp(2.5rem, 4vw, 3.25rem)/1.1 var(--font-display);
    white-space: nowrap;
    font-variant-numeric: tabular-nums;
  }
  .team-finish {
    padding-top: 0.75rem;
    border-top: 1px solid var(--color-line-soft);
  }
  .outcome-text {
    margin-top: 0.4rem;
    font-size: 0.75rem;
    font-weight: 600;
    line-height: 1.4;
  }
  .finance-grid {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 0.75rem;
    padding-bottom: 0.75rem;
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
  .mutation-effects {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
  }
  .mvp-initials {
    display: inline-flex;
    width: 5rem;
    height: 5rem;
    align-items: center;
    justify-content: center;
    border-radius: 1rem;
    background: var(--color-surface-3);
    font-family: var(--font-display);
    font-size: 1.25rem;
    font-weight: 800;
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
</style>
