<script lang="ts">
  import type { ChallengeRun } from '@hoop-rush/data-contracts';
  import { variantLabel } from '#lib/draft-presentation.js';
  import ChallengeRunView from '#lib/features/challenge/challenge-run-view.svelte';
</script>

<svelte:head>
  <title>Challenge in progress — Classic — Hoop Rush</title>
</svelte:head>

<ChallengeRunView
  mode="classic"
  modeLabelFor={(run: ChallengeRun | null) =>
    run ? `Classic · ${variantLabel(run.variant ?? 'ratings')}` : 'Classic'}
/>
