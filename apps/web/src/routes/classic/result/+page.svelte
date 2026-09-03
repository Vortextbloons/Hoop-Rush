<script lang="ts">
  import { goto } from '$app/navigation';
  import { resolve } from '$app/paths';
  import type { ChallengeRun } from '@hoop-rush/data-contracts';
  import { variantLabel } from '$lib/draft-presentation';
  import { clearClassicDraftState } from '$lib/classic-draft';
  import ResultPage from '$lib/components/ResultPage.svelte';
  async function runAgain() {
    await clearClassicDraftState();
    void goto(resolve('/classic'));
  }
</script>

<svelte:head>
  <title>Challenge result — Classic — Hoop Rush</title>
</svelte:head>

<ResultPage
  mode="classic"
  eyebrow="Classic · Result"
  modeLabelFor={(run: ChallengeRun | null) =>
    run ? `Classic · ${variantLabel(run.variant ?? 'ratings')}` : 'Classic'}
  onRunAgain={runAgain}
/>
