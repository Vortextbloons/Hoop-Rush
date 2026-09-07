<script lang="ts">
  import { getContext } from 'svelte';
  import { SvelteMap } from 'svelte/reactivity';
  import {
    SEASON_BLOCK_COUNT,
    normalizeSponsorGearState,
    seasonDigestHex,
    type SeasonGameSummary,
  } from '@hoop-rush/data-contracts';
  import { minutePlanHorizonGames } from '@hoop-rush/engine';
  import InjuryTimeline from '$lib/components/season/InjuryTimeline.svelte';
  import AutoRotationPanel from '$lib/components/season/AutoRotationPanel.svelte';
  import PlayerSponsorCard from '$lib/components/season/PlayerSponsorCard.svelte';
  import TeamRosterPanel from '$lib/components/season/TeamRosterPanel.svelte';
  import RotationEditor from '$lib/components/season/RotationEditor.svelte';
  import SeasonPlayerStats from '$lib/components/season/SeasonPlayerStats.svelte';
  import UnitChemistry from '$lib/components/season/UnitChemistry.svelte';
  import {
    displayRotationFailures,
    indexRotationFailures,
  } from '$lib/season/season-rotation-editor';
  import {
    buildLeagueProjectionBaselines,
    normalizeTeamProjection,
    rawSeasonTeamRatings,
    seasonLeagueTeamProjections,
  } from '$lib/season/season-team-detail-view';
  import {
    SEASON_RUN_SHELL_CONTEXT,
    type SeasonRunShellData,
  } from '$lib/season/season-shell-context';
  import { humanInjuryTimeline } from '$lib/season/season-health-view';
  import { activeInjuriesOf } from '$lib/season/season-health-view';
  import { humanSeasonPlayerStats } from '$lib/season/season-player-stats-view';
  import { gamesToLockForBlock } from '$lib/season/season-lock-preview';
  import {
    durabilityRatingOfSlice,
    overallRatingOfSlice,
    playablePositionsOfSlice,
    staminaRatingOfSlice,
    summaryRatingsOfSlice,
  } from '$lib/season/season-player-slice';
  import {
    FATIGUE_BAND_LABEL,
    fatigueBand,
    fatiguePercent,
    loadStateOf,
  } from '$lib/season/season-effects-view';
  import { candidateOf } from '$lib/season/season-catalog-index';
  import { resolveAssetUrl } from '$lib/asset-url';
  import { loadSponsorsIndex } from '$lib/season/season-assets';
  import {
    boostedOverallDeltaForPlayer,
    boostedOverallForPlayer,
    playerSponsorCardOf,
    sponsorVaultOf,
    gearPointsOf,
    sponsorSlotsOf,
    type SponsorVaultEntry,
  } from '$lib/season/sponsor-gear-view';
  import type { SeasonSponsorSlot } from '@hoop-rush/data-contracts';
  const shell = getContext<SeasonRunShellData>(SEASON_RUN_SHELL_CONTEXT);
  let mounted = $state(true);
  $effect(() => {
    mounted = true;
    return () => {
      mounted = false;
    };
  });
  const manifest = $derived(shell.manifest);
  const run = $derived(shell.run);
  const humanFranchiseId = $derived(shell.humanFranchiseId);
  const effects = $derived(shell.snapshot?.effects ?? null);
  const health = $derived(shell.health);
  const failures = $derived(shell.editor?.validate() ?? []);
  const minutesTotal = $derived(
    shell.editor?.rotation.targetMinutes.reduce((sum, entry) => sum + entry.minutes, 0) ?? 0,
  );
  const minutesRemaining = $derived(240 - minutesTotal);
  const starterCount = $derived(shell.editor?.rotation.starters.length ?? 0);
  const closerCount = $derived(shell.editor?.rotation.closingFive.length ?? 0);
  const failureNames = $derived(shell.editor?.names ?? new Map<string, string>());
  const globalFailures = $derived(indexRotationFailures(failures).global);
  const humanizedGlobal = $derived(displayRotationFailures(globalFailures, failureNames));
  let swapPending = $state(false);
  const overallByVersion = $derived.by(() => {
    const slice = shell.playerSlice;
    if (shell.playerSliceReady && slice.size === 0) return new SvelteMap<string, number>();
    const map = new SvelteMap<string, number>();
    for (const entry of slice.values()) {
      map.set(entry.playerVersionId, entry.summaryRatings.overallRating);
    }
    return map;
  });
  const roster = $derived(
    run !== null && humanFranchiseId !== null
      ? (run.rosters.find((r) => r.franchiseId === humanFranchiseId) ?? null)
      : null,
  );
  let summaries: SeasonGameSummary[] = $state([]);
  let rotationRevision = $state(0);
  let selectedPlayerId: string | null = $state(null);
  let sponsorLogos: ReadonlyMap<string, string> = $state(new Map());
  let sponsorApplying = $state(false);
  function roleOf(playerVersionId: string): { role: string; minutes: number | string } {
    const editor = shell.editor;
    const minutes =
      editor?.rotation.targetMinutes.find((entry) => entry.playerVersionId === playerVersionId)
        ?.minutes ?? 0;
    if (
      editor?.inactiveMembers().some((member) => member.playerVersionId === playerVersionId) ??
      false
    ) {
      return { role: 'Inactive', minutes };
    }
    if (editor?.rotation.starters.includes(playerVersionId) ?? false) {
      return { role: 'Starter', minutes };
    }
    return { role: 'Bench', minutes };
  }
  const sponsorVault: SponsorVaultEntry[] = $derived(sponsorVaultOf(shell.snapshot?.run ?? null));
  const gearPointsByVersion = $derived.by(() => {
    const snapshotRun = shell.snapshot?.run ?? null;
    if (snapshotRun === null) return new Map<string, number>();
    const slots = normalizeSponsorGearState(snapshotRun.sponsors).players.slots;
    return new Map(Object.entries(slots).map(([id, entry]) => [id, gearPointsOf(entry)]));
  });
  const overallDeltaByVersion = $derived.by(() => {
    const snapshotRun = shell.snapshot?.run ?? null;
    if (snapshotRun === null || roster === null) return new Map<string, number>();
    const map = new Map<string, number>();
    for (const entry of roster.players) {
      const candidate = candidateOf(shell.catalog, entry.playerVersionId);
      if (candidate === null || candidate === undefined) continue;
      const delta = boostedOverallDeltaForPlayer(snapshotRun, entry.playerVersionId, {
        overall: candidate.summaryRatings.overallRating,
        baseRatings: candidate.detailedRatings,
        tendencies: candidate.tendencies,
      });
      if (delta !== null) map.set(entry.playerVersionId, delta);
    }
    return map;
  });
  function boostedOverallOf(playerVersionId: string): number | null {
    const candidate = candidateOf(shell.catalog, playerVersionId);
    if (candidate === null || candidate === undefined) {
      return overallRatingOfSlice(shell.playerSlice, playerVersionId);
    }
    return (
      boostedOverallForPlayer(shell.snapshot?.run ?? null, playerVersionId, {
        overall: candidate.summaryRatings.overallRating,
        baseRatings: candidate.detailedRatings,
        tendencies: candidate.tendencies,
      }) ?? overallRatingOfSlice(shell.playerSlice, playerVersionId)
    );
  }
  const sponsorCard = $derived.by(() => {
    if (selectedPlayerId === null || roster === null || manifest === null) return null;
    const entry = roster.players.find((player) => player.playerVersionId === selectedPlayerId);
    if (entry === undefined) return null;
    const candidate = candidateOf(shell.catalog, entry.playerVersionId);
    if (candidate === undefined || candidate === null) return null;
    const rotation = roleOf(entry.playerVersionId);
    const load =
      rotation.role !== 'Inactive' && effects !== null
        ? loadStateOf(effects, entry.playerVersionId)
        : null;
    const band = load === null ? null : fatigueBand(load.fatigueBasisPoints);
    const lastGame = summaries.length > 0 ? (summaries[summaries.length - 1] ?? null) : null;
    const lastLine =
      lastGame === null
        ? null
        : ([...lastGame.homePlayers, ...lastGame.awayPlayers].find(
            (line) => line.playerVersionId === entry.playerVersionId,
          ) ?? null);
    return playerSponsorCardOf(shell.snapshot?.run ?? null, {
      playerVersionId: entry.playerVersionId,
      displayName: entry.displayName,
      seasonKey: entry.seasonKey,
      franchiseId: entry.franchiseId,
      eraId: entry.eraId,
      playable: playablePositionsOfSlice(shell.playerSlice, entry.playerVersionId),
      overall: candidate.summaryRatings.overallRating,
      baseRatings: candidate.detailedRatings,
      tendencies: candidate.tendencies,
      role: rotation.role,
      minutes: rotation.minutes,
      fatigueLabel: band === null ? null : FATIGUE_BAND_LABEL[band],
      fatiguePercent: load === null ? null : fatiguePercent(load.fatigueBasisPoints),
      lastMinutes: lastLine === null ? null : lastLine.seconds / 60,
    });
  });
  const sponsorCardFace = $derived(
    selectedPlayerId === null ? null : (shell.facesByVersion.get(selectedPlayerId) ?? null),
  );
  const sponsorApplyError = $derived(
    shell.commandError?.command === 'apply-sponsor' ? (shell.commandError.message ?? null) : null,
  );
  const sponsorUnlocked = $derived(shell.block.phase !== 'running');
  async function applySponsor(input: {
    instanceId: string;
    playerVersionId: string;
    slot: SeasonSponsorSlot;
  }): Promise<void> {
    const hub = shell.hub;
    if (hub === null || sponsorApplying) return;
    sponsorApplying = true;
    try {
      await hub.applySponsor(input);
    } finally {
      if (mounted) sponsorApplying = false;
    }
  }
  $effect(() => {
    let cancelled = false;
    void loadSponsorsIndex().then((index) => {
      if (cancelled || !mounted || index === null) return;
      sponsorLogos = new Map(index.logos.map((logo) => [logo.family, resolveAssetUrl(logo.file)]));
    });
    return () => {
      cancelled = true;
    };
  });
  let autoPanel: AutoRotationPanel | null = $state(null);
  function seasonGamesRemaining(nextBlockIndex: number): number {
    let remaining = 0;
    for (let block = nextBlockIndex; block < SEASON_BLOCK_COUNT; block += 1) {
      remaining += gamesToLockForBlock(block);
    }
    return remaining;
  }
  const autoRosterIds = $derived(roster?.players.map((entry) => entry.playerVersionId) ?? []);
  const autoUnavailable = $derived.by(() => {
    if (health === null || roster === null) return [];
    return roster.players
      .filter((entry) => activeInjuriesOf(health, entry.playerVersionId).length > 0)
      .map((entry) => entry.playerVersionId);
  });
  const autoLoad = $derived.by(() => {
    const slice = shell.playerSlice;
    const states = new Map(
      (shell.snapshot?.effects?.playerStates ?? []).map((state) => [state.playerVersionId, state]),
    );
    return autoRosterIds.map((playerVersionId) => {
      const fatigue = states.get(playerVersionId);
      return {
        playerVersionId,
        staminaRating: staminaRatingOfSlice(slice, playerVersionId) ?? 70,
        durability: durabilityRatingOfSlice(slice, playerVersionId) ?? 70,
        fatigueBasisPoints: fatigue?.fatigueBasisPoints ?? 0,
        recentLoadBasisPoints: fatigue?.recentLoadBasisPoints ?? 0,
      };
    });
  });
  const autoOverall = $derived.by(() => {
    const slice = shell.playerSlice;
    const rows: { playerVersionId: string; overall: number }[] = [];
    for (const playerVersionId of autoRosterIds) {
      const overall = overallRatingOfSlice(slice, playerVersionId);
      if (overall !== null) rows.push({ playerVersionId, overall });
    }
    return rows;
  });
  const autoHorizon = $derived(
    shell.nextBlockIndex === null
      ? 0
      : minutePlanHorizonGames(seasonGamesRemaining(shell.nextBlockIndex)),
  );
  const autoSeed = $derived(
    shell.snapshot === null || shell.nextBlockIndex === null
      ? null
      : seasonDigestHex(`${shell.snapshot.run.runId} auto-rotation ${String(shell.nextBlockIndex)}`),
  );
  const autoNames = $derived(shell.editor?.names ?? null);
  const ratingsOf = (playerVersionId: string) =>
    summaryRatingsOfSlice(shell.playerSlice, playerVersionId);
  const leagueProjectionBaselines = $derived.by(() => {
    const run = shell.run;
    if (run === null || !shell.playerSliceReady) return null;
    return buildLeagueProjectionBaselines({
      rosters: run.rosters,
      rotations: run.rotations,
      summaryRatingsOf: ratingsOf,
    });
  });
  const lockedTeamProjection = $derived.by(() => {
    const run = shell.run;
    const humanId = shell.humanFranchiseId;
    const baselines = leagueProjectionBaselines;
    if (run === null || humanId === null || baselines === null) return null;
    const lockedRoster = run.rosters.find((entry) => entry.franchiseId === humanId);
    const lockedRotation = run.rotations.find((entry) => entry.franchiseId === humanId);
    if (lockedRoster === undefined || lockedRotation === undefined) return null;
    const raw = rawSeasonTeamRatings({
      roster: lockedRoster,
      rotation: lockedRotation,
      summaryRatingsOf: ratingsOf,
    });
    return raw === null ? null : normalizeTeamProjection(raw, baselines);
  });
  const teamProjection = $derived.by(() => {
    void rotationRevision;
    const run = shell.run;
    const humanId = shell.humanFranchiseId;
    const editor = shell.editor;
    if (run === null || humanId === null || editor === null || !shell.playerSliceReady) {
      return null;
    }
    return (
      seasonLeagueTeamProjections({
        rosters: run.rosters,
        rotations: run.rotations,
        summaryRatingsOf: ratingsOf,
        rotationOverrides: new Map([[humanId, editor.rotation]]),
      }).get(humanId) ?? null
    );
  });
  function projectionDelta(pending: number, locked: number | undefined): number | null {
    if (locked === undefined || pending === locked) return null;
    return pending - locked;
  }
  $effect(() => {
    const hub = shell.hub;
    const activeRunId = shell.snapshot?.run.runId ?? null;
    const accepted = shell.snapshot?.acceptedBlocks ?? [];
    if (hub === null || activeRunId === null || accepted.length === 0) {
      if (mounted) summaries = [];
      return;
    }
    const lastBlock = accepted[accepted.length - 1];
    if (lastBlock === undefined) {
      if (mounted) summaries = [];
      return;
    }
    let cancelled = false;
    void hub.loadBlockSummaries(activeRunId, lastBlock.blockIndex).then((rows) => {
      if (cancelled || !mounted) return;
      summaries = rows;
    });
    return () => {
      cancelled = true;
    };
  });
  const injuryTimeline = $derived(
    run !== null && roster !== null && humanFranchiseId !== null && health !== null
      ? humanInjuryTimeline(health, roster, humanFranchiseId, summaries)
      : [],
  );
  const statsView = $derived.by(() => {
    if (roster === null || humanFranchiseId === null) return null;
    const slice = shell.playerSlice;
    return humanSeasonPlayerStats({
      roster,
      summaries: shell.snapshot?.summaries ?? [],
      overallRatingOf: (playerVersionId) => boostedOverallOf(playerVersionId),
      playablePositions: (playerVersionId) => playablePositionsOfSlice(slice, playerVersionId),
    });
  });
