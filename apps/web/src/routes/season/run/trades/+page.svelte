<script lang="ts">import { getContext } from 'svelte';
import { SEASON_RUN_SHELL_CONTEXT, type SeasonRunShellData } from '$lib/season/season-shell-context';
import TradeBoardWorkspace from '$lib/components/season/TradeBoardWorkspace.svelte';
import { tradeBoardViewModel } from '$lib/season/season-hub-state';
const shell = getContext<SeasonRunShellData>(SEASON_RUN_SHELL_CONTEXT);
let mounted = $state(true);
$effect(() => {
    mounted = true;
    return () => {
        mounted = false;
    };
});
const run = $derived(shell.run);
const humanFranchiseId = $derived(shell.humanFranchiseId ?? '');
const catalog = $derived(shell.catalog);
const manifest = $derived(shell.manifest);
const health = $derived(shell.health);
const influence = $derived(shell.influence);
const tradeVm = $derived(tradeBoardViewModel(run) ?? { openWindow: null, boardProfiles: [], negotiations: [], valueTrends: [], inquiryAllowance: 3, inquiriesUsed: 0, inquiriesRemaining: 3, purchasedInquiryUsed: false, earnedInquiryUsed: false, activeInquiryId: null, exchangeCounts: {}, windows: [] });
const windowState = $derived(tradeVm.openWindow);
const boardProfiles = $derived(tradeVm.boardProfiles);
const negotiations = $derived(tradeVm.negotiations);
const valueTrends = $derived(tradeVm.valueTrends);
const humanBalance = $derived(influence !== null && humanFranchiseId ? (influence.balances[humanFranchiseId] ?? 0) : 0);
const commandError = $derived.by(() => {
    const e = shell.commandError;
    if (e === null)
        return null;
    const tradeCommands = new Set(['open-trade-inquiry', 'submit-trade-proposal', 'respond-to-trade-counter', 'walk-away-from-trade', 'purchase-trade-inquiry']);
    return tradeCommands.has(e.command) ? e.message : null;
});
const busy = $derived(shell.block.phase === 'running');
function handlePurchase(): void {
    if (!mounted || windowState === null || busy)
        return;
    void shell.purchaseTradeInquiry?.({ windowIndex: windowState.windowIndex });
}
function handleSubmit(payload: {
    toFranchiseId: string;
    outgoing: string[];
    incoming: string[];
    influenceAmount: number;
    influenceFromSender: string | null;
}): void {
    if (!mounted || windowState === null || busy)
        return;
    void shell.submitTradeProposal?.({
        windowIndex: windowState.windowIndex,
        toFranchiseId: payload.toFranchiseId,
        outgoingPlayerVersionIds: payload.outgoing,
        incomingPlayerVersionIds: payload.incoming,
        influenceAmount: payload.influenceAmount,
        influenceFromSender: payload.influenceFromSender,
    });
}
function handleRespond(input: {
    inquiryId: string;
    accept: boolean;
}): void {
    if (!mounted || windowState === null)
        return;
    void shell.respondToTradeCounter?.({ windowIndex: windowState.windowIndex, inquiryId: input.inquiryId, accept: input.accept });
}
function handleWalkAway(inquiryId: string): void {
    if (!mounted || windowState === null)
        return;
    void shell.walkAwayFromTrade?.({ windowIndex: windowState.windowIndex, inquiryId });
}
function handleOpenInquiry(toFranchiseId: string): void {
    if (!mounted || windowState === null)
        return;
    void shell.openTradeInquiry?.({ windowIndex: windowState.windowIndex, toFranchiseId });
}
function playableOf(playerVersionId: string): readonly string[] {
    return shell.playablePositions(playerVersionId);
}
function availableOf(playerVersionId: string): boolean {
    if (health === null)
        return true;
    const rec = health.injuries.find((r) => r.playerVersionId === playerVersionId && r.missedGamesRemaining > 0 && r.sameGameReturned !== true);
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
  <TradeBoardWorkspace
    run={run}
    catalog={catalog}
    manifest={manifest}
    windowState={windowState}
    boardProfiles={boardProfiles}
    negotiations={negotiations}
    valueTrends={valueTrends}
    humanFranchiseId={humanFranchiseId}
    humanBalance={humanBalance}
    onOpenInquiry={handleOpenInquiry}
    onSubmitProposal={handleSubmit}
    onRespond={handleRespond}
    onWalkAway={handleWalkAway}
    onPurchaseInquiry={handlePurchase}
    commandError={commandError}
    busy={busy}
    playerName={playerNameOf}
    playableOf={playableOf}
    availableOf={availableOf}
  />

  <div class="mt-6 rounded-xl border border-border bg-surface-1 p-4 sm:p-5">
    <h3 class="font-display text-sm font-extrabold uppercase tracking-tight">How trades work</h3>
    <ul class="mt-2 list-disc pl-5 text-sm text-muted-foreground space-y-1">
      <li>One active negotiation at a time · up to 3 exchanges (1 initial, 2 counter, 3 final accept / revision / walk-away). Walking away has no penalty.</li>
      <li>Duplicate fingerprints are rejected without consuming an exchange — the UI shows the rejection without moving focus.</li>
      <li>Rosters 10–15, rotations ten, chemistry 45 active pairs per team (1,350 league). Details shown before submission.</li>
      <li>Influence 1–2 from one side, never both, never alone, 5% per point / 10% max, floor 0 — spends reject instead of clamping.</li>
      <li>Reload / cross-tab preserves negotiation; after an accepted trade the remaining board revalidates.</li>
      <li>Skip the board to submit the block — AI transactions still resolve at commit, and closed-window history stays browseable.</li>
    </ul>
  </div>
</div>
