<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { asset, resolve } from '$app/paths';
  import {
    Swords,
    Zap,
    Trophy,
    LogIn,
    ArrowRight,
    Users,
    CalendarDays,
    Clock,
    Check,
    LockKeyhole,
    ChartNoAxesColumn,
    Brain,
    Sparkles,
    Scale,
    Shuffle,
  } from '@lucide/svelte';
  import {
    CLASSIC_ROLL_VERSION,
    FIXED_FIVE_AUTOPICK_VERSION,
    FIXED_FIVE_MULTIPLAYER_VERSION,
    POSITION_NORMALIZATION_VERSION,
    RATINGS_VERSION,
    defaultFixedFiveVersionLocks,
    type FixedFiveRoomMode,
    type FixedFiveSourceMode,
    type FixedFiveVersionLocks,
  } from '@hoop-rush/data-contracts';
  import { ENGINE_VERSION } from '@hoop-rush/engine';
  import { getFixedFiveTransport, isFixedFiveSupabaseConfigured } from '$lib/fixed-five-transport';
  import { DraftDuelController } from '$lib/draft-duel/draft-duel-controller.svelte';
  import { getDraftDuelTransport, isDraftDuelSupabaseConfigured } from '$lib/draft-duel-transport';
  import {
    friendlyFixedFiveJoinError,
    loadLastFixedFiveRoomId,
    saveFixedFiveMembership,
  } from '$lib/fixed-five-identity';
  import { loadRunPreamble } from '$lib/run-preamble';
  type View = 'create' | 'join';
  let view = $state<View>('create');
  let matchFormat = $state<'season' | 'duel' | 'draft-duel'>('season');
  let sourceMode = $state<FixedFiveSourceMode>('classic');
  let ddFairness = $state<'fair' | 'unfair'>('fair');
  const draftDuelController = new DraftDuelController();
  const mode = $derived<FixedFiveRoomMode | null>(
    matchFormat === 'duel'
      ? 'duel'
      : matchFormat === 'season'
        ? sourceMode === 'sandbox'
          ? 'sandbox-shared-82'
          : 'classic-shared-82'
        : null,
  );
  let variant = $state<'ratings' | 'ball-knowledge'>('ratings');
  let code = $state('');
  let busy = $state(false);
  let error = $state<string | null>(null);
  let preview = $state<string | null>(null);
  let lastRoomId = $state<string | null>(null);
  const formats = [
    {
      id: 'season',
      name: 'Season',
      category: '82 games',
      icon: Swords,
      image: '/images/multiplayer/shared-season.jpg',
      description:
        'Build your five and face the same 82-game schedule. Compare your records and settle the head-to-head matchups.',
      format: '82 games',
    },
    {
      id: 'duel',
      name: 'Duel',
      category: 'Best of 7',
      icon: Trophy,
      image: '/images/multiplayer/duel.jpg',
      description:
        'Two five-player lineups. One best-of-seven series. First to four wins takes the match.',
      format: 'Best of 7',
    },
    {
      id: 'draft-duel',
      name: 'Draft Duel',
      category: '5 rounds · Bo7',
      icon: Sparkles,
      image: '/images/multiplayer/draft-duel.png',
      description:
        'Five rounds, eight cards, one pick each round. Both tables reveal together, then a best-of-seven broadcast settles it.',
      format: 'Best of 7',
    },
  ] as const;
  const selectedFormat = $derived(formats.find((item) => item.id === matchFormat)!);
  function selectFormat(nextFormat: 'season' | 'duel' | 'draft-duel') {
    matchFormat = nextFormat;
    view = 'create';
    error = null;
  }
  function selectSource(nextSource: FixedFiveSourceMode) {
    sourceMode = nextSource;
    error = null;
  }
  function switchView(nextView: View) {
    view = nextView;
    error = null;
  }
  function transport() {
    return getFixedFiveTransport();
  }
  async function versions(): Promise<FixedFiveVersionLocks> {
    const { manifest, profile, bracket } = await loadRunPreamble();
    return defaultFixedFiveVersionLocks({
      dataVersion: manifest.dataVersion,
      ratingVersion: RATINGS_VERSION,
      positionNormalizationVersion: POSITION_NORMALIZATION_VERSION,
      engineVersion: ENGINE_VERSION,
      bracketVersion: bracket.bracketVersion,
      scheduleVersion: bracket.scheduleVersion,
      classicRollVersion: CLASSIC_ROLL_VERSION,
      profileVersion: profile.profileVersion,
      multiplayerVersion: FIXED_FIVE_MULTIPLAYER_VERSION,
      autopickVersion: FIXED_FIVE_AUTOPICK_VERSION,
    });
  }
  onMount(() => {
    try {
      lastRoomId = loadLastFixedFiveRoomId();
      const params = new URLSearchParams(window.location.search);
      const codeParam = params.get('code');
      if (codeParam && /^[0-9]{4}$/.test(codeParam)) {
        code = codeParam;
        view = 'join';
        void doPreview();
      }
    } catch {}
  });
  async function startCreate() {
    busy = true;
    error = null;
    try {
      if (matchFormat === 'draft-duel') {
        const created = await draftDuelController.createRoom(ddFairness, variant);
        if (!created) {
          error = draftDuelController.error ?? 'Could not create the Draft Duel room.';
          return;
        }
        await goto(resolve('/draft-duel/room/[roomId]', { roomId: created.roomId }));
        return;
      }
      if (!mode) return;
      const t = transport();
      const created = await t.create({
        mode,
        sourceMode,
        variant,
        versions: await versions(),
      });
      saveFixedFiveMembership({ ...created.membership, code: created.code });
      await goto(resolve('/multiplayer/room/[roomId]', { roomId: created.snapshot.roomId }));
    } catch (e) {
      error = friendlyFixedFiveJoinError(e);
      if (!isFixedFiveSupabaseConfigured())
        error = 'Multiplayer is offline right now. You can still play solo Classic/Sandbox.';
    } finally {
      busy = false;
    }
  }
  function cleanCode(): void {
    const clean = code.replace(/\D/g, '').slice(0, 4);
    if (clean !== code) code = clean;
    preview = null;
    error = null;
  }
  async function doPreview() {
    cleanCode();
    if (code.length !== 4) {
      error = 'Enter a 4-digit code';
      return;
    }
    busy = true;
    error = null;
    try {
      if (matchFormat === 'draft-duel') {
        const snap = await getDraftDuelTransport().preview(code);
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
        return;
      }
      const snap = await transport().preview(code);
      const modeName = snap.settings.mode === 'duel' ? 'Duel' : 'Season';
      const sourceName =
        snap.settings.sourceMode === 'sandbox' ? 'Sandbox · Snake Draft' : 'Classic · Roll Draft';
      const phaseName =
        snap.phase === 'lobby'
          ? 'waiting to start'
          : snap.phase === 'drafting'
            ? 'drafting now'
            : snap.phase === 'completed'
              ? 'finished'
              : 'playing';
      preview = `${modeName} · ${sourceName} · ${phaseName}`;
    } catch (e) {
      error = friendlyFixedFiveJoinError(e);
      preview = null;
    } finally {
      busy = false;
    }
  }
  async function doJoin() {
    cleanCode();
    if (code.length !== 4) {
      error = 'Enter a 4-digit code';
      return;
    }
    busy = true;
    error = null;
    try {
      if (matchFormat === 'draft-duel') {
        const joined = await draftDuelController.joinRoom(code);
        if (!joined) {
          error = draftDuelController.error ?? 'Could not join that Draft Duel room.';
          return;
        }
        await goto(resolve('/draft-duel/room/[roomId]', { roomId: joined.roomId }));
        return;
      }
      const { snapshot, membership } = await transport().join(code);
      saveFixedFiveMembership(membership);
      await goto(resolve('/multiplayer/room/[roomId]', { roomId: snapshot.roomId }));
    } catch (e) {
      error = friendlyFixedFiveJoinError(e);
    } finally {
      busy = false;
    }
  }
  async function resumeLast() {
    if (!lastRoomId) return;
    await goto(resolve('/multiplayer/room/[roomId]', { roomId: lastRoomId }));
  }
