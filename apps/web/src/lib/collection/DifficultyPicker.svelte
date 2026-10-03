<script lang="ts">
  import { Flame, Zap, Crown, Check, ChevronDown } from '@lucide/svelte';
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
  <legend class="sr-only">{legend}</legend>
  <div class="difficulty-grid">
    {#each options as option (option.difficultyId)}
      {@const selected = option.difficultyId === value}
      {@const Emblem =
        option.difficultyId === 'street' ? Flame : option.difficultyId === 'pro' ? Zap : Crown}
      <label class="ur-pick-label">
        <input
          type="radio"
          name="collection-difficulty"
          value={option.difficultyId}
          checked={selected}
          {disabled}
          onchange={() => onChange(option.difficultyId)}
          class="sr-only"
        />
        <span class="ur-diff-card" data-selected={selected} data-tier={option.difficultyId}>
          <span class="selection-mark" aria-hidden="true"
            >{#if selected}<Check size={13} strokeWidth={3} />{/if}</span
          >
          <span class="tier-art" aria-hidden="true">
            <span class="court-ring"></span><Emblem size={46} strokeWidth={1.7} />
            <span class="tier-pips"
              >{#each [0, 1, 2] as pip (pip)}<i
                  data-lit={pip === 0 ||
                    option.difficultyId === 'legend' ||
                    (pip === 1 && option.difficultyId === 'pro')}
                ></i>{/each}</span
            >
          </span>
          <span class="ur-diff-name">{option.displayName}</span>
          <span class="ur-diff-band">{option.bandLabel}</span>
          <span class="ur-diff-mult"
            ><strong>{option.rewardMultiplierLabel}</strong><span>coin multiplier</span></span
          >
          <span class="ur-diff-clear" data-claimed={option.firstClearClaimed}
            >{option.firstClearClaimed
              ? 'First clear claimed'
              : `+${option.firstClearCoins} first clear`}</span
          >
        </span>
      </label>
    {/each}
  </div>
</fieldset>
<details class="scouting-details">
  <summary><ChevronDown size={14} /> Opponent scouting report</summary>
  <div class="scouting-grid">
    {#each options as option (option.difficultyId)}
      <div>
        <h3>{option.displayName}</h3>
        <p>{option.weightsLabel}</p>
        <p>{option.constructionLabel}</p>
        <p>{option.ratingShiftLabel}</p>
      </div>
    {/each}
  </div>
</details>

<style>
  .ur-pick-field {
    min-width: 0;
  }
  .difficulty-grid {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 0.8rem;
  }
  .ur-pick-label {
    display: block;
    min-width: 0;
  }
  .ur-diff-card {
    --tier: #ff9352;
    position: relative;
    display: flex;
    height: 100%;
    flex-direction: column;
    align-items: center;
    overflow: hidden;
    padding: 1.1rem 0.75rem 0;
    border: 1px solid var(--ur-line);
    border-radius: 0.65rem;
    background: linear-gradient(160deg, #1d252c, #0c1118);
    cursor: pointer;
    transition:
      transform 160ms ease,
      border-color 160ms ease,
      box-shadow 160ms ease;
  }
  .ur-diff-card[data-tier='pro'] {
    --tier: #69d8ee;
  }
  .ur-diff-card[data-tier='legend'] {
    --tier: #be9aff;
  }
  .ur-diff-card:hover {
    transform: translateY(-3px);
    border-color: var(--tier);
  }
  .ur-diff-card[data-selected='true'] {
    border-color: var(--tier);
    background:
      radial-gradient(
        ellipse at 50% 20%,
        color-mix(in srgb, var(--tier) 19%, transparent),
        transparent 70%
      ),
      #101720;
    box-shadow:
      0 0 22px color-mix(in srgb, var(--tier) 12%, transparent),
      inset 0 3px var(--tier);
  }
  .selection-mark {
    position: absolute;
    right: 0.65rem;
    top: 0.65rem;
    display: grid;
    place-items: center;
    width: 1.1rem;
    height: 1.1rem;
    border: 1px solid var(--ur-line-strong);
    border-radius: 50%;
  }
  [data-selected='true'] .selection-mark {
    background: var(--tier);
    border-color: var(--tier);
    color: #0c1118;
  }
  .tier-art {
    position: relative;
    display: grid;
    place-items: center;
    height: 6.8rem;
    width: 100%;
    color: var(--tier);
  }
  .court-ring {
    position: absolute;
    width: 5.2rem;
    height: 5.2rem;
    border: 1px solid color-mix(in srgb, var(--tier) 30%, transparent);
    transform: rotate(45deg);
    border-radius: 1rem;
    background: color-mix(in srgb, var(--tier) 5%, transparent);
  }
  .tier-art :global(svg) {
    position: relative;
    filter: drop-shadow(0 0 12px color-mix(in srgb, var(--tier) 35%, transparent));
  }
  .tier-pips {
    position: absolute;
    bottom: 0;
    display: flex;
    gap: 0.3rem;
  }
  .tier-pips i {
    width: 1rem;
    height: 0.2rem;
    background: #344047;
    transform: skewX(-25deg);
  }
  .tier-pips i[data-lit='true'] {
    background: var(--tier);
  }
  .ur-diff-name {
    margin-top: 0.8rem;
    color: #fff;
    font-family: var(--font-display);
    font-size: 2rem;
    text-transform: uppercase;
    line-height: 1;
  }
  .ur-diff-band {
    margin-top: 0.35rem;
    color: var(--ur-muted);
    font-size: 0.7rem;
  }
  .ur-diff-mult {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.1rem;
    margin: 0.9rem 0;
  }
  .ur-diff-mult strong {
    color: var(--tier);
    font-family: var(--font-display);
    font-size: 1.7rem;
    line-height: 1;
  }
  .ur-diff-mult > span {
    color: var(--ur-muted);
    font-size: 0.6rem;
    text-transform: uppercase;
    letter-spacing: 0.1em;
  }
  .ur-diff-clear {
    width: calc(100% + 1.5rem);
    padding: 0.65rem 0.3rem;
    border-top: 1px solid var(--ur-line);
    background: rgb(0 0 0 / 20%);
    color: var(--ur-apex);
    text-align: center;
    font-size: 0.68rem;
    font-weight: 800;
  }
  .ur-diff-clear[data-claimed='true'] {
    color: var(--ur-muted);
    font-weight: 500;
  }
  input:focus-visible + .ur-diff-card {
    outline: 3px solid var(--ur-focus);
    outline-offset: 3px;
  }
  input:disabled + .ur-diff-card {
    cursor: not-allowed;
    opacity: 0.6;
    transform: none;
  }
  .scouting-details {
    margin-top: 0.7rem;
    color: var(--ur-muted);
    font-size: 0.72rem;
  }
  summary {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    width: fit-content;
    cursor: pointer;
    padding: 0.3rem 0;
  }
  summary:focus-visible {
    outline: 2px solid var(--ur-focus);
    outline-offset: 3px;
  }
  .scouting-grid {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 1rem;
    margin-top: 0.65rem;
    padding: 1rem;
    border: 1px solid var(--ur-line);
    border-radius: 0.5rem;
  }
  h3 {
    color: var(--ur-paper);
    font-weight: 800;
  }
  p {
    margin-top: 0.5rem;
    line-height: 1.5;
  }
  @media (max-width: 560px) {
    .difficulty-grid {
      gap: 0.4rem;
    }
    .ur-diff-card {
      padding: 0.9rem 0.3rem 0;
    }
    .tier-art {
      height: 5rem;
    }
    .court-ring {
      width: 3.5rem;
      height: 3.5rem;
    }
    .tier-art :global(svg) {
      width: 32px;
    }
    .ur-diff-name {
      font-size: 1.45rem;
    }
    .ur-diff-band {
      font-size: 0.6rem;
      text-align: center;
      min-height: 1.8rem;
    }
    .ur-diff-clear {
      width: calc(100% + 0.6rem);
      font-size: 0.6rem;
      min-height: 3rem;
    }
    .scouting-grid {
      grid-template-columns: 1fr;
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .ur-diff-card {
      transition: none;
    }
  }
</style>
