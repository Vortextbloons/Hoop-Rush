<script lang="ts">
  import { page } from '$app/stores';
  import { goto } from '$app/navigation';
  import { resolve } from '$app/paths';
  import { onMount } from 'svelte';
  import { DraftDuelController } from '$lib/draft-duel/draft-duel-controller.svelte';
  import { loadLastDraftDuelRoomId } from '$lib/draft-duel-identity';
  import type { DraftDuelFairness, DraftDuelPresentation } from '@hoop-rush/data-contracts';

  const controller = new DraftDuelController();
  let fairness = $state<DraftDuelFairness>('fair');
  let presentation = $state<DraftDuelPresentation>('ratings');
  let codeInput = $state('');
  let lastRoomId = $state<string | null>(null);

  onMount(() => {
    lastRoomId = loadLastDraftDuelRoomId();
    const queryCode = $page.url.searchParams.get('code');
    if (queryCode) codeInput = queryCode.replace(/\D/g, '').slice(0, 4);
  });

  async function createRoom(): Promise<void> {
    const created = await controller.createRoom(fairness, presentation);
    if (created) {
      await goto(resolve('/draft-duel/room/[roomId]', { roomId: created.roomId }));
    }
  }

  async function joinRoom(): Promise<void> {
    const joined = await controller.joinRoom(codeInput);
    if (joined) {
      await goto(resolve('/draft-duel/room/[roomId]', { roomId: joined.roomId }));
    }
  }
</script>

<svelte:head>
  <title>Draft Duel · Hoop Rush</title>
</svelte:head>

<main class="draft-duel-lobby">
  <header class="lobby-header">
    <a class="back-link" href={resolve('/multiplayer')}>← Multiplayer</a>
    <p class="eyebrow">Private room · two players</p>
    <h1>Draft Duel</h1>
    <p class="tagline">
      Five rounds, eight cards, one shared stage. Draft a starting five, then settle it in a
      best-of-seven broadcast.
    </p>
  </header>

  {#if controller.error}
    <p class="error-banner" role="alert">{controller.error}</p>
  {/if}

  <section class="lobby-panel" aria-label="Create a room">
    <h2>Create a private room</h2>
    <div class="setting-row">
      <span class="setting-label">Fairness</span>
      <div class="segmented" role="radiogroup" aria-label="Fairness">
        <button
          type="button"
          class:selected={fairness === 'fair'}
          role="radio"
          aria-checked={fairness === 'fair'}
          onclick={() => (fairness = 'fair')}>Fair</button
        >
        <button
          type="button"
          class:selected={fairness === 'unfair'}
          role="radio"
          aria-checked={fairness === 'unfair'}
          onclick={() => (fairness = 'unfair')}>Unfair</button
        >
      </div>
    </div>
    <div class="setting-row">
      <span class="setting-label">Presentation</span>
      <div class="segmented" role="radiogroup" aria-label="Presentation">
        <button
          type="button"
          class:selected={presentation === 'ratings'}
          role="radio"
          aria-checked={presentation === 'ratings'}
          onclick={() => (presentation = 'ratings')}>Ratings</button
        >
        <button
          type="button"
          class:selected={presentation === 'ball-knowledge'}
          role="radio"
          aria-checked={presentation === 'ball-knowledge'}
          onclick={() => (presentation = 'ball-knowledge')}>Ball Knowledge</button
        >
      </div>
    </div>
    <p class="hint">
      {fairness === 'fair'
        ? 'Both players receive the same strength-band mix across their 40 offers.'
        : 'Every eligible player has an equal chance; versions are drawn uniformly.'}
    </p>
    <button class="primary" type="button" disabled={controller.busy} onclick={createRoom}>
      {controller.busy ? 'Creating…' : 'Create room'}
    </button>
  </section>

  <section class="lobby-panel" aria-label="Join a room">
    <h2>Join with a code</h2>
    <label class="code-field">
      <span>4-digit code</span>
      <input
        inputmode="numeric"
        autocomplete="one-time-code"
        maxlength="4"
        placeholder="0000"
        bind:value={codeInput}
        oninput={(event) => {
          codeInput = event.currentTarget.value.replace(/\D/g, '').slice(0, 4);
        }}
      />
    </label>
    <button
      class="primary"
      type="button"
      disabled={controller.busy || codeInput.length !== 4}
      onclick={joinRoom}>Join room</button
    >
    {#if lastRoomId}
      <p class="resume-row">
        <a href={resolve('/draft-duel/room/[roomId]', { roomId: lastRoomId })}>Rejoin last room</a>
      </p>
    {/if}
  </section>
</main>

<style>
  .draft-duel-lobby {
    max-width: 720px;
    margin: 0 auto;
    padding: 2rem 1.25rem 4rem;
    display: grid;
    gap: 1.5rem;
  }
  .lobby-header {
    display: grid;
    gap: 0.35rem;
  }
  .back-link {
    color: var(--muted-foreground, #8b93a1);
    text-decoration: none;
    font-size: 0.85rem;
  }
  .eyebrow {
    margin: 0;
    text-transform: uppercase;
    letter-spacing: 0.14em;
    font-family: 'Roboto Mono', monospace;
    font-size: 0.7rem;
    color: var(--muted-foreground, #8b93a1);
  }
  h1 {
    margin: 0;
    font-family: 'Barlow Condensed', sans-serif;
    font-size: clamp(2.4rem, 6vw, 3.4rem);
    letter-spacing: 0.02em;
  }
  .tagline {
    margin: 0;
    color: var(--muted-foreground, #8b93a1);
    max-width: 52ch;
  }
  .lobby-panel {
    border: 1px solid var(--border, #232833);
    border-radius: 12px;
    padding: 1.25rem;
    display: grid;
    gap: 0.9rem;
    background: var(--surface, #12151c);
  }
  h2 {
    margin: 0;
    font-family: 'Barlow Condensed', sans-serif;
    font-size: 1.5rem;
    letter-spacing: 0.03em;
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
  .hint {
    margin: 0;
    font-size: 0.85rem;
    color: var(--muted-foreground, #8b93a1);
  }
  .primary {
    justify-self: start;
    border: none;
    border-radius: 8px;
    padding: 0.65rem 1.4rem;
    background: var(--court-accent, #f97316);
    color: #0b0d12;
    font-weight: 700;
    font-size: 1rem;
    cursor: pointer;
  }
  .primary:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
  .code-field {
    display: grid;
    gap: 0.35rem;
    font-size: 0.85rem;
    color: var(--muted-foreground, #8b93a1);
  }
  .code-field input {
    width: 9rem;
    border: 1px solid var(--border, #232833);
    border-radius: 8px;
    background: transparent;
    color: inherit;
    padding: 0.6rem 0.8rem;
    font-family: 'Roboto Mono', monospace;
    font-size: 1.4rem;
    letter-spacing: 0.35em;
    text-align: center;
  }
  .resume-row {
    display: flex;
    gap: 1rem;
    align-items: center;
    font-size: 0.9rem;
  }
  .resume-row a {
    color: var(--court-accent, #f97316);
  }
  .error-banner {
    margin: 0;
    border: 1px solid #7f1d1d;
    background: #2a1214;
    color: #fecaca;
    padding: 0.75rem 1rem;
    border-radius: 8px;
  }
</style>
