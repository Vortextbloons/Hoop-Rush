<script lang="ts">
  import type {
    FixedFiveCompetitionResult,
    FixedFiveWorkerResultEntry,
  } from '@hoop-rush/data-contracts';
  import { recordFixedFiveCareer } from './profile-results.js';
  import AchievementReveal from '#lib/features/profile/AchievementReveal.svelte';
  let {
    roomId,
    participant,
    result,
    entries,
    verified,
  }: {
    roomId: string;
    participant: 'p1' | 'p2';
    result: FixedFiveCompetitionResult;
    entries: FixedFiveWorkerResultEntry[];
    verified: boolean;
  } = $props();
  let recorded = $state(false);
  let error = $state('');
  $effect(() => {
    if (!verified) return;
    let cancelled = false;
    void recordFixedFiveCareer(roomId, participant, result, entries).then(
      () => {
        if (!cancelled) recorded = true;
      },
      (cause: unknown) => {
        if (!cancelled)
          error = cause instanceof Error ? cause.message : 'Could not save career progress.';
      },
    );
    return () => {
      cancelled = true;
    };
  });
</script>

{#if error}<p role="alert">{error}</p>{/if}
{#if recorded}<AchievementReveal bindingId={`fixed-five:${roomId}`} />{/if}
