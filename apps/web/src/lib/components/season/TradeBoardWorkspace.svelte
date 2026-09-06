<script lang="ts">
  import type {
    SeasonDraftCatalog,
    SeasonGameSummary,
    SeasonRun,
    SeasonTradeBoardTeamProfile,
    SeasonTradeNegotiation,
    SeasonTradeValueTrend,
    SeasonTradeWindowState,
    HoopRushManifest,
  } from '@hoop-rush/data-contracts';
  import { franchiseIdSchema } from '@hoop-rush/data-contracts';
  import type { SeasonFaceRef } from '$lib/season/season-branding';
  import {
    formatTradeNeeds,
    formatTradePriority,
    humanizeTradeRejection,
    inquiryCounterLabel,
    tradeTalksLabel,
    type TradeWorkspaceStep,
  } from '$lib/season/season-presentation';
  import PackageBuilder from './PackageBuilder.svelte';
  import NegotiationTranscript from './NegotiationTranscript.svelte';
  import SeasonTeamLogo from './SeasonTeamLogo.svelte';
  import { franchiseIdentityOf } from '$lib/season/season-branding';
  import { inquiryAllowanceView } from '$lib/season/season-evolution-view';

  let {
    run,
    catalog = null,
    manifest,
    windowState,
    boardProfiles,
    negotiations,
    valueTrends,
    humanFranchiseId,
    humanBalance,
    onOpenInquiry = () => {},
    onSubmitProposal,
    onRespond,
    onWalkAway,
    onPurchaseInquiry,
    commandError = null,
    busy = false,
    playerName = (id: string) => id,
    playableOf = (id: string) => [] as readonly string[],
    availableOf = (id: string) => true,
    faceOf = null,
    overallOf = null,
    summaries = [],
    onDraftChange = null,
  }: {
    run: SeasonRun | null;
    catalog?: SeasonDraftCatalog | null;
    manifest: HoopRushManifest | null;
    windowState: SeasonTradeWindowState | null;
    boardProfiles: SeasonTradeBoardTeamProfile[];
    negotiations: SeasonTradeNegotiation[];
    valueTrends: SeasonTradeValueTrend[];
    humanFranchiseId: string;
    humanBalance: number;
    onOpenInquiry?: (toFranchiseId: string) => void;
    onSubmitProposal: (payload: {
      toFranchiseId: string;
      outgoing: string[];
      incoming: string[];
      influenceAmount: number;
      influenceFromSender: string | null;
    }) => void;
    onRespond: (input: { inquiryId: string; accept: boolean }) => void;
    onWalkAway: (inquiryId: string) => void;
    onPurchaseInquiry: () => void;
    commandError?: string | null;
    busy?: boolean;
    playerName?: (playerVersionId: string) => string;
    playableOf?: (playerVersionId: string) => readonly string[];
    availableOf?: (playerVersionId: string) => boolean;
    faceOf?: ((playerVersionId: string) => SeasonFaceRef | null) | null;
    overallOf?: ((playerVersionId: string) => number | null) | null;
    summaries?: readonly SeasonGameSummary[];
    onDraftChange?:
      | ((draft: {
          partner: string | null;
          outgoing: string[];
          incoming: string[];
          influence: { amount: number; from: string | null };
        }) => void)
      | null;
  } = $props();

  let selectedFranchiseId: string | null = $state(null);
  let mobileStep: TradeWorkspaceStep = $state('team');
  let announcement: string = $state('');
  let guardMessage: string | null = $state(null);
  let drafts: Record<
    string,
    { outgoing: string[]; incoming: string[]; amount: number; from: string | null }
  > = $state({});
  let lastSubmitted: Record<
    string,
    { outgoing: string[]; incoming: string[]; amount: number; from: string | null }
  > = $state({});
  let prefillKey: string | null = $state(null);

  const humanRoster = $derived(
    run?.rosters.find((r) => r.franchiseId === humanFranchiseId) ?? null,
  );
  const targetRoster = $derived(
    selectedFranchiseId
      ? (run?.rosters.find((r) => r.franchiseId === selectedFranchiseId) ?? null)
      : null,
  );
  const activeNegotiation = $derived(
    windowState?.activeInquiryId
      ? (negotiations.find((n) => n.inquiryId === windowState.activeInquiryId) ?? null)
      : null,
  );
  const inquiryFacts = $derived(inquiryAllowanceView(run ?? { evolution: null }));
  const inquiryAllowance = $derived(windowState?.inquiryAllowance ?? inquiryFacts.base);
  const inquiriesUsed = $derived(negotiations.length);
  const inquiriesRemaining = $derived(Math.max(0, inquiryAllowance - inquiriesUsed));
  const purchasedUsed = $derived(windowState?.purchasedInquiryUsed ?? false);
  const earnedUsed = $derived(windowState?.earnedInquiryUsed ?? false);
  const diagnosticsLabel = $derived(
    inquiryCounterLabel(inquiryAllowance, inquiriesUsed, purchasedUsed, earnedUsed),
  );
  const talksLabel = $derived(tradeTalksLabel(inquiryAllowance, inquiriesUsed));
  const humanizedError = $derived(
    humanizeTradeRejection(commandError, {
      playerNameOf: playerName,
      franchiseNameOf: (fid) =>
        manifest?.modernFranchiseSlots.find((s) => s.franchiseId === fid)?.displayName ?? fid,
      tradeFit: {
        outgoingCount: selectedFranchiseId
          ? (drafts[selectedFranchiseId]?.outgoing.length ?? undefined)
          : undefined,
        incomingCount: selectedFranchiseId
          ? (drafts[selectedFranchiseId]?.incoming.length ?? undefined)
          : undefined,
        toFranchiseName:
          selectedFranchiseId !== null ? franchiseDisplayName(selectedFranchiseId) : null,
        attemptNumber:
          activeNegotiation?.toFranchiseId === selectedFranchiseId
            ? activeNegotiation.exchangeCount
            : 0,
      },
    }),
  );
  const canPurchase = $derived(
    !purchasedUsed &&
      inquiryAllowance < inquiryFacts.cap &&
      humanBalance >= inquiryFacts.purchaseCost,
  );
  const selectedProfile = $derived(
    boardProfiles.find((p) => p.franchiseId === selectedFranchiseId) ?? null,
  );
  const humanTrends = $derived(
    valueTrends
      .filter(
        (t) => humanRoster?.players.some((p) => p.playerVersionId === t.playerVersionId) ?? false,
      )
      .slice(0, 6),
  );
  const closedWindows = $derived(run?.trade?.windows.filter((w) => w.status === 'closed') ?? []);
  const ledgerEntries = $derived(
    (run?.transactions ?? [])
      .filter(
        (t) =>
          t.type === 'trade' || t.type === 'trade-cash-sent' || t.type === 'trade-cash-received',
      )
      .slice(-8)
      .reverse(),
  );
  const isNegotiating = $derived(activeNegotiation !== null);
  const talksPips = $derived(Array.from({ length: inquiryAllowance }, (_, i) => i < inquiriesUsed));

  function franchiseDisplayName(franchiseId: string): string {
    return (
      manifest?.modernFranchiseSlots.find((s) => s.franchiseId === franchiseId)?.displayName ??
      franchiseId
    );
  }

  function selectTeam(franchiseId: string): void {
    guardMessage = null;
    if (
      activeNegotiation !== null &&
      activeNegotiation.toFranchiseId !== franchiseId &&
      (activeNegotiation.status === 'active' || activeNegotiation.status === 'countered')
    ) {
      guardMessage = 'Finish or walk away from the current talk first.';
      return;
    }
    selectedFranchiseId = franchiseId;
    const saved = drafts[franchiseId];
    if (saved !== undefined) {
      prefillKey = `${franchiseId}:${saved.outgoing.join(',')}:${saved.incoming.join(',')}:${String(saved.amount)}:${saved.from ?? 'none'}:${Date.now().toString()}`;
    } else {
      prefillKey = `${franchiseId}:empty:${Date.now().toString()}`;
    }
    mobileStep = 'deal';
  }

  function handlePurchase(): void {
    if (!canPurchase || busy) return;
    onPurchaseInquiry();
  }

  function handleDraftChange(draft: {
    partner: string;
    outgoing: string[];
    incoming: string[];
    influence: { amount: number; from: string | null };
  }): void {
    drafts[draft.partner] = {
      outgoing: [...draft.outgoing],
      incoming: [...draft.incoming],
      amount: draft.influence.amount,
      from: draft.influence.from,
    };
    onDraftChange?.({
      partner: draft.partner,
      outgoing: [...draft.outgoing],
      incoming: [...draft.incoming],
      influence: { ...draft.influence },
    });
  }

  function handleSubmit(payload: {
    outgoing: string[];
    incoming: string[];
    influenceAmount: number;
    influenceFromSender: string | null;
  }): void {
    if (selectedFranchiseId === null) return;
    if (
      activeNegotiation !== null &&
      activeNegotiation.toFranchiseId !== selectedFranchiseId &&
      (activeNegotiation.status === 'active' || activeNegotiation.status === 'countered')
    ) {
      guardMessage = 'Finish or walk away from the current talk first.';
      return;
    }
    lastSubmitted[selectedFranchiseId] = {
      outgoing: [...payload.outgoing],
      incoming: [...payload.incoming],
      amount: payload.influenceAmount,
      from: payload.influenceFromSender,
    };
    drafts[selectedFranchiseId] = { ...lastSubmitted[selectedFranchiseId]! };
    onSubmitProposal({ toFranchiseId: selectedFranchiseId, ...payload });
    mobileStep = 'negotiation';
  }

  function handleRevise(inquiryId: string): void {
    const negotiation = negotiations.find((n) => n.inquiryId === inquiryId) ?? activeNegotiation;
    if (negotiation === null) return;
    const partner = negotiation.toFranchiseId;
    selectedFranchiseId = partner;
    const saved = lastSubmitted[partner] ?? drafts[partner];
    if (saved !== undefined) {
      prefillKey = `revise:${partner}:${saved.outgoing.join(',')}:${saved.incoming.join(',')}:${Date.now().toString()}`;
    } else {
      prefillKey = `revise:${partner}:empty:${Date.now().toString()}`;
    }
    mobileStep = 'deal';
  }

  $effect(() => {
    if (commandError !== null && humanizedError !== null) {
      announcement = humanizedError;
    }
  });
  $effect(() => {
    if (activeNegotiation?.status === 'accepted') announcement = 'Accepted.';
    if (activeNegotiation?.status === 'declined') announcement = 'Declined.';
    if (activeNegotiation?.status === 'walked-away') announcement = 'Walked away — no penalty.';
  });

  const humanMinutesById = $derived.by(() => {
    const rotation = run?.rotations.find((r) => r.franchiseId === humanFranchiseId);
    return new Map((rotation?.targetMinutes ?? []).map((e) => [e.playerVersionId, e.minutes]));
  });
  const targetMinutesById = $derived.by(() => {
    if (selectedFranchiseId === null) return new Map<string, number>();
    const rotation = run?.rotations.find((r) => r.franchiseId === selectedFranchiseId);
    return new Map((rotation?.targetMinutes ?? []).map((e) => [e.playerVersionId, e.minutes]));
  });
  const yourLites = $derived(
    (humanRoster?.players ?? []).map((p) => ({
      playerVersionId: p.playerVersionId,
      displayName: p.displayName,
      playable: playableOf(p.playerVersionId),
      available: availableOf(p.playerVersionId),
      rotationMinutes: humanMinutesById.get(p.playerVersionId) ?? null,
      projectedMinutes: null as number | null,
      overallRating: overallOf?.(p.playerVersionId) ?? null,
      franchiseId: p.franchiseId,
      eraId: p.eraId,
      seasonKey: p.seasonKey,
    })),
  );
  const theirLites = $derived(
    (targetRoster?.players ?? []).map((p) => ({
      playerVersionId: p.playerVersionId,
      displayName: p.displayName,
      playable: playableOf(p.playerVersionId),
      available: availableOf(p.playerVersionId),
      rotationMinutes: null as number | null,
      projectedMinutes: targetMinutesById.get(p.playerVersionId) ?? 16,
      overallRating: overallOf?.(p.playerVersionId) ?? null,
      franchiseId: p.franchiseId,
      eraId: p.eraId,
      seasonKey: p.seasonKey,
    })),
  );
  const draftForBuilder = $derived(
    selectedFranchiseId !== null ? (drafts[selectedFranchiseId] ?? null) : null,
  );
  const builderInitialOutgoing = $derived(draftForBuilder?.outgoing ?? []);
  const builderInitialIncoming = $derived(draftForBuilder?.incoming ?? []);
  const builderInitialAmount = $derived(draftForBuilder?.amount ?? 0);
  const builderInitialFrom = $derived(draftForBuilder?.from ?? null);
