<script lang="ts">
  import type { CapRushDraftView } from '@hoop-rush/application/cap-rush';
  import {
    CAP_RUSH_CAP_LINE_DOLLARS,
    CAP_RUSH_CONFERENCE_NAMES,
    POSITIONS,
    type CapRushSpinPurchaseId,
    type Position,
  } from '@hoop-rush/data-contracts';
  import HavocMutationList from '#lib/features/havoc/HavocMutationList.svelte';
  import HavocTierBadge from '#lib/features/havoc/HavocTierBadge.svelte';
  import { HAVOC_TIER_COLORS } from '#lib/features/havoc/havoc-presentation.js';
  import { Check, Lock, Shuffle, Sparkles } from '@lucide/svelte';
  import PlayerFace from '#lib/components/PlayerFace.svelte';
  import TeamLogo from '#lib/components/TeamLogo.svelte';
  import CapRushCard from './CapRushCard.svelte';
  import CapRushLineup from './CapRushLineup.svelte';
  import CapRushPayroll from './CapRushPayroll.svelte';
  import type { CapRushArt } from './cap-rush-art.ts';
  import { formatMillions, initialsOf, variantLabel } from './cap-rush-presentation.ts';

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

  function spinTargetName(cardId: string): string {
    return spin?.targets.find((entry) => entry.cardId === cardId)?.player.displayName ?? cardId;
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

<div class="mx-auto w-full max-w-[1440px] px-3 pt-4 pb-24 sm:px-6 md:pb-10">
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
        <p class="font-mono text-[9px] font-bold tracking-[0.16em] text-accent uppercase">
          Franchise takeover
        </p>
        <p class="font-display truncate text-lg font-extrabold uppercase">
          {view.franchise.displayName}
        </p>
        <p class="font-mono text-[9px] text-muted-foreground uppercase">
          {CAP_RUSH_CONFERENCE_NAMES[view.franchise.conference]} · {view.franchise.division}
        </p>
      </div>
      <p class="ml-auto max-w-xs text-[11px] leading-snug text-muted-foreground">
        Your drafted five replaces this franchise's frozen lineup. Its identity and schedule slot
        stay.
      </p>
    </div>
  {/if}
  <header class="flex flex-wrap items-end justify-between gap-4">
    <div class="min-w-0">
      <p class="font-mono text-[10px] font-bold tracking-[0.18em] text-primary uppercase">
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
      <div class="draft-lineup"><CapRushLineup slots={view.slots} {art} /></div>
      <div class="draft-main">
        {#if draft.stage === 'select-position'}
          <section
            class="rounded-2xl border border-border bg-card p-4 sm:p-5"
            aria-label="Choose a position"
          >
            <div class="flex flex-wrap items-end justify-between gap-2">
              <div>
                <p
                  class="font-mono text-[10px] font-bold tracking-[0.16em] text-muted-foreground uppercase"
                >
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
                      <span class="font-mono text-[9px] text-muted-foreground uppercase"
                        >Filled</span
                      >
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
          </section>
        {:else if draft.stage === 'review-offer' && offer !== null}
          <section aria-label="Current offer">
            <div class="flex flex-wrap items-end justify-between gap-3">
              <div>
                <p
                  class="font-mono text-[10px] font-bold tracking-[0.16em] text-muted-foreground uppercase"
                >
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
          <section
            class="draft-summary rounded-2xl border border-border bg-card p-4 sm:p-5"
            aria-label="Draft summary"
          >
            {#if spin !== null}
              <div class="spin-panel rounded-2xl border border-primary/30 p-4 sm:p-6">
                <div class="flex flex-wrap items-start justify-between gap-4">
                  <div>
                    <p
                      class="font-mono text-[10px] font-bold tracking-[0.16em] text-primary uppercase"
                    >
                      Cap Roulette
                    </p>
                    <h3
                      class="font-display mt-1 text-3xl leading-none font-extrabold tracking-tight uppercase"
                    >
                      {spin.state.status === 'skipped'
                        ? 'No mutations purchased'
                        : 'Build your mutations'}
                    </h3>
                  </div>
                  <div class="rounded-xl border border-line-soft bg-card px-4 py-3">
                    <p class="font-mono text-[9px] tracking-wider text-muted-foreground uppercase">
                      Room before the cap
                    </p>
                    <p class="font-display mt-1 text-2xl font-extrabold tabular-nums">
                      {formatMillions(
                        Math.max(0, CAP_RUSH_CAP_LINE_DOLLARS - view.payrollDollars - spinSpend),
                      )}
                    </p>
                  </div>
                </div>
                {#if spin.state.status === 'purchased'}
                  <div class="mt-5 grid gap-2 sm:grid-cols-2">
                    {#each receipts as receipt (receipt.receiptDigest)}
                      {#key receipt.receiptDigest}
                        <div class="spin-result relative min-w-0">
                          <div class="mutation-wheel" aria-hidden="true"></div>
                          <div
                            class="spin-reveal flex h-full items-start gap-3 rounded-xl border bg-card p-4"
                            style:border-color={HAVOC_TIER_COLORS[receipt.tier]}
                            role="status"
                          >
                            <span
                              class="spin-reveal-icon grid h-14 w-14 shrink-0 place-items-center rounded-xl border border-accent/40 bg-accent/10 text-accent"
                              ><Sparkles size={26} aria-hidden="true" /></span
                            >
                            <div class="min-w-0 flex-1">
                              <HavocTierBadge tier={receipt.tier} size="sm" />
                              <div class="mt-2">
                                <HavocMutationList mutations={[receipt.entry]} readable />
                              </div>
                              <p class="mt-3 font-mono text-[10px] text-muted-foreground uppercase">
                                {receipt.target.slot} &middot; {spinTargetName(
                                  receipt.target.cardId,
                                )} &middot;
                                {formatMillions(receipt.priceDollars)}
                              </p>
                            </div>
                          </div>
                        </div>
                      {/key}
                    {/each}
                  </div>
                {/if}
                {#if spin.state.status === 'skipped'}
                  <p class="mt-1 text-sm font-semibold">
                    No spin purchased. Your five stay unmutated.
                  </p>
                {:else}
                  <div class="mt-6">
                    <div class="flex items-baseline justify-between gap-3">
                      <h4 class="font-display text-lg font-extrabold uppercase">
                        Pick your player
                      </h4>
                      <span
                        class="font-mono text-[9px] tracking-wider text-muted-foreground uppercase"
                        >One mutation per player</span
                      >
                    </div>
                    <div
                      class="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-3"
                      role="group"
                      aria-label="Spin target"
                    >
                      {#each spin.targets as entry (entry.cardId)}
                        {@const active = spinTarget === entry.cardId}
                        {@const face = art !== null ? art.faceFor(entry.player) : null}
                        <button
                          type="button"
                          aria-pressed={active}
                          class="spin-target flex min-w-0 items-center gap-2 rounded-xl border p-2.5 text-left outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50 {active
                            ? 'border-primary bg-primary/10'
                            : 'border-line-soft bg-card hover:border-line-strong'}"
                          disabled={busy ||
                            receipts.some((receipt) => receipt.target.cardId === entry.cardId)}
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
                          <span class="min-w-0 flex-1"
                            ><span class="block font-mono text-[9px] font-bold text-primary"
                              >{entry.slot}</span
                            ><span class="block text-sm leading-tight font-bold"
                              >{entry.player.displayName}</span
                            >{#if receipts.some((receipt) => receipt.target.cardId === entry.cardId)}<span
                                class="block text-[9px] text-muted-foreground">Mutated</span
                              >{/if}</span
                          >
                          {#if active}<Check
                              size={15}
                              class="shrink-0 text-primary"
                              aria-hidden="true"
                            />{/if}
                        </button>
                      {/each}
                    </div>
                  </div>
                  <div class="mt-6">
                    <h4 class="font-display text-lg font-extrabold uppercase">Choose your spin</h4>
                    <p class="mt-1 text-xs text-muted-foreground">
                      Tier odds are shown for each option. The spin is charged when purchased.
                    </p>
                    <div class="mt-3 grid gap-2">
                      {#each spin.purchases as option (option.purchase)}
                        <button
                          type="button"
                          class="spin-option rounded-xl border border-line-soft bg-card p-4 text-left outline-none transition-colors hover:border-primary focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-60"
                          disabled={busy || spinTarget === null || !option.eligible}
                          onclick={() => buySpin(option.purchase)}
                        >
                          <span class="flex items-center justify-between gap-3"
                            ><span class="font-display text-xl font-extrabold uppercase"
                              >Standard spin</span
                            ><span
                              class="font-display text-xl font-extrabold text-primary tabular-nums"
                              >{formatMillions(option.priceDollars)}</span
                            ></span
                          >
                          <span class="mt-3 grid grid-cols-3 gap-2 border-t border-line-soft pt-3">
                            {#each [1, 2, 3] as tier (tier)}
                              <span
                                ><span
                                  class="block font-mono text-[9px] text-muted-foreground uppercase"
                                  >Tier {tier}</span
                                ><span class="mt-0.5 block text-sm font-bold tabular-nums"
                                  >{Math.round(option.tierOdds[tier as 1 | 2 | 3] * 100)}%</span
                                ></span
                              >
                            {/each}
                          </span>
                          {#if !option.eligible}
                            <span class="mt-3 block text-[11px] font-semibold text-negative"
                              >Requires total spend of {formatMillions(
                                option.maxEligiblePayrollDollars,
                              )} or less</span
                            >
                          {:else}
                            <span class="mt-3 block text-[11px] font-bold text-primary"
                              >Buy {option.purchase} spin &rarr;</span
                            >
                          {/if}
                        </button>
                      {/each}
                    </div>
                    {#if spin.state.status === 'pending'}
                      <button
                        type="button"
                        class="mt-4 min-h-10 rounded-lg px-1 text-xs font-semibold text-muted-foreground underline underline-offset-4 outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
                        disabled={busy}
                        onclick={onSkipSpin}>Skip mutations and keep my lineup</button
                      >
                    {/if}
                  </div>
                {/if}
              </div>
            {/if}

            <div class="mt-4 flex flex-wrap items-center gap-3">
              {#if view.canLock}
                <button
                  type="button"
                  class="inline-flex min-h-11 items-center gap-2 rounded-xl border border-primary/50 bg-primary/10 px-4 text-sm font-bold text-primary outline-none hover:bg-primary/15 focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
                  disabled={busy}
                  onclick={onLock}
                >
                  <Lock size={15} aria-hidden="true" />
                  Lock the lineup
                </button>
              {/if}
              <span class="inline-flex items-center gap-1.5 text-[11px] text-muted-foreground">
                <Sparkles size={13} aria-hidden="true" />
                {#if draft.stage === 'locked'}
                  Locked. The 82-game season is next.
                {:else if draft.variant === 'roulette' && spin?.state.status === 'pending'}
                  Resolve the mutation spin to close the draft.
                {:else}
                  Five salaries, one apron bill, one target. Lock it in to open the season.
                {/if}
              </span>
            </div>
          </section>
        {/if}
      </div>
    </div>

    {#if error !== null}
      <div
        role="alert"
        class="rounded-xl border border-negative/40 bg-negative/10 p-4 text-sm text-negative"
      >
        <p>{error}</p>
        {#if unsupported}
          <button
            type="button"
            class="mt-3 inline-flex min-h-10 items-center rounded-lg border border-negative/50 px-3 text-xs font-bold uppercase"
            disabled={busy}
            onclick={onDiscard}>Discard outdated draft and start fresh</button
          >
        {/if}
      </div>
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
</div>

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
  .mutation-wheel {
    position: absolute;
    top: 50%;
    left: 50%;
    z-index: 1;
    width: 2.5rem;
    height: 2.5rem;
    margin: -1.25rem 0 0 -1.25rem;
    pointer-events: none;
    border: 4px solid var(--color-surface-3);
    border-top-color: var(--color-primary);
    border-right-color: var(--color-accent);
    border-radius: 50%;
    animation: wheel-spin 1.4s cubic-bezier(0.12, 0.65, 0.2, 1) both;
  }
  @keyframes wheel-spin {
    to {
      transform: rotate(1080deg);
      opacity: 0;
    }
  }
  .spin-reveal {
    animation: reveal-spin 700ms 1.2s ease-out both;
  }
  .spin-reveal-icon {
    animation: reveal-icon 700ms ease-out both;
  }
  @keyframes reveal-spin {
    from {
      opacity: 0;
      transform: translateY(10px);
    }
    to {
      opacity: 1;
      transform: translateY(0);
    }
  }
  @keyframes reveal-icon {
    from {
      transform: rotate(-35deg) scale(0.6);
    }
    to {
      transform: rotate(0) scale(1);
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .mutation-wheel {
      display: none;
    }
    .spin-reveal,
    .spin-reveal-icon {
      animation: none;
    }
  }
  .draft-summary {
    border-top: 3px solid var(--color-primary);
  }
  .spin-panel {
    background:
      radial-gradient(
        ellipse at top right,
        color-mix(in srgb, var(--color-primary) 12%, transparent),
        transparent 55%
      ),
      var(--color-surface-1);
  }
</style>
