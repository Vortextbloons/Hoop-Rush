<script lang="ts">
  import {
    SEASON_COURT_INNOVATION_CATALOG,
    type SeasonCourtInnovationId,
  } from '@hoop-rush/data-contracts';
  import type { InnovationEnvironmentPreview } from '$lib/season/season-innovation-preview';
  let {
    busy = false,
    commandError = null,
    previews = null,
    previewNote = null,
    onSelect,
  }: {
    busy?: boolean;
    commandError?: string | null;
    previews?: InnovationEnvironmentPreview[] | null;
    previewNote?: string | null;
    onSelect: (input: { innovationId: SeasonCourtInnovationId }) => void;
  } = $props();
  let selected: SeasonCourtInnovationId | null = $state(null);
  function previewFor(rule: string): InnovationEnvironmentPreview | null {
    return previews?.find((preview) => preview.rule === rule) ?? null;
  }
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

<section aria-labelledby="court-innovation-heading" class="rounded-lg bg-surface-2 p-4">
  <h3
    id="court-innovation-heading"
    class="font-display text-base font-extrabold uppercase tracking-tight"
  >
    Court Innovation — required before Block 4
  </h3>
  <p class="mt-1 text-sm text-muted-foreground">
    One permanent home-court rule for the rest of the run. It applies to both teams in your home
    games, including the Play-In and playoffs. AI franchises choose deterministically after Block 4.
  </p>
  <div class="mt-3 grid gap-3 lg:grid-cols-3">
    {#each SEASON_COURT_INNOVATION_CATALOG as entry (entry.id)}
      {@const preview = previewFor(entry.rule)}
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
        <div class="font-bold">{entry.displayName}</div>
        <p class="mt-2 text-sm">{entry.description}</p>
        <p class="mt-1 text-sm text-muted-foreground">{entry.rosterImplication}</p>
        {#if preview}
          <p class="mt-2 font-mono text-xs text-muted-foreground">
            Scoring environment: {preview.pointsPer100.toFixed(1)} pts/100 ({preview.adapterVersion})
          </p>
        {/if}
      </div>
    {/each}
  </div>
  {#if previewNote}
    <p class="mt-2 text-xs text-muted-foreground">{previewNote}</p>
  {/if}
  {#if commandError}
    <p
      role="alert"
      class="mt-3 rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm"
    >
      {commandError}
    </p>
  {/if}
  <button
    type="button"
    onclick={confirm}
    disabled={selected === null || busy}
    class="mt-3 inline-flex items-center justify-center gap-2 rounded-lg bg-primary px-5 py-3 font-semibold text-primary-foreground transition-opacity outline-none focus-visible:ring-2 focus-visible:ring-ring hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
  >
    {busy ? 'Locking…' : selected === null ? 'Select an innovation' : 'Lock innovation'}
  </button>
</section>
