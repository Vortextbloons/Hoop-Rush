<script lang="ts">
  import { onMount } from 'svelte';
  import RoomShell from './RoomShell.svelte';
  import { goto } from '$app/navigation';
  import { resolve } from '$app/paths';
  import { staticAsset } from '#lib/asset-url.js';
  import {
    LogIn,
    ArrowRight,
    Users,
    CalendarDays,
    Clock,
    Check,
    LockKeyhole,
  } from '@lucide/svelte';
  import type { MultiplayerFormatId, MultiplayerSetup } from '@hoop-rush/data-contracts';
  import { isMultiplayerConfigured } from '#lib/supabase-runtime.js';
  import {
    loadLobbyId,
    multiplayerGameKindLabels,
  } from '#lib/features/multiplayer/multiplayer-lobby.js';
  import { getLobbyCoordinator } from '#lib/features/multiplayer/lobby-context.svelte.js';
  import { multiplayerFormats } from '#lib/modes/catalog.js';
  import type { MultiplayerModeAdapter } from '#lib/modes/types.js';
  type View = 'choose' | 'create' | 'join';
  let {
    initialFormat,
    showChooser = true,
  }: { initialFormat?: MultiplayerFormatId; showChooser?: boolean } = $props();
  const coordinator = getLobbyCoordinator();
  let loadingSettings = $state(false);
  let localError = $state<string | null>(null);
  const lobby = $derived(coordinator.snapshot.lobby);
  const busy = $derived(coordinator.snapshot.busy || loadingSettings);
  const error = $derived(localError ?? coordinator.snapshot.error);
  const preview = $derived.by(() => {
    const result = coordinator.snapshot.preview;
    return result
      ? result.legacy
        ? `${multiplayerGameKindLabels[result.gameKind]} room`
        : `Shared lobby · ${result.guestJoined ? '2 players' : 'Waiting for an opponent'}`
      : null;
  });
  let view = $state<View>('choose');
  let lastLobbyId = $state<string | null>(null);
  let lastRoomId = $state<string | null>(null);
  let matchFormat = $state<MultiplayerFormatId>('season');
  let settings = $state<MultiplayerSetup>({});
  let adapter = $state.raw<MultiplayerModeAdapter | null>(null);
  let code = $state('');
  const formats = multiplayerFormats();
  const selectedFormat = $derived(formats.find((item) => item.id === matchFormat)!);
  let selectionGeneration = 0;
  async function selectFormat(nextFormat: MultiplayerFormatId) {
    const generation = ++selectionGeneration;
    matchFormat = nextFormat;
    coordinator.localFormat = nextFormat;
    view = 'create';
    localError = null;
    loadingSettings = true;
    try {
      const nextAdapter = await formats
        .find((item) => item.id === nextFormat)!
        .mode.multiplayer!.load();
      if (generation !== selectionGeneration) return;
      adapter = nextAdapter;
      const saved = coordinator.localSettings.get(selectedFormat.mode.multiplayer!.gameKind);
      settings = { ...nextAdapter.defaults, ...(saved ?? {}) };
      lastRoomId = nextAdapter.loadLastRoomId();
    } catch (cause) {
      if (generation === selectionGeneration)
        localError = cause instanceof Error ? cause.message : 'Could not load match settings.';
    } finally {
      if (generation === selectionGeneration) loadingSettings = false;
    }
  }
  function switchView(nextView: View) {
    view = nextView;
    localError = null;
  }
  function updateSettings(value: MultiplayerSetup) {
    settings = value;
    coordinator.localSettings.set(selectedFormat.mode.multiplayer!.gameKind, { ...value });
  }
  onMount(() => {
    lastLobbyId = loadLobbyId();
    const params = new URLSearchParams(window.location.search);
    const formatParam = formats.find((item) => item.id === params.get('format'));
    void selectFormat(formatParam?.id ?? initialFormat ?? coordinator.localFormat ?? 'season').then(
      () => {
        if (!formatParam && !params.has('lobby'))
          view = params.has('code') ? 'join' : showChooser ? 'choose' : 'create';
      },
    );
    const lobbyParam = params.get('lobby');
    if (lobbyParam) {
      view = 'create';
      void coordinator.session.attach(lobbyParam);
    }
    const codeParam = params.get('code');
    if (codeParam && /^[0-9]{4}$/.test(codeParam)) {
      code = codeParam;
      view = 'join';
    }
    return () => {
      selectionGeneration++;
    };
  });
  async function createRoom() {
    await coordinator.session.create();
    view = 'create';
  }
  async function startCreate() {
    if (!adapter || !lobby) return;
    localError = null;
    loadingSettings = true;
    try {
      await coordinator.session.startMatch(await adapter.startSettings(matchFormat, settings));
    } catch (cause) {
      localError = cause instanceof Error ? cause.message : 'Could not create the match.';
    } finally {
      loadingSettings = false;
    }
  }
  function cleanCode() {
    code = code.replace(/\D/g, '').slice(0, 4);
    localError = null;
  }
  async function doPreview() {
    cleanCode();
    if (code.length === 4) await coordinator.session.preview(code);
  }
  async function doJoin() {
    cleanCode();
    if (code.length === 4) {
      await coordinator.session.join(code);
      view = 'create';
    }
  }
  async function resumeLast() {
    if (lastLobbyId) {
      view = 'create';
      await coordinator.session.attach(lastLobbyId, { followCurrent: true });
    } else if (lastRoomId)
      await coordinator.resumeRoom(selectedFormat.mode.multiplayer?.gameKind ?? null, lastRoomId);
  }
  async function leaveLobby() {
    await coordinator.session.leave();
    if (!coordinator.snapshot.lobby) {
      localStorage.removeItem('hoop-rush:multiplayer:last-lobby');
      lastLobbyId = null;
      view = 'choose';
      await goto(resolve('/multiplayer'));
    }
  }
