<script lang="ts">
  import { resolve } from '$app/paths';
  import { Zap, ArrowRight } from '@lucide/svelte';
  import type { HavocDraftController } from './havoc-draft-state.svelte.js';
  import HavocDraftBoard from './HavocDraftBoard.svelte';
  import Button from '#lib/components/ui/Button.svelte';
  import ActionLink from '#lib/components/ui/ActionLink.svelte';
  import ActionRow from '#lib/components/ui/ActionRow.svelte';
  import Panel from '#lib/components/ui/Panel.svelte';
  import PageHeader from '#lib/components/ui/PageHeader.svelte';
  import Disclosure from '#lib/components/ui/Disclosure.svelte';
  import Alert from '#lib/components/ui/Alert.svelte';
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
    <Panel padding="md">
      <PageHeader
        eyebrow="Your squad is ready"
        title={run.havocCursor >= 82 ? 'The results are in.' : 'Back to the havoc.'}
        description={`${run.havocCursor} of 82 games completed. Your lineup and progress are saved.`}
      />
      <ActionRow class="mt-6">
        {#snippet primary()}
          {#if run.comparisonStatus === 'complete'}<Button
              disabled={controller.busy}
              onclick={() => void controller.createDraft()}>Draft another squad</Button
            >{/if}
        {/snippet}
        {#snippet secondary()}
          <ActionLink
            tone="secondary"
            href={resolve(run.havocCursor >= 82 ? '/havoc/result' : '/havoc/run')}
          >
            {run.havocCursor >= 82 ? 'View season report' : 'Resume season'}
            <ArrowRight size={18} />
          </ActionLink>
        {/snippet}
        {#snippet tertiary()}
          <ActionLink tone="ghost" href={resolve('havoc/history/')}>Run history</ActionLink>
        {/snippet}
      </ActionRow>
    </Panel>
  {:else}
    <PageHeader
      eyebrow="Hoop Havoc · Anything but ordinary"
      description="Build a starting five with outrageous basketball mutations. Send them into an 82-game season. See just how far your freaks can go."
    >
      {#snippet title()}Real legends.<br /><span>Unreal powers.</span>{/snippet}
      {#snippet actions()}
        <ActionLink tone="secondary" href={resolve('havoc/history/')}>Run history</ActionLink>
      {/snippet}
    </PageHeader>
    <ActionRow class="mt-8">
      {#snippet primary()}
        <Button
          data-havoc-start
          disabled={controller.busy}
          onclick={() => void controller.createDraft()}
        >
          <Zap size={18} />
          {controller.busy ? 'Opening draft…' : 'Draft your squad'}
        </Button>
      {/snippet}
    </ActionRow>
    <ol class="h-steps">
      <li><strong>1</strong> Pick five powered-up legends</li>
      <li><strong>2</strong> Launch your automatic season</li>
      <li><strong>3</strong> Reveal your squad's final report</li>
    </ol>
    <Disclosure summary="How does Havoc work?">
      <p class="h-copy">
        Choose one player for each position, PG through C. Every card has powers and tradeoffs. You
        get one reroll for the entire draft. No guarantees: rarer powers can backfire. Once your
        five are locked, the full season simulates automatically, followed by the same season
        without powers so you can compare the results.
      </p>
    </Disclosure>
  {/if}
  {#if controller.error !== null}<Alert tone="danger">
      {controller.error}<Button class="mt-3" tone="secondary" onclick={() => void controller.load()}
        >Try again</Button
      >
      {#if controller.isUnsupportedVersionError()}<Button
          class="mt-3"
          data-havoc-discard-stale
          onclick={() => void controller.discardStaleRun()}
          >Discard outdated run and start fresh</Button
        >{/if}
    </Alert>{/if}
</section>
