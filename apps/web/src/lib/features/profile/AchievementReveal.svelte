<script lang="ts">
  import type { AchievementId } from '@hoop-rush/data-contracts';
  import { liveQuery } from 'dexie';
  import { achievements, profileRepository } from './profile.js';
  let { bindingId }: { bindingId: string } = $props();
  let unlocked = $state<AchievementId[]>([]);
  $effect(() => {
    const subscription = liveQuery(() => profileRepository().listUnlocks(bindingId)).subscribe({
      next: (items) => {
        unlocked = items;
      },
    });
    return () => subscription.unsubscribe();
  });
</script>

{#if unlocked.length}
  <section
    class="mx-auto my-6 max-w-6xl rounded-2xl border border-primary bg-card p-6"
    aria-label="Achievements unlocked"
  >
    <p class="text-sm font-bold uppercase tracking-widest text-primary">Achievement unlocked</p>
    {#each unlocked as id (id)}
      <div class="mt-4">
        <h2 class="font-display text-2xl font-bold">{achievements[id].name}</h2>
        <p class="text-muted-foreground">{achievements[id].description}</p>
        <p class="mt-1 text-sm font-semibold">{achievements[id].reward}</p>
      </div>
    {/each}
  </section>
{/if}
