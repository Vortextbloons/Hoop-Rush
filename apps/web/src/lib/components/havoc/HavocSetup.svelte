<script lang="ts">
  import { resolve } from '$app/paths';
  import { Zap, ArrowRight } from '@lucide/svelte';
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
      {#if controller.isUnsupportedVersionError()}<button
          class="h-button mt-3"
          data-havoc-discard-stale
          onclick={() => void controller.discardStaleRun()}
          >Discard outdated run and start fresh</button
        >{/if}
    </div>{/if}
</section>

<style>
  .h-intro {
    padding: 32px 0;
  }
  h1 span {
    color: #f290c5;
  }
</style>
