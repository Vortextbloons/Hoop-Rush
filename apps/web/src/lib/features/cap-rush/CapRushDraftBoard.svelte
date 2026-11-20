<script lang="ts">
  import type { CapRushDraftView } from '@hoop-rush/application/cap-rush';
  import {
    CAP_RUSH_CAP_LINE_DOLLARS,
    CAP_RUSH_CONFERENCE_NAMES,
    POSITIONS,
    type CapRushSpinPurchaseId,
    type CapRushSpinReceipt,
    type Position,
  } from '@hoop-rush/data-contracts';
  import HavocMutationList from '#lib/features/havoc/HavocMutationList.svelte';
  import HavocTierBadge from '#lib/features/havoc/HavocTierBadge.svelte';
  import { mutationNameOf } from '#lib/features/havoc/havoc-presentation.js';
  import { Check, ChevronDown, Lock, Shuffle } from '@lucide/svelte';
  import PlayerFace from '#lib/components/PlayerFace.svelte';
  import TeamLogo from '#lib/components/TeamLogo.svelte';
  import CapRushCard from './CapRushCard.svelte';
  import CapRushLineup from './CapRushLineup.svelte';
  import CapRushPayroll from './CapRushPayroll.svelte';
  import { capRushPlayoffStatusOf } from './cap-rush-playoff-presentation.ts';
  import type { CapRushArt } from './cap-rush-art.ts';
  import {
    capRushSpinOutcomeRows,
    capRushSpinPurchaseLabel,
    formatMillions,
    initialsOf,
    variantLabel,
  } from './cap-rush-presentation.ts';
  import PageShell from '#lib/components/ui/PageShell.svelte';
  import Alert from '#lib/components/ui/Alert.svelte';
  import Panel from '#lib/components/ui/Panel.svelte';
  import Badge from '#lib/components/ui/Badge.svelte';
  import Button from '#lib/components/ui/Button.svelte';
  import SectionHeading from '#lib/components/ui/SectionHeading.svelte';
  import StatGrid from '#lib/components/ui/StatGrid.svelte';
  import StatTile from '#lib/components/ui/StatTile.svelte';
  import { loadCapRushProfileReferences } from './cap-rush-profile-references.ts';
  import type { PlayerProfileReferences } from '#lib/players/player-profile.js';

  let {
    view,
    busy,
    error,
    unsupported,
    art = null,
    onChoose,
    onReroll,
    onSign,
    onPurchaseSpin,
    onSkipSpin,
    onLock,
    onDiscard,
  }: {
    view: CapRushDraftView;
    busy: boolean;
    error: string | null;
    unsupported: boolean;
    art?: CapRushArt | null;
    onChoose: (slot: Position) => void;
    onReroll: (cardId: string) => void;
    onSign: (cardId: string) => void;
    onPurchaseSpin: (purchase: CapRushSpinPurchaseId, targetCardId: string) => void;
    onSkipSpin: () => void;
    onLock: () => void;
    onDiscard: () => void;
  } = $props();

  let protectMode = $state(false);
  let confirmAbandon = $state(false);
  let spinTargetId = $state<string | null>(null);
  let references = $state.raw<PlayerProfileReferences | null>(null);

  $effect(() => {
    let cancelled = false;
    void loadCapRushProfileReferences()
      .then((loaded) => {
        if (!cancelled) references = loaded;
      })
      .catch(() => {
        // Percentiles are optional: cards fall back to a flat layout.
      });
    return () => {
      cancelled = true;
    };
  });

  const draft = $derived(view.draft);
  const offer = $derived(draft.offer);
  const complete = $derived(draft.stage === 'complete');
  const filledBySlot = $derived(new Map(view.slots.map((slot) => [slot.slot, slot.player])));
  const pickedSlots = $derived(new Set(draft.picks.map((pick) => pick.slot)));
  const spin = $derived(view.spin);
  const receipts = $derived(
    spin?.state.status === 'purchased'
      ? [spin.state.receipt, ...(spin.state.additionalReceipts ?? [])]
      : [],
  );
  const eligibleTargets = $derived(
    (spin?.targets ?? []).filter(
      (entry) => !receipts.some((receipt) => receipt.target.cardId === entry.cardId),
    ),
  );
  const spinTarget = $derived(
    eligibleTargets.find((entry) => entry.cardId === spinTargetId)?.cardId ??
      eligibleTargets[0]?.cardId ??
      null,
  );
  const spinSpend = $derived(receipts.reduce((total, receipt) => total + receipt.priceDollars, 0));
  const mutationBudget = $derived(
    Math.max(0, CAP_RUSH_CAP_LINE_DOLLARS - view.payrollDollars - spinSpend),
  );
  const latestReceipt = $derived(
    receipts.length === 0 ? null : (receipts[receipts.length - 1] ?? null),
  );
  const previousReceipts = $derived(receipts.slice(0, -1).reverse());
  const spinDecisionOpen = $derived(
    spin?.state.status === 'pending' || spin?.state.status === 'purchased',
  );
  const anyPurchaseEligible = $derived((spin?.purchases ?? []).some((option) => option.eligible));
  const allTargetsMutated = $derived(spin !== null && eligibleTargets.length === 0);
  const decisionOpen = $derived(
    spinDecisionOpen && eligibleTargets.length > 0 && anyPurchaseEligible,
  );
  const spinHeading = $derived.by(() => {
    if (spin === null) return 'Draft complete';
    switch (spin.state.status) {
      case 'skipped':
        return 'No mutations purchased';
      case 'unavailable':
        return 'Mutation window closed';
      default:
        return allTargetsMutated ? 'Mutations complete' : 'Build your mutations';
    }
  });
  const spinDescription = $derived.by(() => {
    if (spin === null) return null;
    if (spin.state.status === 'skipped') return 'Your five stay unmutated.';
    if (spin.state.status === 'unavailable') return 'No mutation spin is available for this draft.';
    if (allTargetsMutated) return null;
    return 'Mutation purchases draw from the normal cap. The roster hard limit applies to player payroll.';
  });

  function spinTargetName(cardId: string): string {
    return spin?.targets.find((entry) => entry.cardId === cardId)?.player.displayName ?? cardId;
  }

  function targetFor(cardId: string) {
    return spin?.targets.find((entry) => entry.cardId === cardId) ?? null;
  }

  function mutationNames(receipt: CapRushSpinReceipt): string {
    return [receipt.entry, ...(receipt.additionalEntries ?? [])]
      .map((entry) => mutationNameOf(entry.mutationId))
      .join(' / ');
  }

  function purchaseCostSummary(): string {
    return (spin?.purchases ?? [])
      .map(
        (option) =>
          `${capRushSpinPurchaseLabel(option.purchase)} ${formatMillions(option.priceDollars)}`,
      )
      .join(' · ');
  }

  function buySpin(purchase: CapRushSpinPurchaseId): void {
    if (spinTarget === null) return;
    onPurchaseSpin(purchase, spinTarget);
  }

  function choose(slot: Position): void {
    protectMode = false;
    onChoose(slot);
  }

  function sign(cardId: string): void {
    protectMode = false;
    onSign(cardId);
  }

  function protect(cardId: string): void {
    protectMode = false;
    onReroll(cardId);
  }
