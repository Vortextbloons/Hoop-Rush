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
  class="rounded-none border border-primary/40 bg-gradient-to-b from-primary/15 to-surface-1 p-5 sm:rounded-xl sm:p-6"
>
  <p class="font-mono text-xs font-bold uppercase tracking-[0.2em] text-primary">
    Season complete · {postseasonStageLabel('completed')}
  </p>
  <h2
    id="champion-heading"
    class="font-display mt-2 text-3xl font-extrabold uppercase tracking-tight sm:text-4xl"
  >
    {championFranchiseId !== null ? franchiseName(championFranchiseId) : 'Champion decided'}
    <span class="sr-only">won the championship</span>
  </h2>
  <p class="mt-2 text-sm text-muted-foreground">
    {humanWon
      ? 'You are the champion. Every game is recorded, the awards are final, and the run is saved to your history.'
      : `The ${championFranchiseId !== null ? franchiseAbbrev(championFranchiseId) : 'championship'} banner goes up. Your run is saved to your history.`}
    {#if completion !== null}
      <span class="ml-1 font-mono text-[10px]">
        state {String(completion.finalizedAtStateRevision)}
      </span>
    {/if}
  </p>
  <div class="mt-4 flex flex-wrap gap-2">
    <a
      href={resolve('/season/run/postseason' as RouteId)}
      class="inline-flex items-center justify-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition-opacity outline-none focus-visible:ring-2 focus-visible:ring-ring hover:opacity-90"
    >
      View final bracket
    </a>
    <a
      href={resolve('/season/run/history' as RouteId)}
      class="inline-flex items-center justify-center gap-2 rounded-lg border border-border px-4 py-2 text-sm font-semibold text-muted-foreground transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring hover:text-foreground"
    >
      Season history
    </a>
  </div>
</section>
