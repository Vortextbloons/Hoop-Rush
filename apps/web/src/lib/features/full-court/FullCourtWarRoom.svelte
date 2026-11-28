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
    fullCourtFilmReport,
    fullCourtLeagueWeaknesses,
    type FullCourtCatalogIndex,
    type FullCourtFilmPlayer,
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
  import { formatMillions } from '#lib/features/cap-rush/cap-rush-presentation.js';
  import {
    fullCourtPlayoffAdaptationRead,
    fullCourtPlayoffFixtureLabel,
  } from './full-court-season-presenter.ts';
  import FullCourtDefensiveMatchupsPanel from './FullCourtDefensiveMatchupsPanel.svelte';
  import FullCourtPortrait from './FullCourtPortrait.svelte';
  import FullCourtRosterFitPanel from './FullCourtRosterFitPanel.svelte';
  import FullCourtScoutEvidence from './FullCourtScoutEvidence.svelte';
  import FullCourtTrainingCampPanel from './FullCourtTrainingCampPanel.svelte';
  import type { FullCourtArt } from './full-court-art.ts';
  import type { FullCourtMatchupEditorContext } from './full-court-matchup-presenter.ts';

  type SeasonTeam = FullCourtRegularSeason['teams'][number];
  type PurchaseAssessment = ReturnType<typeof fullCourtAssessPurchase>;
  type FilmReport = ReturnType<typeof fullCourtFilmReport>;

  interface FilmRotationRead {
    players: readonly FullCourtFilmPlayer[];
    missingVersion: readonly string[];
    missingMinutes: readonly string[];
    startersKnown: boolean;
  }

  const FILM_PRICE = fullCourtReportPriceDollars('opponent-film');

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
    practiceOpen?: boolean;
    practice?: FullCourtPracticeReport | null;
    onRunPractice?: (opponentTeamId?: string) => void;
    matchupContext?: FullCourtMatchupEditorContext | null;
    onMatchupsChange?: (assignments: readonly FullCourtDefensiveMatchupAssignment[]) => void;
    onResetMatchups?: () => void;
    art?: FullCourtArt | null;
  } = $props();

  const reportsByTarget = $derived(
    new Map(
      (draft.reports ?? []).map((report) => [fullCourtReportTargetKey(report.target), report]),
    ),
  );
  const locked = $derived(draft.stage === 'complete');
  const leagueFilmRecord = $derived(
    (draft.reports ?? []).find((report) => report.kind === 'opponent-film') ?? null,
  );
  const leagueOpponents = $derived(
    season.teams
      .filter((team) => team.teamId !== season.userTeamId)
      .map((team) => ({ teamId: team.teamId, displayName: team.displayName })),
  );
  const topOpponentWeaknesses = $derived.by(() => {
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
    return fullCourtLeagueWeaknesses(opponents).slice(0, 8);
  });

  const filmFixture = $derived(
    nextFilmTarget === null
      ? null
      : (season.games.find((game) => game.gameId === nextFilmTarget.gameId) ?? null),
  );
  const filmPlayoffLabel = $derived(
    nextFilmTarget?.gameId === undefined
      ? null
      : fullCourtPlayoffFixtureLabel(nextFilmTarget.gameId),
  );
  const matchingPlayoffAdjustment = $derived.by(() => {
    if (
      nextFilmTarget === null ||
      playoffPreview === null ||
      playoffPreview.gameId !== nextFilmTarget.gameId ||
      playoffPreview.opponentTeamId !== nextFilmTarget.opponentTeamId ||
      playoffPreview.adaptation === null
    ) {
      return null;
    }
    return fullCourtPlayoffAdaptationRead(playoffPreview.adaptation);
  });
  const opponentTeam = $derived(
    nextFilmTarget === null
      ? null
      : (season.teams.find((team) => team.teamId === nextFilmTarget.opponentTeamId) ?? null),
  );
  const filmRecord = $derived(
    nextFilmTarget === null
      ? null
      : (reportsByTarget.get(fullCourtReportTargetKey(nextFilmTarget)) ?? null),
  );
  const filmAssessment = $derived(
    nextFilmTarget === null
      ? null
      : fullCourtAssessPurchase({ index, state: draft, priceDollars: FILM_PRICE }),
  );
  const filmRead = $derived(opponentTeam === null ? null : filmRotationOf(opponentTeam));
  const filmReport = $derived.by((): FilmReport | null => {
    const team = opponentTeam;
    const read = filmRead;
    if (filmRecord === null || team === null || read === null) return null;
    if (read.players.length === 0 || team.anchorSeason === null) return null;
    try {
      return fullCourtFilmReport({
        teamId: team.teamId,
        seasonKey: team.anchorSeason,
        rotation: read.players,
      });
    } catch {
      return null;
    }
  });

  const freeStarters = $derived.by(() => {
    const team = opponentTeam;
    const startingFive = team?.rotation?.startingFive;
    if (team === null || startingFive === undefined) {
      return { names: [] as string[], complete: false };
    }
    const byId = new Map<string, string>(
      team.roster.map((player) => [player.playerId, player.displayName]),
    );
    const names = startingFive.flatMap((playerId) => {
      const name = byId.get(playerId);
      return name === undefined ? [] : [name];
    });
    return { names, complete: names.length === startingFive.length };
  });

  function filmRotationOf(team: SeasonTeam): FilmRotationRead {
    const starters =
      team.rotation === undefined ? null : new Set<string>(team.rotation.startingFive ?? []);
    const players: FullCourtFilmPlayer[] = [];
    const missingVersion: string[] = [];
    const missingMinutes: string[] = [];
    for (const player of team.roster) {
      if (player.playerVersionId === undefined) {
        missingVersion.push(player.displayName);
        continue;
      }
      const minutes = player.anchors?.minutesPerGame;
      if (minutes === undefined || minutes <= 0) {
        missingMinutes.push(player.displayName);
        continue;
      }
      players.push({
        playerId: player.playerId,
        playerVersionId: player.playerVersionId,
        displayName: player.displayName,
        positions: player.positions,
        minutes,
        starter: starters?.has(player.playerId) ?? false,
        ratings: player.ratings,
        tendencies: player.tendencies,
      });
    }
    return {
      players,
      missingVersion,
      missingMinutes,
      startersKnown: starters !== null,
    };
  }

  function scopeLabel(kind: 'opponent-film'): string {
    return fullCourtReportScope(kind) === 'run' ? 'Lifetime of this run' : 'This game only';
  }

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
    if (busy || !locked || leagueFilmRecord !== null) return;
    const assessment = fullCourtAssessPurchase({ index, state: draft, priceDollars: FILM_PRICE });
    if (!assessment.legal) return;
    onPurchaseReport({ kind: 'opponent-film' });
  }
