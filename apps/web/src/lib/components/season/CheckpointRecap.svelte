<script lang="ts">
  import type {
    HoopRushManifest,
    SeasonBlockRecap,
    SeasonRecordMovement,
    SeasonRosterEntry,
  } from '@hoop-rush/data-contracts';
  import { SEASON_CHALLENGE_CATALOG, SEASON_INFLUENCE_CAP } from '@hoop-rush/data-contracts';
  import {
    formatInfluenceBalance,
    ordinal,
    recapChallengeView,
    recordLabel,
    streakLabel,
  } from '#lib/season/season-presentation.js';
  import {
    eraIdentityOf,
    franchiseIdentityOf,
    type SeasonFaceRef,
  } from '#lib/season/season-branding.js';
  import {
    deltaToPp,
    MECHANISM_LABEL,
    type BlockMechanismEvidenceRow,
  } from '#lib/season/season-effects-view.js';
  import type { SeasonInnovationImpact } from '#lib/season/season-innovation-impact-view.js';
  import type { AvailabilityStripRow } from '#lib/season/season-health-view.js';
  import CourtInnovationImpact from './CourtInnovationImpact.svelte';
  import HealthStrip from './HealthStrip.svelte';
  import SeasonPlayerFace from './SeasonPlayerFace.svelte';
  import SeasonTeamLogo from './SeasonTeamLogo.svelte';
  let {
    recap,
    humanRecord,
    franchiseName,
    playerName,
    manifest = null,
    faces = new Map(),
    rosterByVersion = new Map(),
    effectsEvidence = [],
    healthRows = [],
    innovationImpact = null,
    blockInnovationImpact = null,
  }: {
    recap: SeasonBlockRecap;
    humanRecord: SeasonRecordMovement | null;
    franchiseName: (franchiseId: string) => string;
    playerName: (playerVersionId: string) => string;
    manifest?: HoopRushManifest | null;
    faces?: ReadonlyMap<string, SeasonFaceRef>;
    rosterByVersion?: ReadonlyMap<string, SeasonRosterEntry>;
    effectsEvidence?: BlockMechanismEvidenceRow[];
    healthRows?: AvailabilityStripRow[];
    innovationImpact?: SeasonInnovationImpact | null;
    blockInnovationImpact?: SeasonInnovationImpact | null;
  } = $props();
  const movementLabel = (movement: SeasonRecordMovement): string =>
    `${movement.winsBefore}–${movement.lossesBefore} → ${movement.winsAfter}–${movement.lossesAfter} (${
      movement.positionBefore !== movement.positionAfter
        ? `${ordinal(movement.positionBefore)} → ${ordinal(movement.positionAfter)}`
        : `${ordinal(movement.positionAfter)} in conference`
    })`;
  const injurySummary = $derived.by(() => {
    const parts: string[] = [];
    if (recap.injuryEvidence.injuries > 0) {
      parts.push(
        `${String(recap.injuryEvidence.injuries)} injur${recap.injuryEvidence.injuries === 1 ? 'y' : 'ies'} (${String(recap.injuryEvidence.returnedThisBlock)} back)`,
      );
    } else {
      parts.push('No new injuries');
    }
    if (recap.tradeEvidence.tradesAccepted > 0) {
      parts.push(
        `${String(recap.tradeEvidence.tradesAccepted)} trade${recap.tradeEvidence.tradesAccepted === 1 ? '' : 's'}`,
      );
    }
    parts.push(formatInfluenceBalance(recap.influenceBalance.humanBalance, SEASON_INFLUENCE_CAP));
    return parts.join(' · ');
  });
  const challengeView = $derived(recapChallengeView(recap));
  const challengeName = (challengeId: string): string =>
    SEASON_CHALLENGE_CATALOG.find((entry) => entry.challengeId === challengeId)?.name ??
    challengeId;
  const franchiseIdentity = (franchiseId: string) =>
    manifest ? franchiseIdentityOf(manifest, franchiseId) : null;
  function versionSource(playerVersionId: string): {
    teamExternalId: string;
    logoCandidates: readonly string[];
    seasonLabel: string;
  } | null {
    const rosterEntry = rosterByVersion.get(playerVersionId);
    if (rosterEntry === undefined || manifest === null) return null;
    const modern = franchiseIdentityOf(manifest, rosterEntry.franchiseId);
    if (modern === null) return null;
    const era = eraIdentityOf(manifest, rosterEntry.franchiseId, rosterEntry.eraId);
    return {
      teamExternalId: modern.teamExternalId,
      logoCandidates: era.logoCandidates,
      seasonLabel: era.displayLabel === null ? '' : ` · ${era.displayLabel}`,
    };
  }
