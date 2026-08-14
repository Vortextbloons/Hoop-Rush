<script lang="ts">
  import { setContext } from 'svelte';
  import type { SeasonRunShellData } from '$lib/season/season-shell-context';
  import { SEASON_RUN_SHELL_CONTEXT } from '$lib/season/season-shell-context';
  import CompletedSeasonResult from '$lib/components/season/CompletedSeasonResult.svelte';

  /**
   * TEST-ONLY wrapper: provides the Season Run shell context to the
   * completed-season result component so tests can render it without the
   * real layout.
   */

  let { shell, runId }: { shell: SeasonRunShellData; runId: string } = $props();

  const context = $derived(shell);
  // svelte-check emits state_referenced_locally here; eslint's compiler
  // pass does not see it, so the eslint rule would flag the ignore.
  // eslint-disable-next-line svelte/no-unused-svelte-ignore
  // svelte-ignore state_referenced_locally -- test fixture: the shell is
  // replaced wholesale per render; no fine-grained reactivity is wanted.
  setContext(SEASON_RUN_SHELL_CONTEXT, context);
</script>

<CompletedSeasonResult {runId} />
