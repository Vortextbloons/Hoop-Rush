<script lang="ts">import type { SeasonCampaignEvaluation, SeasonCampaignState } from '@hoop-rush/data-contracts';
import { campaignTimelineViewModel, CAMPAIGN_FAMILY_LABELS, CAMPAIGN_IDENTITY_LABELS, CAMPAIGN_OUTCOME_LABELS, CAMPAIGN_REWARD_LABELS, formatCampaignCondition, formatCampaignReward, } from '$lib/season/season-presentation';
import type { SeasonRun } from '@hoop-rush/data-contracts';
import GmIdentityPicker from './GmIdentityPicker.svelte';
import EvolutionPicker from './EvolutionPicker.svelte';
let { run, nextBlockIndex, busy = false, commandError = null, onSelectIdentity, onSelectOpportunity, onEvolve, playerName = (id: string) => id, }: {
    run: SeasonRun | null;
    nextBlockIndex: number | null;
    busy?: boolean;
    commandError?: string | null;
    onSelectIdentity: (input: {
        identity: string;
        focus: string | null;
    }) => void;
    onSelectOpportunity: (input: {
        blockIndex: number;
        opportunityId: string;
    }) => void;
    onEvolve: (input: {
        offerId: string;
    }) => void;
    playerName?: (playerVersionId: string) => string;
} = $props();
const vm = $derived(run !== null ? campaignTimelineViewModel(run, nextBlockIndex) : null);
const campaign = $derived(run?.campaign as SeasonCampaignState | undefined);
const prior = $derived(vm?.priorEvaluation ?? null);
const priorRewardIds: string[] = $derived(prior ? prior.appliedRewardIds : []);
const priorFactsEntries = $derived(prior ? Object.entries(prior.facts ?? {}) : []);
const branchEntries = $derived(vm?.branchEntries ?? []);
const currentOffers = $derived(vm?.currentOffers ?? []);
const isIdentityRequired = $derived(vm?.isIdentityRequired ?? false);
const isEvolutionRequired = $derived(vm?.isEvolutionRequired ?? false);
const isBlock8 = $derived(vm?.isBlock8NoOpportunity ?? false);
const rewardEntitlements = $derived(vm?.rewardEntitlements ?? {
    influenceEarned: 0,
    inquiryCredits: 0,
    informationBenefits: 0,
    followUpUnlocks: [],
});
function outcomeBadge(outcome: SeasonCampaignEvaluation['outcome']): string {
    switch (outcome) {
        case 'missed':
            return 'bg-muted text-muted-foreground border-border';
        case 'completed':
            return 'bg-positive/15 text-positive border-positive/30';
        case 'breakthrough':
            return 'bg-primary/15 text-primary border-primary/30';
    }
}
function readablePlayerRef(value: unknown): string {
    if (typeof value === 'string' && value.startsWith('pv-')) {
        return playerName(value);
    }
    return String(value);
}
</script>

<section
  aria-labelledby="campaign-heading"
  class="flex flex-col gap-4"
  data-testid="campaign-panel"
