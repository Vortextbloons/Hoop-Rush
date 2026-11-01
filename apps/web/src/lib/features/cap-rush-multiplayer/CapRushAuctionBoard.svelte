<script lang="ts">
  import type {
    CapRushMultiplayerSeatId,
    CapRushMultiplayerState,
    Position,
  } from '@hoop-rush/data-contracts';
  import { POSITIONS } from '@hoop-rush/data-contracts';
  import { onDestroy } from 'svelte';
  import type { CapRushArt } from '../cap-rush/cap-rush-art.js';
  import { capStatusClass, capStatusLabel } from '../cap-rush/cap-rush-presentation.js';
  import { CapRushBidDraft } from './cap-rush-bid-draft.svelte.js';
  import CapRushAuctionLot from './CapRushAuctionLot.svelte';
  import CapRushBidDock from './CapRushBidDock.svelte';
  import CapRushBidEditor from './CapRushBidEditor.svelte';
  import CapRushBidSheet from './CapRushBidSheet.svelte';
  import CapRushRecruitmentCard from './CapRushRecruitmentCard.svelte';
  import CapRushTeamStrip from './CapRushTeamStrip.svelte';
  import { CapRushAuctionMotion } from './cap-rush-multiplayer-motion.js';
  import {
    bidProjection,
    bidQuickChoices,
    bidRejectionNotice,
    clockLabel,
    exactMoney,
    lotState,
    marketPools,
    money,
    nextMinimumBid,
    playerById,
    positionLabel,
    remainingMs,
    seatLabelFor,
    seatPayrollSummary,
    type BidRejectionAction,
    type CapRushBidAttempt,
    type MarketPool,
  } from './cap-rush-multiplayer-presentation.js';

  let {
    game,
    localSeat,
    nowMs,
    art,
    busy = false,
    bidAttempt = null,
    onbid,
    ondismissbid,
  }: {
    game: CapRushMultiplayerState;
    localSeat: CapRushMultiplayerSeatId;
    nowMs: number;
    art: CapRushArt | null;
    busy?: boolean;
    bidAttempt?: CapRushBidAttempt | null;
    onbid: (input: { round: number; playerId: string; totalDollars: number }) => Promise<boolean>;
    ondismissbid?: () => void;
  } = $props();

  const draft = new CapRushBidDraft();
  const motion = $derived(new CapRushAuctionMotion(localSeat));
  let selectedByPool = $state<Record<number, string>>({});
  let inspectedPoolIndex = $state<number | null>(null);
  let sheetOpen = $state(false);
  let submitting = false;
  let lastActiveIndex: number | null = null;
  let lastDraftKey: string | null = null;
  let lastRejectionKey: string | null = null;
  let pricePulseId = $state<string | null>(null);
  let extendedId = $state<string | null>(null);
  let lostLeadNotice = $state<string | null>(null);
  let signingHighlights = $state<{
    p1: Position | null;
    p2: Position | null;
  }>({ p1: null, p2: null });
  let pulseTimer: ReturnType<typeof setTimeout> | null = null;
  let extensionTimer: ReturnType<typeof setTimeout> | null = null;
  let lostLeadTimer: ReturnType<typeof setTimeout> | null = null;
  const signingTimers: Partial<Record<CapRushMultiplayerSeatId, ReturnType<typeof setTimeout>>> =
    {};

  onDestroy(() => {
    if (pulseTimer !== null) clearTimeout(pulseTimer);
    if (extensionTimer !== null) clearTimeout(extensionTimer);
    if (lostLeadTimer !== null) clearTimeout(lostLeadTimer);
    for (const timer of Object.values(signingTimers)) {
      if (timer !== undefined) clearTimeout(timer);
    }
  });

  const recruitment = $derived(game.recruitment);
  const pools = $derived(recruitment === null ? [] : marketPools(recruitment));
  const activePoolIndex = $derived(
    recruitment === null
      ? 0
      : (pools.find((pool) => pool.status === 'active')?.index ?? recruitment.roundIndex),
  );
  const inspectedIndex = $derived(inspectedPoolIndex ?? activePoolIndex);
  const inspectedPool = $derived(pools.find((pool) => pool.index === inspectedIndex) ?? null);
  const activePool = $derived(pools.find((pool) => pool.index === activePoolIndex) ?? null);

  function selectionOf(pool: MarketPool | null) {
    if (pool === null) return null;
    const chosen = selectedByPool[pool.index];
    if (chosen !== undefined) {
      const match = pool.lots.find((lot) => lot.player.playerId === chosen);
      if (match !== undefined) return match;
    }
    return pool.lots.find((lot) => lot.auction?.status === 'open') ?? pool.lots[0] ?? null;
  }

  const inspectedSelection = $derived(selectionOf(inspectedPool));
  const activeSelection = $derived(selectionOf(activePool));

  const bidMinimum = $derived(
    activeSelection === null
      ? 0
      : activeSelection.auction === null
        ? activeSelection.player.minimumBidDollars
        : nextMinimumBid(activeSelection.auction, activeSelection.player),
  );
  const bidChoices = $derived(
    activeSelection === null || activeSelection.auction === null
      ? []
      : bidQuickChoices(activeSelection.auction, activeSelection.player),
  );
  const pendingAttempt = $derived(
    bidAttempt !== null && bidAttempt.state === 'pending' ? bidAttempt : null,
  );
  const rejectedAttempt = $derived(
    bidAttempt !== null && bidAttempt.state === 'rejected' ? bidAttempt : null,
  );
  const pendingName = $derived(
    pendingAttempt === null || recruitment === null
      ? null
      : (playerById(recruitment, pendingAttempt.playerId)?.displayName ?? pendingAttempt.playerId),
  );
  const pendingForActive = $derived(
    pendingAttempt !== null &&
      activeSelection !== null &&
      pendingAttempt.playerId === activeSelection.player.playerId &&
      pendingAttempt.round === activePoolIndex,
  );
  const pendingElsewhere = $derived(pendingAttempt !== null && !pendingForActive);

  const leadPlayerId = $derived(
    recruitment === null ? null : recruitment.seats[localSeat].leadPlayerId,
  );
  const leadPlayerName = $derived(
    leadPlayerId === null || recruitment === null
      ? null
      : (playerById(recruitment, leadPlayerId)?.displayName ?? null),
  );
  const leadsAnotherLot = $derived(
    leadPlayerId !== null &&
      activeSelection !== null &&
      leadPlayerId !== activeSelection.player.playerId,
  );
  const seatFilled = $derived(
    recruitment !== null &&
      activePool !== null &&
      recruitment.seats[localSeat].filledPositions.includes(activePool.position),
  );

  const bidBlock = $derived.by((): { reason: string; playerId: string | null } | null => {
    if (recruitment === null || activePool === null || activeSelection === null) return null;
    if (activePool.status !== 'active') {
      return { reason: 'This position pool is closed for bidding.', playerId: null };
    }
    if (seatFilled) {
      return {
        reason: `You already signed a ${positionLabel(activePool.position).toLowerCase()} this draft.`,
        playerId: null,
      };
    }
    if (activeSelection.auction === null) {
      return { reason: 'This lot has not opened yet.', playerId: null };
    }
    if (activeSelection.auction.status === 'closed') {
      return { reason: 'This lot has closed. Pick an open lot.', playerId: null };
    }
    if (leadsAnotherLot) {
      return {
        reason: `You are already leading ${leadPlayerName ?? 'another lot'}. Only one binding lead is allowed per position.`,
        playerId: leadPlayerId,
      };
    }
    if (busy && pendingAttempt === null) {
      return { reason: 'Another room action is still running.', playerId: null };
    }
    return null;
  });

  const proposedTotal = $derived(draft.proposedTotal);
  const projection = $derived(
    proposedTotal === null ? null : bidProjection(game, localSeat, proposedTotal),
  );
  const payrollSummary = $derived(seatPayrollSummary(game, localSeat));
  const blockedPlayerId = $derived(bidBlock?.playerId ?? null);

  const canSubmitBid = $derived(
    bidBlock === null &&
      pendingAttempt === null &&
      draft.valid &&
      (projection === null || !projection.overHardLimit),
  );

  const rejection = $derived.by(() => {
    const attempt = rejectedAttempt;
    if (attempt === null || recruitment === null) return null;
    const round = recruitment.rounds.find((entry) => entry.index === attempt.round) ?? null;
    const attemptedPlayer = playerById(recruitment, attempt.playerId) ?? null;
    const attemptedAuction =
      round?.auctions.find((entry) => entry.playerId === attempt.playerId) ?? null;
    const nextMinimumDollars =
      attemptedPlayer === null
        ? attempt.totalDollars
        : attemptedAuction === null
          ? attemptedPlayer.minimumBidDollars
          : nextMinimumBid(attemptedAuction, attemptedPlayer);
    const notice = bidRejectionNotice(attempt.code, {
      nextMinimumDollars,
      position: round?.position ?? POSITIONS[attempt.round] ?? activePool?.position ?? 'PG',
      leadPlayerId,
      leadPlayerName,
    });
    const playerName = attemptedPlayer?.displayName ?? attempt.playerId;
    const isTarget = attempt.playerId === activeSelection?.player.playerId;
    return {
      message: isTarget ? notice.message : `${playerName}: ${notice.message}`,
      action: notice.action,
      playerName,
      playerId: attempt.playerId,
      totalDollars: attempt.totalDollars,
      isTarget,
    };
  });

  const activeOpenRemaining = $derived.by(() => {
    if (activePool === null) return null;
    const values = activePool.lots.flatMap((lot) =>
      lot.auction !== null && lot.auction.status === 'open'
        ? [remainingMs(lot.auction.endsAtIso, nowMs)]
        : [],
    );
    return values.length === 0 ? null : Math.min(...values);
  });
  const aggregateClock = $derived(inspectedIndex === activePoolIndex ? activeOpenRemaining : null);
  const aggregateLabel = $derived(
    inspectedIndex !== activePoolIndex
      ? inspectedPool?.status === 'completed'
        ? 'Bidding closed'
        : 'Opens later'
      : activeOpenRemaining === null || activeOpenRemaining === 0
        ? activePool?.status === 'active'
          ? 'Closure pending'
          : 'All lots closed'
        : 'Next lot closes in',
  );
  const inspectedOpenCount = $derived(
    inspectedPool === null
      ? 0
      : inspectedPool.lots.filter((lot) => lot.auction?.status === 'open').length,
  );
  const inspectedPositionName = $derived(
    inspectedPool === null ? 'position' : positionLabel(inspectedPool.position).toLowerCase(),
  );
  const inspectedLotState = $derived.by(() => {
    const selection = inspectedSelection;
    if (selection === null || selection.auction === null) return 'upcoming';
    return lotState(selection.auction, localSeat);
  });

  function poolButtonClass(pool: MarketPool): string {
    if (pool.index === inspectedIndex) return 'border-primary bg-primary/10 text-primary';
    if (pool.status === 'completed') return 'border-positive/40 bg-positive/10 text-positive';
    if (pool.status === 'active') return 'border-accent/50 bg-accent/10 text-accent';
    return 'border-border text-muted-foreground hover:border-line-strong';
  }

  function poolStatusText(status: MarketPool['status']): string {
    return status === 'active' ? 'Live' : status === 'completed' ? 'Done' : 'Next';
  }

  function selectLot(poolIndex: number, playerId: string): void {
    const pool = pools.find((entry) => entry.index === poolIndex) ?? null;
    if (selectionOf(pool)?.player.playerId === playerId) return;
    selectedByPool = { ...selectedByPool, [poolIndex]: playerId };
    dismissRejection();
  }

  function inspectPool(index: number): void {
    inspectedPoolIndex = index;
  }

  function viewPlayer(playerId: string): void {
    inspectedPoolIndex = activePoolIndex;
    selectedByPool = { ...selectedByPool, [activePoolIndex]: playerId };
    dismissRejection();
  }

  function dismissRejection(): void {
    if (bidAttempt?.state === 'pending') return;
    ondismissbid?.();
  }

  function runRejectionAction(action: BidRejectionAction): void {
    if (action.kind === 'use-next-bid') {
      draft.setTotal(action.totalDollars);
      return;
    }
    viewPlayer(action.playerId);
  }

  async function submitBid(totalDollars: number): Promise<void> {
    if (submitting || bidBlock !== null || pendingAttempt !== null) return;
    const target = activeSelection;
    if (target === null || target.auction === null) return;
    submitting = true;
    try {
      const accepted = await onbid({
        round: activePoolIndex,
        playerId: target.player.playerId,
        totalDollars,
      });
      if (accepted) {
        sheetOpen = false;
        draft.useMinimum();
      }
    } finally {
      submitting = false;
    }
  }

  function flashPrice(playerId: string): void {
    pricePulseId = playerId;
    if (pulseTimer !== null) clearTimeout(pulseTimer);
    pulseTimer = setTimeout(() => {
      pricePulseId = null;
      pulseTimer = null;
    }, 220);
  }

  function flashExtension(playerId: string): void {
    extendedId = playerId;
    if (extensionTimer !== null) clearTimeout(extensionTimer);
    extensionTimer = setTimeout(() => {
      extendedId = null;
      extensionTimer = null;
    }, 220);
  }

  function announceLostLead(playerId: string): void {
    if (recruitment === null) return;
    const name = playerById(recruitment, playerId)?.displayName ?? 'That lot';
    const opponent = localSeat === 'p1' ? 'p2' : 'p1';
    lostLeadNotice = `${name}: ${seatLabelFor(opponent, localSeat)} now leads.`;
    if (lostLeadTimer !== null) clearTimeout(lostLeadTimer);
    lostLeadTimer = setTimeout(() => {
      lostLeadNotice = null;
      lostLeadTimer = null;
    }, 4000);
  }

  function announceSigning(seat: CapRushMultiplayerSeatId, position: Position): void {
    signingHighlights = { ...signingHighlights, [seat]: position };
    const existing = signingTimers[seat];
    if (existing !== undefined) clearTimeout(existing);
    signingTimers[seat] = setTimeout(() => {
      signingHighlights = { ...signingHighlights, [seat]: null };
      delete signingTimers[seat];
    }, 900);
  }

  $effect(() => {
    if (recruitment === null) return;
    const pool = inspectedPool;
    if (pool === null) return;
    const chosen = selectedByPool[pool.index];
    if (chosen !== undefined && pool.lots.some((lot) => lot.player.playerId === chosen)) {
      return;
    }
    const first = pool.lots.find((lot) => lot.auction?.status === 'open') ?? pool.lots[0];
    if (first === undefined) return;
    selectedByPool = { ...selectedByPool, [pool.index]: first.player.playerId };
  });

  $effect(() => {
    if (recruitment === null) return;
    const index = activePoolIndex;
    if (lastActiveIndex === index) return;
    lastActiveIndex = index;
    inspectedPoolIndex = index;
    sheetOpen = false;
    const pool = pools.find((entry) => entry.index === index) ?? null;
    if (pool === null) return;
    const first = pool.lots.find((lot) => lot.auction?.status === 'open') ?? pool.lots[0];
    if (first === undefined) return;
    selectedByPool = { ...selectedByPool, [index]: first.player.playerId };
    draft.reset(
      first.auction === null
        ? first.player.minimumBidDollars
        : nextMinimumBid(first.auction, first.player),
    );
    ondismissbid?.();
  });

  $effect(() => {
    const target = activeSelection;
    if (target === null) return;
    const minimum = bidMinimum;
    const key = `${activePoolIndex}:${target.player.playerId}`;
    if (lastDraftKey === key) {
      draft.adoptMinimum(minimum);
      return;
    }
    lastDraftKey = key;
    draft.reset(minimum);
  });

  $effect(() => {
    const attempt = bidAttempt;
    if (attempt === null || attempt.state !== 'rejected') {
      lastRejectionKey = null;
      return;
    }
    const key = `${attempt.round}:${attempt.playerId}:${attempt.totalDollars}:${attempt.code ?? ''}`;
    if (lastRejectionKey === key) return;
    if (attempt.playerId !== activeSelection?.player.playerId) return;
    lastRejectionKey = key;
    draft.setTotal(attempt.totalDollars);
  });

  $effect(() => {
    const events = motion.observe(game);
    for (const event of events) {
      if (event.kind === 'price') flashPrice(event.playerId);
      else if (event.kind === 'extension') flashExtension(event.playerId);
      else if (event.kind === 'lost-lead') announceLostLead(event.playerId);
      else if (event.kind === 'signed') announceSigning(event.signing.seat, event.signing.position);
    }
  });
