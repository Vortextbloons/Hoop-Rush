<script lang="ts">
  import RoomShell from '#lib/features/multiplayer/RoomShell.svelte';
  import { getLobbyCoordinator } from '#lib/features/multiplayer/lobby-context.svelte.js';
  import { onDestroy, onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { resolve } from '$app/paths';
  import {
    ArrowLeft,
    ArrowRight,
    Check,
    Clock,
    Copy,
    Link,
    LockKeyhole,
    LogOut,
    Scale,
    Shuffle,
    Sparkles,
    Users,
  } from '@lucide/svelte';
  import ArenaSoundToggle from '#lib/components/ArenaSoundToggle.svelte';
  import MultiplayerLobbyLink from '#lib/features/multiplayer/MultiplayerLobbyLink.svelte';
  import type { DraftDuelCard, DraftDuelOfferedPick } from '@hoop-rush/data-contracts';
  import { DraftDuelController } from '#lib/features/draft-duel/draft-duel-controller.svelte.js';
  import DraftBoard from '#lib/features/draft-duel/DraftBoard.svelte';
  import DraftSlotDialog from '#lib/features/draft-duel/DraftSlotDialog.svelte';
  import RosterRail from '#lib/features/draft-duel/RosterRail.svelte';
  import ReactionBar from '#lib/features/draft-duel/ReactionBar.svelte';
  import RivalConsideration from '#lib/features/draft-duel/RivalConsideration.svelte';
  import SeriesTracker from '#lib/features/draft-duel/SeriesTracker.svelte';
  import BroadcastView from '#lib/features/draft-duel/BroadcastView.svelte';
  import GameResultsPanel from '#lib/features/draft-duel/GameResultsPanel.svelte';
  import ChampionshipView from '#lib/features/draft-duel/ChampionshipView.svelte';
  import { inviteLinkForDraftDuelCode } from '#lib/features/draft-duel/draft-duel-identity.js';
  import { loadLobbyId } from '#lib/features/multiplayer/multiplayer-lobby.js';
  import { SLOT_LABELS } from '#lib/player-positions.js';

  let { roomId }: { roomId: string } = $props();
  const controller = new DraftDuelController();
  const lobbyCoordinator = getLobbyCoordinator();
  let lobbyId = $state<string | null>(null);
  let copiedCode = $state(false);
  let copiedLink = $state(false);
  let pendingSelection = $state<{ pick: DraftDuelOfferedPick; ordinal: number } | null>(null);
  const pendingPick = $derived(
    pendingSelection?.ordinal === controller.draft?.pickOrdinal && controller.activeTurn
      ? (pendingSelection?.pick ?? null)
      : null,
  );
  let movingCard = $state<DraftDuelCard | null>(null);
  const activeMoveCard = $derived(
    movingCard && controller.draft?.status === 'drafting' ? movingCard : null,
  );

  const moveSlots = $derived(
    activeMoveCard ? controller.repositionSlots(activeMoveCard) : ([] as number[]),
  );

  const moveLabels = $derived.by(() => {
    const card = activeMoveCard;
    if (!card) return {} as Record<number, string>;
    const labels: Record<number, string> = {};
    for (const slot of moveSlots) {
      const moves = controller.repositionMoves(card, slot);
      labels[slot] =
        moves.length > 0
          ? `Moves ${moves.length} player${moves.length === 1 ? '' : 's'}: ${moves
              .map((move) => `${move.displayName} → ${SLOT_LABELS[move.toSlot]}`)
              .join(', ')}`
          : 'Move';
    }
    return labels;
  });
  let followingRematch = false;

  onMount(() => {
    lobbyId = loadLobbyId(roomId);
    void controller.attach(roomId);
  });
  onDestroy(() => {
    controller.dispose();
  });

  const rivalMember = $derived(
    controller.snapshot?.members.find(
      (member) => member.participantId !== controller.participantId,
    ) ?? null,
  );
  const isHost = $derived(controller.participantId === 'p1');
  const onlineCount = $derived(
    controller.snapshot?.members.filter((member) => member.online).length ?? 0,
  );
  const bothOnline = $derived(
    controller.snapshot?.members.length === 2 &&
      controller.snapshot.members.every((member) => member.online),
  );
  const localPicking = $derived(controller.currentPicker === controller.participantId);
  const settingsName = $derived(
    `${
      controller.snapshot?.settings.presentation === 'ball-knowledge' ? 'Ball Knowledge' : 'Ratings'
    } · ${controller.snapshot?.settings.fairness === 'unfair' ? 'Unfair' : 'Fair'}`,
  );
  const stageIndex = $derived(
    controller.phase === 'lobby'
      ? 0
      : controller.phase === 'drafting' || controller.phase === 'lineup-showdown'
        ? 1
        : controller.phase === 'championship'
          ? 3
          : 2,
  );
  const phaseLabel = $derived(
    controller.phase === 'lobby'
      ? 'Lobby'
      : controller.phase === 'drafting'
        ? 'Draft'
        : controller.phase === 'lineup-showdown'
          ? 'Lineups'
          : controller.phase === 'preparing-game'
            ? 'Ready check'
            : controller.phase === 'broadcasting'
              ? 'Broadcast'
              : controller.phase === 'game-results'
                ? 'Game results'
                : controller.phase === 'championship'
                  ? 'Champion'
                  : controller.phase === 'expired'
                    ? 'Room expired'
                    : 'Result mismatch',
  );
  const pickSecondsLeft = $derived(
    controller.deadlineMsLeft === null ? null : Math.ceil(controller.deadlineMsLeft / 1000),
  );
  const rosterCards = $derived.by<(DraftDuelCard | null)[]>(() => {
    const cards: (DraftDuelCard | null)[] = [null, null, null, null, null];
    for (const slot of controller.localRoster?.slots ?? []) {
      if (slot.slotIndex >= 0 && slot.slotIndex <= 4) cards[slot.slotIndex] = slot.card;
    }
    return cards;
  });
  const playerCards = $derived.by<Record<string, DraftDuelCard>>(() => {
    const map: Record<string, DraftDuelCard> = {};
    for (const slot of controller.localRoster?.slots ?? []) map[slot.card.playerId] = slot.card;
    for (const slot of controller.rivalRoster?.slots ?? []) map[slot.card.playerId] = slot.card;
    return map;
  });

  const lastPlayedGame = $derived(controller.series?.games.at(-1) ?? null);
  const lastOutput = $derived(
    lastPlayedGame ? (controller.outputs[lastPlayedGame.gameNumber] ?? null) : null,
  );
  const resultVerification = $derived.by<'pending' | 'verified' | 'mismatch'>(() => {
    const gameNumber = controller.currentOutput?.gameNumber;
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

  $effect(() => {
    const successor = controller.successorRoomId;
    if (lobbyId || !successor || successor === roomId || followingRematch) return;
    followingRematch = true;
    void controller.followRematch().then((next) => {
      if (next) {
        void goto(resolve('/draft-duel/room/[roomId]', { roomId: next }));
      } else {
        followingRematch = false;
      }
    });
  });

  async function copyCode(): Promise<void> {
    const code = controller.snapshot?.code;
    if (!code) return;
    try {
      await navigator.clipboard.writeText(code);
      copiedCode = true;
      setTimeout(() => {
        copiedCode = false;
      }, 1500);
    } catch {}
  }

  async function copyInviteLink(): Promise<void> {
    const code = controller.snapshot?.code;
    if (!code) return;
    try {
      await navigator.clipboard.writeText(
        `${window.location.origin}${inviteLinkForDraftDuelCode(code)}`,
      );
      copiedLink = true;
      setTimeout(() => {
        copiedLink = false;
      }, 1500);
    } catch {}
  }

  async function leaveRoom(): Promise<void> {
    await controller.leaveRoom();
    await goto(resolve('draft-duel/'));
  }
  async function removeOpponent(): Promise<void> {
    if (!lobbyId) {
      await controller.removeGuest();
      return;
    }
    try {
      await lobbyCoordinator.session.removeOpponent();
    } catch (error) {
      controller.error = error instanceof Error ? error.message : 'Could not remove opponent.';
    }
  }
</script>

<svelte:window onfocus={() => controller.refresh()} ononline={() => controller.refresh()} />

<svelte:head>
  <title>Draft Duel room · Hoop Rush</title>
</svelte:head>

<section class="room-page">
  <div class="room-nav">
    <a href={resolve('draft-duel/')}>
      <ArrowLeft size={15} aria-hidden="true" />
      Draft Duel
    </a>

    <ArenaSoundToggle />
  </div>

  {#if !controller.snapshot && !controller.error}
    <div class="room-empty" role="status">
      <Users size={28} aria-hidden="true" />
      <h1>Opening your room</h1>
      <p>Loading the player pool and match settings…</p>
    </div>
  {:else if !controller.snapshot}
    <div class="room-empty">
      <h1>Couldn’t open this room</h1>
      <p role="alert">{controller.error}</p>

      <a href={resolve('draft-duel/')} class="room-primary">
        Back to Draft Duel
        <ArrowRight size={16} aria-hidden="true" />
      </a>
    </div>
  {:else}
    <RoomShell
      {roomId}
      title="Draft Duel"
      phase={phaseLabel}
      summary={`${settingsName} · Best of 7`}
      code={controller.snapshot.code}
      participantId={controller.participantId}
      members={controller.snapshot.members}
      connection={controller.connection}
      error={controller.error}
    />

    <ol class="room-stages" aria-label="Match progress">
      {#each ['Lobby', 'Draft your five', 'Series', 'Champion'] as label, i (label)}
        <li
          class:current={i === stageIndex}
          class:finished={i < stageIndex}
          aria-current={i === stageIndex ? 'step' : undefined}
        >
          <span
            >{#if i < stageIndex}<Check size={13} aria-hidden="true" />{:else}{i + 1}{/if}</span
          >{label}
        </li>
      {/each}
    </ol>

    {#if controller.phase === 'championship'}
      <MultiplayerLobbyLink {roomId} completed />
    {/if}

    {#if controller.notice}
      <p class="room-connection" role="status">{controller.notice}</p>
    {/if}

    {#if rivalMember && !rivalMember.online && controller.phase !== 'lobby'}
      <p class="room-connection" role="status">
        Your opponent is offline. Their place in the room is kept.
      </p>
    {/if}
    {#if controller.integrityFailed}
      <p class="room-alert" role="alert">
        The two simulations disagreed. This room can no longer advance.
      </p>
    {/if}

    {#if controller.phase === 'lobby'}
      <div class="lobby-layout">
        <div class="invite-panel">
          <div class="lobby-photo">
            <img src="/images/multiplayer/draft-duel.png" alt="" width="1536" height="1024" /><span
              class="photo-caption">Draft Duel · Head to head</span
            >
          </div>
          <div class="invite-body">
            <p class="room-eyebrow">{isHost ? 'Bring your opponent' : 'You’re in'}</p>
            <h2>{isHost ? 'Your table. Your invite.' : 'The matchup is set.'}</h2>
            <p>
              {isHost
                ? 'Share this code or send an invite link. Start the draft once your opponent joins.'
                : 'Stay in this room. The draft opens for both players when the host starts it.'}
            </p>
            {#if controller.snapshot.code}
              <div class="invite-code" aria-label={`Room code ${controller.snapshot.code}`}>
                {controller.snapshot.code}
              </div>
              <div class="invite-actions">
                <button type="button" onclick={copyCode} class="room-secondary">
                  {#if copiedCode}
                    <Check size={16} aria-hidden="true" />Copied
                  {:else}
                    <Copy size={16} aria-hidden="true" />Copy code
                  {/if}
                </button>

                <button type="button" onclick={copyInviteLink} class="room-primary">
                  {#if copiedLink}
                    <Check size={16} aria-hidden="true" />Copied
                  {:else}
                    <Link size={16} aria-hidden="true" />
                    Copy invite link
                  {/if}
                </button>
              </div>
              <p class="invite-footnote">Room codes expire after 15 minutes.</p>
            {/if}
          </div>
        </div>
        <div class="lobby-settings">
          <div class="lobby-panel-heading">
            <h2>Your matchup</h2>
            <span><Users size={14} aria-hidden="true" /> {onlineCount}/2 online</span>
          </div>
          <div class="player-seats">
            {#each controller.snapshot.members as member (member.participantId)}
              <div class="seat" class:local={member.participantId === controller.participantId}>
                <strong>{member.participantId.toUpperCase()}</strong>
                <span class="seat-state">
                  <span class="seat-dot" class:online={member.online}></span>
                  {member.online ? 'Online' : 'Away'}
                </span>
              </div>
            {/each}
          </div>
          <dl class="lobby-rules">
            <div>
              <dt>
                {#if controller.snapshot.settings.fairness === 'unfair'}<Shuffle
                    size={14}
                    aria-hidden="true"
                  />{:else}<Scale size={14} aria-hidden="true" />{/if} Fairness
              </dt>
              <dd>{controller.snapshot.settings.fairness === 'unfair' ? 'Unfair' : 'Fair'}</dd>
            </div>
            <div>
              <dt><Sparkles size={14} aria-hidden="true" /> Player ratings</dt>
              <dd>
                {controller.snapshot.settings.presentation === 'ball-knowledge'
                  ? 'Hidden'
                  : 'Visible'}
              </dd>
            </div>
            <div>
              <dt><Clock size={14} aria-hidden="true" /> Pick timer</dt>
              <dd>60 seconds</dd>
            </div>
            <div>
              <dt><LockKeyhole size={14} aria-hidden="true" /> Room access</dt>
              <dd>Invite only</dd>
            </div>
          </dl>
          <div class="lobby-ready" role="status">
            <span class:joined={rivalMember?.online}></span>
            <p>
              {isHost
                ? bothOnline
                  ? 'Your opponent is here. Start the draft.'
                  : 'Waiting for your opponent to join.'
                : 'Waiting for the host to start the draft.'}
            </p>
          </div>
          {#if isHost}
            <button
              type="button"
              onclick={() => controller.startDraft()}
              disabled={controller.busy || !bothOnline}
              class="room-primary start-draft"
            >
              {controller.busy ? 'Starting draft…' : 'Start draft'}
              <ArrowRight size={18} aria-hidden="true" />
            </button>
          {/if}
          <div class="lobby-manage">
            {#if isHost && rivalMember}
              <button type="button" onclick={removeOpponent} disabled={controller.busy}
                >Remove opponent</button
              >
            {/if}<button type="button" onclick={leaveRoom} disabled={controller.busy}
              ><LogOut size={14} aria-hidden="true" /> Leave room</button
            >
          </div>
        </div>
      </div>
    {:else if controller.phase === 'drafting'}
      <section class="draft-stage" aria-label="Draft stage">
        <div class="stage-header">
          <div>
            <span class="stage-eyebrow">Round {(controller.roundIndex ?? 0) + 1} of 5</span>
            <h2>{localPicking ? 'Your pick' : 'Opponent picking'}</h2>
          </div>
          <div class="pick-clock" class:urgent={pickSecondsLeft !== null && pickSecondsLeft <= 10}>
            {pickSecondsLeft === null ? '—' : `${pickSecondsLeft}s`}
          </div>
        </div>
        <RivalConsideration consideration={controller.consideration} />
        <div class="board-solo">
          <div class="board-column">
            <h3>{localPicking ? 'Your offers' : 'Opponent offers'}</h3>
            <DraftBoard
              offers={controller.visiblePicks}
              active={controller.activeTurn}
              round={(controller.roundIndex ?? 0) + 1}
              presentation={controller.snapshot.settings.presentation}
              manifest={controller.assets?.manifest ?? null}
              selectedSlot={pendingPick?.slot ?? null}
              disabled={controller.busy}
              onchoose={(pick) => {
                if (controller.draft)
                  pendingSelection = { pick, ordinal: controller.draft.pickOrdinal };
              }}
              onconsider={(pick) => controller.consider(pick?.card ?? null)}
            />
            {#if controller.localRoster}
              <RosterRail
                roster={controller.localRoster}
                presentation={controller.snapshot.settings.presentation}
                manifest={controller.assets?.manifest ?? null}
                active
                onmove={controller.allowDisplacement ? (card) => (movingCard = card) : null}
              />
            {/if}
          </div>
        </div>
        <ReactionBar
          muted={controller.muted}
          onreact={(reaction) => controller.react(reaction)}
          onmute={(muted) => controller.setMuted(muted)}
        />
        <DraftSlotDialog
          card={pendingPick?.card ?? activeMoveCard}
          manifest={controller.assets?.manifest ?? null}
          roster={rosterCards}
          legalSlots={pendingPick ? (pendingPick.legalSlots ?? []) : moveSlots}
          moving={pendingPick === null && activeMoveCard !== null}
          moveLabels={pendingPick === null ? moveLabels : {}}
          onplace={(slotIndex) => {
            if (pendingPick) {
              const pick = pendingPick;
              pendingSelection = null;
              void controller.pickOffer(pick, slotIndex);
              return;
            }
            const card = activeMoveCard;
            movingCard = null;
            if (card) void controller.repositionCard(card, slotIndex);
          }}
          onclose={() => {
            pendingSelection = null;
            movingCard = null;
          }}
        />
      </section>
    {:else if controller.phase === 'lineup-showdown'}
      <section class="panel" aria-label="Lineup showdown">
        <h2>Lineup showdown</h2>
        <div class="boards">
          <div class="board-column">
            <h3>Your five</h3>
            {#if controller.localRoster}
              <RosterRail
                roster={controller.localRoster}
                presentation={controller.snapshot.settings.presentation}
                manifest={controller.assets?.manifest ?? null}
                active
              />
            {/if}
          </div>
          <div class="board-column rival">
            <h3>Opponent five</h3>
            {#if controller.rivalRoster}
              <RosterRail
                roster={controller.rivalRoster}
                presentation={controller.snapshot.settings.presentation}
                manifest={controller.assets?.manifest ?? null}
              />
            {/if}
          </div>
        </div>
        <div class="panel-actions">
          <button type="button" class="room-primary" onclick={() => controller.readyForNextGame()}>
            Ready for Game 1
          </button>
        </div>
      </section>
    {:else if controller.phase === 'preparing-game'}
      <section class="panel" aria-label="Preparing game">
        {#if controller.series}
          <SeriesTracker
            series={controller.series}
            localParticipantId={controller.participantId ?? 'p1'}
          />
        {/if}
        <h2>Game {controller.currentGameNumber ?? 1} ready check</h2>
        <p class="panel-hint">
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
          <p class="panel-hint">
            Last result: Game {lastOutput.gameNumber} · {lastOutput.result.winner === 'home'
              ? lastOutput.homeParticipantId
              : lastOutput.awayParticipantId}
            won
          </p>
        {/if}
        <div class="panel-actions">
          <button
            type="button"
            class="room-primary"
            disabled={controller.localReady}
            onclick={() => controller.readyForNextGame()}
          >
            {controller.localReady ? 'Ready' : 'Ready for this game'}
          </button>
        </div>
      </section>
    {:else if controller.phase === 'broadcasting' && controller.currentOutput && controller.visible}
      <section class="panel broadcast-panel" aria-label="Broadcast">
        <BroadcastView
          output={controller.currentOutput}
          visible={controller.visible}
          progress={controller.progress}
          localParticipantId={controller.participantId ?? 'p1'}
          feed={controller.feed}
          cards={playerCards}
          manifest={controller.assets?.manifest ?? null}
        />
      </section>
    {:else if controller.phase === 'game-results' && controller.currentOutput && controller.series}
      <section class="panel" aria-label="Game results">
        <GameResultsPanel
          output={controller.currentOutput}
          series={controller.series}
          localParticipantId={controller.participantId ?? 'p1'}
          verification={resultVerification}
          readyCountdownMs={controller.readyCountdownMs}
          localReady={controller.localReady}
          onready={() => controller.readyForNextGame()}
          awaitingContinue={controller.awaitingContinue}
          oncontinue={() => controller.continueAfterGame()}
          cards={playerCards}
          manifest={controller.assets?.manifest ?? null}
        />
      </section>
    {:else if controller.phase === 'championship' && controller.series}
      <section class="panel" aria-label="Championship">
        <ChampionshipView
          series={controller.series}
          mvp={controller.seriesMvp}
          standouts={controller.seriesStandouts}
          localParticipantId={controller.participantId ?? 'p1'}
          games={championshipGames}
          cards={playerCards}
          manifest={controller.assets?.manifest ?? null}
          rematchRequested={controller.rivalRematchRequested}
          localRematchRequested={controller.myRematchRequested}
          rematchBusy={controller.busy}
          rematchConfirmed={controller.successorRoomId !== null}
          onrematch={() => controller.requestRematch()}
          onconfirmrematch={() => controller.confirmRematch()}
          showRematch={!lobbyId}
        />
      </section>
    {:else if controller.phase === 'expired'}
      <div class="room-empty">
        <h1>Room expired</h1>
        <p>Your local saves are kept. Create a new room to play again.</p>

        <a class="room-primary" href={resolve('draft-duel/')}>
          New Draft Duel
          <ArrowRight size={16} aria-hidden="true" />
        </a>
      </div>
    {:else if controller.phase === 'integrity-failed'}
      <div class="room-empty">
        <h1>Results could not be verified</h1>
        <p>The two simulations disagreed. Neither result has been accepted.</p>

        <a class="room-primary" href={resolve('draft-duel/')}>
          New Draft Duel
          <ArrowRight size={16} aria-hidden="true" />
        </a>
      </div>
    {/if}

    {#if controller.phase !== 'lobby'}
      <div class="room-footer">
        <button type="button" onclick={leaveRoom} disabled={controller.busy} class="room-secondary"
          ><LogOut size={14} aria-hidden="true" /> Leave room</button
        >
      </div>
    {/if}
  {/if}
</section>

<style>
  .room-page {
    width: 100%;
    max-width: 1400px;
    margin: auto;
    padding: 24px 32px 80px;
  }
  .room-nav {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 30px;
  }
  .room-nav a {
    display: flex;
    align-items: center;
    gap: 8px;
    color: var(--color-muted-foreground);
    font-size: 12px;
  }
  .room-nav a:hover {
    color: var(--color-foreground);
  }

  .room-eyebrow {
    font-family: var(--font-mono);
    font-size: 10px;
    color: var(--color-primary);
    font-weight: 700;
    letter-spacing: 0.12em;
    text-transform: uppercase;
  }
  .room-empty h1 {
    margin-top: 6px;
    font-family: var(--font-display);
    font-size: clamp(38px, 4vw, 58px);
    font-weight: 800;
    line-height: 1;
    text-transform: uppercase;
  }

  .room-stages {
    display: flex;
    margin: 28px 0;
    padding: 17px 0;
    border-top: 1px solid var(--color-line-soft);
    border-bottom: 1px solid var(--color-line-soft);
    gap: 32px;
  }
  .room-stages li {
    display: flex;
    align-items: center;
    gap: 8px;
    color: var(--color-muted-foreground);
    font-size: 12px;
  }
  .room-stages li > span {
    display: grid;
    place-items: center;
    width: 22px;
    height: 22px;
    border: 1px solid var(--color-line-strong);
    border-radius: 50%;
    font-family: var(--font-mono);
    font-size: 10px;
  }
  .room-stages .current {
    color: var(--color-foreground);
    font-weight: 600;
  }
  .room-stages .current > span {
    color: var(--color-primary-foreground);
    background: var(--color-primary);
    border-color: var(--color-primary);
  }
  .room-stages .finished > span {
    color: var(--color-positive);
    border-color: var(--color-positive);
  }
  .room-alert {
    margin: 16px 0;
    padding: 14px;
    border: 1px solid var(--color-destructive);
    background: color-mix(in srgb, var(--color-destructive) 8%, var(--color-card));
    border-radius: 8px;
    font-size: 13px;
    line-height: 1.7;
  }
  .room-connection {
    color: var(--color-muted-foreground);
    font-size: 12px;
    margin: 14px 0;
  }
  .room-empty {
    display: flex;
    align-items: flex-start;
    flex-direction: column;
    gap: 18px;
    padding: 60px 0;
  }
  .room-empty p {
    font-size: 13px;
    color: var(--color-muted-foreground);
  }
  .lobby-layout {
    display: grid;
    grid-template-columns: minmax(0, 1.2fr) minmax(340px, 0.8fr);
    gap: 24px;
    align-items: start;
  }
  .invite-panel,
  .lobby-settings {
    overflow: hidden;
    border: 1px solid var(--color-line-soft);
    border-radius: 12px;
    background: var(--color-card);
  }
  .lobby-photo {
    position: relative;
    height: 205px;
    color: #f5f3ef;
  }
  .lobby-photo::after {
    content: '';
    position: absolute;
    inset: 0;
    background: linear-gradient(180deg, transparent 30%, rgb(8 12 17 / 85%));
  }
  .lobby-photo img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    object-position: 50% 30%;
  }
  .photo-caption {
    position: absolute;
    z-index: 1;
    bottom: 20px;
    left: 28px;
    font-family: var(--font-display);
    font-size: 15px;
    text-transform: uppercase;
    font-weight: 700;
    letter-spacing: 0.05em;
  }
  .invite-body {
    padding: 28px;
  }
  .invite-body h2 {
    font-family: var(--font-display);
    font-size: 34px;
    line-height: 1.1;
    font-weight: 800;
    margin: 7px 0 10px;
  }
  .invite-body > p:not(.room-eyebrow):not(.invite-footnote) {
    color: var(--color-muted-foreground);
    font-size: 12px;
    line-height: 1.7;
    max-width: 420px;
  }
  .invite-code {
    font-family: var(--font-mono);
    font-size: clamp(40px, 5vw, 62px);
    font-weight: 700;
    letter-spacing: 0.18em;
    line-height: 1;
    padding: 28px 0;
    user-select: all;
  }
  .invite-actions {
    display: flex;
    gap: 10px;
    flex-wrap: wrap;
  }
  .invite-footnote {
    margin-top: 16px;
    font-size: 10px;
    color: var(--color-muted-foreground);
  }
  .room-primary,
  .room-secondary {
    display: inline-flex;
    justify-content: center;
    align-items: center;
    gap: 8px;
    padding: 12px 18px;
    border-radius: 7px;
    font-size: 12px;
    font-weight: 600;
  }
  .room-primary {
    background: var(--color-primary);
    color: var(--color-primary-foreground);
  }
  .room-secondary {
    border: 1px solid var(--color-line-strong);
    background: var(--color-surface-2);
  }
  .room-primary:hover:not(:disabled),
  .room-secondary:hover:not(:disabled) {
    filter: brightness(1.08);
  }
  .lobby-settings {
    border-top: 2px solid var(--color-primary);
    padding: 24px;
  }
  .lobby-panel-heading {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 20px;
  }
  .lobby-panel-heading h2 {
    font-family: var(--font-display);
    font-size: 24px;
    font-weight: 700;
  }
  .lobby-panel-heading > span {
    display: flex;
    gap: 6px;
    align-items: center;
    font-size: 11px;
    color: var(--color-muted-foreground);
  }
  .player-seats {
    display: grid;
    gap: 10px;
  }
  .seat {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    padding: 12px 14px;
    border: 1px solid var(--color-line-soft);
    border-radius: 9px;
    background: var(--color-surface-1);
    font-size: 12px;
  }
  .seat.local {
    border-color: var(--color-primary);
  }
  .seat strong {
    font-family: var(--font-display);
    font-size: 16px;
    letter-spacing: 0.05em;
  }
  .seat-state {
    display: flex;
    align-items: center;
    gap: 8px;
    color: var(--color-muted-foreground);
  }
  .seat-dot {
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: var(--color-muted-foreground);
  }
  .seat-dot.online {
    background: var(--color-positive);
  }
  .lobby-rules {
    margin: 24px 0;
    padding: 20px 0;
    border-block: 1px solid var(--color-line-soft);
  }
  .lobby-rules > div {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    font-size: 12px;
    margin-bottom: 13px;
  }
  .lobby-rules > div:last-child {
    margin: 0;
  }
  .lobby-rules dt {
    display: flex;
    align-items: center;
    gap: 6px;
    color: var(--color-muted-foreground);
  }
  .lobby-rules dd {
    font-weight: 600;
  }
  .lobby-ready {
    display: flex;
    gap: 8px;
    align-items: center;
    color: var(--color-muted-foreground);
    font-size: 12px;
    line-height: 1.6;
    margin-bottom: 16px;
  }
  .lobby-ready > span {
    height: 6px;
    width: 6px;
    flex-shrink: 0;
    border-radius: 50%;
    background: var(--color-muted-foreground);
  }
  .lobby-ready > span.joined {
    background: var(--color-positive);
  }
  .start-draft {
    width: 100%;
    padding: 14px;
    margin-bottom: 10px;
  }
  .lobby-manage {
    display: flex;
    justify-content: space-between;
    gap: 14px;
    margin-top: 12px;
  }
  .lobby-manage button {
    display: flex;
    align-items: center;
    gap: 6px;
    color: var(--color-muted-foreground);
    font-size: 11px;
  }
  .lobby-manage button:hover {
    color: var(--color-foreground);
  }
  .draft-stage,
  .panel {
    border: 1px solid var(--color-line-soft);
    border-radius: 12px;
    padding: 1.1rem;
    background: var(--color-card);
    display: grid;
    gap: 0.9rem;
    position: relative;
    min-width: 0;
  }
  .draft-stage h2,
  .panel h2 {
    margin: 0;
    font-family: var(--font-display);
    font-size: 1.5rem;
    letter-spacing: 0.03em;
    font-weight: 800;
    line-height: 1.1;
  }
  .stage-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 1rem;
  }
  .stage-eyebrow {
    font-family: var(--font-mono);
    font-size: 10px;
    color: var(--color-primary);
    font-weight: 700;
    letter-spacing: 0.12em;
    text-transform: uppercase;
  }
  .pick-clock {
    font-family: var(--font-mono);
    font-size: 1.5rem;
    font-variant-numeric: tabular-nums;
    border: 1px solid var(--color-line-strong);
    border-radius: 10px;
    padding: 0.35rem 0.8rem;
    min-width: 4.5rem;
    text-align: center;
  }
  .pick-clock.urgent {
    border-color: #b91c1c;
    color: #fca5a5;
    animation: pick-pulse 1s ease-in-out infinite;
  }
  @keyframes pick-pulse {
    0%,
    100% {
      box-shadow: 0 0 0 0 rgb(185 28 28 / 0%);
    }
    50% {
      box-shadow: 0 0 0 4px rgb(185 28 28 / 22%);
    }
  }
  .boards {
    display: grid;
    gap: 1rem;
    grid-template-columns: 1fr;
  }
  .board-solo {
    display: grid;
    gap: 1rem;
    min-width: 0;
  }
  .board-column {
    min-width: 0;
  }
  @media (min-width: 900px) {
    .boards {
      grid-template-columns: 1.4fr 1fr;
      align-items: start;
    }
  }
  .board-column h3 {
    margin: 0 0 0.5rem;
    font-size: 0.9rem;
    color: var(--color-muted-foreground);
    text-transform: uppercase;
    letter-spacing: 0.1em;
  }
  .board-column.rival {
    opacity: 0.92;
  }
  .panel-hint {
    margin: 0;
    font-size: 0.88rem;
    color: var(--color-muted-foreground);
  }
  .panel-actions {
    display: flex;
    gap: 0.75rem;
    flex-wrap: wrap;
  }
  .countdown {
    margin: 0;
    font-family: var(--font-mono);
  }
  .room-footer {
    border-top: 1px solid var(--color-line-soft);
    margin-top: 30px;
    padding-top: 20px;
  }
  button {
    cursor: pointer;
  }
  button:disabled {
    opacity: 0.45;
    cursor: default;
  }
  button:focus-visible,
  a:focus-visible {
    outline: 2px solid var(--color-ring);
    outline-offset: 4px;
  }
  @media (max-width: 850px) {
    .lobby-layout {
      grid-template-columns: 1fr;
    }
    .room-page {
      padding: 24px 20px 88px;
    }
    .lobby-photo {
      height: 180px;
    }
  }
  @media (max-width: 640px) {
    .room-page {
      padding: 16px 12px calc(88px + env(safe-area-inset-bottom));
    }
    .draft-stage,
    .panel {
      gap: 0.7rem;
      padding: 0.7rem;
      border-radius: 11px;
    }
    .draft-stage h2,
    .panel h2 {
      font-size: 1.25rem;
    }
    .stage-header {
      position: sticky;
      top: 0;
      z-index: 30;
      gap: 0.6rem;
      margin: -0.7rem -0.7rem 0;
      padding: 0.6rem 0.7rem;
      border-bottom: 1px solid var(--color-line-soft);
      border-radius: 11px 11px 0 0;
      background: color-mix(in srgb, var(--color-card) 88%, transparent);
      backdrop-filter: blur(10px);
      -webkit-backdrop-filter: blur(10px);
    }
    .stage-eyebrow {
      font-size: 9px;
    }
    .pick-clock {
      min-width: 3.9rem;
      padding: 0.3rem 0.6rem;
      font-size: 1.2rem;
      border-radius: 9px;
    }
    .board-solo {
      gap: 0.7rem;
    }
    .board-column h3 {
      margin: 0 0 0.4rem;
      font-size: 0.72rem;
    }
    .panel-actions {
      gap: 0.6rem;
    }
    .panel-actions .room-primary {
      flex: 1 1 100%;
      min-height: 3rem;
    }
    .room-primary,
    .room-secondary {
      min-height: 2.9rem;
      touch-action: manipulation;
    }
  }
  @media (max-width: 520px) {
    .room-stages {
      display: grid;
      grid-template-columns: repeat(4, minmax(0, 1fr));
      gap: 8px;
    }
    .room-stages li {
      flex-direction: column;
      text-align: center;
      gap: 6px;
      font-size: 10px;
    }
    .room-stages li > span {
      width: 18px;
      height: 18px;
    }

    .invite-body,
    .lobby-settings {
      padding: 20px;
    }
    .invite-actions > button {
      flex: 1;
      padding-inline: 10px;
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .pick-clock.urgent {
      animation: none;
    }
  }
</style>
