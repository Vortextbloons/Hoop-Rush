<script lang="ts">
  import {
    achievementTitleFor,
    collectionAchievementIdSchema,
    profileTitles,
    type AchievementId,
    type PlayerProfile,
  } from '@hoop-rush/data-contracts';
  import { Check, Trophy } from '@lucide/svelte';
  import { liveQuery } from 'dexie';
  import Button from '#lib/components/ui/Button.svelte';
  import { achievements, profileRepository } from './profile.js';

  let { bindingId, centered = false }: { bindingId: string; centered?: boolean } = $props();
  let unlocked = $state<{ id: AchievementId; evidence?: string }[]>([]);
  let boundProfile = $state<PlayerProfile | null>(null);
  let busyTitle = $state<PlayerProfile['title'] | null>(null);
  let titleError = $state<{ id: AchievementId; message: string } | null>(null);
  const collectionIds = new Set<AchievementId>(collectionAchievementIdSchema.options);
  const orderedUnlocks = $derived(
    unlocked.toSorted((left, right) => priority(right.id) - priority(left.id)),
  );

  function priority(id: AchievementId): number {
    const rarity = achievements[id].rarity;
    if (rarity === 'mythic') return 4;
    if (rarity === 'legendary') return 3;
    if (rarity === 'epic') return 2;
    return Number(collectionIds.has(id));
  }

  async function equip(id: AchievementId, title: Exclude<PlayerProfile['title'], 'none'>) {
    if (!boundProfile || busyTitle !== null) return;
    const profileId = boundProfile.id;
    busyTitle = title;
    titleError = null;
    try {
      boundProfile = await profileRepository().equipTitle(profileId, title);
    } catch (error) {
      titleError = {
        id,
        message: error instanceof Error ? error.message : 'Could not equip title.',
      };
    } finally {
      busyTitle = null;
    }
  }

  $effect(() => {
    const activeBindingId = bindingId;
    const subscription = liveQuery(async () => {
      const repository = profileRepository();
      const profile = await repository.loadBound(activeBindingId);
      const items = await repository.listAchievementReveals(activeBindingId);
      return { profile, items };
    }).subscribe({
      next: ({ profile, items }) => {
        boundProfile = profile;
        unlocked = items;
      },
    });
    return () => subscription.unsubscribe();
  });
</script>

