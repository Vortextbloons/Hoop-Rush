<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import { page } from '$app/stores';
  import { goto } from '$app/navigation';
  import { resolve } from '$app/paths';
  import { DraftDuelController } from '$lib/draft-duel/draft-duel-controller.svelte';
  import DraftBoard from '$lib/draft-duel/DraftBoard.svelte';
  import RosterRail from '$lib/draft-duel/RosterRail.svelte';
  import RevealOverlay from '$lib/draft-duel/RevealOverlay.svelte';
  import ReactionBar from '$lib/draft-duel/ReactionBar.svelte';
  import RivalConsideration from '$lib/draft-duel/RivalConsideration.svelte';
  import SeriesTracker from '$lib/draft-duel/SeriesTracker.svelte';
  import BroadcastView from '$lib/draft-duel/BroadcastView.svelte';
  import GameResultsPanel from '$lib/draft-duel/GameResultsPanel.svelte';
  import ChampionshipView from '$lib/draft-duel/ChampionshipView.svelte';
  import { inviteLinkForDraftDuelCode } from '$lib/draft-duel-identity';
  import type { DraftDuelOfferedPick } from '@hoop-rush/data-contracts';

  const roomId = $derived($page.params.roomId as string);
  const controller = new DraftDuelController();
  let revealVisible = $state(false);
  let copied = $state(false);
  let lastRound = -1;
  let followingRematch = false;

  onMount(() => {
    void controller.attach(roomId);
  });
  onDestroy(() => {
    controller.dispose();
  });

  $effect(() => {
    const phase = controller.phase;
    const round = controller.roundIndex;
    if (phase !== 'drafting' || round === lastRound) return;
    lastRound = round;
    revealVisible = true;
    const timer = setTimeout(() => {
      revealVisible = false;
    }, 3000);
    return () => clearTimeout(timer);
  });

  $effect(() => {
    const successor = controller.successorRoomId;
    if (!successor || successor === roomId || followingRematch) return;
    followingRematch = true;
    void controller.followRematch().then((next) => {
      if (next) {
        void goto(resolve('/draft-duel/room/[roomId]', { roomId: next }));
      } else {
        followingRematch = false;
      }
    });
  });

  const rivalOffers = $derived.by<DraftDuelOfferedPick[]>(() =>
    controller.rivalPool.map((card, slot) => ({
      slot,
      card,
      available: false,
      reason: null,
    })),
  );
  const isHost = $derived(controller.participantId === 'p1');
  const bothReady = $derived(
    controller.snapshot !== null &&
      controller.snapshot.members.length === 2 &&
      controller.snapshot.members.every((member) => member.ready),
  );
  const pickSecondsLeft = $derived(
    controller.deadlineMsLeft === null ? null : Math.ceil(controller.deadlineMsLeft / 1000),
  );
  const lastPlayedGame = $derived(controller.series?.games.at(-1) ?? null);
  const lastOutput = $derived(
    lastPlayedGame ? (controller.outputs[lastPlayedGame.gameNumber] ?? null) : null,
  );
  const lastVerification = $derived.by<'pending' | 'verified' | 'mismatch'>(() => {
    const gameNumber = lastPlayedGame?.gameNumber;
    if (gameNumber === undefined) return 'pending';
    return (
      controller.verification.find((entry) => entry.gameNumber === gameNumber)?.status ?? 'pending'
    );
  });
  const championshipGames = $derived.by(() => {
    const series = controller.series;
    if (!series) return [];
    return series.games
      .map((game) => controller.outputs[game.gameNumber])
      .filter((output): output is NonNullable<typeof output> => output !== undefined);
  });

  async function copyInvite(): Promise<void> {
    const code = controller.snapshot?.code;
    if (!code) return;
    try {
      await navigator.clipboard.writeText(
        `${window.location.origin}${inviteLinkForDraftDuelCode(code)}`,
      );
      copied = true;
      setTimeout(() => {
        copied = false;
      }, 1500);
    } catch {}
  }

  async function leaveRoom(): Promise<void> {
    await controller.leaveRoom();
    await goto(resolve('/draft-duel'));
  }
