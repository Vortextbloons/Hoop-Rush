<script lang="ts">
  import { onMount } from 'svelte';
  import { resolve } from '$app/paths';
  import type { CapRushConferenceSeries, CapRushMultiplayerState } from '@hoop-rush/data-contracts';
  import { POSITIONS } from '@hoop-rush/data-contracts';
  import { capRushSeriesWins } from '@hoop-rush/engine';
  import RoomShell from '../multiplayer/RoomShell.svelte';
  import CapRushAuctionBoard from './CapRushAuctionBoard.svelte';
  import CapRushBroadcast from './CapRushBroadcast.svelte';
  import CapRushBlockPlan from './CapRushBlockPlan.svelte';
  import CapRushSeatLedger from './CapRushSeatLedger.svelte';
  import CapRushSharedProgress from './CapRushSharedProgress.svelte';
  import { CapRushMultiplayerController } from './cap-rush-multiplayer-controller.svelte.js';
  import { money, seatLabelFor } from './cap-rush-multiplayer-presentation.js';

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
  const members = $derived(
    view?.snapshot?.members.map((member) => ({
      participantId: member.participantId,
      online: member.online,
    })) ?? [],
  );
  const phaseLabel = $derived(
    game === null
      ? 'Connecting'
      : game.phase === 'recruiting'
        ? 'Auction'
        : game.phase === 'preparation'
          ? 'Preparation'
          : game.phase === 'locking'
            ? 'Locking rosters'
            : game.phase === 'season'
              ? 'Regular season'
              : game.phase === 'postseason'
                ? 'Playoffs'
                : game.phase === 'completed'
                  ? 'Complete'
                  : game.phase,
  );
  const variant = $derived(view?.snapshot?.settings.variant ?? 'clash');
  const localLocked = $derived(game?.locked?.seats[seat] ?? null);
  const localRoster = $derived(localLocked?.picks ?? []);

  let mutationTarget: string | null = $state(null);
  let mutationPurchase: 'standard' | 'surge' = $state('standard');

  $effect(() => {
    if (mutationTarget !== null && localRoster.some((pick) => pick.playerId === mutationTarget)) {
      return;
    }
    mutationTarget = localRoster[0]?.playerId ?? null;
  });

  function teamName(teamId: string): string {
    const locked = game?.locked ?? null;
    if (locked === null) return teamId;
    if (locked.seats.p1.franchise.franchiseId === teamId)
      return locked.seats.p1.franchise.displayName;
    if (locked.seats.p2.franchise.franchiseId === teamId)
      return locked.seats.p2.franchise.displayName;
    return (
      locked.opponents.find((entry) => entry.team.teamId === teamId)?.team.displayName ?? teamId
    );
  }

  function seriesWinLabel(series: CapRushConferenceSeries): string {
    return `${capRushSeriesWins(series, series.highTeamId)}–${capRushSeriesWins(series, series.lowTeamId)}`;
  }

  function outcomeLabel(value: CapRushMultiplayerState): string {
    return value.postseason?.outcomes[seat].status ?? 'pending';
  }
</script>

<RoomShell
  {roomId}
  title="Cap Rush"
  summary="Two seats, one league. Recruit five, lock the rosters, then play the same 82 games."
  phase={phaseLabel}
  code={view?.snapshot?.code ?? null}
  participantId={seat}
  {members}
  connection={view?.connected ? 'connected' : 'reconnecting'}
  error={controller.error}
