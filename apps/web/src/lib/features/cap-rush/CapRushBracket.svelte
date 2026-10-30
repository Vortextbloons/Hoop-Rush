<script lang="ts">
  import {
    CAP_RUSH_CONFERENCE_ROUND_NAMES,
    CAP_RUSH_PLAYOFF_ROUND_NAMES,
    capRushConferenceStandingsEntries,
    isConferenceStandings,
    type CapRushPlayoffSeries,
    type CapRushConferenceStandings,
    type CapRushPostseasonStandings,
    type HoopRushManifest,
  } from '@hoop-rush/data-contracts';
  import TeamLogo from '#lib/components/TeamLogo.svelte';
  import { franchiseIdentityOf } from '#lib/branding.js';

  let {
    series,
    standings,
    manifest = null,
    userTeamId = null,
    onTeamSelect,
    onSeriesSelect,
    selectedSeriesId = null,
  }: {
    series: readonly CapRushPlayoffSeries[];
    standings: CapRushPostseasonStandings | CapRushConferenceStandings;
    manifest?: HoopRushManifest | null;
    userTeamId?: string | null;
    onTeamSelect?: (teamId: string) => void;
    onSeriesSelect?: (series: CapRushPlayoffSeries) => void;
    selectedSeriesId?: string | null;
  } = $props();

  interface BracketSeries {
    seriesId: string;
    round: number;
    seriesSlot: number;
    conference: 'east' | 'west' | null;
    highSeed: number;
    lowSeed: number;
    highTeamId: string;
    lowTeamId: string;
    games: CapRushPlayoffSeries['games'];
  }

  const conference = $derived(isConferenceStandings(standings));
  const entries = $derived(
    new Map(
      (conference
        ? capRushConferenceStandingsEntries(standings as CapRushConferenceStandings)
        : (standings as CapRushPostseasonStandings).entries
      ).map((entry) => [entry.teamId, entry]),
    ),
  );
  const normalized = $derived(
    series.map((entry): BracketSeries => {
      const conferenceValue =
        'conference' in entry ? (entry as { conference: 'east' | 'west' | null }).conference : null;
      return {
        seriesId: entry.seriesId,
        round: entry.round,
        seriesSlot: entry.seriesSlot,
        conference: conferenceValue,
        highSeed: entry.highSeed,
        lowSeed: entry.lowSeed,
        highTeamId: entry.highTeamId,
        lowTeamId: entry.lowTeamId,
        games: entry.games,
      };
    }),
  );
  const latestRound = $derived(
    normalized.length === 0 ? 1 : Math.max(...normalized.map((entry) => entry.round)),
  );
  const championId = $derived.by(() => {
    const finals = normalized.find((entry) => entry.round === 4 && entry.seriesSlot === 0);
    return finals === undefined ? null : winnerOf(finals);
  });
  let selectedRound = $state<number | null>(null);
  let mobileConference = $state<'west' | 'east'>('west');
  const activeRound = $derived(selectedRound ?? latestRound);
  const roundNames = $derived(
    conference ? CAP_RUSH_CONFERENCE_ROUND_NAMES : CAP_RUSH_PLAYOFF_ROUND_NAMES,
  );

  function winsOf(entry: BracketSeries, teamId: string): number {
    return entry.games.filter((game) => game.winnerTeamId === teamId).length;
  }

  function winnerOf(entry: BracketSeries): string | null {
    if (winsOf(entry, entry.highTeamId) >= 4) return entry.highTeamId;
    if (winsOf(entry, entry.lowTeamId) >= 4) return entry.lowTeamId;
    return null;
  }

  function nameOf(teamId: string): string {
    return entries.get(teamId)?.displayName ?? teamId;
  }

  function shortNameOf(teamId: string): string {
    return identityOf(teamId)?.abbreviation ?? nameOf(teamId);
  }

  function seedOf(teamId: string): number {
    return entries.get(teamId)?.seed ?? 0;
  }

  function identityOf(teamId: string) {
    if (manifest === null) return null;
    return franchiseIdentityOf(manifest, teamId);
  }

  function slotsFor(round: number, side: 'west' | 'east' | 'finals'): number[] {
    if (side === 'finals') return [0];
    if (side === 'west') {
      if (round === 1) return [0, 1, 2, 3];
      if (round === 2) return [0, 1];
      if (round === 3) return [0];
      return [];
    }
    if (round === 1) return [4, 5, 6, 7];
    if (round === 2) return [2, 3];
    if (round === 3) return [1];
    return [];
  }

  function roundSeries(round: number, side: 'west' | 'east' | 'finals'): BracketSeries[] {
    const slots = slotsFor(round, side);
    return normalized
      .filter((entry) => entry.round === round && slots.includes(entry.seriesSlot))
      .sort((left, right) => left.seriesSlot - right.seriesSlot);
  }

  function seriesAt(round: number, slot: number): BracketSeries | undefined {
    return normalized.find((entry) => entry.round === round && entry.seriesSlot === slot);
  }

  function hasUser(entry: BracketSeries): boolean {
    return (
      userTeamId !== null && (entry.highTeamId === userTeamId || entry.lowTeamId === userTeamId)
    );
  }

  function roundLabel(entry: BracketSeries): string {
    return `${roundNames[entry.round - 1] ?? 'Round'} ${entry.highSeed} vs ${entry.lowSeed}`;
  }

  const mobileSeries = $derived(
    conference
      ? activeRound === 4
        ? roundSeries(4, 'finals')
        : roundSeries(activeRound, mobileConference)
      : normalized
          .filter((entry) => entry.round === activeRound)
          .sort((left, right) => left.seriesSlot - right.seriesSlot),
  );