</script>

<PageShell width="full" padding="none" class="px-3 pt-4 pb-24 sm:px-6 md:pb-10">
  {#if view.franchise}
    {@const franchiseIdentity = art === null ? null : art.teamFor(view.franchise.franchiseId)}
    <div
      class="assignment-reveal mb-4 flex flex-wrap items-center gap-3 rounded-2xl border border-accent/40 bg-accent/5 px-4 py-3"
      role="status"
    >
      {#if franchiseIdentity !== null && art !== null}
        <TeamLogo
          manifest={art.manifest}
          franchiseId={franchiseIdentity.franchiseId}
          teamExternalId={franchiseIdentity.teamExternalId}
          alt=""
          className="h-9 w-9"
        />
      {/if}
      <div class="min-w-0">
        <p class="ui-label text-accent">Franchise takeover</p>
        <p class="font-display truncate text-lg font-extrabold uppercase">
          {view.franchise.displayName}
        </p>
        <p class="ui-micro">
          {CAP_RUSH_CONFERENCE_NAMES[view.franchise.conference]} · {view.franchise.division}
        </p>
      </div>
    </div>
  {/if}
  <header class="flex flex-wrap items-end justify-between gap-4">
    <div class="min-w-0">
      <p class="ui-label">
        {variantLabel(draft.variant)} · Draft night
      </p>
      <h1
        class="font-display mt-2 text-3xl leading-[0.95] font-extrabold tracking-tight uppercase sm:text-4xl"
      >
        {#if complete}
          Your five are set.
        {:else if draft.stage === 'select-position'}
          Choose your next position.
        {:else}
          Pick your {offer?.slot ?? 'player'}.
        {/if}
      </h1>
      {#if complete}
        <p class="mt-2 hidden max-w-xl text-sm leading-relaxed text-muted-foreground sm:block">
          Every salary is locked. Here is the apron bill and the five you would take into the run.
        </p>
      {/if}
    </div>
    <ol class="flex gap-1 sm:gap-1.5" aria-label="Draft progress">
      {#each POSITIONS as slot, index (slot)}
        {@const filled = pickedSlots.has(slot)}
        {@const current = !complete && draft.stage === 'review-offer' && offer?.slot === slot}
        <li
          class="flex flex-col items-center gap-0.5 rounded-lg border px-2 py-1 font-mono text-[8px] font-bold tracking-[0.08em] sm:gap-1 sm:px-2.5 sm:py-1.5 sm:text-[9px] {filled
            ? 'border-primary bg-primary text-primary-foreground'
            : current
              ? 'border-accent text-accent'
              : 'border-line-soft text-muted-foreground'}"
          aria-current={current ? 'step' : undefined}
        >
          <span>{slot}</span>
          {#if filled}
            <Check size={11} aria-hidden="true" />
          {:else}
            <span class="text-[7px] opacity-70 sm:text-[8px]">{index + 1}</span>
          {/if}
        </li>
      {/each}
    </ol>
  </header>

  <div class="mt-4 space-y-3">
    <CapRushPayroll {view} />
    <div class="draft-layout">
      <div class="draft-lineup">
        <CapRushLineup
          slots={view.slots}
          {art}
          locked={view.draft.locked}
          payrollDollars={view.payrollDollars}
          {references}
          playoffStatus={capRushPlayoffStatusOf(view.draft)}
        />
      </div>
      <div class="draft-main">
        {#if draft.stage === 'select-position'}
          <Panel as="section" padding="none" class="p-4 sm:p-5" aria-label="Choose a position">
            <div class="flex flex-wrap items-end justify-between gap-2">
              <div>
                <p class="ui-label text-muted-foreground">
                  Round {draft.round} of 5
                </p>
                <h2 class="font-display mt-1 text-xl font-extrabold tracking-tight uppercase">
                  Which slot do you fill?
                </h2>
              </div>
              <span class="font-mono text-[10px] text-muted-foreground">
                {draft.picks.length}/5 signed
              </span>
            </div>
            <div class="mt-4 grid grid-cols-2 gap-2 min-[360px]:grid-cols-3 sm:grid-cols-5">
              {#each POSITIONS as slot (slot)}
                {@const player = filledBySlot.get(slot) ?? null}
                <button
                  type="button"
                  class="group flex min-h-24 flex-col items-start justify-between rounded-xl border p-3 text-left outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring {player
                    ? 'cursor-not-allowed border-line-soft bg-surface-1 opacity-60'
                    : 'border-border bg-surface-1 hover:border-primary hover:bg-surface-2'}"
                  disabled={busy || player !== null}
                  onclick={() => choose(slot)}
                >
                  <span class="flex w-full items-center justify-between">
                    <span class="font-display text-2xl font-extrabold">{slot}</span>
                    {#if player}<Check size={14} class="text-primary" aria-hidden="true" />{/if}
                  </span>
                  {#if player}
                    <span class="min-w-0">
                      <span class="block truncate text-[11px] font-semibold"
                        >{player.displayName}</span
                      >
                      <span class="ui-micro">Filled</span>
                    </span>
                  {:else}
                    <span class="text-[11px] text-muted-foreground">Open slot</span>
                  {/if}
                </button>
              {/each}
            </div>
            <p class="mt-3 text-[11px] leading-relaxed text-muted-foreground">
              Choosing a position opens ten cards at that exact slot. You cannot change the position
              after the offer appears.
            </p>
          </Panel>
        {:else if draft.stage === 'review-offer' && offer !== null}
          <section aria-label="Current offer">
            <div class="flex flex-wrap items-end justify-between gap-3">
              <div>
                <p class="ui-label text-muted-foreground">
                  Round {draft.round} of 5 · {offer.slot}
                </p>
                <h2
                  class="font-display mt-1 hidden text-xl font-extrabold tracking-tight uppercase sm:block"
                >
                  Ten cards, one signing
                </h2>
              </div>
              <div class="flex flex-wrap items-center gap-2">
                {#if protectMode}
                  <span class="text-[11px] font-semibold text-accent">Pick one card to keep</span>
                  <button
                    type="button"
                    class="inline-flex min-h-11 items-center rounded-lg border border-line-strong px-3 text-xs font-semibold text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
                    onclick={() => (protectMode = false)}>Cancel</button
                  >
                {:else if draft.rerollsRemaining > 0}
                  <button
                    type="button"
                    class="inline-flex min-h-11 items-center gap-1.5 rounded-lg border border-line-strong px-3 text-xs font-semibold outline-none hover:border-primary hover:text-primary focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
                    disabled={busy}
                    onclick={() => (protectMode = true)}
                  >
                    <Shuffle size={14} aria-hidden="true" />
                    Keep one & reroll
                  </button>
                {/if}
                <span class="font-mono text-[10px] text-muted-foreground">
                  {draft.rerollsRemaining} of 2 rerolls left
                </span>
              </div>
            </div>

            <div class="mt-3 grid grid-cols-2 gap-2 sm:gap-2.5 md:grid-cols-3 xl:grid-cols-4">
              {#each view.cards as entry (entry.card.cardId)}
                <CapRushCard
                  {entry}
                  {protectMode}
                  disabled={busy}
                  {art}
                  {references}
                  onSign={sign}
                  onProtect={protect}
                />
              {/each}
            </div>
            {#if protectMode}
              <p class="mt-3 text-[11px] leading-relaxed text-muted-foreground">
                The protected card keeps its player, salary, bucket and display spot. The other nine
                are replaced, and this reroll cannot be undone.
              </p>
            {/if}
          </section>
        {:else if complete}
          <Panel as="section" padding="none" class="p-4 sm:p-5" aria-label="Draft summary">
            {#if spin !== null}
              <SectionHeading
                eyebrow="Cap Roulette"
                title={spinHeading}
                description={spinDescription}
                level={2}
              />

              {#if spinDecisionOpen}
                <StatGrid class="mt-4" columns={3} mobile={2}>
                  <StatTile
                    label="Mutation budget left"
                    size="md"
                    surface="tile"
                    note="Normal cap"
                    tone={mutationBudget === 0 ? 'negative' : 'default'}
                    value={formatMillions(mutationBudget)}
                  />
                  <StatTile
                    label="Mutation spend"
                    size="md"
                    surface="tile"
                    note={`${receipts.length} of 5 purchases`}
                    tone={receipts.length === 0 ? 'muted' : 'default'}
                    value={formatMillions(spinSpend)}
                  />
                  <StatTile
                    label="Draft payroll room"
                    size="md"
                    surface="tile"
                    note="Hard limit"
                    tone={view.remainingRoomDollars < 0 ? 'negative' : 'default'}
                    value={formatMillions(view.remainingRoomDollars)}
                  />
                </StatGrid>
              {/if}

              {#if spinDecisionOpen}
                {#if decisionOpen}
                  <div class="mt-5">
                    <SectionHeading level={3} size="sm" title="Choose a player" align="center">
                      {#snippet actions()}
                        <span class="ui-micro">One purchase per player</span>
                      {/snippet}
                    </SectionHeading>
                    <div
                      class="mt-2.5 grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-3"
                      role="group"
                      aria-label="Spin target"
                    >
                      {#each spin.targets as entry (entry.cardId)}
                        {@const active = spinTarget === entry.cardId}
                        {@const mutated = receipts.some(
                          (receipt) => receipt.target.cardId === entry.cardId,
                        )}
                        {@const face = art !== null ? art.faceFor(entry.player) : null}
                        <button
                          type="button"
                          aria-pressed={active}
                          class="flex min-h-14 min-w-0 items-center gap-2.5 rounded-xl border p-2 text-left text-foreground outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring {mutated
                            ? 'border-line-soft bg-surface-1'
                            : active
                              ? 'border-primary bg-primary/10'
                              : 'border-line-soft bg-card hover:border-line-strong'}"
                          disabled={busy || mutated}
                          onclick={() => (spinTargetId = entry.cardId)}
                        >
                          {#if face !== null && art !== null}
                            <PlayerFace
                              player={face}
                              manifest={art.manifest}
                              size="sm"
                              fallbackInitials={initialsOf(entry.player.displayName)}
                            />
                          {:else}
                            <span
                              class="grid h-9 w-9 shrink-0 place-items-center rounded-md bg-surface-3 font-display text-xs font-extrabold text-muted-foreground"
                              aria-hidden="true">{initialsOf(entry.player.displayName)}</span
                            >
                          {/if}
                          <span class="min-w-0 flex-1">
                            <span class="flex min-w-0 items-center gap-1.5">
                              <span class="shrink-0 font-mono text-[10px] font-bold text-primary"
                                >{entry.slot}</span
                              >
                              <span class="truncate text-sm leading-tight font-bold"
                                >{entry.player.displayName}</span
                              >
                            </span>
                            <span class="ui-micro mt-0.5 block truncate"
                              >{formatMillions(entry.salaryDollars)} &middot;
                              {entry.player.originalOverall} OVR</span
                            >
                          </span>
                          {#if mutated}
                            <Badge tone="accent">Mutated</Badge>
                          {:else if active}
                            <Check size={16} class="shrink-0 text-primary" aria-hidden="true" />
                          {/if}
                        </button>
                      {/each}
                    </div>
                  </div>

                  <div class="mt-5">
                    <SectionHeading
                      level={3}
                      size="sm"
                      title="Choose your spin"
                      description="Tier odds are exact. The spin is charged when purchased."
                    />
                    <div class="mt-2.5 grid gap-2 sm:grid-cols-2">
                      {#each spin.purchases as option (option.purchase)}
                        <Panel as="article" padding="none" class="flex min-w-0 flex-col p-3 sm:p-4">
                          <div
                            class="flex flex-wrap items-baseline justify-between gap-x-2 gap-y-1"
                          >
                            <h4 class="font-display text-lg leading-tight font-extrabold uppercase">
                              {capRushSpinPurchaseLabel(option.purchase)}
                            </h4>
                            <p class="font-mono text-sm font-bold tabular-nums">
                              {formatMillions(option.priceDollars)}
                            </p>
                          </div>
                          <p class="mt-1 text-xs text-muted-foreground">
                            {option.purchase === 'standard'
                              ? 'One mutation, drawn at the odds below.'
                              : 'One to three mutations, drawn as a bundle.'}
                          </p>
                          <dl class="mt-3 divide-y divide-line-soft border-t border-line-soft">
                            {#each capRushSpinOutcomeRows(option.purchase, option.tierOdds) as row (row.tier)}
                              <div class="flex items-baseline justify-between gap-2 py-1.5">
                                <dt class="min-w-0 text-[11px] leading-snug">{row.label}</dt>
                                <dd class="shrink-0 font-mono text-xs font-bold tabular-nums">
                                  {Math.round(row.odds * 100)}%
                                </dd>
                              </div>
                            {/each}
                          </dl>
                          {#if !option.eligible}
                            <p class="mt-2.5 text-[11px] leading-snug font-semibold text-negative">
                              {formatMillions(mutationBudget)} available for mutations.
                            </p>
                          {/if}
                          <div class="mt-auto pt-3">
                            <Button
                              class="w-full"
                              tone="primary"
                              disabled={busy || spinTarget === null || !option.eligible}
                              onclick={() => buySpin(option.purchase)}
                            >
                              Buy {capRushSpinPurchaseLabel(option.purchase)}
                            </Button>
                          </div>
                        </Panel>
                      {/each}
                    </div>
                  </div>
                {:else}
                  <div class="mt-4 rounded-xl border border-line-soft bg-surface-1 p-3">
                    {#if allTargetsMutated}
                      <p class="text-sm font-semibold">Every player already has a mutation.</p>
                      <p class="mt-1 text-xs leading-relaxed text-muted-foreground">
                        One purchase per player. Lock the lineup to open the season.
                      </p>
                    {:else}
                      <p class="text-sm font-semibold">No spin fits the normal cap.</p>
                      <p class="mt-1 text-xs leading-relaxed text-muted-foreground">
                        {formatMillions(mutationBudget)} mutation budget left.
                        {purchaseCostSummary()}.
                      </p>
                    {/if}
                  </div>
                {/if}
              {/if}

              {#if spin.state.status === 'pending' || view.canLock}
                <div
                  class="mt-4 flex flex-wrap items-center gap-x-3 gap-y-2 border-t border-line-soft pt-3"
                >
                  {#if spin.state.status === 'pending'}
                    <Button tone="secondary" disabled={busy} onclick={onSkipSpin}>
                      Skip mutations
                    </Button>
                    <p class="text-xs leading-snug text-muted-foreground">
                      Keep your five unmutated. Lock the lineup after skipping.
                    </p>
                  {:else if view.canLock}
                    <Button tone="primary" disabled={busy} onclick={onLock}>
                      <Lock size={15} aria-hidden="true" />
                      Lock the lineup
                    </Button>
                    <p class="text-xs leading-snug text-muted-foreground">
                      {#if spin.state.status === 'purchased'}
                        Purchases are final. Lock the lineup to open the season.
                      {:else}
                        Lock the lineup to open the season.
                      {/if}
                    </p>
                  {/if}
                </div>
              {/if}

              {#if receipts.length > 0}
                <div class="mt-5 border-t border-line-soft pt-4">
                  <SectionHeading level={3} size="sm" title="Mutation results" align="center">
                    {#snippet actions()}
                      <span class="ui-micro"
                        >{receipts.length} of 5 purchases &middot; {formatMillions(spinSpend)}</span
                      >
                    {/snippet}
                  </SectionHeading>

                  {#if latestReceipt !== null}
                    {@const target = targetFor(latestReceipt.target.cardId)}
                    {@const face =
                      target !== null && art !== null ? art.faceFor(target.player) : null}
                    {#key latestReceipt.receiptDigest}
                      <Panel
                        as="article"
                        padding="none"
                        class="latest-receipt mt-2.5 flex min-w-0 items-start gap-2.5 p-3 sm:gap-3 sm:p-4"
                        role="status"
                      >
                        {#if face !== null && art !== null}
                          <PlayerFace
                            player={face}
                            manifest={art.manifest}
                            size="sm"
                            fallbackInitials={initialsOf(
                              target?.player.displayName ??
                                spinTargetName(latestReceipt.target.cardId),
                            )}
                          />
                        {:else}
                          <span
                            class="grid h-9 w-9 shrink-0 place-items-center rounded-md bg-surface-3 font-display text-xs font-extrabold text-muted-foreground"
                            aria-hidden="true"
                            >{initialsOf(
                              target?.player.displayName ??
                                spinTargetName(latestReceipt.target.cardId),
                            )}</span
                          >
                        {/if}
                        <div class="min-w-0 flex-1">
                          <div class="flex flex-wrap items-center gap-2">
                            <span class="ui-label">Latest purchase</span>
                            <HavocTierBadge tier={latestReceipt.tier} size="sm" />
                          </div>
                          <p class="mt-1 min-w-0 text-sm font-bold">
                            <span class="font-mono text-[10px] text-primary"
                              >{latestReceipt.target.slot}</span
                            >
                            <span class="break-words"
                              >{target?.player.displayName ??
                                spinTargetName(latestReceipt.target.cardId)}</span
                            >
                          </p>
                          <p class="ui-micro mt-0.5">
                            {capRushSpinPurchaseLabel(latestReceipt.purchase)} &middot;
                            {formatMillions(latestReceipt.priceDollars)}
                          </p>
                          <div class="mt-2">
                            <HavocMutationList
                              mutations={[
                                latestReceipt.entry,
                                ...(latestReceipt.additionalEntries ?? []),
                              ]}
                              readable
                            />
                          </div>
                        </div>
                      </Panel>
                    {/key}
                  {/if}

                  {#if previousReceipts.length > 0}
                    <ul class="mt-2 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
                      {#each previousReceipts as receipt (receipt.receiptDigest)}
                        {@const target = targetFor(receipt.target.cardId)}
                        {@const face =
                          target !== null && art !== null ? art.faceFor(target.player) : null}
                        <li class="min-w-0">
                          <details class="ui-panel group min-w-0" data-padding="none">
                            <summary
                              class="flex min-h-11 cursor-pointer list-none items-center gap-2 p-2.5 outline-none focus-visible:ring-2 focus-visible:ring-ring"
                            >
                              {#if face !== null && art !== null}
                                <PlayerFace
                                  player={face}
                                  manifest={art.manifest}
                                  size="sm"
                                  fallbackInitials={initialsOf(
                                    target?.player.displayName ??
                                      spinTargetName(receipt.target.cardId),
                                  )}
                                />
                              {:else}
                                <span
                                  class="grid h-8 w-8 shrink-0 place-items-center rounded-md bg-surface-3 font-display text-[10px] font-extrabold text-muted-foreground"
                                  aria-hidden="true"
                                  >{initialsOf(
                                    target?.player.displayName ??
                                      spinTargetName(receipt.target.cardId),
                                  )}</span
                                >
                              {/if}
                              <span class="min-w-0 flex-1">
                                <span class="flex min-w-0 items-center gap-1.5">
                                  <span
                                    class="shrink-0 font-mono text-[10px] font-bold text-primary"
                                    >{receipt.target.slot}</span
                                  >
                                  <span class="truncate text-xs font-bold"
                                    >{target?.player.displayName ??
                                      spinTargetName(receipt.target.cardId)}</span
                                  >
                                </span>
                                <span class="ui-micro mt-0.5 block truncate"
                                  >{capRushSpinPurchaseLabel(receipt.purchase)} &middot;
                                  {formatMillions(receipt.priceDollars)}</span
                                >
                                <span class="mt-0.5 block truncate text-[10px] text-primary"
                                  >{mutationNames(receipt)}</span
                                >
                              </span>
                              <HavocTierBadge tier={receipt.tier} size="sm" />
                              <ChevronDown
                                size={14}
                                class="receipt-chevron shrink-0 text-muted-foreground"
                                aria-hidden="true"
                              />
                            </summary>
                            <div class="border-t border-line-soft p-2.5">
                              <HavocMutationList
                                mutations={[receipt.entry, ...(receipt.additionalEntries ?? [])]}
                                readable
                              />
                            </div>
                          </details>
                        </li>
                      {/each}
                    </ul>
                  {/if}
                </div>
              {/if}
            {/if}

            {#if spin === null && view.canLock}
              <div
                class="mt-4 flex flex-wrap items-center gap-x-3 gap-y-2 border-t border-line-soft pt-3"
              >
                <Button tone="primary" disabled={busy} onclick={onLock}>
                  <Lock size={15} aria-hidden="true" />
                  Lock the lineup
                </Button>
                <p class="text-xs leading-snug text-muted-foreground">
                  Five salaries, one apron bill, one target. Lock it in to open the season.
                </p>
              </div>
            {/if}
          </Panel>
        {/if}
      </div>
    </div>

    {#if error !== null}
      <Alert tone="danger">
        <p>{error}</p>
        {#if unsupported || error !== null}
          <button
            type="button"
            class="mt-3 inline-flex min-h-10 items-center rounded-lg border border-negative/50 px-3 text-xs font-bold uppercase"
            disabled={busy}
            onclick={onDiscard}>Discard draft and start fresh</button
          >
        {/if}
      </Alert>
    {/if}

    {#if !complete}
      <div>
        {#if confirmAbandon}
          <div class="rounded-xl border border-negative/40 bg-negative/10 p-3">
            <p class="text-xs font-bold text-negative">Discard this draft?</p>
            <p class="mt-1 text-[11px] text-muted-foreground">
              Every pick, salary and reroll in this run is lost.
            </p>
            <div class="mt-2 flex flex-wrap gap-2">
              <button
                type="button"
                class="inline-flex min-h-11 items-center rounded-lg bg-negative px-3 text-xs font-bold text-white outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
                disabled={busy}
                onclick={onDiscard}>Discard draft</button
              >
              <button
                type="button"
                class="inline-flex min-h-11 items-center rounded-lg border border-line-strong px-3 text-xs font-semibold text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
                onclick={() => (confirmAbandon = false)}>Cancel</button
              >
            </div>
          </div>
        {:else}
          <button
            type="button"
            class="text-[11px] text-muted-foreground underline underline-offset-4 outline-none hover:text-negative focus-visible:ring-2 focus-visible:ring-ring"
            onclick={() => (confirmAbandon = true)}>Abandon draft</button
          >
        {/if}
      </div>
    {/if}
  </div>
</PageShell>

<style>
  .assignment-reveal {
    animation: assignment-in 360ms cubic-bezier(0.2, 0.8, 0.2, 1) both;
  }
  @keyframes assignment-in {
    from {
      transform: translateY(-6px);
      opacity: 0;
    }
    to {
      transform: none;
      opacity: 1;
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .assignment-reveal {
      animation: none;
    }
  }
  .draft-layout {
    display: grid;
    gap: 1rem;
  }
  .draft-main {
    min-width: 0;
    order: -1;
  }
  @media (min-width: 1100px) {
    .draft-layout {
      grid-template-columns: minmax(300px, 360px) minmax(0, 1fr);
      align-items: start;
    }
    .draft-main {
      order: 0;
    }
    .draft-lineup {
      position: sticky;
      top: 1rem;
    }
  }
  :global(.latest-receipt) {
    animation: receipt-in 500ms cubic-bezier(0.2, 0.8, 0.2, 1) both;
  }
  @keyframes receipt-in {
    from {
      opacity: 0;
      transform: translateY(6px);
    }
    to {
      opacity: 1;
      transform: none;
    }
  }
  :global(.receipt-chevron) {
    transition: transform 150ms ease;
  }
  details[open] :global(.receipt-chevron) {
    transform: rotate(180deg);
  }
  @media (prefers-reduced-motion: reduce) {
    :global(.latest-receipt) {
      animation: none;
    }
    :global(.receipt-chevron) {
      transition: none;
    }
  }
</style>
