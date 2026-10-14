<script lang="ts">
  import { onDestroy, onMount, tick } from 'svelte';
  import { page } from '$app/state';
  import { goto } from '$app/navigation';
  import { resolve } from '$app/paths';
  import {
    ArrowLeft,
    ArrowRight,
    Check,
    Clock,
    Copy,
    Link,
    LogOut,
    Shuffle,
    UserMinus,
    Users,
  } from '@lucide/svelte';
  import { HAVOC_MULTIPLAYER_SHOWDOWN_MS, type HavocDraftCard } from '@hoop-rush/data-contracts';
  import type { ReactionKey } from '@hoop-rush/application/havoc-multiplayer';
  import HavocDraftCardView from '#lib/features/havoc/HavocDraftCard.svelte';
  import HavocLineupLock from '#lib/features/havoc/HavocLineupLock.svelte';
  import { HavocMultiplayerController } from '#lib/features/havoc-multiplayer/havoc-multiplayer-controller.svelte.js';
  import { inviteLinkForHavocMultiplayerCode } from '#lib/features/havoc-multiplayer/havoc-multiplayer-identity.js';
  import HavocMultiplayerBroadcast from '#lib/features/havoc-multiplayer/HavocMultiplayerBroadcast.svelte';
  import HavocMultiplayerChampionship from '#lib/features/havoc-multiplayer/HavocMultiplayerChampionship.svelte';
  import HavocMultiplayerGameResults from '#lib/features/havoc-multiplayer/HavocMultiplayerGameResults.svelte';
  import HavocMultiplayerLineupRail from '#lib/features/havoc-multiplayer/HavocMultiplayerLineupRail.svelte';
  import HavocMultiplayerSeriesTracker from '#lib/features/havoc-multiplayer/HavocMultiplayerSeriesTracker.svelte';
  import {
    HAVOC_MULTIPLAYER_REVEAL_SELECTION_MS,
    HAVOC_MULTIPLAYER_REVEAL_STAGGER_MS,
    HavocMultiplayerRevealDirector,
    type HavocMultiplayerRevealAttempt,
  } from '#lib/features/havoc-multiplayer/havoc-multiplayer-reveal.js';
  import {
    HAVOC_MULTIPLAYER_STAGE_LABELS,
    havocMultiplayerLineupSlots,
    havocMultiplayerLocalSide,
    havocMultiplayerPhaseLabel,
    havocMultiplayerSecondsLeft,
    havocMultiplayerStageIndex,
    havocMultiplayerVerificationOf,
  } from '#lib/features/havoc-multiplayer/havoc-multiplayer-room-view.js';

  const REACTIONS: { key: ReactionKey; label: string; glyph: string }[] = [
    { key: 'hype', label: 'Hype', glyph: '🔥' },
    { key: 'clap', label: 'Clap', glyph: '👏' },
    { key: 'cold', label: 'Cold', glyph: '🥶' },
    { key: 'wow', label: 'Wow', glyph: '😮' },
  ];

  const roomId = $derived(page.params.roomId ?? '');
  const controller = new HavocMultiplayerController();
  let reducedMotion = $state(false);
  let wideLayout = $state(false);
  let copiedCode = $state(false);
  let copiedLink = $state(false);
  let selectedCardId = $state<string | null>(null);
  let showdownReady = $state(false);
  let showdownSecondsLeft = $state(0);
  let followingRematch = false;
  const revealContext = new Map<
    number,
    { card: HavocDraftCard; source: HTMLElement; sourceRect: DOMRect }
  >();
  const revealFlyers = new Map<number, { clone: HTMLElement; animation: Animation }>();
  const revealDirector = new HavocMultiplayerRevealDirector({
    reducedMotion: () => reducedMotion,
    cancel: cancelSelectionTransition,
  });

  onMount(() => {
    void controller.attach(roomId);
    const motionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
    reducedMotion = motionQuery.matches;
    const onMotionChange = (event: MediaQueryListEvent) => {
      reducedMotion = event.matches;
    };
    motionQuery.addEventListener('change', onMotionChange);
    const widthQuery = window.matchMedia('(min-width: 900px)');
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
    revealDirector.cancelAll();
    controller.dispose();
  });

  const phase = $derived(controller.phase);
  const phaseLabel = $derived(havocMultiplayerPhaseLabel(phase));
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
  const myLineupSlots = $derived(havocMultiplayerLineupSlots(myPicks));
  const rivalLineupSlots = $derived(havocMultiplayerLineupSlots(rivalPicks));
  const offer = $derived(controller.offer);
  const selectedCard = $derived(
    offer?.cards.find((card) => card.cardId === selectedCardId) ?? null,
  );
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
  const roomVariantLabel = $derived(
    controller.snapshot?.settings.variant === 'curated' ? 'Curated' : 'Standard',
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
    revealDirector.setOffer(offer?.offerId ?? null);
  });

  $effect(() => {
    if (phase !== 'drafting') revealDirector.cancelAll();
  });

  $effect(() => {
    const successor = controller.successorRoomId;
    if (!successor || successor === roomId || followingRematch) return;
    followingRematch = true;
    void controller.followRematch().then((next) => {
      if (next) {
        void goto(resolve('/havoc/room/[roomId]', { roomId: next }));
      } else {
        followingRematch = false;
      }
    });
  });

  function onKeydown(event: KeyboardEvent): void {
    if (phase !== 'drafting' || !controller.activeTurn) return;
    const cards = offer?.cards ?? [];
    if (event.key === '1' || event.key === '2' || event.key === '3') {
      const card = cards[Number(event.key) - 1];
      if (!card) return;
      selectedCardId = card.cardId;
      event.preventDefault();
      return;
    }
    if (event.key === 'Enter' && selectedCard !== null) {
      event.preventDefault();
      void pickCard(selectedCard);
      return;
    }
    if (event.key === 'Escape') {
      selectedCardId = null;
    }
  }

  async function pickCard(card: HavocDraftCard): Promise<void> {
    const draft = controller.draft;
    const currentOffer = controller.offer;
    if (!draft || !currentOffer || controller.busy || !controller.activeTurn) return;
    const attempt = revealDirector.beginSelection({
      offerId: currentOffer.offerId,
      cardId: card.cardId,
    });
    if (attempt !== null) {
      const source = document.querySelector(`[data-havoc-card="${card.cardId}"]`);
      if (source instanceof HTMLElement) {
        revealContext.set(attempt.attempt, {
          card,
          source,
          sourceRect: source.getBoundingClientRect(),
        });
      }
    }
    selectedCardId = null;
    const picksBefore = draft.picks.length;
    await controller.pickCard(card);
    if (attempt === null) return;
    const nextDraft = controller.draft;
    const accepted = (nextDraft?.picks.length ?? 0) > picksBefore;
    const settlement = revealDirector.settleSelection(attempt, {
      accepted,
      offerId: nextDraft?.offer?.offerId ?? null,
    });
    if (settlement !== 'played') {
      revealContext.delete(attempt.attempt);
      return;
    }
    void playSelectionTransition(attempt);
  }

  async function playSelectionTransition(attempt: HavocMultiplayerRevealAttempt): Promise<void> {
    const context = revealContext.get(attempt.attempt);
    revealContext.delete(attempt.attempt);
    if (context === undefined || reducedMotion) return;
    await tick();
    const target = document.querySelector(
      `[data-havoc-my-lineup] [data-havoc-lineup-slot="${context.card.slot}"]`,
    );
    if (!(target instanceof HTMLElement)) {
      revealDirector.finishSelection(attempt);
      return;
    }
    const targetRect = target.getBoundingClientRect();
    const source = context.sourceRect;
    const clone = context.source.cloneNode(true) as HTMLElement;
    clone.removeAttribute('data-havoc-card');
    clone.querySelectorAll('button').forEach((button) => button.remove());
    clone.style.width = '100%';
    clone.style.height = '100%';
    const flyer = document.createElement('div');
    flyer.className = `havoc-world hm-reveal-flyer-${attempt.attempt}`;
    flyer.setAttribute('aria-hidden', 'true');
    flyer.style.position = 'fixed';
    flyer.style.left = `${source.left}px`;
    flyer.style.top = `${source.top}px`;
    flyer.style.width = `${source.width}px`;
    flyer.style.height = `${source.height}px`;
    flyer.style.margin = '0';
    flyer.style.zIndex = '60';
    flyer.style.pointerEvents = 'none';
    flyer.appendChild(clone);
    document.body.appendChild(flyer);
    const deltaX = targetRect.left + targetRect.width / 2 - (source.left + source.width / 2);
    const deltaY = targetRect.top + targetRect.height / 2 - (source.top + source.height / 2);
    const scale = Math.max(0.2, Math.min(1, targetRect.width / Math.max(1, source.width)));
    const animation = flyer.animate(
      [
        { transform: 'translate(0, 0) scale(1)', opacity: 1 },
        { transform: `translate(${deltaX}px, ${deltaY}px) scale(${scale})`, opacity: 0.12 },
      ],
      {
        duration: HAVOC_MULTIPLAYER_REVEAL_SELECTION_MS,
        easing: 'cubic-bezier(0.22, 1, 0.36, 1)',
        fill: 'forwards',
      },
    );
    revealFlyers.set(attempt.attempt, { clone: flyer, animation });
    target.setAttribute('data-arriving', 'true');
    window.setTimeout(() => {
      target.removeAttribute('data-arriving');
    }, HAVOC_MULTIPLAYER_REVEAL_SELECTION_MS);
    void animation.finished
      .catch(() => {})
      .finally(() => {
        flyer.remove();
        revealFlyers.delete(attempt.attempt);
        revealDirector.finishSelection(attempt);
      });
  }

  function cancelSelectionTransition(attempt: HavocMultiplayerRevealAttempt): void {
    revealContext.delete(attempt.attempt);
    const flyer = revealFlyers.get(attempt.attempt);
    if (flyer === undefined) return;
    revealFlyers.delete(attempt.attempt);
    try {
      flyer.animation.cancel();
    } catch {}
    flyer.clone.remove();
  }

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
        `${window.location.origin}${inviteLinkForHavocMultiplayerCode(code)}`,
      );
      copiedLink = true;
      setTimeout(() => {
        copiedLink = false;
      }, 1500);
    } catch {}
  }

  async function leaveRoom(): Promise<void> {
    await controller.leaveRoom();
    await goto(resolve('/multiplayer'));
  }

  async function removeOpponent(): Promise<void> {
    await controller.removeGuest();
  }

  function reactionGlyph(key: ReactionKey): string {
    return REACTIONS.find((entry) => entry.key === key)?.glyph ?? '👀';
  }
