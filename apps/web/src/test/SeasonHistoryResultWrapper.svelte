<script lang="ts">
  import { setContext } from 'svelte';
  import type { SeasonRunShellData } from '$lib/season/season-shell-context';
  import { SEASON_RUN_SHELL_CONTEXT } from '$lib/season/season-shell-context';
  import CompletedSeasonResult from '$lib/components/season/CompletedSeasonResult.svelte';
  let {
    shell,
    runId,
  }: {
    shell: SeasonRunShellData;
    runId: string;
  } = $props();
  function provideShell() {
    setContext(SEASON_RUN_SHELL_CONTEXT, shell);
  }
  provideShell();
</script>

<CompletedSeasonResult {runId} />
