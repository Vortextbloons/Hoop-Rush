<script lang="ts">
  import { goto } from '$app/navigation';
  import { resolve } from '$app/paths';
  import type { ChallengeRun } from '@hoop-rush/data-contracts';
  import { variantLabel } from '$lib/draft-presentation';
  import { clearClassicDraftState } from '$lib/classic-draft';
  import ResultPage from '$lib/components/ResultPage.svelte';

  /**
   * Classic challenge result: the shared SeasonReport record with classic
   * mode identity and the League MVP spotlight. The single Run again action
   * clears any draft state and returns to the Classic variant picker for a
   * fresh seed and five new rounds.
   */

  /** Fresh start: clears any draft state and returns to the variant picker. */
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