>
  <div class="flex flex-wrap items-baseline justify-between gap-2">
    <h2 id="campaign-heading" class="font-display text-xl font-extrabold uppercase tracking-tight">
      Campaign
    </h2>
    <span class="font-mono text-[10px] text-muted-foreground">
      {#if vm?.currentBlockIndex !== null && vm?.currentBlockIndex !== undefined}Block {(vm?.currentBlockIndex ??
          0) + 1} of 9{/if}
      {#if isBlock8}
        · final block — no new opportunity{/if}
    </span>
  </div>

  {#if vm === null}
    <p class="rounded-xl bg-surface-1 p-4 text-sm text-muted-foreground">Loading campaign…</p>
  {:else}
    {#if isIdentityRequired}
      <GmIdentityPicker {busy} {commandError} onSelect={(input) => onSelectIdentity(input)} />
    {:else if isEvolutionRequired && campaign?.evolutionOffers}
      <EvolutionPicker
        offers={campaign.evolutionOffers}
        {busy}
        {commandError}
        onSelect={(offerId) => onEvolve({ offerId })}
      />
    {:else}
      <div class="overflow-hidden rounded-xl border border-border bg-surface-1">
        <div
          class="flex flex-wrap items-baseline justify-between gap-2 border-b border-border bg-surface-2 px-4 py-3"
        >
          <h3
            class="font-mono text-[11px] font-bold uppercase tracking-[0.14em] text-muted-foreground"
          >
            Prior block result
          </h3>
          {#if prior !== null}
            <span
              class="rounded-full border px-2.5 py-0.5 font-mono text-[10px] font-bold uppercase tracking-[0.12em] {outcomeBadge(
                prior.outcome,
              )}"
            >
              {CAMPAIGN_OUTCOME_LABELS[prior.outcome]}
            </span>
          {:else}
            <span class="font-mono text-[10px] text-muted-foreground">No block resolved yet</span>
          {/if}
        </div>

        {#if prior !== null}
          <div class="p-4 sm:p-5">
            <p class="text-sm font-semibold">{prior.explanation}</p>
            <div class="mt-3 grid gap-3 sm:grid-cols-2">
              <div class="rounded-lg bg-surface-2 p-3">
                <p
                  class="font-mono text-[10px] font-bold uppercase tracking-[0.12em] text-muted-foreground"
                >
                  Evidence
                </p>
                <ul class="mt-2 flex flex-col gap-1">
                  {#each priorFactsEntries.slice(0, 6) as [key, value] (key)}
                    <li class="flex gap-2 text-xs">
                      <span class="shrink-0 font-mono text-[10px] text-muted-foreground"
                        >{key}:</span
                      >
                      <span class="min-w-0 flex-1 truncate font-medium"
                        >{readablePlayerRef(value)}</span
                      >
                    </li>
                  {/each}
                  {#if priorFactsEntries.length === 0}
                    <li class="text-xs text-muted-foreground">No additional facts recorded.</li>
                  {/if}
                </ul>
              </div>
              <div class="rounded-lg bg-surface-2 p-3">
                <p
                  class="font-mono text-[10px] font-bold uppercase tracking-[0.12em] text-muted-foreground"
                >
                  Reward
                </p>
                {#if priorRewardIds.length === 0}
                  <p class="mt-2 text-sm">No reward — missed.</p>
                  <p class="mt-1 font-mono text-[10px] text-muted-foreground">
                    Failure never applies a penalty or hidden debt.
                  </p>
                {:else}
                  <ul class="mt-2 flex flex-col gap-1">
                    {#each priorRewardIds as rid (rid)}
                      <li
                        class="rounded border border-border bg-card px-2 py-1.5 font-mono text-xs"
                      >
                        <span class="font-semibold">{rid}</span>
                        <span class="ml-2 text-muted-foreground"
                          >applied · cap 8 — ledger shows requested vs applied</span
                        >
                      </li>
                    {/each}
                  </ul>
                {/if}
              </div>
            </div>
            <div class="mt-3 flex flex-wrap gap-2">
              {#each branchEntries.slice(0, 6) as entry (entry.branchId)}
                <span
                  class="rounded-full border border-border bg-surface-2 px-2.5 py-1 font-mono text-[10px]"
                >
                  {entry.branchId.slice(0, 8)}… ·
                  <strong class="text-foreground">{entry.state}</strong>
                </span>
              {/each}
            </div>
          </div>
        {:else}
          <div class="p-4 text-sm text-muted-foreground">
            Select an opportunity this checkpoint — after the block the engine will grade it as <em
              class="font-semibold text-foreground not-italic">missed | completed | breakthrough</em
            > from recorded facts.
          </div>
        {/if}

        <div class="border-t border-border bg-surface-2/50 px-4 py-2 sm:px-5">
          <p class="font-mono text-[10px] text-muted-foreground">
            Rewards: Influence (+1 bounded, cap 8 — ledger records requested/applied) · Trade board
            information · Trade inquiry credit · Follow-up unlock · Follow-ups arrive only after
            completed/breakthrough.
          </p>
        </div>
      </div>

      {#if branchEntries.length > 0}
        <div class="rounded-xl border border-border bg-surface-1 p-4 sm:p-5">
          <h3
            class="font-mono text-[11px] font-bold uppercase tracking-[0.14em] text-muted-foreground"
          >
            Branch state
          </h3>
          <div class="mt-2 flex flex-wrap gap-2">
            {#each branchEntries as entry (entry.branchId)}
              <span
                class="inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium {entry.state ===
                'completed'
                  ? 'border-positive/30 bg-positive/10 text-positive'
                  : entry.state === 'missed'
                    ? 'border-destructive/30 bg-destructive/10 text-destructive'
                    : entry.state === 'locked'
                      ? 'border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-400'
                      : 'border-border bg-surface-2 text-muted-foreground'}"
                title={entry.branchId}
              >
                <span
                  class="h-1.5 w-1.5 rounded-full {entry.state === 'completed'
                    ? 'bg-positive'
                    : entry.state === 'missed'
                      ? 'bg-destructive'
                      : entry.state === 'locked'
                        ? 'bg-amber-500'
                        : 'bg-muted-foreground'}"
                ></span>
                {entry.branchId.slice(4, 12)} — {entry.state}
              </span>
            {/each}
          </div>
          <p class="mt-2 font-mono text-[10px] text-muted-foreground">
            Missing an opportunity ends only that branch. No hidden penalty, no cap reduction.
          </p>
        </div>
      {/if}

      <div class="rounded-xl border border-border bg-surface-1 p-4 sm:p-5">
        <h3
          class="font-mono text-[11px] font-bold uppercase tracking-[0.14em] text-muted-foreground"
        >
          Entitlements
        </h3>
        <div class="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
          <div class="rounded-lg bg-surface-2 p-3">
            <p class="font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
              Influence earned
            </p>
            <p class="font-display text-xl font-extrabold">+{rewardEntitlements.influenceEarned}</p>
          </div>
          <div class="rounded-lg bg-surface-2 p-3">
            <p class="font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
              Inquiry credits
            </p>
            <p class="font-display text-xl font-extrabold">{rewardEntitlements.inquiryCredits}</p>
          </div>
          <div class="rounded-lg bg-surface-2 p-3">
            <p class="font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
              Information
            </p>
            <p class="font-display text-xl font-extrabold">
              {rewardEntitlements.informationBenefits}
            </p>
          </div>
          <div class="rounded-lg bg-surface-2 p-3">
            <p class="font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
              Follow-ups
            </p>
            <p class="font-display text-xl font-extrabold">
              {rewardEntitlements.followUpUnlocks.length}
            </p>
          </div>
        </div>
        {#if vm.appliedRewardIds.length > 0}
          <p class="mt-2 font-mono text-[10px] text-muted-foreground">
            Applied ids: {vm.appliedRewardIds.join(' · ')}
          </p>
        {/if}
      </div>

      <div class="rounded-xl border border-border bg-surface-1 p-4 sm:p-5">
        <div class="flex flex-wrap items-baseline justify-between gap-2">
          <h3
            class="font-mono text-[11px] font-bold uppercase tracking-[0.14em] text-muted-foreground"
          >
            {#if isBlock8}
              No opportunity · final block
            {:else}
              Choose one for block {(vm.currentBlockIndex ?? 0) + 1}
            {/if}
          </h3>
          {#if !isBlock8}
            <span class="font-mono text-[10px] text-muted-foreground"
              >2 feasible cards · canonical order before seed pick</span
            >
          {/if}
        </div>

        {#if isBlock8}
          <p class="mt-3 rounded-lg bg-surface-2 p-3 text-sm text-muted-foreground">
            Block 8 (the final two-game block) does not open a new campaign opportunity. Your prior
            evaluations remain visible above.
          </p>
        {:else if currentOffers.length === 0}
          <p class="mt-3 rounded-lg bg-surface-2 p-3 text-sm text-muted-foreground">
            Preparing the two opportunities…
          </p>
        {:else}
          {#if commandError !== null}
            <p
              role="alert"
              class="mt-3 rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm"
            >
              {commandError}
            </p>
          {/if}
          <div class="mt-3 grid gap-3 lg:grid-cols-2">
            {#each currentOffers as card (card.opportunity.opportunityId)}
              <article
                class="group relative flex flex-col gap-3 rounded-xl border bg-card p-4 outline-none transition-all hover:-translate-y-0.5 hover:shadow-md focus-within:ring-2 focus-within:ring-ring {card.isSelected
                  ? 'border-primary bg-primary/5 ring-1 ring-primary'
                  : 'border-border'}"
                aria-labelledby={`card-title-${card.opportunity.opportunityId}`}
              >
                <div class="flex items-start justify-between gap-2">
                  <div class="min-w-0">
                    <p
                      class="font-mono text-[10px] font-bold uppercase tracking-[0.12em] text-primary"
                    >
                      {CAMPAIGN_FAMILY_LABELS[card.opportunity.family] ?? card.opportunity.family} · {CAMPAIGN_IDENTITY_LABELS[
                        card.opportunity.identity
                      ] ?? card.opportunity.identity}
                    </p>
                    <h4
                      id={`card-title-${card.opportunity.opportunityId}`}
                      class="font-display text-sm font-extrabold uppercase tracking-tight"
                    >
                      {card.targetLabel}
                    </h4>
                    {#if card.breakthroughLabel !== null}
                      <p class="font-mono text-[10px] text-muted-foreground">
                        Breakthrough: {card.breakthroughLabel}
                      </p>
                    {/if}
                  </div>
                  <span
                    class="shrink-0 rounded-full bg-surface-3 px-2 py-0.5 font-mono text-[10px] font-bold uppercase tracking-[0.12em] text-muted-foreground"
                  >
                    {card.opportunity.branchId.slice(4, 10)}
                  </span>
                </div>

                <div class="rounded-lg bg-surface-2 p-2.5">
                  <p
                    class="font-mono text-[10px] font-bold uppercase tracking-[0.12em] text-muted-foreground"
                  >
                    Feasibility facts
                  </p>
                  <ul class="mt-1 flex flex-col gap-0.5">
                    {#each Object.entries(card.feasibilityFacts).slice(0, 4) as [k, v] (k)}
                      <li class="flex gap-1.5 text-[11px]">
                        <span class="shrink-0 font-mono text-[10px] text-muted-foreground"
                          >{k}:</span
                        >
                        <span class="min-w-0 truncate text-muted-foreground"
                          >{typeof v === 'string' && v.startsWith('pv-')
                            ? playerName(v)
                            : String(v).slice(0, 64)}</span
                        >
                      </li>
                    {/each}
                  </ul>
                  {#if card.opportunity.prerequisiteId !== null}
                    <p class="mt-1 font-mono text-[10px] text-amber-600 dark:text-amber-400">
                      Follows {card.opportunity.prerequisiteId.slice(0, 8)}…
                    </p>
                  {/if}
                </div>

                <div
                  class="flex flex-col gap-1.5 rounded-lg border border-primary/20 bg-primary/5 p-2.5"
                >
                  <p
                    class="font-mono text-[10px] font-bold uppercase tracking-[0.12em] text-primary"
                  >
                    Rewards
                  </p>
                  <p class="text-xs">
                    <span class="font-semibold">{card.completedRewardLabel}</span>
                    <span class="text-muted-foreground">on completed</span>
                  </p>
                  {#if card.breakthroughRewardLabel !== null}
                    <p class="text-xs">
                      <span class="font-semibold">{card.breakthroughRewardLabel}</span>
                      <span class="text-muted-foreground">on breakthrough</span>
                    </p>
                  {:else}
                    <p class="text-xs text-muted-foreground">
                      No breakthrough reward — completed is the top outcome.
                    </p>
                  {/if}
                  <p class="font-mono text-[10px] text-muted-foreground/70">
                    Bounded int 0–5 · stable id · Influence respects cap 8.
                  </p>
                </div>

                <button
                  type="button"
                  disabled={card.isSelected || busy}
                  onclick={() =>
                    onSelectOpportunity({
                      blockIndex: card.opportunity.blockIndex,
                      opportunityId: card.opportunity.opportunityId,
                    })}
                  aria-pressed={card.isSelected}
                  data-testid={`select-opportunity-${card.opportunity.opportunityId}`}
                  class="mt-auto inline-flex h-11 items-center justify-center rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground outline-none transition-opacity focus-visible:ring-2 focus-visible:ring-ring hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {card.isSelected ? 'Selected' : 'Select this opportunity'}
                </button>
              </article>
            {/each}
          </div>
          <p class="mt-3 font-mono text-[10px] text-muted-foreground">
            Locked selection enters the command log; evaluation uses only recorded facts (results,
            health, standings, rotation). Missing never penalizes.
          </p>
        {/if}
      </div>
    {/if}
  {/if}

  <p class="sr-only" role="status" aria-live="polite">
    {#if prior !== null}Prior {prior.outcome} · {prior.explanation.slice(0, 80)}{/if}
    {#if currentOffers.length > 0}{currentOffers.length} offers for block {(vm?.currentBlockIndex ??
        0) + 1}{/if}
  </p>
</section>

<style>
  @media (prefers-reduced-motion: reduce) {
    .group {
      transition: none !important;
    }
  }
</style>
