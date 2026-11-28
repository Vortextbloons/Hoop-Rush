<script lang="ts">
  import type { HoopRushManifest } from '@hoop-rush/data-contracts';
  import { capRushConferenceRoundName } from '@hoop-rush/data-contracts';
  import { onMount } from 'svelte';
  import { franchiseIdentityOf } from '#lib/branding.js';
  import PlayoffBracket from '#lib/components/basketball/PlayoffBracket.svelte';
  import TeamLogo from '#lib/components/TeamLogo.svelte';
  import Badge from '#lib/components/ui/Badge.svelte';
  import Panel from '#lib/components/ui/Panel.svelte';
  import SectionHeading from '#lib/components/ui/SectionHeading.svelte';
  import { getManifest } from '#lib/data.js';
  import type { FullCourtArt } from './full-court-art.ts';
  import type { FullCourtHistoryEntryView } from './full-court-history-presentation.ts';
  import type { FullCourtReportData } from './full-court-report-data.ts';

  let {
    entry,
    data,
    art = null,
  }: {
    entry: FullCourtHistoryEntryView;
    data: FullCourtReportData;
    art?: FullCourtArt | null;
  } = $props();

  let manifest = $state.raw<HoopRushManifest | null>(null);
  onMount(() => {
    let mounted = true;
    void getManifest()
      .then((loaded) => {
        if (mounted) manifest = loaded;
      })
      .catch(() => undefined);
    return () => {
      mounted = false;
    };
  });

  const userTeamId = $derived(data.seasonLock.season.userTeamId);
  const teamsById = $derived(
    new Map(data.seasonLock.season.teams.map((team) => [team.teamId, team.displayName])),
  );
  const seedsById = $derived(
    new Map([...data.standings.west, ...data.standings.east].map((row) => [row.teamId, row.seed])),
  );
  const bracket = $derived(data.bracket);
  const userSeries = $derived(
    bracket === null
      ? []
      : bracket.series.filter(
          (series) => series.highTeamId === userTeamId || series.lowTeamId === userTeamId,
        ),
  );
  const championId = $derived(bracket?.championTeamId ?? null);
  const championIdentity = $derived(
    championId === null || art === null ? null : art.teamFor(championId),
  );

  function teamNameOf(teamId: string): string {
    return teamsById.get(teamId) ?? teamId;
  }

  function seedOf(teamId: string): number {
    return seedsById.get(teamId) ?? 0;
  }

  function identityOf(teamId: string) {
    if (manifest === null) return null;
    const identity = franchiseIdentityOf(manifest, teamId);
    if (identity === null) return null;
    return {
      franchiseId: identity.franchiseId,
      teamExternalId: identity.teamExternalId,
      abbreviation: identity.abbreviation,
    };
  }

  function seriesWins(series: (typeof userSeries)[number], teamId: string): number {
    return series.games.filter((game) => game.winnerTeamId === teamId).length;
  }

  const finishCopy = $derived(
    entry.playoffStatus === 'champion'
      ? 'You won all four rounds and lifted the title.'
      : entry.playoffStatus === 'eliminated'
        ? `Your run ended in the ${capRushConferenceRoundName(entry.seriesWon + 1)}.`
        : 'Your team missed the top eight in its conference.',
  );
</script>

