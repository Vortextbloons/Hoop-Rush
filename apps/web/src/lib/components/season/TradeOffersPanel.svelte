<script lang="ts">
  import { Dialog } from 'bits-ui';
  import { ArrowRight, ChevronRight, X } from '@lucide/svelte';
  import type { HoopRushManifest, SeasonDraftCatalog, SeasonGameSummary } from '@hoop-rush/data-contracts';
  import { tradeResolvedAt, type TradeOfferViewModel, type TradePlayerViewModel } from '$lib/season/season-trade-view';
  import type { SeasonFaceRef } from '$lib/season/season-branding';
  import { formatPositions } from '$lib/player-positions';
  import { overallRatingOf, playablePositionsOf } from '$lib/season/season-catalog-index';
  import { playerSeasonStatsRow } from '$lib/season/season-player-stats-view';
  import SeasonPlayerFace from './SeasonPlayerFace.svelte';
  import TradePlayerDetailDialog from './TradePlayerDetailDialog.svelte';

  /**
   * Trade offers panel (M2.5): player headshots, OVR badges, and tap-to-open
   * season stats. Accept/Decline use an always-mounted confirm dialog.
   */

  let {
    windowIndex,
    offers,
    manifest,
    catalog,
    summaries,
    faceOf,
    commandError = null,
    busy = false,
    onAccept,
    onDecline,
  }: {
    windowIndex: number;
    offers: TradeOfferViewModel[];
    manifest: HoopRushManifest;
    catalog: SeasonDraftCatalog | null;
    summaries: readonly SeasonGameSummary[];
    faceOf: (playerVersionId: string) => SeasonFaceRef | null;
    commandError?: string | null;
    busy?: boolean;
    onAccept: (offerId: string) => void | Promise<void>;
    onDecline: (offerId: string) => void | Promise<void>;
  } = $props();

  let pendingOffer: { offer: TradeOfferViewModel; action: 'accept' | 'decline' } | null =
    $state(null);
  let detailPlayer: TradePlayerViewModel | null = $state(null);
  let acting = $state(false);

  function openConfirm(offer: TradeOfferViewModel, action: 'accept' | 'decline'): void {
    if (offer.offer.status !== 'open' || busy || acting) return;
    pendingOffer = { offer, action };
  }

  async function confirmAction(): Promise<void> {
    if (pendingOffer === null || acting) return;
    const { offer, action } = pendingOffer;
    acting = true;
    pendingOffer = null;
    try {
      if (action === 'accept') await onAccept(offer.offer.offerId);
      else await onDecline(offer.offer.offerId);
    } finally {
      acting = false;
    }
  }

  function playerSummary(players: TradePlayerViewModel[]): string {
    return players
      .map(
        (player) =>
          `${player.displayName}${player.playable.length > 0 ? ` (${formatPositions(player.playable)})` : ''}${
            player.available ? '' : ' — out'
          }`,
      )
      .join(', ');
  }

  function healthBadge(player: TradePlayerViewModel): string | null {
    if (!player.available) return 'Out';
    if (player.activeInjuryIds.length > 0) return 'Injured';
    return null;
  }

  function valueLabel(vm: TradeOfferViewModel): string {
    return vm.valueInsight.body.replace(/^[^:]+:\s*/, '');
  }

  function runStatsOf(player: TradePlayerViewModel) {
    return playerSeasonStatsRow({
      playerVersionId: player.playerVersionId,
      displayName: player.displayName,
      seasonKey: player.seasonKey,
      eraId: player.eraId,
      franchiseId: player.franchiseId,
      summaries,
      overallRatingOf: (id) => overallRatingOf(catalog, id),
      playablePositions: (id) => playablePositionsOf(catalog, id),
    });
  }
</script>

<section
  aria-labelledby="trade-offers-heading"
  class="rounded-none bg-surface-1 p-4 sm:rounded-xl"
  data-season-trade-panel