</script>

<svelte:head>
  <title>Multiplayer — Hoop Rush</title>
</svelte:head>

<section class="match-page">
  <header class="match-header">
    <div>
      <p class="eyebrow">Multiplayer · Live rooms</p>
      <h1>
        {lobby
          ? 'Your lobby'
          : view === 'choose'
            ? 'Play together'
            : view === 'join'
              ? 'Join a room'
              : 'Choose your match'}
      </h1>
      <p class="intro">One room. Every mode. Play again with the same opponent.</p>
    </div>
    {#if lastRoomId || lastLobbyId}
      <div class="resume-room">
        <Users size={24} aria-hidden="true" />
        <div>
          <span class="eyebrow">Your last room</span>
          <p>Get back in the game</p>
        </div>
        <button type="button" onclick={resumeLast} class="resume-button"
          >Resume <ArrowRight size={16} /></button
        >
      </div>
    {/if}
  </header>

  {#if lobby}
    <RoomShell
      roomId={lobby.gameRoomId ?? lobby.id}
      lobbyId={lobby.id}
      title="Room lobby"
      phase={lobby.canStart ? 'Choose next match' : 'Match in progress'}
      summary={lobby.guestJoined
        ? 'Your opponent is in the lobby.'
        : 'Share this code with your opponent.'}
      code={lobby.code}
      participantId={lobby.participantId}
      members={[{ participantId: 'p1' }, ...(lobby.guestJoined ? [{ participantId: 'p2' }] : [])]}
      connection={coordinator.snapshot.connection}
    >
      {#if !lobby.canStart && lobby.gameKind && lobby.gameRoomId}
        <button class="resume-button" onclick={() => coordinator.session.resume()}
          >Return to match</button
        >
      {/if}
      {#if lobby.participantId === 'p1' && lobby.guestJoined}
        <button
          class="secondary-action"
          disabled={busy || !lobby.canStart}
          onclick={() => coordinator.session.removeOpponent()}>Remove opponent</button
        >
      {/if}
      <button class="secondary-action" disabled={busy || !lobby.canStart} onclick={leaveLobby}
        >Leave lobby</button
      >
    </RoomShell>
  {/if}
  <div
    class={['match-layout', { 'entry-layout': view !== 'create' || lobby?.participantId === 'p2' }]}
  >
    {#if view === 'create' && (!lobby || lobby.participantId === 'p1')}
      <div class="mode-selection">
        <div class="section-heading">
          <h2>Match format</h2>
          <span><Users size={14} aria-hidden="true" /> 2 players · head to head</span>
        </div>
        <div class="mode-grid">
          {#each formats as item (item.id)}
            <button
              type="button"
              class={['mode-card', { selected: matchFormat === item.id }]}
              aria-pressed={matchFormat === item.id}
              disabled={busy || (lobby !== null && !lobby.canStart)}
              onclick={() => selectFormat(item.id)}
            >
              <img
                src={staticAsset(
                  typeof item.image === 'function' ? item.image(settings) : item.image,
                )}
                alt=""
                width="1536"
                height="1024"
                class="mode-image"
              />
              <div class="card-top">
                <span class="mode-tag"
                  ><item.icon size={14} aria-hidden="true" /> {item.category}</span
                >
                {#if matchFormat === item.id}<span class="selection-check"
                    ><Check size={16} aria-hidden="true" /><span class="sr-only">Selected</span
                    ></span
                  >{/if}
              </div>
              <div class="card-copy">
                <h3>{item.name}</h3>
                <p>{item.description}</p>
                <div class="card-facts">
                  <span><Users size={14} aria-hidden="true" /> 1v1</span><span
                    ><CalendarDays size={14} aria-hidden="true" /> {item.format}</span
                  >
                </div>
              </div>
            </button>
          {/each}
        </div>
        <div class="court-note">
          <LockKeyhole size={17} aria-hidden="true" />
          <p>Just you and your opponent. Every room uses a private 4-digit invite code.</p>
        </div>
      </div>
    {/if}
    <aside class="setup-panel" aria-label="Match setup">
      {#if !lobby && view !== 'choose'}
        <div class="panel-tabs" aria-label="Room action">
          <button
            type="button"
            aria-pressed={view === 'create'}
            class={['panel-tab', { active: view === 'create' }]}
            disabled={busy}
            onclick={createRoom}>Create a room</button
          >
          <button
            type="button"
            aria-pressed={view === 'join'}
            class={['panel-tab', { active: view === 'join' }]}
            disabled={busy}
            onclick={() => switchView('join')}
            ><LogIn size={15} aria-hidden="true" /> Join a room</button
          >
        </div>
      {/if}
      <div class="panel-body">
        {#if view === 'choose'}
          <p class="eyebrow">Multiplayer</p>
          <h2>Meet in the lobby</h2>
          <p class="join-description">
            Create a room to choose a game, or join any mode with your opponent’s code.
          </p>
          <div class="entry-actions">
            <button class="primary-action" onclick={createRoom}
              >Create a room <ArrowRight size={18} /></button
            >
            <button class="secondary-action" onclick={() => switchView('join')}
              >Join a room <LogIn size={18} /></button
            >
          </div>
        {:else if lobby?.participantId === 'p2'}
          <p class="eyebrow">Same room · Next match</p>
          <h2>Waiting for your host</h2>
          <p class="join-description">
            Your host chooses the next match. You’ll enter the next match together.
          </p>
        {:else if view === 'create'}
          <p class="eyebrow">Configure your match</p>
          <div class="selected-summary">
            <span class="summary-icon"><selectedFormat.icon size={25} aria-hidden="true" /></span>
            <div>
              <h2>{selectedFormat.name}</h2>
              <p>{selectedFormat.format} · 2 players</p>
            </div>
          </div>
          {#if adapter}
            <adapter.Settings
              value={settings}
              onchange={updateSettings}
              disabled={busy || (lobby !== null && !lobby.canStart)}
            />
          {/if}
          <dl class="match-rules">
            <div>
              <dt><CalendarDays size={15} aria-hidden="true" /> Match format</dt>
              <dd>{selectedFormat.format}</dd>
            </div>
            <div>
              <dt><Clock size={15} aria-hidden="true" /> Pick timer</dt>
              <dd>
                {adapter?.pickTimer(settings) ?? 'Loading…'}
              </dd>
            </div>
            <div>
              <dt><LockKeyhole size={15} aria-hidden="true" /> Room access</dt>
              <dd>Invite only</dd>
            </div>
          </dl>
          <button
            type="button"
            onclick={lobby ? startCreate : createRoom}
            disabled={busy || (lobby !== null && !lobby.canStart) || !adapter}
            class="primary-action"
            >{busy ? 'Please wait…' : lobby ? 'Create match' : 'Create room'}<ArrowRight
              size={18}
              aria-hidden="true"
            /></button
          >
          <p class="action-note">Keep this room code to play every mode with the same opponent.</p>
        {:else}
          <p class="eyebrow">Meet on the court</p>
          <h2 class="join-title">Join your opponent</h2>
          <p class="join-description">
            Enter your host’s 4-digit code. The game mode is picked automatically.
          </p>
          <form
            onsubmit={(event) => {
              event.preventDefault();
              void doJoin();
            }}
          >
            <label for="join-code" class="field-label">Room code</label>
            <input
              id="join-code"
              type="text"
              inputmode="numeric"
              autocomplete="one-time-code"
              maxlength={4}
              placeholder="0000"
              bind:value={code}
              oninput={cleanCode}
              disabled={busy}
              class="code-input"
            />
            <div class="join-actions">
              <button
                type="button"
                onclick={doPreview}
                disabled={busy || code.length !== 4}
                class="secondary-action">Preview room</button
              >
              <button type="submit" disabled={busy || code.length !== 4} class="primary-action"
                >{busy ? 'Please wait…' : 'Join room'}<ArrowRight
                  size={16}
                  aria-hidden="true"
                /></button
              >
            </div>
          </form>
          {#if preview}<p class="room-preview" role="status">{preview}</p>{/if}
        {/if}
        {#if error}<p class="room-error" role="alert">{error}</p>{/if}
        {#if !isMultiplayerConfigured()}<p class="connection-note">
            Online rooms are unavailable in this setup. Solo Classic and Sandbox are ready to play.
          </p>{/if}
      </div>
    </aside>
  </div>
</section>

<style>
  .match-page {
    max-width: 1480px;
    margin: 0 auto;
    padding: 48px 32px 80px;
  }
  .match-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 32px;
    margin-bottom: 40px;
  }
  .eyebrow {
    color: var(--color-primary);
    font-family: var(--font-mono);
    font-size: 11px;
    font-weight: 700;
    letter-spacing: 0.14em;
    text-transform: uppercase;
  }
  h1,
  h2,
  h3 {
    font-family: var(--font-display);
    font-weight: 800;
  }
  h1 {
    margin: 6px 0 10px;
    font-size: clamp(40px, 4.5vw, 68px);
    line-height: 1;
    letter-spacing: -0.015em;
    text-transform: uppercase;
  }
  .intro {
    color: var(--color-muted-foreground);
    font-size: 14px;
    line-height: 1.7;
    max-width: 580px;
  }
  .resume-room {
    display: flex;
    align-items: center;
    gap: 16px;
    padding: 18px;
    border: 1px solid var(--color-line-soft);
    border-radius: 12px;
    background: var(--color-card);
  }
  .resume-room > :global(svg) {
    color: var(--color-muted-foreground);
    flex-shrink: 0;
  }
  .resume-room .eyebrow {
    font-size: 9px;
  }
  .resume-room p {
    font-size: 14px;
    font-weight: 600;
    white-space: nowrap;
    margin-top: 3px;
  }
  .resume-button {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 10px 14px;
    border-radius: 7px;
    background: var(--color-primary);
    color: var(--color-primary-foreground);
    font-size: 12px;
    font-weight: 700;
  }
  .entry-layout {
    max-width: 520px;
    margin-inline: auto;
  }
  .match-layout.entry-layout {
    grid-template-columns: minmax(0, 1fr);
  }
  .entry-actions {
    display: grid;
    gap: 12px;
    margin-top: 24px;
  }

  .match-layout {
    display: grid;
    grid-template-columns: minmax(0, 1fr) 370px;
    gap: 24px;
    align-items: start;
  }
  .section-heading {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    margin: 0 0 18px;
  }
  .section-heading h2 {
    font-size: 17px;
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }
  .section-heading > span {
    display: flex;
    gap: 7px;
    align-items: center;
    font-size: 11px;
    color: var(--color-muted-foreground);
  }
  .mode-grid {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 16px;
  }
  .mode-card {
    position: relative;
    display: flex;
    flex-direction: column;
    justify-content: space-between;
    min-height: 430px;
    isolation: isolate;
    overflow: hidden;
    padding: 17px;
    border: 1px solid var(--color-line-strong);
    border-radius: 12px;
    text-align: left;
    color: #f5f3ef;
    background: #0d1118;
    transition:
      border-color 160ms,
      transform 160ms;
  }
  .mode-card::after {
    content: '';
    position: absolute;
    inset: 0;
    z-index: -1;
    background: linear-gradient(
      180deg,
      rgb(8 12 17 / 12%) 0%,
      rgb(8 12 17 / 8%) 24%,
      rgb(8 12 17 / 85%) 56%,
      #0b1017 86%
    );
  }
  .mode-image {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 68%;
    z-index: -2;
    object-fit: cover;
    object-position: 50% 25%;
  }
  .mode-card:hover:not(:disabled) {
    border-color: var(--color-primary);
    transform: translateY(-3px);
  }
  .mode-card.selected {
    border-color: var(--color-primary);
    box-shadow: 0 0 0 1px var(--color-primary);
  }
  .card-top {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 8px;
  }
  .mode-tag {
    display: inline-flex;
    gap: 6px;
    align-items: center;
    padding: 5px 9px;
    border: 1px solid rgb(255 255 255 / 25%);
    border-radius: 5px;
    background: rgb(9 13 18 / 65%);
    font-family: var(--font-display);
    font-size: 12px;
    font-weight: 700;
    letter-spacing: 0.04em;
    text-transform: uppercase;
  }
  .selected .mode-tag,
  .selection-check {
    background: var(--color-primary);
    color: var(--color-primary-foreground);
    border-color: transparent;
  }
  .selection-check {
    display: grid;
    place-items: center;
    width: 25px;
    height: 25px;
    border-radius: 50%;
    flex-shrink: 0;
  }
  .card-copy h3 {
    font-size: 30px;
    line-height: 1.1;
    margin-bottom: 10px;
  }
  .card-copy > p {
    color: #b9bec8;
    font-size: 12px;
    line-height: 1.65;
    min-height: 80px;
  }
  .card-facts {
    display: flex;
    flex-wrap: wrap;
    gap: 12px;
    margin-top: 18px;
    padding-top: 14px;
    border-top: 1px solid rgb(255 255 255 / 12%);
  }
  .card-facts span {
    display: flex;
    gap: 5px;
    align-items: center;
    font-size: 10px;
    color: #b9bec8;
  }
  .court-note {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 20px 0;
    color: var(--color-muted-foreground);
    font-size: 12px;
    line-height: 1.6;
  }
  .court-note > :global(svg) {
    flex-shrink: 0;
  }
  .setup-panel {
    background: var(--color-card);
    border: 1px solid var(--color-line-strong);
    border-top: 2px solid var(--color-primary);
    border-radius: 12px;
    overflow: hidden;
  }
  .panel-tabs {
    display: grid;
    grid-template-columns: 1fr 1fr;
    border-bottom: 1px solid var(--color-line-soft);
  }
  .panel-tab {
    display: flex;
    justify-content: center;
    align-items: center;
    gap: 7px;
    padding: 17px 10px;
    font-size: 12px;
    font-weight: 600;
    color: var(--color-muted-foreground);
    border-bottom: 2px solid transparent;
  }
  .panel-tab.active {
    color: var(--color-foreground);
    border-bottom-color: var(--color-primary);
    background: var(--color-surface-2);
  }
  .panel-body {
    padding: 22px;
  }
  .panel-body > .eyebrow {
    font-size: 10px;
    letter-spacing: 0.08em;
  }
  .selected-summary {
    display: flex;
    align-items: center;
    gap: 14px;
    margin: 18px 0 22px;
  }
  .summary-icon {
    display: grid;
    place-items: center;
    width: 48px;
    height: 48px;
    border-radius: 9px;
    background: var(--color-surface-2);
    color: var(--color-primary);
  }
  .selected-summary h2 {
    font-size: 27px;
    line-height: 1.1;
  }
  .selected-summary p {
    color: var(--color-muted-foreground);
    font-size: 12px;
    margin-top: 5px;
  }
  .field-label {
    display: block;
    font-family: var(--font-display);
    font-size: 14px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.03em;
    margin-bottom: 10px;
  }

  .match-rules {
    border-top: 1px solid var(--color-line-soft);
    margin: 22px 0;
    padding-top: 16px;
  }
  .match-rules > div {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 10px;
    margin-bottom: 12px;
    font-size: 11px;
  }
  .match-rules dt {
    display: flex;
    align-items: center;
    gap: 8px;
    color: var(--color-muted-foreground);
  }
  .match-rules dd {
    font-weight: 600;
  }
  .primary-action {
    display: flex;
    justify-content: center;
    align-items: center;
    gap: 12px;
    width: 100%;
    border-radius: 8px;
    background: var(--color-primary);
    color: var(--color-primary-foreground);
    padding: 13px 12px;
    font-size: 13px;
    font-weight: 700;
  }
  .primary-action:hover:not(:disabled),
  .resume-button:hover {
    filter: brightness(1.08);
  }
  .action-note {
    text-align: center;
    color: var(--color-muted-foreground);
    font-size: 10px;
    line-height: 1.5;
    margin-top: 12px;
  }
  .join-title {
    font-size: 32px;
    margin-top: 18px;
  }
  .join-description {
    font-size: 13px;
    color: var(--color-muted-foreground);
    line-height: 1.7;
    margin: 8px 0 24px;
  }
  .code-input {
    width: 100%;
    background: var(--color-surface-2);
    border: 1px solid var(--color-line-strong);
    border-radius: 8px;
    padding: 16px;
    text-align: center;
    font-family: var(--font-mono);
    font-size: 28px;
    letter-spacing: 0.4em;
  }
  .join-actions {
    display: flex;
    gap: 10px;
    margin-top: 14px;
  }
  .join-actions button {
    flex: 1;
  }
  .secondary-action {
    border: 1px solid var(--color-line-strong);
    border-radius: 8px;
    padding: 12px;
    font-size: 12px;
    font-weight: 600;
  }
  .room-preview,
  .room-error,
  .connection-note {
    padding: 12px;
    border-radius: 8px;
    margin-top: 16px;
    font-size: 12px;
    line-height: 1.7;
  }
  .room-preview {
    border: 1px solid var(--color-positive);
    background: color-mix(in srgb, var(--color-positive) 8%, var(--color-card));
  }
  .room-error {
    border: 1px solid var(--color-destructive);
    background: color-mix(in srgb, var(--color-destructive) 8%, var(--color-card));
  }
  .connection-note {
    border-top: 1px solid var(--color-line-soft);
    border-radius: 0;
    padding: 14px 0 0;
    color: var(--color-muted-foreground);
    font-size: 11px;
  }
  button {
    cursor: pointer;
  }
  button:disabled {
    cursor: default;
    opacity: 0.5;
  }
  button:focus-visible,
  input:focus-visible {
    outline: 2px solid var(--color-ring);
    outline-offset: 4px;
  }
  @media (min-width: 1200px) {
    .setup-panel {
      position: sticky;
      top: 24px;
    }
  }
  @media (max-width: 1199px) {
    .match-layout {
      grid-template-columns: minmax(0, 1fr) 330px;
      gap: 18px;
    }
    .mode-grid {
      grid-template-columns: 1fr;
    }
    .mode-card {
      min-height: 220px;
      padding-left: 45%;
    }
    .mode-image {
      width: 55%;
      height: 100%;
      object-position: 40% 30%;
    }
    .mode-card::after {
      background: linear-gradient(90deg, transparent, #0b1017 52%);
    }
    .card-copy > p {
      min-height: 0;
    }
    .card-top {
      margin-bottom: 16px;
    }
    .card-copy h3 {
      font-size: 27px;
    }
    .resume-room p {
      white-space: normal;
    }
    .panel-body {
      padding: 18px;
    }
  }
  @media (max-width: 760px) {
    .match-page {
      padding: 28px 18px 88px;
    }
    .match-header {
      flex-direction: column;
      align-items: stretch;
      gap: 22px;
      margin-bottom: 28px;
    }
    .resume-room {
      padding: 14px;
    }
    .resume-button {
      margin-left: auto;
    }
    .match-layout {
      grid-template-columns: 1fr;
      gap: 8px;
    }
    .mode-card {
      min-height: 210px;
    }
    .section-heading > span {
      font-size: 10px;
    }
    .panel-body {
      padding: 22px;
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .mode-card {
      transition: none;
    }
    .mode-card:hover:not(:disabled) {
      transform: none;
    }
  }
</style>
