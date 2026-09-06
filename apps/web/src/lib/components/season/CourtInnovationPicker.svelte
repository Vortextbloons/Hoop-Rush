<script lang="ts">
  import {
    SEASON_COURT_INNOVATION_CATALOG,
    type SeasonCourtInnovationId,
  } from '@hoop-rush/data-contracts';
  let {
    busy = false,
    commandError = null,
    onSelect,
  }: {
    busy?: boolean;
    commandError?: string | null;
    previews?: unknown | null;
    previewNote?: string | null;
    onSelect: (input: { innovationId: SeasonCourtInnovationId }) => void;
  } = $props();
  let selected: SeasonCourtInnovationId | null = $state(null);
  function choose(id: SeasonCourtInnovationId): void {
    if (busy) return;
    selected = id;
  }
  function confirm(): void {
    if (selected === null || busy) return;
    onSelect({ innovationId: selected });
  }
  function onCardKeydown(event: KeyboardEvent, id: SeasonCourtInnovationId): void {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      choose(id);
    }
  }
</script>

<section
  aria-labelledby="court-innovation-heading"
  id="court-innovation"
  class="rounded-lg bg-surface-2 p-4"
>
  <h2 id="court-innovation-heading" class="text-base font-extrabold uppercase tracking-tight">
    Home-court rule — required before Block 4
  </h2>
  <p class="mt-1 text-xs text-muted-foreground">
    One permanent rule for your home games for the rest of the season.
  </p>
  <div class="mt-3 grid gap-3 lg:grid-cols-3">
    {#each SEASON_COURT_INNOVATION_CATALOG as entry (entry.id)}
      {@const isSelected = selected === entry.id}
      <div
        role="radio"
        aria-checked={isSelected}
        tabindex={busy ? -1 : 0}
        onkeydown={(event) => onCardKeydown(event, entry.id)}
        onclick={() => choose(entry.id)}
        class="cursor-pointer rounded-xl border-2 bg-surface-1 p-4 outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring {isSelected
          ? 'border-primary'
          : 'border-border hover:border-line-strong'}"
      >
        <div class="text-xs font-bold">{entry.displayName}</div>
        <p class="mt-2 text-xs">{entry.description}</p>
        <p class="mt-1 text-xs text-muted-foreground">{entry.rosterImplication}</p>
        <button
          type="button"
          onclick={(event) => {
            event.stopPropagation();
            choose(entry.id);
          }}
          disabled={busy}
          aria-pressed={isSelected}
          class="mt-3 inline-flex min-h-11 w-full items-center justify-center rounded-lg border border-border px-4 text-xs font-semibold outline-none focus-visible:ring-2 focus-visible:ring-ring hover:border-line-strong disabled:cursor-not-allowed disabled:opacity-40"
        >
          {isSelected ? 'Picked' : 'Pick'}
        </button>
      </div>
    {/each}
  </div>
  {#if commandError}
    <p
      role="alert"
      class="mt-3 rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-xs"
    >
      {commandError}
    </p>
  {/if}
  <button
    type="button"
    onclick={confirm}
    disabled={selected === null || busy}
    class="mt-3 inline-flex min-h-11 items-center justify-center gap-2 rounded-lg bg-primary px-5 py-3 text-xs font-semibold text-primary-foreground transition-opacity outline-none focus-visible:ring-2 focus-visible:ring-ring hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
  >
    {busy ? 'Locking…' : selected === null ? 'Select a rule' : 'Lock rule'}
  </button>
</section>