>
  <div class="flex flex-wrap items-baseline justify-between gap-2">
    <h2
      id="trade-offers-heading"
      class="font-display text-base font-extrabold uppercase tracking-tight"
    >
      Trade offers
    </h2>
    <span class="text-xs text-muted-foreground">
      Window {windowIndex + 1} of 3 · closes when the next block locks
    </span>
  </div>

  {#if commandError}
    <p role="alert" class="mt-2 rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm">
      {commandError}
    </p>
  {/if}

  {#if offers.length === 0}
    <p class="mt-2 text-sm text-muted-foreground">
      No open offers in this window — spend 1 Influence on an extra trade offer or move on.
    </p>
  {:else}
    <ul class="mt-3 flex flex-col gap-4">
      {#each offers as vm (`${vm.offer.offerId}:${vm.offer.status}`)}
        <li class="overflow-hidden rounded-xl border border-border bg-surface-2">
          <div
            class="flex flex-wrap items-center justify-between gap-2 border-b border-border px-3 py-2.5 sm:px-4"
          >
            <div class="flex min-w-0 items-center gap-2">
              <p class="truncate text-sm font-semibold">{vm.fromFranchiseName}</p>
              <ArrowRight class="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
              <p class="text-sm font-semibold text-primary">You</p>
            </div>
            <div class="flex items-center gap-2">
              <span class="rounded-full bg-surface-3 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                {vm.tradeSizeLabel}
              </span>
              <span class="text-xs text-muted-foreground">{vm.statusLabel}</span>
            </div>
          </div>

          <p class="border-b border-border px-3 py-2 text-xs text-muted-foreground sm:px-4">
            {valueLabel(vm)}
          </p>

          <div class="grid gap-0 sm:grid-cols-2 sm:gap-px sm:bg-border">
            <div class="bg-surface-2 p-3 sm:p-4">
              <p class="text-[11px] font-bold uppercase tracking-[0.12em] text-rose-400/90">
                You give
              </p>
              <ul class="mt-2 flex flex-col gap-2">
                {#each vm.outgoingPlayers as player (player.playerVersionId)}
                  {@const face = faceOf(player.playerVersionId)}
                  {@const badge = healthBadge(player)}
                  <li>
                    <button
                      type="button"
                      onclick={() => (detailPlayer = player)}
                      class="flex w-full min-w-0 items-center gap-2.5 rounded-lg p-1 text-left transition-colors outline-none hover:bg-surface-3 focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      {#if face !== null}
                        <SeasonPlayerFace {face} {manifest} size="sm" />
                      {:else}
                        <span
                          class="grid h-9 w-9 shrink-0 place-items-center rounded-md bg-surface-3 font-display text-xs font-extrabold text-muted-foreground"
                          aria-hidden="true"
                        >
                          ?
                        </span>
                      {/if}
                      <div class="min-w-0 flex-1">
                        <div class="flex min-w-0 items-center gap-2">
                          <p class="truncate text-sm font-semibold leading-snug">
                            {player.displayName}
                          </p>
                          {#if player.overallRating !== null}
                            <span
                              class="shrink-0 rounded bg-surface-3 px-1.5 py-0.5 font-mono text-[10px] font-bold"
                            >
                              OVR {player.overallRating}
                            </span>
                          {/if}
                        </div>
                        {#if player.playable.length > 0}
                          <p class="text-xs text-muted-foreground">
                            {formatPositions(player.playable)}
                          </p>
                        {/if}
                        {#if player.rotationMinutes !== null}
                          <p class="text-xs text-muted-foreground">
                            {player.rotationMinutes} min in your rotation
                          </p>
                        {/if}
                        {#if badge !== null}
                          <p class="mt-0.5 text-xs font-medium text-amber-400">{badge}</p>
                        {/if}
                      </div>
                      <ChevronRight class="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                    </button>
                  </li>
                {/each}
              </ul>
            </div>

            <div class="border-t border-border bg-surface-2 p-3 sm:border-t-0 sm:p-4">
              <p class="text-[11px] font-bold uppercase tracking-[0.12em] text-emerald-400/90">
                You get
              </p>
              <ul class="mt-2 flex flex-col gap-2">
                {#each vm.incomingPlayers as player (player.playerVersionId)}
                  {@const face = faceOf(player.playerVersionId)}
                  {@const badge = healthBadge(player)}
                  <li>
                    <button
                      type="button"
                      onclick={() => (detailPlayer = player)}
                      class="flex w-full min-w-0 items-center gap-2.5 rounded-lg p-1 text-left transition-colors outline-none hover:bg-surface-3 focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      {#if face !== null}
                        <SeasonPlayerFace {face} {manifest} size="sm" />
                      {:else}
                        <span
                          class="grid h-9 w-9 shrink-0 place-items-center rounded-md bg-surface-3 font-display text-xs font-extrabold text-muted-foreground"
                          aria-hidden="true"
                        >
                          ?
                        </span>
                      {/if}
                      <div class="min-w-0 flex-1">
                        <div class="flex min-w-0 items-center gap-2">
                          <p class="truncate text-sm font-semibold leading-snug">
                            {player.displayName}
                          </p>
                          {#if player.overallRating !== null}
                            <span
                              class="shrink-0 rounded bg-surface-3 px-1.5 py-0.5 font-mono text-[10px] font-bold"
                            >
                              OVR {player.overallRating}
                            </span>
                          {/if}
                        </div>
                        {#if player.playable.length > 0}
                          <p class="text-xs text-muted-foreground">
                            {formatPositions(player.playable)}
                          </p>
                        {/if}
                        {#if player.projectedMinutes !== null}
                          <p class="text-xs text-muted-foreground">
                            ~{player.projectedMinutes} min projected
                          </p>
                        {/if}
                        {#if badge !== null}
                          <p class="mt-0.5 text-xs font-medium text-amber-400">{badge}</p>
                        {/if}
                      </div>
                      <ChevronRight class="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                    </button>
                  </li>
                {/each}
              </ul>
            </div>
          </div>

          {#if vm.offer.status === 'open'}
            <div
              class="flex flex-col gap-2 border-t border-border px-3 py-3 sm:flex-row sm:items-center sm:px-4"
            >
              <div class="flex flex-wrap gap-2">
                <button
                  type="button"
                  onclick={() => openConfirm(vm, 'accept')}
                  disabled={busy || acting}
                  class="inline-flex flex-1 items-center justify-center rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground transition-opacity outline-none focus-visible:ring-2 focus-visible:ring-ring hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40 sm:flex-none"
                >
                  {acting ? 'Working…' : 'Accept'}
                </button>
                <button
                  type="button"
                  onclick={() => openConfirm(vm, 'decline')}
                  disabled={busy || acting}
                  class="inline-flex flex-1 items-center justify-center rounded-lg border border-border px-4 py-2.5 text-sm font-semibold transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring hover:border-line-strong disabled:cursor-not-allowed disabled:opacity-40 sm:flex-none"
                >
                  Decline
                </button>
              </div>
              <p class="text-xs text-muted-foreground sm:ml-auto">
                Tap a player for peak-season and run stats.
              </p>
            </div>
          {:else}
            <p class="border-t border-border px-3 py-2 text-xs text-muted-foreground sm:px-4">
              {tradeResolvedAt(vm.offer).label}
            </p>
          {/if}
        </li>
      {/each}
    </ul>
  {/if}
  <p class="sr-only" role="status" aria-live="polite">
    Trade window {windowIndex + 1}: {offers.filter((vm) => vm.offer.status === 'open').length} open offers.
  </p>
</section>

<Dialog.Root
  open={pendingOffer !== null}
  onOpenChange={(open) => {
    if (!open && !acting) pendingOffer = null;
  }}
>
  <Dialog.Portal>
    <Dialog.Overlay class="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm" />
    <Dialog.Content
      class="fixed inset-x-0 bottom-0 z-50 mx-auto max-h-[85dvh] w-full overflow-y-auto rounded-t-2xl border-t border-border bg-card p-4 pb-[max(1.25rem,env(safe-area-inset-bottom))] shadow-2xl shadow-black/40 outline-none sm:bottom-auto sm:left-1/2 sm:top-1/2 sm:max-w-md sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-2xl sm:border sm:pb-4"
    >
      {#if pendingOffer !== null}
        <div class="flex items-start justify-between gap-3">
          <Dialog.Title
            class="font-display truncate text-lg font-extrabold tracking-tight uppercase"
          >
            {pendingOffer.action === 'accept' ? 'Accept this trade?' : 'Decline this trade?'}
          </Dialog.Title>
          <Dialog.Close
            aria-label="Cancel"
            class="grid h-9 w-9 shrink-0 place-items-center rounded-full border border-border text-muted-foreground transition-colors hover:text-foreground"
          >
            <X class="h-4 w-4" />
          </Dialog.Close>
        </div>
        <p class="mt-2 text-sm text-muted-foreground">
          {pendingOffer.action === 'accept'
            ? `You send ${playerSummary(pendingOffer.offer.outgoingPlayers)} and receive ${playerSummary(
                pendingOffer.offer.incomingPlayers,
              )}. Ownership transfers, your rotation fills the open spot, and new teammate pairings start at neutral chemistry.`
            : 'The offer is marked declined and cannot be reopened this window.'}
        </p>
        <div class="mt-4 flex flex-col gap-2 sm:flex-row sm:justify-end">
          <button
            type="button"
            onclick={() => (pendingOffer = null)}
            disabled={acting}
            class="inline-flex items-center justify-center gap-2 rounded-lg border border-border px-4 py-2 text-sm font-semibold transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring hover:border-line-strong disabled:cursor-not-allowed disabled:opacity-40"
          >
            Cancel
          </button>
          <button
            type="button"
            onclick={() => void confirmAction()}
            disabled={acting}
            class="inline-flex items-center justify-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition-opacity outline-none focus-visible:ring-2 focus-visible:ring-ring hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {acting ? 'Working…' : 'Confirm'}
          </button>
        </div>
      {/if}
    </Dialog.Content>
  </Dialog.Portal>
</Dialog.Root>

<TradePlayerDetailDialog
  player={detailPlayer}
  {manifest}
  {catalog}
  face={detailPlayer === null ? null : faceOf(detailPlayer.playerVersionId)}
  runStats={detailPlayer === null ? null : runStatsOf(detailPlayer)}
  onClose={() => (detailPlayer = null)}
/>