</script>

<svelte:head>
  <title>Havoc room · Hoop Rush</title>
</svelte:head>

<svelte:window onkeydown={onKeydown} />

<section class="h-shell hm-room">
  <div class="hm-nav">
    <a href={resolve('/multiplayer')}><ArrowLeft size={15} aria-hidden="true" /> Multiplayer</a>
    {#if controller.snapshot}
      <span class="hm-room-code">Room {controller.snapshot.code}</span>
    {/if}
  </div>

  {#if !controller.snapshot && !controller.error}
    <div class="hm-empty" role="status">
      <Users size={28} aria-hidden="true" />
      <h1 class="h-title">Opening your room</h1>
      <p class="h-copy">Loading the Havoc catalog and room settings…</p>
    </div>
  {:else if !controller.snapshot}
    <div class="hm-empty">
      <h1 class="h-title">Couldn’t open this room</h1>
      <p role="alert" class="hm-alert">{controller.error}</p>
      <a href={resolve('/multiplayer')} class="h-button"
        >Back to multiplayer <ArrowRight size={16} aria-hidden="true" /></a
      >
    </div>
  {:else}
    <header class="hm-header">
      <div>
        <p class="h-eyebrow">Hoop Havoc · Multiplayer</p>
        <h1 class="h-title">Havoc room</h1>
        <p class="hm-subtitle">
          Best of seven · {roomVariantLabel} · {phaseLabel} · Room {controller.snapshot.code}
        </p>
      </div>
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
    </header>

    {#if controller.error}<p class="hm-alert" role="alert">{controller.error}</p>{/if}
    {#if controller.notice}<p class="hm-notice" role="status">{controller.notice}</p>{/if}
    {#if rival && !rival.online && phase !== 'lobby' && phase !== 'expired'}
      <p class="hm-notice" role="status">
        Your opponent is offline. Their place in the room is kept.
      </p>
    {/if}
    {#if controller.integrityFailed && phase !== 'integrity-failed'}
      <p class="hm-alert" role="alert">
        The two simulations disagreed. This room can no longer advance.
      </p>
    {/if}

    {#if phase === 'lobby'}
      <div class="hm-lobby">
        <div class="h-panel hm-invite">
          <p class="h-eyebrow">{isHost ? 'Bring your opponent' : 'You’re in'}</p>
          <h2 class="h-subtitle">{isHost ? 'Your room. Your invite.' : 'The matchup is set.'}</h2>
          <p class="h-copy">
            {isHost
              ? 'Share this 4-digit code or the invite link. Start the draft once your opponent is online.'
              : 'Stay in this room. The host starts the draft once both players are online.'}
          </p>
          <div class="hm-code" aria-label={`Room code ${controller.snapshot.code}`}>
            {controller.snapshot.code}
          </div>
          <div class="h-actions">
            <button type="button" class="h-button secondary" onclick={copyCode}
              >{#if copiedCode}<Check size={16} aria-hidden="true" /> Copied{:else}<Copy
                  size={16}
                  aria-hidden="true"
                /> Copy code{/if}</button
            >
            <button type="button" class="h-button" onclick={copyInviteLink}
              >{#if copiedLink}<Check size={16} aria-hidden="true" /> Copied{:else}<Link
                  size={16}
                  aria-hidden="true"
                /> Copy invite link{/if}</button
            >
          </div>
          <p class="hm-footnote">Room codes expire after 15 minutes.</p>
          <dl class="hm-rules">
            <div>
              <dt>Draft rules</dt>
              <dd data-havoc-variant={controller.snapshot.settings.variant}>{roomVariantLabel}</dd>
            </div>
            <div>
              <dt>Draft</dt>
              <dd>5 rounds · one per position</dd>
            </div>
            <div>
              <dt>Pick timer</dt>
              <dd>60 seconds</dd>
            </div>
          </dl>
        </div>

        <div class="h-panel hm-seats">
          <div class="hm-seats-head">
            <h2 class="h-subtitle">Players</h2>
            <span>{onlineCount}/2 online</span>
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
            <button
              type="button"
              class="h-button secondary"
              disabled={controller.busy || me?.ready === true}
              onclick={() => void controller.setReady()}
            >
              {me?.ready === true ? 'Ready' : 'Ready up'}
            </button>
            {#if isHost}
              <button
                type="button"
                class="h-button"
                data-havoc-multiplayer-start
                disabled={controller.busy || !bothOnline}
                onclick={() => void controller.startDraft()}
              >
                {controller.busy ? 'Starting…' : 'Start draft'}
                <ArrowRight size={16} aria-hidden="true" />
              </button>
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
        </div>
      </div>
    {:else if phase === 'expired'}
      <div class="hm-empty">
        <h1 class="h-title">Room expired</h1>
        <p class="h-copy">Your local saves are kept. Create a new room to play again.</p>
        <a class="h-button" href={resolve('/multiplayer')}
          >New Havoc room <ArrowRight size={16} aria-hidden="true" /></a
        >
      </div>
    {:else if phase === 'integrity-failed'}
      <div class="hm-empty">
        <h1 class="h-title">Results could not be verified</h1>
        <p class="h-copy">The two simulations disagreed. Neither result has been accepted.</p>
        <a class="h-button" href={resolve('/multiplayer')}
          >New Havoc room <ArrowRight size={16} aria-hidden="true" /></a
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

      <div class="hm-arena">
        <div class="hm-rail-col" data-havoc-my-lineup>
          <HavocMultiplayerLineupRail
            picks={myPicks}
            title="Your five"
            eyebrow={me?.displayName ?? 'You'}
            active={drafting && controller.draft?.activeParticipantId === controller.participantId}
            collapsible={!wideLayout}
            emptyLabel={drafting ? 'Your first pick is coming up.' : 'No lineup recorded.'}
          />
        </div>

        <div class="hm-main">
          {#if phase === 'drafting'}
            <section class="h-panel hm-draft" aria-label="Draft stage">
              <header class="hm-draft-head">
                <div>
                  <p class="h-eyebrow">
                    Round {offer?.round ?? '—'} of 5 · {offer?.slot ?? '—'}
                  </p>
                  <h2 class="h-subtitle">
                    {controller.activeTurn ? 'Your pick' : 'Opponent picking'}
                  </h2>
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
                {#key offer.offerId}
                  <ul class="h-cards hm-offer">
                    {#each offer.cards as card, index (card.cardId)}
                      <li
                        class="hm-offer-card"
                        data-selected={card.cardId === selectedCardId}
                        style="--hm-reveal-delay: {index * HAVOC_MULTIPLAYER_REVEAL_STAGGER_MS}ms"
                      >
                        <span class="hm-offer-key" aria-hidden="true">{index + 1}</span>
                        <HavocDraftCardView
                          {card}
                          mode="effective"
                          busy={controller.busy || !controller.activeTurn}
                          onPick={() => void pickCard(card)}
                        />
                      </li>
                    {/each}
                  </ul>
                {/key}
                <p class="hm-keys">
                  Press <kbd>1</kbd>–<kbd>3</kbd> to choose a card, <kbd>Enter</kbd> to draft it.
                </p>
              {:else}
                <p class="h-copy">Preparing the next offer…</p>
              {/if}

              <div class="hm-draft-actions">
                <button
                  type="button"
                  class="h-button secondary"
                  disabled={controller.busy || !canReroll}
                  onclick={() => void controller.rerollOffer()}
                >
                  <Shuffle size={16} aria-hidden="true" /> New choices
                </button>
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
            </section>
          {:else if phase === 'lineup-showdown'}
            <section class="h-panel hm-draft" aria-label="Lineup showdown">
              <header class="hm-draft-head">
                <div>
                  <p class="h-eyebrow">Lineup showdown</p>
                  <h2 class="h-subtitle">The fives are locked</h2>
                </div>
              </header>
              {#if !showdownReady}
                <p class="hm-consideration" role="status">
                  Revealing lineups… {showdownSecondsLeft}s
                </p>
              {/if}
              <div class="hm-showdown-lineups">
                <HavocLineupLock slots={myLineupSlots} title="Your five" />
                <div class="hm-showdown-vs" aria-hidden="true">VS</div>
                <HavocLineupLock slots={rivalLineupSlots} title="Opponent five" />
              </div>
              <div class="hm-draft-actions">
                <button
                  type="button"
                  class="h-button"
                  disabled={!showdownReady || controller.busy || controller.localReady}
                  onclick={() => void controller.readyForNextGame()}
                >
                  {controller.localReady ? 'Ready' : 'Ready for Game 1'}
                </button>
              </div>
            </section>
          {:else if phase === 'preparing-game'}
            <section class="h-panel hm-draft" aria-label="Preparing game">
              <header class="hm-draft-head">
                <div>
                  <p class="h-eyebrow">Game {controller.currentGameNumber ?? '—'} ready check</p>
                  <h2 class="h-subtitle">
                    {controller.localReady && controller.opponentReady
                      ? 'Starting the broadcast'
                      : 'Ready up'}
                  </h2>
                </div>
                {#if controller.readyCountdownMs !== null}
                  <div class="hm-clock" aria-label="Auto-start countdown">
                    {havocMultiplayerSecondsLeft(controller.readyCountdownMs)}s
                  </div>
                {/if}
              </header>
              <p class="h-copy">
                {controller.opponentReady
                  ? 'Opponent is ready.'
                  : controller.localReady
                    ? 'Waiting for your opponent. The game starts automatically after 60 seconds.'
                    : 'Both players ready up to start the broadcast.'}
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
                <button
                  type="button"
                  class="h-button"
                  disabled={controller.localReady || controller.busy}
                  onclick={() => void controller.readyForNextGame()}
                >
                  {controller.localReady ? 'Ready' : 'Ready for this game'}
                </button>
              </div>
            </section>
          {:else if phase === 'broadcasting'}
            {#if controller.currentOutput && controller.visible}
              <HavocMultiplayerBroadcast
                output={controller.currentOutput}
                visible={controller.visible}
                feed={controller.feed}
                progress={controller.progress}
                localParticipantId={controller.participantId ?? 'p1'}
                series={controller.series}
                minimal={reducedMotion}
              />
            {:else}
              <section class="h-panel hm-wait" aria-label="Broadcast loading">
                <p class="h-eyebrow">Broadcast</p>
                <h2 class="h-subtitle">
                  Simulating Game {controller.currentBroadcast?.gameNumber ?? '—'}…
                </h2>
                <p class="h-copy" role="status">
                  Both sides run the same game locally. The tape starts as soon as your simulation
                  lands.
                </p>
              </section>
            {/if}
          {:else if phase === 'game-results'}
            {#if controller.currentOutput && controller.series}
              <HavocMultiplayerGameResults
                output={controller.currentOutput}
                series={controller.series}
                localParticipantId={controller.participantId ?? 'p1'}
                verification={resultVerification}
                readyCountdownMs={controller.readyCountdownMs}
                localReady={controller.localReady}
                awaitingContinue={controller.awaitingContinue}
                onready={() => void controller.readyForNextGame()}
                oncontinue={() => controller.continueAfterGame()}
              />
            {:else}
              <section class="h-panel hm-wait" aria-label="Game results loading">
                <p class="h-copy" role="status">Loading the game result…</p>
              </section>
            {/if}
          {:else if phase === 'championship'}
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
              />
            {:else}
              <section class="h-panel hm-wait" aria-label="Championship loading">
                <p class="h-copy" role="status">Loading the series…</p>
              </section>
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
            emptyLabel="Their picks show up here as they draft."
          />
        </div>
      </div>

      <footer class="hm-footer">
        <button
          type="button"
          class="h-button secondary"
          onclick={leaveRoom}
          disabled={controller.busy}><LogOut size={14} aria-hidden="true" /> Leave room</button
        >
      </footer>
    {/if}
  {/if}
</section>

<style>
  .h-shell.hm-room {
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
  .hm-room-code {
    font-family: var(--font-mono);
    font-size: 12px;
    letter-spacing: 0.12em;
    color: #ffd782;
  }
  .hm-header {
    display: flex;
    align-items: flex-end;
    justify-content: space-between;
    gap: 20px;
    flex-wrap: wrap;
  }
  .hm-subtitle {
    margin-top: 10px;
    font-size: 13px;
    color: #c1cae4;
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
  .hm-alert {
    margin: 16px 0;
    padding: 14px;
    border: 1px solid #f290c5;
    border-radius: 12px;
    background: rgb(242 144 197 / 8%);
    font-size: 13px;
    line-height: 1.6;
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
  .hm-empty .h-title {
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
  .hm-invite {
    display: grid;
    gap: 12px;
  }
  .hm-code {
    font-family: var(--font-mono);
    font-size: clamp(40px, 6vw, 62px);
    font-weight: 700;
    letter-spacing: 0.18em;
    line-height: 1;
    padding: 18px 0;
    color: #ffd782;
    user-select: all;
  }
  .hm-footnote {
    margin: 0;
    font-size: 11px;
    color: #aab9db;
  }
  .hm-rules {
    display: grid;
    gap: 8px;
    margin: 8px 0 0;
    padding-top: 12px;
    border-top: 1px solid #3c486b;
  }
  .hm-rules > div {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 10px;
    font-size: 12px;
  }
  .hm-rules dt {
    color: #aab9db;
  }
  .hm-rules dd {
    margin: 0;
    font-weight: 700;
    color: #f2f4ff;
  }
  .hm-seats {
    display: grid;
    gap: 14px;
  }
  .hm-seats-head {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 10px;
  }
  .hm-seats-head .h-subtitle {
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
  .hm-lobby-actions .h-button {
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
  @media (min-width: 900px) {
    .hm-arena {
      grid-template-columns: minmax(0, 13.5rem) minmax(0, 1fr) minmax(0, 13.5rem);
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
  .hm-draft {
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
  .hm-draft-head .h-subtitle {
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
  .hm-offer {
    margin: 0;
    padding: 0;
    list-style: none;
  }
  .hm-offer-card {
    position: relative;
    display: flex;
    min-width: 0;
    animation: hm-offer-flip 300ms cubic-bezier(0.22, 1, 0.36, 1) both;
    animation-delay: var(--hm-reveal-delay, 0ms);
  }
  @keyframes hm-offer-flip {
    from {
      opacity: 0;
      transform: perspective(900px) translateY(16px) rotateY(-72deg) scale(0.94);
    }
    to {
      opacity: 1;
      transform: perspective(900px) translateY(0) rotateY(0deg) scale(1);
    }
  }
  .hm-offer-card[data-selected='true'] {
    border-radius: 24px;
    outline: 3px solid #f290c5;
    outline-offset: 4px;
  }
  :global(li[data-arriving='true']) {
    animation: hm-lineup-arrive 300ms cubic-bezier(0.22, 1, 0.36, 1) both;
  }
  @keyframes hm-lineup-arrive {
    from {
      transform: scale(1.04);
      box-shadow: 0 0 0 2px #ffd782;
    }
    to {
      transform: scale(1);
      box-shadow: 0 0 0 0 rgb(255 215 130 / 0%);
    }
  }
  .hm-offer-key {
    position: absolute;
    z-index: 2;
    top: -12px;
    left: 50%;
    transform: translateX(-50%);
    display: grid;
    place-items: center;
    width: 26px;
    height: 26px;
    border-radius: 999px;
    background: #ffd782;
    color: #141b39;
    font-family: var(--font-mono);
    font-size: 12px;
    font-weight: 800;
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
  @media (min-width: 1100px) {
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
  .hm-wait {
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
    .hm-draft-actions .h-button {
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
