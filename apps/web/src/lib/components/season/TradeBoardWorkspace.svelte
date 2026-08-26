<script lang="ts">import type { SeasonDraftCatalog, SeasonHealthState, SeasonInfluenceState, SeasonRoster, SeasonRun, SeasonTradeBoardTeamProfile, SeasonTradeNegotiation, SeasonTradeValueTrend, SeasonTradeWindowState, } from '@hoop-rush/data-contracts';
import { formatPositions } from '$lib/player-positions';
import { competitorInterestLabel, formatTradeNeeds, formatTradePriority, inquiryCounterLabel, } from '$lib/season/season-presentation';
import PackageBuilder from './PackageBuilder.svelte';
import NegotiationTranscript from './NegotiationTranscript.svelte';
import ValueTrendCell from './ValueTrendCell.svelte';
import SeasonTeamLogo from './SeasonTeamLogo.svelte';
import { franchiseIdentityOf } from '$lib/season/season-branding';
import type { HoopRushManifest } from '@hoop-rush/data-contracts';
let { run, catalog, manifest, windowState, boardProfiles, negotiations, valueTrends, humanFranchiseId, humanBalance, onOpenInquiry, onSubmitProposal, onRespond, onWalkAway, onPurchaseInquiry, commandError = null, busy = false, playerName = (id: string) => id, playableOf = (id: string) => [] as readonly string[], availableOf = (id: string) => true, }: {
    run: SeasonRun | null;
    catalog: SeasonDraftCatalog | null;
    manifest: HoopRushManifest | null;
    windowState: SeasonTradeWindowState | null;
    boardProfiles: SeasonTradeBoardTeamProfile[];
    negotiations: SeasonTradeNegotiation[];
    valueTrends: SeasonTradeValueTrend[];
    humanFranchiseId: string;
    humanBalance: number;
    onOpenInquiry: (toFranchiseId: string) => void;
    onSubmitProposal: (payload: {
        toFranchiseId: string;
        outgoing: string[];
        incoming: string[];
        influenceAmount: number;
        influenceFromSender: string | null;
    }) => void;
    onRespond: (input: {
        inquiryId: string;
        accept: boolean;
    }) => void;
    onWalkAway: (inquiryId: string) => void;
    onPurchaseInquiry: () => void;
    commandError?: string | null;
    busy?: boolean;
    playerName?: (playerVersionId: string) => string;
    playableOf?: (playerVersionId: string) => readonly string[];
    availableOf?: (playerVersionId: string) => boolean;
} = $props();
let selectedFranchiseId: string | null = $state(null);
let mobileTab: 'board' | 'build' | 'negotiate' = $state('board');
let announcement: string = $state('');
const humanRoster = $derived(run?.rosters.find((r) => r.franchiseId === humanFranchiseId) ?? null);
const targetRoster = $derived(selectedFranchiseId ? (run?.rosters.find((r) => r.franchiseId === selectedFranchiseId) ?? null) : null);
const activeNegotiation = $derived(windowState?.activeInquiryId ? negotiations.find((n) => n.inquiryId === windowState.activeInquiryId) ?? null : null);
const inquiryAllowance = $derived(windowState?.inquiryAllowance ?? 3);
const inquiriesUsed = $derived(negotiations.length);
const purchasedUsed = $derived(windowState?.purchasedInquiryUsed ?? false);
const earnedUsed = $derived(windowState?.earnedInquiryUsed ?? false);
const canPurchase = $derived(!purchasedUsed && inquiryAllowance < 5 && humanBalance >= 1);
const selectedProfile = $derived(boardProfiles.find((p) => p.franchiseId === selectedFranchiseId) ?? null);
const humanTrends = $derived(valueTrends.filter((t) => humanRoster?.players.some((p) => p.playerVersionId === t.playerVersionId) ?? false).slice(0, 6));
const closedWindows = $derived(run?.trade?.windows.filter((w) => w.status === 'closed') ?? []);
function selectTeam(franchiseId: string): void {
    selectedFranchiseId = franchiseId;
    mobileTab = 'build';
}
function handlePurchase(): void {
    if (!canPurchase || busy)
        return;
    onPurchaseInquiry();
}
function handleSubmit(payload: {
    outgoing: string[];
    incoming: string[];
    influenceAmount: number;
    influenceFromSender: string | null;
}): void {
    if (selectedFranchiseId === null)
        return;
    onSubmitProposal({ toFranchiseId: selectedFranchiseId, ...payload });
    mobileTab = 'negotiate';
}
$effect(() => {
    if (commandError !== null) {
        announcement = `Rejected: ${commandError}`;
    }
});
$effect(() => {
    if (activeNegotiation?.status === 'accepted')
        announcement = 'Negotiation accepted — announced, focus stays';
    if (activeNegotiation?.status === 'declined')
        announcement = 'Negotiation declined — announced, focus stays';
    if (activeNegotiation?.status === 'walked-away')
        announcement = 'Walked away — no penalty — announced, focus stays';
});
</script>

