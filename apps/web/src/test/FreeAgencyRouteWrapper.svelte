<script lang="ts">import { setContext } from 'svelte';
import type { SeasonRunShellData } from '$lib/season/season-shell-context';
import { SEASON_RUN_SHELL_CONTEXT } from '$lib/season/season-shell-context';
import FreeAgencyPage from '../routes/season/run/free-agency/+page.svelte';
let { shell }: {
    shell: SeasonRunShellData;
} = $props();
function provideShell() {
    setContext(SEASON_RUN_SHELL_CONTEXT, shell);
}
provideShell();
</script>

<FreeAgencyPage />
