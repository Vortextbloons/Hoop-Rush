<script lang="ts">
  import type {
    FullCourtDefensiveMatchupAssignment,
    FullCourtDraftState,
    FullCourtPracticeReport,
  } from '@hoop-rush/data-contracts';
  import {
    fullCourtLeagueWeaknesses,
    fullCourtWarChestDollars,
    type FullCourtOpponentWeaknessCode,
    type FullCourtPlayoffOpponentPreview,
    type FullCourtRegularSeason,
  } from '@hoop-rush/engine';
  import TeamLogo from '#lib/components/TeamLogo.svelte';
  import Badge from '#lib/components/ui/Badge.svelte';
  import Button from '#lib/components/ui/Button.svelte';
  import Panel from '#lib/components/ui/Panel.svelte';
  import SectionHeading from '#lib/components/ui/SectionHeading.svelte';
  import SegmentedControl from '#lib/components/ui/SegmentedControl.svelte';
  import StatGrid from '#lib/components/ui/StatGrid.svelte';
  import StatTile from '#lib/components/ui/StatTile.svelte';
  import { formatMillions } from '#lib/features/cap-rush/cap-rush-presentation.js';
  import FullCourtDefensiveMatchupsPanel from './FullCourtDefensiveMatchupsPanel.svelte';
  import FullCourtRosterFitPanel from './FullCourtRosterFitPanel.svelte';
  import FullCourtTrainingCampPanel from './FullCourtTrainingCampPanel.svelte';
  import type { FullCourtArt } from './full-court-art.ts';
  import type { FullCourtMatchupEditorContext } from './full-court-matchup-presenter.ts';

  type WarRoomTab = 'all' | 'fit' | 'camp' | 'film' | 'matchups';

  let activeTab = $state<WarRoomTab>('all');
  let showAllOpponents = $state(false);

  const FILM_FINDING_LABELS = {
    'three-point-volume': 'Three-point volume',
    'rim-oriented': 'Rim oriented',
    'post-up-volume': 'Post-up volume',
    'isolation-volume': 'Isolation volume',
    'pick-and-roll-volume': 'Pick-and-roll volume',
    'pressure-defense': 'Pressure defense',
    'shot-blocking': 'Shot blocking',
    'foul-prone': 'Foul prone',
    'offensive-glass-pressure': 'Offensive glass pressure',
  } as const;

  const ZONE_LABELS = {
    rim: 'Rim',
    'short-mid': 'Short mid',
    'long-mid': 'Long mid',
    'corner-three': 'Corner 3',
    'above-break-three': 'Above break',
  } as const;

  const USAGE_LABELS = {
    low: 'Low',
    balanced: 'Balanced',
    high: 'High',
    heavy: 'Heavy',
  } as const;

  const WEAKNESS_LABELS: Readonly<Record<FullCourtOpponentWeaknessCode, string>> = {
    'no-spacing': 'No spacing',
    'thin-spacing': 'Thin spacing',
    'no-rim-protection': 'No rim protection',
    'no-perimeter-stopper': 'No perimeter stopper',
    'weak-defensive-glass': 'Weak defensive glass',
    'turnover-prone': 'Turnover prone',
    'foul-prone': 'Foul prone',
    'thin-depth': 'Thin depth',
    'no-primary-creator': 'No primary creator',
  };

  let {
    draft,
    season,
    playoffPreview = null,
    busy,
    practiceOpen = false,
    practice = null,
    onRunPractice = () => undefined,
    matchupContext = null,
    onMatchupsChange,
    onResetMatchups,
    art = null,
  }: {
    draft: FullCourtDraftState;
    season: FullCourtRegularSeason;
    playoffPreview?: FullCourtPlayoffOpponentPreview | null;
    busy: boolean;
    practiceOpen?: boolean;
    practice?: FullCourtPracticeReport | null;
    onRunPractice?: (opponentTeamId?: string) => void;
    matchupContext?: FullCourtMatchupEditorContext | null;
    onMatchupsChange?: (assignments: readonly FullCourtDefensiveMatchupAssignment[]) => void;
    onResetMatchups?: () => void;
    art?: FullCourtArt | null;
  } = $props();

  const fitOwned = $derived((draft.reports ?? []).some((report) => report.kind === 'lineup-fit'));
  const campOwned = $derived(
    (draft.reports ?? []).some((report) => report.kind === 'training-camp'),
  );
  const leagueFilmRecord = $derived(
    (draft.reports ?? []).find((report) => report.kind === 'opponent-film') ?? null,
  );
  const warRoomTabOptions = $derived.by(() => {
    const base: { value: WarRoomTab; label: string }[] = [
      { value: 'all', label: 'All' },
      { value: 'fit', label: 'Roster Fit' },
      { value: 'camp', label: 'Training Camp' },
      { value: 'film', label: 'Opponent Film' },
    ];
    if (matchupContext !== null) {
      base.push({ value: 'matchups', label: 'Matchups' });
    }
    return base;
  });
  const leagueOpponents = $derived(
    season.teams
      .filter((team) => team.teamId !== season.userTeamId)
      .map((team) => ({ teamId: team.teamId, displayName: team.displayName })),
  );
  const allOpponentWeaknesses = $derived.by(() => {
    if (leagueFilmRecord === null) return [];
    const opponents = season.teams
      .filter((team) => team.teamId !== season.userTeamId)
      .map((team) => ({
        teamId: team.teamId,
        displayName: team.displayName,
        seasonKey: team.anchorSeason ?? 'Historical',
        players: team.roster.map((player) => ({
          overall:
            player.overall ??
            Math.round(
              (player.ratings.insideScoring +
                player.ratings.threePoint +
                player.ratings.perimeterDefense +
                player.ratings.interiorDefense) /
                4,
            ),
          minutes: player.anchors?.minutesPerGame ?? 12,
          ratings: player.ratings,
          tendencies: player.tendencies,
        })),
      }));
    return fullCourtLeagueWeaknesses(opponents);
  });
  const displayedOpponentWeaknesses = $derived(
    showAllOpponents ? allOpponentWeaknesses : allOpponentWeaknesses.slice(0, 8),
  );

  function percentText(value: number): string {
    return `${Number.isInteger(value) ? String(value) : value.toFixed(1)}%`;
  }

  function minutesText(value: number): string {
    return Number.isInteger(value) ? String(value) : value.toFixed(1);
  }
