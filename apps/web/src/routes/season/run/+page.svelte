<script lang="ts">
  import { getContext } from 'svelte';
  import { resolve } from '$app/paths';
  import type { RouteId } from '$app/types';
  import { blockRoundRange } from '@hoop-rush/data-contracts';
  import BlockProgress from '$lib/components/season/BlockProgress.svelte';
  import CourtInnovationPicker from '$lib/components/season/CourtInnovationPicker.svelte';
  import RuleBadge from '$lib/components/season/RuleBadge.svelte';
  import CampaignPanel from '$lib/components/season/CampaignPanel.svelte';
  import ChampionSummary from '$lib/components/season/ChampionSummary.svelte';
  import HealthStrip from '$lib/components/season/HealthStrip.svelte';
  import InfluencePanel from '$lib/components/season/InfluencePanel.svelte';
  import InterruptionPanel from '$lib/components/season/InterruptionPanel.svelte';
  import ChallengesPanel from '$lib/components/season/ChallengesPanel.svelte';
  import PostseasonMatchupCard from '$lib/components/season/PostseasonMatchupCard.svelte';
  import PostseasonProgress from '$lib/components/season/PostseasonProgress.svelte';
  import PostseasonRotationPanel from '$lib/components/season/PostseasonRotationPanel.svelte';
  import SeasonTape from '$lib/components/season/SeasonTape.svelte';
  import SeasonTeamLogo from '$lib/components/season/SeasonTeamLogo.svelte';
  import { franchiseIdentityOf } from '$lib/season/season-branding';
  import {
    SEASON_RUN_SHELL_CONTEXT,
    type SeasonRunShellData,
  } from '$lib/season/season-shell-context';
  import {
    blockPhaseAllowsSubmit,
    buildSubmitBlockEnvelope,
  } from '$lib/season/season-block-submit';
  import {
    buildLockPreview,
    gamesToLockForBlock,
    pendingRotationSetDigest,
    type LockPreview,
  } from '$lib/season/season-lock-preview';
  import {
    didWin,
    humanUpcomingGamesFromGames,
    recordLabel,
  } from '$lib/season/season-presentation';
  import {
    influenceViewModel,
    type InfluenceSpendAffordance,
  } from '$lib/season/season-influence-view';
  import { challengesViewModel } from '$lib/season/season-challenges-view';
  import { availabilityStripRows } from '$lib/season/season-health-view';
  import {
    openWindowOf,
    tradeOfferViewModel,
    humanTradeOffersOf,
  } from '$lib/season/season-trade-view';
  import {
    describePostseasonRejection,
    humanEliminated,
    humanPlaysNextGame,
    humanSeriesOf,
    nextGameTeamsOf,
    nextPostseasonGameOf,
    playInGameCardViewModel,
    postseasonRankingsOf,
    postseasonStageLabel,
    riskyRehabOptionsOf,
  } from '$lib/season/season-postseason-presentation';
  import { ordinal } from '$lib/season/season-presentation';
  import { homeRuleOf } from '$lib/season/season-evolution-view';
  import { parsePlayoffGameId } from '@hoop-rush/data-contracts';
  import type { SeasonRunCommandError } from '$lib/season/season-hub-state';
  const shell = getContext<SeasonRunShellData>(SEASON_RUN_SHELL_CONTEXT);
  let mounted = $state(true);
  $effect(() => {
    mounted = true;
    return () => {
      mounted = false;
    };
  });
  const run = $derived(shell.run);
  const snapshot = $derived(shell.snapshot);
  const humanFranchiseId = $derived(shell.humanFranchiseId);
  const nextBlockIndex = $derived(shell.nextBlockIndex);
  const seasonComplete = $derived(shell.seasonComplete);
  const block = $derived(shell.block);
  const stage = $derived(run?.stage ?? null);
  const stageLabel = $derived(postseasonStageLabel(stage ?? 'regular-season'));
  const inPostseason = $derived(stage === 'play-in' || stage === 'playoffs');
  const blockLabel = $derived.by(() => {
    if (nextBlockIndex === null || seasonComplete) return '';
    const { fromRound, toRound } = blockRoundRange(nextBlockIndex);
    return `Block ${String(nextBlockIndex + 1)} of 9 · rounds ${String(fromRound)}–${String(toRound)}`;
  });
  const pending = $derived(shell.pending);
  const interruption = $derived(shell.interruption);
  const commandError = $derived(shell.commandError);
  const blockPaused = $derived(pending !== null || interruption !== null);
  const openWindow = $derived(
    run?.trade !== null && run?.trade !== undefined ? openWindowOf(run.trade) : null,
  );
  const openFreeAgencyWindow = $derived(
    shell.freeAgency?.windows.find((window) => window.status === 'open') ?? null,
  );
  const influenceVm = $derived(
    shell.influence !== null && humanFranchiseId !== null
      ? influenceViewModel(
          shell.influence,
          humanFranchiseId,
          shell.health,
          openWindow,
          evolution?.frontOffice?.executiveId ?? null,
        )
      : null,
  );
  const tradeOffers = $derived.by(() => {
    const currentRun = shell.run;
    const franchiseId = shell.humanFranchiseId;
    if (currentRun === null || franchiseId === null) return [];
    void currentRun.stateRevision;
    const offers = humanTradeOffersOf(currentRun.trade, franchiseId);
    return offers.map((offer) =>
      tradeOfferViewModel(offer, currentRun, shell.catalog, shell.franchiseName),
    );
  });
  const challengesVm = $derived(
    run !== null ? challengesViewModel(run, nextBlockIndex) : null,
  );
  const hasCampaign = $derived(
    run !== null &&
      (
        run as unknown as {
          campaign?: unknown;
        }
      ).campaign !== undefined,
  );
  const campaignCommandError = $derived.by(() => {
    const e = commandError;
    if (e === null) return null;
    const campaignCommands = new Set(['select-campaign-opportunity']);
    return campaignCommands.has(e.command) ? e.message : null;
  });
  const innovationCommandError = $derived.by(() => {
    const e = commandError;
    if (e === null) return null;
    return e.command === 'select-court-innovation' ? e.message : null;
  });
  const evolution = $derived(
    (
      run as unknown as {
        evolution?: import('@hoop-rush/data-contracts').SeasonEvolutionState | null;
      } | null
    )?.evolution ?? null,
  );
  const needsInnovation = $derived(
    run !== null &&
      humanFranchiseId !== null &&
      evolution?.discovery !== null &&
      evolution?.discovery !== undefined &&
      (evolution?.selections as unknown as Record<string, unknown> | undefined)?.[
        humanFranchiseId
      ] === undefined,
  );
  let innovationPreviews = $state<
    import('$lib/season/season-innovation-preview').InnovationEnvironmentPreview[] | null
  >(null);
  let innovationPreviewNote = $state<string | null>(null);
  $effect(() => {
    if (!mounted || !needsInnovation || run === null || humanFranchiseId === null) return;
    let cancelled = false;
    innovationPreviews = null;
    innovationPreviewNote = 'Loading scoring-environment previews…';
    void (async () => {
      try {
        const [{ loadSeasonDraftCatalog, loadSeasonEraProfile }, previewModule] = await Promise.all(
          [import('$lib/season/season-assets'), import('$lib/season/season-innovation-preview')],
        );
        const [catalog, profile] = await Promise.all([
          loadSeasonDraftCatalog(),
          loadSeasonEraProfile(),
        ]);
        if (cancelled || !mounted) return;
        const result = previewModule.previewInnovationEnvironments({
          run,
          franchiseId: humanFranchiseId,
          catalog,
          profile,
        });
        if ('error' in result) {
          innovationPreviewNote = result.error;
          return;
        }
        innovationPreviews = result.previews;
        innovationPreviewNote = `${result.unitLabel} · adapter ${result.previews[0]?.adapterVersion ?? 'unknown'}`;
      } catch (error) {
        if (!cancelled) {
          innovationPreviewNote =
            error instanceof Error ? error.message : 'Previews are unavailable.';
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  });
  const rehabAffordances = $derived.by((): InfluenceSpendAffordance[] => {
    const affordances = influenceVm?.affordances ?? [];
    const rehab = affordances.filter((affordance) => affordance.purpose === 'risky-rehab');
    const unavailable = new Set(interruption?.unavailablePlayerVersionIds ?? []);
    return unavailable.size > 0
      ? rehab.filter(
          (affordance) =>
            affordance.playerVersionId !== null && unavailable.has(affordance.playerVersionId),
        )
      : rehab;
  });
  const nextOpponents = $derived(
    run !== null && humanFranchiseId !== null && nextBlockIndex !== null && !seasonComplete
      ? humanUpcomingGamesFromGames(run.games, humanFranchiseId, nextBlockIndex).slice(0, 3)
      : [],
  );
  const names = $derived.by(() => {
    const map = new Map<string, string>();
    for (const roster of run?.rosters ?? []) {
      for (const entry of roster.players) map.set(entry.playerVersionId, entry.displayName);
    }
    return map;
  });
  const staminaByVersion = $derived.by(() => {
    const slice = shell.playerSlice;
    const map = new Map<string, number>();
    for (const entry of slice.values()) {
      map.set(entry.playerVersionId, entry.staminaRating);
    }
    return map;
  });
  const preview: LockPreview | null = $derived.by(() => {
    if (
      run === null ||
      humanFranchiseId === null ||
      shell.editor === null ||
      nextBlockIndex === null ||
      seasonComplete
    ) {
      return null;
    }
    const baseline =
      run.rotations.find((rotation) => rotation.franchiseId === humanFranchiseId) ??
      shell.editor.rotation;
    const lastLockedDigest =
      snapshot !== null && snapshot.acceptedBlocks.length > 0
        ? (snapshot.acceptedBlocks[snapshot.acceptedBlocks.length - 1]?.rotationDigest ?? null)
        : null;
    const effects = snapshot?.effects ?? null;
    return buildLockPreview({
      pendingHumanRotation: shell.editor.rotation,
      baselineHumanRotation: baseline,
      pendingSetDigest: pendingRotationSetDigest(run.rotations, shell.editor.rotation),
      lastLockedDigest,
      blockIndex: nextBlockIndex,
      names,
      games: run.games,
      humanFranchiseId,
      fatigue: effects === null ? null : { effects, staminaByVersion },
      evolution: evolution ?? null,
    });
  });
  const rotationFailures = $derived(shell.editor?.validate() ?? []);
  const canSubmit = $derived(
    snapshot !== null &&
      shell.editor !== null &&
      nextBlockIndex !== null &&
      !seasonComplete &&
      rotationFailures.length === 0 &&
      blockPhaseAllowsSubmit(block.phase) &&
      block.phase !== 'running',
  );
  let submitting = $state(false);
  let submitError: string | null = $state(null);
  async function submitBlock() {
    if (!canSubmit || submitting) return;
    submitting = true;
    submitError = null;
    try {
      await shell.refresh?.();
      if (!mounted) return;
      const result = await buildSubmitBlockEnvelope(shell);
      if (!mounted) return;
      if (!result.ok) {
        submitError = result.error.message;
        return;
      }
      shell.hub?.startBlock(result.envelope);
    } finally {
      if (mounted) submitting = false;
    }
  }
  function blockRecord(blockIndex: number): {
    wins: number;
    losses: number;
  } | null {
    const summaries = snapshot?.summaries ?? [];
    if (humanFranchiseId === null) return null;
    const { fromRound, toRound } = blockRoundRange(blockIndex);
    let wins = 0;
    let losses = 0;
    for (const summary of summaries) {
      if (summary.round < fromRound || summary.round > toRound) continue;
      if (
        summary.homeFranchiseId !== humanFranchiseId &&
        summary.awayFranchiseId !== humanFranchiseId
      ) {
        continue;
      }
      if (didWin(summary, humanFranchiseId)) wins += 1;
      else losses += 1;
    }
    return { wins, losses };
  }
  const recentBlocks = $derived(
    (snapshot?.acceptedBlocks ?? [])
      .slice(-3)
      .reverse()
      .map((accepted) => ({
        accepted,
        record: blockRecord(accepted.blockIndex),
      })),
  );
  const postseason = $derived(run?.postseason ?? null);
  const eliminated = $derived(
    run !== null && humanFranchiseId !== null && humanEliminated(run, humanFranchiseId),
  );
  const nextGame = $derived(run !== null ? nextPostseasonGameOf(run) : null);
  const humanPlaysNext = $derived(
    run !== null && humanFranchiseId !== null && humanPlaysNextGame(run, humanFranchiseId),
  );
  const nextTeams = $derived.by(() => {
    if (run === null || nextGame?.kind !== 'game') return null;
    return nextGameTeamsOf(run, nextGame.gameId);
  });
  const seriesContext = $derived(
    run !== null && humanFranchiseId !== null ? humanSeriesOf(run, humanFranchiseId) : null,
  );
  const playInContext = $derived.by(() => {
    if (postseason === null || nextGame?.kind !== 'game') return null;
    const match = /^pi-(east|west)-(seven-eight|nine-ten|final)$/.exec(nextGame.gameId);
    if (match === null) return null;
    return playInGameCardViewModel(
      postseason,
      match[1] as 'east' | 'west',
      match[2] as 'seven-eight' | 'nine-ten' | 'final',
      humanFranchiseId,
    );
  });
  const rankings = $derived(run !== null && inPostseason ? postseasonRankingsOf(run) : null);
  const humanSeed = $derived.by(() => {
    if (run === null || humanFranchiseId === null || rankings === null) return null;
    const conference = run.league.teams.find(
      (team) => team.franchiseId === humanFranchiseId,
    )?.conference;
    if (conference === undefined) return null;
    const ranked = rankings[conference].ranked;
    const position = ranked.indexOf(humanFranchiseId);
    return position === -1 ? null : position + 1;
  });
  const rehabOptions = $derived(
    run !== null && humanFranchiseId !== null
      ? riskyRehabOptionsOf(run, humanFranchiseId, shell.playerName)
      : [],
  );
  const availabilityRows = $derived.by(() => {
    if (run === null || humanFranchiseId === null) return [];
    const roster = run.rosters.find((entry) => entry.franchiseId === humanFranchiseId);
    if (roster === undefined) return [];
    return availabilityStripRows(run.health, roster, undefined, names);
  });
  const postseasonBusy = $derived(shell.postseason.phase === 'running');
  let lastPostseasonAction = $state<
    'start' | 'advance' | 'spectate' | 'fast-forward' | 'submit' | null
  >(null);
  let postseasonSubmitting = $state(false);
  let selectedRehabInjuryId = $state<string | null>(null);
  const postseasonCommandError = $derived.by(() => {
    const error = commandError;
    if (error === null) return null;
    const postseasonCommands = new Set([
      'start-postseason',
      'advance-postseason',
      'submit-postseason-rotation',
      'spectate-postseason-game',
      'fast-forward-postseason',
    ]);
    if (!postseasonCommands.has(error.command)) return null;
    if (error.rejection !== null) {
      return describePostseasonRejection(error.command, error.rejection);
    }
    return error.message;
  });
  async function startPostseason() {
    if (postseasonBusy || postseasonSubmitting) return;
    postseasonSubmitting = true;
    try {
      lastPostseasonAction = 'start';
      await shell.startPostseason();
    } finally {
      postseasonSubmitting = false;
    }
  }
  async function advanceToDecision() {
    if (postseasonBusy || postseasonSubmitting) return;
    postseasonSubmitting = true;
    try {
      lastPostseasonAction = 'advance';
      await shell.advancePostseason();
    } finally {
      postseasonSubmitting = false;
    }
  }
  async function spectateNext() {
    if (postseasonBusy || postseasonSubmitting || nextGame?.kind !== 'game') return;
    postseasonSubmitting = true;
    try {
      lastPostseasonAction = 'spectate';
      await shell.spectatePostseasonGame({ targetGameId: nextGame.gameId });
    } finally {
      postseasonSubmitting = false;
    }
  }
  async function fastForward() {
    if (postseasonBusy || postseasonSubmitting) return;
    postseasonSubmitting = true;
    try {
      lastPostseasonAction = 'fast-forward';
      await shell.fastForwardPostseason();
    } finally {
      postseasonSubmitting = false;
    }
  }
  async function submitPostseasonRotation() {
    if (postseasonBusy || postseasonSubmitting || nextGame?.kind !== 'game') return;
    if (shell.editor === null || humanFranchiseId === null) return;
    postseasonSubmitting = true;
    try {
      lastPostseasonAction = 'submit';
      await shell.submitPostseasonRotation({
        targetGameId: nextGame.gameId,
        rotation: {
          franchiseId: humanFranchiseId,
          rotation: shell.editor.rotation,
          ...(selectedRehabInjuryId !== null ? { riskyRehabInjuryId: selectedRehabInjuryId } : {}),
        },
      });
      selectedRehabInjuryId = null;
    } finally {
      postseasonSubmitting = false;
    }
  }
  function retryPostseason() {
    if (lastPostseasonAction === 'start') void startPostseason();
    else if (lastPostseasonAction === 'advance') void advanceToDecision();
    else if (lastPostseasonAction === 'spectate') void spectateNext();
    else if (lastPostseasonAction === 'fast-forward') void fastForward();
    else if (lastPostseasonAction === 'submit') void submitPostseasonRotation();
  }
  const canSubmitPostseason = $derived(
    nextGame?.kind === 'game' &&
      humanPlaysNext &&
      shell.editor !== null &&
      shell.editor.validate().length === 0 &&
      !postseasonBusy &&
      !postseasonSubmitting,
  );
  const matchupLabel = $derived.by(() => {
    if (playInContext !== null) return `the Play-In ${playInContext.matchupLabel}`;
    if (seriesContext !== null && nextGame?.kind === 'game') {
      const gameNumber = parsePlayoffGameId(nextGame.gameId)?.gameNumber ?? null;
      return gameNumber === null ? 'this game' : `Game ${String(gameNumber)}`;
    }
    return 'this game';
  });
  const nextGameLine = $derived.by(() => {
    if (nextTeams === null || humanFranchiseId === null) return '';
    const humanHome = nextTeams.home === humanFranchiseId;
    const opponent = humanHome ? nextTeams.away : nextTeams.home;
    return `${humanHome ? 'vs' : 'at'} ${shell.franchiseName(opponent)} · ${humanHome ? 'home' : 'away'}`;
  });
  const championFranchiseId = $derived(run?.postseason.championFranchiseId ?? null);
  const humanWonChampionship = $derived(
    championFranchiseId !== null && championFranchiseId === humanFranchiseId,
  );
</script>

<svelte:head>
  <title>Season Run — Hub — Hoop Rush</title>
</svelte:head>

<div class="flex min-w-0 flex-col gap-6 pt-6">
  {#if stage === 'regular-season'}
    <section aria-labelledby="season-tape-heading" class="px-3 sm:px-0">
      <h2 id="season-tape-heading" class="sr-only">Season progress</h2>
      {#if snapshot !== null}
        <SeasonTape
          acceptedBlocks={snapshot.acceptedBlocks}
          {nextBlockIndex}
          summaries={snapshot.summaries}
          {humanFranchiseId}
        />
      {/if}
    </section>

    {#if seasonComplete}
      <section
        aria-labelledby="season-complete-heading"
        data-season-start-postseason
        class="flex flex-col gap-3 rounded-none bg-surface-1 p-4 sm:rounded-xl sm:p-5"
      >
        <h2
          id="season-complete-heading"
          class="font-display text-xl font-extrabold uppercase tracking-tight"
        >
          Regular season complete
        </h2>

        <div class="flex flex-wrap items-center gap-2">
          <button
            type="button"
            data-season-start-postseason-button
            onclick={() => void startPostseason()}
            disabled={postseasonBusy || postseasonSubmitting}
            class="inline-flex w-fit items-center justify-center gap-2 rounded-lg bg-primary px-5 py-3 text-sm font-semibold text-primary-foreground transition-opacity outline-none focus-visible:ring-2 focus-visible:ring-ring hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {postseasonBusy
              ? 'Starting playoffs…'
              : postseasonSubmitting
                ? 'Starting…'
                : 'Start playoffs'}
          </button>
          <a
            href={resolve('/season/run/league' as any)}
            class="inline-flex w-fit items-center justify-center gap-2 rounded-lg border border-border px-5 py-3 text-sm font-semibold text-muted-foreground transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring hover:text-foreground"
          >
            Final standings
          </a>
          <a
            href={resolve('/season/run/checkpoint/?block=8' as any)}
            class="inline-flex w-fit items-center justify-center gap-2 rounded-lg border border-border px-5 py-3 text-sm font-semibold text-muted-foreground transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring hover:text-foreground"
          >
            Last Block recap
          </a>
        </div>
        {#if postseasonCommandError !== null}
          <p
            role="alert"
            class="rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm"
          >
            {postseasonCommandError}
          </p>
        {/if}
        <PostseasonProgress
          progress={shell.postseason}
          label="Start postseason"
          onCancel={() => shell.cancelPostseason()}
          onRetry={() => retryPostseason()}
        />
      </section>
    {:else if snapshot !== null}
      {#if blockPaused}
        <InterruptionPanel
          {interruption}
          {pending}
          playerName={shell.playerName}
          injuryPlayerName={(injuryId) => {
            const record = shell.health?.injuries.find((r) => r.injuryId === injuryId);
            return record === undefined ? injuryId : shell.playerName(record.playerVersionId);
          }}
          {rehabAffordances}
          balance={influenceVm?.balance ?? 0}
          busy={block.phase === 'running'}
          {commandError}
          onRehab={(affordance) =>
            shell.spendInfluence({
              purpose: 'risky-rehab',
              injuryId: affordance.injuryId ?? undefined,
            })}
          onForfeit={() => shell.forfeitInterruptedGame()}
          onResume={() => shell.resumeBlock()}
        />
      {:else}
        <section
          aria-labelledby="next-decision-heading"
          class="flex flex-col gap-4 rounded-none border border-border bg-surface-1 p-4 sm:rounded-xl sm:p-5"
        >
          <div class="flex flex-wrap items-baseline justify-between gap-2">
            <h2
              id="next-decision-heading"
              class="font-display text-lg font-extrabold uppercase tracking-tight"
            >
              {nextBlockIndex === null
                ? 'Next block'
                : `Play Block ${String(nextBlockIndex + 1)} of 9`}
            </h2>
            <span class="text-xs text-muted-foreground">
              {nextBlockIndex === null ? '—' : `${String(nextBlockIndex)} of 9 played.`}
            </span>
          </div>

          {#if hasCampaign}
            <CampaignPanel
              {run}
              {nextBlockIndex}
              busy={block.phase === 'running'}
              commandError={campaignCommandError}
              playerName={shell.playerName}
              onSelectOpportunity={(input) => {
                if (!mounted) return;
                void shell.selectCampaignOpportunity?.(input);
              }}
            />
          {/if}
          {#if challengesVm !== null}
            <ChallengesPanel
              blockIndex={challengesVm.blockIndex}
              deal={challengesVm.deal}
              evaluation={challengesVm.evaluation}
              franchiseName={shell.franchiseName}
            />
          {/if}

          {#if needsInnovation}
            <CourtInnovationPicker
              busy={block.phase === 'running'}
              commandError={innovationCommandError}
              previews={innovationPreviews}
              previewNote={innovationPreviewNote}
              onSelect={(input) => {
                if (!mounted) return;
                void shell.selectCourtInnovation?.(input);
              }}
            />
          {/if}

          <div class="grid gap-4 lg:grid-cols-3">
            <div class="rounded-lg bg-surface-2 p-3">
              <h3
                class="font-mono text-[11px] font-bold uppercase tracking-[0.14em] text-muted-foreground"
              >
                Up next
              </h3>
              {#if nextOpponents.length === 0}
                <p class="mt-2 text-sm text-muted-foreground">No games for you in this block.</p>
              {:else}
                <ol class="mt-2 flex flex-col gap-2">
                  {#each nextOpponents as game (game.gameId)}
                    {@const opponentIdentity =
                      shell.manifest !== null
                        ? franchiseIdentityOf(shell.manifest, game.opponentFranchiseId)
                        : null}
                    <li class="flex items-center gap-2.5">
                      {#if shell.manifest !== null}
                        <SeasonTeamLogo
                          manifest={shell.manifest}
                          franchiseId={game.opponentFranchiseId}
                          teamExternalId={opponentIdentity?.teamExternalId ?? ''}
                          size="sm"
                        />
                      {/if}
                      <span class="min-w-0 flex-1 truncate text-sm font-semibold">
                        {game.humanIsHome ? 'vs' : 'at'}
                        {shell.franchiseName(game.opponentFranchiseId)}
                      </span>
                      {#if run}
                        <RuleBadge rule={homeRuleOf(run, game.homeFranchiseId)} compact />
                      {/if}
                      <span
                        class="shrink-0 rounded-full bg-surface-3 px-2 py-0.5 font-mono text-[10px] text-muted-foreground"
                      >
                        R{game.round}
                      </span>
                    </li>
                  {/each}
                </ol>
              {/if}
            </div>

            <div class="rounded-lg bg-surface-2 p-3">
              <h3
                class="font-mono text-[11px] font-bold uppercase tracking-[0.14em] text-muted-foreground"
              >
                Lineup
              </h3>
              {#if preview === null}
                <p class="mt-2 text-sm text-muted-foreground">Checking your lineup…</p>
              {:else if preview.unchangedSinceLastLock || preview.changes.length === 0}
                <p class="mt-2 text-sm text-muted-foreground">Lineup unchanged — ready to play.</p>
              {:else}
                <p class="mt-2 text-sm">
                  <strong class="text-foreground">{preview.changes.length}</strong>
                  change{preview.changes.length === 1 ? '' : 's'} since the saved baseline:
                </p>
                <ul class="mt-1 flex flex-col gap-1">
                  {#each preview.changes.slice(0, 3) as change (change.playerVersionId)}
                    <li class="truncate text-sm">
                      <span class="font-semibold">{change.displayName}</span>
                      <span class="ml-2 font-mono text-[10px] text-muted-foreground">
                        {change.roleBefore}
                        {change.minutesBefore ?? '—'}→{change.roleAfter}
                        {change.minutesAfter ?? '—'}
                      </span>
                    </li>
                  {/each}
                </ul>
                {#if preview.changes.length > 3}
                  <p class="mt-1 font-mono text-[10px] text-muted-foreground">
                    +{preview.changes.length - 3} more
                  </p>
                {/if}
              {/if}
              <a
                href={resolve('/season/run/team/' as any)}
                class="mt-2 inline-flex items-center gap-1 text-sm font-semibold text-primary underline-offset-4 outline-none focus-visible:ring-2 focus-visible:ring-ring hover:underline"
              >
                Change lineup
                <span aria-hidden="true">&rarr;</span>
              </a>
            </div>

            <div class="rounded-lg bg-surface-2 p-3">
              <h3
                class="font-mono text-[11px] font-bold uppercase tracking-[0.14em] text-muted-foreground"
              >
                This block
              </h3>
              {#if preview === null}
                <p class="mt-2 text-sm text-muted-foreground">Checking schedule…</p>
              {:else}
                <p class="mt-2 text-sm text-muted-foreground">
                  Plays {preview.gamesToLock === 1
                    ? '1 game'
                    : `${String(preview.gamesToLock)} games`} with this lineup.
                </p>
                {#if challengesVm !== null && challengesVm.deal !== null}
                  <p class="mt-1 text-sm">
                    Challenges:
                    {#if challengesVm.evaluation !== null}
                      {@const done = challengesVm.evaluation.results.filter((r) => r.success).length}
                      {@const earned = challengesVm.evaluation.results.reduce(
                        (sum, r) => sum + (r.success ? (r.challengeId === 'beat-leader' || r.challengeId === 'beat-higher' || r.challengeId === 'statement-block' ? 2 : 1) : 0),
                        0,
                      )}
                      <strong class="text-foreground">{done}/3 (+{earned})</strong>
                    {:else}
                      <strong class="text-foreground">3 live</strong>
                    {/if}
                  </p>
                {/if}
                {#if preview.upcomingGames.length === 0}
                  <p class="mt-2 text-sm text-muted-foreground">No games for you in this block.</p>
                {:else}
                  <p class="mt-2 text-sm text-muted-foreground">See opponents under Up next.</p>
                {/if}
              {/if}
            </div>
          </div>

          <div class="flex flex-col gap-3">
            {#if rotationFailures.length > 0}
              <p
                role="alert"
                class="rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm"
              >
                Your lineup needs a fix — see the highlighted issues on the Rotation tab.
              </p>
            {/if}
            {#if submitError}
              <p
                role="alert"
                class="rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm"
              >
                {submitError}
              </p>
            {/if}
            {#if commandError !== null}
              <p
                role="alert"
                class="rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm"
              >
                {commandError.message}
              </p>
            {/if}
            <button
              type="button"
              onclick={() => void submitBlock()}
              disabled={!canSubmit || submitting}
              data-can-submit={canSubmit}
              data-block-phase={block.phase}
              data-editor-ready={shell.editor !== null}
              class="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-primary px-5 py-3 text-sm font-semibold text-primary-foreground transition-opacity outline-none focus-visible:ring-2 focus-visible:ring-ring hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40 sm:text-base"
            >
              {block.phase === 'running'
                ? 'Playing block…'
                : submitting
                  ? 'Getting ready…'
                  : nextBlockIndex === null
                    ? 'Play block'
                    : `Play Block ${String(nextBlockIndex + 1)}`}
            </button>
          </div>

          <BlockProgress
            {block}
            label={blockLabel}
            onCancel={() => shell.cancelBlock()}
            onRetry={() => shell.retryBlock()}
          />
        </section>
      {/if}

      {#if openFreeAgencyWindow !== null}
        <section
          aria-labelledby="free-agency-cta-heading"
          data-fa-hub-cta
          class="flex flex-col gap-3 rounded-none border border-primary/30 bg-primary/5 p-4 sm:rounded-xl sm:p-5"
        >
          <div class="flex flex-wrap items-baseline justify-between gap-2">
            <h2
              id="free-agency-cta-heading"
              class="font-display text-lg font-extrabold uppercase tracking-tight"
            >
              Free Agency Window {openFreeAgencyWindow.windowIndex + 1}
            </h2>
            <span class="font-mono text-[10px] text-muted-foreground">
              {openFreeAgencyWindow.candidates.length} candidate
              {openFreeAgencyWindow.candidates.length === 1 ? '' : 's'} on the market
            </span>
          </div>
          <p class="text-sm text-muted-foreground">
            Declare interest in up to two targets — or skip — before the next block can submit.
            Resolve the market whenever you are ready.
          </p>
          <a
            href={resolve('/season/run/free-agency' as any)}
            data-fa-hub-cta-link
            class="inline-flex w-fit items-center gap-2 rounded-lg bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground transition-opacity outline-none focus-visible:ring-2 focus-visible:ring-ring hover:opacity-90"
          >
            Open Free Agency
            <span aria-hidden="true">&rarr;</span>
          </a>
        </section>
      {/if}

      {#if openWindow !== null}
        <section class="rounded-none border border-border bg-surface-1 p-4 sm:rounded-xl">
          <h2 class="font-display text-base font-extrabold uppercase tracking-tight">
            Trade window open
          </h2>
          <p class="mt-1 text-sm text-muted-foreground">
            {tradeOffers.length} offer{tradeOffers.length === 1 ? '' : 's'} waiting.
          </p>
          <a
            href={resolve('/season/run/trades' as any)}
            class="mt-3 inline-flex w-fit items-center justify-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground"
          >
            Open trades
          </a>
        </section>
      {/if}

      {#if influenceVm !== null}
        <InfluencePanel
          balance={influenceVm.balance}
          cap={influenceVm.cap}
          floor={influenceVm.floor}
          atCap={influenceVm.atCap}
          atFloor={influenceVm.atFloor}
          entries={influenceVm.recentEntries}
          affordances={influenceVm.affordances}
          busy={block.phase === 'running'}
          playerName={shell.playerName}
          onSpend={(affordance) =>
            shell.spendInfluence({
              purpose: affordance.purpose,
              windowIndex: affordance.windowIndex ?? undefined,
              injuryId: affordance.injuryId ?? undefined,
            })}
        />
      {/if}

      {#if recentBlocks.length > 0}
        <section aria-labelledby="recent-recaps-heading" class="px-3 sm:px-0">
          <h2
            id="recent-recaps-heading"
            class="font-display text-base font-extrabold uppercase tracking-tight"
          >
            Recent blocks
          </h2>
          <ul class="mt-2 flex flex-col gap-0 sm:gap-2">
            {#each recentBlocks as entry (entry.accepted.blockIndex)}
              <li>
                <a
                  href={resolve(
                    `/season/run/checkpoint/?block=${String(entry.accepted.blockIndex)}` as any,
                  )}
                  class="flex items-center justify-between gap-3 bg-surface-1 px-4 py-3 outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring hover:bg-surface-2 sm:rounded-xl"
                >
                  <span class="font-mono text-[10px] font-bold uppercase text-primary">
                    Block {entry.accepted.blockIndex + 1} of 9
                  </span>
                  {#if entry.record !== null}
                    <span class="font-mono text-xs font-bold">
                      {recordLabel(entry.record.wins, entry.record.losses)}
                    </span>
                  {/if}
                </a>
              </li>
            {/each}
          </ul>
        </section>
      {/if}
    {/if}
  {:else if inPostseason}
    <section aria-labelledby="postseason-hub-heading" class="px-3 sm:px-0">
      <div class="flex flex-wrap items-baseline justify-between gap-2">
        <h2
          id="postseason-hub-heading"
          class="font-display text-xl font-extrabold uppercase tracking-tight"
        >
          {stageLabel}
        </h2>
        <div class="flex items-center gap-2">
          {#if humanSeed !== null}
            <span
              class="rounded-full bg-surface-3 px-2 py-0.5 font-mono text-[10px] font-bold uppercase tracking-[0.12em] text-muted-foreground"
            >
              {ordinal(humanSeed)} seed
            </span>
          {/if}
          <a
            href={resolve('/season/run/postseason' as any)}
            class="rounded-lg border border-border px-3 py-1.5 font-mono text-[10px] font-bold uppercase tracking-[0.12em] text-muted-foreground outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring hover:text-foreground"
          >
            Bracket
          </a>
        </div>
      </div>

      {#if eliminated}
        <div
          role="status"
          data-season-eliminated
          class="mt-3 rounded-none border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm sm:rounded-xl"
        >
          <span class="font-bold text-amber-700 dark:text-amber-300">Eliminated.</span>
          <span class="text-amber-700/80 dark:text-amber-300/80">
            Your season is over — spectate or fast-forward to the champion.
          </span>
        </div>
      {/if}

      {#if nextGame?.kind === 'integrity-failure'}
        <div
          role="alert"
          class="mt-3 rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm"
        >
          Something went wrong scheduling the next game. Refresh to try again.
        </div>
      {:else}
        <div class="mt-4">
          <PostseasonMatchupCard
            series={seriesContext}
            playInCard={playInContext}
            franchiseName={shell.franchiseName}
            franchiseAbbrev={shell.franchiseAbbrev}
            manifest={shell.manifest}
            {humanFranchiseId}
          />
        </div>
      {/if}

      {#if nextGame?.kind === 'game' && nextTeams !== null && humanPlaysNext && shell.editor !== null}
        <div class="mt-4">
          <PostseasonRotationPanel
            editor={shell.editor}
            disabled={postseasonBusy}
            onchange={() => undefined}
            faces={shell.facesByVersion}
            manifest={shell.manifest}
            effects={snapshot?.effects ?? null}
            summaries={snapshot?.summaries ?? []}
            targetGameId={nextGame.gameId}
            {matchupLabel}
            matchupDetail={nextGameLine}
            {rehabOptions}
            {selectedRehabInjuryId}
            onRehabSelect={(injuryId) => (selectedRehabInjuryId = injuryId)}
            failures={shell.editor?.validate() ?? []}
            rejectionMessage={postseasonCommandError}
            balance={run?.influence.balances[humanFranchiseId ?? ''] ?? 0}
            submitting={postseasonSubmitting}
            canSubmit={canSubmitPostseason}
            onSubmit={() => void submitPostseasonRotation()}
          />
        </div>
      {:else if nextGame?.kind === 'game' && nextTeams !== null && eliminated}
        <section
          aria-labelledby="spectate-heading"
          data-season-spectate
          class="mt-4 rounded-xl border border-border bg-surface-1 p-4 sm:p-5"
        >
          <h2
            id="spectate-heading"
            class="font-display text-lg font-extrabold uppercase tracking-tight"
          >
            Watch the tournament
          </h2>
          <p class="mt-1 text-sm text-muted-foreground">
            Next game: {nextGameLine}. Spectate one game at a time, or fast-forward straight to the
            champion — nothing else needs a decision from you.
          </p>
          {#if postseasonCommandError !== null}
            <p
              role="alert"
              class="mt-3 rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm"
            >
              {postseasonCommandError}
            </p>
          {/if}
          <div class="mt-3 flex flex-col gap-2 sm:flex-row">
            <button
              type="button"
              data-season-spectate-next
              onclick={() => void spectateNext()}
              disabled={postseasonBusy || postseasonSubmitting}
              class="inline-flex items-center justify-center gap-2 rounded-lg bg-primary px-5 py-3 text-sm font-semibold text-primary-foreground transition-opacity outline-none focus-visible:ring-2 focus-visible:ring-ring hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
            >
              Spectate next game
            </button>
            <button
              type="button"
              data-season-fast-forward
              onclick={() => void fastForward()}
              disabled={postseasonBusy || postseasonSubmitting}
              class="inline-flex items-center justify-center gap-2 rounded-lg border border-border px-5 py-3 text-sm font-semibold text-muted-foreground transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
            >
              Fast-forward to champion
            </button>
          </div>
        </section>
      {:else if nextGame?.kind === 'game' && nextTeams !== null}
        <section
          aria-labelledby="advance-heading"
          data-season-advance
          class="mt-4 rounded-xl border border-border bg-surface-1 p-4 sm:p-5"
        >
          <h2
            id="advance-heading"
            class="font-display text-lg font-extrabold uppercase tracking-tight"
          >
            Your next decision is later
          </h2>
          <p class="mt-1 text-sm text-muted-foreground">
            The next game ({nextGameLine}) runs on AI rotations. Simulate ahead to your next lineup
            decision.
          </p>
          {#if postseasonCommandError !== null}
            <p
              role="alert"
              class="mt-3 rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm"
            >
              {postseasonCommandError}
            </p>
          {/if}
          <button
            type="button"
            data-season-advance-button
            onclick={() => void advanceToDecision()}
            disabled={postseasonBusy || postseasonSubmitting}
            class="mt-3 inline-flex items-center justify-center gap-2 rounded-lg bg-primary px-5 py-3 text-sm font-semibold text-primary-foreground transition-opacity outline-none focus-visible:ring-2 focus-visible:ring-ring hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {postseasonBusy ? 'Playing…' : 'Play to my next game'}
          </button>
        </section>
      {:else if nextGame?.kind === 'complete'}
        <p class="mt-4 text-sm text-muted-foreground">Season complete — see the champion above.</p>
      {/if}

      <div class="mt-4">
        <PostseasonProgress
          progress={shell.postseason}
          label="Postseason"
          onCancel={() => shell.cancelPostseason()}
          onRetry={() => retryPostseason()}
        />
      </div>

      {#if availabilityRows.length > 0}
        <div class="mt-4">
          <HealthStrip rows={availabilityRows} title="Playoff health" />
        </div>
      {/if}
    </section>
  {:else if stage === 'completed'}
    <section aria-labelledby="completed-hub-heading" class="px-3 sm:px-0">
      <ChampionSummary
        {championFranchiseId}
        franchiseName={shell.franchiseName}
        franchiseAbbrev={shell.franchiseAbbrev}
        manifest={shell.manifest}
        completion={run?.completion ?? null}
        humanWon={humanWonChampionship}
      />
      {#if recentBlocks.length > 0}
        <div class="mt-6">
          <h2 class="font-display text-base font-extrabold uppercase tracking-tight">
            Regular-season blocks
          </h2>
          <ul class="mt-2 flex flex-col gap-0 sm:gap-2">
            {#each recentBlocks as entry (entry.accepted.blockIndex)}
              <li>
                <a
                  href={resolve(
                    `/season/run/checkpoint/?block=${String(entry.accepted.blockIndex)}` as any,
                  )}
                  class="flex items-center justify-between gap-3 bg-surface-1 px-4 py-3 outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring hover:bg-surface-2 sm:rounded-xl"
                >
                  <span class="font-mono text-[10px] font-bold uppercase text-primary">
                    Block {entry.accepted.blockIndex + 1} of 9
                  </span>
                  {#if entry.record !== null}
                    <span class="font-mono text-xs font-bold">
                      {recordLabel(entry.record.wins, entry.record.losses)}
                    </span>
                  {/if}
                </a>
              </li>
            {/each}
          </ul>
        </div>
      {/if}
    </section>
  {/if}
</div>
