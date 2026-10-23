<script lang="ts">
  import RoomShell from '#lib/features/multiplayer/RoomShell.svelte';
  import { onMount, untrack } from 'svelte';
  import MultiplayerLobbyLink from '#lib/features/multiplayer/MultiplayerLobbyLink.svelte';
  import { resolve } from '$app/paths';
  import { staticAsset } from '#lib/asset-url.js';
  import {
    Check,
    Copy,
    ArrowLeft,
    ArrowRight,
    Users,
    Clock,
    LockKeyhole,
    Link,
    LogOut,
    ShieldCheck,
  } from '@lucide/svelte';
  import FixedFiveScoreboard from '#lib/features/fixed-five/FixedFiveScoreboard.svelte';
  import FixedFiveDraftPanel from '#lib/features/fixed-five/FixedFiveDraftPanel.svelte';
  import FixedFiveSimShow from '#lib/features/fixed-five/FixedFiveSimShow.svelte';
  import FixedFiveResults from '#lib/features/fixed-five/FixedFiveResults.svelte';
  import GamecastBroadcast from '#lib/gamecast/GamecastBroadcast.svelte';
  import GamecastRecap from '#lib/gamecast/GamecastRecap.svelte';
  import GamecastSeriesTracker from '#lib/gamecast/GamecastSeriesTracker.svelte';
  import { gamecastFeedLines } from '#lib/gamecast/gamecast-broadcast-view.js';
  import {
    gamecastVisibleEventCount,
    gamecastVisibleState,
  } from '#lib/gamecast/gamecast-playback.js';
  import ArenaSoundToggle from '#lib/components/ArenaSoundToggle.svelte';
  import { FixedFiveRoomController } from '#lib/features/fixed-five/fixed-five-room-controller.svelte.js';
  let { roomId }: { roomId: string } = $props();
  const controller = new FixedFiveRoomController({ roomId: untrack(() => roomId) });
  const snapshot = $derived(controller.roomSnapshot);
  const display = $derived(controller.display);
  const replay = $derived(controller.replay);
  const phase = $derived(controller.phase);
  const localResult = $derived(controller.localResult);
  const facts = $derived(controller.facts);
  const selfId = $derived(controller.selfId);
  const assets = $derived(controller.assets);
  const duelOutput = $derived(controller.currentDuelOutput);
  const duelVisibleCount = $derived(
    duelOutput ? gamecastVisibleEventCount(duelOutput.tape, controller.broadcastProgress) : 0,
  );
  const duelVisible = $derived(
    duelOutput ? gamecastVisibleState(duelOutput, duelVisibleCount) : null,
  );
  const duelFeed = $derived(duelOutput ? gamecastFeedLines(duelOutput, duelVisibleCount) : []);
  const showDuelRecap = $derived(
    controller.duelBroadcast &&
      (phase === 'game-results' ||
        (phase === 'awaiting-confirmation' &&
          controller.awaitingContinue &&
          controller.duelRecapGame !== null)),
  );
  const showShared82H2HRecap = $derived(
    controller.shared82Broadcast && phase === 'game-results' && controller.broadcastProgress >= 1,
  );
  const broadcastSimulationError = $derived(
    controller.shared82Broadcast ? controller.shared82H2HError : controller.duelSimError,
  );

  const readyCountdownLabel = $derived.by((): string | null => {
    const ms = controller.readyCountdownMs;
    if (ms === null) return null;
    const total = Math.max(0, Math.ceil(ms / 1000));
    return `${String(Math.floor(total / 60))}:${String(total % 60).padStart(2, '0')}`;
  });
  onMount(() => {
    void controller.start();
    return () => controller.dispose();
  });
</script>

<svelte:head>
  <title>Room — Hoop Rush Multiplayer</title>
</svelte:head>