</script>

<div class="flex flex-col gap-3">
  <FullCourtRosterFitPanel {draft} {index} {busy} {onPurchaseReport} {art} />

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
          <Badge tone="positive">Owned</Badge>
        {:else}
          <span class="font-mono text-[10px] font-bold text-muted-foreground tabular-nums">
            {formatMillions(FILM_PRICE)}
          </span>
        {/if}
      {/snippet}
    </SectionHeading>

    {#if leagueFilmRecord !== null}
      <div class="mt-3 grid gap-2 sm:grid-cols-2">
        {#each topOpponentWeaknesses as opponent, idx (opponent.teamId)}
          {@const oppIdentity = art === null ? null : art.teamFor(opponent.teamId)}
          <div class="rounded-lg border border-line-soft bg-surface-1 p-2.5">
            <div class="flex items-center justify-between gap-2">
              <div class="flex min-w-0 items-center gap-2">
                {#if oppIdentity !== null && art !== null}
                  <TeamLogo
                    manifest={art.manifest}
                    franchiseId={oppIdentity.franchiseId}
                    teamExternalId={oppIdentity.teamExternalId}
                    className="h-5 w-5"
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

  {#if matchupContext !== null}
    <FullCourtDefensiveMatchupsPanel
      context={matchupContext}
      {busy}
      {onMatchupsChange}
      {onResetMatchups}
    />
  {/if}
</div>
