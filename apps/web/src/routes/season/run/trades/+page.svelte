<script lang="ts">import { getContext } from 'svelte';
import { franchiseIdSchema } from '@hoop-rush/data-contracts';
import { SEASON_RUN_SHELL_CONTEXT, type SeasonRunShellData, } from '$lib/season/season-shell-context';
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
const tradeVm = $derived(tradeBoardViewModel(run) ?? {
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
});
const windowState = $derived(tradeVm.openWindow);
const boardProfiles = $derived(tradeVm.boardProfiles);
const negotiations = $derived(tradeVm.negotiations);
const valueTrends = $derived(tradeVm.valueTrends);
const humanFranchiseKey = $derived.by(() => {
    if (!humanFranchiseId)
        return null;
    const parsed = franchiseIdSchema.safeParse(humanFranchiseId);
    return parsed.success ? parsed.data : null;
});
const humanBalance = $derived(influence !== null && humanFranchiseKey !== null
    ? (influence.balances[humanFranchiseKey] ?? 0)
    : 0);
const commandError = $derived.by(() => {
    const e = shell.commandError;
    if (e === null)
        return null;
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
    void shell.respondToTradeCounter?.({
        windowIndex: windowState.windowIndex,
        inquiryId: input.inquiryId,
        accept: input.accept,
    });
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
    const rec = health.injuries.find((r) => r.playerVersionId === playerVersionId &&
        r.missedGamesRemaining > 0 &&
        r.sameGameReturned !== true);
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
    {commandError}
    {busy}
    playerName={playerNameOf}
    {playableOf}
    {availableOf}
  />

  <div class="mt-6 rounded-xl border border-border bg-surface-1 p-4 sm:p-5">
    <p class="text-sm text-muted-foreground">One deal at a time, up to 3 offers each.</p>
  </div>
</div>
