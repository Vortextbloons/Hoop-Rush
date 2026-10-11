<script lang="ts">
  import type { HavocLineupSlotView } from '@hoop-rush/data-contracts';
  import HavocTierBadge from './HavocTierBadge.svelte';
  import { mutationEntriesSummary } from './havoc-presentation';

  let { slots, title = 'Locked lineup' }: { slots: readonly HavocLineupSlotView[]; title?: string } =
    $props();
</script>

<section aria-labelledby="havoc-lineup-heading" class="min-w-0 rounded-xl bg-surface-1" data-havoc-lineup>
  <div class="border-b border-border/70 px-4 py-3">
    <h2
      id="havoc-lineup-heading"
      class="font-display text-base font-extrabold tracking-tight uppercase"
    >
      {title}
    </h2>
    <p class="mt-1 text-xs text-muted-foreground">
      Emergency replacement rule: if a starter fouls out at six personal fouls, an unmutated copy
      of the same player-season takes the floor. That replacement owns no mutations, gains no
      powers, and stays in the game through further fouls.
    </p>
  </div>
  <ul class="divide-y divide-border/60">
    {#each slots as slot (slot.slot)}
      <li class="flex min-w-0 flex-wrap items-start gap-x-3 gap-y-1 px-4 py-3">
        <span
          class="w-8 shrink-0 pt-0.5 font-mono text-xs font-bold tracking-[0.12em] text-muted-foreground uppercase"
        >
          {slot.slot}
        </span>
        <div class="min-w-0 flex-1">
          <p class="flex flex-wrap items-center gap-2">
            <span class="font-display text-base font-extrabold tracking-tight uppercase"
              >{slot.nickname}</span
            >
            <HavocTierBadge tier={slot.tier} size="sm" />
          </p>
          <p class="truncate text-xs text-muted-foreground">
            {slot.displayName} · Overall {slot.overall}
          </p>
          <p class="mt-0.5 text-xs text-muted-foreground" data-havoc-lineup-package>
            {mutationEntriesSummary(slot.mutations)}
          </p>
        </div>
      </li>
    {/each}
  </ul>
</section>
