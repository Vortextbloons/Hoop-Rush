<script lang="ts">
  import { Dialog } from 'bits-ui';
  import { X } from '@lucide/svelte';
  import { tradeResolvedAt } from '$lib/season/season-trade-view';
  import type { TradeOfferViewModel } from '$lib/season/season-trade-view';
  import { formatPositions } from '$lib/player-positions';

  /**
   * Trade offers panel (M2.5): while a trade window is open the hub shows
   * every open human offer with its full rationale — incoming/outgoing
   * players (with health flags), value band, role fit, roster need,
   * projected rotation change, and chemistry disruption. Accept/Decline open
   * explicit confirm dialogs; resolved offers render their recorded status.
   */

  let {
    windowIndex,
    offers,
    busy = false,
    onAccept,
    onDecline,
  }: {
    windowIndex: number;
    offers: TradeOfferViewModel[];
    busy?: boolean;
    onAccept: (offerId: string) => void;
    onDecline: (offerId: string) => void;
  } = $props();

  let pendingOffer: { offer: TradeOfferViewModel; action: 'accept' | 'decline' } | null =
    $state(null);
  let confirmOpen = $state(false);

  function openConfirm(offer: TradeOfferViewModel, action: 'accept' | 'decline'): void {
    if (offer.offer.status !== 'open' || busy) return;
    pendingOffer = { offer, action };
    confirmOpen = true;
  }

  function confirmAction(): void {
    if (pendingOffer === null) return;
    const { offer, action } = pendingOffer;
    confirmOpen = false;
    pendingOffer = null;
    if (action === 'accept') onAccept(offer.offer.offerId);
    else onDecline(offer.offer.offerId);
  }

  function playerList(players: TradeOfferViewModel['incomingPlayers']): string {
    return players
      .map(
        (player) =>
          `${player.displayName}${player.playable.length > 0 ? ` (${formatPositions(player.playable)})` : ''}${
            player.available ? '' : ' — out'
          }`,
      )
      .join(', ');
  }

  function chemistryLabel(vm: TradeOfferViewModel): string {
    return `removes ${String(vm.chemistryDisruption.removedPairs)} ${
      vm.chemistryDisruption.removedPairs === 1 ? 'pair' : 'pairs'
    } · adds ${String(vm.chemistryDisruption.newPairs)} at zero chemistry`;
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
    <span class="font-mono text-[10px] text-muted-foreground">
      Window {windowIndex + 1} of 3 · closes when the next block locks
    </span>
  </div>

  {#if offers.length === 0}
    <p class="mt-2 text-sm text-muted-foreground">
      No open offers in this window — spend 1 Influence on an extra trade offer or move on.
    </p>
  {:else}
    <ul class="mt-2 flex flex-col gap-3">
      {#each offers as vm (vm.offer.offerId)}
        <li class="rounded-lg bg-surface-2 p-3">
          <div class="flex flex-wrap items-baseline justify-between gap-2">
            <p class="text-sm font-semibold">
              {vm.fromFranchiseName}
              <span aria-hidden="true">&rarr;</span>
              you
            </p>
            <span class="font-mono text-[10px] text-muted-foreground">{vm.statusLabel}</span>
          </div>
          <div class="mt-2 flex flex-col gap-1.5 text-sm">
            <p class="min-w-0">
              <span
                class="font-mono text-[10px] font-bold uppercase tracking-[0.12em] text-muted-foreground"
              >
                You give
              </span>
              <span class="ml-2">{playerList(vm.outgoingPlayers)}</span>
            </p>
            <p class="min-w-0">
              <span
                class="font-mono text-[10px] font-bold uppercase tracking-[0.12em] text-muted-foreground"
              >
                You get
              </span>
              <span class="ml-2">{playerList(vm.incomingPlayers)}</span>
            </p>
          </div>
          <dl
            class="mt-2 grid gap-x-4 gap-y-1 font-mono text-[10px] text-muted-foreground sm:grid-cols-2"
          >
            <div class="min-w-0">
              <dt class="font-bold uppercase tracking-[0.12em]">Value</dt>
              <dd class="mt-0.5">{vm.valueBandLabel}</dd>
            </div>
            <div class="min-w-0">
              <dt class="font-bold uppercase tracking-[0.12em]">Role fit</dt>
              <dd class="mt-0.5">{vm.roleFitNotes}</dd>
            </div>
            <div class="min-w-0">
              <dt class="font-bold uppercase tracking-[0.12em]">Roster need</dt>
              <dd class="mt-0.5">{vm.rosterNeedNotes}</dd>
            </div>
            <div class="min-w-0">
              <dt class="font-bold uppercase tracking-[0.12em]">Chemistry</dt>
              <dd class="mt-0.5">{chemistryLabel(vm)}</dd>
            </div>
            <div class="min-w-0 sm:col-span-2">
              <dt class="font-bold uppercase tracking-[0.12em]">Rotation impact</dt>
              <dd class="mt-0.5">{vm.rotationProjection}</dd>
            </div>
          </dl>
          {#if vm.offer.status === 'open'}
            <div class="mt-3 flex flex-wrap items-center gap-2">
              <button
                type="button"
                onclick={() => openConfirm(vm, 'accept')}
                disabled={busy}
                class="inline-flex items-center justify-center rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition-opacity outline-none focus-visible:ring-2 focus-visible:ring-ring hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
              >
                Accept
              </button>
              <button
                type="button"
                onclick={() => openConfirm(vm, 'decline')}
                disabled={busy}
                class="inline-flex items-center justify-center rounded-lg border border-border px-4 py-2 text-sm font-semibold transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring hover:border-line-strong disabled:cursor-not-allowed disabled:opacity-40"
              >
                Decline
              </button>
              <span class="font-mono text-[10px] text-muted-foreground">
                Accepting moves {vm.outgoingPlayers.length}-for-{vm.incomingPlayers.length} · injuries
                and load follow the players
              </span>
            </div>
          {:else}
            <p class="mt-2 font-mono text-[10px] text-muted-foreground">
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

{#if pendingOffer !== null}
  <Dialog.Root
    open={confirmOpen}
    onOpenChange={(open) => {
      if (!open) confirmOpen = false;
    }}
  >
    <Dialog.Portal>
      <Dialog.Overlay class="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm" />
      <Dialog.Content
        class="fixed inset-x-0 bottom-0 z-50 mx-auto max-h-[85dvh] w-full overflow-y-auto rounded-t-2xl border-t border-border bg-card p-4 pb-[max(1.25rem,env(safe-area-inset-bottom))] shadow-2xl shadow-black/40 outline-none sm:bottom-auto sm:left-1/2 sm:top-1/2 sm:max-w-md sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-2xl sm:border sm:pb-4"
      >
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
            ? `You send ${playerList(pendingOffer.offer.outgoingPlayers)} and receive ${playerList(
                pendingOffer.offer.incomingPlayers,
              )}. The trade is atomic: ownership transfers, the rotation repairs deterministically, new pairs start at zero chemistry, and the transaction is recorded.`
            : 'The offer is marked declined and cannot be reopened this window.'}
        </p>
        <div class="mt-4 flex flex-col gap-2 sm:flex-row sm:justify-end">
          <button
            type="button"
            onclick={() => (confirmOpen = false)}
            disabled={busy}
            class="inline-flex items-center justify-center gap-2 rounded-lg border border-border px-4 py-2 text-sm font-semibold transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring hover:border-line-strong disabled:cursor-not-allowed disabled:opacity-40"
          >
            Cancel
          </button>
          <button
            type="button"
            onclick={confirmAction}
            disabled={busy}
            class="inline-flex items-center justify-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition-opacity outline-none focus-visible:ring-2 focus-visible:ring-ring hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
          >
            Confirm
          </button>
        </div>
      </Dialog.Content>
    </Dialog.Portal>
  </Dialog.Root>
{/if}