</script>

<div class="space-y-3">
  <Panel as="section" padding="sm" aria-label="War Room overview">
    <div class="flex flex-wrap items-center justify-between gap-3">
      <SegmentedControl
        label="War Room sections"
        class="max-w-full flex-wrap max-sm:[&>button]:min-h-11"
        value={activeTab}
        onchange={(next) => (activeTab = next)}
        options={warRoomTabOptions}
      />
      <StatGrid columns={4} mobile={2}>
        <StatTile
          label="Budget"
          size="sm"
          surface="tile"
          value={formatMillions(fullCourtWarChestDollars(draft))}
        />
        <StatTile
          label="Roster Fit"
          size="sm"
          surface="tile"
          tone={fitOwned ? 'default' : 'muted'}
          value={fitOwned ? 'Owned' : 'Not purchased'}
        />
        <StatTile
          label="Training Camp"
          size="sm"
          surface="tile"
          tone={campOwned ? 'default' : 'muted'}
          value={campOwned ? 'Booked' : 'Not purchased'}
        />
        <StatTile
          label="Opponent Film"
          size="sm"
          surface="tile"
          tone={leagueFilmRecord !== null ? 'default' : 'muted'}
          value={leagueFilmRecord !== null ? 'Owned' : 'Not purchased'}
        />
      </StatGrid>
    </div>
  </Panel>

  <div class="grid gap-3 {activeTab === 'all' ? 'xl:grid-cols-2 xl:items-start' : ''}">
    <div class="space-y-3" hidden={activeTab !== 'all' && activeTab !== 'fit'}>
      <FullCourtRosterFitPanel {draft} {art} />
    </div>

    <div class="space-y-3" hidden={activeTab !== 'all' && activeTab !== 'camp'}>
      <FullCourtTrainingCampPanel
        {draft}
        {busy}
        {practiceOpen}
        {practice}
        opponents={leagueOpponents}
        {onRunPractice}
        {art}
      />
    </div>
  </div>

  <div hidden={activeTab !== 'all' && activeTab !== 'film'}>
    <Panel as="section" padding="md" aria-label="Full Court War Room opponent film">
      <SectionHeading eyebrow="War Room" title="League opponent film" level={2} size="md">
        {#snippet actions()}
          {#if leagueFilmRecord !== null}
            <div class="flex items-center gap-2">
              <Button
                size="sm"
                tone="secondary"
                onclick={() => (showAllOpponents = !showAllOpponents)}
              >
                {showAllOpponents
                  ? 'Top 8 contenders'
                  : `All ${String(allOpponentWeaknesses.length)} teams`}
              </Button>
              <Badge tone="positive">Owned</Badge>
            </div>
          {:else}
            <Badge tone="neutral">Not purchased</Badge>
          {/if}
        {/snippet}
      </SectionHeading>

      {#if leagueFilmRecord !== null}
        <div
          class="mt-3 grid max-h-[26rem] gap-2 overflow-y-auto pr-1 sm:grid-cols-2 lg:grid-cols-4"
        >
          {#each displayedOpponentWeaknesses as opponent, idx (opponent.teamId)}
            {@const oppIdentity = art === null ? null : art.teamFor(opponent.teamId)}
            <div class="rounded-lg border border-line-soft bg-surface-1 p-2.5">
              <div class="flex items-center gap-2">
                {#if oppIdentity !== null && art !== null}
                  <TeamLogo
                    manifest={art.manifest}
                    franchiseId={oppIdentity.franchiseId}
                    teamExternalId={oppIdentity.teamExternalId}
                    className="h-5 w-5 shrink-0"
                  />
                {/if}
                <div class="min-w-0">
                  <p class="font-display truncate text-sm font-extrabold">
                    #{idx + 1}
                    {opponent.displayName}
                  </p>
                  <p class="ui-micro">{opponent.seasonKey} · {opponent.rating} OVR</p>
                </div>
              </div>
              <div class="mt-2 flex flex-wrap gap-1">
                {#if opponent.weaknesses.length === 0}
                  <Badge tone="neutral">No major gaps</Badge>
                {:else}
                  {#each opponent.weaknesses as code (code)}
                    <Badge tone="negative">{WEAKNESS_LABELS[code]}</Badge>
                  {/each}
                {/if}
              </div>
            </div>
          {/each}
        </div>
      {:else}
        <p class="mt-3 text-xs text-muted-foreground">Not purchased at run setup.</p>
      {/if}
    </Panel>
  </div>

  {#if matchupContext !== null}
    <div hidden={activeTab !== 'all' && activeTab !== 'matchups'}>
      <FullCourtDefensiveMatchupsPanel
        context={matchupContext}
        {art}
        {busy}
        {onMatchupsChange}
        {onResetMatchups}
      />
    </div>
  {/if}
</div>
