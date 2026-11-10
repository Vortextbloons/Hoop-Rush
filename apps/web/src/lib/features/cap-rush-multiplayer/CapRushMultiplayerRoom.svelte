<script lang="ts">
  import { onMount, untrack } from 'svelte';
  import { resolve } from '$app/paths';
  import type {
    CapRushMultiplayerMemberSnapshot,
    CapRushMultiplayerSeatId,
  } from '@hoop-rush/data-contracts';
  import RoomShell from '../multiplayer/RoomShell.svelte';
  import MultiplayerLobbyLink from '../multiplayer/MultiplayerLobbyLink.svelte';
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
  import { loadLobbyId } from '#lib/features/multiplayer/multiplayer-lobby.js';
  import { LobbyAutoStart } from '#lib/features/multiplayer/lobby-auto-start.js';

  let { roomId }: { roomId: string } = $props();
  const controller = new CapRushMultiplayerController(untrack(() => roomId));
  const lobbyId = untrack(() => loadLobbyId(roomId));

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
  const bothOnline = $derived(view?.bothOnline ?? false);
  const opponentOnline = $derived(view?.opponentOnline ?? false);
  const connectionLabel = $derived.by(() => {
    switch (view?.connection ?? 'idle') {
      case 'connected':
        return 'connected';
      case 'idle':
      case 'connecting':
        return 'idle';
      case 'error':
        return 'error';
      default:
        return 'reconnecting';
    }
  });
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

  // Shared-lobby matches start once both seats are present. Direct invites keep
  // the explicit Start recruitment button in the room's own lobby.
  const autoStart = new LobbyAutoStart();
  let autoStartFailed = $state(false);
  $effect(() => {
    if (!lobbyId || game === null) return;
    const gate = {
      sharedLobby: true,
      isHost: controller.isHost,
      bothOnline,
      phase: game.phase,
      roomKey: roomId,
    };
    if (!autoStart.shouldStart(gate)) return;
    void autoStart
      .run(roomId, () => controller.startLeague())
      .then(() => {
        autoStartFailed = false;
      })
      .catch(() => {
        autoStartFailed = true;
      });
  });
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
    connection={connectionLabel}
    error={controller.error}
  >
    {#snippet content()}
      {#if view?.connection === 'error'}
        <div
          class="mb-3 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-destructive/40 bg-destructive/10 px-3 py-2.5"
          role="alert"
        >
          <p class="text-xs font-semibold">
            Your connection to this room was interrupted. The room is kept — nothing was lost.
          </p>
          <button
            type="button"
            class="min-h-11 rounded-lg border border-destructive/50 px-3 text-xs font-bold text-destructive outline-none focus-visible:ring-2 focus-visible:ring-ring"
            disabled={controller.busy}
            onclick={() => void controller.reconnect()}
          >
            Reconnect
          </button>
        </div>
      {:else if game !== null && game.phase !== 'lobby' && game.phase !== 'completed' && !opponentOnline}
        <p class="mb-3 text-xs text-muted-foreground" role="status">
          Your opponent is offline. Their seat is kept and your match resumes when they return.
        </p>
      {/if}
      {#if controller.broadcast}
        <CapRushBroadcast
          art={controller.art}
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
          <p class="mt-1 text-sm text-muted-foreground" role="alert">{controller.error}</p>
          <div class="mt-3 flex flex-wrap items-center gap-3">
            <button
              type="button"
              class="inline-flex min-h-11 items-center justify-center rounded-xl border border-primary/50 bg-primary/10 px-4 text-sm font-bold text-primary outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-40"
              disabled={controller.loading}
              onclick={() => void controller.retryLoad()}
            >
              {controller.loading ? 'Retrying…' : 'Try again'}
            </button>
            <a
              class="inline-flex min-h-11 items-center font-bold text-primary"
              href={resolve('/multiplayer')}>Return to the lobby</a
            >
          </div>
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
              {#if lobbyId && !autoStartFailed}
                <p class="text-xs text-muted-foreground" role="status">
                  {bothOnline
                    ? 'Starting the recruitment for both players…'
                    : 'Recruitment starts automatically once your opponent is online.'}
                </p>
              {:else}
                <button
                  type="button"
                  class="inline-flex min-h-11 w-fit items-center justify-center rounded-xl border border-primary/50 bg-primary/10 px-4 text-sm font-bold text-primary outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-40"
                  disabled={controller.busy || !bothOnline}
                  onclick={() => {
                    autoStart.retry(roomId);
                    void controller.startLeague();
                  }}
                >
                  {autoStartFailed ? 'Retry start' : 'Start recruitment'}
                </button>
              {/if}
              {#if !bothOnline}
                <p class="text-xs text-muted-foreground" role="status">
                  Waiting for your opponent to come online.
                </p>
              {/if}
            </div>
          {:else}
            <p class="text-xs text-muted-foreground" role="status">
              {bothOnline
                ? 'Your host starts the recruitment.'
                : 'Waiting for your host and opponent to be online.'}
            </p>
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
                  : 'End auction early'} · {activeRound.endEarlySeats?.length ?? 0}/2
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
            oncancelbid={(round, playerId) => controller.cancelBid(round, playerId)}
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
          <MultiplayerLobbyLink {roomId} completed />
          {#if !lobbyId}
            <a
              class="inline-flex min-h-11 w-fit items-center justify-center rounded-xl border border-border bg-surface-2 px-4 text-sm font-semibold outline-none focus-visible:ring-2 focus-visible:ring-ring"
              href={resolve('/multiplayer')}>Return to the lobby</a
            >
          {/if}
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
