<script lang="ts">
  import type { AchievementId } from '@hoop-rush/data-contracts';
  import { Trophy } from '@lucide/svelte';
  import { liveQuery } from 'dexie';
  import { achievements, profileRepository } from './profile.js';
  let { bindingId, centered = false }: { bindingId: string; centered?: boolean } = $props();
  let unlocked = $state<{ id: AchievementId; evidence?: string }[]>([]);
  $effect(() => {
    const subscription = liveQuery(() =>
      profileRepository().listAchievementReveals(bindingId),
    ).subscribe({
      next: (items) => {
        unlocked = items;
      },
    });
    return () => subscription.unsubscribe();
  });
</script>

<div role="status" aria-label="Achievements unlocked">
  {#if unlocked.length}
    <ul class="mt-3 flex flex-wrap gap-2" class:justify-center={centered}>
      {#each unlocked as { id, evidence } (id)}
        {@const achievement = achievements[id]}
        {@const Icon = achievement.icon ?? Trophy}
        <li
          class="reveal flex max-w-full items-center gap-2 rounded-lg border border-border bg-card px-3 py-2"
        >
          <Icon class="size-4 shrink-0 text-primary" aria-hidden="true" />
          <div class="text-left text-sm">
            <span class="font-semibold">{achievement.name}</span>
            <span class="block text-xs text-muted-foreground"
              >{evidence ?? achievement.description}</span
            >
          </div>
        </li>
      {/each}
    </ul>
  {/if}
</div>

<style>
  @media (prefers-reduced-motion: no-preference) {
    .reveal {
      animation: badge-appear 220ms ease-out both;
    }
  }

  @keyframes badge-appear {
    from {
      opacity: 0;
      transform: translateY(3px);
    }
  }
</style>
