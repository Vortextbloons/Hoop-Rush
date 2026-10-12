<script lang="ts">
  import type { HavocLineupSlotView } from '@hoop-rush/application/havoc';
  import HavocPlayerArt from './HavocPlayerArt.svelte';
  import HavocTierBadge from './HavocTierBadge.svelte';
  import { mutationEntriesSummary } from './havoc-presentation';
  let {
    slots,
    title = 'Your starting five',
  }: { slots: readonly HavocLineupSlotView[]; title?: string } = $props();
</script>

<section class="h-panel" aria-label={title} data-havoc-lineup>
  <h2 class="h-subtitle">{title}</h2>
  <ul class="h-lineup">
    {#each slots as slot (slot.slot)}<li>
        <div class="flex items-center justify-between gap-2">
          <span class="h-eyebrow">{slot.slot}</span><HavocTierBadge tier={slot.tier} size="sm" />
        </div>
        <HavocPlayerArt
          playerId={slot.playerId}
          franchiseId={slot.franchiseId}
          seasonKey={slot.seasonKey}
          playerVersionId={slot.playerVersionId}
          displayName={slot.displayName}
        />
        <h3 class="h-lineup-name">{slot.nickname}</h3>
        <p class="h-copy text-xs">{slot.displayName}</p>
        <p class="h-copy text-xs mt-2" data-havoc-lineup-package>
          {mutationEntriesSummary(slot.mutations)}
        </p>
      </li>{/each}
  </ul>
  <details class="mt-2">
    <summary>What happens if a player fouls out?</summary>
    <p class="h-copy text-xs">
      At six personal fouls, an unmutated copy of the same player-season takes over. The replacement
      has no powers and stays in the game through further fouls.
    </p>
  </details>
</section>
