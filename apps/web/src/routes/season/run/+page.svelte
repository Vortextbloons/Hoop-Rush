<script lang="ts">
  import { getContext } from 'svelte';
  import { resolve } from '$app/paths';
  import type { RouteId } from '$app/types';
  import { blockRoundRange } from '@hoop-rush/data-contracts';
  import BlockProgress from '$lib/components/season/BlockProgress.svelte';
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

  /**
   * Season Run hub tab (M2.3.5): season tape, the next-decision panel (next
   * opponents, pending rotation changes, compact lock preview, the
   * simulate-block action, and live block progress), and a recent-recap
   * affordance. Block submission routes through the shell-owned
   * `SeasonHubState`; envelope construction and validation live in
   * `season-block-submit.ts`.
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
    return buildLockPreview({
      pendingHumanRotation: shell.editor.rotation,
      baselineHumanRotation: baseline,
      pendingSetDigest: pendingRotationSetDigest(run.rotations, shell.editor.rotation),
      lastLockedDigest,
      blockIndex: nextBlockIndex,
      names,
      games: run.games,
      humanFranchiseId,
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

  /** W-L of the human team inside one accepted block's round range. */
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

  const checkpointHref = $derived(`${resolve('/season/run/checkpoint/' as RouteId)}?block=8`);
  const blockHref = (blockIndex: number): string =>
    `${resolve('/season/run/checkpoint/' as RouteId)}?block=${String(blockIndex)}`;
</script>

<svelte:head>
  <title>Season Run — Hub — Hoop Rush</title>
</svelte:head>

<div class="flex flex-col gap-6 pt-6">
  <!-- 1. Season tape -->
  <section aria-labelledby="season-tape-heading">
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
    <!-- Regular season complete -->
    <section
      aria-labelledby="season-complete-heading"
      class="flex flex-col gap-3 rounded-xl bg-surface-1 p-6"
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
        href={checkpointHref}
        class="inline-flex w-fit items-center justify-center gap-2 rounded-lg bg-primary px-5 py-3 font-semibold text-primary-foreground transition-opacity outline-none focus-visible:ring-2 focus-visible:ring-ring hover:opacity-90"
      >
        Review final block recap
      </a>
    </section>
  {:else if snapshot !== null}
    <!-- 2. Next decision panel -->
    <section
      aria-labelledby="next-decision-heading"
      class="flex flex-col gap-4 rounded-xl border border-border bg-surface-1 p-4 sm:p-5"
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

      <div class="grid gap-4 lg:grid-cols-3">
        <!-- (a) Next opponents -->
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

        <!-- (b) Pending rotation changes -->
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
              No rotation changes since the last accepted block.
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

        <!-- (c) Compact lock preview -->
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

      <!-- (d) Simulate action + (e) live progress -->
      <div class="flex flex-col gap-3">
        {#if rotationFailures.length > 0}
          <p
            role="alert"
            class="rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm"
          >
            The rotation is invalid — fix the highlighted issues on the Team tab before submitting.
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
        <button
          type="button"
          onclick={() => void submitBlock()}
          disabled={!canSubmit || submitting}
          class="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-primary px-5 py-3 font-semibold text-primary-foreground transition-opacity outline-none focus-visible:ring-2 focus-visible:ring-ring hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {block.phase === 'running'
            ? 'Simulating block…'
            : submitting
              ? 'Preparing block…'
              : 'Lock rotation and simulate block'}
        </button>
        <p class="font-mono text-[10px] text-muted-foreground">
          Rejections are typed: stale cursor, duplicate command, invalid rotations, non-boundary
          block, or run mismatch. Nothing is persisted until the checkpoint passes validation.
        </p>
      </div>

      <BlockProgress
        {block}
        label={blockLabel}
        onCancel={() => shell.cancelBlock()}
        onRetry={() => shell.retryBlock()}
      />
    </section>

    <!-- 3. Recent recap affordance -->
    {#if recentBlocks.length > 0}
      <section aria-labelledby="recent-recaps-heading">
        <h2
          id="recent-recaps-heading"
          class="font-display text-base font-extrabold uppercase tracking-tight"
        >
          Recent checkpoints
        </h2>
        <ul class="mt-2 flex flex-col gap-2">
          {#each recentBlocks as entry (entry.accepted.blockIndex)}
            <li>
              <a
                href={blockHref(entry.accepted.blockIndex)}
                class="flex items-center justify-between gap-3 rounded-xl bg-surface-1 px-4 py-3 outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring hover:bg-surface-2"
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
