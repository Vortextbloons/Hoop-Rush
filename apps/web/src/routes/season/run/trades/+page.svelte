<script lang="ts">
  import { getContext } from 'svelte';
  import { franchiseIdSchema } from '@hoop-rush/data-contracts';
  import {
    SEASON_RUN_SHELL_CONTEXT,
    type SeasonRunShellData,
  } from '$lib/season/season-shell-context';
  import TradeBoardWorkspace from '$lib/components/season/TradeBoardWorkspace.svelte';
  import { tradeBoardViewModel } from '$lib/season/season-hub-state';
  import type { TradePackageDraft } from '$lib/season/season-presentation';
  import { overallRatingOf } from '$lib/season/season-catalog-index';
  import { overallRatingOfSlice } from '$lib/season/season-player-slice';
  const shell = getContext<SeasonRunShellData>(SEASON_RUN_SHELL_CONTEXT);
  let mounted = $state(true);
  $effect(() => {
    mounted = true;
    return () => {
      mounted = false;
    };
  });
  let draft: TradePackageDraft | null = $state(null);
  const run = $derived(shell.run);
  const humanFranchiseId = $derived(shell.humanFranchiseId ?? '');
  const catalog = $derived(shell.catalog);
  const manifest = $derived(shell.manifest);
  const health = $derived(shell.health);
  const influence = $derived(shell.influence);
  const tradeVm = $derived(
    tradeBoardViewModel(run) ?? {
      openWindow: null,
      boardProfiles: [],
      negotiations: [],
      valueTrends: [],
      inquiryAllowance: 3,
      inquiriesUsed: 0,
      inquiriesRemaining: 3,
      purchasedInquiryUsed: false,
      earnedInquiryUsed: false,
      activeInquiryId: null,
      exchangeCounts: {},
      windows: [],
    },
  );
  const windowState = $derived(tradeVm.openWindow);
  const boardProfiles = $derived(tradeVm.boardProfiles);
  const negotiations = $derived(tradeVm.negotiations);
  const valueTrends = $derived(tradeVm.valueTrends);
  const humanFranchiseKey = $derived.by(() => {
    if (!humanFranchiseId) return null;
    const parsed = franchiseIdSchema.safeParse(humanFranchiseId);
    return parsed.success ? parsed.data : null;
  });
  const humanBalance = $derived(
    influence !== null && humanFranchiseKey !== null
      ? (influence.balances[humanFranchiseKey] ?? 0)
      : 0,
  );
  const activeNegotiation = $derived(
    windowState?.activeInquiryId
      ? (negotiations.find((n) => n.inquiryId === windowState.activeInquiryId) ?? null)
      : null,
  );
  const theyAsked = $derived(activeNegotiation?.latestRequestedChange ?? null);
  const commandError = $derived.by(() => {
    const e = shell.commandError;
    if (e === null) return null;
    const tradeCommands = new Set([
      'open-trade-inquiry',
      'submit-trade-proposal',
      'respond-to-trade-counter',
      'walk-away-from-trade',
      'purchase-trade-inquiry',
    ]);
    return tradeCommands.has(e.command) ? e.message : null;
  });
  const busy = $derived(shell.block.phase === 'running');
  const summaries = $derived(shell.snapshot?.summaries ?? []);
  function faceOf(playerVersionId: string) {
    return shell.facesByVersion.get(playerVersionId) ?? null;
  }
  function overallOf(playerVersionId: string): number | null {
    return (
      overallRatingOf(shell.catalog, playerVersionId) ??
      overallRatingOfSlice(shell.playerSlice, playerVersionId)
    );
  }
  function handlePurchase(): void {
    if (!mounted || windowState === null || busy) return;
    void shell.purchaseTradeInquiry?.({ windowIndex: windowState.windowIndex });
  }
  function handleSubmit(payload: {
    toFranchiseId: string;
    outgoing: string[];
    incoming: string[];
    influenceAmount: number;
    influenceFromSender: string | null;
  }): void {
    if (!mounted || windowState === null || busy) return;
    void shell.submitTradeProposal?.({
      windowIndex: windowState.windowIndex,
      toFranchiseId: payload.toFranchiseId,
      outgoingPlayerVersionIds: payload.outgoing,
      incomingPlayerVersionIds: payload.incoming,
      influenceAmount: payload.influenceAmount,
      influenceFromSender: payload.influenceFromSender,
    });
  }
  function handleRespond(input: { inquiryId: string; accept: boolean }): void {
    if (!mounted || windowState === null) return;
    void shell.respondToTradeCounter?.({
      windowIndex: windowState.windowIndex,
      inquiryId: input.inquiryId,
      accept: input.accept,
    });
  }
  function handleWalkAway(inquiryId: string): void {
    if (!mounted || windowState === null) return;
    void shell.walkAwayFromTrade?.({ windowIndex: windowState.windowIndex, inquiryId });
  }
  function handleOpenInquiry(toFranchiseId: string): void {
    if (!mounted || windowState === null) return;
    void shell.openTradeInquiry?.({ windowIndex: windowState.windowIndex, toFranchiseId });
  }
  function handleDraftChange(next: {
    partner: string | null;
    outgoing: string[];
    incoming: string[];
    influence: { amount: number; from: string | null };
  }): void {
    draft = {
      partner: next.partner,
      outgoing: [...next.outgoing],
      incoming: [...next.incoming],
      influence: { ...next.influence },
      validation: {
        ok:
          next.outgoing.length >= 1 &&
          next.outgoing.length <= 2 &&
          next.incoming.length >= 1 &&
          next.incoming.length <= 2,
        reason:
          next.outgoing.length < 1 || next.incoming.length < 1
            ? 'Pick at least 1 from each side'
            : next.outgoing.length > 2 || next.incoming.length > 2
              ? 'Max 2 per side'
              : null,
      },
    };
  }
  function playableOf(playerVersionId: string): readonly string[] {
    return shell.playablePositions(playerVersionId);
  }
  function availableOf(playerVersionId: string): boolean {
    if (health === null) return true;
    const rec = health.injuries.find(
      (r) =>
        r.playerVersionId === playerVersionId &&
        r.missedGamesRemaining > 0 &&
        r.sameGameReturned !== true,
    );
    return rec === undefined;
  }
  function playerNameOf(playerVersionId: string): string {
    return shell.playerName(playerVersionId);
  }
