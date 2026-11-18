<script lang="ts">
  import type { HavocDraftState } from '@hoop-rush/data-contracts';
  import { HAVOC_REROLL_LIMIT } from '@hoop-rush/data-contracts';
  import { Shuffle, Rocket } from '@lucide/svelte';
  import HavocDraftCard from './HavocDraftCard.svelte';
  import HavocLineupLock from './HavocLineupLock.svelte';
  import { havocLineupSlotsFromPicks } from '@hoop-rush/application/havoc';
  import { havocOwnedExclusiveMutationIds } from './havoc-presentation';
  import Button from '#lib/components/ui/Button.svelte';
  import Alert from '#lib/components/ui/Alert.svelte';
  let {
    draft,
    busy,
    error,
    franchiseName,
    onReroll,
    onPick,
    onLock,
  }: {
    draft: HavocDraftState;
    busy: boolean;
    error: string | null;
    franchiseName?: (id: string) => string;
    onReroll: () => void;
    onPick: (id: string) => void;
    onLock: () => void;
  } = $props();
  let mode = $state<'effective' | 'original'>('effective');
  const complete = $derived(draft.status === 'complete');
  const slots = $derived(havocLineupSlotsFromPicks(draft.picks));
  const positions = ['PG', 'SG', 'SF', 'PF', 'C'];
  const ownedExclusive = $derived(havocOwnedExclusiveMutationIds(draft.picks));
  const cardUnavailable = (card: HavocDraftState['cards'][number]): boolean =>
    card.mutations.some((entry) => ownedExclusive.has(entry.mutationId));
</script>

<div data-havoc-draft-board>
  <header class="h-header">
    <div>
      <p class="h-eyebrow">Hoop Havoc · Draft night</p>
      <h1 class="h-title mt-2">{complete ? 'Meet your freaks.' : `Pick your ${draft.slot}.`}</h1>
    </div>
    <ol class="h-draft-progress" aria-label="Draft progress">
      {#each positions as position, i (position)}<li
          class:chosen={i < draft.picks.length}
          aria-current={i === draft.picks.length ? 'step' : undefined}
        >
          {position}<span>{i < draft.picks.length ? '✓' : i + 1}</span>
        </li>{/each}
    </ol>
  </header>
  {#if !complete}
    <div class="h-actions">
      <Button
        tone="secondary"
        data-havoc-reroll
        onclick={onReroll}
        disabled={busy || draft.rerollUsed}><Shuffle size={16} />New choices</Button
      ><span class="h-copy text-xs" data-havoc-rerolls-remaining
        >{draft.rerollUsed ? 0 : 1} of {HAVOC_REROLL_LIMIT} reroll{draft.rerollUsed ? 's' : ''} left</span
      >
    </div>
    <section aria-label="Current offer">
      <ul class="h-cards">
        {#each draft.cards as card (card.cardId)}<li class="flex min-w-0">
            <HavocDraftCard
              {card}
              {mode}
              {busy}
              {franchiseName}
              {onPick}
              unavailable={cardUnavailable(card)}
            />
          </li>{/each}
      </ul>
    </section>
    <details class="mt-4">
      <summary>Compare original player ratings</summary>
      <div class="h-actions" role="group" aria-label="Attribute view">
        <Button
          tone="secondary"
          aria-pressed={mode === 'effective'}
          onclick={() => (mode = 'effective')}>Effective</Button
        ><Button
          tone="secondary"
          aria-pressed={mode === 'original'}
          onclick={() => (mode = 'original')}>Original</Button
        >
      </div>
      <p class="h-copy text-xs mt-2">Expand a card's attributes to inspect the numbers.</p>
    </details>
  {/if}
  {#if slots.length > 0}<div class="mt-6">
      <HavocLineupLock {slots} title={complete ? 'Your starting five' : 'Your squad so far'} />
    </div>{/if}
  {#if complete}<div class="h-actions mt-6">
      <Button data-havoc-lock onclick={onLock} disabled={busy}
        ><Rocket size={18} />{busy ? 'Launching…' : 'Launch 82-game season'}</Button
      >
      <p class="h-copy text-xs">All games play automatically. Your report comes next.</p>
    </div>{/if}
  {#if error !== null}<Alert tone="danger">{error}</Alert>{/if}
</div>

<style>
  .h-draft-progress {
    display: flex;
    gap: 8px;
  }
  .h-draft-progress li {
    display: flex;
    flex-direction: column;
    gap: 8px;
    align-items: center;
    padding: 12px;
    border-radius: 12px;
    background: #20294c;
    color: #aab9db;
    font-size: 12px;
    font-weight: 800;
  }
  .h-draft-progress li[aria-current='step'] {
    outline: 2px solid #ffd782;
    color: #ffd782;
  }
  .h-draft-progress .chosen {
    background: #679dff;
    color: #141b39;
  }
</style>