>
  {#if controller.broadcast}
    <CapRushBroadcast
      input={controller.broadcast.input}
      result={controller.broadcast.result}
      tape={controller.broadcast.tape}
      speed={controller.broadcast.speed}
      label={controller.broadcast.kind === 'h2h'
        ? 'Head-to-head'
        : controller.broadcast.kind === 'playoff'
          ? 'Playoff'
          : 'Simcast'}
      localTeamId={game?.locked?.seats[seat].franchise.franchiseId ?? ''}
      oncomplete={() => controller.completeBroadcast()}
      onclose={() => controller.closeBroadcast()}
    />
  {:else if controller.loading || game === null}
    <p class="py-10 text-sm text-muted-foreground">Opening the room…</p>
  {:else if game.phase === 'lobby'}
    <section class="flex flex-col gap-4 rounded-2xl border border-border bg-card p-5">
      <div>
        <p class="font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">Lobby</p>
        <h2 class="font-display text-2xl font-extrabold uppercase tracking-tight">
          Both seats must ready up
        </h2>
        <p class="mt-1 text-sm text-muted-foreground">
          The market is generated once the host starts. Both seats use the same 60 players.
        </p>
      </div>
      <div class="grid gap-3 sm:grid-cols-2">
        {#each ['p1', 'p2'] as const as entry (entry)}
          <div class="rounded-xl border border-border bg-surface-2 p-3">
            <p class="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
              {seatLabelFor(entry, seat)}
            </p>
            <p class="mt-1 text-sm font-semibold">
              {game.ready[entry] ? 'Ready' : 'Not ready'}
            </p>
          </div>
        {/each}
      </div>
      <div class="flex flex-wrap gap-2">
        <button
          type="button"
          class="inline-flex min-h-11 items-center justify-center rounded-xl border border-border bg-surface-2 px-4 text-sm font-semibold
            disabled:opacity-40"
          disabled={controller.busy}
          onclick={() => controller.readiness()}
        >
          {game.ready[seat] ? 'Cancel ready' : 'Ready up'}
        </button>
        {#if controller.isHost}
          <button
            type="button"
            class="inline-flex min-h-11 items-center justify-center rounded-xl border border-primary/50 bg-primary/10 px-4 text-sm font-bold text-primary
              disabled:opacity-40"
            disabled={controller.busy || !game.ready.p1 || !game.ready.p2}
            onclick={() => controller.startLeague()}
          >
            Start recruitment
          </button>
        {/if}
      </div>
    </section>
  {:else if game.phase === 'recruiting'}
    <CapRushAuctionBoard
      {game}
      localSeat={seat}
      nowMs={controller.nowMs}
      busy={controller.busy}
      onbid={(playerId, totalDollars) => controller.bid(playerId, totalDollars)}
    />
  {:else if game.phase === 'preparation' || game.phase === 'locking'}
    <div class="grid gap-4 lg:grid-cols-2">
      <CapRushSeatLedger state={game} seat="p1" localSeat={seat} />
      <CapRushSeatLedger state={game} seat="p2" localSeat={seat} />
    </div>
    <section class="mt-4 flex flex-col gap-4 rounded-2xl border border-border bg-card p-4">
      <header>
        <p class="font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
          Preparation
        </p>
        <h2 class="font-display text-2xl font-extrabold uppercase tracking-tight">
          {variant === 'roulette' ? 'Mutation window' : 'Roster lock'}
        </h2>
        <p class="mt-1 text-xs text-muted-foreground">
          {variant === 'roulette'
            ? 'Paid spins use the actual recruited payroll. Both seats confirm when done.'
            : 'No mutations in the normal variant. Both seats confirm to lock.'}
        </p>
      </header>

      {#if variant === 'roulette' && game.phase === 'preparation'}
        <div class="grid gap-2 sm:grid-cols-[1fr_auto_auto]">
          <label
            class="flex min-h-11 items-center gap-2 rounded-xl border border-border bg-surface-2 px-3"
          >
            <span class="text-xs text-muted-foreground">Target</span>
            <select
              class="min-w-0 flex-1 bg-transparent text-sm outline-none"
              bind:value={mutationTarget}
            >
              {#each localRoster as pick (pick.playerId)}
                <option value={pick.playerId}>
                  {pick.slot} · {pick.playerId} · {money(pick.salaryDollars)}
                </option>
              {/each}
            </select>
          </label>
          <select
            class="min-h-11 rounded-xl border border-border bg-surface-2 px-3 text-sm"
            bind:value={mutationPurchase}
          >
            <option value="standard">Standard · $10M</option>
            <option value="surge">Surge · $35M</option>
          </select>
          <button
            type="button"
            class="inline-flex min-h-11 items-center justify-center rounded-xl border border-primary/50 bg-primary/10 px-4 text-sm font-bold text-primary
              disabled:opacity-40"
            disabled={controller.busy || mutationTarget === null}
            onclick={() =>
              mutationTarget && controller.purchaseMutation(mutationPurchase, mutationTarget)}
          >
            Buy spin
          </button>
        </div>
        <div class="flex flex-wrap gap-2">
          <button
            type="button"
            class="inline-flex min-h-11 items-center justify-center rounded-xl border border-border bg-surface-2 px-4 text-sm font-semibold
              disabled:opacity-40"
            disabled={controller.busy}
            onclick={() => controller.skipMutation()}
          >
            Skip mutations
          </button>
        </div>
      {/if}

      <div class="flex flex-wrap items-center gap-3">
        <button
          type="button"
          class="inline-flex min-h-11 items-center justify-center rounded-xl border border-primary/50 bg-primary/10 px-4 text-sm font-bold text-primary
            disabled:opacity-40"
          disabled={controller.busy || game.lockConfirmations[seat] !== null}
          onclick={() => controller.confirmLock()}
        >
          {game.lockConfirmations[seat] === null ? 'Confirm roster' : 'Roster confirmed'}
        </button>
        <p class="text-xs text-muted-foreground">
          {game.lockConfirmations.p1 === null ? 'Host pending' : 'Host confirmed'} ·
          {game.lockConfirmations.p2 === null ? 'Guest pending' : 'Guest confirmed'}
        </p>
      </div>
    </section>
  {:else if game.phase === 'season'}
    <div class="grid gap-4 lg:grid-cols-[minmax(0,1fr)_18rem]">
      <div class="flex flex-col gap-4">
        <CapRushBlockPlan
          state={game}
          localSeat={seat}
          busy={controller.busy}
          onchoose={(choice) => controller.chooseBlock(choice)}
        />
        <CapRushSharedProgress
          state={game}
          localSeat={seat}
          busy={controller.busy}
          onsimulate={() => controller.simulateNextSlot()}
          onack={() => controller.ackSlot()}
          onwatchh2h={(gameId) => controller.watchHeadToHead(gameId)}
          onwatchown={() => controller.watchOwnGame()}
        />
      </div>
      <div class="flex flex-col gap-3">
        <CapRushSeatLedger state={game} seat="p1" localSeat={seat} />
        <CapRushSeatLedger state={game} seat="p2" localSeat={seat} />
      </div>
    </div>
  {:else if game.phase === 'postseason'}
    <section class="flex flex-col gap-4 rounded-2xl border border-border bg-card p-4">
      <header class="flex flex-wrap items-end justify-between gap-2">
        <div>
          <p class="font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
            Postseason
          </p>
          <h2 class="font-display text-2xl font-extrabold uppercase tracking-tight">
            {game.postseason?.championTeamId === null
              ? `Round ${game.postseason?.planRound ?? 1}`
              : 'Champion crowned'}
          </h2>
        </div>
        <p class="text-xs text-muted-foreground">
          {seatLabelFor('p1', seat)}: {outcomeLabel(game)} · {seatLabelFor('p2', seat)}:
          {game.postseason?.outcomes.p2.status ?? 'pending'}
        </p>
      </header>

      <div class="flex flex-wrap gap-2">
        {#if game.postseason?.championTeamId === null}
          <button
            type="button"
            class="inline-flex min-h-11 items-center justify-center rounded-xl border border-border bg-surface-2 px-4 text-sm font-semibold
              disabled:opacity-40"
            disabled={controller.busy || game.postseason?.plans[seat] !== null}
            onclick={() => controller.choosePlayoffPlan('sim')}
          >
            Sim round {game.postseason?.planRound ?? 1}
          </button>
          <button
            type="button"
            class="inline-flex min-h-11 items-center justify-center rounded-xl border border-border bg-surface-2 px-4 text-sm font-semibold
              disabled:opacity-40"
            disabled={controller.busy || game.postseason?.plans[seat] !== null}
            onclick={() => controller.choosePlayoffPlan('simcast')}
          >
            Watch at 4×
          </button>
          <button
            type="button"
            class="inline-flex min-h-11 items-center justify-center rounded-xl border border-border bg-surface-2 px-4 text-sm font-semibold
              disabled:opacity-40"
            disabled={controller.busy || controller.broadcastLoading}
            onclick={() => controller.watchPlayoffGame()}
          >
            Watch playoff game
          </button>
          {#if controller.isHost}
            <button
              type="button"
              class="inline-flex min-h-11 items-center justify-center rounded-xl border border-primary/50 bg-primary/10 px-4 text-sm font-bold text-primary
                disabled:opacity-40"
              disabled={controller.busy}
              onclick={() => controller.simulatePlayoffStep()}
            >
              Sim playoff step
            </button>
          {/if}
        {:else}
          <button
            type="button"
            class="inline-flex min-h-11 items-center justify-center rounded-xl border border-primary/50 bg-primary/10 px-4 text-sm font-bold text-primary
              disabled:opacity-40"
            disabled={controller.busy}
            onclick={() => controller.completeLeague()}
          >
            Accept final report
          </button>
        {/if}
      </div>

      <ul class="flex flex-col gap-2">
        {#each (game.postseason?.series ?? [])
          .slice()
          .sort((a, b) => a.round - b.round || a.seriesSlot - b.seriesSlot) as series (series.seriesId)}
          <li
            class="flex items-center justify-between gap-2 rounded-lg border border-border bg-surface-2 px-3 py-2 text-xs"
          >
            <span class="truncate">
              R{series.round} · {teamName(series.highTeamId)} vs {teamName(series.lowTeamId)}
            </span>
            <span class="font-mono font-semibold tabular-nums">{seriesWinLabel(series)}</span>
          </li>
        {/each}
      </ul>
    </section>
  {:else if game.phase === 'completed'}
    <section class="flex flex-col gap-4 rounded-2xl border border-border bg-card p-5">
      <p class="font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
        Final report
      </p>
      <h2 class="font-display text-3xl font-extrabold uppercase tracking-tight">
        {game.report === null
          ? 'League complete'
          : `${teamName(game.report.championTeamId)} win the league`}
      </h2>
      {#if game.report}
        <div class="grid gap-3 sm:grid-cols-2">
          {#each ['p1', 'p2'] as const as entry (entry)}
            {@const report = game.report.seats[entry]}
            <div class="rounded-xl border border-border bg-surface-2 p-3">
              <p
                class="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground"
              >
                {seatLabelFor(entry, seat)}
              </p>
              <p class="mt-1 font-display text-xl font-bold uppercase tracking-tight">
                {report.displayName}
              </p>
              <p class="font-mono text-sm tabular-nums">{report.wins}–{report.losses}</p>
              <p class="mt-1 text-xs text-muted-foreground">
                {money(report.payrollDollars)} payroll · {report.outcome.status}
              </p>
              <ul class="mt-2 flex flex-col gap-1 text-xs">
                {#each report.roster
                  .slice()
                  .sort((a, b) => POSITIONS.indexOf(a.slot) - POSITIONS.indexOf(b.slot)) as pick (pick.playerId)}
                  <li class="flex justify-between gap-2">
                    <span>{pick.slot} · {pick.playerId}</span>
                    <span class="font-mono tabular-nums">{money(pick.salaryDollars)}</span>
                  </li>
                {/each}
              </ul>
            </div>
          {/each}
        </div>
      {/if}
      <a
        class="inline-flex min-h-11 w-fit items-center justify-center rounded-xl border border-border bg-surface-2 px-4 text-sm font-semibold"
        href={resolve('/multiplayer')}>Return to the lobby</a
      >
    </section>
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
</RoomShell>
