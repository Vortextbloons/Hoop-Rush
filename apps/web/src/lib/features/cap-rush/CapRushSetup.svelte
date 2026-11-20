<script lang="ts">
  import { resolve } from '$app/paths';
  import type { CapRushDraftController } from './cap-rush-draft-state.svelte.js';
  import PageShell from '#lib/components/ui/PageShell.svelte';
  import PageHeader from '#lib/components/ui/PageHeader.svelte';
  import Alert from '#lib/components/ui/Alert.svelte';
  import ActionLink from '#lib/components/ui/ActionLink.svelte';
  import ActionRow from '#lib/components/ui/ActionRow.svelte';
  import ModeCard from '#lib/components/ui/ModeCard.svelte';
  import { Dices, Trophy } from '@lucide/svelte';

  let { controller }: { controller: CapRushDraftController } = $props();

  const variants = [
    {
      id: 'clash' as const,
      name: 'Cap Clash',
      description: 'Draft your five and manage the cap.',
      icon: Trophy,
    },
    {
      id: 'roulette' as const,
      name: 'Cap Roulette',
      description: 'Draft your five and buy mutation spins.',
      icon: Dices,
    },
  ];
</script>

<PageShell
  as="section"
  width="lg"
  padding="none"
  class="px-4 pt-10 pb-24 sm:px-6 md:pt-16 md:pb-12"
>
  <PageHeader eyebrow="Cap Rush">
    {#snippet title()}Build a contender.<br /><span class="text-primary">Mind the apron.</span
      >{/snippet}
    {#snippet actions()}
      <ActionRow>
        {#snippet secondary()}
          <ActionLink href={resolve('cap-rush/history/')} tone="secondary">Run history</ActionLink>
          <ActionLink href={resolve('/multiplayer?format=cap-rush')} tone="secondary"
            >Play multiplayer</ActionLink
          >
        {/snippet}
      </ActionRow>
    {/snippet}
  </PageHeader>

  <div class="mt-8 grid gap-4 md:grid-cols-2">
    {#each variants as variant (variant.id)}
      {@const Icon = variant.icon}
      <ModeCard
        title={variant.name}
        description={variant.description}
        cta={controller.busy ? 'Opening draft…' : `Start with ${variant.name}`}
        disabled={controller.busy}
        onclick={() => void controller.createDraft(variant.id)}
      >
        {#snippet icon()}<Icon size={22} aria-hidden="true" />{/snippet}
      </ModeCard>
    {/each}
  </div>

  {#if controller.error !== null}
    <Alert class="mt-5" tone="danger">
      {controller.error}
      {#if controller.error !== null}
        <button
          type="button"
          class="mt-3 inline-flex min-h-10 items-center rounded-lg border border-negative/50 px-3 text-xs font-bold uppercase"
          disabled={controller.busy}
          onclick={() => void controller.discard()}>Discard draft and start fresh</button
        >
      {/if}
    </Alert>
  {/if}
</PageShell>
