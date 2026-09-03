<script lang="ts">
  import type { HoopRushManifest, SeasonAwards } from '@hoop-rush/data-contracts';
  import { awardsViewModel } from '$lib/season/season-postseason-presentation';
  import type { SeasonFaceRef } from '$lib/season/season-branding';
  import SeasonPlayerFace from './SeasonPlayerFace.svelte';
  let {
    awards,
    playerName,
    franchiseName,
    manifest = null,
    faces = null,
  }: {
    awards: SeasonAwards;
    playerName: (playerVersionId: string) => string;
    franchiseName: (franchiseId: string) => string;
    manifest?: HoopRushManifest | null;
    faces?: ReadonlyMap<string, SeasonFaceRef> | null;
  } = $props();
  const view = $derived(awardsViewModel(awards, playerName, franchiseName));
  const faceOf = (playerVersionId: string): SeasonFaceRef | null => {
    const face = faces?.get(playerVersionId);
    return face ?? null;
  };
</script>

<section aria-labelledby="awards-heading" data-season-awards class="min-w-0">
  <h2 id="awards-heading" class="font-display text-base font-extrabold uppercase tracking-tight">
    Season awards
  </h2>
  <p class="mt-1 font-mono text-[10px] text-muted-foreground">
    Regular season only · 70% games required.
  </p>

  <ul class="mt-3 grid gap-3 sm:grid-cols-3">
    {#each view.awards as award (award.key)}
      <li data-season-award={award.key} class="rounded-xl border border-border bg-surface-1 p-4">
        <p class="font-mono text-[10px] font-bold uppercase tracking-[0.14em] text-primary">
          {award.title}
        </p>
        <div class="mt-2 flex items-center gap-2.5">
          {#if manifest !== null && faceOf(award.playerVersionId) !== null}
            <SeasonPlayerFace face={faceOf(award.playerVersionId)!} {manifest} size="md" />
          {/if}
          <span class="min-w-0">
            <span class="block truncate text-base font-bold">{award.playerName}</span>
            <span class="block font-mono text-[10px] text-muted-foreground">
              {award.franchiseLabel}
            </span>
          </span>
        </div>
      </li>
    {/each}
  </ul>

  <div class="mt-3 rounded-xl border border-border bg-surface-1 p-4">
    <p class="font-mono text-[10px] font-bold uppercase tracking-[0.14em] text-primary">
      All-League First Team · positionless
    </p>
    <ol class="mt-2 flex flex-col divide-y divide-border/50">
      {#each view.firstTeam as award (award.playerVersionId)}
        <li data-season-award="first-team" class="flex items-center gap-3 py-2">
          <span class="w-5 shrink-0 font-mono text-[10px] font-bold text-muted-foreground">
            {String(view.firstTeam.indexOf(award) + 1)}
          </span>
          {#if manifest !== null && faceOf(award.playerVersionId) !== null}
            <SeasonPlayerFace face={faceOf(award.playerVersionId)!} {manifest} size="sm" />
          {/if}
          <span class="min-w-0 flex-1 truncate text-sm font-semibold">
            {award.playerName}
          </span>
          <span class="shrink-0 font-mono text-[10px] text-muted-foreground">
            {award.franchiseLabel}
          </span>
        </li>
      {/each}
    </ol>
  </div>
</section>
