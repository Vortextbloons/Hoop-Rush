<script lang="ts">
  import { resolve } from '$app/paths';
  import type { RouteId } from '$app/types';
  import type { HoopRushManifest, SeasonRunCompletion } from '@hoop-rush/data-contracts';
  import { postseasonStageLabel } from '$lib/season/season-postseason-presentation';
  let {
    championFranchiseId,
    franchiseName,
    franchiseAbbrev,
    manifest,
    completion,
    humanWon,
  }: {
    championFranchiseId: string | null;
    franchiseName: (franchiseId: string) => string;
    franchiseAbbrev: (franchiseId: string) => string;
    manifest: HoopRushManifest | null;
    completion: SeasonRunCompletion | null;
    humanWon: boolean;
  } = $props();
</script>

<section
  aria-labelledby="champion-heading"
  data-season-champion
  class="sr-panel-featured sr-arrive p-5 sm:p-6"
>
  <p class="sr-eyebrow">
    Season complete · {postseasonStageLabel('completed')}
  </p>
  <h2 id="champion-heading" class="sr-page-title mt-2">
    {championFranchiseId !== null ? franchiseName(championFranchiseId) : 'Champion decided'}
    <span class="sr-only">won the championship</span>
  </h2>
  <p class="mt-2 text-sm text-muted-foreground">
    {humanWon
      ? 'You are the champion. Every game is recorded, the awards are final, and the run is saved to your history.'
      : `The ${championFranchiseId !== null ? franchiseAbbrev(championFranchiseId) : 'championship'} banner goes up. Your run is saved to your history.`}
  </p>
  <div class="mt-4 flex flex-wrap gap-2">
    <a href={resolve('/season/run/postseason' as any)} class="sr-btn"> View final bracket </a>
    <a href={resolve('/season/run/history' as any)} class="sr-btn-ghost"> Season history </a>
  </div>
</section>