<section class="room-page">
  <div class="room-nav">
    <a href={resolve('multiplayer/')}>
      <ArrowLeft size={15} aria-hidden="true" />
      Multiplayer
    </a>

    <ArenaSoundToggle />
  </div>
  {#if controller.loading}
    <div class="room-empty" role="status">
      <Users size={28} aria-hidden="true" />
      <h1>Opening your room</h1>
      <p>Loading players and match settings…</p>
    </div>
  {:else if controller.error && !snapshot}
    <div class="room-empty">
      <h1>Couldn’t open this room</h1>
      <p role="alert">{controller.error}</p>
      <a href={resolve('multiplayer/')} class="room-primary"
        >Back to multiplayer <ArrowRight size={16} /></a
      >
    </div>
  {:else if snapshot && display}
    <RoomShell
      {roomId}
      title={controller.roomName}
      phase={controller.phaseLabel}
      code={snapshot.code}
      participantId={selfId}
      members={snapshot.members}
      connection={controller.reconnecting ? 'reconnecting' : 'connected'}
      summary={`${snapshot.settings.sourceMode === 'sandbox' ? 'Sandbox · Snake Draft' : 'Classic · Roll Draft'} · ${snapshot.settings.variant === 'ball-knowledge' ? 'Ball Knowledge' : 'Ratings'} · ${snapshot.settings.mode === 'duel' ? 'Best of 7' : '82 games'}`}
    >
      {#if controller.resultVerified}<span class="verified-pill"
          ><ShieldCheck size={15} aria-hidden="true" />Result verified</span
        >{/if}
    </RoomShell>
    {#if phase !== 'expired' && phase !== 'integrity-failed'}
      <ol class="room-stages" aria-label="Match progress">
        {#each ['Lobby', 'Draft your five', 'Play', 'Results'] as label, i (label)}
          <li
            class:current={i === controller.stageIndex}
            class:finished={i < controller.stageIndex}
            aria-current={i === controller.stageIndex ? 'step' : undefined}
          >
            <span
              >{#if i < controller.stageIndex}<Check size={13} aria-hidden="true" />{:else}{i +
                  1}{/if}</span
            >{label}
          </li>
        {/each}
      </ol>
    {/if}

    {#if phase === 'completed'}
      <MultiplayerLobbyLink {roomId} completed />
    {/if}

    {#if controller.error}
      <p class="room-alert" role="alert">{controller.error}</p>
    {/if}

    <p class="room-connection" role="status" aria-live="polite">
      {#if controller.reconnecting}
        Reconnecting to your room…
      {:else if controller.syncing}
        Updating your room…
      {/if}
    </p>

    {#if controller.opponent && !controller.opponent.online && phase !== 'lobby' && phase !== 'completed'}
      <p class="room-connection" role="status">
        Your opponent is offline. Their place in the room is kept.
      </p>
    {/if}

    {#if controller.notice || (replay && replay.skipped > 0)}
      <details class="room-activity">
        <summary>Room activity</summary>{#if controller.notice}<p>
            {controller.notice}
          </p>{/if}{#if replay && replay.skipped > 0}<p>
            {replay.skipped} draft update{replay.skipped === 1 ? ' was' : 's were'} skipped because it
            could not be applied.
          </p>{/if}
      </details>
    {/if}

    {#if phase !== 'lobby' && phase !== 'completed' && phase !== 'awaiting-confirmation' && phase !== 'integrity-failed' && phase !== 'expired'}
      <div class="room-players"><FixedFiveScoreboard snapshot={display} {selfId} /></div>
    {/if}

    {#if phase === 'lobby'}
      <div class="lobby-layout">
        <div class="invite-panel">
          <div class="lobby-photo">
            <img src={staticAsset(controller.roomImage)} alt="" width="1536" height="1024" /><span
              class="photo-caption">{controller.roomName} · Head to head</span
            >
          </div>
          <div class="invite-body">
            <p class="room-eyebrow">{selfId === 'p1' ? 'Bring your opponent' : 'You’re in'}</p>
            <h2>{selfId === 'p1' ? 'Your court. Your invite.' : 'The matchup is set.'}</h2>
            <p>
              {selfId === 'p1'
                ? 'Share this code or send an invite link. The draft begins when you start it.'
                : 'Stay in this room. The draft opens for both players when the host starts.'}
            </p>
            {#if snapshot.code}
              <div class="invite-code" aria-label={`Room code ${snapshot.code}`}>
                {snapshot.code}
              </div>
              <div class="invite-actions">
                <button
                  type="button"
                  onclick={() => void controller.copyRoomCode()}
                  class="room-secondary"
                  >{#if controller.copiedCode}<Check size={16} /> Copied{:else}<Copy size={16} /> Copy
                    code{/if}</button
                ><button
                  type="button"
                  onclick={() => void controller.copyInviteLink()}
                  class="room-primary"
                >
                  {#if controller.copiedInvite}
                    <Check size={16} />Copied
                  {:else}
                    <Link size={16} />Copy invite link
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
            <span><Users size={14} aria-hidden="true" /> {display.members.length}/2</span>
          </div>
          <FixedFiveScoreboard snapshot={display} {selfId} />
          <dl class="lobby-rules">
            <div>
              <dt>Draft source</dt>
              <dd>{snapshot.settings.sourceMode === 'sandbox' ? 'Sandbox' : 'Classic'}</dd>
            </div>
            <div>
              <dt>Player ratings</dt>
              <dd>{snapshot.settings.variant === 'ball-knowledge' ? 'Hidden' : 'Visible'}</dd>
            </div>
            <div>
              <dt><Clock size={14} aria-hidden="true" /> Pick timer</dt>
              <dd>{snapshot.settings.mode === 'sandbox-shared-82' ? '5 minutes' : '90 seconds'}</dd>
            </div>
            <div>
              <dt><LockKeyhole size={14} aria-hidden="true" /> Room access</dt>
              <dd>Invite only</dd>
            </div>
          </dl>
          {#if controller.assetsError}<p class="room-alert" role="alert">
              The player pool could not be loaded. Reload the room to try again.
            </p>
            <button type="button" class="room-secondary" onclick={() => window.location.reload()}
              >Reload room</button
            >{/if}
          <div class="lobby-ready" role="status">
            <span class:joined={controller.opponent?.online}></span>
            <p>
              {selfId === 'p1'
                ? controller.opponent?.online
                  ? 'Your opponent is here. Ready when you are.'
                  : 'Waiting for your opponent to join.'
                : 'Waiting for the host to start the draft.'}
            </p>
          </div>
          {#if selfId === 'p1'}<button
              type="button"
              onclick={() => void controller.startDraft()}
              disabled={controller.busyAction !== null || !controller.opponent?.online || !assets}
              class="room-primary start-draft"
              >{controller.busyAction === 'start'
                ? 'Starting draft…'
                : !assets && !controller.assetsError
                  ? 'Loading players…'
                  : 'Start draft'}<ArrowRight size={18} aria-hidden="true" /></button
            >{/if}
          <div class="lobby-manage">
            {#if selfId === 'p1' && controller.opponent}<button
                type="button"
                onclick={() => void controller.removeGuest()}
                disabled={controller.busyAction !== null}
                >{controller.busyAction === 'remove' ? 'Removing…' : 'Remove opponent'}</button
              >{/if}<button
              type="button"
              onclick={() => void controller.leaveRoom()}
              disabled={controller.leaveBusy}
            >
              <LogOut size={14} aria-hidden="true" />
              {controller.leaveBusy ? 'Leaving…' : 'Leave room'}
            </button>
          </div>
        </div>
      </div>
    {:else if phase === 'drafting' && (!replay || !assets)}
      <div class="room-empty">
        <h2>Preparing your draft</h2>
        <p role="status">{controller.assetsError ?? 'Loading your player pool and lineup…'}</p>
        {#if controller.assetsError}<button
            type="button"
            class="room-secondary"
            onclick={() => window.location.reload()}>Reload room</button
          >{/if}
      </div>
    {:else if phase === 'drafting' && replay && assets}
      <div class="draft-room">
        {#if controller.assetsError}
          <p class="mt-2 text-xs text-destructive" role="alert">{controller.assetsError}</p>
        {:else}
          <FixedFiveDraftPanel
            mode={snapshot.settings.mode}
            {selfId}
            {replay}
            {assets}
            presentation={controller.presentation}
            rollAxis={controller.rollAnimation.axis}
            rollNonce={controller.rollAnimation.nonce}
            disabled={controller.syncing}
            deadlineText={controller.clockText}
            lastAutopick={controller.lastAutopick}
            error={controller.draftError}
            onPick={(player, slot) => {
              void controller.pickPlayer(player, slot);
            }}
            onReroll={(axis) => {
              void controller.reroll(axis);
            }}
            onRemove={(slot) => {
              void controller.removeSlot(slot);
            }}
            onLock={() => {
              void controller.lockLineup();
            }}
          />
        {/if}
      </div>
    {:else if phase === 'simulating'}
      <div class="mt-6">
        {#if controller.simError}
          <div class="rounded-2xl bg-surface-1 p-6">
            <h2 class="font-display text-sm font-extrabold uppercase">Simulating locally</h2>
            <p class="mt-2 text-sm text-destructive" role="alert">{controller.simError}</p>
            <button
              type="button"
              onclick={() => controller.retrySimulation()}
              class="mt-3 rounded-xl border border-line-soft bg-card px-4 py-2 text-sm font-semibold"
            >
              Retry simulation
            </button>
          </div>
        {:else if snapshot}
          <FixedFiveSimShow
            mode={snapshot.settings.mode}
            progress={controller.progress}
            entries={controller.revealedEntries}
            h2hPendingGame={controller.shared82H2HPendingGame}
            h2hError={controller.shared82H2HError}
            h2hSimulatingGame={controller.shared82H2HSimulatingGame}
            onContinueH2H={() => controller.continueShared82H2HGame()}
            onRetryH2H={() => controller.retryShared82H2HGame()}
            {selfId}
          />
        {/if}
      </div>
    {:else if phase === 'preparing-game'}
      {#if controller.duelSeries}
        <div class="mt-6 flex flex-col gap-4">
          <GamecastSeriesTracker
            series={controller.duelSeries}
            localParticipantId={selfId}
            homeFormat="alternating"
          />
          <div class="rounded-2xl bg-surface-1 p-6">
            <h2 class="font-display text-sm font-extrabold uppercase">
              Game {controller.duelCurrentGameNumber ?? 1} · Ready check
            </h2>
            <p class="mt-2 text-sm text-muted-foreground">
              {controller.localReady
                ? "You're ready. Waiting for your opponent…"
                : 'Both players need to be ready before the broadcast starts.'}
            </p>
            {#if controller.duelSimError}
              <p class="mt-2 text-sm text-destructive" role="alert">{controller.duelSimError}</p>
              <button
                type="button"
                onclick={() => controller.retryDuelGame()}
                class="mt-3 rounded-xl border border-line-soft bg-card px-4 py-2 text-sm font-semibold"
              >
                Retry game
              </button>
            {:else if controller.duelSimulatingGame !== null}
              <p class="mt-2 text-xs text-muted-foreground" role="status">
                Simulating this game locally…
              </p>
            {/if}
            <div class="mt-4 flex flex-wrap items-center gap-3">
              <button
                type="button"
                disabled={controller.localReady || controller.busyAction !== null}
                onclick={() => void controller.readyForNextGame()}
                class="room-primary"
              >
                {controller.localReady
                  ? 'Ready'
                  : `Ready for Game ${controller.duelCurrentGameNumber ?? 1}`}
              </button>
              {#if readyCountdownLabel}
                <span class="text-xs text-muted-foreground">
                  Auto-start in {readyCountdownLabel}
                </span>
              {/if}
            </div>
          </div>
        </div>
      {/if}
    {:else if phase === 'broadcasting' || (phase === 'game-results' && controller.broadcastProgress < 1)}
      {#if duelOutput && duelVisible}
        <div class="mt-6">
          <GamecastBroadcast
            output={duelOutput}
            visible={duelVisible}
            progress={controller.broadcastProgress}
            localParticipantId={selfId}
            feed={duelFeed}
            players={controller.duelPlayers}
            manifest={assets?.manifest ?? null}
          />
        </div>
      {:else}
        <div class="room-empty">
          <h2>Preparing the broadcast</h2>
          <p role="status">{broadcastSimulationError ?? 'Simulating this game locally…'}</p>
          {#if broadcastSimulationError}
            <button
              type="button"
              class="room-secondary"
              onclick={() =>
                controller.shared82Broadcast
                  ? controller.retryShared82H2HGame()
                  : controller.retryDuelGame()}
            >
              Retry game
            </button>
          {/if}
        </div>
      {/if}
    {:else if showDuelRecap}
      {#if duelOutput && controller.duelSeries}
        <div class="mt-6 flex flex-col gap-4">
          <GamecastSeriesTracker
            series={controller.duelSeries}
            localParticipantId={selfId}
            homeFormat="alternating"
          />
          <GamecastRecap
            output={duelOutput}
            series={controller.duelSeries}
            localParticipantId={selfId}
            verification={controller.duelVerification}
            readyCountdownMs={controller.readyCountdownMs}
            localReady={controller.localReady}
            onready={() => void controller.readyForNextGame()}
            awaitingContinue={controller.awaitingContinue}
            oncontinue={() => controller.continueAfterGame()}
            players={controller.duelPlayers}
            manifest={assets?.manifest ?? null}
          />
        </div>
      {:else}
        <div class="room-empty">
          <h2>Preparing game results</h2>
          <p role="status">{controller.duelSimError ?? 'Rebuilding this game locally…'}</p>
          {#if controller.duelSimError}
            <button type="button" class="room-secondary" onclick={() => controller.retryDuelGame()}>
              Retry game
            </button>
          {/if}
        </div>
      {/if}
    {:else if showShared82H2HRecap}
      {#if duelOutput}
        <div class="mt-6">
          <GamecastRecap
            output={duelOutput}
            seasonBroadcast
            localParticipantId={selfId}
            verification={controller.duelVerification}
            readyCountdownMs={null}
            localReady={false}
            onready={() => {}}
            awaitingContinue={false}
            oncontinue={() => {}}
            players={controller.duelPlayers}
            manifest={assets?.manifest ?? null}
          />
        </div>
      {:else}
        <div class="room-empty">
          <h2>Preparing head-to-head result</h2>
          <p role="status">{broadcastSimulationError ?? 'Rebuilding this game locally…'}</p>
          {#if broadcastSimulationError}
            <button
              type="button"
              class="room-secondary"
              onclick={() => controller.retryShared82H2HGame()}
            >
              Retry game
            </button>
          {/if}
        </div>
      {/if}
    {:else if phase === 'awaiting-confirmation'}
      {@const rivalProposal = facts.proposals.find((p) => p.actor !== selfId) ?? null}
      {@const digestsMatch =
        localResult != null && rivalProposal != null
          ? rivalProposal.digest === localResult.digest
          : null}
      {@const youDigest = localResult?.digest ?? null}
      {@const foreignConfirmed =
        youDigest != null &&
        facts.confirms.some((c) => c.actor !== selfId && c.digest === youDigest && c.verified)}
      {@const receiptShort =
        controller.verificationReceipt != null
          ? `${controller.verificationReceipt.receiptDigest.slice(0, 6)}…${controller.verificationReceipt.receiptDigest.slice(-4)}`
          : null}
      <div class="mt-6 flex flex-col gap-4">
        <div class="verify-banner" role="status">
          <span class="verify-orb" aria-hidden="true"></span>
          <div class="min-w-0 flex-1">
            <h2 class="font-display text-sm font-extrabold uppercase">Checking the final result</h2>
            <p class="mt-1 text-xs text-muted-foreground">
              {#if !localResult}
                Rebuilding your match result…
              {:else if controller.receiptsUnsupported && rivalProposal == null}
                Your result is ready. Waiting for your opponent…
              {:else if controller.receiptsUnsupported && !digestsMatch}
                The results differ. Replaying the match to check them…
              {:else if controller.receiptsUnsupported}
                Both players have the same result. Finishing your match…
              {:else if controller.verificationError}
                The result could not be verified: {controller.verificationError}
              {:else if rivalProposal == null}
                Your result is ready. Sharing it with your opponent…
              {:else if !digestsMatch}
                The results differ. Replaying the match to check them…
              {:else if !foreignConfirmed}
                Waiting for your opponent to confirm the result…
              {:else if !controller.verificationReceipt}
                Both players agree. Checking the replay…
              {:else if controller.submittedReceipt !== controller.verificationReceipt.receiptDigest}
                Replay checked. Saving verification…
              {:else}
                Result verified. Finishing your match…
              {/if}
            </p>
            {#if controller.verificationError}
              <button
                type="button"
                onclick={() => controller.retryVerification()}
                disabled={controller.verificationInFlight}
                class="mt-2 rounded-lg border border-primary/50 bg-primary/10 px-3 py-1.5 text-xs font-semibold text-primary disabled:opacity-40"
              >
                {controller.verificationInFlight ? 'Verifying…' : 'Retry verification'}
              </button>
            {/if}
            {#if controller.completeNotReady && localResult}
              <button
                type="button"
                onclick={() => void controller.retryFinishing()}
                disabled={controller.busyAction !== null}
                class="mt-2 rounded-lg border border-primary/50 bg-primary/10 px-3 py-1.5 text-xs font-semibold text-primary disabled:opacity-40"
              >
                {controller.busyAction === 'complete' ? 'Finishing…' : 'Retry finishing match'}
              </button>
            {/if}
          </div>
        </div>
        {#if localResult && snapshot && assets}
          <FixedFiveResults
            mode={snapshot.settings.mode}
            result={localResult.result}
            {selfId}
            manifest={assets.manifest}
            p1Rows={controller.p1ResultRows}
            p2Rows={controller.p2ResultRows}
            presentation={controller.presentation}
            digest={localResult.digest}
            stats={controller.playerStats}
            statsState={controller.statsState}
            onRebuildStats={controller.requestStatsRebuild}
            entries={controller.statsSource}
            roomCode={snapshot.code}
            createdAt={snapshot.createdAt}
            verified={controller.resultVerified}
            modeDetail={controller.modeDetailLabel}
            receiptDigest={controller.verificationReceipt?.receiptDigest ?? null}
          />
        {/if}
        <details class="room-activity">
          <summary>Verification details</summary>
          <p>
            Receipt {receiptShort ?? 'pending'} · proposals {facts.proposals.length} · confirmations
            {facts.confirms.length}{controller.reranMismatch ? ' · mismatch rerun done' : ''}. Both
            clients replay every game from the accepted command log and store a verification
            receipt; the room locks only after the matching confirmations.
          </p>
        </details>
      </div>
    {:else if phase === 'completed' && localResult}
      <div class="mt-6 flex flex-col gap-4">
        {#if snapshot && assets}
          <FixedFiveResults
            mode={snapshot.settings.mode}
            result={localResult.result}
            {selfId}
            manifest={assets.manifest}
            p1Rows={controller.p1ResultRows}
            p2Rows={controller.p2ResultRows}
            presentation={controller.presentation}
            digest={localResult.digest}
            stats={controller.playerStats}
            statsState={controller.statsState}
            onRebuildStats={controller.requestStatsRebuild}
            entries={controller.statsSource}
            roomCode={snapshot.code}
            createdAt={snapshot.createdAt}
            verified={controller.resultVerified}
            modeDetail={controller.modeDetailLabel}
            receiptDigest={controller.verificationReceipt?.receiptDigest ?? null}
            onRematch={controller.lobbyId ? null : () => void controller.rematchAction()}
            rematchWaiting={controller.rematchWaiting}
            rematchLabel={controller.rematchLabel}
            rematchBusy={controller.rematchBusy}
          />
        {/if}
        {#if !controller.lobbyId && !controller.canRematch}
          <p class="text-xs text-muted-foreground">
            Both players need to agree to a rematch. This result stays saved.
          </p>
        {/if}
      </div>
    {:else if phase === 'completed'}
      <div class="mt-6 rounded-2xl bg-surface-1 p-6">
        <h2 class="font-display text-sm font-extrabold uppercase">Completed</h2>
        <p class="mt-1 text-xs text-muted-foreground">
          The room completed before this client finished simulating. Reload to rebuild the result
          from the accepted log.
        </p>
      </div>
    {:else if phase === 'integrity-failed'}
      <div class="mt-6 rounded-2xl border border-destructive/40 bg-destructive/10 p-6" role="alert">
        <h2 class="font-display text-sm font-extrabold uppercase">
          The results could not be verified
        </h2>
        <p class="mt-1 text-xs">
          The match was replayed, but the two results still differ. Neither result has been
          accepted.
        </p>
      </div>
    {:else if phase === 'expired'}
      <div class="mt-6 rounded-2xl bg-surface-1 p-6">
        <h2 class="font-display text-2xl font-extrabold uppercase">Room expired</h2>

        <p class="mt-1 text-xs text-muted-foreground">
          Your local saves are kept. Create a new room to play again.
        </p>

        <a class="room-primary mt-4" href={resolve('multiplayer/')}
          >Choose a match <ArrowRight size={16} /></a
        >
      </div>
    {/if}

    {#if phase !== 'lobby'}<div class="room-footer">
        <button
          type="button"
          onclick={() => void controller.leaveRoom()}
          disabled={controller.leaveBusy}
          class="rounded-xl border border-line-soft bg-card px-4 py-2 text-sm font-semibold disabled:opacity-40"
          >{controller.leaveBusy ? 'Leaving…' : 'Leave room'}</button
        >
      </div>{/if}
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

  .verified-pill {
    display: flex;
    gap: 7px;
    align-items: center;
    color: var(--color-positive);
    font-size: 11px;
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
    min-height: 1.5em;
    color: var(--color-muted-foreground);
    font-size: 12px;
    line-height: 1.5;
    margin: 14px 0;
  }
  .room-activity {
    color: var(--color-muted-foreground);
    font-size: 11px;
    line-height: 1.7;
    margin: 16px 0;
  }
  .room-activity summary {
    cursor: pointer;
    width: fit-content;
  }
  .room-activity p {
    margin-top: 8px;
  }
  .room-players {
    margin-bottom: 24px;
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
  .invite-body > p:not(.room-eyebrow) {
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
  .invite-body .invite-footnote {
    margin-top: 16px;
    font-size: 10px;
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
  .lobby-settings :global(.player-seats) {
    grid-template-columns: 1fr;
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
  }
  .lobby-manage {
    display: flex;
    justify-content: space-between;
    gap: 14px;
    margin-top: 22px;
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
  .draft-room {
    min-width: 0;
  }
  .room-footer {
    border-top: 1px solid var(--color-line-soft);
    margin-top: 30px;
    padding-top: 20px;
  }
  .room-empty {
    display: flex;
    align-items: flex-start;
    flex-direction: column;
    gap: 18px;
    padding: 60px 0;
  }
  .room-empty h2 {
    font-family: var(--font-display);
    font-size: 32px;
    font-weight: 800;
  }
  .room-empty p {
    font-size: 13px;
    color: var(--color-muted-foreground);
  }
  button {
    cursor: pointer;
  }
  button:disabled {
    opacity: 0.45;
    cursor: default;
  }
  button:focus-visible,
  a:focus-visible,
  summary:focus-visible {
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

  .verify-banner {
    display: flex;
    align-items: center;
    gap: 14px;
    border: 1px solid var(--color-line-soft);
    border-radius: 10px;
    padding: 20px;
    background: var(--color-card);
  }
  .verify-orb {
    width: 18px;
    height: 18px;
    flex-shrink: 0;
    border: 2px solid var(--color-line-strong);
    border-top-color: var(--color-primary);
    border-radius: 50%;
    animation: verify-spin 1s linear infinite;
  }
  @keyframes verify-spin {
    to {
      transform: rotate(360deg);
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .verify-orb {
      animation: none;
    }
  }
</style>
