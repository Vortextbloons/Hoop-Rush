<script lang="ts">
  import { onMount } from 'svelte';
  import { resolve } from '$app/paths';
  import type {
    CapRushMultiplayerMemberSnapshot,
    CapRushMultiplayerSeatId,
  } from '@hoop-rush/data-contracts';
  import RoomShell from '../multiplayer/RoomShell.svelte';
  import CapRushAuctionBoard from './CapRushAuctionBoard.svelte';
  import CapRushBroadcast from './CapRushBroadcast.svelte';
  import CapRushFranchiseReveal from './CapRushFranchiseReveal.svelte';
  import CapRushMultiplayerPostseason from './CapRushMultiplayerPostseason.svelte';
  import CapRushMultiplayerResults from './CapRushMultiplayerResults.svelte';
  import CapRushMultiplayerSeason from './CapRushMultiplayerSeason.svelte';
  import CapRushPreparation from './CapRushPreparation.svelte';
  import { CapRushMultiplayerController } from './cap-rush-multiplayer-controller.svelte.js';
  import { seatLabel, seatOrder } from './cap-rush-multiplayer-presentation.js';
  import { variantLabel } from '../cap-rush/cap-rush-presentation.js';

  let { roomId }: { roomId: string } = $props();
  const controller = new CapRushMultiplayerController(roomId);

  onMount(() => {
    void controller.load();
    controller.start();
    return () => controller.dispose();
  });

  const view = $derived(controller.view);
  const game = $derived(view?.state ?? null);
  const seat = $derived(controller.seat);
  const activeRound = $derived(
    game?.recruitment?.rounds.find((round) => round.index === game?.recruitment?.roundIndex),
  );
  const members = $derived(
    view?.snapshot?.members.map((member) => ({
      participantId: member.participantId,
      online: member.online,
    })) ?? [],
  );
  const memberByName = $derived(
    new Map<CapRushMultiplayerSeatId, CapRushMultiplayerMemberSnapshot>(
      view?.snapshot?.members.map((member) => [member.participantId, member]) ?? [],
    ),
  );
  const bothOnline = $derived(view?.connected ?? false);
  const variant = $derived(view?.snapshot?.settings.variant ?? 'clash');
  const localTeamId = $derived(
    game?.locked?.seats[seat].franchise.franchiseId ?? game?.franchises?.[seat].franchiseId ?? '',
  );
  const phaseLabel = $derived(
    game === null
      ? 'Connecting'
      : game.phase === 'recruiting'
        ? 'Auction'
        : game.phase === 'preparation'
          ? 'Preparation'
          : game.phase === 'locking'
            ? 'Confirming rosters'
            : game.phase === 'season'
              ? 'Regular season'
              : game.phase === 'postseason'
                ? 'Playoffs'
                : game.phase === 'completed'
                  ? 'Complete'
                  : game.phase,
  );
  const summary = $derived(variantLabel(variant));
</script>

