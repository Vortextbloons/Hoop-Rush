<script lang="ts">
  import { SLOT_LABELS, SLOT_NAMES } from '$lib/player-positions';

  let {
    slots,
    pickedCount,
    countLabel = null,
  }: {
    slots: ({ displayName: string } | null)[];
    pickedCount: number;
    countLabel?: string | null;
  } = $props();

  const mobileCount = $derived(countLabel ?? `${pickedCount}/5`);
  const desktopCount = $derived(countLabel ?? `Picked ${pickedCount} of 5`);
</script>

<nav
  aria-label="Lineup summary"
  class="fixed inset-x-0 bottom-0 z-40 border-t border-border/80 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80"
>
  <div
    class="mx-auto w-full max-w-6xl px-3 pt-2.5 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:px-6 sm:pt-3"
  >
    <div class="flex items-center justify-between gap-2 sm:hidden">
      <a
        href="#your-five"
        class="font-display text-sm font-extrabold tracking-tight uppercase transition-colors hover:text-primary"
      >
        Your five
      </a>
      <span class="font-mono text-[10px] text-muted-foreground">{mobileCount}</span>
    </div>
    <div class="mt-2 flex items-center justify-between gap-1 sm:mt-0 sm:gap-3">
      <a
        href="#your-five"
        class="hidden shrink-0 font-display text-sm font-extrabold tracking-tight uppercase transition-colors hover:text-primary sm:inline"
      >
        Your five
      </a>
      <span
        class="flex min-w-0 flex-1 justify-between gap-0.5 sm:flex-none sm:justify-start sm:gap-1.5"
      >
        {#each SLOT_LABELS as label, slotIndex (slotIndex)}
          <a
            href="#court-slot-{slotIndex}"
            aria-label={`${SLOT_NAMES[slotIndex]} slot: ${slots[slotIndex]?.displayName ?? 'empty'}`}
            class="grid h-9 min-w-9 flex-1 place-items-center rounded-md text-[10px] font-bold outline-none focus-visible:ring-2 focus-visible:ring-ring sm:h-8 sm:w-8 sm:flex-none {slots[
              slotIndex
            ]
              ? 'bg-primary text-primary-foreground'
              : 'border border-border text-muted-foreground transition-colors hover:border-line-strong hover:text-foreground'}"
          >
            {label}
          </a>
        {/each}
      </span>
      <span class="ml-auto hidden shrink-0 font-mono text-xs text-muted-foreground sm:inline">
        {desktopCount}
      </span>
    </div>
  </div>
</nav>
