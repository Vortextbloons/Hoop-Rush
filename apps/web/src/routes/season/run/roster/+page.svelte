<script lang="ts">
  import { getContext } from 'svelte';
  import SeasonRosterList from '$lib/components/season/SeasonRosterList.svelte';
  import {
    SEASON_RUN_SHELL_CONTEXT,
    type SeasonRunShellData,
  } from '$lib/season/season-shell-context';
  import type { SeasonGameSummary } from '@hoop-rush/data-contracts';

  /**
   * Season Run roster tab (M2.4): the human franchise's ten drafted
   * player-season versions with historical identity, OVR, current rotation
   * role/minutes, the recorded fatigue band + workload, and last-game
   * minutes. The chemistry panel shows the active-lineup chemistry and the
   * strongest/weakest recorded pairs.
   */

  const shell = getContext<SeasonRunShellData>(SEASON_RUN_SHELL_CONTEXT);

  const run = $derived(shell.run);
  const humanFranchiseId = $derived(shell.humanFranchiseId);
  const manifest = $derived(shell.manifest);
  const effects = $derived(shell.snapshot?.effects ?? null);

  const roster = $derived(
    run !== null && humanFranchiseId !== null
      ? (run.rosters.find((r) => r.franchiseId === humanFranchiseId) ?? null)
      : null,
  );

  const editorRows = $derived(shell.editor?.rows() ?? []);

  function roleOf(playerVersionId: string): { role: string; minutes: number | string } {
    const row = editorRows.find((r) => r.member.playerVersionId === playerVersionId);
    return { role: row?.role ?? '—', minutes: row?.minutes ?? '—' };
  }

  /** Accepted summaries of the last block (last-game minutes per player). */
  let summaries: SeasonGameSummary[] = $state([]);

  $effect(() => {
    const hub = shell.hub;
    const activeRunId = shell.snapshot?.run.runId ?? null;
    const accepted = shell.snapshot?.acceptedBlocks ?? [];
    if (hub === null || activeRunId === null || accepted.length === 0) {
      summaries = [];
      return;
    }
    const lastBlock = accepted[accepted.length - 1];
    if (lastBlock === undefined) {
      summaries = [];
      return;
    }
    void hub.loadBlockSummaries(activeRunId, lastBlock.blockIndex).then((rows) => {
      summaries = rows;
    });
  });
</script>

<svelte:head>
  <title>Season Run — Roster — Hoop Rush</title>
</svelte:head>

<div
  class="flex min-w-0 flex-col gap-4 pt-6 pb-[calc(5.25rem+env(safe-area-inset-bottom))] md:pb-6"
>
  {#if roster === null || run === null || humanFranchiseId === null || manifest === null}
    <p class="px-3 font-mono text-sm text-muted-foreground sm:px-0">Loading the roster…</p>
  {:else}
    <section aria-labelledby="roster-heading" class="min-w-0 px-3 sm:px-0">
      <p class="font-mono text-xs tracking-[0.16em] text-primary uppercase">Season Run · roster</p>
      <h1
        id="roster-heading"
        class="font-display mt-1 text-2xl font-extrabold tracking-tight uppercase sm:text-3xl"
      >
        Roster
      </h1>
      <p class="mt-1 font-mono text-[10px] text-muted-foreground">
        Ten player-season versions · role and minutes reflect the pending rotation · fatigue bands
        reflect the last accepted block
      </p>
      <div class="mt-4">
        <SeasonRosterList {roster} {manifest} {shell} {roleOf} {effects} {summaries} />
      </div>
    </section>
  {/if}
</div>