</script>

<svelte:head>
  <title>Season Run — Trades — Hoop Rush</title>
</svelte:head>

<div class="pt-6">
  {#if theyAsked !== null}
    <p
      class="mb-3 rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-2 text-sm"
      role="status"
    >
      <span class="font-semibold">They asked:</span>
      {theyAsked}
    </p>
  {/if}

  <TradeBoardWorkspace
    {run}
    {catalog}
    {manifest}
    {windowState}
    {boardProfiles}
    {negotiations}
    {valueTrends}
    {humanFranchiseId}
    {humanBalance}
    onOpenInquiry={handleOpenInquiry}
    onSubmitProposal={handleSubmit}
    onRespond={handleRespond}
    onWalkAway={handleWalkAway}
    onPurchaseInquiry={handlePurchase}
    onDraftChange={handleDraftChange}
    {commandError}
    {busy}
    playerName={playerNameOf}
    {playableOf}
    {availableOf}
    {faceOf}
    {overallOf}
    {summaries}
  />

  <div
    class="sticky bottom-0 z-10 mt-4 rounded-xl border border-border bg-surface-1 px-4 py-3 lg:static"
    role="status"
    aria-live="polite"
    data-testid="trade-sending-bar"
  >
    {#if busy}
      <p class="text-sm font-semibold">Sending…</p>
    {:else if draft !== null && draft.partner !== null && (draft.outgoing.length > 0 || draft.incoming.length > 0)}
      <p class="text-sm">
        Deal: you send {draft.outgoing.length} · you receive {draft.incoming.length}{draft.influence
          .amount > 0
          ? ` · ${draft.influence.amount}◆`
          : ''}
      </p>
    {:else}
      <p class="text-sm text-muted-foreground">Team → Deal → Track — pick a team to start.</p>
    {/if}
  </div>

  <p class="mt-4 text-xs text-muted-foreground">One deal at a time, up to 3 offers each.</p>
</div>

<style>
  @media (prefers-reduced-motion: reduce) {
    * {
      transition: none !important;
    }
  }
</style>
