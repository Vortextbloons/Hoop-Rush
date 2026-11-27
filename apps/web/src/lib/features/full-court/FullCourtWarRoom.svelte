<script lang="ts">
  import type { FullCourtDraftState, FullCourtReportTarget } from '@hoop-rush/data-contracts';
  import {
    fullCourtReportPriceDollars,
    fullCourtReportScope,
    fullCourtReportTargetKey,
  } from '@hoop-rush/data-contracts';
  import {
    fullCourtAssessPurchase,
    fullCourtFilmReport,
    fullCourtLineupFitReport,
    fullCourtPayrollDollars,
    fullCourtWarChestDollars,
    type FullCourtCatalogIndex,
    type FullCourtFilmPlayer,
    type FullCourtPlayoffOpponentPreview,
    type FullCourtRegularSeason,
  } from '@hoop-rush/engine';
  import { FileSearch, Film } from '@lucide/svelte';
  import Badge from '#lib/components/ui/Badge.svelte';
  import Button from '#lib/components/ui/Button.svelte';
  import Panel from '#lib/components/ui/Panel.svelte';
  import SectionHeading from '#lib/components/ui/SectionHeading.svelte';
  import { formatMillions } from '#lib/features/cap-rush/cap-rush-presentation.js';
  import { formatWarChestCr } from './full-court-draft-presentation.js';
  import {
    fullCourtPlayoffAdaptationRead,
    fullCourtPlayoffFixtureLabel,
  } from './full-court-season-presenter.ts';
  import FullCourtScoutEvidence from './FullCourtScoutEvidence.svelte';

  type SeasonTeam = FullCourtRegularSeason['teams'][number];
  type PurchaseAssessment = ReturnType<typeof fullCourtAssessPurchase>;
  type FilmReport = ReturnType<typeof fullCourtFilmReport>;

  interface FilmRotationRead {
    players: readonly FullCourtFilmPlayer[];
    missingVersion: readonly string[];
    missingMinutes: readonly string[];
    startersKnown: boolean;
  }

  const FIT_TARGET = { kind: 'lineup-fit' } as const satisfies FullCourtReportTarget;
  const FIT_PRICE = fullCourtReportPriceDollars('lineup-fit');
  const FILM_PRICE = fullCourtReportPriceDollars('opponent-film');

  const LINEUP_FINDING_LABELS = {
    'multiple-creators': 'Multiple creators',
    'spacing-volume': 'Spacing volume',
    'playmaking-depth': 'Playmaking depth',
    'rim-protection': 'Rim protection',
    'perimeter-defense': 'Perimeter defense',
    'glass-control': 'Glass control',
    'roster-depth': 'Roster depth',
    'no-primary-creator': 'No primary creator',
    'no-spacing': 'No spacing',
    'thin-spacing': 'Thin spacing',
    'no-rim-protection': 'No rim protection',
    'no-perimeter-stopper': 'No perimeter stopper',
    'weak-defensive-glass': 'Weak defensive glass',
    'turnover-risk': 'Turnover risk',
    'thin-depth': 'Thin depth',
  } as const;

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

  let {
    draft,
    index,
    season,
    nextFilmTarget,
    playoffPreview = null,
    busy,
    onPurchaseReport,
  }: {
    draft: FullCourtDraftState;
    index: FullCourtCatalogIndex;
    season: FullCourtRegularSeason;
    nextFilmTarget: Extract<FullCourtReportTarget, { kind: 'opponent-film' }> | null;
    playoffPreview?: FullCourtPlayoffOpponentPreview | null;
    busy: boolean;
    onPurchaseReport: (target: FullCourtReportTarget) => void;
  } = $props();

  const reportsByTarget = $derived(
    new Map(
      (draft.reports ?? []).map((report) => [fullCourtReportTargetKey(report.target), report]),
    ),
  );
  const fitRecord = $derived(reportsByTarget.get(fullCourtReportTargetKey(FIT_TARGET)) ?? null);
  const roster = $derived(draft.picks.map((pick) => pick.player));
  const fitReport = $derived(fitRecord === null ? null : fullCourtLineupFitReport(roster));
  const payrollDollars = $derived(fullCourtPayrollDollars(draft.picks));
  const warChestCr = $derived(formatWarChestCr(fullCourtWarChestDollars(draft)));
  const locked = $derived(draft.stage === 'complete');

  const fitAssessment = $derived(
    fullCourtAssessPurchase({ index, state: draft, priceDollars: FIT_PRICE }),
  );

  const filmFixture = $derived(
    nextFilmTarget === null
      ? null
      : (season.games.find((game) => game.gameId === nextFilmTarget.gameId) ?? null),
  );
  const filmPlayoffLabel = $derived(
    nextFilmTarget === null ? null : fullCourtPlayoffFixtureLabel(nextFilmTarget.gameId),
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

  function scopeLabel(kind: 'lineup-fit' | 'opponent-film'): string {
    return fullCourtReportScope(kind) === 'run' ? 'Lifetime of this run' : 'This game only';
  }

  function purchaseAffordance(assessment: PurchaseAssessment): string {
    if (assessment.legal) {
      return `${formatWarChestCr(assessment.warChestAfterPurchase)} War Chest after the purchase.`;
    }
    if (assessment.reason === 'completion') {
      return 'No legal roster finish remains after this purchase.';
    }
    if (assessment.minimumCompletionDollars !== null) {
      return `Needs ${formatWarChestCr(assessment.minimumCompletionDollars)} for the cheapest legal finish.`;
    }
    return 'The War Chest cannot cover this report.';
  }

  function percentText(value: number): string {
    return `${Number.isInteger(value) ? String(value) : value.toFixed(1)}%`;
  }

  function minutesText(value: number): string {
    return Number.isInteger(value) ? String(value) : value.toFixed(1);
  }

  function buyFit(): void {
    if (busy || !locked || fitRecord !== null || !fitAssessment.legal) return;
    onPurchaseReport(FIT_TARGET);
  }

  function buyFilm(): void {
    if (busy || !locked || nextFilmTarget === null || filmRecord !== null) return;
    if (filmAssessment === null || !filmAssessment.legal) return;
    onPurchaseReport(nextFilmTarget);
  }
</script>

<div class="flex flex-col gap-3">
  <Panel as="section" padding="md" aria-label="Full Court War Room roster fit">
    <SectionHeading
      eyebrow="War Room"
      title="Locked roster fit"
      level={2}
      size="md"
      description="A paid read of the locked roster's catalog traits. No projection or result is added."
    >
      {#snippet actions()}
        {#if fitRecord !== null}
          <Badge tone="positive">Owned</Badge>
        {:else}
          <span class="font-mono text-[10px] font-bold text-muted-foreground tabular-nums">
            {formatWarChestCr(FIT_PRICE)}
          </span>
        {/if}
      {/snippet}
    </SectionHeading>

    <div class="mt-2 flex flex-wrap items-baseline gap-x-3 gap-y-1">
      <p class="font-mono text-[10px] text-muted-foreground uppercase">
        {roster.length} players · {formatMillions(payrollDollars)} payroll
      </p>
      <p class="font-mono text-[10px] text-muted-foreground uppercase">{warChestCr} War Chest</p>
      <p class="font-mono text-[9px] text-muted-foreground uppercase">{scopeLabel('lineup-fit')}</p>
    </div>

    {#if fitReport !== null}
      <div class="mt-3 grid gap-3 sm:grid-cols-2">
        <section
          class="rounded-xl border border-line-soft bg-surface-1 p-3"
          aria-label="Roster strengths"
        >
          <p class="ui-label text-muted-foreground">Strengths</p>
          {#if fitReport.strengths.length === 0}
            <p class="mt-1 text-[11px] text-muted-foreground">
              No strength cleared the evidence thresholds.
            </p>
          {:else}
            <ul class="mt-1.5 flex flex-col gap-2">
              {#each fitReport.strengths as finding (finding.code)}
                <li>
                  <p class="text-[11px] font-bold">{LINEUP_FINDING_LABELS[finding.code]}</p>
                  {#if finding.evidence.length > 0}
                    <div class="mt-1">
                      <FullCourtScoutEvidence
                        items={finding.evidence.map((entry) => ({
                          name: entry.displayName,
                          field: entry.field,
                          value: entry.value,
                        }))}
                      />
                    </div>
                  {/if}
                </li>
              {/each}
            </ul>
          {/if}
        </section>

        <section
          class="rounded-xl border border-line-soft bg-surface-1 p-3"
          aria-label="Roster gaps"
        >
          <p class="ui-label text-muted-foreground">Gaps</p>
          {#if fitReport.gaps.length === 0}
            <p class="mt-1 text-[11px] text-muted-foreground">
              No gap cleared the evidence thresholds.
            </p>
          {:else}
            <ul class="mt-1.5 flex flex-col gap-2">
              {#each fitReport.gaps as finding (finding.code)}
                <li>
                  <p class="text-[11px] font-bold">{LINEUP_FINDING_LABELS[finding.code]}</p>
                  {#if finding.evidence.length > 0}
                    <div class="mt-1">
                      <FullCourtScoutEvidence
                        items={finding.evidence.map((entry) => ({
                          name: entry.displayName,
                          field: entry.field,
                          value: entry.value,
                        }))}
                      />
                    </div>
                  {/if}
                </li>
              {/each}
            </ul>
          {/if}
        </section>
      </div>
    {:else if fitRecord !== null}
      <p class="mt-3 text-xs text-muted-foreground">
        The roster fit report is unavailable for this roster.
      </p>
    {:else}
      <div class="mt-3 flex flex-wrap items-center gap-2 border-t border-line-soft pt-3">
        <Button
          size="sm"
          tone="primary"
          disabled={busy || !locked || !fitAssessment.legal}
          aria-label={`Buy roster fit for ${formatWarChestCr(FIT_PRICE)}`}
          onclick={buyFit}
        >
          <FileSearch size={14} aria-hidden="true" />
          Buy roster fit
        </Button>
        <p class="min-w-0 flex-1 text-[11px] text-muted-foreground">
          {purchaseAffordance(fitAssessment)}
        </p>
      </div>
    {/if}
  </Panel>

  <Panel as="section" padding="md" aria-label="Full Court War Room opponent film">
    <SectionHeading
      eyebrow="War Room"
      title="Next-game opponent film"
      level={2}
      size="md"
      description="Historical rotation input, never a played result."
    >
      {#snippet actions()}
        {#if filmRecord !== null}
          <Badge tone="positive">Owned</Badge>
        {:else if nextFilmTarget !== null}
          <span class="font-mono text-[10px] font-bold text-muted-foreground tabular-nums">
            {formatWarChestCr(FILM_PRICE)}
          </span>
        {/if}
      {/snippet}
    </SectionHeading>

    {#if nextFilmTarget === null}
      <p class="mt-3 text-xs leading-relaxed text-muted-foreground">
        No next opponent is set. Film becomes available when your next game is on the schedule.
      </p>
    {:else if opponentTeam === null}
      <p class="mt-3 text-xs leading-relaxed text-muted-foreground">
        The next opponent is not available in this season.
      </p>
    {:else}
      <div class="mt-2 flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <p class="text-sm font-bold">{opponentTeam.displayName}</p>
        <p class="font-mono text-[10px] text-muted-foreground uppercase">
          {#if filmFixture !== null}Game {filmFixture.slot} ·
          {:else if filmPlayoffLabel !== null}{filmPlayoffLabel} ·
          {/if}
          {opponentTeam.anchorSeason ?? 'Season unavailable'}
        </p>
        <p class="font-mono text-[10px] text-muted-foreground uppercase">
          {opponentTeam.roster.length} players
        </p>
        <p class="font-mono text-[9px] text-muted-foreground uppercase">
          {scopeLabel('opponent-film')}
        </p>
      </div>

      {#if matchingPlayoffAdjustment !== null}
        <section
          class="mt-3 rounded-xl border border-line-soft bg-surface-1 p-3"
          aria-label="Playoff opponent tactical adjustment"
        >
          <div class="flex flex-wrap items-center justify-between gap-2">
            <p class="ui-label text-muted-foreground">Series opponent adjustment</p>
            <Badge tone="accent">{matchingPlayoffAdjustment.settingLabel}</Badge>
          </div>
          <p class="mt-1 text-[11px] font-bold">{matchingPlayoffAdjustment.reasonLabel}</p>
          <p class="mt-0.5 text-[11px] text-muted-foreground">
            {matchingPlayoffAdjustment.detailLabel}
          </p>
        </section>
      {/if}

      <div class="mt-2 border-t border-line-soft pt-2">
        {#if filmRead !== null && filmRead.startersKnown}
          <p class="font-mono text-[9px] text-muted-foreground uppercase">
            {#if freeStarters.names.length > 0}
              Starters: {freeStarters.names.join(', ')}
            {:else}
              Starting lineup unavailable.
            {/if}
          </p>
          {#if !freeStarters.complete}
            <p class="mt-1 font-mono text-[9px] text-muted-foreground uppercase">
              Starting lineup evidence is incomplete.
            </p>
          {/if}
        {:else}
          <p class="font-mono text-[9px] text-muted-foreground uppercase">
            Starting lineup evidence unavailable.
          </p>
        {/if}
        {#if filmRead !== null && filmRead.missingMinutes.length > 0}
          <p class="mt-1 font-mono text-[9px] text-muted-foreground uppercase">
            No historical minutes for {filmRead.missingMinutes.join(', ')}; left out of the film
            read.
          </p>
        {/if}
        {#if filmRead !== null && filmRead.missingVersion.length > 0}
          <p class="mt-1 font-mono text-[9px] text-muted-foreground uppercase">
            No player version for {filmRead.missingVersion.join(', ')}; left out of the film read.
          </p>
        {/if}
      </div>

      {#if filmReport !== null}
        <div class="mt-3 grid gap-3 lg:grid-cols-2">
          <section
            class="rounded-xl border border-line-soft bg-surface-1 p-3"
            aria-label="Opponent rotation"
          >
            <p class="ui-label text-muted-foreground">Rotation</p>
            <ul class="mt-1.5 flex flex-col gap-1">
              {#each filmReport.rotation as player (player.playerVersionId)}
                <li class="flex min-w-0 items-baseline gap-2 text-[11px]">
                  <span class="min-w-0 flex-1 truncate font-semibold">{player.displayName}</span>
                  {#if player.starter}
                    <span class="shrink-0 font-mono text-[8px] font-bold text-primary uppercase"
                      >Starter</span
                    >
                  {/if}
                  <span class="shrink-0 font-mono text-[9px] text-muted-foreground tabular-nums">
                    {minutesText(player.minutes)} min · {percentText(player.minutesShare * 100)}
                  </span>
                  <span class="shrink-0 font-mono text-[9px] font-bold tabular-nums">
                    {player.usageRate}% {USAGE_LABELS[player.usageTier]}
                  </span>
                </li>
              {/each}
            </ul>
          </section>

          <section
            class="rounded-xl border border-line-soft bg-surface-1 p-3"
            aria-label="Opponent shot profile"
          >
            <p class="ui-label text-muted-foreground">Shot profile</p>
            <ul class="mt-1.5 flex flex-col gap-1">
              {#each filmReport.shotProfile as zone (zone.zone)}
                <li class="flex items-baseline justify-between gap-3 font-mono text-[10px]">
                  <span class="text-muted-foreground">{ZONE_LABELS[zone.zone]}</span>
                  <span class="font-bold tabular-nums">{percentText(zone.frequency)}</span>
                </li>
              {/each}
            </ul>
          </section>

          <section
            class="rounded-xl border border-line-soft bg-surface-1 p-3"
            aria-label="Opponent defensive profile"
          >
            <p class="ui-label text-muted-foreground">Defensive pressure</p>
            <ul class="mt-1.5 flex flex-col gap-1">
              <li class="flex items-baseline justify-between gap-3 font-mono text-[10px]">
                <span class="text-muted-foreground">Steal attempts</span>
                <span class="font-bold tabular-nums"
                  >{percentText(filmReport.defensiveProfile.stealAttemptRate)}</span
                >
              </li>
              <li class="flex items-baseline justify-between gap-3 font-mono text-[10px]">
                <span class="text-muted-foreground">Block attempts</span>
                <span class="font-bold tabular-nums"
                  >{percentText(filmReport.defensiveProfile.blockAttemptRate)}</span
                >
              </li>
              <li class="flex items-baseline justify-between gap-3 font-mono text-[10px]">
                <span class="text-muted-foreground">Fouls</span>
                <span class="font-bold tabular-nums"
                  >{percentText(filmReport.defensiveProfile.foulRate)}</span
                >
              </li>
              <li class="flex items-baseline justify-between gap-3 font-mono text-[10px]">
                <span class="text-muted-foreground">Off. glass</span>
                <span class="font-bold tabular-nums"
                  >{percentText(filmReport.defensiveProfile.crashOffensiveGlassRate)}</span
                >
              </li>
            </ul>
          </section>

          <section
            class="rounded-xl border border-line-soft bg-surface-1 p-3"
            aria-label="Opponent film notes"
          >
            <p class="ui-label text-muted-foreground">Notes</p>
            {#if filmReport.notes.length === 0}
              <p class="mt-1 text-[11px] text-muted-foreground">
                No note cleared the evidence thresholds.
              </p>
            {:else}
              <ul class="mt-1.5 flex flex-col gap-2">
                {#each filmReport.notes as note (note.code)}
                  <li>
                    <p class="text-[11px] font-bold">{FILM_FINDING_LABELS[note.code]}</p>
                    <div class="mt-1">
                      <FullCourtScoutEvidence items={[{ field: note.metric, value: note.value }]} />
                    </div>
                  </li>
                {/each}
              </ul>
            {/if}
          </section>
        </div>
      {:else if filmRecord !== null}
        <p class="mt-3 text-xs leading-relaxed text-muted-foreground">
          {#if filmRead !== null && filmRead.players.length === 0}
            No historical minutes are available for this opponent, so the film read cannot be built.
          {:else if opponentTeam.anchorSeason === null}
            The opponent's season is unavailable, so the film read cannot be built.
          {:else}
            The opponent film is unavailable for this fixture.
          {/if}
        </p>
      {:else}
        <div class="mt-3 flex flex-wrap items-center gap-2 border-t border-line-soft pt-3">
          <Button
            size="sm"
            tone="primary"
            disabled={busy || !locked || filmAssessment === null || !filmAssessment.legal}
            aria-label={`Buy opponent film for ${formatWarChestCr(FILM_PRICE)}`}
            onclick={buyFilm}
          >
            <Film size={14} aria-hidden="true" />
            Buy opponent film
          </Button>
          <p class="min-w-0 flex-1 text-[11px] text-muted-foreground">
            {#if filmAssessment !== null}
              {purchaseAffordance(filmAssessment)}
            {:else}
              Film is unavailable for this fixture.
            {/if}
          </p>
        </div>
      {/if}
    {/if}
  </Panel>
</div>
