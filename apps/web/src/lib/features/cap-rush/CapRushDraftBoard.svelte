<script lang="ts">
  import type { CapRushDraftView } from '@hoop-rush/application/cap-rush';
  import {
    CAP_RUSH_CAP_LINE_DOLLARS,
    POSITIONS,
    franchiseAbbreviation,
    type CapRushSpinPurchaseId,
    type Position,
  } from '@hoop-rush/data-contracts';
  import { havocMutationDefinitionOf } from '@hoop-rush/engine';
  import { Check, Lock, Shuffle, Sparkles } from '@lucide/svelte';
  import PlayerFace from '#lib/components/PlayerFace.svelte';
  import TeamLogo from '#lib/components/TeamLogo.svelte';
  import CapRushCard from './CapRushCard.svelte';
  import CapRushLineup from './CapRushLineup.svelte';
  import CapRushPayroll from './CapRushPayroll.svelte';
  import type { CapRushArt } from './cap-rush-art.ts';
  import {
    apronPenaltyTitle,
    capStatusClass,
    capStatusLabel,
    formatMillions,
    initialsOf,
    variantLabel,
  } from './cap-rush-presentation.ts';

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
  const orderedPicks = $derived(
    [...draft.picks].sort(
      (left, right) => POSITIONS.indexOf(left.slot) - POSITIONS.indexOf(right.slot),
    ),
  );
  const target = $derived(view.slots.find((slot) => slot.highestPaid) ?? null);
  const spin = $derived(view.spin);
  const spinTarget = $derived(spinTargetId ?? spin?.targets[0]?.cardId ?? null);

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
      <p class="mt-2 hidden max-w-xl text-sm leading-relaxed text-muted-foreground sm:block">
        {#if complete}
          Every salary is locked. Here is the apron bill and the five you would take into the run.
        {:else}
          Eight players. One exact position. You get two protected rerolls for the whole draft.
        {/if}
      </p>
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
    {#if !complete}
      <CapRushLineup slots={view.slots} {art} />
    {/if}

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
        <div class="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-5">
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
                  <span class="block truncate text-[11px] font-semibold">{player.displayName}</span>
                  <span class="font-mono text-[9px] text-muted-foreground uppercase">Filled</span>
                </span>
              {:else}
                <span class="text-[11px] text-muted-foreground">Open slot</span>
              {/if}
            </button>
          {/each}
        </div>
        <p class="mt-3 text-[11px] leading-relaxed text-muted-foreground">
          Choosing a position opens eight cards at that exact slot. You cannot change the position
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
              Eight cards, one signing
            </h2>
          </div>
          <div class="flex flex-wrap items-center gap-2">
            {#if protectMode}
              <span class="text-[11px] font-semibold text-accent">Pick one card to keep</span>
              <button
                type="button"
                class="inline-flex min-h-9 items-center rounded-lg border border-line-strong px-3 text-xs font-semibold text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
                onclick={() => (protectMode = false)}>Cancel</button
              >
            {:else if draft.rerollsRemaining > 0}
              <button
                type="button"
                class="inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-line-strong px-3 text-xs font-semibold outline-none hover:border-primary hover:text-primary focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
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

        <div class="mt-3 grid grid-cols-2 gap-2 sm:gap-3 md:grid-cols-3 xl:grid-cols-4">
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
            The protected card keeps its player, salary, bucket and display spot. The other seven
            are replaced, and this reroll cannot be undone.
          </p>
        {/if}
      </section>
    {:else if complete}
      <section
        class="rounded-2xl border border-border bg-card p-4 sm:p-5"
        aria-label="Draft summary"
      >
        <div class="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p
              class="font-mono text-[10px] font-bold tracking-[0.16em] text-muted-foreground uppercase"
            >
              {variantLabel(draft.variant)} · Draft complete
            </p>
            <h2 class="font-display mt-1 text-2xl font-extrabold tracking-tight uppercase">
              {formatMillions(view.payrollDollars)} payroll
            </h2>
          </div>
          <span
            class="inline-flex items-center rounded-full border px-3 py-1 font-mono text-[10px] font-bold tracking-[0.12em] uppercase {capStatusClass(
              view.status,
            )}">{capStatusLabel(view.status)}</span
          >
        </div>

        <ul class="mt-4 space-y-2">
          {#each orderedPicks as pick (pick.card.cardId)}
            {@const source = pick.card.source}
            {@const face = art !== null ? art.faceFor(source) : null}
            {@const team = art !== null ? art.teamFor(source.franchiseId) : null}
            <li class="flex items-center justify-between gap-2 rounded-xl bg-surface-1 px-2.5 py-2">
              <span class="flex min-w-0 items-center gap-2">
                <span
                  class="shrink-0 rounded bg-surface-2 px-1.5 py-0.5 font-mono text-[9px] font-bold"
                  >{pick.slot}</span
                >
                {#if face !== null && art !== null}
                  <PlayerFace
                    player={face}
                    manifest={art.manifest}
                    size="sm"
                    fallbackInitials={initialsOf(source.displayName)}
                  />
                {:else}
                  <span
                    class="grid h-9 w-9 shrink-0 place-items-center rounded-md bg-surface-3 font-display text-xs font-extrabold text-muted-foreground"
                    aria-hidden="true">{initialsOf(source.displayName)}</span
                  >
                {/if}
                <span class="min-w-0">
                  <span class="block truncate text-sm font-bold">{source.displayName}</span>
                  <span
                    class="flex min-w-0 items-center gap-1 font-mono text-[9px] text-muted-foreground uppercase"
                  >
                    {#if team !== null && art !== null}
                      <TeamLogo
                        manifest={art.manifest}
                        franchiseId={team.franchiseId}
                        teamExternalId={team.teamExternalId}
                        className="h-3.5 w-3.5"
                      />
                    {/if}
                    <span class="truncate"
                      >{team?.abbreviation ?? franchiseAbbreviation(source.franchiseId)} ·
                      {source.seasonKey} · OVR {source.originalOverall}</span
                    >
                  </span>
                </span>
              </span>
              <span class="shrink-0 font-display text-base font-extrabold tabular-nums"
                >{formatMillions(pick.card.salaryDollars)}</span
              >
            </li>
          {/each}
        </ul>

        <dl class="mt-4 grid gap-2 text-xs sm:grid-cols-2">
          <div class="rounded-xl bg-surface-1 p-3">
            <dt class="font-mono text-[9px] tracking-[0.1em] text-muted-foreground uppercase">
              Apron bill
            </dt>
            <dd class="mt-1 font-semibold">{apronPenaltyTitle(view.status)}</dd>
          </div>
          <div class="rounded-xl bg-surface-1 p-3">
            <dt class="font-mono text-[9px] tracking-[0.1em] text-muted-foreground uppercase">
              Highest-paid target
            </dt>
            <dd class="mt-1 font-semibold">
              {target?.player?.displayName ?? '—'}{#if target}
                <span class="font-mono text-[10px] text-muted-foreground">· {target.slot}</span
                >{/if}
            </dd>
          </div>
        </dl>

        {#if spin !== null}
          <div class="mt-4 rounded-xl border border-primary/30 bg-surface-1 p-3">
            <p class="font-mono text-[9px] tracking-[0.1em] text-muted-foreground uppercase">
              Cap Roulette spin
            </p>
            {#if spin.state.status === 'purchased'}
              {@const receipt = spin.state.receipt}
              {@const definition = havocMutationDefinitionOf(receipt.entry.mutationId)}
              <p class="mt-1 text-sm font-bold">
                {definition.name}
                <span class="font-mono text-[10px] font-normal text-muted-foreground"
                  >· Tier {receipt.tier}</span
                >
              </p>
              <p class="mt-1 text-xs leading-relaxed text-muted-foreground">
                {definition.description}
              </p>
              <p class="mt-2 font-mono text-[10px] text-muted-foreground uppercase">
                {receipt.target.slot} · {spinTargetName(receipt.target.cardId)} · {formatMillions(
                  receipt.priceDollars,
                )}
              </p>
            {:else if spin.state.status === 'skipped'}
              <p class="mt-1 text-sm font-semibold">No spin purchased. Your five stay unmutated.</p>
            {:else}
              <p class="mt-1 text-xs leading-relaxed text-muted-foreground">
                One paid mutation on one signed player, or skip it. You have
                {formatMillions(Math.max(0, CAP_RUSH_CAP_LINE_DOLLARS - view.payrollDollars))} of spin
                room before the {formatMillions(CAP_RUSH_CAP_LINE_DOLLARS)} cap.
              </p>
              <div class="mt-2 flex flex-wrap gap-1.5" role="group" aria-label="Spin target">
                {#each spin.targets as entry (entry.cardId)}
                  {@const active = spinTarget === entry.cardId}
                  <button
                    type="button"
                    aria-pressed={active}
                    class="inline-flex min-h-9 items-center gap-1.5 rounded-lg border px-2.5 text-xs font-semibold outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50 {active
                      ? 'border-primary bg-primary/15 text-foreground'
                      : 'border-line-strong text-muted-foreground hover:text-foreground'}"
                    disabled={busy}
                    onclick={() => (spinTargetId = entry.cardId)}
                  >
                    <span class="font-mono text-[9px]">{entry.slot}</span>
                    <span class="max-w-32 truncate">{entry.player.displayName}</span>
                  </button>
                {/each}
              </div>
              <div class="mt-3 flex flex-wrap items-center gap-2">
                {#each spin.purchases as option (option.purchase)}
                  <button
                    type="button"
                    class="inline-flex min-h-10 flex-col items-start rounded-xl border border-line-strong px-3 py-1.5 text-xs font-bold outline-none hover:border-primary focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
                    disabled={busy || spinTarget === null || !option.eligible}
                    onclick={() => buySpin(option.purchase)}
                  >
                    <span
                      >{option.purchase === 'standard' ? 'Standard' : 'Premium'} · {formatMillions(
                        option.priceDollars,
                      )}</span
                    >
                    <span class="font-mono text-[9px] font-normal text-muted-foreground"
                      >{Math.round(option.tierOdds[1] * 100)}% / {Math.round(
                        option.tierOdds[2] * 100,
                      )}% / {Math.round(option.tierOdds[3] * 100)}% by tier</span
                    >
                    {#if !option.eligible}
                      <span class="font-mono text-[9px] font-normal text-negative"
                        >needs payroll ≤ {formatMillions(option.maxEligiblePayrollDollars)}</span
                      >
                    {/if}
                  </button>
                {/each}
                <button
                  type="button"
                  class="inline-flex min-h-10 items-center rounded-xl border border-line-strong px-3 text-xs font-semibold text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
                  disabled={busy}
                  onclick={onSkipSpin}>Skip the spin</button
                >
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
          <button
            type="button"
            class="inline-flex min-h-11 items-center gap-2 rounded-xl border border-line-strong px-4 text-sm font-semibold outline-none hover:border-negative hover:text-negative focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
            disabled={busy}
            onclick={onDiscard}
          >
            Start a new draft
          </button>
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
                class="inline-flex min-h-9 items-center rounded-lg bg-negative px-3 text-xs font-bold text-white outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
                disabled={busy}
                onclick={onDiscard}>Discard draft</button
              >
              <button
                type="button"
                class="inline-flex min-h-9 items-center rounded-lg border border-line-strong px-3 text-xs font-semibold text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
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