</script>

<section
  class="bracket rounded-2xl border border-border bg-card p-4 sm:p-6"
  aria-label="Playoff bracket"
>
  <div class="flex flex-wrap items-end justify-between gap-3">
    <div>
      <p class="font-mono text-[10px] font-bold tracking-[0.16em] text-primary uppercase">
        {conference ? 'Conference bracket' : 'The bracket'}
      </p>
      <h2 class="font-display mt-1 text-2xl font-extrabold tracking-tight uppercase">
        {conference ? 'West to East. One champion.' : 'Sixteen teams. Four rounds.'}
      </h2>
    </div>
    <div
      class="round-picker {conference ? 'conference-round-picker' : ''}"
      role="group"
      aria-label="Choose a playoff round"
    >
      {#each roundNames as name, index (name)}
        <button
          type="button"
          class="round-button {activeRound === index + 1 ? 'is-active' : ''}"
          aria-pressed={activeRound === index + 1}
          onclick={() => (selectedRound = index + 1)}
        >
          {name}
        </button>
      {/each}
    </div>
  </div>

  {#if conference}
    <div class="mt-4 hidden lg:block">
      <div class="mb-2 grid grid-cols-[1fr_1fr_1fr_1.1fr_1fr_1fr_1fr] gap-2">
        <p class="bracket-side-label text-left">Western Conference</p>
        <span></span>
        <span></span>
        <p
          class="text-center font-mono text-[10px] font-bold tracking-[0.14em] text-accent uppercase"
        >
          Finals
        </p>
        <span></span>
        <span></span>
        <p class="bracket-side-label text-right">Eastern Conference</p>
      </div>
      <div class="grid grid-cols-[1fr_1fr_1fr_1.1fr_1fr_1fr_1fr] items-stretch gap-2">
        {#each [1, 2, 3] as round (round)}
          {@const west = roundSeries(round, 'west')}
          <div class="bracket-col bracket-west">
            <p class="bracket-round-label">{roundNames[round - 1]}</p>
            <div class="bracket-col-body">
              {#each west as entry (entry.seriesId)}
                {@render seriesCard(entry, 'right')}
              {/each}
              {#if west.length === 0}
                <div class="awaiting">Awaiting</div>
              {/if}
            </div>
          </div>
        {/each}

        <div class="bracket-finals">
          <p class="bracket-round-label text-center">NBA Finals</p>
          {#if seriesAt(4, 0)}
            {@render seriesCard(seriesAt(4, 0) as BracketSeries, 'none')}
          {:else}
            <div class="awaiting">Conference champions meet here.</div>
          {/if}
          <div class="champion-plate" class:champion-live={championId !== null}>
            <p class="font-mono text-[9px] font-bold tracking-[0.16em] text-accent uppercase">
              Champion
            </p>
            {#if championId !== null}
              <div class="mt-2 flex min-w-0 flex-col items-center justify-center gap-1.5">
                {#if identityOf(championId) && manifest}
                  {@const identity = identityOf(championId)}
                  <TeamLogo
                    {manifest}
                    franchiseId={identity?.franchiseId ?? championId}
                    teamExternalId={identity?.teamExternalId ?? ''}
                    alt=""
                    className="h-8 w-8"
                  />
                {/if}
                <span class="champion-name font-display text-base font-extrabold uppercase">
                  {nameOf(championId)}
                </span>
              </div>
            {:else}
              <p class="mt-2 font-mono text-[9px] text-muted-foreground uppercase">Undecided</p>
            {/if}
          </div>
        </div>

        {#each [3, 2, 1] as round (round)}
          {@const east = roundSeries(round, 'east')}
          <div class="bracket-col bracket-east">
            <p class="bracket-round-label text-right">{roundNames[round - 1]}</p>
            <div class="bracket-col-body">
              {#each east as entry (entry.seriesId)}
                {@render seriesCard(entry, 'left')}
              {/each}
              {#if east.length === 0}
                <div class="awaiting">Awaiting</div>
              {/if}
            </div>
          </div>
        {/each}
      </div>
    </div>
  {/if}

  <div class="mt-4 flex flex-col gap-2 {conference ? 'lg:hidden' : ''}">
    {#if conference && activeRound !== 4}
      <div class="conference-picker" role="group" aria-label="Choose a conference">
        {#each ['west', 'east'] as const as side (side)}
          <button
            type="button"
            class="conference-button {mobileConference === side ? 'is-active' : ''}"
            aria-pressed={mobileConference === side}
            onclick={() => (mobileConference = side)}
          >
            {side === 'west' ? 'West' : 'East'}
          </button>
        {/each}
      </div>
    {/if}
    <p class="font-mono text-[10px] font-bold tracking-[0.12em] text-primary uppercase">
      {roundNames[activeRound - 1]}
    </p>
    {#each mobileSeries as entry (entry.seriesId)}
      {@render seriesCard(entry, 'none', true)}
    {/each}
    {#if conference && activeRound === 4 && championId !== null}
      <div class="champion-plate mobile-champion">
        <p class="font-mono text-[10px] font-bold tracking-[0.16em] text-accent uppercase">
          Champion
        </p>
        <p class="champion-name font-display mt-1 text-xl font-extrabold uppercase">
          {nameOf(championId)}
        </p>
      </div>
    {/if}
    {#if mobileSeries.length === 0}
      <p class="rounded-xl border border-dashed border-line-soft p-3 text-xs text-muted-foreground">
        Awaiting the previous round.
      </p>
    {/if}
  </div>
</section>

{#snippet seriesCard(entry: BracketSeries, direction: 'left' | 'right' | 'none', mobile = false)}
  {@const winner = winnerOf(entry)}
  {@const userMatchup = hasUser(entry)}
  {@const selected = selectedSeriesId === entry.seriesId}
  <div
    class="series-card {direction === 'right'
      ? 'connector-right'
      : direction === 'left'
        ? 'connector-left'
        : ''} {userMatchup ? 'series-user' : ''} {selected ? 'series-selected' : ''} {mobile
      ? 'series-mobile'
      : ''}"
  >
    {#if onSeriesSelect}
      <button
        type="button"
        class="absolute inset-0 z-0 rounded-xl outline-none focus-visible:ring-2 focus-visible:ring-ring"
        aria-label={`Open ${roundLabel(entry)}`}
        onclick={() => onSeriesSelect(entry as CapRushPlayoffSeries)}
      ></button>
    {/if}
    <div class="relative z-10 pointer-events-none">
      {#each [entry.highTeamId, entry.lowTeamId] as teamId (teamId)}
        {@const identity = identityOf(teamId)}
        {@const won = winner === teamId}
        {@const isUser = userTeamId === teamId}
        <div class="team-row {won ? 'team-won' : ''} {isUser ? 'team-user' : ''}">
          <span class="seed">{seedOf(teamId)}</span>
          {#if identity && manifest}
            <TeamLogo
              {manifest}
              franchiseId={identity.franchiseId}
              teamExternalId={identity.teamExternalId}
              alt=""
              className="h-4 w-4"
            />
          {:else}
            <span class="h-4 w-4 shrink-0 rounded-sm bg-surface-3" aria-hidden="true"></span>
          {/if}
          {#if onTeamSelect}
            <button
              type="button"
              class="team-name pointer-events-auto outline-none hover:text-primary focus-visible:ring-2 focus-visible:ring-ring"
              title={nameOf(teamId)}
              onclick={() => onTeamSelect(teamId)}
            >
              {mobile ? nameOf(teamId) : shortNameOf(teamId)}
            </button>
          {:else}
            <span class="team-name" title={nameOf(teamId)}
              >{mobile ? nameOf(teamId) : shortNameOf(teamId)}</span
            >
          {/if}
          {#if won}<span class="sr-only">Series winner</span>{/if}
          <span class="wins">{winsOf(entry, teamId)}</span>
        </div>
      {/each}
    </div>
  </div>
{/snippet}

<style>
  .round-picker,
  .conference-picker {
    display: flex;
    gap: 6px;
  }
  .round-picker {
    width: 100%;
    overflow-x: auto;
    padding-bottom: 2px;
  }
  .round-button,
  .conference-button {
    min-height: 44px;
    border: 1px solid var(--color-line-soft);
    border-radius: 9px;
    padding: 8px 12px;
    color: var(--color-muted-foreground);
    font-size: 11px;
    font-weight: 700;
    white-space: nowrap;
    text-transform: uppercase;
  }
  .round-button.is-active,
  .conference-button.is-active {
    border-color: var(--color-primary);
    background: color-mix(in srgb, var(--color-primary) 15%, var(--color-surface-1));
    color: var(--color-primary);
  }
  .round-button:focus-visible,
  .conference-button:focus-visible {
    outline: 2px solid var(--color-primary);
    outline-offset: 2px;
  }
  .conference-button {
    flex: 1;
  }
  .bracket-side-label {
    font-family: var(--font-mono);
    font-size: 10px;
    font-weight: 700;
    letter-spacing: 0.14em;
    text-transform: uppercase;
    color: var(--color-muted-foreground);
  }
  .bracket-col {
    display: flex;
    min-width: 0;
    flex-direction: column;
    gap: 6px;
  }
  .bracket-round-label {
    font-family: var(--font-mono);
    font-size: 8px;
    font-weight: 700;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: var(--color-muted-foreground);
  }
  .bracket-col-body {
    display: flex;
    flex: 1;
    flex-direction: column;
    justify-content: space-around;
    gap: 8px;
  }
  .bracket-finals {
    display: flex;
    min-width: 0;
    flex-direction: column;
    justify-content: center;
    gap: 10px;
    border-inline: 1px solid var(--color-line-soft);
    padding-inline: 6px;
  }
  .series-card {
    position: relative;
    border: 1px solid var(--color-line-soft);
    border-radius: 10px;
    background: var(--color-surface-1);
    padding: 8px;
    transition:
      border-color 180ms ease,
      background-color 180ms ease,
      transform 180ms ease;
  }
  .series-card:hover {
    border-color: var(--color-line-strong);
  }
  .series-user {
    border-color: color-mix(in srgb, var(--color-primary) 55%, transparent);
    background: color-mix(in srgb, var(--color-primary) 7%, var(--color-surface-1));
  }
  .series-selected {
    box-shadow: 0 0 0 1px var(--color-primary);
  }
  .series-mobile {
    padding: 12px;
  }
  .series-mobile .team-row {
    min-height: 40px;
    gap: 10px;
    font-size: 13px;
  }
  .series-mobile .seed {
    font-size: 10px;
  }
  .series-mobile .wins {
    font-size: 15px;
  }
  .team-row {
    display: flex;
    align-items: center;
    gap: 5px;
    padding-block: 2px;
    color: var(--color-muted-foreground);
    font-size: 10px;
  }
  .team-won {
    color: var(--color-foreground);
    font-weight: 700;
  }
  .team-won .wins {
    color: var(--color-accent);
  }
  .team-user .team-name {
    color: var(--color-primary);
    font-weight: 700;
  }
  .seed {
    width: 13px;
    flex-shrink: 0;
    text-align: center;
    font-family: var(--font-mono);
    font-size: 8px;
    font-variant-numeric: tabular-nums;
  }
  .team-name {
    min-width: 0;
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    text-align: left;
    cursor: pointer;
  }
  .wins {
    flex-shrink: 0;
    font-family: var(--font-mono);
    font-size: 11px;
    font-weight: 700;
    font-variant-numeric: tabular-nums;
  }
  .awaiting {
    border: 1px dashed var(--color-line-soft);
    border-radius: 10px;
    padding: 10px;
    font-size: 9px;
    text-align: center;
    color: var(--color-muted-foreground);
  }
  .champion-plate {
    min-width: 0;
    border: 1px solid color-mix(in srgb, var(--color-accent) 30%, transparent);
    border-radius: 12px;
    background: color-mix(in srgb, var(--color-accent) 6%, transparent);
    padding: 10px;
    text-align: center;
  }
  .champion-name {
    min-width: 0;
    max-width: 100%;
    overflow-wrap: break-word;
    text-wrap: balance;
    line-height: 1.15;
  }
  .mobile-champion {
    margin-top: 4px;
    padding: 16px;
  }
  .champion-live {
    animation: champion-in 420ms cubic-bezier(0.2, 0.8, 0.2, 1) both;
  }
  .connector-right::after,
  .connector-left::after {
    content: '';
    position: absolute;
    top: 50%;
    width: 8px;
    height: 1px;
    background: var(--color-line-strong);
  }
  .connector-right::after {
    right: -9px;
  }
  .connector-left::after {
    left: -9px;
  }
  @keyframes champion-in {
    from {
      transform: scale(0.97);
      opacity: 0;
    }
    to {
      transform: none;
      opacity: 1;
    }
  }
  @media (min-width: 1024px) {
    .conference-round-picker {
      display: none;
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .champion-live {
      animation: none;
    }
    .series-card {
      transition: none;
    }
  }
</style>
