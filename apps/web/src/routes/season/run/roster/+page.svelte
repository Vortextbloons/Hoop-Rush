<script lang="ts">
  import { getContext } from 'svelte';
  import SeasonRosterList from '$lib/components/season/SeasonRosterList.svelte';
  import {
    SEASON_RUN_SHELL_CONTEXT,
    type SeasonRunShellData,
  } from '$lib/season/season-shell-context';

  /**
   * Season Run roster tab (M2.3.5): the human franchise's ten drafted
   * player-season versions with historical identity, OVR, and current rotation
   * role/minutes. Rotation editing lives on the Rotation tab.
   */

  const shell = getContext<SeasonRunShellData>(SEASON_RUN_SHELL_CONTEXT);

  const run = $derived(shell.run);
  const humanFranchiseId = $derived(shell.humanFranchiseId);
  const manifest = $derived(shell.manifest);

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
        Ten player-season versions · role and minutes reflect the pending rotation
      </p>
      <div class="mt-4">
        <SeasonRosterList {roster} {manifest} {shell} {roleOf} />
      </div>
    </section>
  {/if}
</div>
