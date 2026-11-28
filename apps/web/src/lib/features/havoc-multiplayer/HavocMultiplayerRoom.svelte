<script lang="ts">
  import AchievementReveal from '#lib/features/profile/AchievementReveal.svelte';
  import RoomShell from '#lib/features/multiplayer/RoomShell.svelte';
  import { getLobbyCoordinator } from '#lib/features/multiplayer/lobby-context.svelte.js';
  import { onDestroy, onMount } from 'svelte';
  import MultiplayerLobbyLink from '#lib/features/multiplayer/MultiplayerLobbyLink.svelte';
  import { loadLobbyId } from '#lib/features/multiplayer/multiplayer-lobby.js';
  import { goto } from '$app/navigation';
  import { resolve } from '$app/paths';
  import {
    ArrowLeft,
    ArrowRight,
    Check,
    Clock,
    LogOut,
    Shuffle,
    UserMinus,
    Users,
  } from '@lucide/svelte';
  import { HAVOC_MULTIPLAYER_SHOWDOWN_MS } from '@hoop-rush/data-contracts';
  import type { ReactionKey } from '@hoop-rush/application/havoc-multiplayer';
  import HavocLineupLock from '#lib/features/havoc/HavocLineupLock.svelte';
  import { HavocMultiplayerController } from '#lib/features/havoc-multiplayer/havoc-multiplayer-controller.svelte.js';
  import { LobbyAutoStart } from '#lib/features/multiplayer/lobby-auto-start.js';
  import HavocMultiplayerBroadcast from '#lib/features/havoc-multiplayer/HavocMultiplayerBroadcast.svelte';
  import HavocMultiplayerChampionship from '#lib/features/havoc-multiplayer/HavocMultiplayerChampionship.svelte';
  import HavocMultiplayerDraftBoard from '#lib/features/havoc-multiplayer/HavocMultiplayerDraftBoard.svelte';
  import HavocMultiplayerGameResults from '#lib/features/havoc-multiplayer/HavocMultiplayerGameResults.svelte';
  import HavocMultiplayerLineupRail from '#lib/features/havoc-multiplayer/HavocMultiplayerLineupRail.svelte';
  import HavocMultiplayerSeriesTracker from '#lib/features/havoc-multiplayer/HavocMultiplayerSeriesTracker.svelte';
  import {
    HAVOC_MULTIPLAYER_STAGE_LABELS,
    havocMultiplayerLocalSide,
    havocMultiplayerPhaseLabel,
    havocMultiplayerSecondsLeft,
    havocMultiplayerStageIndex,
    havocMultiplayerVerificationOf,
  } from '#lib/features/havoc-multiplayer/havoc-multiplayer-room-view.js';
  import { havocLineupSlotsFromPicks } from '@hoop-rush/application/havoc';
  import Button from '#lib/components/ui/Button.svelte';
  import ActionLink from '#lib/components/ui/ActionLink.svelte';
  import ActionRow from '#lib/components/ui/ActionRow.svelte';
  import PageHeader from '#lib/components/ui/PageHeader.svelte';
  import PageShell from '#lib/components/ui/PageShell.svelte';
  import Panel from '#lib/components/ui/Panel.svelte';
  import SectionHeading from '#lib/components/ui/SectionHeading.svelte';
  import Alert from '#lib/components/ui/Alert.svelte';

  const REACTIONS: { key: ReactionKey; label: string; glyph: string }[] = [
    { key: 'hype', label: 'Hype', glyph: '🔥' },
    { key: 'clap', label: 'Clap', glyph: '👏' },
    { key: 'cold', label: 'Cold', glyph: '🥶' },
    { key: 'wow', label: 'Wow', glyph: '😮' },
  ];

  let { roomId }: { roomId: string } = $props();
  let lobbyId = $state<string | null>(null);
  const controller = new HavocMultiplayerController();
  const lobbyCoordinator = getLobbyCoordinator();
  let reducedMotion = $state(false);
  let wideLayout = $state(false);
  let showdownReady = $state(false);
  let showdownSecondsLeft = $state(0);
  let followingRematch = false;
  let mounted = false;

  onMount(() => {
    mounted = true;
    lobbyId = loadLobbyId(roomId);
    void controller.attach(roomId);
    const motionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
    reducedMotion = motionQuery.matches;
    const onMotionChange = (event: MediaQueryListEvent) => {
      reducedMotion = event.matches;
    };
    motionQuery.addEventListener('change', onMotionChange);
    const widthQuery = window.matchMedia('(min-width: 1200px)');
    wideLayout = widthQuery.matches;
    const onWidthChange = (event: MediaQueryListEvent) => {
      wideLayout = event.matches;
    };
    widthQuery.addEventListener('change', onWidthChange);
    return () => {
      motionQuery.removeEventListener('change', onMotionChange);
      widthQuery.removeEventListener('change', onWidthChange);
    };
  });
  onDestroy(() => {
    mounted = false;
    controller.dispose();
  });

  const phase = $derived(controller.phase);
  const phaseLabel = $derived(havocMultiplayerPhaseLabel(phase));
  const variantLabel = $derived(controller.variant === 'curated' ? 'Curated' : 'Standard');
  const stageIndex = $derived(havocMultiplayerStageIndex(phase));
  const me = $derived(
    controller.members.find((member) => member.participantId === controller.participantId) ?? null,
  );
  const rival = $derived(
    controller.members.find((member) => member.participantId !== controller.participantId) ?? null,
  );
  const isHost = $derived(controller.participantId === 'p1');
  const onlineCount = $derived(controller.members.filter((member) => member.online).length);
  const bothOnline = $derived(
    controller.members.length === 2 && controller.members.every((member) => member.online),
  );
  const drafting = $derived(phase === 'drafting');
  const myPicks = $derived(
    controller.draft?.picks.filter((pick) => pick.participantId === controller.participantId) ?? [],
  );
  const rivalPicks = $derived(
    controller.draft?.picks.filter((pick) => pick.participantId !== controller.participantId) ?? [],
  );
  const myLineupSlots = $derived(havocLineupSlotsFromPicks(myPicks));
  const rivalLineupSlots = $derived(havocLineupSlotsFromPicks(rivalPicks));
  const offer = $derived(controller.offer);
  const pickSecondsLeft = $derived(havocMultiplayerSecondsLeft(controller.deadlineMsLeft));
  const urgentPick = $derived(pickSecondsLeft !== null && pickSecondsLeft <= 10);
  const rerollsUsed = $derived(
    controller.participantId === null
      ? 0
      : (controller.draft?.rerollsUsed[controller.participantId] ?? 0),
  );
  const canReroll = $derived(controller.activeTurn && rerollsUsed === 0);
  const lastGame = $derived(
    controller.series?.games.filter((game) => game.status === 'verified').at(-1) ?? null,
  );
  const lastOutput = $derived(lastGame ? (controller.outputs[lastGame.gameNumber] ?? null) : null);
  const lastLocalSide = $derived(
    lastGame
      ? havocMultiplayerLocalSide(
          controller.series,
          lastGame.gameNumber,
          controller.participantId ?? 'p1',
        )
      : 'home',
  );
  const resultVerification = $derived(
    havocMultiplayerVerificationOf(
      controller.verification,
      controller.currentOutput?.gameNumber ?? null,
    ),
  );

  $effect(() => {
    if (phase !== 'lineup-showdown') {
      showdownReady = false;
      return;
    }
    if (reducedMotion) {
      showdownReady = true;
      return;
    }
    showdownReady = false;
    showdownSecondsLeft = Math.ceil(HAVOC_MULTIPLAYER_SHOWDOWN_MS / 1000);
    const interval = setInterval(() => {
      showdownSecondsLeft = Math.max(0, showdownSecondsLeft - 1);
    }, 1000);
    const timer = setTimeout(() => {
      showdownReady = true;
      clearInterval(interval);
    }, HAVOC_MULTIPLAYER_SHOWDOWN_MS);
    return () => {
      clearInterval(interval);
      clearTimeout(timer);
    };
  });

  $effect(() => {
    const successor = controller.successorRoomId;
    if (lobbyId || !successor || successor === roomId || followingRematch) return;
    followingRematch = true;
    void controller.followRematch().then((next) => {
      if (!mounted) return;
      if (next) {
        void goto(resolve('/havoc/room/[roomId]', { roomId: next }));
      } else {
        followingRematch = false;
      }
    });
  });

  // Shared-lobby matches start once both seats are present; direct invites keep
  // the explicit Start draft button.
  const autoStart = new LobbyAutoStart();
  let autoStartFailed = $state(false);
  $effect(() => {
    if (!lobbyId) return;
    const gate = {
      sharedLobby: true,
      isHost,
      bothOnline,
      phase,
      roomKey: roomId,
    };
    if (!autoStart.shouldStart(gate)) return;
    void autoStart
      .run(roomId, () => controller.startDraft())
      .then(() => {
        autoStartFailed = false;
      })
      .catch(() => {
        autoStartFailed = true;
      });
  });

  async function leaveRoom(): Promise<void> {
    await controller.leaveRoom();
    await goto(resolve('/multiplayer'));
  }

  async function removeOpponent(): Promise<void> {
    if (lobbyId) {
      try {
        await lobbyCoordinator.session.removeOpponent();
      } catch (error) {
        controller.error = error instanceof Error ? error.message : 'Could not remove opponent.';
      }
      return;
    }
    await controller.removeGuest();
  }

  function reactionGlyph(key: ReactionKey): string {
    return REACTIONS.find((entry) => entry.key === key)?.glyph ?? '👀';
  }
