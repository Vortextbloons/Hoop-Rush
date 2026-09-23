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

<fieldset {disabled} class="ur-pick-field">
  <legend class="ur-pick-legend">{legend}</legend>
  <p class="ur-pick-sub">The objective changes rewards only. It never changes the opponent.</p>
  <div class="mt-2 grid gap-3 lg:grid-cols-3">
    {#each options as option (option.objectiveId ?? 'no-objective')}
      {@const selected = option.objectiveId === value}
      <label class="ur-pick-label">
        <input
          type="radio"
          name="collection-objective"
          value={option.objectiveId ?? 'no-objective'}
          checked={selected}
          {disabled}
          onchange={() => onChange(option.objectiveId)}
          class="peer sr-only"
        />
        <span class="ur-obj-card" data-selected={selected}>
          <span aria-hidden="true" class="ur-selected-flag" data-visible={selected}>
            ✓ Selected
          </span>
          <span class="ur-obj-title">
            {option.title}
          </span>
          <span class="ur-obj-bonus">
            {option.coinBonus === null ? 'No bonus for this game' : `+${option.coinBonus} rewards`}
          </span>
          <span class="ur-obj-cond">
            {option.conditionLabel}
          </span>
        </span>
      </label>
    {/each}
  </div>
</fieldset>

<style>
  .ur-pick-field {
    min-width: 0;
  }
  .ur-pick-legend {
    color: var(--ur-muted);
    font-size: 0.68rem;
    font-weight: 800;
    letter-spacing: 0.16em;
    text-transform: uppercase;
  }
  .ur-pick-sub {
    margin-top: 0.3rem;
    color: var(--ur-muted);
    font-size: 0.74rem;
  }
  .ur-pick-label {
    position: relative;
    display: block;
    min-width: 0;
  }
  .ur-obj-card {
    position: relative;
    display: flex;
    height: 100%;
    flex-direction: column;
    gap: 0.2rem;
    padding: 0.95rem 0.95rem 0.9rem;
    border: 1px solid color-mix(in srgb, var(--ur-apex) 18%, var(--ur-line));
    border-radius: 0.7rem;
    background: linear-gradient(180deg, #141c21, #0b1114 78%);
    cursor: pointer;
    transition:
      border-color 140ms ease,
      box-shadow 140ms ease;
  }
  .ur-obj-card:hover {
    border-color: color-mix(in srgb, var(--ur-apex) 45%, var(--ur-line));
  }
  .ur-obj-card[data-selected='true'] {
    border-color: #ff7a2f;
    background:
      linear-gradient(180deg, rgb(255 122 47 / 14%), rgb(255 122 47 / 4%)),
      linear-gradient(180deg, #171310, #0e0c0a 78%);
    box-shadow:
      0 0 1.4rem rgb(255 110 30 / 22%),
      inset 0 1px 0 rgb(255 255 255 / 7%);
  }
  .ur-selected-flag {
    position: absolute;
    top: 0.6rem;
    right: 0.6rem;
    display: none;
    align-items: center;
    padding: 0.18rem 0.5rem;
    border-radius: 999px;
    background: #ff7a2f;
    color: #1d0e02;
    font-size: 0.6rem;
    font-weight: 900;
    letter-spacing: 0.06em;
    text-transform: uppercase;
  }
  .ur-selected-flag[data-visible='true'] {
    display: inline-flex;
  }
  .ur-obj-title {
    padding-right: 5.2rem;
    color: #fff;
    font-family: var(--font-display);
    font-size: 1.02rem;
    font-weight: 850;
    letter-spacing: -0.01em;
  }
  .ur-obj-bonus {
    color: var(--ur-apex);
    font-size: 0.76rem;
    font-weight: 800;
  }
  .ur-obj-card[data-selected='true'] .ur-obj-bonus {
    color: #ffb37a;
  }
  .ur-obj-cond {
    margin-top: 0.15rem;
    color: var(--ur-muted);
    font-size: 0.74rem;
    line-height: 1.45;
  }
  input:focus-visible + .ur-obj-card {
    outline: 3px solid var(--ur-focus);
    outline-offset: 2px;
  }
  input:disabled + .ur-obj-card {
    cursor: not-allowed;
    opacity: 0.6;
  }
  @media (prefers-reduced-motion: reduce) {
    .ur-obj-card {
      transition: none;
    }
  }
</style>