</script>

<svelte:head>
  <title>Multiplayer — Hoop Rush</title>
</svelte:head>

<section class="match-page">
  <header class="match-header">
    <div>
      <p class="eyebrow">Multiplayer · Live rooms</p>
      <h1>Choose your match</h1>
      <p class="intro">Your five against theirs. Pick your game, share a code, hit the court.</p>
    </div>
    {#if lastRoomId}
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

  <div class="match-layout">
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
            disabled={busy}
            onclick={() => selectFormat(item.id)}
          >
            <img
              src={asset(
                item.id === 'season' && sourceMode === 'sandbox'
                  ? '/images/multiplayer/sandbox-season.jpg'
                  : item.image,
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
                  ><Check size={16} aria-hidden="true" /><span class="sr-only">Selected</span></span
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

    <aside class="setup-panel" aria-label="Match setup">
      <div class="panel-tabs" aria-label="Room action">
        <button
          type="button"
          aria-pressed={view === 'create'}
          class={['panel-tab', { active: view === 'create' }]}
          disabled={busy}
          onclick={() => switchView('create')}>Create a room</button
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
      <div class="panel-body">
        {#if view === 'create'}
          <p class="eyebrow">Configure your match</p>
          <div class="selected-summary">
            <span class="summary-icon"><selectedFormat.icon size={25} aria-hidden="true" /></span>
            <div>
              <h2>{selectedFormat.name}</h2>
              <p>{selectedFormat.format} · 2 players</p>
            </div>
          </div>
          {#if matchFormat === 'draft-duel'}
            <fieldset disabled={busy}>
              <legend class="field-label">Fairness</legend>
              <div class="knowledge-options">
                <button
                  type="button"
                  aria-pressed={ddFairness === 'fair'}
                  class={['option', { active: ddFairness === 'fair' }]}
                  onclick={() => (ddFairness = 'fair')}
                  ><Scale size={21} aria-hidden="true" /><span
                    ><strong>Fair</strong><small>Shared strength bands</small></span
                  ></button
                >
                <button
                  type="button"
                  aria-pressed={ddFairness === 'unfair'}
                  class={['option', { active: ddFairness === 'unfair' }]}
                  onclick={() => (ddFairness = 'unfair')}
                  ><Shuffle size={21} aria-hidden="true" /><span
                    ><strong>Unfair</strong><small>Equal player odds</small></span
                  ></button
                >
              </div>
            </fieldset>
          {:else}
            <fieldset disabled={busy} class="draft-source">
              <legend class="field-label">Draft source</legend>
              <div class="knowledge-options">
                <button
                  type="button"
                  aria-pressed={sourceMode === 'classic'}
                  class={['option', { active: sourceMode === 'classic' }]}
                  onclick={() => selectSource('classic')}
                  ><Swords size={21} aria-hidden="true" /><span
                    ><strong>Classic</strong><small>Roll Draft</small></span
                  ></button
                >
                <button
                  type="button"
                  aria-pressed={sourceMode === 'sandbox'}
                  class={['option', { active: sourceMode === 'sandbox' }]}
                  onclick={() => selectSource('sandbox')}
                  ><Zap size={21} aria-hidden="true" /><span
                    ><strong>Sandbox</strong><small>Snake Draft</small></span
                  ></button
                >
              </div>
            </fieldset>
          {/if}
          <fieldset disabled={busy}>
            <legend class="field-label">Knowledge setting</legend>
            <div class="knowledge-options">
              <button
                type="button"
                aria-pressed={variant === 'ratings'}
                class={['option', { active: variant === 'ratings' }]}
                onclick={() => (variant = 'ratings')}
                ><ChartNoAxesColumn size={21} aria-hidden="true" /><span
                  ><strong>Ratings</strong><small>See player ratings</small></span
                ></button
              >
              <button
                type="button"
                aria-pressed={variant === 'ball-knowledge'}
                class={['option', { active: variant === 'ball-knowledge' }]}
                onclick={() => (variant = 'ball-knowledge')}
                ><Brain size={21} aria-hidden="true" /><span
                  ><strong>Ball Knowledge</strong><small>Draft from memory</small></span
                ></button
              >
            </div>
          </fieldset>
          <dl class="match-rules">
            <div>
              <dt><CalendarDays size={15} aria-hidden="true" /> Match format</dt>
              <dd>{selectedFormat.format}</dd>
            </div>
            <div>
              <dt><Clock size={15} aria-hidden="true" /> Pick timer</dt>
              <dd>
                {matchFormat === 'draft-duel'
                  ? '60s picks'
                  : mode === 'sandbox-shared-82'
                    ? '5m picks'
                    : '90s picks'}
              </dd>
            </div>
            <div>
              <dt><LockKeyhole size={15} aria-hidden="true" /> Room access</dt>
              <dd>Invite only</dd>
            </div>
          </dl>
          <button type="button" onclick={startCreate} disabled={busy} class="primary-action"
            >{busy ? 'Creating room…' : 'Create room'}<ArrowRight
              size={18}
              aria-hidden="true"
            /></button
          >
          <p class="action-note">Share your room code after creating the room.</p>
        {:else}
          <p class="eyebrow">Meet on the court</p>
          <h2 class="join-title">Join your opponent</h2>
          <p class="join-description">Enter the 4-digit code shared by your room host.</p>
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
        {#if !(matchFormat === 'draft-duel' ? isDraftDuelSupabaseConfigured() : isFixedFiveSupabaseConfigured())}<p
            class="connection-note"
          >
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
  .draft-source {
    margin-bottom: 22px;
  }
  fieldset {
    border: 0;
    padding: 0;
    min-width: 0;
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
    .mode-card:hover:not(:disabled) {
      transform: none;
    }
  }
</style>