<section aria-labelledby="trade-board-heading" class="flex flex-col gap-4" data-testid="trade-board-workspace">
  
  <div class="relative overflow-hidden rounded-2xl border border-line-strong bg-surface-1">
    <div class="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-primary via-amber-500 to-sky-500 opacity-80"></div>
    <div class="flex flex-col gap-3 px-4 py-4 sm:px-5">
      <div class="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="trade-board-heading" class="font-display text-2xl font-extrabold uppercase tracking-tight">Trade Board</h2>
        <span class="font-mono text-[10px] font-bold uppercase tracking-[0.14em] text-muted-foreground">
          {#if windowState !== null}Window {windowState.windowIndex + 1} of 3 · block {windowState.blockIndex + 1} opens{/if}
          {#if windowState === null && closedWindows.length > 0}History — {closedWindows.length} closed windows{/if}
          {#if windowState === null && closedWindows.length === 0}No window open — skip without penalty{/if}
        </span>
      </div>

      <div class="flex flex-wrap items-center gap-2 text-xs">
        <span class="rounded-full border border-primary/30 bg-primary/10 px-3 py-1 font-mono text-[11px] font-bold uppercase tracking-[0.12em] text-primary">
          {inquiryCounterLabel(inquiryAllowance, inquiriesUsed, purchasedUsed, earnedUsed)}
        </span>
        <span class="rounded-full border border-border bg-surface-2 px-3 py-1 font-mono text-[11px] text-muted-foreground">
          Active 1 at a time · 3 exchanges max · duplicate rejected no increment
        </span>
        <span class="rounded-full border border-border bg-surface-2 px-3 py-1 font-mono text-[11px] text-muted-foreground">Influence you {humanBalance} · floor 0 · never clamps</span>
      </div>

      {#if windowState !== null}
        <div class="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onclick={handlePurchase}
            disabled={!canPurchase || busy}
            data-testid="purchase-inquiry"
            class="inline-flex h-11 items-center justify-center rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground disabled:opacity-40"
          >
            +1 inquiry for 1 Influence {purchasedUsed ? '(used)' : canPurchase ? '' : '(needs 1)'}
          </button>
          {#if commandError !== null}
            <span role="alert" class="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-1.5 text-sm text-destructive">{commandError}</span>
          {/if}
        </div>
      {/if}
    </div>

    
    <div class="border-t border-border bg-surface-2/60 overflow-hidden">
      <div class="flex animate-[marquee_22s_linear_infinite] motion-safe:animate-[marquee_22s_linear_infinite] motion-reduce:animate-none gap-6 whitespace-nowrap py-2 min-h-11 font-mono text-[10px] font-bold uppercase tracking-[0.14em] text-muted-foreground" aria-hidden="true">
        <span class="shrink-0">acceptable</span><span class="text-primary">·</span><span class="shrink-0">close needs more value</span><span class="text-primary">·</span><span class="shrink-0">wrong roster fit</span><span class="text-primary">·</span><span class="shrink-0">unacceptable injury/availability risk</span><span class="text-primary">·</span><span class="shrink-0">protected player</span><span class="text-primary">·</span><span class="shrink-0">illegal roster/rotation</span><span class="text-primary">·</span><span class="shrink-0">negotiations closed</span>
        <span class="shrink-0">acceptable</span><span class="text-primary">·</span><span class="shrink-0">close needs more value</span><span class="text-primary">·</span><span class="shrink-0">wrong roster fit</span>
      </div>
    </div>
  </div>

  
  <div class="flex gap-1 rounded-xl bg-surface-2 p-1 lg:hidden" role="tablist" aria-label="Trade board sections">
    {#each [{id:'board',label:'Board'},{id:'build',label:'Builder'},{id:'negotiate',label:'Negotiation'}] as tab (tab.id)}
      <button
        type="button"
        role="tab"
        aria-selected={mobileTab === tab.id}
        aria-controls={`panel-${tab.id}`}
        onclick={() => (mobileTab = tab.id as typeof mobileTab)}
        class="flex-1 rounded-lg px-3 py-2 min-h-11 text-sm font-semibold outline-none focus-visible:ring-2 focus-visible:ring-ring {mobileTab === tab.id ? 'bg-card shadow border border-border text-foreground' : 'text-muted-foreground hover:text-foreground'}"
      >
        {tab.label}
      </button>
    {/each}
  </div>

  
  <div class="grid gap-4 lg:grid-cols-[360px_minmax(0,1fr)_380px] lg:items-start">
    
    <div
      id="panel-board"
      role="tabpanel"
      aria-label="Team board"
      class="flex flex-col gap-3 {mobileTab !== 'board' ? 'hidden lg:flex' : ''}"
    >
      <div class="rounded-xl border border-border bg-surface-1">
        <div class="border-b border-border bg-surface-2 px-4 py-3 flex items-baseline justify-between">
          <h3 class="font-mono text-[11px] font-bold uppercase tracking-[0.14em] text-muted-foreground">Board · 8 teams</h3>
          <span class="font-mono text-[10px] text-muted-foreground">Tap to browse — free</span>
        </div>
        {#if windowState === null}
          <p class="p-4 text-sm text-muted-foreground">No board this window. You may skip to next block; AI transactions still resolve. History below.</p>
        {:else if boardProfiles.length === 0}
          <p class="p-4 text-sm text-muted-foreground">Board is assembling…</p>
        {:else}
          <ul class="flex flex-col divide-y divide-border/60 max-h-[640px] overflow-auto overscroll-contain p-2" role="listbox" aria-label="Trade board teams">
            {#each boardProfiles as profile (profile.franchiseId)}
              {@const identity = manifest ? franchiseIdentityOf(manifest, profile.franchiseId) : null}
              <li>
                <button
                  type="button"
                  role="option"
                  aria-selected={selectedFranchiseId === profile.franchiseId}
                  onclick={() => selectTeam(profile.franchiseId)}
                  class="group relative flex w-full flex-col gap-2 rounded-xl border bg-card p-3 text-left outline-none transition-all hover:-translate-y-0.5 hover:shadow-md focus-visible:ring-2 focus-visible:ring-ring {selectedFranchiseId === profile.franchiseId ? 'border-primary bg-primary/5 ring-1 ring-primary' : 'border-border'}"
                  data-testid={`board-team-${profile.franchiseId}`}
                >
                  
                  <span class="pointer-events-none absolute left-1/2 top-1.5 h-2 w-2 -translate-x-1/2 rounded-full bg-primary shadow-sm ring-2 ring-primary/20"></span>
                  
                  <span class="pointer-events-none absolute inset-y-0 left-0 w-1 rounded-l-xl bg-[repeating-linear-gradient(180deg,transparent_0_6px,var(--color-border)_6px_8px)] opacity-40"></span>

                  <span class="flex items-center gap-2 pt-1">
                    {#if manifest && identity}
                      <SeasonTeamLogo manifest={manifest} franchiseId={profile.franchiseId} teamExternalId={identity.teamExternalId} size="sm" />
                    {/if}
                    <span class="min-w-0 flex-1">
                      <span class="block truncate font-display text-sm font-extrabold uppercase tracking-tight">{manifest ? (manifest.modernFranchiseSlots.find(s=>s.franchiseId===profile.franchiseId)?.displayName ?? profile.franchiseId) : profile.franchiseId}</span>
                      <span class="block font-mono text-[10px] text-muted-foreground">Priority: {formatTradePriority(profile.priority)} · {formatTradeNeeds(profile.needs)}</span>
                    </span>
                    {#if activeNegotiation?.toFranchiseId === profile.franchiseId}
                      <span class="shrink-0 rounded-full bg-primary px-2 py-0.5 font-mono text-[10px] font-bold text-primary-foreground">Active</span>
                    {/if}
                  </span>

                  <span class="flex flex-wrap gap-1.5">
                    {#each profile.needs as need (need)}<span class="rounded-full bg-surface-3 px-2 py-0.5 font-mono text-[10px] font-semibold text-muted-foreground">{formatTradeNeeds([need])}</span>{/each}
                  </span>

                  <span class="text-xs leading-snug text-muted-foreground line-clamp-2">{profile.rationale}</span>

                  <span class="flex flex-col gap-1 rounded-lg bg-surface-2 p-2">
                    <span class="font-mono text-[10px] font-bold uppercase tracking-[0.12em] text-muted-foreground">Availability</span>
                    <span class="text-xs"><span class="font-semibold text-foreground">Listed:</span> {profile.listedPlayerIds.map(playerName).join(' · ') || '—'}</span>
                    <span class="text-xs"><span class="font-semibold text-foreground">Discussable:</span> {profile.discussablePlayerIds.map(playerName).join(' · ') || '—'}</span>
                    <span class="text-xs"><span class="font-semibold text-destructive">Protected:</span> {profile.protectedPlayerIds.map(playerName).join(' · ') || '—'}</span>
                  </span>

                  <span class="rounded-lg border border-amber-500/20 bg-amber-500/5 p-2">
                    <span class="block font-mono text-[10px] font-bold uppercase tracking-[0.12em] text-amber-700 dark:text-amber-300">Hard constraints</span>
                    <ul class="mt-1 flex flex-col gap-0.5">
                      {#each profile.hardConstraints as c (c)}<li class="text-xs text-amber-700/90 dark:text-amber-300/90">• {c}</li>{/each}
                    </ul>
                  </span>

                  {#if profile.competitorInterest}
                    <span class="flex flex-wrap gap-1">
                      {#each Object.entries(profile.competitorInterest) as [pid, interest] (pid)}
                        <span class="rounded-full border border-border bg-surface-1 px-2 py-0.5 font-mono text-[10px]">{playerName(pid)}: {competitorInterestLabel(interest)}</span>
                      {/each}
                    </span>
                  {/if}
                </button>
              </li>
            {/each}
          </ul>
        {/if}

        
        {#if closedWindows.length > 0}
          <div class="border-t border-border bg-surface-2/40 p-3">
            <h4 class="font-mono text-[11px] font-bold uppercase tracking-[0.14em] text-muted-foreground">Closed-window history</h4>
            <ul class="mt-2 flex flex-col gap-2">
              {#each closedWindows as win (win.windowIndex)}
                <li class="rounded-lg border border-border bg-card p-2.5">
                  <p class="font-mono text-[10px] font-bold">Window {win.windowIndex + 1} · block {win.blockIndex + 1} · {win.status}</p>
                  <p class="mt-1 text-xs text-muted-foreground">{win.negotiations?.length ?? 0} inquiries · {win.offers.length} offers · {win.boardProfiles?.length ?? 0} board teams</p>
                  {#if win.negotiations && win.negotiations.length > 0}
                    <ul class="mt-1.5 flex flex-col gap-1">
                      {#each win.negotiations.slice(0, 3) as n (n.inquiryId)}
                        <li class="font-mono text-[10px] text-muted-foreground">{n.toFranchiseId} — {n.status} · {n.exchangeCount}/3</li>
                      {/each}
                    </ul>
                  {/if}
                </li>
              {/each}
            </ul>
          </div>
        {/if}
      </div>

      
      <div class="rounded-xl border border-border bg-surface-1 p-3">
        <h4 class="font-mono text-[11px] font-bold uppercase tracking-[0.14em] text-muted-foreground">Your value trends</h4>
        <p class="mt-1 font-mono text-[10px] text-muted-foreground">Categorical movement from saved production, workload, role, availability — never a precise trade-value number.</p>
        {#if humanTrends.length === 0}
          <p class="mt-3 rounded-lg bg-surface-2 p-3 text-sm text-muted-foreground">No trends this window.</p>
        {:else}
          <ul class="mt-3 grid gap-2">
            {#each humanTrends as trend (trend.playerVersionId)}
              <li><ValueTrendCell trend={trend} basis={trend.basis} playerName={playerName(trend.playerVersionId)} /></li>
            {/each}
          </ul>
        {/if}
      </div>
    </div>

    
    <div id="panel-build" role="tabpanel" aria-label="Package builder" class="flex flex-col gap-3 {mobileTab !== 'build' ? 'hidden lg:flex' : ''}">
      {#if windowState === null}
        <div class="rounded-xl border border-dashed border-border bg-surface-1 p-6 text-center">
          <p class="font-display text-base font-extrabold uppercase tracking-tight">No active window</p>
          <p class="mt-1 text-sm text-muted-foreground">Skip the board and submit the block. Campaign and block progression continue. History remains browseable.</p>
          <p class="mt-3 font-mono text-[10px] text-muted-foreground">Teams 29 · Rosters 10–15 · Rotation 10 · Chemistry 45 pairs (1,350 league) · these facts travel with the trade.</p>
        </div>
      {:else if selectedProfile === null || targetRoster === null || humanRoster === null}
        <div class="rounded-xl border border-border bg-card p-6">
          <p class="font-display text-lg font-extrabold uppercase tracking-tight">Pick a team</p>
          <p class="mt-1 text-sm text-muted-foreground">Choose a board team on the left. Browsing is free — an inquiry is opened only when you submit the first proposal. One active negotiation at a time.</p>
          <div class="mt-4 rounded-lg bg-surface-2 p-3 font-mono text-[10px] text-muted-foreground">
            Legal: 1–2 + 1–2 players · 1–2 Influence from one side never both · never Influence-only · canvases show after pick · inquiry shown before submit.
          </div>
        </div>
      {:else}
        {@const yourLites = humanRoster.players.map((p) => ({ playerVersionId: p.playerVersionId, displayName: p.displayName, playable: playableOf(p.playerVersionId), available: availableOf(p.playerVersionId) }))}
        {@const theirLites = targetRoster.players.map((p) => ({ playerVersionId: p.playerVersionId, displayName: p.displayName, playable: playableOf(p.playerVersionId), available: availableOf(p.playerVersionId) }))}
        {@const safeTargetId = selectedFranchiseId ?? ''}
        <PackageBuilder
          yourPlayers={yourLites}
          theirPlayers={theirLites}
          yourRosterSize={humanRoster.players.length}
          theirRosterSize={targetRoster.players.length}
          yourBalance={humanBalance}
          theirBalance={run?.influence.balances[safeTargetId] ?? 2}
          humanFranchiseId={humanFranchiseId}
          targetFranchiseId={safeTargetId}
          targetFranchiseName={manifest ? (manifest.modernFranchiseSlots.find(s=>s.franchiseId===safeTargetId)?.displayName ?? safeTargetId) : safeTargetId}
          inquiryAllowance={inquiryAllowance}
          inquiriesUsed={inquiriesUsed}
          allowanceLabel={inquiryCounterLabel(inquiryAllowance, inquiriesUsed, purchasedUsed, earnedUsed)}
          busy={busy}
          commandError={commandError}
          onSubmit={(payload) => handleSubmit(payload)}
        />
        <p class="rounded-lg border border-border bg-surface-2 px-3 py-2 min-h-11 font-mono text-[10px] text-muted-foreground">
          Tip: Protected players are hard gates. Unacceptable availability risk and illegal roster reject before talent/close checks. Cash consideration only helps within the band (≤10%).
        </p>
      {/if}
    </div>

    
    <div id="panel-negotiate" role="tabpanel" aria-label="Negotiation" class="flex flex-col gap-3 {mobileTab !== 'negotiate' ? 'hidden lg:flex' : ''}">
      <NegotiationTranscript
        negotiation={activeNegotiation}
        inquiryAllowance={inquiryAllowance}
        onAccept={(id) => onRespond({ inquiryId: id, accept: true })}
        onDecline={(id) => onRespond({ inquiryId: id, accept: false })}
        onWalkAway={(id) => onWalkAway(id)}
        onRevision={(id) => {
          // For revision, user must rebuild package — we just focus builder tab to let them submit again
          mobileTab = 'build';
          // Also, for wire, a second human proposal is a new submitTradeProposal with same inquiry? For now, treat as requirement to use PackageBuilder again.
          // We could auto-focus builder.
        }}
        busy={busy}
      />

      
      {#if negotiations.length > 0}
        <div class="rounded-xl border border-border bg-surface-1 p-3">
          <h4 class="font-mono text-[11px] font-bold uppercase tracking-[0.14em] text-muted-foreground">All inquiries this window</h4>
          <ul class="mt-2 flex flex-col gap-1.5 max-h-[320px] overflow-auto">
            {#each negotiations as n (n.inquiryId)}
              <li>
                <button
                  type="button"
                  onclick={() => { selectedFranchiseId = n.toFranchiseId; mobileTab = 'negotiate'; }}
                  class="flex w-full items-center justify-between gap-2 rounded-lg border px-3 py-2 min-h-11 text-left text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring {activeNegotiation?.inquiryId === n.inquiryId ? 'border-primary bg-primary/10' : 'border-border bg-card hover:border-primary/30'}"
                >
                  <span class="min-w-0 flex-1 truncate font-medium">{n.toFranchiseId} · {n.status}</span>
                  <span class="shrink-0 font-mono text-[10px] text-muted-foreground">{n.exchangeCount}/3 · {n.inquiryId.slice(4, 10)}</span>
                </button>
              </li>
            {/each}
          </ul>
          <p class="mt-2 font-mono text-[10px] text-muted-foreground">Reload/cross-tab preserves negotiation; AI transactions revalidate remaining board after any accepted trade.</p>
        </div>
      {/if}

      {#if windowState !== null && activeNegotiation === null && negotiations.length > 0}
        <p class="rounded-lg bg-surface-2 p-3 text-sm text-muted-foreground" role="status">Closed or walked-away inquiries remain in history (browseable, never reopens this window).</p>
      {/if}
    </div>
  </div>

  <p class="sr-only" role="status" aria-live="polite">{announcement}</p>
</section>

<style>
  @keyframes marquee {
    from { transform: translateX(0); }
    to { transform: translateX(-50%); }
  }
  @media (prefers-reduced-motion: reduce) {
    .group {
      transition: none !important;
    }
  }
</style>