</script>

<svelte:head>
  <title>Season Run — Team — Hoop Rush</title>
</svelte:head>

<div
  class="flex min-w-0 flex-col gap-6 pt-6 pb-[calc(5.25rem+env(safe-area-inset-bottom))] md:pb-0"
>
  {#if shell.editor === null || manifest === null || roster === null}
    <p class="px-3 font-mono text-sm text-muted-foreground sm:px-0">
      Preparing the rotation workspace…
    </p>
  {:else}
    <section aria-labelledby="workspace-heading" class="flex min-w-0 flex-col gap-6 px-3 sm:px-0">
      <div>
        <p class="font-mono text-xs tracking-[0.16em] text-primary uppercase">Your team</p>
        <h2
          id="workspace-heading"
          class="font-display mt-1 text-2xl font-extrabold tracking-tight uppercase sm:text-3xl"
        >
          Rotation
        </h2>
        <p class="mt-1 text-xs text-muted-foreground">Who starts? How many minutes? Who closes?</p>
      </div>

      {#if teamProjection !== null}
        {@const overallDelta = projectionDelta(
          teamProjection.overall,
          lockedTeamProjection?.overall,
        )}
        {@const offenseDelta = projectionDelta(
          teamProjection.offense,
          lockedTeamProjection?.offense,
        )}
        {@const defenseDelta = projectionDelta(
          teamProjection.defense,
          lockedTeamProjection?.defense,
        )}
        <dl
          class="flex flex-wrap items-baseline gap-x-5 gap-y-1 rounded-xl bg-surface-1 px-4 py-2.5"
          data-season-team-projection
          aria-label="Team ratings from the pending rotation's player ratings"
        >
          <div class="flex items-baseline gap-1.5">
            <dt
              class="font-mono text-[10px] font-bold tracking-[0.14em] text-muted-foreground uppercase"
            >
              Off
            </dt>
            <dd class="font-display text-xl leading-none font-extrabold tracking-tight">
              {teamProjection.offense}
              {#if offenseDelta !== null}
                <span
                  class="ml-1 font-mono text-[11px] font-bold {offenseDelta > 0
                    ? 'text-positive'
                    : 'text-destructive'}"
                >
                  {offenseDelta > 0 ? '+' : ''}{offenseDelta}
                </span>
              {/if}
            </dd>
          </div>
          <div class="flex items-baseline gap-1.5">
            <dt
              class="font-mono text-[10px] font-bold tracking-[0.14em] text-muted-foreground uppercase"
            >
              Def
            </dt>
            <dd class="font-display text-xl leading-none font-extrabold tracking-tight">
              {teamProjection.defense}
              {#if defenseDelta !== null}
                <span
                  class="ml-1 font-mono text-[11px] font-bold {defenseDelta > 0
                    ? 'text-positive'
                    : 'text-destructive'}"
                >
                  {defenseDelta > 0 ? '+' : ''}{defenseDelta}
                </span>
              {/if}
            </dd>
          </div>
          <div class="flex items-baseline gap-1.5">
            <dt
              class="font-mono text-[10px] font-bold tracking-[0.14em] text-muted-foreground uppercase"
            >
              Overall
            </dt>
            <dd class="font-display text-xl leading-none font-extrabold tracking-tight">
              {teamProjection.overall}
              {#if overallDelta !== null}
                <span
                  class="ml-1 font-mono text-[11px] font-bold {overallDelta > 0
                    ? 'text-positive'
                    : 'text-destructive'}"
                >
                  {overallDelta > 0 ? '+' : ''}{overallDelta}
                </span>
              {/if}
            </dd>
          </div>
        </dl>
        {#if overallDelta !== null || offenseDelta !== null || defenseDelta !== null}
          <p class="mt-1 font-mono text-[9px] text-muted-foreground/70">Change vs last rotation</p>
        {/if}
      {/if}

      <UnitChemistry {roster} {effects} {shell} />

      <AutoRotationPanel
        bind:this={autoPanel}
        editor={shell.editor}
        disabled={shell.block.phase === 'running'}
        rosterIds={autoRosterIds}
        unavailable={autoUnavailable}
        load={autoLoad}
        overall={autoOverall}
        horizon={autoHorizon}
        seed={autoSeed}
        runId={shell.snapshot?.run.runId ?? null}
        blockIndex={shell.nextBlockIndex}
        names={autoNames}
        onAutoApplied={() => {
          if (!mounted) return;
          rotationRevision += 1;
        }}
      />

      <RotationEditor
        editor={shell.editor}
        disabled={shell.block.phase === 'running'}
        faces={shell.facesByVersion}
        {manifest}
        {effects}
        {summaries}
        {overallByVersion}
        {gearPointsByVersion}
        {overallDeltaByVersion}
        presetLoad={autoLoad}
        presetHorizon={autoHorizon}
        onpending={(pending) => {
          swapPending = pending;
        }}
        onchange={() => {
          if (!mounted) return;
          rotationRevision += 1;
          autoPanel?.notifyManualEdit();
        }}
        onSelectPlayer={(playerVersionId) => {
          selectedPlayerId = playerVersionId;
        }}
      />

      {#if statsView !== null}
        <TeamRosterPanel
          {roster}
          {manifest}
          {shell}
          {roleOf}
          {effects}
          {summaries}
          {statsView}
          sponsorsRun={run}
          onSelectPlayer={(playerVersionId) => {
            selectedPlayerId = playerVersionId;
          }}
        />
      {/if}

      {#if statsView !== null}
        <details class="rounded-none bg-surface-1 px-3 py-2 sm:rounded-xl">
          <summary
            class="flex min-h-11 cursor-pointer list-none items-center justify-between gap-2 rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-ring [&::-webkit-details-marker]:hidden"
          >
            <span
              id="team-season-stats-heading"
              class="font-mono text-[11px] font-bold uppercase tracking-[0.14em] text-muted-foreground"
            >
              Season stats
            </span>
            <span class="text-xs font-semibold text-primary">View stats</span>
          </summary>
          <div class="pb-2">
            <SeasonPlayerStats view={statsView} {manifest} {shell} embedded />
          </div>
        </details>
      {/if}

      {#if injuryTimeline.length > 0}
        <InjuryTimeline players={injuryTimeline} />
      {/if}
      {#if manifest !== null}
        <PlayerSponsorCard
          card={sponsorCard}
          face={sponsorCardFace}
          {manifest}
          vault={sponsorVault}
          logos={sponsorLogos}
          busy={sponsorApplying}
          commandError={sponsorApplyError}
          unlocked={sponsorUnlocked}
          onApply={applySponsor}
          onClose={() => {
            selectedPlayerId = null;
          }}
        />
      {/if}
    </section>

    <div
      class="sticky bottom-[calc(5.25rem+env(safe-area-inset-bottom))] z-20 mt-6 scroll-mb-24 px-3 sm:bottom-4 sm:px-0"
    >
      <div
        class="rounded-none border border-border bg-surface-1 p-3 shadow-2xl shadow-black/40 backdrop-blur supports-[backdrop-filter]:bg-surface-1/95 sm:rounded-xl"
      >
        <div class="min-w-0 text-sm" aria-live="polite">
          {#if failures.length === 0}
            <p class="font-semibold text-positive">Rotation ready</p>
          {:else}
            <p class="font-semibold text-destructive">Rotation incomplete</p>
          {/if}
          <p class="mt-1 font-mono text-[11px] text-muted-foreground">
            {minutesTotal}/240 minutes · {starterCount} starters · {closerCount} closers
            {#if failures.length > 0 && minutesRemaining !== 0}
              · {Math.abs(minutesRemaining)} still need assignment
            {/if}
            {#if swapPending}
              · <span class="text-primary">Swap pending — choose who to replace</span>
            {/if}
          </p>
          {#if humanizedGlobal.length > 0}
            <ul class="mt-1 list-inside list-disc font-mono text-[11px] text-destructive">
              {#each humanizedGlobal as failure, failureIndex (failureIndex)}
                <li>{failure}</li>
              {/each}
            </ul>
          {/if}
        </div>
      </div>
    </div>
  {/if}
</div>