</script>

<section
  aria-labelledby="trade-board-heading"
  class="flex flex-col gap-4"
  data-testid="trade-board-workspace"
>
  <div class="rounded-xl border border-border bg-surface-1 px-4 py-3">
    <div class="flex flex-wrap items-baseline justify-between gap-2">
      <h2 id="trade-board-heading" class="text-lg font-bold uppercase tracking-tight">Trades</h2>
      <span class="text-xs text-muted-foreground">
        {#if windowState !== null}
          Window {windowState.windowIndex + 1} of 3 · closes after Block {windowState.blockIndex +
            1}
        {:else if closedWindows.length > 0}
          Past windows: {closedWindows.length}
        {:else}
          No trades right now
        {/if}
      </span>
    </div>
    <div class="mt-2 flex flex-wrap items-center gap-2 text-xs">
      <span class="font-semibold" aria-live="polite" title={diagnosticsLabel}>{talksLabel}</span>
      <span
        class="inline-flex items-center gap-1"
        aria-label={`${inquiriesUsed} of ${inquiryAllowance} talks used`}
      >
        {#each talksPips as used, i (i)}
          <span
            class="inline-block h-2 w-2 rounded-full {used ? 'bg-primary' : 'bg-border'}"
            aria-hidden="true"
          ></span>
        {/each}
      </span>
      <span class="text-muted-foreground">closes when next block locks</span>
      <span class="text-muted-foreground" title="Your Influence balance">◆ {humanBalance}</span>
      {#if windowState !== null}
        <button
          type="button"
          onclick={handlePurchase}
          disabled={!canPurchase || busy}
          data-testid="purchase-inquiry"
          class="inline-flex min-h-11 items-center rounded-lg border border-border px-3 text-xs font-semibold outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-40"
        >
          {purchasedUsed ? 'Extra talk used' : `+1 talk — ${inquiryFacts.purchaseCost}◆`}
        </button>
      {/if}
    </div>
    {#if guardMessage !== null}
      <p
        role="alert"
        class="mt-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm"
      >
        {guardMessage}
      </p>
    {/if}
    {#if humanizedError !== null}
      <p
        role="alert"
        class="mt-2 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm"
      >
        {humanizedError}
      </p>
    {/if}
    {#if activeNegotiation?.latestRequestedChange !== null && activeNegotiation?.latestRequestedChange !== undefined}
      <p class="mt-2 rounded-lg bg-amber-500/10 px-3 py-2 text-sm" role="status">
        <span class="font-semibold">They asked:</span>
        {activeNegotiation.latestRequestedChange}
      </p>
    {/if}
  </div>

  <div
    class="flex gap-1 rounded-xl bg-surface-2 p-1 lg:hidden"
    role="tablist"
    aria-label="Trade sections"
  >
    {#each [{ id: 'team', label: 'Team' }, { id: 'deal', label: 'Deal' }, { id: 'negotiation', label: 'Track' }] as tab (tab.id)}
      <button
        type="button"
        role="tab"
        aria-selected={mobileStep === tab.id}
        aria-controls={`panel-${tab.id}`}
        onclick={() => (mobileStep = tab.id as TradeWorkspaceStep)}
        class="min-h-11 flex-1 rounded-lg px-3 py-2 text-sm font-semibold outline-none focus-visible:ring-2 focus-visible:ring-ring {mobileStep ===
        tab.id
          ? 'border border-border bg-card shadow text-foreground'
          : 'text-muted-foreground'}"
      >
        {tab.label}
      </button>
    {/each}
  </div>

  <div
    class="grid gap-4 lg:items-start {isNegotiating
      ? 'lg:grid-cols-[280px_minmax(0,1fr)_340px]'
      : 'lg:grid-cols-[280px_minmax(0,1fr)]'}"
  >
    <div
      id="panel-team"
      role="tabpanel"
      aria-label="Teams"
      class="flex flex-col gap-3 {mobileStep !== 'team' ? 'hidden lg:flex' : ''}"
    >
      <div class="rounded-xl border border-border bg-surface-1">
        <div class="flex items-baseline justify-between border-b border-border px-4 py-3">
          <h3 class="text-xs font-bold uppercase tracking-wide text-muted-foreground">Teams</h3>
          <span class="text-xs text-muted-foreground">Browsing is free</span>
        </div>
        {#if windowState === null}
          <p class="p-4 text-sm text-muted-foreground">No trades right now. Play the next block.</p>
        {:else if boardProfiles.length === 0}
          <p class="p-4 text-sm text-muted-foreground">Finding trade partners…</p>
        {:else}
          <ul
            class="flex max-h-[640px] flex-col gap-2 overflow-auto p-2"
            aria-label="Trade partners"
          >
            {#each boardProfiles as profile (profile.franchiseId)}
              {@const identity = manifest
                ? franchiseIdentityOf(manifest, profile.franchiseId)
                : null}
              {@const isActive = activeNegotiation?.toFranchiseId === profile.franchiseId}
              {@const isSelected = selectedFranchiseId === profile.franchiseId}
              {@const openTo = profile.listedPlayerIds.length + profile.discussablePlayerIds.length}
              <li>
                <button
                  type="button"
                  aria-pressed={isSelected}
                  onclick={() => selectTeam(profile.franchiseId)}
                  data-testid={`board-team-${profile.franchiseId}`}
                  class="flex w-full items-center gap-2 rounded-xl border bg-card p-3 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring {isSelected
                    ? 'border-primary'
                    : 'border-border'}"
                >
                  {#if manifest && identity}
                    <SeasonTeamLogo
                      {manifest}
                      franchiseId={profile.franchiseId}
                      teamExternalId={identity.teamExternalId}
                      size="sm"
                    />
                  {/if}
                  <span class="min-w-0 flex-1">
                    <span class="block truncate text-sm font-bold uppercase">
                      {franchiseDisplayName(profile.franchiseId)}
                    </span>
                    <span class="block truncate text-xs text-muted-foreground">
                      Wants {formatTradeNeeds(profile.needs)} · Open to {openTo}
                    </span>
                  </span>
                  {#if isActive}
                    <span
                      class="shrink-0 rounded-full bg-primary px-2 py-0.5 text-xs font-bold text-primary-foreground"
                      >Active</span
                    >
                  {/if}
                </button>
              </li>
            {/each}
          </ul>
        {/if}
      </div>
    </div>

    <div
      id="panel-deal"
      role="tabpanel"
      aria-label="Deal"
      class="flex flex-col gap-3 {mobileStep !== 'deal' ? 'hidden lg:flex' : ''}"
    >
      {#if windowState === null}
        <div class="rounded-xl border border-border bg-card p-6 text-center">
          <p class="text-base font-bold uppercase">No trades right now</p>
          <p class="mt-1 text-sm text-muted-foreground">
            Play the next block. Past deals stay below.
          </p>
        </div>
      {:else if selectedProfile === null || targetRoster === null || humanRoster === null}
        <div class="rounded-xl border border-border bg-card p-6 text-center">
          <p class="text-base font-bold uppercase">Pick a team to start a deal</p>
          <p class="mt-1 text-sm text-muted-foreground">
            Browsing is free — the talk starts when you send the first offer.
          </p>
        </div>
      {:else}
        {@const safeTargetId = selectedFranchiseId ?? ''}
        {@const safeTargetKey = franchiseIdSchema.safeParse(safeTargetId)}
        <div class="rounded-xl border border-border bg-surface-1 px-4 py-3">
          <p class="text-sm font-bold">
            YOU ({humanRoster.players.length}) vs {franchiseDisplayName(safeTargetId)} ({targetRoster
              .players.length})
          </p>
          <p class="mt-1 text-xs text-muted-foreground">
            {formatTradePriority(selectedProfile.priority)} priority · Wants {formatTradeNeeds(
              selectedProfile.needs,
            )}
          </p>
          <div class="mt-2 border-t border-border pt-2 text-xs text-muted-foreground">
            <p>
              <span class="font-semibold text-foreground">Listed:</span>
              {selectedProfile.listedPlayerIds.map(playerName).join(' · ') || '—'}
            </p>
            <p>
              <span class="font-semibold text-foreground">Discussable:</span>
              {selectedProfile.discussablePlayerIds.map(playerName).join(' · ') || '—'}
            </p>
            <p>
              <span class="font-semibold text-destructive">Off limits:</span>
              {selectedProfile.protectedPlayerIds.map(playerName).join(' · ') || '—'}
            </p>
            <p class="mt-1">{selectedProfile.rationale}</p>
          </div>
        </div>
        <PackageBuilder
          yourPlayers={yourLites}
          theirPlayers={theirLites}
          yourRosterSize={humanRoster.players.length}
          theirRosterSize={targetRoster.players.length}
          yourBalance={humanBalance}
          theirBalance={safeTargetKey.success
            ? (run?.influence.balances[safeTargetKey.data] ?? 2)
            : 2}
          {humanFranchiseId}
          targetFranchiseId={safeTargetId}
          targetFranchiseName={franchiseDisplayName(safeTargetId)}
          yourProtectedIds={[]}
          theirProtectedIds={selectedProfile.protectedPlayerIds}
          {inquiryAllowance}
          {inquiriesUsed}
          allowanceLabel={talksLabel}
          exchangeCount={activeNegotiation?.toFranchiseId === safeTargetId
            ? (activeNegotiation?.exchangeCount ?? 0)
            : 0}
          exchangeMax={3}
          {busy}
          commandError={humanizedError}
          initialOutgoing={builderInitialOutgoing}
          initialIncoming={builderInitialIncoming}
          initialInfluenceAmount={builderInitialAmount}
          initialInfluenceFrom={builderInitialFrom}
          {prefillKey}
          playerNameOf={playerName}
          franchiseNameOf={franchiseDisplayName}
          {manifest}
          {catalog}
          {faceOf}
          {summaries}
          onSubmit={(payload) => handleSubmit(payload)}
          onDraftChange={handleDraftChange}
        />
      {/if}

      <details class="rounded-xl border border-border bg-surface-1 px-4 py-3">
        <summary
          class="cursor-pointer text-sm font-semibold outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          Past windows ({closedWindows.length})
        </summary>
        {#if closedWindows.length === 0}
          <p class="mt-2 text-sm text-muted-foreground">No past windows yet.</p>
        {:else}
          <ul class="mt-2 flex flex-col gap-2">
            {#each closedWindows as win (win.windowIndex)}
              <li class="rounded-lg border border-border p-2.5 text-xs">
                <p class="font-semibold">Window {win.windowIndex + 1}</p>
                <p class="text-muted-foreground">
                  {win.negotiations?.length ?? 0} talks · {win.offers.length} offers
                </p>
              </li>
            {/each}
          </ul>
        {/if}
      </details>

      <details class="rounded-xl border border-border bg-surface-1 px-4 py-3">
        <summary
          class="cursor-pointer text-sm font-semibold outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          Trends
        </summary>
        {#if humanTrends.length === 0}
          <p class="mt-2 text-sm text-muted-foreground">No trends this window.</p>
        {:else}
          <ul class="mt-2 flex flex-col gap-1.5 text-xs">
            {#each humanTrends as trend (trend.playerVersionId)}
              <li class="rounded-lg border border-border p-2">
                <span class="font-semibold">{playerName(trend.playerVersionId)}</span>
                <span class="text-muted-foreground"> — {trend.trend}</span>
              </li>
            {/each}
          </ul>
        {/if}
      </details>

      <details class="rounded-xl border border-border bg-surface-1 px-4 py-3">
        <summary
          class="cursor-pointer text-sm font-semibold outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          Ledger
        </summary>
        {#if ledgerEntries.length === 0}
          <p class="mt-2 text-sm text-muted-foreground">No trade ledger entries yet.</p>
        {:else}
          <ul class="mt-2 flex flex-col gap-1.5 text-xs">
            {#each ledgerEntries as entry (entry.transactionId)}
              <li class="rounded-lg border border-border p-2">
                <span class="font-semibold">{entry.type}</span>
                <span class="text-muted-foreground"> — {entry.explanation}</span>
              </li>
            {/each}
          </ul>
        {/if}
      </details>
    </div>

    {#if isNegotiating}
      <div
        id="panel-negotiation"
        role="tabpanel"
        aria-label="Track"
        class="flex flex-col gap-3 {mobileStep !== 'negotiation' ? 'hidden lg:flex' : ''}"
      >
        <NegotiationTranscript
          negotiation={activeNegotiation}
          {inquiryAllowance}
          exchangeMax={3}
          commandError={humanizedError}
          playerNameOf={playerName}
          onAccept={(id) => onRespond({ inquiryId: id, accept: true })}
          onDecline={(id) => onRespond({ inquiryId: id, accept: false })}
          onRevision={(id) => handleRevise(id)}
          onWalkAway={(id) => onWalkAway(id)}
          {busy}
        />

        {#if negotiations.length > 0}
          <div class="rounded-xl border border-border bg-surface-1 p-3">
            <h4 class="text-xs font-bold uppercase tracking-wide text-muted-foreground">
              Your talks
            </h4>
            <ul class="mt-2 flex max-h-[320px] flex-col gap-1.5 overflow-auto">
              {#each negotiations as n (n.inquiryId)}
                <li>
                  <button
                    type="button"
                    onclick={() => {
                      selectedFranchiseId = n.toFranchiseId;
                      mobileStep = 'negotiation';
                    }}
                    class="flex min-h-11 w-full items-center justify-between gap-2 rounded-lg border px-3 py-2 text-left text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring {activeNegotiation?.inquiryId ===
                    n.inquiryId
                      ? 'border-primary'
                      : 'border-border bg-card'}"
                  >
                    <span class="min-w-0 flex-1 truncate font-medium">
                      {franchiseDisplayName(n.toFranchiseId)} · {n.status}
                    </span>
                    <span class="shrink-0 text-xs text-muted-foreground">
                      Offer {Math.min(3, n.exchangeCount + 1)} of 3
                    </span>
                  </button>
                </li>
              {/each}
            </ul>
          </div>
        {/if}
      </div>
    {/if}
  </div>

  <p class="sr-only" role="status" aria-live="polite">{announcement}</p>
</section>

<style>
  @media (prefers-reduced-motion: reduce) {
    * {
      transition: none !important;
    }
  }
</style>
