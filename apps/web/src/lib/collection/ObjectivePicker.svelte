<script lang="ts">
  import type { CollectionObjectiveId } from '@hoop-rush/data-contracts';
  import type { ObjectiveOptionView } from './collection-setup.ts';

  let {
    options,
    value,
    disabled = false,
    legend = 'Objective',
    onChange,
  }: {
    options: ObjectiveOptionView[];
    value: CollectionObjectiveId | null;
    disabled?: boolean;
    legend?: string;
    onChange: (objectiveId: CollectionObjectiveId | null) => void;
  } = $props();
</script>

<fieldset {disabled}>
  <legend class="font-display text-sm font-extrabold tracking-wide uppercase">{legend}</legend>
  <p class="mt-1 text-xs text-muted-foreground">
    The objective changes rewards only. It never changes the opponent or the simulation.
  </p>
  <div class="mt-2 grid gap-3 sm:grid-cols-2">
    {#each options as option (option.objectiveId ?? 'no-objective')}
      {@const selected = option.objectiveId === value}
      <label class="relative block">
        <input
          type="radio"
          name="collection-objective"
          value={option.objectiveId ?? 'no-objective'}
          checked={selected}
          {disabled}
          onchange={() => onChange(option.objectiveId)}
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
          <span class="pr-20 font-display text-base font-extrabold tracking-tight">
            {option.title}
          </span>
          <span class="mt-1 text-xs leading-snug text-muted-foreground">
            {option.conditionLabel}
          </span>
          <span class="mt-2 text-xs font-bold text-accent">
            {option.coinBonus === null
              ? 'No objective bonus'
              : `Potential bonus: +${option.coinBonus} Coins`}
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
