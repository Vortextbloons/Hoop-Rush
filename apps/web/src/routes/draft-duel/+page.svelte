<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { resolve } from '$app/paths';
  import {
    ArrowRight,
    Brain,
    CalendarDays,
    ChartNoAxesColumn,
    Clock,
    LockKeyhole,
    LogIn,
    Scale,
    Shuffle,
    Sparkles,
    Users,
  } from '@lucide/svelte';
  import type { DraftDuelFairness, DraftDuelPresentation } from '@hoop-rush/data-contracts';
  import { DraftDuelController } from '$lib/draft-duel/draft-duel-controller.svelte';
  import { isDraftDuelSupabaseConfigured, getDraftDuelTransport } from '$lib/draft-duel-transport';
  import { loadLastDraftDuelRoomId } from '$lib/draft-duel-identity';

  type View = 'create' | 'join';
  const controller = new DraftDuelController();
  let view = $state<View>('create');
  let fairness = $state<DraftDuelFairness>('fair');
  let presentation = $state<DraftDuelPresentation>('ratings');
  let codeInput = $state('');
  let preview = $state<string | null>(null);
  let localError = $state<string | null>(null);
  let lastRoomId = $state<string | null>(null);
  const displayError = $derived(localError ?? controller.error);

  onMount(() => {
    lastRoomId = loadLastDraftDuelRoomId();
    const params = new URLSearchParams(window.location.search);
    const code = params.get('code');
    if (code && /^[0-9]{4}$/.test(code)) {
      codeInput = code;
      view = 'join';
    }
  });

  function switchView(next: View): void {
    view = next;
    localError = null;
  }

  function cleanCode(): void {
    const clean = codeInput.replace(/\D/g, '').slice(0, 4);
    if (clean !== codeInput) codeInput = clean;
    preview = null;
    localError = null;
  }

  async function createRoom(): Promise<void> {
    const created = await controller.createRoom(fairness, presentation);
    if (created) {
      await goto(resolve('/draft-duel/room/[roomId]', { roomId: created.roomId }));
    }
  }

  async function doPreview(): Promise<void> {
    cleanCode();
    if (codeInput.length !== 4) {
      localError = 'Enter a 4-digit code.';
      return;
    }
    try {
      const snap = await getDraftDuelTransport().preview(codeInput);
      const phaseName =
        snap.phase === 'lobby'
          ? 'waiting to start'
          : snap.phase === 'drafting'
            ? 'drafting now'
            : snap.phase === 'championship'
              ? 'finished'
              : 'playing';
      preview = `Draft Duel · ${snap.settings.fairness === 'fair' ? 'Fair' : 'Unfair'} · ${
        snap.settings.presentation === 'ratings' ? 'Ratings' : 'Ball Knowledge'
      } · ${phaseName}`;
    } catch (e) {
      localError = e instanceof Error ? e.message.slice(0, 200) : 'Could not preview that room.';
      preview = null;
    }
  }

  async function joinRoom(): Promise<void> {
    cleanCode();
    if (codeInput.length !== 4) {
      localError = 'Enter a 4-digit code.';
      return;
    }
    const joined = await controller.joinRoom(codeInput);
    if (joined) {
      await goto(resolve('/draft-duel/room/[roomId]', { roomId: joined.roomId }));
    }
  }

  async function resumeLast(): Promise<void> {
    if (!lastRoomId) return;
    await goto(resolve('/draft-duel/room/[roomId]', { roomId: lastRoomId }));
  }
</script>

<svelte:head>
  <title>Draft Duel · Hoop Rush</title>
</svelte:head>