<Panel as="section" padding="md" aria-label="Postseason finish">
  <div class="finish">
    <div class="finish-id">
      {#if championIdentity !== null && art !== null}
        <span class="finish-crest">
          <TeamLogo
            manifest={art.manifest}
            franchiseId={championIdentity.franchiseId}
            teamExternalId={championIdentity.teamExternalId}
            alt=""
            className="h-9 w-9"
            eager
          />
        </span>
      {/if}
      <div class="min-w-0">
        <p class="ui-label">{entry.playoffStatus === 'champion' ? 'Champions' : 'Champion'}</p>
        <p class="finish-champion">{entry.championName}</p>
      </div>
    </div>
    <div class="finish-copy">
      <p class="finish-result">{finishCopy}</p>
      <div class="mt-1.5 flex flex-wrap gap-1.5">
        <Badge tone={entry.playoffTone}>{entry.playoffLabel}</Badge>
        <Badge tone="primary">{entry.seriesWon} series won</Badge>
      </div>
    </div>
  </div>
</Panel>

{#if bracket !== null}
  <PlayoffBracket
    series={bracket.series}
    {manifest}
    {userTeamId}
    {teamNameOf}
    teamSeedOf={seedOf}
    teamIdentityOf={identityOf}
    ariaLabel="Final playoff bracket"
    eyebrow="Bracket"
    title="Every series"
  />
{:else}
  <Panel as="section" padding="md" aria-label="Bracket unavailable">
    <SectionHeading eyebrow="Bracket" title="No bracket was saved" level={2} size="sm" />
    <p class="mt-2 text-xs leading-relaxed text-muted-foreground">
      This run's playoff rows are not on disk, so the bracket cannot be rebuilt. The final finish is
      still recorded above.
    </p>
  </Panel>
{/if}

{#if userSeries.length > 0}
  <Panel as="section" padding="md" aria-label="Your series">
    <SectionHeading eyebrow="Your path" title="Series by series" level={2} size="sm" />
    <ul class="mt-3 flex flex-col gap-1.5">
      {#each userSeries as series (series.seriesId)}
        {@const opponentId =
          series.highTeamId === userTeamId ? series.lowTeamId : series.highTeamId}
        {@const won = seriesWins(series, userTeamId)}
        {@const lost = seriesWins(series, opponentId)}
        {@const advanced = won > lost}
        <li class="series-row" data-won={advanced}>
          <span class="series-round">{capRushConferenceRoundName(series.round)}</span>
          <span class="series-opponent">
            vs {teamNameOf(opponentId)}
          </span>
          <span class="series-score" data-won={advanced}>{won}–{lost}</span>
        </li>
      {/each}
    </ul>
  </Panel>
{/if}

<style>
  .finish {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 1rem;
  }
  .finish-id {
    display: flex;
    min-width: 0;
    align-items: center;
    gap: 0.7rem;
  }
  .finish-crest {
    display: grid;
    flex: none;
    place-items: center;
    width: 2.9rem;
    height: 2.9rem;
    border: 1px solid color-mix(in srgb, var(--color-accent) 40%, transparent);
    border-radius: 0.7rem;
    background: color-mix(in srgb, var(--color-accent) 12%, transparent);
  }
  .finish-champion {
    margin: 0.1rem 0 0;
    font-family: var(--font-display);
    font-size: 1.4rem;
    font-weight: 800;
    line-height: 1.05;
    text-transform: uppercase;
    overflow-wrap: anywhere;
  }
  .finish-copy {
    min-width: 0;
    flex: 1 1 14rem;
  }
  .finish-result {
    margin: 0;
    color: var(--color-muted-foreground);
    font-size: 0.8rem;
    line-height: 1.5;
  }
  .series-row {
    display: flex;
    align-items: center;
    gap: 0.6rem;
    padding: 0.5rem 0.7rem;
    border: 1px solid var(--color-line-soft);
    border-left: 3px solid var(--color-line-strong);
    border-radius: 0.6rem;
    background: var(--color-surface-1);
  }
  .series-row[data-won='true'] {
    border-left-color: var(--color-positive);
  }
  .series-row[data-won='false'] {
    border-left-color: var(--color-negative);
  }
  .series-round {
    flex: none;
    color: var(--color-muted-foreground);
    font-family: var(--font-mono);
    font-size: 0.6rem;
    font-weight: 700;
    letter-spacing: 0.06em;
    text-transform: uppercase;
  }
  .series-opponent {
    min-width: 0;
    flex: 1;
    overflow: hidden;
    font-size: 0.8rem;
    font-weight: 600;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .series-score {
    flex: none;
    font-family: var(--font-display);
    font-size: 1.05rem;
    font-weight: 800;
    font-variant-numeric: tabular-nums;
  }
  .series-score[data-won='true'] {
    color: var(--color-positive);
  }
</style>