<div class="mx-auto w-full max-w-[1440px] px-3 pb-8 sm:px-6">
  <RoomShell
    compactMobile
    {roomId}
    title="Cap Rush"
    {summary}
    phase={phaseLabel}
    code={view?.snapshot?.code ?? null}
    participantId={seat}
    {members}
    connection={view?.connected ? 'connected' : 'reconnecting'}
    error={controller.error}
  >
    {#snippet content()}
      {#if controller.broadcast}
        <CapRushBroadcast
          input={controller.broadcast.input}
          result={controller.broadcast.result}
          tape={controller.broadcast.tape}
          speed={controller.broadcast.speed}
          kind={controller.broadcast.kind}
          slot={controller.broadcast.slot}
          {localTeamId}
          oncomplete={() => controller.completeBroadcast()}
          onclose={() => controller.closeBroadcast()}
        />
      {:else if game === null && controller.error}
        <section class="rounded-xl border border-border bg-card p-4">
          <h2 class="font-display text-xl font-bold">Room unavailable</h2>
          <a
            class="mt-3 inline-flex min-h-11 items-center font-bold text-primary"
            href={resolve('/multiplayer')}>Return to the lobby</a
          >
        </section>
      {:else if game === null}
        <div class="flex flex-col gap-3 py-6" role="status" aria-label="Opening the room">
          <div
            class="h-8 w-48 animate-pulse rounded-lg bg-surface-2 motion-reduce:animate-none"
          ></div>
          <div
            class="h-40 w-full animate-pulse rounded-2xl bg-surface-2 motion-reduce:animate-none"
          ></div>
          <p class="text-sm text-muted-foreground">Opening the room…</p>
        </div>
      {:else if game.phase === 'lobby'}
        <section class="flex flex-col gap-4 rounded-2xl border border-border bg-card p-4 sm:p-5">
          <div class="flex flex-wrap items-start justify-between gap-3">
            <div class="min-w-0">
              <p class="font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
                Lobby
              </p>
              <h2 class="font-display text-2xl font-extrabold uppercase tracking-tight">
                {bothOnline ? 'Both seats are in' : 'Waiting for your opponent'}
              </h2>
            </div>
            <span
              class="rounded-full border border-primary/40 bg-primary/10 px-2.5 py-1 font-mono text-[10px] font-bold uppercase text-primary"
            >
              {variantLabel(variant)}
            </span>
          </div>

          <div class="grid gap-2 sm:grid-cols-2">
            {#each seatOrder(seat) as entry (entry)}
              {@const member = memberByName.get(entry) ?? null}
              <article
                class="rounded-xl border px-3 py-2.5 {entry === seat
                  ? 'border-primary/40 bg-card'
                  : 'border-border bg-surface-1'}"
                data-seat={entry}
              >
                <div class="flex items-center justify-between gap-2">
                  <p
                    class="font-mono text-[9px] font-bold uppercase tracking-[0.12em] text-muted-foreground"
                  >
                    {entry === seat ? 'You' : 'Opponent'} · {seatLabel(entry)}
                  </p>
                  <span
                    class="font-mono text-[9px] font-bold uppercase {member?.online
                      ? 'text-positive'
                      : 'text-muted-foreground'}"
                  >
                    {member === null
                      ? 'Open seat'
                      : member.online
                        ? member.ready
                          ? 'Ready'
                          : 'Online'
                        : 'Offline'}
                  </span>
                </div>
                <p
                  class="mt-1 truncate font-display text-lg font-extrabold uppercase tracking-tight"
                >
                  {member?.displayName ?? (entry === seat ? 'You' : 'Open seat')}
                </p>
              </article>
            {/each}
          </div>

          {#if controller.isHost}
            <div class="flex flex-col gap-2">
              <button
                type="button"
                class="inline-flex min-h-11 w-fit items-center justify-center rounded-xl border border-primary/50 bg-primary/10 px-4 text-sm font-bold text-primary outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-40"
                disabled={controller.busy || !bothOnline}
                onclick={() => controller.startLeague()}
              >
                Start recruitment
              </button>
            </div>
          {/if}
        </section>
      {:else if game.phase === 'recruiting'}
        <div class="flex flex-col gap-3">
          <CapRushFranchiseReveal
            state={game}
            localSeat={seat}
            art={controller.art}
            animate={controller.franchiseReveal}
          />
          {#if activeRound?.status === 'bidding'}
            <div
              class="flex flex-wrap items-center justify-end gap-3 rounded-xl border border-border bg-card p-3"
            >
              <button
                type="button"
                class="min-h-11 rounded-xl border border-primary/40 px-4 text-sm font-bold text-primary outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-40"
                disabled={controller.busy}
                onclick={() =>
                  controller.endAuctionEarly(
                    activeRound.index,
                    !(activeRound.endEarlySeats ?? []).includes(seat),
                  )}
              >
                {(activeRound.endEarlySeats ?? []).includes(seat)
                  ? 'Cancel agreement'
                  : 'End auction early'} ? {activeRound.endEarlySeats?.length ?? 0}/2
              </button>
            </div>
          {/if}
          <CapRushAuctionBoard
            {game}
            localSeat={seat}
            nowMs={controller.nowMs}
            art={controller.art}
            busy={controller.busy}
            bidAttempt={controller.bidAttempt}
            onbid={(input) => controller.placeBid(input)}
            ondismissbid={() => controller.dismissBidAttempt()}
          />
        </div>
      {:else if game.phase === 'preparation' || game.phase === 'locking'}
        <CapRushPreparation
          state={game}
          localSeat={seat}
          art={controller.art}
          busy={controller.busy}
          onpurchasemutation={(purchase, targetPlayerId) =>
            void controller.purchaseMutation(purchase, targetPlayerId)}
          onskipmutation={() => controller.skipMutation()}
          onconfirmlock={() => controller.confirmLock()}
        />
      {:else if game.phase === 'season'}
        <CapRushMultiplayerSeason
          state={game}
          localSeat={seat}
          art={controller.art}
          busy={controller.busy}
          broadcastLoading={controller.broadcastLoading}
          onwatchh2h={(gameId) => controller.watchHeadToHead(gameId)}
          onreviewgame={(gameId) => controller.reviewGame(gameId)}
        />
      {:else if game.phase === 'postseason'}
        <CapRushMultiplayerPostseason
          state={game}
          localSeat={seat}
          art={controller.art}
          busy={controller.busy}
          ishost={controller.isHost}
          onchooseplan={(choice) => controller.choosePlayoffPlan(choice)}
          onsimulatestep={() => controller.simulatePlayoffStep()}
          onwatchplayoff={() => controller.watchPlayoffGame()}
          oncomplete={() => controller.completeLeague()}
        />
      {:else if game.phase === 'completed'}
        <div class="flex flex-col gap-4">
          <CapRushMultiplayerResults
            state={game}
            localSeat={seat}
            art={controller.art}
            onreviewgame={(gameId) => controller.reviewGame(gameId)}
          />
          <a
            class="inline-flex min-h-11 w-fit items-center justify-center rounded-xl border border-border bg-surface-2 px-4 text-sm font-semibold outline-none focus-visible:ring-2 focus-visible:ring-ring"
            href={resolve('/multiplayer')}>Return to the lobby</a
          >
        </div>
      {:else}
        <section class="rounded-2xl border border-border bg-card p-5">
          <h2 class="font-display text-2xl font-extrabold uppercase tracking-tight">
            This room is closed
          </h2>
          <p class="mt-1 text-sm text-muted-foreground">
            The room ended with phase {game.phase}. Start a new room from the multiplayer lobby.
          </p>
        </section>
      {/if}
    {/snippet}
  </RoomShell>
</div>