<section class="match-page">
  <header class="match-header">
    <div>
      <a class="back-link" href={resolve('/multiplayer')}>← All game modes</a>
      <p class="eyebrow">Multiplayer · Private rooms</p>
      <h1>Draft Duel</h1>
      <p class="intro">
        Five rounds, eight cards, one shared stage. Draft a starting five, then settle it in a
        best-of-seven broadcast.
      </p>
    </div>
    {#if lastRoomId}
      <div class="resume-room">
        <Users size={24} aria-hidden="true" />
        <div>
          <span class="eyebrow">Your last room</span>
          <p>Get back to the draft</p>
        </div>
        <button type="button" onclick={resumeLast} class="resume-button"
          >Resume <ArrowRight size={16} aria-hidden="true" /></button
        >
      </div>
    {/if}
  </header>

  <div class="match-layout">
    <div class="mode-selection">
      <div class="section-heading">
        <h2>The showdown</h2>
        <span><Users size={14} aria-hidden="true" /> 2 players · head to head</span>
      </div>
      <article class="mode-card" aria-label="Draft Duel">
        <img
          class="mode-image"
          src="/images/multiplayer/draft-duel.png"
          alt="Two rivals drafting player cards across a scorer's table in a historic gym"
          width="1536"
          height="1024"
        />
        <div class="card-top">
          <span class="mode-tag"><Sparkles size={14} aria-hidden="true" /> 5 rounds · Bo7</span>
        </div>
        <div class="card-copy">
          <h3>Draft Duel</h3>
          <p>
            Both tables reveal eight cards every round. Claim a player and every version of him is
            off the board — build a legal five, then first to four wins the series.
          </p>
          <div class="card-facts">
            <span><Users size={14} aria-hidden="true" /> 1v1</span>
            <span><Clock size={14} aria-hidden="true" /> 60s picks</span>
            <span><CalendarDays size={14} aria-hidden="true" /> Best of 7</span>
          </div>
        </div>
      </article>
      <div class="court-note">
        <LockKeyhole size={17} aria-hidden="true" />
        <p>Just you and your opponent. Every room uses a private 4-digit invite code.</p>
      </div>
    </div>

    <aside class="setup-panel" aria-label="Draft Duel setup">
      <div class="panel-tabs" aria-label="Room action">
        <button
          type="button"
          aria-pressed={view === 'create'}
          class={['panel-tab', { active: view === 'create' }]}
          disabled={controller.busy}
          onclick={() => switchView('create')}>Create a room</button
        >
        <button
          type="button"
          aria-pressed={view === 'join'}
          class={['panel-tab', { active: view === 'join' }]}
          disabled={controller.busy}
          onclick={() => switchView('join')}
          ><LogIn size={15} aria-hidden="true" /> Join a room</button
        >
      </div>
      <div class="panel-body">
        {#if view === 'create'}
          <p class="eyebrow">Configure your match</p>
          <div class="selected-summary">
            <span class="summary-icon"><Sparkles size={25} aria-hidden="true" /></span>
            <div>
              <h2>Draft Duel</h2>
              <p>Best of 7 · 2 players</p>
            </div>
          </div>
          <fieldset disabled={controller.busy}>
            <legend class="field-label">Fairness</legend>
            <div class="knowledge-options">
              <button
                type="button"
                aria-pressed={fairness === 'fair'}
                class={['option', { active: fairness === 'fair' }]}
                onclick={() => (fairness = 'fair')}
                ><Scale size={21} aria-hidden="true" /><span
                  ><strong>Fair</strong><small>Shared strength bands</small></span
                ></button
              >
              <button
                type="button"
                aria-pressed={fairness === 'unfair'}
                class={['option', { active: fairness === 'unfair' }]}
                onclick={() => (fairness = 'unfair')}
                ><Shuffle size={21} aria-hidden="true" /><span
                  ><strong>Unfair</strong><small>Equal player odds</small></span
                ></button
              >
            </div>
          </fieldset>
          <fieldset disabled={controller.busy}>
            <legend class="field-label">Knowledge setting</legend>
            <div class="knowledge-options">
              <button
                type="button"
                aria-pressed={presentation === 'ratings'}
                class={['option', { active: presentation === 'ratings' }]}
                onclick={() => (presentation = 'ratings')}
                ><ChartNoAxesColumn size={21} aria-hidden="true" /><span
                  ><strong>Ratings</strong><small>See player ratings</small></span
                ></button
              >
              <button
                type="button"
                aria-pressed={presentation === 'ball-knowledge'}
                class={['option', { active: presentation === 'ball-knowledge' }]}
                onclick={() => (presentation = 'ball-knowledge')}
                ><Brain size={21} aria-hidden="true" /><span
                  ><strong>Ball Knowledge</strong><small>Draft from memory</small></span
                ></button
              >
            </div>
          </fieldset>
          <dl class="match-rules">
            <div>
              <dt><CalendarDays size={15} aria-hidden="true" /> Match format</dt>
              <dd>Best of 7</dd>
            </div>
            <div>
              <dt><Clock size={15} aria-hidden="true" /> Pick timer</dt>
              <dd>60s picks</dd>
            </div>
            <div>
              <dt><LockKeyhole size={15} aria-hidden="true" /> Room access</dt>
              <dd>Invite only</dd>
            </div>
          </dl>
          <button
            type="button"
            onclick={createRoom}
            disabled={controller.busy}
            class="primary-action"
            >{controller.busy ? 'Creating room…' : 'Create room'}<ArrowRight
              size={18}
              aria-hidden="true"
            /></button
          >
          <p class="action-note">Share your room code after creating the room.</p>
        {:else}
          <p class="eyebrow">Meet at the table</p>
          <h2 class="join-title">Join your opponent</h2>
          <p class="join-description">Enter the 4-digit code shared by your room host.</p>
          <form
            onsubmit={(event) => {
              event.preventDefault();
              void joinRoom();
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
              bind:value={codeInput}
              oninput={cleanCode}
              disabled={controller.busy}
              class="code-input"
            />
            <div class="join-actions">
              <button
                type="button"
                onclick={doPreview}
                disabled={controller.busy || codeInput.length !== 4}
                class="secondary-action">Preview room</button
              >
              <button
                type="submit"
                disabled={controller.busy || codeInput.length !== 4}
                class="primary-action"
                >{controller.busy ? 'Please wait…' : 'Join room'}<ArrowRight
                  size={16}
                  aria-hidden="true"
                /></button
              >
            </div>
          </form>
          {#if preview}<p class="room-preview" role="status">{preview}</p>{/if}
        {/if}
        {#if displayError}<p class="room-error" role="alert">{displayError}</p>{/if}
        {#if !isDraftDuelSupabaseConfigured()}<p class="connection-note">
            Online rooms are unavailable in this setup. Draft Duel needs the online lobby.
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
  .back-link {
    display: inline-block;
    margin-bottom: 10px;
    color: var(--color-muted-foreground);
    font-size: 12px;
    text-decoration: none;
  }
  .back-link:hover {
    color: var(--color-foreground);
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
  fieldset {
    border: 0;
    padding: 0;
    min-width: 0;
    margin-bottom: 22px;
  }
  .knowledge-options {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 8px;
  }
  .option {
    display: flex;
    align-items: center;
    gap: 9px;
    min-width: 0;
    padding: 12px 10px;
    border: 1px solid var(--color-line-soft);
    border-radius: 8px;
    text-align: left;
    background: var(--color-surface-1);
  }
  .option > :global(svg) {
    color: var(--color-muted-foreground);
    flex-shrink: 0;
  }
  .option strong {
    display: block;
    font-family: var(--font-display);
    font-size: 16px;
    line-height: 1.2;
  }
  .option small {
    display: block;
    color: var(--color-muted-foreground);
    font-size: 10px;
    margin-top: 5px;
  }
  .option.active {
    border-color: var(--color-primary);
    background: color-mix(in srgb, var(--color-primary) 9%, var(--color-card));
  }
  .option.active > :global(svg) {
    color: var(--color-primary);
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
    .option {
      gap: 7px;
      padding: 10px 7px;
    }
    .option strong {
      font-size: 15px;
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
    .option {
      padding: 13px;
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .mode-card {
      transition: none;
    }
  }
</style>