</script>

<svelte:head>
  <title>Draft Duel room · Hoop Rush</title>
</svelte:head>

<main class="draft-duel-room">
  <header class="room-header">
    <div class="room-title">
      <span class="eyebrow">Draft Duel · private room</span>
      <h1>
        {controller.snapshot?.settings.presentation === 'ball-knowledge'
          ? 'Ball Knowledge'
          : 'Ratings'}
        ·
        {controller.snapshot?.settings.fairness === 'unfair' ? 'Unfair' : 'Fair'}
      </h1>
    </div>
    <div class="room-actions">
      {#if controller.snapshot?.code}
        <button type="button" class="chip" onclick={copyInvite}>
          {copied ? 'Link copied' : `Code ${controller.snapshot.code}`}
        </button>
      {/if}
      <span class="member-chip">
        {controller.participantId === 'p1' ? 'You are P1' : 'You are P2'}
      </span>
      {#if controller.snapshot?.members}
        <span class="member-chip">
          {controller.snapshot.members.filter((member) => member.online).length}/2 online
        </span>
      {/if}
      <button type="button" class="chip danger" onclick={leaveRoom}>Leave</button>
    </div>
  </header>

  {#if controller.error}
    <p class="error-banner" role="alert">{controller.error}</p>
  {/if}
  {#if controller.notice}
    <p class="notice-banner" role="status">{controller.notice}</p>
  {/if}
  {#if controller.integrityFailed}
    <p class="error-banner" role="alert">
      The two simulations disagreed. This room can no longer advance.
    </p>
  {/if}

  {#if controller.phase === 'lobby'}
    <section class="panel" aria-label="Lobby">
      <h2>Lobby</h2>
      <p class="hint">
        Share the code or invite link. Both players lock in settings with ready, then the host
        starts the draft.
      </p>
      <div class="lobby-grid">
        {#each controller.snapshot?.members ?? [] as member (member.participantId)}
          <div class="member-card">
            <strong>{member.participantId.toUpperCase()}</strong>
            <span>{member.online ? 'Online' : 'Away'}</span>
            <span>{member.ready ? 'Ready' : 'Not ready'}</span>
          </div>
        {/each}
      </div>
      {#if isHost}
        <div class="setting-row">
          <span class="setting-label">Fairness</span>
          <div class="segmented">
            <button
              type="button"
              class:selected={controller.snapshot?.settings.fairness === 'fair'}
              onclick={() =>
                controller.updateSettings('fair', controller.snapshot!.settings.presentation)}
              >Fair</button
            >
            <button
              type="button"
              class:selected={controller.snapshot?.settings.fairness === 'unfair'}
              onclick={() =>
                controller.updateSettings('unfair', controller.snapshot!.settings.presentation)}
              >Unfair</button
            >
          </div>
        </div>
        <div class="setting-row">
          <span class="setting-label">Presentation</span>
          <div class="segmented">
            <button
              type="button"
              class:selected={controller.snapshot?.settings.presentation === 'ratings'}
              onclick={() =>
                controller.updateSettings(controller.snapshot!.settings.fairness, 'ratings')}
              >Ratings</button
            >
            <button
              type="button"
              class:selected={controller.snapshot?.settings.presentation === 'ball-knowledge'}
              onclick={() =>
                controller.updateSettings(controller.snapshot!.settings.fairness, 'ball-knowledge')}
              >Ball Knowledge</button
            >
          </div>
        </div>
      {/if}
      <div class="lobby-actions">
        <button
          type="button"
          class="primary"
          disabled={controller.busy}
          onclick={() =>
            controller.setReady(
              !controller.snapshot?.members.find(
                (m) => m.participantId === controller.participantId,
              )?.ready,
            )}
        >
          {controller.snapshot?.members.find((m) => m.participantId === controller.participantId)
            ?.ready
            ? 'Not ready'
            : 'Ready'}
        </button>
        {#if isHost}
          <button
            type="button"
            class="primary"
            disabled={controller.busy || !bothReady}
            onclick={() => controller.startDraft()}>Start draft</button
          >
        {/if}
      </div>
    </section>
  {/if}

  {#if controller.phase === 'drafting'}
    <section class="draft-stage" aria-label="Draft stage">
      <div class="stage-header">
        <div>
          <span class="eyebrow">Round {(controller.roundIndex ?? 0) + 1} of 5</span>
          <h2>
            {controller.activeTurn ? 'Your pick' : 'Opponent picking'}
          </h2>
        </div>
        <div class="pick-clock" class:urgent={pickSecondsLeft !== null && pickSecondsLeft <= 10}>
          {pickSecondsLeft === null ? '—' : `${pickSecondsLeft}s`}
        </div>
      </div>
      <RivalConsideration consideration={controller.consideration} />
      <div class="boards">
        <div class="board-column">
          <h3>Your offers</h3>
          <DraftBoard
            offers={controller.localPicks}
            active={controller.activeTurn}
            round={(controller.roundIndex ?? 0) + 1}
            presentation={controller.snapshot?.settings.presentation ?? 'ratings'}
            disabled={!controller.activeTurn}
            onpick={(pick) => controller.pickOffer(pick)}
            onconsider={(pick) => controller.consider(pick?.card ?? null)}
          />
          {#if controller.localRoster}
            <RosterRail
              roster={controller.localRoster}
              presentation={controller.snapshot?.settings.presentation ?? 'ratings'}
              active
            />
          {/if}
        </div>
        <div class="board-column rival">
          <h3>Opponent offers</h3>
          <DraftBoard
            offers={rivalOffers}
            active={false}
            round={(controller.roundIndex ?? 0) + 1}
            presentation={controller.snapshot?.settings.presentation ?? 'ratings'}
            disabled
          />
          {#if controller.rivalRoster}
            <RosterRail
              roster={controller.rivalRoster}
              presentation={controller.snapshot?.settings.presentation ?? 'ratings'}
              compact
            />
          {/if}
        </div>
      </div>
      <RevealOverlay visible={revealVisible} round={(controller.roundIndex ?? 0) + 1} />
      <ReactionBar
        muted={controller.muted}
        onreact={(reaction) => controller.react(reaction)}
        onmute={(muted) => controller.setMuted(muted)}
      />
    </section>
  {/if}

  {#if controller.phase === 'lineup-showdown'}
    <section class="panel" aria-label="Lineup showdown">
      <h2>Lineup showdown</h2>
      <div class="boards">
        <div class="board-column">
          <h3>Your five</h3>
          {#if controller.localRoster}
            <RosterRail
              roster={controller.localRoster}
              presentation={controller.snapshot?.settings.presentation ?? 'ratings'}
              active
            />
          {/if}
        </div>
        <div class="board-column rival">
          <h3>Opponent five</h3>
          {#if controller.rivalRoster}
            <RosterRail
              roster={controller.rivalRoster}
              presentation={controller.snapshot?.settings.presentation ?? 'ratings'}
            />
          {/if}
        </div>
      </div>
      <div class="lobby-actions">
        <button type="button" class="primary" onclick={() => controller.readyForNextGame()}>
          Ready for Game 1
        </button>
      </div>
    </section>
  {/if}

  {#if controller.phase === 'preparing-game'}
    <section class="panel" aria-label="Preparing game">
      {#if controller.series}
        <SeriesTracker
          series={controller.series}
          localParticipantId={controller.participantId ?? 'p1'}
        />
      {/if}
      <h2>Game {controller.currentGameNumber ?? 1} ready check</h2>
      <p class="hint">
        {controller.opponentReady
          ? 'Opponent is ready.'
          : controller.localReady
            ? 'Waiting for your opponent. The game starts automatically after 60 seconds.'
            : 'Both players ready up to start the broadcast.'}
      </p>
      {#if controller.readyCountdownMs !== null}
        <p class="countdown" role="status">
          Auto-start in {Math.ceil(controller.readyCountdownMs / 1000)}s
        </p>
      {/if}
      {#if lastOutput}
        <p class="hint">
          Last result: Game {lastOutput.gameNumber} · {lastOutput.result.winner === 'home'
            ? lastOutput.homeParticipantId
            : lastOutput.awayParticipantId}
          won
        </p>
      {/if}
      <div class="lobby-actions">
        <button
          type="button"
          class="primary"
          disabled={controller.localReady}
          onclick={() => controller.readyForNextGame()}
        >
          {controller.localReady ? 'Ready' : 'Ready for this game'}
        </button>
      </div>
    </section>
  {/if}

  {#if controller.phase === 'broadcasting' && controller.currentOutput && controller.visible}
    <section class="panel broadcast-panel" aria-label="Broadcast">
      <BroadcastView
        output={controller.currentOutput}
        visible={controller.visible}
        progress={controller.progress}
        localParticipantId={controller.participantId ?? 'p1'}
        feed={controller.feed}
      />
    </section>
  {/if}

  {#if controller.phase === 'game-results' && lastOutput && controller.series}
    <section class="panel" aria-label="Game results">
      <GameResultsPanel
        output={lastOutput}
        series={controller.series}
        localParticipantId={controller.participantId ?? 'p1'}
        verification={lastVerification}
        readyCountdownMs={controller.readyCountdownMs}
        localReady={controller.localReady}
        onready={() => controller.readyForNextGame()}
      />
    </section>
  {/if}

  {#if controller.phase === 'championship' && controller.series}
    <section class="panel" aria-label="Championship">
      <ChampionshipView
        series={controller.series}
        mvp={controller.seriesMvp}
        standouts={controller.seriesStandouts}
        localParticipantId={controller.participantId ?? 'p1'}
        games={championshipGames}
        rematchRequested={controller.rivalRematchRequested}
        rematchConfirmed={controller.successorRoomId !== null}
        onrematch={() => controller.requestRematch()}
        onconfirmrematch={() => controller.confirmRematch()}
      />
    </section>
  {/if}

  {#if controller.phase === 'expired'}
    <section class="panel">
      <h2>Room expired</h2>
      <p class="hint">This Draft Duel room has expired. Start a fresh one from the lobby.</p>
      <a class="primary link" href={resolve('/draft-duel')}>Back to Draft Duel</a>
    </section>
  {/if}

  {#if controller.phase === 'integrity-failed'}
    <section class="panel">
      <h2>Integrity failed</h2>
      <p class="hint">
        The two simulations could not be reconciled. Start a fresh room to play again.
      </p>
      <a class="primary link" href={resolve('/draft-duel')}>Back to Draft Duel</a>
    </section>
  {/if}
</main>

<style>
  .draft-duel-room {
    max-width: 1180px;
    margin: 0 auto;
    padding: 1.5rem 1rem 4rem;
    display: grid;
    gap: 1rem;
  }
  .room-header {
    display: flex;
    flex-wrap: wrap;
    justify-content: space-between;
    gap: 0.75rem;
    align-items: flex-end;
  }
  .eyebrow {
    text-transform: uppercase;
    letter-spacing: 0.14em;
    font-family: 'Roboto Mono', monospace;
    font-size: 0.68rem;
    color: var(--muted-foreground, #8b93a1);
  }
  .room-title h1 {
    margin: 0.15rem 0 0;
    font-family: 'Barlow Condensed', sans-serif;
    font-size: clamp(1.7rem, 4vw, 2.4rem);
    letter-spacing: 0.02em;
  }
  .room-actions {
    display: flex;
    gap: 0.5rem;
    align-items: center;
    flex-wrap: wrap;
  }
  .chip {
    border: 1px solid var(--border, #232833);
    border-radius: 999px;
    background: transparent;
    color: inherit;
    padding: 0.35rem 0.8rem;
    font-size: 0.82rem;
    cursor: pointer;
  }
  .chip.danger {
    border-color: #7f1d1d;
    color: #fca5a5;
  }
  .member-chip {
    font-size: 0.82rem;
    color: var(--muted-foreground, #8b93a1);
  }
  .panel,
  .draft-stage {
    border: 1px solid var(--border, #232833);
    border-radius: 12px;
    padding: 1.1rem;
    background: var(--surface, #12151c);
    display: grid;
    gap: 0.9rem;
    position: relative;
  }
  h2 {
    margin: 0;
    font-family: 'Barlow Condensed', sans-serif;
    font-size: 1.5rem;
    letter-spacing: 0.03em;
  }
  h3 {
    margin: 0 0 0.5rem;
    font-size: 0.9rem;
    color: var(--muted-foreground, #8b93a1);
    text-transform: uppercase;
    letter-spacing: 0.1em;
  }
  .hint {
    margin: 0;
    font-size: 0.88rem;
    color: var(--muted-foreground, #8b93a1);
  }
  .error-banner {
    margin: 0;
    border: 1px solid #7f1d1d;
    background: #2a1214;
    color: #fecaca;
    padding: 0.75rem 1rem;
    border-radius: 8px;
  }
  .notice-banner {
    margin: 0;
    border: 1px solid #365314;
    background: #12200f;
    color: #d9f99d;
    padding: 0.75rem 1rem;
    border-radius: 8px;
  }
  .lobby-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
    gap: 0.75rem;
  }
  .member-card {
    border: 1px solid var(--border, #232833);
    border-radius: 10px;
    padding: 0.75rem;
    display: grid;
    gap: 0.2rem;
    font-size: 0.88rem;
  }
  .setting-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 1rem;
  }
  .setting-label {
    font-size: 0.9rem;
    color: var(--muted-foreground, #8b93a1);
  }
  .segmented {
    display: inline-flex;
    border: 1px solid var(--border, #232833);
    border-radius: 999px;
    overflow: hidden;
  }
  .segmented button {
    background: transparent;
    border: none;
    color: inherit;
    padding: 0.45rem 0.9rem;
    font: inherit;
    cursor: pointer;
  }
  .segmented button.selected {
    background: var(--court-accent, #f97316);
    color: #0b0d12;
    font-weight: 600;
  }
  .lobby-actions {
    display: flex;
    gap: 0.75rem;
    flex-wrap: wrap;
  }
  .primary {
    border: none;
    border-radius: 8px;
    padding: 0.6rem 1.2rem;
    background: var(--court-accent, #f97316);
    color: #0b0d12;
    font-weight: 700;
    font-size: 0.95rem;
    cursor: pointer;
  }
  .primary.link {
    text-decoration: none;
    justify-self: start;
  }
  .primary:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
  .stage-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 1rem;
  }
  .pick-clock {
    font-family: 'Roboto Mono', monospace;
    font-size: 1.5rem;
    border: 1px solid var(--border, #232833);
    border-radius: 10px;
    padding: 0.35rem 0.8rem;
  }
  .pick-clock.urgent {
    border-color: #b91c1c;
    color: #fca5a5;
  }
  .boards {
    display: grid;
    gap: 1rem;
    grid-template-columns: 1fr;
  }
  @media (min-width: 900px) {
    .boards {
      grid-template-columns: 1.4fr 1fr;
      align-items: start;
    }
  }
  .board-column.rival {
    opacity: 0.92;
  }
  .countdown {
    margin: 0;
    font-family: 'Roboto Mono', monospace;
  }
</style>