</script>

{#snippet bidPanel()}
  {#key inspectedSelection?.player.playerId}
    <div class="panel-fade flex flex-col gap-3">
      {#if inspectedSelection === null}
        <p class="rounded-2xl border border-border bg-card p-4 text-sm text-muted-foreground">
          Select a lot to inspect it.
        </p>
      {:else}
        <CapRushRecruitmentCard
          player={inspectedSelection.player}
          auction={inspectedSelection.auction}
          {localSeat}
          {nowMs}
          {art}
          pulse={pricePulseId === inspectedSelection.player.playerId}
          extended={extendedId === inspectedSelection.player.playerId}
        />

        {#if rejection !== null && rejection.isTarget}
          {@const rejectionAction = rejection.action}
          <div
            class="flex flex-col gap-2 rounded-2xl border border-negative/40 bg-negative/10 p-3"
            aria-live="polite"
          >
            <p class="text-xs leading-snug text-negative">{rejection.message}</p>
            <p class="font-mono text-[10px] text-muted-foreground">
              Rejected bid {exactMoney(rejection.totalDollars)}
              {#if !rejection.isTarget}· {rejection.playerName}{/if}
            </p>
            {#if rejectionAction !== null}
              {#if rejectionAction.kind === 'use-next-bid'}
                <button
                  type="button"
                  class="inline-flex min-h-11 w-fit items-center justify-center rounded-xl border border-accent/50 bg-accent/10 px-3 text-xs font-bold text-accent outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  onclick={() => runRejectionAction(rejectionAction)}
                >
                  Use next bid {exactMoney(rejectionAction.totalDollars)}
                </button>
              {:else}
                <button
                  type="button"
                  class="inline-flex min-h-11 w-fit items-center justify-center rounded-xl border border-accent/50 bg-accent/10 px-3 text-xs font-bold text-accent outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  onclick={() => runRejectionAction(rejectionAction)}
                >
                  {rejectionAction.label}
                </button>
              {/if}
            {/if}
          </div>
        {/if}

        {#if pendingElsewhere && pendingAttempt !== null}
          <p
            class="rounded-xl border border-accent/40 bg-accent/5 px-3 py-2 text-xs text-accent"
            aria-live="polite"
          >
            Placing bid… {pendingName ?? ''}
            {exactMoney(pendingAttempt.totalDollars)}
          </p>
        {/if}

        {#if inspectedIndex === activePoolIndex}
          <section class="flex flex-col gap-2" aria-label="Place a bid">
            <CapRushBidEditor
              {draft}
              minimum={bidMinimum}
              choices={bidChoices}
              pending={pendingForActive}
              pendingTotal={pendingForActive && pendingAttempt !== null
                ? pendingAttempt.totalDollars
                : null}
              disabled={bidBlock !== null || pendingAttempt !== null}
              disabledReason={bidBlock?.reason ??
                (pendingElsewhere && pendingAttempt !== null
                  ? `Waiting on ${pendingName ?? 'the other bid'} ${exactMoney(pendingAttempt.totalDollars)}.`
                  : null)}
              overHardLimit={projection?.overHardLimit ?? false}
              onsubmit={(totalDollars) => {
                void submitBid(totalDollars);
              }}
            >
              {#if projection !== null}
                <dl
                  class="grid grid-cols-2 gap-2 rounded-2xl border border-border bg-card p-2.5"
                  aria-label="Payroll projection"
                >
                  <div class="min-w-0">
                    <dt
                      class="font-mono text-[8px] font-bold tracking-[0.08em] text-muted-foreground uppercase"
                    >
                      Signed payroll
                    </dt>
                    <dd class="mt-0.5 font-mono text-xs font-bold tabular-nums">
                      {exactMoney(projection.signedPayrollDollars)}
                    </dd>
                  </div>
                  <div class="min-w-0">
                    <dt
                      class="font-mono text-[8px] font-bold tracking-[0.08em] text-muted-foreground uppercase"
                    >
                      Binding lead
                    </dt>
                    <dd class="mt-0.5 truncate text-xs font-semibold">
                      {payrollSummary.bindingBidDollars === null
                        ? 'None'
                        : `${exactMoney(payrollSummary.bindingBidDollars)} · ${payrollSummary.bindingPlayerName ?? 'player'}`}
                    </dd>
                  </div>
                  <div class="min-w-0">
                    <dt
                      class="font-mono text-[8px] font-bold tracking-[0.08em] text-muted-foreground uppercase"
                    >
                      Projected payroll if won
                    </dt>
                    <dd class="mt-0.5 font-mono text-xs font-bold tabular-nums">
                      {exactMoney(projection.projectedPayrollDollars)}
                    </dd>
                  </div>
                  <div class="min-w-0">
                    <dt
                      class="font-mono text-[8px] font-bold tracking-[0.08em] text-muted-foreground uppercase"
                    >
                      Projected headroom
                    </dt>
                    <dd
                      class="mt-0.5 font-mono text-xs font-bold tabular-nums"
                      class:text-negative={projection.headroomDollars < 0}
                    >
                      {exactMoney(projection.headroomDollars)}
                    </dd>
                  </div>
                </dl>
                <p class="flex flex-wrap items-center gap-2 text-[10px] text-muted-foreground">
                  <span
                    class="inline-flex rounded-full border px-2 py-0.5 font-mono text-[9px] font-bold tracking-[0.06em] uppercase {capStatusClass(
                      projection.status,
                    )}">{capStatusLabel(projection.status)}</span
                  >
                  if this bid wins
                </p>
              {/if}
            </CapRushBidEditor>

            {#if blockedPlayerId !== null}
              <button
                type="button"
                class="inline-flex min-h-11 w-fit items-center justify-center rounded-xl border border-accent/50 bg-accent/10 px-3 text-xs font-bold text-accent outline-none focus-visible:ring-2 focus-visible:ring-ring"
                onclick={() => viewPlayer(blockedPlayerId)}
              >
                View {leadPlayerName ?? 'your lead'}
              </button>
            {/if}
          </section>
        {:else}
          <section class="flex flex-col gap-2 rounded-2xl border border-border bg-card p-3">
            <p class="text-xs leading-snug">
              {inspectedPool?.status === 'completed'
                ? `The ${inspectedPositionName} pool is complete. Bidding is closed.`
                : `Bidding opens when the ${inspectedPositionName} pool becomes active. Inspecting it now does not change the active auction.`}
            </p>
            <button
              type="button"
              class="inline-flex min-h-11 w-fit items-center justify-center rounded-xl border border-primary/50 bg-primary/10 px-3 text-xs font-bold text-primary outline-none focus-visible:ring-2 focus-visible:ring-ring"
              onclick={() => inspectPool(activePoolIndex)}
            >
              Go to the {positionLabel(activePool?.position ?? 'PG')} auction
            </button>
          </section>
        {/if}
      {/if}
    </div>
  {/key}
{/snippet}

{#if recruitment === null || pools.length === 0}
  <p class="rounded-2xl border border-border bg-card p-6 text-sm text-muted-foreground">
    The recruitment market is not open yet.
  </p>
{:else}
  <div
    class="flex w-full min-w-0 flex-col gap-3 pb-[calc(13rem_+_env(safe-area-inset-bottom))] md:pb-0"
  >
    <header class="flex flex-col gap-3 rounded-2xl border border-border bg-card p-3 sm:p-4">
      <div class="flex flex-wrap items-start justify-between gap-3">
        <div class="min-w-0">
          <p
            class="font-mono text-[10px] font-bold tracking-[0.16em] text-muted-foreground uppercase"
          >
            {inspectedPool?.status === 'active'
              ? 'Live auction'
              : inspectedPool?.status === 'completed'
                ? 'Completed pool'
                : 'Upcoming pool'}
          </p>
          <h2
            class="font-display text-2xl leading-tight font-extrabold uppercase tracking-tight sm:text-3xl"
          >
            {inspectedPool === null ? 'Recruitment' : positionLabel(inspectedPool.position)}
          </h2>
          <p class="text-xs text-muted-foreground">
            {inspectedPool?.lots.length ?? 0} lots · {inspectedOpenCount} open · one signing per seat
          </p>
        </div>
        <div class="shrink-0 text-right">
          <p
            class="font-mono text-[9px] font-bold tracking-[0.12em] text-muted-foreground uppercase"
          >
            {aggregateLabel}
          </p>
          <p
            class="font-mono text-2xl leading-none font-semibold tabular-nums sm:text-3xl"
            class:text-negative={aggregateClock !== null && aggregateClock <= 10_000}
          >
            {aggregateClock === null ? '—' : clockLabel(aggregateClock)}
          </p>
        </div>
      </div>

      <ol class="grid grid-cols-5 gap-1.5" aria-label="Position pools">
        {#each pools as pool (pool.index)}
          <li>
            <button
              type="button"
              class="flex min-h-11 w-full flex-col items-center justify-center gap-0.5 rounded-lg border px-1 py-1 outline-none transition-colors duration-150 focus-visible:ring-2 focus-visible:ring-ring {poolButtonClass(
                pool,
              )}"
              aria-pressed={pool.index === inspectedIndex}
              aria-label={`${positionLabel(pool.position)} pool, ${poolStatusText(pool.status)}`}
              onclick={() => inspectPool(pool.index)}
            >
              <span class="font-mono text-xs font-bold">{pool.position}</span>
              <span class="text-[8px] font-semibold tracking-wide uppercase"
                >{poolStatusText(pool.status)}</span
              >
            </button>
          </li>
        {/each}
      </ol>
    </header>

    <CapRushTeamStrip state={game} {localSeat} {art} highlightSignings={signingHighlights} />

    {#if lostLeadNotice !== null}
      <p
        class="rounded-xl border border-accent/50 bg-accent/10 px-3 py-2 text-xs font-semibold text-accent"
        role="status"
        aria-live="polite"
      >
        {lostLeadNotice}
      </p>
    {/if}

    <div
      class="flex min-w-0 flex-col gap-4 md:grid md:grid-cols-[minmax(0,1fr)_20rem] md:items-start lg:grid-cols-[minmax(0,1fr)_22rem]"
    >
      <section class="flex min-w-0 flex-col gap-2" aria-label="Market">
        <p class="text-[10px] text-muted-foreground">
          Market order stays fixed. Selecting a card never spends money.
        </p>
        <div class="grid min-w-0 grid-cols-2 gap-2 lg:grid-cols-3 min-[1440px]:grid-cols-4">
          {#each inspectedPool?.lots ?? [] as lot (lot.player.playerId)}
            <CapRushAuctionLot
              player={lot.player}
              auction={lot.auction}
              {localSeat}
              {nowMs}
              {art}
              selected={inspectedSelection?.player.playerId === lot.player.playerId}
              pulse={pricePulseId === lot.player.playerId}
              extended={extendedId === lot.player.playerId}
              onselect={(playerId) => selectLot(inspectedIndex, playerId)}
            />
          {/each}
        </div>
      </section>

      <aside
        class="hidden min-w-0 flex-col gap-3 md:sticky md:top-4 md:flex md:max-h-[calc(100dvh_-_2rem)] md:self-start md:overflow-y-auto"
        aria-label="Selected player and bid"
        data-player-id={inspectedSelection?.player.playerId ?? ''}
        data-lot-state={inspectedLotState}
        data-selected="true"
      >
        {@render bidPanel()}
      </aside>
    </div>
  </div>

  {#if inspectedSelection !== null}
    <CapRushBidDock
      {draft}
      adjustable={inspectedIndex === activePoolIndex && bidBlock === null}
      player={inspectedSelection.player}
      auction={inspectedSelection.auction}
      {localSeat}
      {nowMs}
      {art}
      proposedTotal={inspectedIndex === activePoolIndex ? proposedTotal : null}
      pending={inspectedIndex === activePoolIndex && pendingForActive}
      pendingTotal={inspectedIndex === activePoolIndex &&
      pendingForActive &&
      pendingAttempt !== null
        ? pendingAttempt.totalDollars
        : null}
      pendingNote={pendingElsewhere && pendingAttempt !== null
        ? `Placing bid… ${pendingName ?? ''} ${exactMoney(pendingAttempt.totalDollars)}`
        : null}
      canSubmit={inspectedIndex === activePoolIndex && canSubmitBid}
      rejectedMessage={rejection === null || !rejection.isTarget ? null : rejection.message}
      onopensheet={() => (sheetOpen = true)}
      onsubmit={() => {
        if (proposedTotal !== null) void submitBid(proposedTotal);
      }}
    />
  {/if}

  <CapRushBidSheet open={sheetOpen} onOpenChange={(open) => (sheetOpen = open)}>
    {#snippet header()}
      <p class="font-mono text-[10px] font-bold tracking-[0.16em] text-primary uppercase">
        {inspectedIndex === activePoolIndex && bidBlock === null ? 'Place a bid' : 'Inspect lot'}
        {#if inspectedSelection !== null}· {inspectedSelection.player.position}{/if}
      </p>
      <p class="truncate font-display text-lg font-extrabold uppercase tracking-tight">
        {inspectedSelection?.player.displayName ?? 'Market'}
      </p>
      <p class="mt-0.5 text-[11px] text-muted-foreground">
        {inspectedSelection === null
          ? 'Pick a lot from the market.'
          : `You · ${inspectedSelection.player.originalOverall} OVR · ${positionLabel(inspectedSelection.player.position)}`}
      </p>
    {/snippet}
    {@render bidPanel()}
  </CapRushBidSheet>
{/if}

<style>
  .panel-fade {
    animation: panel-fade 150ms ease-out;
  }
  @keyframes panel-fade {
    from {
      opacity: 0.6;
    }
    to {
      opacity: 1;
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .panel-fade {
      animation: none;
    }
  }
</style>