</script>

<div class="flex flex-col gap-6">
  {#if humanRecord}
    <section aria-labelledby="recap-record-heading" class="sr-panel-featured p-4 sm:p-5">
      <h2 id="recap-record-heading" class="sr-section-label">Your block</h2>
      <div class="mt-3 flex items-center gap-3">
        {#if manifest && franchiseIdentity(humanRecord.franchiseId)}
          <SeasonTeamLogo
            {manifest}
            franchiseId={humanRecord.franchiseId}
            teamExternalId={franchiseIdentity(humanRecord.franchiseId)!.teamExternalId}
            alt={`${franchiseName(humanRecord.franchiseId)} logo`}
            size="md"
          />
        {/if}
        <div class="min-w-0">
          <p class="sr-number text-4xl leading-none font-extrabold sm:text-5xl">
            {recordLabel(humanRecord.winsAfter, humanRecord.lossesAfter)}
          </p>
          <p class="mt-2 font-mono text-xs text-muted-foreground">
            from {recordLabel(humanRecord.winsBefore, humanRecord.lossesBefore)} ·
            {ordinal(humanRecord.positionAfter)} in conference
          </p>
        </div>
      </div>
      <p class="mt-3 font-mono text-xs text-muted-foreground">
        Block {recap.blockIndex + 1} of 9 · rounds 1–{recap.completedRounds} complete
      </p>
    </section>
  {/if}

  {#if innovationImpact !== null}
    <CourtInnovationImpact
      impact={innovationImpact}
      blockImpact={blockInnovationImpact}
      {franchiseName}
    />
  {/if}

  {#if recap.standingsMovement.length > 0}
    <section aria-labelledby="recap-movement-heading" class="sr-panel-quiet p-4 sm:p-5">
      <h2 id="recap-movement-heading" class="sr-section-label">Standings movement</h2>
      <ul class="mt-2 flex flex-col divide-y divide-border/60">
        {#each recap.standingsMovement as movement (movement.franchiseId)}
          <li class="flex flex-wrap items-center gap-x-3 gap-y-1 py-2 text-sm">
            {#if manifest && franchiseIdentity(movement.franchiseId)}
              <SeasonTeamLogo
                {manifest}
                franchiseId={movement.franchiseId}
                teamExternalId={franchiseIdentity(movement.franchiseId)!.teamExternalId}
                alt=""
                size="sm"
              />
            {/if}
            <span class="min-w-0 flex-1 truncate font-semibold">
              {franchiseName(movement.franchiseId)}
            </span>
            <span class="sr-number shrink-0 font-mono text-xs text-muted-foreground">
              {movementLabel(movement)}
            </span>
          </li>
        {/each}
      </ul>
    </section>
  {/if}

  {#if recap.notablePerformances.length > 0}
    <section aria-labelledby="recap-performances-heading" class="sr-panel-quiet p-4 sm:p-5">
      <h2 id="recap-performances-heading" class="sr-section-label">Notable performances</h2>
      <ul class="mt-3 grid gap-2 sm:grid-cols-2">
        {#each recap.notablePerformances as performance (performance.playerVersionId + performance.gameId)}
          {@const source = versionSource(performance.playerVersionId)}
          <li
            class="sr-gamecard px-3 py-3"
            style={performance.humanTeam ? '--sr-accent: var(--sr-hardwood)' : undefined}
          >
            <div class="flex flex-wrap items-center gap-x-3 gap-y-1">
              {#if manifest && faces.get(performance.playerVersionId)}
                <SeasonPlayerFace
                  face={faces.get(performance.playerVersionId)!}
                  {manifest}
                  size="sm"
                />
              {/if}
              <span class="min-w-0 flex-1">
                <span class="block truncate font-semibold">
                  {playerName(performance.playerVersionId)}
                </span>
                <span class="flex items-center gap-2 font-mono text-xs text-muted-foreground">
                  {#if source && manifest}
                    <SeasonTeamLogo
                      {manifest}
                      franchiseId={performance.franchiseId}
                      teamExternalId={source.teamExternalId}
                      logoCandidates={source.logoCandidates}
                      alt=""
                      size="sm"
                    />
                  {/if}
                  <span class="min-w-0 truncate">
                    {performance.points} pts · {performance.rebounds} reb · {performance.assists} ast{source
                      ? source.seasonLabel
                      : ''}
                  </span>
                </span>
              </span>
              {#if performance.humanTeam}
                <span class="sr-badge shrink-0" data-tone="hardwood"> Your team </span>
              {/if}
            </div>
          </li>
        {/each}
      </ul>
    </section>
  {/if}

  {#if recap.streaks.length > 0}
    <section aria-labelledby="recap-streaks-heading" class="sr-panel-quiet p-4 sm:p-5">
      <h2 id="recap-streaks-heading" class="sr-section-label">Streaks</h2>
      <ul class="mt-2 flex flex-col gap-1.5">
        {#each recap.streaks as streak (streak.franchiseId)}
          <li class="flex items-center gap-2 text-sm">
            {#if manifest && franchiseIdentity(streak.franchiseId)}
              <SeasonTeamLogo
                {manifest}
                franchiseId={streak.franchiseId}
                teamExternalId={franchiseIdentity(streak.franchiseId)!.teamExternalId}
                alt=""
                size="sm"
              />
            {/if}
            <span class="min-w-0 flex-1 truncate font-semibold">
              {franchiseName(streak.franchiseId)}
            </span>
            <span class="sr-badge shrink-0" data-tone={streak.kind === 'wins' ? 'win' : 'loss'}>
              {streakLabel(streak.kind, streak.length)}
            </span>
          </li>
        {/each}
      </ul>
    </section>
  {/if}

  {#if recap.versionSpotlights.length > 0}
    <section aria-labelledby="recap-spotlights-heading" class="sr-panel-quiet p-4 sm:p-5">
      <h2 id="recap-spotlights-heading" class="sr-section-label">Head to head</h2>
      <ul class="mt-2 flex flex-col divide-y divide-border/60">
        {#each recap.versionSpotlights as spotlight (spotlight.versionA + spotlight.versionB)}
          <li class="flex flex-wrap items-center gap-x-3 gap-y-1 py-2 text-sm">
            {#if manifest && faces.get(spotlight.versionA)}
              <SeasonPlayerFace face={faces.get(spotlight.versionA)!} {manifest} size="sm" />
            {/if}
            <span class="min-w-0 flex-1">
              <span class="block truncate font-semibold">
                {playerName(spotlight.versionA)}
                <span class="mx-1 text-muted-foreground">vs</span>
                {playerName(spotlight.versionB)}
              </span>
              <span class="block font-mono text-xs text-muted-foreground">
                {spotlight.sameTeam
                  ? 'Same roster · '
                  : ''}{spotlight.gamesPlayedA}/{spotlight.gamesPlayedB}
                games · {spotlight.pointsA}/{spotlight.pointsB} pts ·
                {spotlight.reboundsA}/{spotlight.reboundsB} reb ·
                {spotlight.assistsA}/{spotlight.assistsB} ast
                {#if spotlight.headToHeadGames > 0}
                  · {spotlight.headToHeadGames} meeting{spotlight.headToHeadGames === 1 ? '' : 's'}
                  ({spotlight.headToHeadWinsA}–{spotlight.headToHeadWinsB})
                {/if}
              </span>
            </span>
            {#if manifest && faces.get(spotlight.versionB)}
              <SeasonPlayerFace face={faces.get(spotlight.versionB)!} {manifest} size="sm" />
            {/if}
          </li>
        {/each}
      </ul>
    </section>
  {/if}

  <section aria-labelledby="recap-upcoming-heading" class="sr-panel-quiet p-4 sm:p-5">
    <h2 id="recap-upcoming-heading" class="sr-section-label">Next opponents</h2>
    {#if recap.upcomingHumanGames.length === 0}
      <p class="mt-2 text-sm text-muted-foreground">
        {recap.completedRounds >= 82
          ? 'The regular season is complete.'
          : 'No human games scheduled.'}
      </p>
    {:else}
      <ol class="mt-2 flex flex-col gap-1.5">
        {#each recap.upcomingHumanGames as game (game.gameId)}
          <li class="flex flex-wrap items-center gap-2 text-sm">
            <span class="w-14 shrink-0 font-mono text-xs text-muted-foreground">
              R{game.round}
            </span>
            {#if manifest && franchiseIdentity(game.opponentFranchiseId)}
              <SeasonTeamLogo
                {manifest}
                franchiseId={game.opponentFranchiseId}
                teamExternalId={franchiseIdentity(game.opponentFranchiseId)!.teamExternalId}
                alt=""
                size="sm"
              />
            {/if}
            <span class="min-w-0 flex-1 truncate">
              {game.humanIsHome ? 'vs' : 'at'}
              {franchiseName(game.opponentFranchiseId)}
            </span>
          </li>
        {/each}
      </ol>
    {/if}
  </section>

  {#if effectsEvidence.length > 0}
    <section aria-labelledby="recap-effects-heading" class="sr-panel-quiet p-4 sm:p-5">
      <h2 id="recap-effects-heading" class="sr-section-label">Why it happened</h2>
      <ul class="mt-3 flex flex-col gap-2">
        {#each effectsEvidence as row (row.mechanism + row.side)}
          <li class="flex flex-col gap-0.5 rounded-lg bg-surface-2 p-3">
            <div class="flex flex-wrap items-baseline justify-between gap-2">
              <p class="text-sm font-semibold">{MECHANISM_LABEL[row.mechanism]}</p>
              <p class="shrink-0 font-mono text-xs text-muted-foreground">
                {row.side} · {row.opportunities} plays
              </p>
            </div>
            <p class="font-mono text-xs text-muted-foreground">
              {#if row.mechanism === 'assist-conversion' || row.mechanism === 'turnover-security' || row.mechanism === 'help-defense'}
                Lineup chemistry
              {:else}
                Tired legs
              {/if}
              · about
              {deltaToPp(row.deltaTotals) >= 0 ? '+' : ''}
              {deltaToPp(row.deltaTotals).toFixed(1)} pts per 100
            </p>
          </li>
        {/each}
      </ul>
    </section>
  {/if}

  {#if healthRows.length > 0}
    <HealthStrip rows={healthRows} title="Health" />
    <section aria-labelledby="recap-injury-heading" class="sr-panel-quiet p-4 sm:p-5">
      <h2 id="recap-injury-heading" class="sr-section-label">Health</h2>
      <p class="mt-1 text-sm text-muted-foreground">{injurySummary}</p>
    </section>
  {/if}

  {#if challengeView?.kind === 'challenges'}
    <section
      aria-labelledby="recap-challenges-heading"
      class="sr-panel-quiet p-4 sm:p-5"
      data-recap-challenge-evidence
    >
      <h2 id="recap-challenges-heading" class="sr-section-label">Challenges</h2>
      <ul class="mt-2 flex flex-col gap-1.5">
        {#each challengeView.evidence as result (result.challengeId)}
          <li class="flex flex-wrap items-center gap-x-3 gap-y-0.5 py-1 text-sm">
            <span class="min-w-0 flex-1 truncate font-semibold">
              {challengeName(result.challengeId)}
            </span>
            <span class="sr-badge shrink-0" data-tone={result.success ? 'win' : undefined}>
              {result.success ? `Hit · +${String(result.reward)} Influence` : 'Missed'}
            </span>
          </li>
        {/each}
      </ul>
    </section>
  {/if}

  {#if recap.freeAgencyEvidence.windowIndex !== null}
    <section
      aria-labelledby="recap-free-agency-heading"
      class="sr-panel-quiet p-4 sm:p-5"
      data-recap-free-agency-evidence
    >
      <h2 id="recap-free-agency-heading" class="sr-section-label">Free agency</h2>
      <p class="mt-1 text-sm text-muted-foreground">
        Window {recap.freeAgencyEvidence.windowIndex + 1} · {recap.freeAgencyEvidence.signings
          .length} signing{recap.freeAgencyEvidence.signings.length === 1 ? '' : 's'}
      </p>
    </section>
  {/if}
</div>
