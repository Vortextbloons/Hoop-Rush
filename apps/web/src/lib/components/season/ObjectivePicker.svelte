<script lang="ts">
  import type { SeasonObjectiveId } from '@hoop-rush/data-contracts';
  import type { ObjectiveChoiceViewModel } from '$lib/season/season-influence-view';
  let {
    blockIndex,
    choices,
    selectedObjectiveId,
    busy = false,
    onSelect,
  }: {
    blockIndex: number | null;
    choices: ObjectiveChoiceViewModel[];
    selectedObjectiveId: SeasonObjectiveId | null;
    busy?: boolean;
    onSelect: (objectiveId: SeasonObjectiveId) => void;
  } = $props();
  const finalBlock = $derived(blockIndex !== null && blockIndex >= 8);
  const summary = $derived(
    selectedObjectiveId !== null
      ? `Objective selected for block ${String((blockIndex ?? 0) + 1)}`
      : `Pick the block objective (${String(choices.length)} offered)`,
  );
</script>

<section
  aria-labelledby="objective-picker-heading"
  class="scroll-mb-24 rounded-lg bg-surface-2 p-3"
  data-season-objective-picker
>
  <div class="flex flex-wrap items-baseline justify-between gap-2">
    <h3
      id="objective-picker-heading"
      class="font-mono text-[11px] font-bold uppercase tracking-[0.14em] text-muted-foreground"
    >
      Block objective
    </h3>
    <span class="font-mono text-[10px] text-muted-foreground">
      {blockIndex === null ? 'No objective remains' : `Block ${String(blockIndex + 1)} of 9`}
    </span>
  </div>
  {#if finalBlock}
    <p class="mt-2 text-sm text-muted-foreground">
      The final two-game block has no objective — the objective reward applies to blocks 0-7 only.
    </p>
  {:else if blockIndex === null}
    <p class="mt-2 text-sm text-muted-foreground">Every block's objective is already selected.</p>
  {:else if choices.length === 0}
    <p class="mt-2 text-sm text-muted-foreground">Preparing the objective choices…</p>
  {:else}
    <p class="mt-2 text-sm text-muted-foreground">
      Success earns
      <strong class="text-foreground">+1 Influence</strong>
      for your franchise at block commit; failure awards nothing extra.
    </p>
    <div class="mt-2 flex flex-col gap-2" role="group" aria-label="Objective choices">
      {#each choices as choice (choice.objectiveId)}
        <button
          type="button"
          aria-pressed={choice.selected}
          disabled={busy || choice.selected}
          onclick={() => onSelect(choice.objectiveId)}
          class="flex min-w-0 flex-col gap-0.5 rounded-lg border px-3 py-2 text-left outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-60 {choice.selected
            ? 'border-primary bg-primary/10'
            : 'border-border bg-surface-1 hover:border-primary/50'}"
        >
          <span class="flex items-center justify-between gap-2">
            <span class="text-sm font-semibold">{choice.name}</span>
            {#if choice.selected}
              <span
                class="rounded-full bg-primary/15 px-2 py-0.5 font-mono text-[10px] font-bold uppercase tracking-[0.12em] text-primary"
              >
                Selected
              </span>
            {/if}
          </span>
          <span class="text-xs text-muted-foreground">{choice.description}</span>
          <span class="font-mono text-[10px] text-muted-foreground">{choice.measure}</span>
        </button>
      {/each}
    </div>
  {/if}
  <p class="sr-only" role="status" aria-live="polite">{summary}</p>
</section>
