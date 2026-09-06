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
} from '$lib/season/season-presentation';
  import {
    eraIdentityOf,
    franchiseIdentityOf,
    type SeasonFaceRef,
  } from '$lib/season/season-branding';
  import {
    deltaToPp,
    MECHANISM_LABEL,
    type BlockMechanismEvidenceRow,
  } from '$lib/season/season-effects-view';
  import type { AvailabilityStripRow } from '$lib/season/season-health-view';
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
    <section
      aria-labelledby="recap-record-heading"
      class="rounded-none bg-surface-1 p-4 sm:rounded-xl"
    >
      <h2
        id="recap-record-heading"
        class="font-display text-base font-extrabold uppercase tracking-tight"
      >
        Your block
      </h2>
      <div class="mt-2 flex items-center gap-3">
        {#if manifest && franchiseIdentity(humanRecord.franchiseId)}
          <SeasonTeamLogo
            {manifest}
            franchiseId={humanRecord.franchiseId}
            teamExternalId={franchiseIdentity(humanRecord.franchiseId)!.teamExternalId}
            alt={`${franchiseName(humanRecord.franchiseId)} logo`}
            size="md"
          />
        {/if}
        <p class="text-2xl font-extrabold">
          {recordLabel(humanRecord.winsAfter, humanRecord.lossesAfter)}
          <span class="ml-2 font-mono text-xs font-normal text-muted-foreground">
            from {recordLabel(humanRecord.winsBefore, humanRecord.lossesBefore)} ·
            {ordinal(humanRecord.positionAfter)} in conference
          </span>
        </p>
      </div>
      <p class="mt-1 font-mono text-xs text-muted-foreground">
        Block {recap.blockIndex + 1} of 9 · rounds 1–{recap.completedRounds} complete
      </p>
    </section>
  {/if}

  {#if recap.standingsMovement.length > 0}
    <section
      aria-labelledby="recap-movement-heading"
      class="rounded-none bg-surface-1 p-4 sm:rounded-xl"
    >
      <h2
        id="recap-movement-heading"
        class="font-display text-base font-extrabold uppercase tracking-tight"
      >
        Standings movement
      </h2>
      <ul class="mt-2 flex flex-col divide-y divide-border/50">
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
            <span class="font-mono text-xs text-muted-foreground">
              {movementLabel(movement)}
            </span>
          </li>
        {/each}
      </ul>
    </section>
  {/if}

  {#if recap.notablePerformances.length > 0}
    <section
      aria-labelledby="recap-performances-heading"
      class="rounded-none bg-surface-1 p-4 sm:rounded-xl"
    >
      <h2
        id="recap-performances-heading"
        class="font-display text-base font-extrabold uppercase tracking-tight"
      >
        Notable performances
      </h2>
      <ul class="mt-2 flex flex-col divide-y divide-border/50">
        {#each recap.notablePerformances as performance (performance.playerVersionId + performance.gameId)}
          {@const source = versionSource(performance.playerVersionId)}
          <li class="flex flex-wrap items-center gap-x-3 gap-y-1 py-2 text-sm">
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
              <span
                class="rounded-full bg-primary/15 px-2 py-0.5 font-mono text-xs font-bold uppercase tracking-[0.12em] text-primary"
              >
                Your team
              </span>
            {/if}
          </li>
        {/each}
      </ul>
    </section>
  {/if}

  {#if recap.streaks.length > 0}
    <section
      aria-labelledby="recap-streaks-heading"
      class="rounded-none bg-surface-1 p-4 sm:rounded-xl"
    >
      <h2
        id="recap-streaks-heading"
        class="font-display text-base font-extrabold uppercase tracking-tight"
      >
        Streaks
      </h2>
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
            <span class="shrink-0 font-mono text-xs font-bold">
              {streakLabel(streak.kind, streak.length)}
            </span>
          </li>
        {/each}
      </ul>
    </section>
  {/if}

  {#if recap.versionSpotlights.length > 0}
    <section
      aria-labelledby="recap-spotlights-heading"
      class="rounded-none bg-surface-1 p-4 sm:rounded-xl"
    >
      <h2
        id="recap-spotlights-heading"
        class="font-display text-base font-extrabold uppercase tracking-tight"
      >
        Head to head
      </h2>
      <ul class="mt-2 flex flex-col divide-y divide-border/50">
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

  <section
    aria-labelledby="recap-upcoming-heading"
    class="rounded-none bg-surface-1 p-4 sm:rounded-xl"
  >
    <h2
      id="recap-upcoming-heading"
      class="font-display text-base font-extrabold uppercase tracking-tight"
    >
      Next opponents
    </h2>
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
    <section
      aria-labelledby="recap-effects-heading"
      class="rounded-none bg-surface-1 p-4 sm:rounded-xl"
    >
      <h2
        id="recap-effects-heading"
        class="font-display text-base font-extrabold uppercase tracking-tight"
      >
        Why it happened
      </h2>
      <ul class="mt-3 flex flex-col gap-2">
        {#each effectsEvidence as row (row.mechanism + row.side)}
          <li class="flex flex-col gap-0.5 rounded-lg bg-surface-2 p-3">
            <div class="flex flex-wrap items-baseline justify-between gap-2">
              <p class="text-sm font-semibold">{MECHANISM_LABEL[row.mechanism]}</p>
              <p class="shrink-0 text-xs text-muted-foreground">
                {row.side} · {row.opportunities} plays
              </p>
            </div>
            <p class="text-xs text-muted-foreground">
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
    <section
      aria-labelledby="recap-injury-heading"
      class="rounded-none bg-surface-1 p-4 sm:rounded-xl"
    >
      <h2
        id="recap-injury-heading"
        class="font-display text-base font-extrabold uppercase tracking-tight"
      >
        Health
      </h2>
      <p class="mt-1 text-sm text-muted-foreground">{injurySummary}</p>
    </section>
  {/if}

  {#if challengeView?.kind === 'challenges'}
    <section
      aria-labelledby="recap-challenges-heading"
      class="rounded-none bg-surface-1 p-4 sm:rounded-xl"
      data-recap-challenge-evidence
    >
      <h2
        id="recap-challenges-heading"
        class="font-display text-base font-extrabold uppercase tracking-tight"
      >
        Challenges
      </h2>
      <ul class="mt-2 flex flex-col gap-1.5">
        {#each challengeView.evidence as result (result.challengeId)}
          <li class="flex flex-wrap items-center gap-x-3 gap-y-0.5 py-1 text-sm">
            <span class="min-w-0 flex-1 truncate font-semibold">
              {challengeName(result.challengeId)}
            </span>
            <span
              class="shrink-0 rounded-full px-2 py-0.5 font-mono text-xs font-bold uppercase tracking-[0.12em] {result.success
                ? 'bg-positive/15 text-positive'
                : 'bg-surface-3 text-muted-foreground'}"
            >
              {result.success ? `Hit · +${String(result.reward)} Influence` : 'Missed'}
            </span>
          </li>
        {/each}
      </ul>
    </section>
  {:else if challengeView?.kind === 'legacy-objective'}
    <section
      aria-labelledby="recap-goal-heading"
      class="rounded-none bg-surface-1 p-4 sm:rounded-xl"
    >
      <h2
        id="recap-goal-heading"
        class="font-display text-base font-extrabold uppercase tracking-tight"
      >
        Goal
      </h2>
      <p class="mt-1 text-sm">
        <span>{challengeView.objectiveId}</span>
        <span
          class="ml-2 rounded-full px-2 py-0.5 font-mono text-xs font-bold uppercase tracking-[0.12em] {challengeView.success
            ? 'bg-positive/15 text-positive'
            : 'bg-destructive/15 text-destructive'}"
        >
          {challengeView.success ? 'Hit · +1 Influence' : 'Missed'}
        </span>
      </p>
    </section>
  {/if}

  {#if recap.freeAgencyEvidence.windowIndex !== null}
    <section
      aria-labelledby="recap-free-agency-heading"
      class="rounded-none bg-surface-1 p-4 sm:rounded-xl"
      data-recap-free-agency-evidence
    >
      <h2
        id="recap-free-agency-heading"
        class="font-display text-base font-extrabold uppercase tracking-tight"
      >
        Free agency
      </h2>
      <p class="mt-1 text-sm text-muted-foreground">
        Window {recap.freeAgencyEvidence.windowIndex + 1} · {recap.freeAgencyEvidence.signings
          .length} signing{recap.freeAgencyEvidence.signings.length === 1 ? '' : 's'}
      </p>
    </section>
  {/if}
</div>
