<script lang="ts">
  import { setContext } from 'svelte';
  import type { SeasonRunShellData } from '$lib/season/season-shell-context';
  import { SEASON_RUN_SHELL_CONTEXT } from '$lib/season/season-shell-context';
  import FreeAgencyPage from '../routes/season/run/free-agency/+page.svelte';

  /**
   * TEST-ONLY wrapper: provides the Season Run shell context to the
   * free-agency route page so component tests can render each stage of the
   * market (declare, review/resolve, resolved history).
   */

  let { shell }: { shell: SeasonRunShellData } = $props();

  const context = $derived(shell);
  // svelte-check emits state_referenced_locally here; eslint's compiler
  // pass does not see it, so the eslint rule would flag the ignore.
  // eslint-disable-next-line svelte/no-unused-svelte-ignore
  // svelte-ignore state_referenced_locally -- test fixture: the shell is
  // replaced wholesale per render; no fine-grained reactivity is wanted.
  setContext(SEASON_RUN_SHELL_CONTEXT, context);
</script>

<FreeAgencyPage />
