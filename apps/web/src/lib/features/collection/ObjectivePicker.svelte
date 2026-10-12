<script lang="ts">
  import {
    Target,
    CircleSlash,
    Crosshair,
    Shield,
    Users,
    Hand,
    Trophy,
    Check,
  } from '@lucide/svelte';
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
  const icons: Record<CollectionObjectiveId, typeof Target> = {
    'obj-three-barrage-v1': Crosshair,
    'obj-lock-score-v1': Shield,
    'obj-bench-spark-v1': Users,
    'obj-ball-pressure-v1': Hand,
    'obj-own-glass-v1': Target,
    'obj-box-score-star-v1': Trophy,
  };
</script>

<fieldset {disabled} class="ur-pick-field">
  <legend class="sr-only">{legend}</legend>
  <p class="ur-pick-sub">Bonus coins only. Your opponent stays the same.</p>
  <div class="objective-grid">
    {#each options as option (option.objectiveId ?? 'no-objective')}
      {@const selected = option.objectiveId === value}
      {@const Icon =
        option.objectiveId === null ? CircleSlash : (icons[option.objectiveId] ?? Target)}
      <label class="ur-pick-label">
        <input
          type="radio"
          name="collection-objective"
          value={option.objectiveId ?? 'no-objective'}
          checked={selected}
          {disabled}
          onchange={() => onChange(option.objectiveId)}
          class="sr-only"
        />
        <span class="ur-obj-card" data-selected={selected}>
          <span class="objective-icon" aria-hidden="true"><Icon size={23} strokeWidth={1.7} /></span
          >
          <span class="ur-obj-bonus"
            >{option.coinBonus === null ? 'No bonus' : `+${option.coinBonus} Coins`}</span
          >
          <span class="ur-obj-title">{option.title}</span>
          <span class="ur-obj-cond">{option.conditionLabel}</span>
          <span class="selection-mark" aria-hidden="true"
            >{#if selected}<Check size={12} strokeWidth={3} />{/if}</span
          >
        </span>
      </label>
    {/each}
  </div>
</fieldset>

<style>
  .ur-pick-field {
    min-width: 0;
  }
  .ur-pick-sub {
    margin: 0 0 0.8rem;
    color: var(--ur-muted);
    font-size: 0.74rem;
  }
  .objective-grid {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 0.7rem;
  }
  .ur-pick-label {
    display: block;
    min-width: 0;
  }
  .ur-obj-card {
    position: relative;
    display: grid;
    grid-template-columns: 1fr auto;
    align-content: start;
    gap: 0.35rem;
    height: 100%;
    padding: 0.85rem 1rem;
    border: 1px solid var(--ur-line);
    border-radius: 0.6rem;
    background: #111921;
    cursor: pointer;
    transition:
      border-color 140ms ease,
      background 140ms ease;
  }
  .ur-obj-card:hover {
    border-color: #69d8ee;
  }
  .ur-obj-card[data-selected='true'] {
    border-color: #69d8ee;
    background: linear-gradient(120deg, rgb(105 216 238 / 12%), transparent), #111921;
    box-shadow: inset 3px 0 #69d8ee;
  }
  .objective-icon {
    color: #69d8ee;
    margin-bottom: 0.25rem;
  }
  .ur-obj-bonus {
    color: var(--ur-apex);
    font-size: 0.68rem;
    font-weight: 800;
    padding-top: 0.15rem;
  }
  .ur-obj-title {
    grid-column: 1 / -1;
    padding-right: 1.1rem;
    color: #fff;
    font-family: var(--font-display);
    font-size: 1.1rem;
  }
  .ur-obj-cond {
    grid-column: 1 / -1;
    color: var(--ur-muted);
    font-size: 0.7rem;
    line-height: 1.45;
    padding-right: 0.8rem;
  }
  .selection-mark {
    position: absolute;
    right: 0.65rem;
    bottom: 0.65rem;
    display: grid;
    place-items: center;
    width: 1rem;
    height: 1rem;
    border: 1px solid var(--ur-line-strong);
    border-radius: 50%;
  }
  [data-selected='true'] .selection-mark {
    background: #69d8ee;
    border-color: #69d8ee;
    color: #0c1118;
  }
  input:focus-visible + .ur-obj-card {
    outline: 3px solid var(--ur-focus);
    outline-offset: 3px;
  }
  input:disabled + .ur-obj-card {
    cursor: not-allowed;
    opacity: 0.6;
  }
  @media (max-width: 390px) {
    .ur-obj-card {
      padding: 0.7rem;
    }
    .ur-obj-bonus {
      font-size: 0.6rem;
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .ur-obj-card {
      transition: none;
    }
  }
</style>