</script>

<svelte:window onfocus={() => controller.refresh()} ononline={() => controller.refresh()} />

<svelte:head>
  <title>Havoc room · Hoop Rush</title>
</svelte:head>

<PageShell as="section" width="full" padding="lg" class="hm-room">
  <div class="hm-nav">
    <a href={resolve('/multiplayer')}><ArrowLeft size={15} aria-hidden="true" /> Multiplayer</a>
  </div>

  {#if !controller.snapshot && !controller.error}
    <div class="hm-empty" role="status">
      <Users size={28} aria-hidden="true" />
      <PageHeader
        eyebrow="Havoc room"
        title="Opening your room"
        description="Loading the Havoc catalog and room settings…"
      />
    </div>
  {:else if !controller.snapshot}
    <div class="hm-empty">
      <PageHeader eyebrow="Havoc room" title="Couldn’t open this room" />
      <Alert tone="danger">{controller.error}</Alert>
      <ActionRow>
        {#snippet primary()}
          <Button type="button" onclick={() => void controller.retryAttach()}>Try again</Button>
        {/snippet}
        {#snippet tertiary()}
          <ActionLink href={resolve('/multiplayer')} tone="secondary"
            >Back to multiplayer <ArrowRight size={16} aria-hidden="true" /></ActionLink
          >
        {/snippet}
      </ActionRow>
    </div>
  {:else}
    <RoomShell
      profileKind="havoc-multiplayer"
      {roomId}
      title="Havoc room"
      phase={phaseLabel}
      summary={`Best of seven · ${variantLabel}`}
      code={controller.snapshot.code}
      participantId={controller.participantId}
      members={controller.members}
      connection={controller.connection}
      error={controller.error}
    />
    {#if phase !== 'lobby' && phase !== 'expired' && phase !== 'integrity-failed'}
      <ol class="hm-stages" aria-label="Match progress">
        {#each HAVOC_MULTIPLAYER_STAGE_LABELS as label, index (label)}
          <li
            class:current={index === stageIndex}
            class:finished={index < stageIndex}
            aria-current={index === stageIndex ? 'step' : undefined}
          >
            <span
              >{#if index < stageIndex}<Check size={12} aria-hidden="true" />{:else}{index +
                  1}{/if}</span
            >{label}
          </li>
        {/each}
      </ol>
    {/if}

    <MultiplayerLobbyLink {roomId} completed={phase === 'championship'} />

    {#if controller.notice}<p class="hm-notice" role="status">{controller.notice}</p>{/if}
    {#if rival && !rival.online && phase !== 'lobby' && phase !== 'expired'}
      <p class="hm-notice" role="status">
        Your opponent is offline. Their place in the room is kept.
      </p>
    {/if}
    {#if controller.integrityFailed && phase !== 'integrity-failed'}
      <Alert tone="danger">The two simulations disagreed. This room can no longer advance.</Alert>
    {/if}

    {#if phase === 'lobby'}
      <div class="hm-lobby">
        <Panel padding="md" class="hm-invite">
          <p class="ui-label">{isHost ? 'Bring your opponent' : 'You’re in'}</p>
          <SectionHeading
            title={isHost ? 'Your room. Your invite.' : 'The matchup is set.'}
            level={2}
            size="lg"
          />
          <p class="text-sm leading-relaxed text-muted-foreground">
            {isHost
              ? 'Share the room code or invite link from the header. Start the draft once your opponent is online.'
              : 'Stay in this room. The host starts the draft once both players are online.'}
          </p>
        </Panel>

        <Panel padding="md" class="hm-seats">
          <div class="hm-seats-head">
            <SectionHeading title="Players" level={2} size="md" />
            <span class="ui-label" data-tone="muted">{onlineCount}/2 online</span>
          </div>
          <ul class="hm-seat-list">
            {#each controller.members as member (member.participantId)}
              <li class:local={member.participantId === controller.participantId}>
                <strong>{member.displayName}</strong>
                <span class="hm-seat-meta">
                  <span class="hm-dot" class:online={member.online}></span>
                  {member.online ? 'Online' : 'Away'} · {member.ready ? 'Ready' : 'Not ready'}
                </span>
              </li>
            {/each}
          </ul>
          <div class="hm-lobby-actions">
            <Button
              type="button"
              tone="secondary"
              disabled={controller.busy || me?.ready === true}
              onclick={() => void controller.setReady()}
            >
              {me?.ready === true ? 'Ready' : 'Ready up'}
            </Button>
            {#if isHost}
              {#if lobbyId && !autoStartFailed}
                <p class="hm-footnote" role="status">
                  {bothOnline
                    ? 'Starting the draft for both players…'
                    : 'The draft starts automatically once your opponent is online.'}
                </p>
              {:else}
                <Button
                  type="button"
                  data-havoc-multiplayer-start
                  disabled={controller.busy || !bothOnline}
                  onclick={() => {
                    autoStart.retry(roomId);
                    void controller.startDraft();
                  }}
                >
                  {controller.busy ? 'Starting…' : autoStartFailed ? 'Retry start' : 'Start draft'}
                  <ArrowRight size={16} aria-hidden="true" />
                </Button>
              {/if}
            {/if}
          </div>
          {#if isHost && !bothOnline}
            <p class="hm-footnote" role="status">Waiting for your opponent to come online.</p>
          {/if}
          <div class="hm-lobby-manage">
            {#if isHost && rival}
              <button type="button" onclick={removeOpponent} disabled={controller.busy}
                ><UserMinus size={14} aria-hidden="true" /> Remove opponent</button
              >
            {/if}
            <button type="button" onclick={leaveRoom} disabled={controller.busy}
              ><LogOut size={14} aria-hidden="true" /> Leave room</button
            >
          </div>
        </Panel>
      </div>
    {:else if phase === 'expired'}
      <div class="hm-empty">
        <PageHeader
          eyebrow="Havoc room"
          title="Room expired"
          description="Your local saves are kept. Create a new room to play again."
        />
        <ActionLink href={resolve('/multiplayer')}
          >New Havoc room <ArrowRight size={16} aria-hidden="true" /></ActionLink
        >
      </div>
    {:else if phase === 'integrity-failed'}
      <div class="hm-empty">
        <PageHeader
          eyebrow="Havoc room"
          title="Results could not be verified"
          description="The two simulations disagreed. Neither result has been accepted."
        />
        <ActionLink href={resolve('/multiplayer')}
          >New Havoc room <ArrowRight size={16} aria-hidden="true" /></ActionLink
        >
      </div>
    {:else}
      {#if controller.series}
        <div class="hm-series-band">
          <HavocMultiplayerSeriesTracker
            series={controller.series}
            localParticipantId={controller.participantId ?? 'p1'}
          />
        </div>
      {/if}

      <div class="hm-arena" data-phase={phase}>
        <div class="hm-rail-col">
          <HavocMultiplayerLineupRail
            picks={myPicks}
            title="Your five"
            eyebrow={me?.displayName ?? 'You'}
            active={drafting && controller.draft?.activeParticipantId === controller.participantId}
            collapsible={!wideLayout}
            side="local"
            emptyLabel={drafting ? 'Your first pick is coming up.' : 'No lineup recorded.'}
          />
        </div>

        <div class="hm-main">
          {#if phase === 'drafting'}
            <Panel as="section" padding="md" class="hm-draft" aria-label="Draft stage">
              <header class="hm-draft-head">
                <div>
                  <p class="ui-label">Round {offer?.round ?? '—'} of 5 · {offer?.slot ?? '—'}</p>
                  <SectionHeading
                    title={controller.activeTurn ? 'Your pick' : 'Opponent picking'}
                    level={2}
                    size="md"
                  />
                </div>
                <div class="hm-clock" class:urgent={urgentPick} aria-label="Pick timer">
                  {pickSecondsLeft === null ? '—' : `${pickSecondsLeft}s`}
                </div>
              </header>

              {#if controller.consideration}
                <p class="hm-consideration" role="status">
                  Opponent is weighing {controller.consideration.displayName}…
                </p>
              {/if}
              {#if controller.reaction}
                <p class="hm-consideration" role="status">
                  Opponent reacted {reactionGlyph(controller.reaction.reaction)}
                </p>
              {/if}

              {#if offer}
                <HavocMultiplayerDraftBoard
                  cards={offer.cards}
                  offerId={offer.offerId}
                  revision={controller.draft?.revision ?? 0}
                  active={controller.activeTurn}
                  busy={controller.busy}
                  {reducedMotion}
                  lineupSide="local"
                  onpick={(card) => controller.pickCard(card)}
                />
                <p class="hm-keys">
                  Press <kbd>1</kbd>–<kbd>3</kbd> to choose a card, <kbd>Enter</kbd> to draft it.
                </p>
              {:else}
                <p class="text-sm text-muted-foreground">Preparing the next offer…</p>
              {/if}

              <div class="hm-draft-actions">
                <Button
                  type="button"
                  tone="secondary"
                  disabled={controller.busy || !canReroll}
                  onclick={() => void controller.rerollOffer()}
                >
                  <Shuffle size={16} aria-hidden="true" /> New choices
                </Button>
                <span class="hm-rerolls">{rerollsUsed === 0 ? 1 : 0} of 1 reroll left</span>
              </div>

              <div class="hm-reactions" role="group" aria-label="Reactions">
                {#each REACTIONS as reaction (reaction.key)}
                  <button
                    type="button"
                    disabled={controller.muted}
                    aria-label={reaction.label}
                    onclick={() => void controller.react(reaction.key)}
                  >
                    <span aria-hidden="true">{reaction.glyph}</span>
                  </button>
                {/each}
                <button
                  type="button"
                  class="hm-mute"
                  aria-pressed={controller.muted}
                  onclick={() => controller.setMuted(!controller.muted)}
                >
                  {controller.muted ? 'Unmute' : 'Mute'}
                </button>
              </div>
            </Panel>
          {:else if phase === 'lineup-showdown'}
            <Panel as="section" padding="md" class="hm-draft" aria-label="Lineup showdown">
              <header class="hm-draft-head">
                <div>
                  <p class="ui-label">Lineup showdown</p>
                  <SectionHeading title="The fives are locked" level={2} size="md" />
                </div>
              </header>
              {#if !showdownReady}
                <p class="hm-consideration" role="status">
                  Revealing lineups… {showdownSecondsLeft}s
                </p>
              {/if}
              <div class="hm-showdown-lineups">
                <HavocLineupLock slots={myLineupSlots} title="Your five" compact />
                <div class="hm-showdown-vs" aria-hidden="true">VS</div>
                <HavocLineupLock slots={rivalLineupSlots} title="Opponent five" compact />
              </div>
              <div class="hm-draft-actions">
                <Button
                  type="button"
                  disabled={!showdownReady || controller.busy || controller.localReady}
                  onclick={() => void controller.readyForNextGame()}
                >
                  {controller.localReady ? 'Ready' : 'Ready for Game 1'}
                </Button>
              </div>
            </Panel>
          {:else if phase === 'preparing-game'}
            <Panel as="section" padding="md" class="hm-draft" aria-label="Preparing game">
              <header class="hm-draft-head">
                <div>
                  <p class="ui-label">Game {controller.currentGameNumber ?? '—'} ready check</p>
                  <SectionHeading
                    title={controller.localReady && controller.opponentReady
                      ? 'Starting the broadcast'
                      : 'Ready up'}
                    level={2}
                    size="md"
                  />
                </div>
                {#if controller.readyCountdownMs !== null}
                  <div class="hm-clock" aria-label="Auto-start countdown">
                    {havocMultiplayerSecondsLeft(controller.readyCountdownMs)}s
                  </div>
                {/if}
              </header>
              <p class="text-sm leading-relaxed text-muted-foreground">
                {#if controller.opponentReady && controller.localReady}
                  Both players are ready. Starting Game {controller.currentGameNumber ?? 1}…
                {:else if controller.opponentReady}
                  Opponent is ready.
                {:else if controller.localReady}
                  Waiting for your opponent. The game starts automatically after 60 seconds.
                {:else}
                  Both players ready up to start the broadcast.
                {/if}
              </p>
              {#if lastOutput && lastGame}
                <p class="hm-last-result">
                  <Clock size={13} aria-hidden="true" />
                  Last result: Game {lastGame.gameNumber} · {lastOutput.winner ===
                  controller.participantId
                    ? 'you won'
                    : 'opponent won'}
                  ({lastLocalSide === 'home'
                    ? lastOutput.result.home.points
                    : lastOutput.result.away.points}–{lastLocalSide === 'home'
                    ? lastOutput.result.away.points
                    : lastOutput.result.home.points})
                </p>
              {/if}
              <div class="hm-draft-actions">
                <Button
                  type="button"
                  disabled={controller.localReady || controller.busy}
                  onclick={() => void controller.readyForNextGame()}
                >
                  {controller.localReady ? 'Ready' : 'Ready for this game'}
                </Button>
              </div>
            </Panel>
          {:else if controller.showingBroadcast && controller.currentOutput && controller.visible}
            <HavocMultiplayerBroadcast
              output={controller.currentOutput}
              visible={controller.visible}
              feed={controller.feed}
              abilities={controller.abilities}
              abilityCount={controller.abilityCount}
              progress={controller.progress}
              localParticipantId={controller.participantId ?? 'p1'}
              series={controller.series}
              minimal={reducedMotion}
            />
          {:else if phase === 'broadcasting'}
            <Panel as="section" padding="md" class="hm-wait" aria-label="Broadcast loading">
              <p class="ui-label">Broadcast</p>
              <SectionHeading
                title={`Simulating Game ${controller.currentBroadcast?.gameNumber ?? '—'}…`}
                level={2}
                size="md"
              />
              <p class="text-sm leading-relaxed text-muted-foreground" role="status">
                Both sides run the same game locally. The tape starts as soon as your simulation
                lands.
              </p>
              {#if controller.error}
                <Alert tone="danger">{controller.error}</Alert>
                <Button type="button" onclick={() => void controller.refresh()}>
                  Retry simulation
                </Button>
              {/if}
            </Panel>
          {:else if phase === 'game-results'}
            {#if controller.currentOutput && controller.series}
              <HavocMultiplayerGameResults
                output={controller.currentOutput}
                series={controller.series}
                localParticipantId={controller.participantId ?? 'p1'}
                verification={resultVerification}
                readyCountdownMs={controller.readyCountdownMs}
                localReady={controller.localReady}
                opponentReady={controller.opponentReady}
                awaitingContinue={controller.awaitingContinue}
                onready={() => void controller.readyForNextGame()}
                oncontinue={() => controller.continueAfterGame()}
              />
            {:else}
              <Panel as="section" padding="md" class="hm-wait" aria-label="Game results loading">
                <p class="text-sm text-muted-foreground" role="status">Loading the game result…</p>
                {#if controller.error}
                  <Alert tone="danger">{controller.error}</Alert>
                  <Button type="button" onclick={() => void controller.refresh()}>
                    Retry simulation
                  </Button>
                {/if}
              </Panel>
            {/if}
          {:else if phase === 'championship'}
            <AchievementReveal bindingId={`havoc-multiplayer:${roomId}`} />
            {#if controller.series}
              <HavocMultiplayerChampionship
                series={controller.series}
                mvp={controller.mvp}
                picks={controller.draft?.picks ?? []}
                outputs={controller.outputs}
                localParticipantId={controller.participantId ?? 'p1'}
                myRematchRequested={controller.myRematchRequested}
                rivalRematchRequested={controller.rivalRematchRequested}
                rematchBusy={controller.busy}
                rematchReady={controller.successorRoomId !== null}
                onrematch={() => void controller.requestRematch()}
                onconfirmrematch={() => void controller.confirmRematch()}
                showRematch={!lobbyId}
              />
            {:else}
              <Panel as="section" padding="md" class="hm-wait" aria-label="Championship loading">
                <p class="text-sm text-muted-foreground" role="status">Loading the series…</p>
              </Panel>
            {/if}
          {/if}
        </div>

        <div class="hm-rail-col">
          <HavocMultiplayerLineupRail
            picks={rivalPicks}
            title="Opponent five"
            eyebrow={rival?.displayName ?? 'Opponent'}
            active={drafting && controller.draft?.activeParticipantId !== controller.participantId}
            collapsible={!wideLayout}
            side="rival"
            emptyLabel="Their picks show up here as they draft."
          />
        </div>
      </div>

      <footer class="hm-footer">
        <Button type="button" tone="secondary" onclick={leaveRoom} disabled={controller.busy}
          ><LogOut size={14} aria-hidden="true" /> Leave room</Button
        >
      </footer>
    {/if}
  {/if}
</PageShell>

<style>
  .hm-arena[data-phase='lineup-showdown'],
  .hm-arena[data-phase='championship'] {
    grid-template-columns: minmax(0, 1fr);
  }
  .hm-arena[data-phase='lineup-showdown'] > .hm-rail-col,
  .hm-arena[data-phase='championship'] > .hm-rail-col {
    display: none;
  }
  :global(.hm-room) {
    width: 100%;
    max-width: none;
    min-width: 0;
  }
  .hm-nav {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    margin-bottom: 24px;
  }
  .hm-nav a {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    font-size: 13px;
    color: #c1cae4;
  }
  .hm-nav a:hover {
    color: #f2f4ff;
  }

  .hm-stages {
    display: flex;
    flex-wrap: wrap;
    gap: 10px;
    margin: 0;
    padding: 0;
    list-style: none;
  }
  .hm-stages li {
    display: inline-flex;
    align-items: center;
    gap: 7px;
    padding: 7px 12px;
    border: 1px solid #465273;
    border-radius: 999px;
    font-size: 11px;
    color: #aab9db;
  }
  .hm-stages li > span {
    display: grid;
    place-items: center;
    width: 18px;
    height: 18px;
    border-radius: 50%;
    background: #303c63;
    font-family: var(--font-mono);
    font-size: 9px;
    font-weight: 700;
  }
  .hm-stages li.current {
    border-color: #ffd782;
    color: #ffd782;
  }
  .hm-stages li.current > span {
    background: #ffd782;
    color: #141b39;
  }
  .hm-stages li.finished > span {
    background: #8bceaf;
    color: #141b39;
  }
  .hm-notice {
    margin: 12px 0;
    font-size: 12px;
    color: #c1cae4;
  }
  .hm-empty {
    display: grid;
    justify-items: start;
    gap: 14px;
    padding: 48px 0;
  }
  .hm-empty :global(.ui-page-title) {
    font-size: clamp(2.2rem, 5vw, 3.4rem);
  }
  .hm-lobby {
    display: grid;
    gap: 20px;
    grid-template-columns: 1fr;
    align-items: start;
    margin-top: 20px;
  }
  @media (min-width: 900px) {
    .hm-lobby {
      grid-template-columns: minmax(0, 1.2fr) minmax(320px, 0.8fr);
    }
  }
  :global(.hm-invite) {
    display: grid;
    gap: 12px;
  }
  .hm-footnote {
    margin: 0;
    font-size: 11px;
    color: #aab9db;
  }
  :global(.hm-seats) {
    display: grid;
    gap: 14px;
  }
  .hm-seats-head {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 10px;
  }
  .hm-seats-head :global(.ui-section-title) {
    font-size: 1.4rem;
  }
  .hm-seats-head span {
    font-family: var(--font-mono);
    font-size: 11px;
    color: #aab9db;
  }
  .hm-seat-list {
    display: grid;
    gap: 10px;
    margin: 0;
    padding: 0;
    list-style: none;
  }
  .hm-seat-list li {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    padding: 12px 14px;
    border: 1px solid #3c486b;
    border-radius: 12px;
    background: #141b39;
  }
  .hm-seat-list li.local {
    border-color: #ffd782;
  }
  .hm-seat-list strong {
    font-family: var(--font-display);
    font-size: 16px;
    letter-spacing: 0.03em;
  }
  .hm-seat-meta {
    display: inline-flex;
    align-items: center;
    gap: 7px;
    font-size: 12px;
    color: #c1cae4;
  }
  .hm-dot {
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: #aab9db;
  }
  .hm-dot.online {
    background: #8bceaf;
  }
  .hm-lobby-actions {
    display: flex;
    flex-wrap: wrap;
    gap: 10px;
  }
  .hm-lobby-actions :global(.ui-btn) {
    flex: 1 1 auto;
  }
  .hm-lobby-manage {
    display: flex;
    flex-wrap: wrap;
    justify-content: space-between;
    gap: 12px;
  }
  .hm-lobby-manage button {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    font-size: 12px;
    color: #c1cae4;
  }
  .hm-lobby-manage button:hover {
    color: #f2f4ff;
  }
  .hm-series-band {
    margin: 18px 0;
  }
  .hm-arena {
    display: grid;
    gap: 16px;
    grid-template-columns: minmax(0, 1fr);
    align-items: start;
  }
  .hm-main {
    order: 1;
    min-width: 0;
  }
  .hm-rail-col {
    order: 2;
    min-width: 0;
  }
  @media (min-width: 1200px) {
    .hm-arena {
      grid-template-columns: minmax(0, 15rem) minmax(0, 1fr) minmax(0, 15rem);
    }
    .hm-main {
      order: 2;
    }
    .hm-rail-col:first-child {
      order: 1;
      position: sticky;
      top: 12px;
    }
    .hm-rail-col:last-child {
      order: 3;
      position: sticky;
      top: 12px;
    }
  }
  :global(.hm-draft) {
    display: grid;
    gap: 14px;
    min-width: 0;
  }
  .hm-draft-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
  }
  .hm-draft-head :global(.ui-section-title) {
    font-size: 1.5rem;
  }
  .hm-clock {
    min-width: 4.5rem;
    padding: 6px 12px;
    border: 1px solid #465273;
    border-radius: 12px;
    text-align: center;
    font-family: var(--font-mono);
    font-size: 22px;
    font-variant-numeric: tabular-nums;
  }
  .hm-clock.urgent {
    border-color: #f290c5;
    color: #f290c5;
    animation: hm-clock-pulse 1s ease-in-out infinite;
  }
  @keyframes hm-clock-pulse {
    0%,
    100% {
      box-shadow: 0 0 0 0 rgb(242 144 197 / 0%);
    }
    50% {
      box-shadow: 0 0 0 4px rgb(242 144 197 / 22%);
    }
  }
  .hm-consideration {
    margin: 0;
    font-size: 12px;
    color: #f290c5;
  }
  .hm-keys {
    margin: 0;
    font-size: 12px;
    color: #aab9db;
  }
  .hm-keys kbd {
    padding: 2px 7px;
    border: 1px solid #465273;
    border-radius: 6px;
    background: #141b39;
    font-family: var(--font-mono);
    font-size: 11px;
    color: #f2f4ff;
  }
  .hm-draft-actions {
    display: flex;
    align-items: center;
    gap: 12px;
    flex-wrap: wrap;
  }
  .hm-rerolls {
    font-size: 12px;
    color: #aab9db;
  }
  .hm-reactions {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
  }
  .hm-reactions button {
    display: grid;
    place-items: center;
    min-width: 42px;
    min-height: 42px;
    border: 1px solid #465273;
    border-radius: 12px;
    background: #303c63;
    font-size: 18px;
  }
  .hm-reactions button:hover:not(:disabled) {
    border-color: #ffd782;
  }
  .hm-reactions .hm-mute {
    min-width: auto;
    padding: 0 12px;
    font-size: 11px;
    font-weight: 700;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: #c1cae4;
  }
  .hm-showdown-lineups {
    display: grid;
    gap: 14px;
    align-items: start;
  }
  @media (min-width: 760px) {
    .hm-showdown-lineups {
      grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr);
    }
  }
  .hm-showdown-vs {
    align-self: center;
    justify-self: center;
    font-family: var(--font-display);
    font-size: 2rem;
    font-weight: 900;
    color: #ffd782;
  }
  .hm-last-result {
    display: flex;
    align-items: center;
    gap: 7px;
    margin: 0;
    font-size: 12px;
    color: #c1cae4;
  }
  :global(.hm-wait) {
    display: grid;
    gap: 10px;
  }
  .hm-footer {
    margin-top: 24px;
    padding-top: 18px;
    border-top: 1px solid #3c486b;
  }
  button {
    cursor: pointer;
  }
  button:disabled {
    cursor: default;
  }
  @media (max-width: 899px) {
    .hm-stages {
      gap: 8px;
    }
    .hm-stages li {
      padding: 6px 10px;
    }
    .hm-draft-actions :global(.ui-btn) {
      flex: 1 1 100%;
      min-height: 44px;
    }
    .hm-reactions button {
      min-width: 46px;
      min-height: 46px;
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .hm-clock.urgent {
      animation: none;
    }
  }
</style>
