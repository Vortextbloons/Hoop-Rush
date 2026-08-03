<script lang="ts">
  const SLOT_LABELS = ['PG', 'SG', 'SF', 'PF', 'C'] as const;
  const SLOT_NAMES = [
    'Point Guard',
    'Shooting Guard',
    'Small Forward',
    'Power Forward',
    'Center',
  ] as const;

  let {
    slots,
    pickedCount,
    countLabel = null,
  }: {
    slots: ({ displayName: string } | null)[];
    pickedCount: number;
    countLabel?: string | null;
  } = $props();
</script>

<nav
  aria-label="Lineup summary"
  class="fixed inset-x-0 bottom-0 z-40 border-t border-border/80 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80"
>
  <div
    class="mx-auto flex w-full max-w-6xl items-center gap-3 px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:px-6"
  >
    <a
      href="#your-five"
      class="font-display text-sm font-extrabold tracking-tight uppercase transition-colors hover:text-primary"
    >
      Your five
    </a>
    <span class="flex gap-1 sm:gap-1.5">
      {#each SLOT_LABELS as label, slotIndex (slotIndex)}
        <a
          href="#court-slot-{slotIndex}"
          aria-label={`${SLOT_NAMES[slotIndex]} slot: ${slots[slotIndex]?.displayName ?? 'empty'}`}
          class="grid h-7 w-7 place-items-center rounded-md text-[10px] font-bold outline-none focus-visible:ring-2 focus-visible:ring-ring sm:h-8 sm:w-8 {slots[
            slotIndex
          ]
            ? 'bg-primary text-primary-foreground'
            : 'border border-border text-muted-foreground transition-colors hover:border-line-strong hover:text-foreground'}"
        >
          {label}
        </a>
      {/each}
    </span>
    <span class="ml-auto font-mono text-xs text-muted-foreground">
      {countLabel ?? `Picked ${pickedCount} of 5`}
    </span>
  </div>
</nav>
