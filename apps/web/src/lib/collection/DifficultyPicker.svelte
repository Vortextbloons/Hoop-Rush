<script lang="ts">
  import type { CollectionDifficultyId } from '@hoop-rush/data-contracts';
  import type { DifficultyOptionView } from './collection-setup.ts';

  let {
    options,
    value,
    disabled = false,
    legend = 'Difficulty',
    onChange,
  }: {
    options: DifficultyOptionView[];
    value: CollectionDifficultyId;
    disabled?: boolean;
    legend?: string;
    onChange: (difficultyId: CollectionDifficultyId) => void;
  } = $props();
</script>

<fieldset {disabled}>
  <legend class="font-display text-sm font-extrabold tracking-wide uppercase">{legend}</legend>
  <div class="mt-2 grid gap-3 sm:grid-cols-3">
    {#each options as option (option.difficultyId)}
      {@const selected = option.difficultyId === value}
      <label class="relative block">
        <input
          type="radio"
          name="collection-difficulty"
          value={option.difficultyId}
          checked={selected}
          {disabled}
          onchange={() => onChange(option.difficultyId)}
          class="peer sr-only"
        />
        <span
          class="card flex h-full cursor-pointer flex-col rounded-xl border-2 border-border bg-surface-2 p-4 outline-none motion-reduce:transition-none"
        >
          <span
            aria-hidden="true"
            class="selected-badge absolute top-3 right-3 hidden items-center gap-1 rounded-full bg-primary px-2 py-0.5 font-mono text-[10px] font-bold tracking-[0.12em] text-primary-foreground uppercase"
          >
            ✓ Selected
          </span>
          <span class="font-display text-lg font-extrabold tracking-tight uppercase">
            {option.displayName}
          </span>
          <span
            class="mt-0.5 font-mono text-[11px] tracking-[0.12em] text-muted-foreground uppercase"
          >
            {option.bandLabel} · {option.rewardMultiplierLabel} rewards
          </span>
          <span class="mt-2 text-xs leading-snug text-muted-foreground">
            {option.weightsLabel}
          </span>
          <span class="mt-2 text-xs leading-snug">{option.constructionLabel}</span>
          <span class="mt-2 block text-xs leading-snug">
            <span class="font-bold">CPU adjustment:</span>
            {option.ratingShiftLabel}
          </span>
          <span
            class="mt-2 block text-xs leading-snug {option.firstClearClaimed
              ? 'text-muted-foreground'
              : 'font-bold text-accent'}"
          >
            {option.firstClearLabel}
          </span>
        </span>
      </label>
    {/each}
  </div>
</fieldset>

<style>
  input:checked + .card {
    border-color: var(--color-primary);
    background: color-mix(in srgb, var(--color-primary) 6%, var(--color-surface-2));
  }
  input:checked + .card .selected-badge {
    display: inline-flex;
  }
  input:focus-visible + .card {
    outline: 2px solid var(--color-ring);
    outline-offset: 2px;
  }
  input:disabled + .card {
    cursor: not-allowed;
    opacity: 0.6;
  }
  @media (prefers-reduced-motion: reduce) {
    .card {
      transition: none;
    }
  }
</style>
