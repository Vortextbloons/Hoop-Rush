<script lang="ts">
  import type {
    FullCourtDefensiveMatchupAssignment,
    FullCourtDraftState,
    FullCourtPracticeReport,
    FullCourtReportTarget,
  } from '@hoop-rush/data-contracts';
  import {
    fullCourtReportPriceDollars,
    fullCourtReportScope,
    fullCourtReportTargetKey,
  } from '@hoop-rush/data-contracts';
  import {
    fullCourtAssessPurchase,
    fullCourtLeagueWeaknesses,
    fullCourtWarChestDollars,
    type FullCourtCatalogIndex,
    type FullCourtOpponentWeaknessCode,
    type FullCourtPlayoffOpponentPreview,
    type FullCourtRegularSeason,
  } from '@hoop-rush/engine';
  import { Film } from '@lucide/svelte';
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

  type PurchaseAssessment = ReturnType<typeof fullCourtAssessPurchase>;
  type WarRoomTab = 'all' | 'fit' | 'camp' | 'film' | 'matchups';

  const FILM_PRICE = fullCourtReportPriceDollars('opponent-film');
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
    index,
    season,
    nextFilmTarget,
    playoffPreview = null,
    busy,
    onPurchaseReport,
    preseasonOpen = true,
    practiceOpen = false,
    practice = null,
    onRunPractice = () => undefined,
    matchupContext = null,
    onMatchupsChange,
    onResetMatchups,
    art = null,
  }: {
    draft: FullCourtDraftState;
    index: FullCourtCatalogIndex;
    season: FullCourtRegularSeason;
    nextFilmTarget: Extract<FullCourtReportTarget, { kind: 'opponent-film' }> | null;
    playoffPreview?: FullCourtPlayoffOpponentPreview | null;
    busy: boolean;
    onPurchaseReport: (target: FullCourtReportTarget) => void;
    preseasonOpen?: boolean;
    practiceOpen?: boolean;
    practice?: FullCourtPracticeReport | null;
    onRunPractice?: (opponentTeamId?: string) => void;
    matchupContext?: FullCourtMatchupEditorContext | null;
    onMatchupsChange?: (assignments: readonly FullCourtDefensiveMatchupAssignment[]) => void;
    onResetMatchups?: () => void;
    art?: FullCourtArt | null;
  } = $props();

  const locked = $derived(draft.stage === 'complete');
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

  function purchaseAffordance(assessment: PurchaseAssessment): string {
    if (assessment.legal) {
      return `${formatMillions(assessment.warChestAfterPurchase)} budget after the purchase.`;
    }
    if (assessment.reason === 'completion') {
      return 'No legal roster finish remains after this purchase.';
    }
    if (assessment.minimumCompletionDollars !== null) {
      return `Needs ${formatMillions(assessment.minimumCompletionDollars)} for the cheapest legal finish.`;
    }
    return 'Budget cannot cover this report.';
  }

  function percentText(value: number): string {
    return `${Number.isInteger(value) ? String(value) : value.toFixed(1)}%`;
  }

  function minutesText(value: number): string {
    return Number.isInteger(value) ? String(value) : value.toFixed(1);
  }

  function buyFilm(): void {
    if (busy || !locked || !preseasonOpen || leagueFilmRecord !== null) return;
    const assessment = fullCourtAssessPurchase({ index, state: draft, priceDollars: FILM_PRICE });
    if (!assessment.legal) return;
    onPurchaseReport({ kind: 'opponent-film' });
  }
</script>

<div class="space-y-3">
  <Panel as="section" padding="sm" aria-label="War Room overview">
    <div class="flex flex-wrap items-center justify-between gap-3">
      <SegmentedControl
        label="War Room sections"
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
          value={fitOwned
            ? 'Owned'
            : preseasonOpen
              ? formatMillions(fullCourtReportPriceDollars('lineup-fit'))
              : 'Closed'}
        />
        <StatTile
          label="Training Camp"
          size="sm"
          surface="tile"
          tone={campOwned ? 'default' : 'muted'}
          value={campOwned
            ? 'Booked'
            : practiceOpen
              ? formatMillions(fullCourtReportPriceDollars('training-camp'))
              : 'Closed'}
        />
        <StatTile
          label="Opponent Film"
          size="sm"
          surface="tile"
          tone={leagueFilmRecord !== null ? 'default' : 'muted'}
          value={leagueFilmRecord !== null
            ? 'Owned'
            : preseasonOpen
              ? formatMillions(FILM_PRICE)
              : 'Closed'}
        />
      </StatGrid>
    </div>
  </Panel>

  <div class="grid gap-3 {activeTab === 'all' ? 'xl:grid-cols-2 xl:items-start' : ''}">
    <div class="space-y-3" hidden={activeTab !== 'all' && activeTab !== 'fit'}>
      <FullCourtRosterFitPanel
        {draft}
        {index}
        {busy}
        {onPurchaseReport}
        purchasable={preseasonOpen}
        {art}
      />
    </div>

    <div class="space-y-3" hidden={activeTab !== 'all' && activeTab !== 'camp'}>
      {#if practiceOpen || practice !== null}
        <FullCourtTrainingCampPanel
          {draft}
          {index}
          {busy}
          campOpen={practiceOpen}
          {practiceOpen}
          {practice}
          opponents={leagueOpponents}
          {onPurchaseReport}
          {onRunPractice}
          {art}
        />
      {:else}
        <details class="rounded-xl border border-line-soft bg-surface-1/60 px-4 py-2.5">
          <summary
            class="cursor-pointer font-mono text-[10px] font-bold tracking-[0.08em] text-muted-foreground uppercase"
          >
            Training Camp · Closed
          </summary>
          <div class="mt-2">
            <FullCourtTrainingCampPanel
              {draft}
              {index}
              {busy}
              campOpen={false}
              practiceOpen={false}
              {practice}
              opponents={leagueOpponents}
              {onPurchaseReport}
              {onRunPractice}
              {art}
            />
          </div>
        </details>
      {/if}
    </div>
  </div>

  <div hidden={activeTab !== 'all' && activeTab !== 'film'}>
    <Panel as="section" padding="md" aria-label="Full Court War Room opponent film">
      <SectionHeading
        eyebrow="War Room"
        title="League opponent film"
        level={2}
        size="md"
        description="One-time upgrade scanning all league opponents to surface the biggest contenders and their weaknesses."
      >
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
            <span class="font-mono text-[10px] font-bold text-muted-foreground tabular-nums">
              {formatMillions(FILM_PRICE)}
            </span>
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
      {:else if !preseasonOpen}
        <p class="mt-3 text-xs leading-relaxed text-muted-foreground">
          League opponent film closed before game 1. Preseason purchases are no longer available.
        </p>
      {:else}
        {@const filmPurchase = fullCourtAssessPurchase({
          index,
          state: draft,
          priceDollars: FILM_PRICE,
        })}
        <div class="mt-3 flex flex-wrap items-center gap-2 border-t border-line-soft pt-3">
          <Button
            size="sm"
            tone="primary"
            disabled={busy || !locked || !filmPurchase.legal}
            aria-label={`Buy opponent film for ${formatMillions(FILM_PRICE)}`}
            onclick={buyFilm}
          >
            <Film size={14} aria-hidden="true" />
            Buy opponent film
          </Button>
          <p class="min-w-0 flex-1 text-[11px] text-muted-foreground">
            {purchaseAffordance(filmPurchase)}
          </p>
        </div>
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