{#snippet badge(id: AchievementId, evidence: string | undefined)}
  {@const achievement = achievements[id]}
  {@const Icon = achievement.icon ?? Trophy}
  {@const rewardTitle = achievementTitleFor(id)}
  <li
    class="reveal flex max-w-full items-start gap-2 rounded-lg border border-border bg-card px-3 py-2"
  >
    <span class="badge-icon mt-0.5" data-rarity={achievement.rarity}>
      <Icon class="size-4" aria-hidden="true" />
    </span>
    <div class="min-w-0 text-left text-sm">
      <div class="flex flex-wrap items-baseline gap-x-2">
        <span class="font-semibold">{achievement.name}</span>
        {#if achievement.rarity}
          <span class="text-xs capitalize text-muted-foreground">{achievement.rarity}</span>
        {/if}
      </div>
      <span class="block text-xs text-muted-foreground">{evidence ?? achievement.description}</span>
      {#if rewardTitle}
        {@const titleName = profileTitles[rewardTitle].name}
        {@const equipped = boundProfile?.title === rewardTitle}
        <div class="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1">
          <span class="text-xs text-muted-foreground">
            Title reward: <span class="font-semibold text-foreground">{titleName}</span>
          </span>
          {#if boundProfile?.achievements.includes(id)}
            {#if equipped}
              <span
                class="inline-flex items-center gap-1 text-xs font-semibold text-positive"
                role="status"
              >
                <Check class="size-3.5" aria-hidden="true" />
                Equipped
              </span>
            {:else}
              <Button
                size="sm"
                tone="secondary"
                class="min-h-0 px-2 py-1 text-[0.7rem]"
                loading={busyTitle === rewardTitle}
                disabled={busyTitle !== null}
                aria-label={`Equip title: ${titleName}`}
                onclick={() => void equip(id, rewardTitle)}>Equip title</Button
              >
            {/if}
          {/if}
          {#if titleError?.id === id}
            <p class="w-full text-xs text-destructive" role="alert">{titleError.message}</p>
          {/if}
        </div>
      {/if}
    </div>
  </li>
{/snippet}

<div role="status" aria-label="Achievements unlocked">
  {#if orderedUnlocks.length}
    <ul class="mt-3 flex flex-wrap gap-2" class:justify-center={centered}>
      {#each orderedUnlocks.slice(0, 2) as { id, evidence } (id)}
        {@render badge(id, evidence)}
      {/each}
    </ul>
  {/if}
</div>
{#if orderedUnlocks.length > 2}
  <details class="mt-2 text-xs text-muted-foreground">
    <summary class="cursor-pointer">+{orderedUnlocks.length - 2} more badges</summary>
    <ul class="mt-2 flex flex-wrap gap-2" class:justify-center={centered}>
      {#each orderedUnlocks.slice(2) as { id, evidence } (id)}
        {@render badge(id, evidence)}
      {/each}
    </ul>
  </details>
{/if}

<style>
  .badge-icon {
    display: grid;
    flex-shrink: 0;
    place-items: center;
  }

  .badge-icon:not([data-rarity]) {
    color: var(--color-primary);
  }

  .badge-icon[data-rarity] {
    position: relative;
    overflow: hidden;
    width: 1.75rem;
    height: 1.75rem;
    border: 1px solid var(--rarity-border);
    border-radius: 0.5rem;
    background: linear-gradient(145deg, var(--rarity-bg-start), var(--rarity-bg-end));
    color: var(--rarity-fg);
    box-shadow:
      inset 0 0 0 1px var(--rarity-inner),
      0 0 12px var(--rarity-glow);
  }

  .badge-icon[data-rarity='legendary'] {
    --rarity-fg: color-mix(in srgb, var(--color-accent) 78%, var(--color-foreground));
    --rarity-border: color-mix(in srgb, var(--color-accent) 55%, transparent);
    --rarity-bg-start: color-mix(in srgb, var(--color-accent) 16%, transparent);
    --rarity-bg-end: color-mix(in srgb, var(--color-primary) 7%, transparent);
    --rarity-inner: color-mix(in srgb, var(--color-accent) 16%, transparent);
    --rarity-glow: color-mix(in srgb, var(--color-accent) 22%, transparent);
    --rarity-shine: color-mix(in srgb, var(--color-accent) 42%, transparent);
  }

  .badge-icon[data-rarity='epic'] {
    --rarity-fg: color-mix(in srgb, hsl(199 90% 64%) 72%, var(--color-foreground));
    --rarity-border: hsl(199 85% 62% / 0.55);
    --rarity-bg-start: hsl(199 85% 62% / 0.16);
    --rarity-bg-end: hsl(230 75% 62% / 0.07);
    --rarity-inner: hsl(199 90% 85% / 0.12);
    --rarity-glow: hsl(199 85% 62% / 0.24);
    --rarity-shine: hsl(190 100% 92% / 0.6);
  }

  .badge-icon[data-rarity='mythic'] {
    --rarity-fg: color-mix(in srgb, hsl(274 85% 68%) 72%, var(--color-foreground));
    --rarity-border: hsl(274 80% 68% / 0.55);
    --rarity-bg-start: hsl(274 80% 68% / 0.17);
    --rarity-bg-end: hsl(318 75% 62% / 0.07);
    --rarity-inner: hsl(274 90% 85% / 0.12);
    --rarity-glow: hsl(274 80% 68% / 0.24);
    --rarity-shine: hsl(300 100% 92% / 0.6);
    outline: 1px solid hsl(318 78% 66% / 0.35);
    outline-offset: -4px;
  }

  .badge-icon[data-rarity]::after {
    position: absolute;
    inset: -75%;
    content: '';
    background: linear-gradient(115deg, transparent 38%, var(--rarity-shine) 50%, transparent 62%);
    opacity: 0;
    pointer-events: none;
    transform: translateX(-140%) rotate(10deg);
  }

  @media (prefers-reduced-motion: no-preference) {
    .reveal {
      animation: badge-appear 220ms ease-out both;
    }

    .badge-icon[data-rarity]::after {
      animation: badge-shimmer 760ms ease-out 160ms both;
    }
  }

  @keyframes badge-appear {
    from {
      opacity: 0;
      transform: translateY(3px);
    }
  }

  @keyframes badge-shimmer {
    0% {
      opacity: 0;
      transform: translateX(-140%) rotate(10deg);
    }

    18% {
      opacity: 1;
    }

    55% {
      opacity: 0.55;
    }

    100% {
      opacity: 0;
      transform: translateX(140%) rotate(10deg);
    }
  }
</style>
