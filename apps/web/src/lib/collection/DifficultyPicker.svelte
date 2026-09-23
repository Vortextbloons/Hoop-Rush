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

<fieldset {disabled} class="ur-pick-field">
  <legend class="ur-pick-legend">{legend}</legend>
  <div class="mt-2 grid gap-3 lg:grid-cols-3">
    {#each options as option (option.difficultyId)}
      {@const selected = option.difficultyId === value}
      <label class="ur-pick-label">
        <input
          type="radio"
          name="collection-difficulty"
          value={option.difficultyId}
          checked={selected}
          {disabled}
          onchange={() => onChange(option.difficultyId)}
          class="peer sr-only"
        />
        <span class="ur-diff-card" data-selected={selected}>
          <span aria-hidden="true" class="ur-selected-flag" data-visible={selected}>
            ✓ Selected
          </span>
          <span class="ur-diff-name">
            {option.displayName}
          </span>
          <span class="ur-diff-mult">
            {option.rewardMultiplierLabel} Rewards
          </span>
          <span class="ur-diff-list">
            <span class="ur-diff-check"><i aria-hidden="true">✓</i>{option.bandLabel} band</span>
            <span class="ur-diff-check"><i aria-hidden="true">✓</i>{option.weightsLabel}</span>
            <span class="ur-diff-check"><i aria-hidden="true">✓</i>{option.constructionLabel}</span>
            <span class="ur-diff-check"><i aria-hidden="true">✓</i>{option.ratingShiftLabel}</span>
          </span>
          <span class="ur-diff-clear" data-claimed={option.firstClearClaimed}>
            {option.firstClearLabel}
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
  .ur-pick-label {
    position: relative;
    display: block;
    min-width: 0;
  }
  .ur-diff-card {
    position: relative;
    display: flex;
    height: 100%;
    flex-direction: column;
    gap: 0.15rem;
    padding: 0.95rem 0.95rem 0.9rem;
    border: 1px solid color-mix(in srgb, var(--ur-apex) 18%, var(--ur-line));
    border-radius: 0.7rem;
    background: linear-gradient(180deg, #141c21, #0b1114 78%);
    cursor: pointer;
    transition:
      border-color 140ms ease,
      box-shadow 140ms ease,
      transform 140ms ease;
  }
  .ur-diff-card:hover {
    border-color: color-mix(in srgb, var(--ur-apex) 45%, var(--ur-line));
  }
  .ur-diff-card[data-selected='true'] {
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
  .ur-diff-name {
    padding-right: 5.2rem;
    color: #fff;
    font-family: var(--font-display);
    font-size: 1.25rem;
    font-weight: 900;
    letter-spacing: -0.01em;
    line-height: 1;
  }
  .ur-diff-mult {
    color: var(--ur-paper);
    font-size: 0.78rem;
    font-weight: 800;
  }
  .ur-diff-card[data-selected='true'] .ur-diff-mult {
    color: #ffb37a;
  }
  .ur-diff-list {
    display: grid;
    gap: 0.32rem;
    margin-top: 0.6rem;
  }
  .ur-diff-check {
    display: flex;
    align-items: flex-start;
    gap: 0.45rem;
    color: var(--ur-muted);
    font-size: 0.74rem;
    line-height: 1.4;
  }
  .ur-diff-check i {
    display: grid;
    width: 1rem;
    height: 1rem;
    flex: none;
    place-items: center;
    margin-top: 0.1rem;
    border-radius: 999px;
    background: rgb(129 210 165 / 16%);
    color: var(--ur-success);
    font-size: 0.62rem;
    font-style: normal;
    font-weight: 900;
  }
  .ur-diff-card[data-selected='true'] .ur-diff-check {
    color: #d8d2c2;
  }
  .ur-diff-clear {
    margin-top: 0.6rem;
    padding-top: 0.55rem;
    border-top: 1px solid var(--ur-line);
    color: var(--ur-apex);
    font-size: 0.74rem;
    font-weight: 800;
  }
  .ur-diff-clear[data-claimed='true'] {
    color: var(--ur-muted);
    font-weight: 600;
  }
  input:focus-visible + .ur-diff-card {
    outline: 3px solid var(--ur-focus);
    outline-offset: 2px;
  }
  input:disabled + .ur-diff-card {
    cursor: not-allowed;
    opacity: 0.6;
  }
  @media (prefers-reduced-motion: reduce) {
    .ur-diff-card {
      transition: none;
    }
  }
</style>
