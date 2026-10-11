<script lang="ts">
  import { resolve } from '$app/paths';
  import { Zap, ArrowRight, Trophy } from '@lucide/svelte';
  import type { HavocDraftController } from '$lib/havoc/havoc-draft-state.svelte';
  import HavocDraftBoard from './HavocDraftBoard.svelte';
  let {
    controller,
    franchiseName,
    onLocked,
  }: {
    controller: HavocDraftController;
    franchiseName?: (id: string) => string;
    onLocked: () => void;
  } = $props();
  const run = $derived(controller.run);
  const draft = $derived(controller.draft);
  async function lock() {
    if (await controller.lockLineup()) onLocked();
  }
</script>

<section class="h-shell" data-havoc-setup>
  {#if controller.loading}
    <p class="h-copy" aria-live="polite">Getting the draft room ready…</p>
  {:else if draft !== null && run?.phase !== 'run'}
    <HavocDraftBoard
      {draft}
      busy={controller.busy}
      error={controller.error}
      {franchiseName}
      onReroll={() => void controller.reroll()}
      onPick={(id) => void controller.pick(id)}
      onLock={() => void lock()}
    />
  {:else if run?.phase === 'run'}
    <div class="h-panel">
      <p class="h-eyebrow">Your squad is ready</p>
      <h1 class="h-title">
        {run.havocCursor >= 82 ? 'The results are in.' : 'Back to the havoc.'}
      </h1>
      <p class="h-copy mt-4">
        {run.havocCursor} of 82 games completed. Your lineup and progress are saved.
      </p>
      <div class="h-actions mt-6">
        {#if run.comparisonStatus === 'complete'}<button
            class="h-button"
            disabled={controller.busy}
            onclick={() => void controller.createDraft()}>Draft another squad</button
          >{/if}<a
          class="h-button secondary"
          href={resolve(run.havocCursor >= 82 ? '/havoc/result' : '/havoc/run')}
          >{run.havocCursor >= 82 ? 'See season report' : 'Continue season'}
          <ArrowRight size={18} /></a
        ><a class="h-link" href={resolve('/havoc/history')}>Hall of Freaks</a>
      </div>
    </div>
  {:else}
    <div class="h-header">
      <p class="h-eyebrow">Hoop Havoc · Anything but ordinary</p>
      <a class="h-link" href={resolve('/havoc/history')}>Hall of Freaks</a>
    </div>
    <div class="h-intro">
      <div>
        <h1 class="h-title">Real legends.<br /><span>Unreal powers.</span></h1>
        <p class="h-copy mt-6">
          Build a starting five with outrageous basketball mutations. Send them into an 82-game
          season. See just how far your freaks can go.
        </p>
        <div class="h-actions mt-8">
          <button
            class="h-button"
            data-havoc-start
            disabled={controller.busy}
            onclick={() => void controller.createDraft()}
            ><Zap size={18} />{controller.busy ? 'Opening draft…' : 'Draft your squad'}</button
          >
        </div>
      </div>
      <div class="h-challenge">
        <Trophy size={48} strokeWidth={1.5} /><span class="h-eyebrow"
          >The perfect season challenge</span
        ><strong>82–0</strong>
        <p>Five players. Thirty opponents.<br />One impossible-looking mission.</p>
      </div>
    </div>
    <ol class="h-steps">
      <li><strong>1</strong> Pick five powered-up legends</li>
      <li><strong>2</strong> Launch your automatic season</li>
      <li><strong>3</strong> Reveal your squad's final report</li>
    </ol>
    <details class="h-panel">
      <summary>How does Havoc work?</summary>
      <p class="h-copy">
        Choose one player for each position, PG through C. Every card has powers and tradeoffs. You
        get one reroll for the entire draft. No guarantees: rarer powers can backfire. Once your
        five are locked, the full season simulates automatically, followed by the same season
        without powers so you can compare the results.
      </p>
    </details>
  {/if}
  {#if controller.error !== null}<div role="alert" class="h-alert">
      {controller.error}<button
        class="h-button secondary mt-3"
        onclick={() => void controller.load()}>Try again</button
      >
    </div>{/if}
</section>

<style>
  .h-intro {
    display: grid;
    grid-template-columns: 1.5fr 1fr;
    gap: 48px;
    align-items: center;
    padding: 32px 0;
  }
  h1 span {
    color: #f290c5;
  }
  .h-challenge {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 18px;
    background: #20294c;
    border: 2px solid #ffd782;
    border-radius: 50% 50% 24px 24px;
    padding: 48px 24px;
    color: #ffd782;
    text-align: center;
    transform: rotate(3deg);
  }
  .h-challenge strong {
    font-family: var(--font-display);
    font-size: 6rem;
    font-weight: 900;
    line-height: 1;
  }
  .h-challenge p {
    color: #c1cae4;
    font-size: 14px;
  }
  @media (max-width: 760px) {
    .h-intro {
      grid-template-columns: 1fr;
      gap: 28px;
    }
    .h-challenge {
      transform: none;
      padding: 28px;
      border-radius: 24px;
    }
  }
</style>
