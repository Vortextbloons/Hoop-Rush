<script lang="ts">
  import { getContext } from 'svelte';
  import { resolve } from '$app/paths';
  import type { RouteId } from '$app/types';
  import { blockRoundRange } from '@hoop-rush/data-contracts';
  import BlockProgress from '$lib/components/season/BlockProgress.svelte';
  import InfluencePanel from '$lib/components/season/InfluencePanel.svelte';
  import InterruptionPanel from '$lib/components/season/InterruptionPanel.svelte';
  import ObjectivePicker from '$lib/components/season/ObjectivePicker.svelte';
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
    objectiveChoicesViewModel,
    type InfluenceSpendAffordance,
  } from '$lib/season/season-influence-view';
  import {
    openWindowOf,
    tradeOfferViewModel,
    humanTradeOffersOf,
  } from '$lib/season/season-trade-view';
  import type { SeasonRunCommandError } from '$lib/season/season-hub-state';

  /** The trade panel chunk loads only when a trade window is open. */
  let tradeOffersModule: Promise<
    typeof import('$lib/components/season/TradeOffersPanel.svelte')
  > | null = null;
  function loadTradeOffersPanel(): Promise<
    typeof import('$lib/components/season/TradeOffersPanel.svelte')
  > {
    tradeOffersModule ??= import('$lib/components/season/TradeOffersPanel.svelte');
    return tradeOffersModule;
  }

  /**
   * Season Run hub tab (M2.3.5, M2.5): season tape, the next-decision panel
   * (next opponents, pending rotation changes, the objective picker, compact
   * lock preview, the simulate-block action, and live block progress), the
   * trade-offers and Influence panels (M2.5), and a recent-recap
   * affordance. Block submission routes through the shell-owned
   * `SeasonHubState`; envelope construction and validation live in
   * `season-block-submit.ts`. When an invalid-roster interruption pauses the
   * block, the hub renders the typed recovery panel instead of the
   * next-decision flow.
   */

  const shell = getContext<SeasonRunShellData>(SEASON_RUN_SHELL_CONTEXT);

  const run = $derived(shell.run);
  const snapshot = $derived(shell.snapshot);
  const humanFranchiseId = $derived(shell.humanFranchiseId);
  const nextBlockIndex = $derived(shell.nextBlockIndex);
  const seasonComplete = $derived(shell.seasonComplete);
  const block = $derived(shell.block);
  const blockLabel = $derived.by(() => {
    if (nextBlockIndex === null || seasonComplete) return '';
    const { fromRound, toRound } = blockRoundRange(nextBlockIndex);
    return `Block ${String(nextBlockIndex + 1)} of 9 · rounds ${String(fromRound)}–${String(toRound)}`;
  });

  // M2.5 interruption/pending mirrors.
  const pending = $derived(shell.pending);
  const interruption = $derived(shell.interruption);
  const commandError = $derived(shell.commandError);
  const blockPaused = $derived(pending !== null || interruption !== null);

  // M2.5 Influence + objective + trade panel facts.
  const openWindow = $derived(
    run?.trade !== null && run?.trade !== undefined ? openWindowOf(run.trade) : null,
  );
  const influenceVm = $derived(
    shell.influence !== null && humanFranchiseId !== null
      ? influenceViewModel(shell.influence, humanFranchiseId, shell.health, openWindow)
      : null,
  );
  const tradeOffers = $derived.by(() => {
    const currentRun = shell.run;
    const franchiseId = shell.humanFranchiseId;
    if (currentRun === null || franchiseId === null) return [];
    // stateRevision bumps on every between-block command (trades included).
    void currentRun.stateRevision;
    const offers = humanTradeOffersOf(currentRun.trade, franchiseId);
    return offers.map((offer) =>
      tradeOfferViewModel(offer, currentRun, shell.catalog, shell.franchiseName),
    );
  });
  const objectiveVm = $derived(run !== null ? objectiveChoicesViewModel(run) : null);

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
    // A plain Map snapshot (not SvelteMap): rebuilt on every refresh.
    // eslint-disable-next-line svelte/prefer-svelte-reactivity
    const map = new Map<string, string>();
    for (const roster of run?.rosters ?? []) {
      for (const entry of roster.players) map.set(entry.playerVersionId, entry.displayName);
    }
    return map;
  });

  /** M2.5: the objective locked for the next block (shown in the lock preview). */
  const selectedObjective = $derived.by(() => {
    if (run === null || nextBlockIndex === null || nextBlockIndex >= 8) return null;
    const selection = run.objectives.selections[nextBlockIndex];
    if (selection === undefined) return null;
    const name =
      shell.objectives?.catalog.find((entry) => entry.objectiveId === selection.objectiveId)
        ?.name ?? selection.objectiveId;
    return { objectiveId: selection.objectiveId, name };
  });

  /** M2.4: build-time stamina ratings from the catalog (constant per catalog). */
  const staminaByVersion = $derived.by(() => {
    const catalog = shell.catalog;
    // eslint-disable-next-line svelte/prefer-svelte-reactivity
    const map = new Map<string, number>();
    for (const candidate of catalog?.candidates ?? []) {
      map.set(candidate.playerVersionId, candidate.stamina.rating);
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
    // M2.4: fatigue-risk projections need the recorded load state and the
    // build-time stamina ratings (from the catalog).
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
      objective: selectedObjective,
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
      const result = await buildSubmitBlockEnvelope(shell);
      if (!result.ok) {
        submitError = result.error.message;
        return;
      }
      shell.hub?.startBlock(result.envelope);
    } finally {
      submitting = false;
    }
  }

  function blockRecord(blockIndex: number): { wins: number; losses: number } | null {
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
</script>

<svelte:head>
  <title>Season Run — Hub — Hoop Rush</title>
</svelte:head>

<div class="flex min-w-0 flex-col gap-6 pt-6">
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
      class="flex flex-col gap-3 rounded-none bg-surface-1 p-4 sm:rounded-xl sm:p-5"
    >
      <h2
        id="season-complete-heading"
        class="font-display text-xl font-extrabold uppercase tracking-tight"
      >
        Regular season complete
      </h2>
      <p class="text-sm text-muted-foreground">
        All nine checkpoints are accepted. Review the final block recap and the full season
        standings.
      </p>
      <a
        href={resolve('/season/run/checkpoint/?block=8' as RouteId)}
        class="inline-flex w-fit items-center justify-center gap-2 rounded-lg bg-primary px-5 py-3 font-semibold text-primary-foreground transition-opacity outline-none focus-visible:ring-2 focus-visible:ring-ring hover:opacity-90"
      >
        Review final block recap
      </a>
    </section>
  {:else if snapshot !== null}
    {#if blockPaused}
      <!-- M2.5 interruption recovery: the block is paused with a pending candidate. -->
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
            Next decision
          </h2>
          <span class="font-mono text-[10px] text-muted-foreground">
            {nextBlockIndex === null ? '—' : `${String(nextBlockIndex)} of 9 checkpoints accepted.`}
          </span>
        </div>

        <!-- M2.5: objective picker (blocks 0-7) -->
        {#if objectiveVm !== null}
          {#if commandError !== null && commandError.command === 'select-block-objective'}
            <p
              role="alert"
              class="rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm"
            >
              {commandError.message}
            </p>
          {/if}
          <ObjectivePicker
            blockIndex={objectiveVm.blockIndex}
            choices={objectiveVm.choices}
            selectedObjectiveId={objectiveVm.selectedObjectiveId}
            busy={block.phase === 'running'}
            onSelect={(objectiveId) => {
              if (objectiveVm.blockIndex !== null) {
                shell.selectBlockObjective({ blockIndex: objectiveVm.blockIndex, objectiveId });
              }
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
              <p class="mt-2 text-sm text-muted-foreground">No human games in this block.</p>
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
              Pending rotation changes
            </h3>
            {#if preview === null}
              <p class="mt-2 text-sm text-muted-foreground">Preparing the lock preview…</p>
            {:else if preview.unchangedSinceLastLock}
              <p class="mt-2 text-sm text-muted-foreground">
                No rotation changes since the last checkpoint.
              </p>
            {:else if preview.changes.length === 0}
              <p class="mt-2 text-sm text-muted-foreground">
                No changes from the saved baseline rotation.
              </p>
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
              href={resolve('/season/run/team/' as RouteId)}
              class="mt-2 inline-flex items-center gap-1 text-sm font-semibold text-primary underline-offset-4 outline-none focus-visible:ring-2 focus-visible:ring-ring hover:underline"
            >
              Adjust rotation
              <span aria-hidden="true">&rarr;</span>
            </a>
          </div>

          <!-- (c) Fatigue risk + continuity (M2.4, projection only) -->
          {#if preview !== null && preview.fatigueProjections.length > 0}
            <div class="rounded-lg bg-surface-2 p-3">
              <h3
                class="font-mono text-[11px] font-bold uppercase tracking-[0.14em] text-muted-foreground"
              >
                Fatigue risk after {preview.gamesToLock === 1
                  ? '1 game'
                  : `${String(preview.gamesToLock)} games`}
              </h3>
              <ul class="mt-2 flex flex-col gap-1">
                {#each preview.fatigueProjections.slice(0, 5) as projection (projection.playerVersionId)}
                  <li class="flex items-center justify-between gap-2 text-sm">
                    <span class="min-w-0 truncate font-semibold">{projection.displayName}</span>
                    <span class="shrink-0 font-mono text-[10px] text-muted-foreground">
                      {projection.bandNow}
                      <span aria-hidden="true">&rarr;</span>
                      <span
                        class={projection.bandAfterBlock === 'Heavy' ||
                        projection.bandAfterBlock === 'Tired'
                          ? 'font-bold text-amber-600 dark:text-amber-400'
                          : 'font-bold text-foreground'}
                      >
                        {projection.bandAfterBlock}
                      </span>
                      {#if !projection.continuous}
                        <span class="ml-1 text-foreground">· continuity change</span>
                      {/if}
                    </span>
                  </li>
                {/each}
              </ul>
              <p class="mt-2 font-mono text-[9px] text-muted-foreground/70">
                Projected from the pending rotation's minutes and the recorded load; shared play and
                workload history change the actual outcome.
              </p>
            </div>
          {/if}

          <div class="rounded-lg bg-surface-2 p-3">
            <h3
              class="font-mono text-[11px] font-bold uppercase tracking-[0.14em] text-muted-foreground"
            >
              What locks
            </h3>
            {#if preview === null}
              <p class="mt-2 text-sm text-muted-foreground">Preparing…</p>
            {:else}
              <p class="mt-2 text-sm text-muted-foreground">
                Submitting locks the rotation set for
                <strong class="text-foreground">
                  {preview.gamesToLock === 1 ? '1 game' : `${String(preview.gamesToLock)} games`}
                </strong>
                (rounds {preview.roundRange.fromRound}–{preview.roundRange.toRound}).
              </p>
              {#if preview.objective !== null}
                <p class="mt-1 text-sm">
                  Objective:
                  <strong class="text-foreground">{preview.objective.name}</strong>
                  <span class="ml-1 font-mono text-[10px] text-muted-foreground">
                    locks into this block
                  </span>
                </p>
              {:else if nextBlockIndex !== null && nextBlockIndex < 8}
                <p class="mt-1 text-sm text-amber-600 dark:text-amber-400">
                  No objective selected yet — pick one above before submitting.
                </p>
              {/if}
              {#if preview.upcomingGames.length === 0}
                <p class="mt-2 text-sm text-muted-foreground">No human games scheduled.</p>
              {:else}
                <ol class="mt-1 flex flex-col gap-0.5">
                  {#each preview.upcomingGames.slice(0, 4) as game (game.gameId)}
                    <li class="flex items-center gap-2 text-sm">
                      <span class="w-10 shrink-0 font-mono text-[10px] text-muted-foreground">
                        R{game.round}
                      </span>
                      <span class="min-w-0 flex-1 truncate">
                        {game.humanIsHome ? 'vs' : 'at'}
                        {shell.franchiseName(game.opponentFranchiseId)}
                      </span>
                    </li>
                  {/each}
                </ol>
                {#if preview.upcomingGames.length > 4}
                  <p class="mt-1 font-mono text-[10px] text-muted-foreground">
                    +{preview.upcomingGames.length - 4} more in this block
                  </p>
                {/if}
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
              The rotation is invalid — fix the highlighted issues on the Rotation tab before
              submitting.
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
            class="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-primary px-5 py-3 text-sm font-semibold text-primary-foreground transition-opacity outline-none focus-visible:ring-2 focus-visible:ring-ring hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40 sm:text-base"
          >
            {block.phase === 'running'
              ? 'Simulating block…'
              : submitting
                ? 'Preparing block…'
                : 'Lock rotation and simulate block'}
          </button>
          <p class="hidden font-mono text-[10px] text-muted-foreground sm:block">
            Nothing is saved until the block completes.
          </p>
        </div>

        <BlockProgress
          {block}
          label={blockLabel}
          onCancel={() => shell.cancelBlock()}
          onRetry={() => shell.retryBlock()}
        />
      </section>
    {/if}

    <!-- M2.5: trade offers panel (open window) -->
    {#if openWindow !== null && shell.manifest !== null}
      {#await loadTradeOffersPanel() then { default: TradeOffersPanel }}
        <p class="px-3 py-3 font-mono text-xs text-muted-foreground sm:px-0">
          Loading trade offers…
        </p>
        <TradeOffersPanel
          windowIndex={openWindow.windowIndex}
          offers={tradeOffers}
          manifest={shell.manifest}
          catalog={shell.catalog}
          summaries={snapshot?.summaries ?? []}
          faceOf={(playerVersionId) => shell.facesByVersion.get(playerVersionId) ?? null}
          commandError={commandError !== null &&
          (commandError.command === 'accept-trade-offer' ||
            commandError.command === 'decline-trade-offer')
            ? commandError.message
            : null}
          busy={block.phase === 'running'}
          onAccept={(offerId) =>
            shell.acceptTradeOffer({ windowIndex: openWindow.windowIndex, offerId })}
          onDecline={(offerId) =>
            shell.declineTradeOffer({ windowIndex: openWindow.windowIndex, offerId })}
        />
      {/await}
    {/if}

    <!-- M2.5: Influence panel (balance, ledger, spend affordances) -->
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
          Recent checkpoints
        </h2>
        <ul class="mt-2 flex flex-col gap-0 sm:gap-2">
          {#each recentBlocks as entry (entry.accepted.blockIndex)}
            <li>
              <a
                href={resolve(
                  `/season/run/checkpoint/?block=${String(entry.accepted.blockIndex)}` as RouteId,
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
</div>
