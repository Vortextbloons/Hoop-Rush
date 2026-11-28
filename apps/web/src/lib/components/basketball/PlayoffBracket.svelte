<script lang="ts">
  import {
    CAP_RUSH_CONFERENCE_ROUND_NAMES,
    type HoopRushManifest,
  } from '@hoop-rush/data-contracts';
  import TeamLogo from '#lib/components/TeamLogo.svelte';
  import SegmentedControl from '#lib/components/ui/SegmentedControl.svelte';
  import Panel from '#lib/components/ui/Panel.svelte';
  import SectionHeading from '#lib/components/ui/SectionHeading.svelte';
  import type { BracketSeries, BracketTeamIdentity } from './playoff-bracket.js';

  let {
    series,
    teamNameOf,
    teamSeedOf,
    teamIdentityOf,
    manifest = null,
    userTeamId = null,
    ariaLabel = 'Playoff bracket',
    eyebrow = null,
    title = 'Bracket',
    onTeamSelect,
    onSeriesSelect,
    selectedSeriesId = null,
  }: {
    series: readonly BracketSeries[];
    teamNameOf: (teamId: string) => string;
    teamSeedOf: (teamId: string) => number;
    teamIdentityOf: (teamId: string) => BracketTeamIdentity | null;
    manifest?: HoopRushManifest | null;
    userTeamId?: string | null;
    ariaLabel?: string;
    eyebrow?: string | null;
    title?: string;
    onTeamSelect?: (teamId: string) => void;
    onSeriesSelect?: (series: BracketSeries) => void;
    selectedSeriesId?: string | null;
  } = $props();

  const roundNames = CAP_RUSH_CONFERENCE_ROUND_NAMES;
  const latestRound = $derived(
    series.length === 0 ? 1 : Math.max(...series.map((entry) => entry.round)),
  );
  const championId = $derived.by(() => {
    const finals = series.find((entry) => entry.round === 4 && entry.seriesSlot === 0);
    return finals === undefined ? null : winnerOf(finals);
  });
  let selectedRound = $state<number | null>(null);
  let mobileConference = $state<'west' | 'east'>('west');
  const activeRound = $derived(selectedRound ?? latestRound);

  function winsOf(entry: BracketSeries, teamId: string): number {
    return entry.games.filter((game) => game.winnerTeamId === teamId).length;
  }

  function winnerOf(entry: BracketSeries): string | null {
    if (winsOf(entry, entry.highTeamId) >= 4) return entry.highTeamId;
    if (winsOf(entry, entry.lowTeamId) >= 4) return entry.lowTeamId;
    return null;
  }

  function shortNameOf(teamId: string): string {
    return teamIdentityOf(teamId)?.abbreviation ?? teamNameOf(teamId);
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
    return series
      .filter((entry) => entry.round === round && slots.includes(entry.seriesSlot))
      .sort((left, right) => left.seriesSlot - right.seriesSlot);
  }

  function seriesAt(round: number, slot: number): BracketSeries | undefined {
    return series.find((entry) => entry.round === round && entry.seriesSlot === slot);
  }

  function hasUser(entry: BracketSeries): boolean {
    return (
      userTeamId !== null && (entry.highTeamId === userTeamId || entry.lowTeamId === userTeamId)
    );
  }

  function roundLabel(entry: BracketSeries): string {
    return `${roundNames[entry.round - 1] ?? 'Round'} ${teamSeedOf(entry.highTeamId)} vs ${teamSeedOf(entry.lowTeamId)}`;
  }

  const mobileSeries = $derived(
    activeRound === 4 ? roundSeries(4, 'finals') : roundSeries(activeRound, mobileConference),
  );
</script>

<Panel as="section" padding="none" class="bracket p-4 sm:p-6" aria-label={ariaLabel}>
  <SectionHeading {eyebrow} {title} size="md">
    {#snippet actions()}
      <SegmentedControl
        class="lg:hidden"
        label="Choose a playoff round"
        size="md"
        value={activeRound}
        onchange={(round) => (selectedRound = round)}
        options={roundNames.map((name, index) => ({ value: index + 1, label: name }))}
      />
    {/snippet}
  </SectionHeading>

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
          <p class="ui-label text-accent">Champion</p>
          {#if championId !== null}
            <div class="mt-2 flex min-w-0 flex-col items-center justify-center gap-1.5">
              {#if teamIdentityOf(championId) && manifest}
                {@const identity = teamIdentityOf(championId)}
                <TeamLogo
                  {manifest}
                  franchiseId={identity?.franchiseId ?? championId}
                  teamExternalId={identity?.teamExternalId ?? ''}
                  alt=""
                  className="h-8 w-8"
                />
              {/if}
              <span class="champion-name font-display text-base font-extrabold uppercase">
                {teamNameOf(championId)}
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

  <div class="mt-4 flex flex-col gap-2 lg:hidden">
    {#if activeRound !== 4}
      <SegmentedControl
        class="w-full"
        label="Choose a conference"
        value={mobileConference}
        onchange={(side) => (mobileConference = side)}
        options={[
          { value: 'west', label: 'West' },
          { value: 'east', label: 'East' },
        ]}
      />
    {/if}
    <p class="font-mono text-[10px] font-bold tracking-[0.12em] text-primary uppercase">
      {roundNames[activeRound - 1]}
    </p>
    {#each mobileSeries as entry (entry.seriesId)}
      {@render seriesCard(entry, 'none', true)}
    {/each}
    {#if activeRound === 4 && championId !== null}
      <div class="champion-plate mobile-champion">
        <p class="ui-label text-accent">Champion</p>
        <p class="champion-name font-display mt-1 text-xl font-extrabold uppercase">
          {teamNameOf(championId)}
        </p>
      </div>
    {/if}
    {#if mobileSeries.length === 0}
      <p class="rounded-xl border border-dashed border-line-soft p-3 text-xs text-muted-foreground">
        Awaiting the previous round.
      </p>
    {/if}
  </div>
</Panel>

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
        onclick={() => onSeriesSelect(entry)}
      ></button>
    {/if}
    <div class="relative z-10 pointer-events-none">
      {#each [entry.highTeamId, entry.lowTeamId] as teamId (teamId)}
        {@const identity = teamIdentityOf(teamId)}
        {@const won = winner === teamId}
        {@const isUser = userTeamId === teamId}
        <div class="team-row {won ? 'team-won' : ''} {isUser ? 'team-user' : ''}">
          <span class="seed">{teamSeedOf(teamId)}</span>
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
              title={teamNameOf(teamId)}
              onclick={() => onTeamSelect(teamId)}
            >
              {mobile ? teamNameOf(teamId) : shortNameOf(teamId)}
            </button>
          {:else}
            <span class="team-name" title={teamNameOf(teamId)}
              >{mobile ? teamNameOf(teamId) : shortNameOf(teamId)}</span
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
  @media (prefers-reduced-motion: reduce) {
    .champion-live {
      animation: none;
    }
    .series-card {
      transition: none;
    }
  }
</style>
