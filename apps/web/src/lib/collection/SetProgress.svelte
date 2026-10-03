<script lang="ts">
  import { ArrowUpRight, Check, Layers, LockKeyhole } from '@lucide/svelte';
  import { asset } from '$app/paths';
  import CurrencyIcon from './CurrencyIcon.svelte';
  import type { SetProgressView } from './collection-progression-view.ts';

  let {
    views,
    title = 'Sets',
    blurb = 'Three four-card sets. Own every member to claim its one-time Exchange reward. Claiming never consumes or locks cards.',
    cardNameOf,
    cardArtOf = null,
    busySetId = null,
    onClaim,
    onInspect,
  }: {
    views: SetProgressView[];
    title?: string;
    blurb?: string;
    cardNameOf: (cardId: string) => string;
    cardArtOf?: ((cardId: string) => string | null) | null;
    busySetId?: string | null;
    onClaim: (setId: string) => void;
    onInspect: (cardId: string) => void;
  } = $props();

  function formatExchange(amount: number): string {
    return amount.toLocaleString('en-US');
  }

  function progressPercentage(owned: number, required: number): number {
    if (required <= 0) return 0;
    return Math.round(Math.min((owned / required) * 100, 100));
  }
</script>

<section aria-labelledby="collection-sets-heading" class="ur-set-progress-book">
  <header class="book-heading">
    <div class="heading-icon"><Layers size={22} aria-hidden="true" /></div>
    <div>
      <h2 id="collection-sets-heading">{title}</h2>
      <p>{blurb}</p>
    </div>
  </header>

  <ul class="set-list">
    {#each views as view (view.setId)}
      {@const status = view.claimed ? 'Claimed' : view.complete ? 'Complete' : 'Incomplete'}
      <li class="ur-set-entry" class:complete={view.complete}>
        <div class="set-overview">
          <div class="set-intro">
            <div class="set-kicker">
              <span>Collection set</span>
              <span class="status" class:ready={view.complete && !view.claimed}>{status}</span>
            </div>
            <h3>{view.title}</h3>
            <p>{view.description}</p>
          </div>
          <div class="set-progress">
            <p class="progress-label">
              <span><strong>{view.ownedCount}</strong> / {view.requiredCount} owned</span>
              <span>{progressPercentage(view.ownedCount, view.requiredCount)}%</span>
            </p>
            <div
              class="ur-set-meter"
              role="progressbar"
              aria-label={`${view.title} collection progress`}
              aria-valuemin="0"
              aria-valuemax={view.requiredCount}
              aria-valuenow={view.ownedCount}
              aria-valuetext={`${view.ownedCount} of ${view.requiredCount} cards owned`}
            >
              <span style:width={`${progressPercentage(view.ownedCount, view.requiredCount)}%`}
              ></span>
            </div>
            <p class="progress-note">
              {view.complete
                ? 'Every member collected'
                : `${view.missingCardIds.length} cards still to collect`}
            </p>
          </div>
        </div>

        <ul class="member-grid">
          {#each view.memberCardIds as cardId (cardId)}
            {@const owned = !view.missingCardIds.includes(cardId)}
            {@const fullName = cardNameOf(cardId)}
            {@const playerName = fullName.startsWith(`${view.title} `)
              ? fullName.slice(view.title.length + 1)
              : fullName}
            {@const artwork = cardArtOf?.(cardId) ?? null}
            <li class="member-slot" class:owned>
              <div class="member-topline">
                <span class="member-family">{view.title}</span>
                {#if owned}
                  <Check size={16} aria-hidden="true" />
                {:else}
                  <LockKeyhole size={14} aria-hidden="true" />
                {/if}
              </div>
              <div class="card-mark" aria-hidden="true">
                {#if artwork}
                  <img class="card-art" src={asset(artwork)} alt="" loading="lazy" />
                {:else}
                  {playerName
                    .split(' ')
                    .map((part) => part.charAt(0))
                    .slice(0, 2)
                    .join('')}
                {/if}
              </div>
              <p class="member-name">{playerName}</p>
              {#if owned}
                <span class="owned-label"><Check size={14} aria-hidden="true" /> Owned</span>
              {:else}
                <button
                  type="button"
                  onclick={() => onInspect(cardId)}
                  aria-label={`Inspect missing ${fullName}`}
                >
                  Inspect missing <ArrowUpRight size={15} aria-hidden="true" />
                </button>
              {/if}
            </li>
          {/each}
        </ul>

        <div class="reward-bar">
          <div class="reward-value">
            <CurrencyIcon currency={view.currency} size={40} />
            <div>
              <p class="reward-caption">Set completion reward</p>
              <p><strong>{formatExchange(view.amount)}</strong> <span>{view.currency}</span></p>
            </div>
          </div>
          <div class="reward-action">
            {#if view.complete && !view.claimed}
              <button
                type="button"
                class="claim-button"
                onclick={() => onClaim(view.setId)}
                disabled={busySetId !== null}
              >
                {busySetId === view.setId
                  ? 'Claiming…'
                  : `Claim ${formatExchange(view.amount)} ${view.currency}`}
                <ArrowUpRight size={17} aria-hidden="true" />
              </button>
              <p>One-time reward. Your cards stay yours.</p>
            {:else if view.claimed}
              <span class="claimed-label"
                ><Check size={16} aria-hidden="true" /> Reward claimed</span
              >
              <p>Every member card stays owned and usable.</p>
            {:else}
              <span class="reward-locked"
                ><LockKeyhole size={14} aria-hidden="true" /> Collect all {view.requiredCount} to unlock</span
              >
              <p>One-time reward. Cards are never consumed.</p>
            {/if}
          </div>
        </div>
      </li>
    {/each}
  </ul>
</section>

<style>
  .ur-set-progress-book {
    margin-top: 1.5rem;
    color: var(--ur-paper);
  }

  .book-heading {
    display: flex;
    align-items: flex-start;
    gap: 0.8rem;
    margin-bottom: 1.2rem;
  }

  .heading-icon {
    display: grid;
    place-items: center;
    width: 2.6rem;
    height: 2.6rem;
    flex-shrink: 0;
    border: 1px solid var(--ur-line);
    border-radius: 0.65rem;
    background: var(--ur-raised);
    color: var(--ur-apex);
  }

  h2,
  h3,
  .member-name,
  .card-mark,
  .reward-value strong {
    font-family: var(--font-display);
    font-weight: 800;
  }

  h2 {
    font-size: 1.65rem;
    line-height: 1;
  }
  .book-heading p {
    margin-top: 0.4rem;
    max-width: 75ch;
    font-size: 0.8rem;
    color: var(--ur-muted);
    line-height: 1.6;
  }
  .set-list {
    display: grid;
    gap: 1.2rem;
  }

  .ur-set-entry {
    overflow: hidden;
    min-width: 0;
    border: 1px solid var(--ur-line);
    border-radius: 0.9rem;
    background: var(--ur-raised);
  }

  .set-overview {
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(200px, 0.4fr);
    align-items: center;
    gap: 1.5rem;
    padding: 1.4rem 1.5rem;
    background: linear-gradient(
      110deg,
      color-mix(in srgb, var(--ur-ember) 13%, transparent),
      transparent 65%
    );
  }

  .set-kicker {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.75rem;
    font-size: 0.65rem;
    text-transform: uppercase;
    letter-spacing: 0.12em;
    color: var(--ur-muted);
    font-weight: 700;
  }
  .status {
    padding: 0.2rem 0.5rem;
    border: 1px solid var(--ur-line);
    border-radius: 0.3rem;
    background: var(--ur-surface);
    font-size: 0.6rem;
    letter-spacing: 0.05em;
  }
  .status.ready {
    color: var(--ur-success);
    border-color: var(--ur-success);
  }
  h3 {
    margin-top: 0.35rem;
    font-size: clamp(2rem, 3.5vw, 2.8rem);
    text-transform: uppercase;
    line-height: 1.1;
  }
  .set-intro > p {
    margin-top: 0.4rem;
    font-size: 0.8rem;
    line-height: 1.6;
    color: var(--ur-muted);
  }
  .progress-label {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    gap: 0.5rem;
    color: var(--ur-muted);
    font-size: 0.75rem;
    font-variant-numeric: tabular-nums;
  }
  .progress-label strong {
    font-size: 1.4rem;
    color: var(--ur-paper);
  }
  .progress-label > span:last-child {
    color: var(--ur-apex);
    font-family: var(--font-mono);
  }
  .ur-set-meter {
    height: 0.4rem;
    overflow: hidden;
    margin-top: 0.55rem;
    border-radius: 1rem;
    background: var(--ur-interrupt);
  }
  .ur-set-meter > span {
    display: block;
    height: 100%;
    background: linear-gradient(90deg, var(--ur-ember), var(--ur-apex));
    transition: width 180ms ease;
  }
  .progress-note {
    margin-top: 0.55rem;
    font-size: 0.7rem;
    color: var(--ur-muted);
  }

  .member-grid {
    display: grid;
    grid-template-columns: repeat(6, minmax(0, 1fr));
    gap: 0.75rem;
    padding: 1.25rem 1.5rem 1.5rem;
  }
  .member-slot {
    display: flex;
    flex-direction: column;
    min-width: 0;
    padding: 0.8rem;
    border: 1px dashed var(--ur-line-strong);
    border-radius: 0.5rem;
    background: var(--ur-bg);
  }
  .member-topline {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 0.4rem;
    color: var(--ur-muted);
  }
  .member-family {
    font-size: 0.55rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.1em;
  }
  .member-topline :global(svg) {
    flex-shrink: 0;
  }
  .card-mark {
    display: grid;
    place-items: center;
    min-height: 5.5rem;
    margin: 0.65rem 0;
    overflow: hidden;
    font-size: 3rem;
    font-style: italic;
    letter-spacing: -0.06em;
    color: var(--ur-line-strong);
    background: repeating-linear-gradient(
      135deg,
      transparent,
      transparent 8px,
      color-mix(in srgb, var(--ur-line) 18%, transparent) 8px,
      color-mix(in srgb, var(--ur-line) 18%, transparent) 9px
    );
    border-radius: 0.3rem;
  }
  .card-mark:has(.card-art) {
    padding: 0;
    background: var(--ur-bg);
  }
  .card-art {
    width: 100%;
    height: 100%;
    min-height: 5.5rem;
    aspect-ratio: 2 / 3;
    object-fit: cover;
    object-position: center 20%;
    display: block;
  }
  .member-slot:not(.owned) .card-art {
    filter: saturate(0.6) brightness(0.85);
  }
  .member-name {
    flex: 1;
    font-size: 1.2rem;
    line-height: 1.15;
    overflow-wrap: anywhere;
  }
  .member-slot button,
  .owned-label {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.3rem;
    margin-top: 0.75rem;
    min-height: 2.75rem;
    font-size: 0.65rem;
    font-weight: 600;
  }
  .member-slot button {
    width: 100%;
    color: var(--ur-paper);
    border-top: 1px solid var(--ur-line);
    cursor: pointer;
    text-align: left;
  }
  .member-slot button :global(svg) {
    flex-shrink: 0;
    color: var(--ur-apex);
  }
  .member-slot:has(button:hover) {
    border-color: var(--ur-apex);
    background: var(--ur-surface);
  }
  .member-slot button:hover {
    color: var(--ur-apex);
  }
  button:focus-visible {
    outline: 2px solid var(--ur-focus);
    outline-offset: 4px;
    border-radius: 0.2rem;
  }
  .member-slot.owned {
    border: 1px solid color-mix(in srgb, var(--ur-success) 50%, var(--ur-line));
  }
  .owned .card-mark {
    color: var(--ur-success);
  }
  .owned .member-topline,
  .owned-label,
  .claimed-label {
    color: var(--ur-success);
  }
  .owned-label {
    justify-content: flex-start;
  }

  .reward-bar {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: 1.2rem;
    padding: 1.1rem 1.5rem;
    border-top: 1px solid var(--ur-line);
    background: color-mix(in srgb, var(--ur-apex) 4%, var(--ur-bg));
  }
  .reward-value {
    display: flex;
    align-items: center;
    gap: 0.85rem;
  }

  .reward-caption {
    color: var(--ur-muted);
    font-size: 0.65rem;
  }
  .reward-value strong {
    color: var(--ur-apex);
    font-size: 2rem;
    line-height: 1.15;
    font-variant-numeric: tabular-nums;
  }
  .reward-value p > span {
    font-size: 0.8rem;
    color: var(--ur-apex);
  }
  .reward-action {
    text-align: right;
  }
  .reward-action > p {
    margin-top: 0.4rem;
    font-size: 0.65rem;
    line-height: 1.5;
    color: var(--ur-muted);
  }
  .reward-locked,
  .claimed-label {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    gap: 0.4rem;
    font-size: 0.75rem;
    font-weight: 600;
  }
  .reward-locked {
    color: var(--ur-paper);
  }
  .claim-button {
    display: flex;
    justify-content: center;
    align-items: center;
    gap: 0.75rem;
    min-height: 2.75rem;
    padding: 0.65rem 1.1rem;
    border-radius: 0.4rem;
    background: var(--ur-apex);
    color: var(--ur-accent-foreground);
    font-size: 0.8rem;
    font-weight: 700;
    cursor: pointer;
  }
  .claim-button:hover:not(:disabled) {
    background: var(--ur-immortal);
  }
  .claim-button:disabled {
    opacity: 0.5;
    cursor: wait;
  }

  @media (max-width: 1100px) {
    .member-grid {
      grid-template-columns: repeat(3, minmax(0, 1fr));
    }
  }
  @media (max-width: 600px) {
    .set-overview {
      grid-template-columns: minmax(0, 1fr);
      gap: 0.9rem;
      padding: 1.1rem;
    }
    .member-grid {
      grid-template-columns: repeat(2, minmax(0, 1fr));
      padding: 1.1rem;
      gap: 0.6rem;
    }
    .reward-bar {
      padding: 1.1rem;
    }
    .reward-action {
      width: 100%;
      text-align: left;
    }
    .reward-locked,
    .claimed-label {
      justify-content: flex-start;
    }
    .claim-button {
      width: 100%;
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .ur-set-meter > span {
      transition: none;
    }
  }
</style>
