<script lang="ts">
  import { resolve } from '$app/paths';
  import { page } from '$app/state';
  import '$lib/collection/ultimate-theme.css';
  import { getContext, onDestroy, tick } from 'svelte';
  import type {
    CollectionActiveTeam,
    CollectionCatalog,
    CollectionCatalogCard,
    CollectionPlayState,
    CollectionState,
    HoopRushManifest,
  } from '@hoop-rush/data-contracts';
  import { getManifest } from '$lib/data';
  import AsyncState from '$lib/components/AsyncState.svelte';
  import PlayerFace from '$lib/components/PlayerFace.svelte';
  import { loadCollectionCatalog } from '$lib/collection/collection-assets.ts';
  import {
    ensureCollection,
    ensurePlayState,
    setActiveTeam,
  } from '$lib/collection/collection-hub.ts';
  import {
    STARTER_SLOT_GROUPS,
    STARTER_SLOT_LABELS,
    TEAM_MINUTES_TOTAL,
    balanceDraftMinutes,
    blockedCardIds,
    buildAutoDraft,
    checkDraft,
    draftFromTeam,
    draftRoster,
    draftToInput,
    emptyDraft,
    firstValidationMessage,
    minutesTotal,
    slotEligibility,
    type TeamDraft,
  } from '$lib/collection/collection-team-utils.ts';
  import {
    ULTIMATE_RUN_SHELL_CONTEXT,
    type UltimateRunShell,
  } from '$lib/collection/ultimate-shell.svelte';

  const shell = getContext<UltimateRunShell>(ULTIMATE_RUN_SHELL_CONTEXT);

  let mounted = true;
  onDestroy(() => {
    mounted = false;
  });

  let phase = $state<'loading' | 'error' | 'ready'>('loading');
  let error = $state<string | null>(null);
  let catalog = $state<CollectionCatalog | null>(null);
  let manifest = $state<HoopRushManifest | null>(null);
  let collectionState = $state<CollectionState | null>(null);
  let playState = $state<CollectionPlayState | null>(null);
  let draft = $state<TeamDraft>(emptyDraft());
  let target = $state<{ kind: 'starter'; index: number } | { kind: 'bench' } | null>(null);
  let search = $state('');
  let setFilter = $state('all');
  let saving = $state(false);
  let saveError = $state<string | null>(null);
  let announcement = $state('');
  let slotButtons = $state<(HTMLButtonElement | undefined)[]>([]);
  let ownedCardsSection = $state<HTMLElement | undefined>(undefined);

  const byId = $derived(
    new Map((catalog?.cards ?? []).map((card) => [card.cardId, card] as const)),
  );
  const ownedIds = $derived(collectionState?.owned.map((entry) => entry.cardId) ?? []);
  const ownedSet = $derived(new Set(ownedIds));
  const ownedCards = $derived(
    ownedIds
      .map((cardId) => byId.get(cardId))
      .filter((card): card is CollectionCatalogCard => card !== undefined),
  );
  const families = $derived([...new Set(ownedCards.map((card) => card.family))].sort());
  const resolveCard = (cardId: string): CollectionCatalogCard | undefined => byId.get(cardId);
  const check = $derived(
    catalog ? checkDraft(draft, resolveCard, ownedSet) : { ok: false, issues: [] },
  );
  const message = $derived(firstValidationMessage(check, draft));
  const total = $derived(minutesTotal(draft));
  const starterCount = $derived(draft.starters.filter(Boolean).length);
  const selectedStarterIndex = $derived(target?.kind === 'starter' ? target.index : null);
  const blocked = $derived(
    blockedCardIds(
      selectedStarterIndex !== null
        ? {
            ...draft,
            starters: draft.starters.map((cardId, index) =>
              index === selectedStarterIndex ? null : cardId,
            ),
          }
        : draft,
      resolveCard,
      ownedIds,
    ),
  );
  const committed = $derived(playState?.activeTeam ?? null);
  const matchesSavedTeam = $derived.by(() => {
    if (!committed) return false;
    const savedDraft = draftFromTeam(committed);
    return (
      draft.starters.length === savedDraft.starters.length &&
      draft.starters.every((cardId, index) => cardId === savedDraft.starters[index]) &&
      draft.bench.length === savedDraft.bench.length &&
      draft.bench.every((cardId, index) => cardId === savedDraft.bench[index]) &&
      draftRoster(draft).every(
        (cardId) => (draft.minutes[cardId] ?? 0) === (savedDraft.minutes[cardId] ?? 0),
      )
    );
  });

  const filteredOwned = $derived.by(() => {
    const query = search.trim().toLowerCase();
    const roster = new Set(draftRoster(draft));
    return ownedCards
      .filter((card) => (setFilter === 'all' ? true : card.family === setFilter))
      .filter((card) => (query ? card.displayName.toLowerCase().includes(query) : true))
      .sort((a, b) => {
        const overallA = a.summarySource?.overallRating ?? 60;
        const overallB = b.summarySource?.overallRating ?? 60;
        if (overallA !== overallB) return overallB - overallA;
        return a.cardId < b.cardId ? -1 : 1;
      })
      .map((card) => ({ card, rostered: roster.has(card.cardId) }));
  });

  const DISPLAY_SLOT_SHORT = ['PG', 'SG', 'SF', 'PF', 'C'] as const;
  const rosterIds = $derived(draftRoster(draft));
  const teamOvr = $derived.by(() => {
    if (rosterIds.length === 0) return null;
    let sum = 0;
    let count = 0;
    for (const cardId of rosterIds) {
      const card = byId.get(cardId);
      if (card) {
        sum += card.summarySource?.overallRating ?? 60;
        count += 1;
      }
    }
    return count === 0 ? null : Math.round(sum / count);
  });
  const starterMinutes = $derived(
    draft.starters.reduce((sum, cardId) => sum + (cardId ? (draft.minutes[cardId] ?? 0) : 0), 0),
  );
  const benchMinutes = $derived(
    draft.bench.reduce((sum, cardId) => sum + (draft.minutes[cardId] ?? 0), 0),
  );

  function initialsOf(name: string): string {
    return name
      .split(' ')
      .map((part) => part[0] ?? '')
      .join('')
      .slice(0, 2)
      .toUpperCase();
  }

  function overallOf(card: CollectionCatalogCard): number {
    return card.summarySource?.overallRating ?? 60;
  }

  function rarityToken(card: CollectionCatalogCard): string {
    return card.rarity.toLowerCase();
  }

  async function load(): Promise<void> {
    returnChallengeId = page.url.searchParams.get('challenge');
    try {
      const [loadedCatalog, loadedManifest, loadedState] = await Promise.all([
        loadCollectionCatalog(),
        getManifest(),
        ensureCollection(new Date().toISOString()),
      ]);
      if (!mounted) return;
      catalog = loadedCatalog;
      manifest = loadedManifest;
      collectionState = loadedState;
      if (loadedState.claimedWelcome) {
        const play = await ensurePlayState(new Date().toISOString());
        if (!mounted) return;
        playState = play;
        draft = draftFromTeam(play.activeTeam);
      }
      phase = 'ready';
    } catch (loadError) {
      if (!mounted) return;
      error = loadError instanceof Error ? loadError.message : 'Could not load the team.';
      phase = 'error';
    }
  }

  $effect(() => {
    void load();
  });

  $effect(() => {
    if (collectionState && catalog) shell.sync(collectionState, catalog.cards.length);
  });

  function selectStarterSlot(index: number): void {
    target = { kind: 'starter', index };
    focusOwnedCardPicker();
  }

  function selectBench(): void {
    target = { kind: 'bench' };
    focusOwnedCardPicker();
  }

  function editLineup(): void {
    const empty = draft.starters.findIndex((slot) => slot === null);
    if (empty >= 0) selectStarterSlot(empty);
    else {
      target = null;
      focusOwnedCardPicker();
    }
  }

  function focusOwnedCardPicker(): void {
    if (typeof window === 'undefined' || !window.matchMedia('(max-width: 767px)').matches) return;
    void tick().then(() => {
      if (!mounted || !ownedCardsSection) return;
      const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      ownedCardsSection.scrollIntoView({
        behavior: reducedMotion ? 'auto' : 'smooth',
        block: 'start',
      });
      const firstAvailable = ownedCardsSection.querySelector<HTMLButtonElement>(
        'button[data-owned-card]:not(:disabled)',
      );
      if (firstAvailable) firstAvailable.focus();
      else ownedCardsSection.querySelector<HTMLInputElement>('input[type="search"]')?.focus();
    });
  }

  function assignmentReason(card: CollectionCatalogCard): string | undefined {
    const existingReason = blocked.get(card.cardId);
    if (existingReason) return existingReason;
    if (target?.kind === 'starter' && !slotEligibility(card.positions, target.index)) {
      return `Does not meet the ${STARTER_SLOT_LABELS[target.index]} starter position requirement.`;
    }
    return undefined;
  }

  function removeFromRoster(cardId: string): void {
    draft = {
      starters: draft.starters.map((slot) => (slot === cardId ? null : slot)),
      bench: draft.bench.filter((entry) => entry !== cardId),
      minutes: Object.fromEntries(Object.entries(draft.minutes).filter(([key]) => key !== cardId)),
    };
    saveError = null;
  }

  function assignCard(cardId: string): void {
    if (blocked.has(cardId)) return;
    const current = target;
    if (current === null) {
      if (draft.bench.length + draft.starters.filter((slot) => slot !== null).length >= 12) return;
      if (!draft.bench.includes(cardId) && !draft.starters.includes(cardId)) {
        draft = {
          ...draft,
          bench: [...draft.bench, cardId],
          minutes: { ...draft.minutes, [cardId]: draft.minutes[cardId] ?? 0 },
        };
      }
      saveError = null;
      return;
    }
    if (current.kind === 'bench') {
      removeFromRosterSilent(cardId);
      if (draft.bench.length >= 7) {
        target = null;
        return;
      }
      draft = {
        ...draft,
        bench: [...draft.bench, cardId],
        minutes: { ...draft.minutes, [cardId]: draft.minutes[cardId] ?? 0 },
      };
    } else {
      const slotIndex = current.index;
      removeFromRosterSilent(cardId);
      draft = {
        ...draft,
        starters: draft.starters.map((slot, index) => (index === slotIndex ? cardId : slot)),
        minutes: { ...draft.minutes, [cardId]: draft.minutes[cardId] ?? 0 },
      };
    }
    target = null;
    saveError = null;
    if (current?.kind === 'starter') {
      void tick().then(() => {
        if (mounted) slotButtons[current.index]?.focus();
      });
    }
  }

  function removeFromRosterSilent(cardId: string): void {
    draft = {
      starters: draft.starters.map((slot) => (slot === cardId ? null : slot)),
      bench: draft.bench.filter((entry) => entry !== cardId),
      minutes: draft.minutes,
    };
  }

  function autoBuild(): void {
    if (!catalog) return;
    try {
      draft = buildAutoDraft(ownedIds, resolveCard);
      target = null;
      saveError = null;
    } catch (buildError) {
      saveError = buildError instanceof Error ? buildError.message : 'Auto build failed.';
    }
  }

  function balanceMinutes(): void {
    draft = balanceDraftMinutes(draft);
    saveError = null;
  }

  function resetMinutes(): void {
    const roster = draftRoster(draft);
    draft = { ...draft, minutes: Object.fromEntries(roster.map((cardId) => [cardId, 0])) };
    saveError = null;
  }

  function setMinutes(cardId: string, value: number): void {
    const minutes = Number.isInteger(value) ? Math.min(48, Math.max(0, value)) : 0;
    draft = { ...draft, minutes: { ...draft.minutes, [cardId]: minutes } };
  }

  function adjustMinutes(cardId: string, delta: number): void {
    setMinutes(cardId, (draft.minutes[cardId] ?? 0) + delta);
  }

  async function save(): Promise<void> {
    if (saving || !check.ok) return;
    saving = true;
    saveError = null;
    try {
      const input = draftToInput(draft);
      const team: CollectionActiveTeam = {
        teamVersion: 'collection-team-v1',
        starters: input.starters as [string, string, string, string, string],
        bench: input.bench,
        targetMinutes: input.targetMinutes,
      };
      const saved = await setActiveTeam(team, new Date().toISOString());
      if (!mounted) return;
      playState = saved;
      draft = draftFromTeam(saved.activeTeam);
      announcement = `Team saved. Revision ${String(saved.revision)}. Play is ready.`;
    } catch (saveFailure) {
      if (!mounted) return;
      saveError = saveFailure instanceof Error ? saveFailure.message : 'Saving failed. Try again.';
    } finally {
      if (mounted) saving = false;
    }
  }

  const claimed = $derived(collectionState?.claimedWelcome ?? false);
  let returnChallengeId = $state<string | null>(null);
</script>

<div class="team-page">
  <div class="team-hero">
    <div class="team-hero-copy">
      <p class="team-eyebrow">Ultimate Run · Pre-game</p>
      <h2>Build your starting five</h2>
      <p class="team-sub">
        Place your collection on the heat-check, then set the rotation for all 240 minutes.
      </p>
    </div>
    {#if phase === 'ready' && claimed}
      <div class="team-status">
        {#if message}
          <p role="status" class="status-banner status-warn">{message}</p>
        {:else}
          <p role="status" class="status-banner status-ok">
            <span aria-hidden="true" class="status-dot">✓</span>
            {committed
              ? matchesSavedTeam
                ? 'Team is valid and saved. Play is ready.'
                : 'Team is valid. Save to update Play.'
              : 'Team is valid. Save to unlock Play.'}
          </p>
        {/if}
        <div class="stat-duo" aria-label="Team overview">
          <span class="stat-box stat-gold"
            ><strong>{teamOvr ?? '—'}</strong><small>OVR Team</small></span
          >
          <span class="stat-box"><strong>{rosterIds.length}/12</strong><small>Cards</small></span>
          <span class="stat-box"><strong>{starterCount}/5</strong><small>Starters</small></span>
          <span class="stat-box"
            ><strong>{total}/{TEAM_MINUTES_TOTAL}</strong><small>Minutes</small></span
          >
        </div>
      </div>
    {/if}
  </div>

  <p class="sr-only" role="status">{announcement}</p>

  {#if returnChallengeId}
    <div class="challenge-return">
      <p>
        Editing your team for challenge
        <code>{returnChallengeId}</code>. Save the team, then return to Play.
      </p>
      <a
        href={resolve(`/ultimate/run/play?challenge=${returnChallengeId}` as any)}
        class="btn-ghost"
      >
        Back to challenges
      </a>
    </div>
  {/if}

  {#if phase === 'loading'}
    <div class="mt-6">
      <AsyncState kind="loading" title="Loading" message="Loading your team…" />
    </div>
  {:else if phase === 'error'}
    <div class="mt-6">
      <AsyncState
        kind="error"
        title="Couldn't load"
        message={error ?? 'Unknown error.'}
        retry={() => {
          phase = 'loading';
          void load();
        }}
      />
    </div>
  {:else if !claimed}
    <div class="mt-6">
      <AsyncState
        kind="empty"
        title="Starter first"
        message="Claim the free starter in the collection book before building a team."
      />
    </div>
    <a
      href={resolve('/ultimate/run/collection' as any)}
      class="mt-3 inline-block min-h-[44px] rounded-xl bg-accent px-5 py-2.5 font-bold text-accent-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      Go to collection
    </a>
  {:else}
    {#if saveError}
      <p role="alert" class="save-error">{saveError}</p>
    {/if}

    <div class="team-layout">
      <div class="team-main">
        <section aria-label="Lineup board" class="panel panel-court">
          <div class="panel-head">
            <div>
              <p class="kicker">Your lineup</p>
              <h2>Starting five</h2>
            </div>
            <button type="button" onclick={editLineup} class="btn-ghost btn-edit">
              <span aria-hidden="true">✎</span> Edit lineup
            </button>
          </div>

          <div class="court" role="group" aria-label="Half-court starting lineup">
            <span class="court-watermark" aria-hidden="true">UR</span>
            <ol
              class="court-slots"
              aria-label="Starting slots: Guard, Guard, Forward, Forward, Center"
            >
              {#each draft.starters as slot, index (index)}
                {@const card = slot ? (byId.get(slot) ?? null) : null}
                <li class={`court-slot court-slot-${index}`}>
                  <button
                    type="button"
                    onclick={() => selectStarterSlot(index)}
                    aria-pressed={target !== null &&
                      target.kind === 'starter' &&
                      target.index === index}
                    bind:this={slotButtons[index]}
                    aria-label={card
                      ? `${STARTER_SLOT_LABELS[index]} starter: ${card.displayName}. Select to replace.`
                      : `Empty ${STARTER_SLOT_LABELS[index]} starter slot. Select, then pick a card.`}
                    class="slot-card"
                    data-rarity={card ? rarityToken(card) : 'empty'}
                    data-active={target?.kind === 'starter' && target.index === index}
                  >
                    <span class="slot-top">
                      <span class="slot-pos"
                        >{DISPLAY_SLOT_SHORT[index] ?? STARTER_SLOT_GROUPS[index]}</span
                      >
                      <span class="slot-ovr">{card ? overallOf(card) : ''}</span>
                    </span>
                    <span class="slot-face">
                      {#if card && manifest}
                        <PlayerFace
                          player={{
                            playerId: card.playerId,
                            playerExternalId: card.playerExternalId,
                            altIds: null,
                          }}
                          {manifest}
                          size="court"
                          fallbackInitials={initialsOf(card.displayName)}
                        />
                      {:else}
                        <span class="slot-silhouette" aria-hidden="true">
                          {card ? initialsOf(card.displayName) : '+'}
                        </span>
                      {/if}
                    </span>
                    <span class="slot-nameplate">
                      <strong>{card ? card.displayName : 'Open slot'}</strong>
                      <span>{card ? card.family : STARTER_SLOT_LABELS[index]}</span>
                    </span>
                  </button>
                </li>
              {/each}
            </ol>
          </div>
        </section>

        <section aria-label="Rotation" class="panel panel-rotation">
          <div class="panel-head">
            <h2 class="bench-title">Rotation</h2>
            <span class="bench-count"
              >{draft.bench.length}/7 bench · {total}/{TEAM_MINUTES_TOTAL} min</span
            >
          </div>
          <ol class="rotation-strip">
            {#each draft.bench.slice(0, 5) as cardId (cardId)}
              {@const card = byId.get(cardId)}
              <li>
                <span class="rotation-face">
                  {#if card && manifest}
                    <PlayerFace
                      player={{
                        playerId: card.playerId,
                        playerExternalId: card.playerExternalId,
                        altIds: null,
                      }}
                      {manifest}
                      size="sm"
                      fallbackInitials={initialsOf(card.displayName)}
                    />
                  {:else}
                    <span class="avatar-fallback" aria-hidden="true">?</span>
                  {/if}
                </span>
                <strong>{card?.displayName ?? cardId}</strong>
                <small class="tabular-nums">{draft.minutes[cardId] ?? 0} min</small>
              </li>
            {:else}
              <li class="rotation-empty">Bench is open.</li>
            {/each}
            <li>
              <button
                type="button"
                onclick={selectBench}
                disabled={draft.bench.length >= 7}
                class="rotation-add"
                aria-label="Add player to bench"
              >
                <span aria-hidden="true">+</span>
                <small>Add player</small>
              </button>
            </li>
          </ol>
        </section>

        <section aria-label="Bench players" class="panel">
          <div class="panel-head">
            <h2 class="bench-title">Bench</h2>
            <div class="bench-meta">
              <span class="bench-count">{draft.bench.length}/7 players</span>
              <button
                type="button"
                onclick={selectBench}
                disabled={draft.bench.length >= 7}
                aria-pressed={target !== null && target.kind === 'bench'}
                class="btn-ghost"
              >
                {target !== null && target.kind === 'bench' ? 'Choose below' : 'Add player +'}
              </button>
            </div>
          </div>
          <ul class="bench-grid">
            {#each draft.bench as cardId (cardId)}
              {@const card = byId.get(cardId)}
              <li class="bench-row">
                <span class="bench-avatar">
                  {#if card && manifest}
                    <PlayerFace
                      player={{
                        playerId: card.playerId,
                        playerExternalId: card.playerExternalId,
                        altIds: null,
                      }}
                      {manifest}
                      size="sm"
                      fallbackInitials={initialsOf(card?.displayName ?? cardId)}
                    />
                  {:else}
                    <span class="avatar-fallback" aria-hidden="true">?</span>
                  {/if}
                </span>
                <span class="bench-copy">
                  <strong>{card?.displayName ?? cardId}</strong>
                  <span class="bench-tags">
                    <span class="pos-badge">{card?.positions[0] ?? '—'}</span>
                    <span class="ovr-text">OVR {card ? overallOf(card) : '—'}</span>
                    {#if card}<span class="set-badge" data-rarity={rarityToken(card)}
                        >{card.rarity}</span
                      >{/if}
                  </span>
                </span>
                <button
                  type="button"
                  onclick={() => removeFromRoster(cardId)}
                  aria-label={`Remove ${card?.displayName ?? cardId} from the team`}
                  class="bench-remove"
                >
                  <span aria-hidden="true">×</span>
                </button>
              </li>
            {:else}
              <li class="bench-empty">Your bench is open. Add up to seven cards.</li>
            {/each}
          </ul>
        </section>

        <section aria-label="Rotation plan" class="panel">
          <div class="panel-head">
            <div>
              <h2 class="bench-title">Rotation Plan</h2>
              <p class="kicker">Team minutes · Starters {starterMinutes} · Bench {benchMinutes}</p>
            </div>
            <div class="minutes-head-actions">
              <strong class="minutes-score">{total}<span>/{TEAM_MINUTES_TOTAL}</span></strong>
              <button type="button" onclick={balanceMinutes} class="btn-ghost btn-auto">
                Auto-balance minutes
              </button>
            </div>
          </div>
          <div class="minute-track minute-track--split" aria-hidden="true">
            <span
              class="minute-starters"
              style={`width: ${Math.max(0, Math.min((starterMinutes / TEAM_MINUTES_TOTAL) * 100, 100))}%`}
            ></span>
            <span
              class="minute-bench"
              style={`width: ${Math.max(0, Math.min((benchMinutes / TEAM_MINUTES_TOTAL) * 100, 100 - Math.max(0, Math.min((starterMinutes / TEAM_MINUTES_TOTAL) * 100, 100))))}%`}
            ></span>
          </div>
          <p class="minute-guidance">
            {total === TEAM_MINUTES_TOTAL
              ? 'Exact total reached.'
              : `${Math.abs(TEAM_MINUTES_TOTAL - total)} minute${Math.abs(TEAM_MINUTES_TOTAL - total) === 1 ? '' : 's'} ${total < TEAM_MINUTES_TOTAL ? 'remaining' : 'over'} to reach 240.`}
          </p>
          <ul class="minutes-list">
            {#each draftRoster(draft) as cardId (cardId)}
              {@const card = byId.get(cardId)}
              <li class="minutes-row">
                <span class="bench-avatar">
                  {#if card && manifest}
                    <PlayerFace
                      player={{
                        playerId: card.playerId,
                        playerExternalId: card.playerExternalId,
                        altIds: null,
                      }}
                      {manifest}
                      size="sm"
                      fallbackInitials={initialsOf(card.displayName)}
                    />
                  {/if}
                </span>
                <label for={`minutes-${cardId}`} class="minutes-label">
                  <strong>{card?.displayName ?? cardId}</strong>
                  <span>
                    {#if card}<span class="pos-badge">{card.positions[0]}</span>{/if}
                    {card ? `${card.rarity} · OVR ${overallOf(card)}` : 'Team card'}
                  </span>
                </label>
                <div class="stepper">
                  <button
                    type="button"
                    onclick={() => adjustMinutes(cardId, -1)}
                    disabled={(draft.minutes[cardId] ?? 0) <= 0}
                    aria-label={`Decrease ${card?.displayName ?? cardId} minutes`}>−</button
                  >
                  <input
                    id={`minutes-${cardId}`}
                    type="number"
                    min="0"
                    max="48"
                    value={draft.minutes[cardId] ?? 0}
                    onchange={(event) => setMinutes(cardId, event.currentTarget.valueAsNumber)}
                    aria-label={`${card?.displayName ?? cardId} target minutes`}
                  />
                  <button
                    type="button"
                    onclick={() => adjustMinutes(cardId, 1)}
                    disabled={(draft.minutes[cardId] ?? 0) >= 48}
                    aria-label={`Increase ${card?.displayName ?? cardId} minutes`}>+</button
                  >
                </div>
              </li>
            {/each}
          </ul>
          <div class="team-actions">
            <button type="button" onclick={autoBuild} class="btn-ghost">⚗ Auto build</button>
            <button type="button" onclick={balanceMinutes} class="btn-ghost"
              >⚖ Balance minutes</button
            >
            <button type="button" onclick={save} disabled={!check.ok || saving} class="btn-gold">
              {saving ? 'Saving…' : committed ? 'Save changes' : 'Save team'}
            </button>
          </div>
          <p class="save-note" role="status">
            {message ??
              (committed
                ? matchesSavedTeam
                  ? 'Saved team is ready to play.'
                  : 'Changes are ready to save.'
                : 'Save this lineup to unlock Play.')}
            <button type="button" onclick={resetMinutes} class="link-button">Reset minutes</button>
          </p>
          {#if committed}
            <p class="saved-line">
              Saved revision {playState?.revision ?? 0}.
              <a href={resolve('/ultimate/run/play' as any)}>Go to Play</a>
            </p>
          {/if}
        </section>
      </div>

      <aside
        aria-label="Owned cards"
        class="panel panel-owned"
        bind:this={ownedCardsSection}
        tabindex="-1"
      >
        <div class="panel-head">
          <div>
            <h2>Collection</h2>
            <p class="kicker">Choose a player</p>
          </div>
          <span class="owned-badge">{ownedCards.length} owned</span>
        </div>
        <div class="owned-filters">
          <input
            type="search"
            placeholder="Search your collection…"
            aria-label="Search owned cards"
            value={search}
            oninput={(event) => {
              search = event.currentTarget.value;
            }}
            class="owned-search"
          />
          <select
            aria-label="Filter by set"
            value={setFilter}
            onchange={(event) => {
              setFilter = event.currentTarget.value;
            }}
            class="owned-select"
          >
            <option value="all">All sets</option>
            {#each families as family (family)}
              <option value={family}>{family}</option>
            {/each}
          </select>
        </div>
        {#if target !== null}
          <p class="picker-hint" role="status">
            {target.kind === 'bench'
              ? 'Pick a card for the bench.'
              : `Pick a ${STARTER_SLOT_LABELS[target.index]} starter.`}
          </p>
        {/if}
        <ul class="owned-list">
          {#each filteredOwned as { card, rostered } (card.cardId)}
            {@const reason = assignmentReason(card)}
            <li class="owned-row">
              <span class="bench-avatar">
                {#if manifest}
                  <PlayerFace
                    player={{
                      playerId: card.playerId,
                      playerExternalId: card.playerExternalId,
                      altIds: null,
                    }}
                    {manifest}
                    size="sm"
                    fallbackInitials={initialsOf(card.displayName)}
                  />
                {/if}
              </span>
              <span class="owned-copy">
                <strong>{card.displayName}</strong>
                <span class="bench-tags">
                  <span class="ovr-big">{overallOf(card)}</span>
                  <span class="pos-badge">{card.positions[0]}</span>
                  <span class="set-badge" data-rarity={rarityToken(card)}>{card.rarity}</span>
                  {#if rostered}<span class="on-team">On team</span>{/if}
                </span>
                {#if reason && !rostered}
                  <span class="owned-reason">{reason}</span>
                {/if}
              </span>
              <span class="owned-minutes tabular-nums">{draft.minutes[card.cardId] ?? 0} min</span>
              <button
                type="button"
                onclick={() => assignCard(card.cardId)}
                disabled={reason !== undefined}
                title={reason ?? ''}
                data-owned-card
                aria-label={`${card.displayName}, ${card.seasonKey}, ${card.rarity}, overall ${overallOf(card)}${reason ? `. ${reason}` : ''}`}
                class="owned-add"
              >
                <span aria-hidden="true">+</span>
              </button>
            </li>
          {:else}
            <li class="owned-empty">No owned cards match.</li>
          {/each}
        </ul>
        <p class="eligibility-note">
          Starter slots: {STARTER_SLOT_LABELS.map(
            (label, index) =>
              `${label} takes ${['guards', 'guards', 'forwards', 'forwards', 'centers'][index]}`,
          ).join(' · ')}.
        </p>
      </aside>
    </div>
  {/if}
</div>

<style>
  .team-page {
    position: relative;
    color: var(--ur-paper);
  }

  .team-page::before {
    content: '';
    position: fixed;
    inset: 0;
    z-index: -1;
    pointer-events: none;
    background:
      radial-gradient(ellipse 60% 22% at 50% 0%, rgb(255 197 61 / 14%), transparent 70%),
      radial-gradient(ellipse 45% 30% at 12% 100%, rgb(255 90 42 / 8%), transparent 70%),
      radial-gradient(ellipse 45% 30% at 88% 100%, rgb(139 92 246 / 9%), transparent 70%);
  }

  .team-hero {
    display: flex;
    flex-wrap: wrap;
    align-items: flex-end;
    justify-content: space-between;
    gap: 1rem 1.5rem;
    margin-bottom: 1.1rem;
  }

  .team-eyebrow {
    margin: 0 0 0.35rem;
    color: var(--ur-apex);
    font-family: var(--font-display);
    font-size: 0.72rem;
    font-weight: 800;
    letter-spacing: 0.18em;
    text-transform: uppercase;
  }

  .team-hero-copy h2 {
    margin: 0;
    color: #fff;
    font-family: var(--font-display);
    font-size: clamp(2.2rem, 5vw, 3.4rem);
    font-weight: 900;
    font-stretch: condensed;
    letter-spacing: -0.02em;
    line-height: 0.95;
    text-transform: none;
    text-shadow: 0 2px 18px rgb(0 0 0 / 60%);
  }

  .team-sub {
    margin: 0.55rem 0 0;
    max-width: 52ch;
    color: var(--ur-muted);
    font-size: 0.92rem;
  }

  .team-status {
    display: grid;
    gap: 0.6rem;
    min-width: min(24rem, 100%);
    max-width: 26rem;
  }

  .status-banner {
    margin: 0;
    padding: 0.65rem 0.85rem;
    border: 1px solid var(--ur-line-strong);
    border-radius: 0.5rem;
    border-left: 3px solid var(--ur-warning);
    background: color-mix(in srgb, var(--ur-warning) 9%, var(--ur-raised));
    font-size: 0.82rem;
  }

  .status-ok {
    border: 1px solid color-mix(in srgb, var(--ur-success) 55%, transparent);
    border-radius: 0.5rem;
    background: linear-gradient(180deg, #123324, #0d281d);
    color: #c9f0d8;
    font-weight: 700;
  }

  .status-dot {
    display: inline-grid;
    width: 1.3rem;
    height: 1.3rem;
    place-items: center;
    margin-right: 0.45rem;
    border-radius: 50%;
    background: var(--ur-success);
    color: #06110b;
    font-size: 0.8rem;
    font-weight: 900;
  }

  .stat-duo {
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: 0.6rem;
  }

  .stat-box {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.15rem;
    padding: 0.6rem 0.55rem;
    border: 1px solid color-mix(in srgb, var(--ur-apex) 45%, var(--ur-line-strong));
    border-radius: 0.5rem;
    background: linear-gradient(180deg, #141d22, #0b1114);
    box-shadow: inset 0 1px 0 rgb(255 197 61 / 8%);
  }

  .stat-box strong {
    color: #fff;
    font-family: var(--font-display);
    font-size: 1.25rem;
    font-variant-numeric: tabular-nums;
  }

  .stat-box small {
    color: var(--ur-muted);
    font-size: 0.68rem;
  }

  .stat-gold strong {
    color: var(--ur-apex);
  }

  .challenge-return {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: 0.8rem;
    margin: 1rem 0;
    padding: 0.8rem 1rem;
    border: 1px solid var(--ur-line-strong);
    border-left: 3px solid var(--ur-apex);
    background: var(--ur-raised);
    font-size: 0.85rem;
  }

  .challenge-return p {
    margin: 0;
    color: var(--ur-muted);
  }

  .challenge-return code {
    color: var(--ur-paper);
  }

  .save-error {
    margin: 0.65rem 0 0;
    color: var(--ur-danger);
    font-size: 0.88rem;
  }

  .team-layout {
    display: grid;
    gap: 1rem;
    margin-top: 1rem;
    align-items: start;
  }

  .team-main {
    display: grid;
    gap: 1rem;
    min-width: 0;
  }

  .panel {
    padding: clamp(0.85rem, 2.2vw, 1.25rem);
    border: 1px solid color-mix(in srgb, var(--ur-apex) 35%, var(--ur-line-strong));
    border-radius: 12px;
    background:
      linear-gradient(180deg, rgb(255 197 61 / 5%), transparent 22%),
      linear-gradient(165deg, #131c22, #0b1114 75%);
    box-shadow:
      0 0 0 1px rgb(0 0 0 / 40%),
      0 0 2rem rgb(255 197 61 / 6%),
      0 1.2rem 2.5rem rgb(0 0 0 / 35%);
  }

  .panel-head {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: 0.7rem;
    margin-bottom: 0.8rem;
  }

  .panel-head h2 {
    margin: 0;
    color: #fff;
    font-family: var(--font-display);
    font-size: clamp(1.3rem, 2.4vw, 1.65rem);
    font-weight: 850;
    font-stretch: condensed;
    letter-spacing: -0.01em;
  }

  .kicker {
    margin: 0.15rem 0 0;
    color: var(--ur-muted);
    font-size: 0.66rem;
    font-weight: 800;
    letter-spacing: 0.14em;
    text-transform: uppercase;
  }

  .bench-title {
    font-size: clamp(1.2rem, 2.2vw, 1.5rem) !important;
  }

  .btn-ghost {
    display: inline-flex;
    min-height: 2.5rem;
    align-items: center;
    gap: 0.4rem;
    padding: 0.5rem 0.85rem;
    border: 1px solid color-mix(in srgb, var(--ur-apex) 55%, var(--ur-line-strong));
    border-radius: 0.55rem;
    background: rgb(255 197 61 / 4%);
    color: var(--ur-apex);
    font-size: 0.76rem;
    font-weight: 800;
    cursor: pointer;
    touch-action: manipulation;
  }

  .btn-ghost:hover:not(:disabled) {
    border-color: var(--ur-apex);
    background: rgb(255 197 61 / 10%);
  }

  .btn-ghost:disabled {
    opacity: 0.45;
    cursor: not-allowed;
  }

  .btn-ghost[aria-pressed='true'] {
    border-color: var(--ur-apex);
    color: var(--ur-apex);
  }

  .btn-gold {
    min-height: 2.75rem;
    padding: 0.65rem 1rem;
    border: 1px solid #ffd97a;
    border-radius: 0.55rem;
    background: linear-gradient(180deg, #ffda73 0%, var(--ur-apex) 55%, #e9a91f 100%);
    box-shadow:
      0 0 1.2rem rgb(255 197 61 / 25%),
      inset 0 1px 0 rgb(255 255 255 / 45%);
    color: #241a02;
    font-size: 0.82rem;
    font-weight: 900;
    cursor: pointer;
  }

  .btn-gold:disabled {
    opacity: 0.45;
    cursor: not-allowed;
  }

  .court {
    position: relative;
    overflow: hidden;
    border: 1px solid color-mix(in srgb, var(--ur-apex) 30%, var(--ur-line));
    border-radius: 0.7rem;
    background:
      radial-gradient(
        ellipse 70% 28% at 50% -6%,
        rgb(255 240 200 / 32%),
        rgb(255 240 200 / 8%) 45%,
        transparent 70%
      ),
      repeating-linear-gradient(90deg, rgb(0 0 0 / 7%) 0 2px, transparent 2px 72px),
      repeating-linear-gradient(0deg, rgb(255 255 255 / 2.5%) 0 1px, transparent 1px 26px),
      radial-gradient(
        ellipse 34% 24% at 50% 108%,
        transparent 62%,
        rgb(255 255 255 / 30%) 63% 64.5%,
        transparent 66%
      ),
      radial-gradient(
        circle 4.2rem at 50% 52%,
        transparent 62%,
        rgb(255 255 255 / 26%) 63% 64.5%,
        transparent 66%
      ),
      linear-gradient(
        90deg,
        transparent calc(50% - 1px),
        rgb(255 255 255 / 26%) 50%,
        transparent calc(50% + 1px)
      ),
      linear-gradient(180deg, #8a5a2e 0%, #6e4525 38%, #4a2d17 100%);
  }

  .court::before {
    content: '';
    position: absolute;
    inset: 0 0 auto 0;
    height: 42%;
    background: linear-gradient(180deg, rgb(255 244 210 / 16%), transparent 75%);
    pointer-events: none;
  }

  .court::after {
    content: '';
    position: absolute;
    inset: 10% 14% auto;
    height: 38%;
    border: 1px solid rgb(255 255 255 / 24%);
    border-top: 0;
    border-radius: 0 0 999px 999px;
    pointer-events: none;
  }

  .court-watermark {
    position: absolute;
    inset: 0;
    display: grid;
    place-items: center;
    text-align: center;
    font-family: var(--font-display);
    font-size: clamp(3rem, 8vw, 5rem);
    font-weight: 900;
    letter-spacing: -0.05em;
    color: rgb(255 255 255 / 10%);
    text-shadow: 0 2px 24px rgb(0 0 0 / 25%);
    pointer-events: none;
  }

  .court-slots {
    position: relative;
    z-index: 1;
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    grid-template-rows: repeat(3, minmax(0, auto));
    column-gap: 0.6rem;
    row-gap: 0.85rem;
    align-items: start;
    justify-items: center;
    margin: 0;
    padding: 1rem 0.9rem 1.1rem;
    list-style: none;
  }

  .court-slot {
    display: flex;
    width: 100%;
    min-width: 0;
    justify-content: center;
  }

  .court-slot-4 {
    grid-area: 1 / 2;
  }
  .court-slot-2 {
    grid-area: 2 / 1;
  }
  .court-slot-3 {
    grid-area: 2 / 3;
  }
  .court-slot-0 {
    grid-area: 3 / 1;
  }
  .court-slot-1 {
    grid-area: 3 / 3;
  }

  .slot-card {
    display: flex;
    position: relative;
    width: min(100%, 10.5rem);
    margin-inline: auto;
    flex-direction: column;
    overflow: hidden;
    border: 2px solid var(--slot-glow, var(--ur-line-strong));
    border-radius: 0.65rem;
    background: linear-gradient(180deg, #1c262c, #0a0f12 78%);
    color: var(--ur-paper);
    cursor: pointer;
    box-shadow:
      0 0 1rem color-mix(in srgb, var(--slot-glow, var(--ur-apex)) 38%, transparent),
      0 0.8rem 1.6rem rgb(0 0 0 / 45%);
    transition:
      transform 140ms ease,
      box-shadow 140ms ease;
  }

  .slot-card:hover {
    transform: translateY(-2px);
  }

  .slot-card[data-active='true'] {
    outline: 2px solid var(--ur-apex);
    outline-offset: 2px;
  }

  .slot-card[data-rarity='apex'] {
    --slot-glow: var(--ur-apex);
  }
  .slot-card[data-rarity='eclipse'] {
    --slot-glow: var(--ur-eclipse);
  }
  .slot-card[data-rarity='eruption'] {
    --slot-glow: var(--ur-eruption);
  }
  .slot-card[data-rarity='ember'] {
    --slot-glow: var(--ur-ember);
  }
  .slot-card[data-rarity='titan'] {
    --slot-glow: var(--ur-titan);
  }
  .slot-card[data-rarity='immortal'] {
    --slot-glow: var(--ur-immortal);
  }
  .slot-card[data-rarity='empty'] {
    --slot-glow: var(--ur-line-strong);
    border-style: dashed;
    box-shadow: none;
  }

  .slot-top {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0.3rem 0.4rem;
  }

  .slot-pos {
    display: grid;
    min-width: 1.4rem;
    min-height: 1.4rem;
    place-items: center;
    padding-inline: 0.25rem;
    border-radius: 0.25rem;
    background: var(--slot-glow, var(--ur-line-strong));
    color: #0a0e11;
    font-size: 0.68rem;
    font-weight: 900;
  }

  .slot-card[data-rarity='empty'] .slot-pos {
    background: transparent;
    border: 1px solid var(--ur-line-strong);
    color: var(--ur-muted);
  }

  .slot-ovr {
    color: #fff;
    font-family: var(--font-display);
    font-size: 1.15rem;
    font-weight: 900;
    text-shadow:
      0 0 10px rgb(255 255 255 / 35%),
      0 2px 6px rgb(0 0 0 / 80%);
    font-variant-numeric: tabular-nums;
  }

  .slot-face {
    display: block;
    aspect-ratio: 1 / 1;
    min-height: 6.5rem;
    overflow: hidden;
    background: linear-gradient(180deg, #232e35, #0d1317);
  }

  .slot-face :global(.relative) {
    width: 100% !important;
    height: 100% !important;
    min-height: 100% !important;
    border: 0 !important;
    border-radius: 0 !important;
    background: transparent !important;
  }

  .slot-face :global(img) {
    width: 100% !important;
    height: 100% !important;
    object-fit: cover !important;
    object-position: 50% 20% !important;
    transform: none !important;
  }

  .slot-silhouette {
    display: grid;
    height: 100%;
    min-height: 6.5rem;
    place-items: center;
    background: radial-gradient(ellipse at 50% 30%, rgb(240 236 223 / 14%), transparent 65%);
    color: rgb(240 236 223 / 70%);
    font-family: var(--font-display);
    font-size: 1.8rem;
    font-weight: 900;
  }

  .slot-nameplate {
    display: block;
    position: relative;
    padding: 0.4rem 0.45rem 0.5rem;
    border-top: 1px solid color-mix(in srgb, var(--slot-glow, var(--ur-line)) 55%, transparent);
    background: rgb(6 9 11 / 92%);
    text-align: center;
  }

  .slot-nameplate strong {
    display: block;
    overflow: hidden;
    color: #fff;
    font-family: var(--font-display);
    font-size: 0.72rem;
    font-weight: 800;
    font-stretch: condensed;
    letter-spacing: 0.01em;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .slot-nameplate span {
    display: block;
    margin-top: 0.12rem;
    color: var(--slot-glow, var(--ur-muted));
    font-size: 0.6rem;
    font-weight: 700;
  }

  .slot-nameplate span::after {
    content: ' · UR';
    color: color-mix(in srgb, var(--slot-glow, var(--ur-muted)) 70%, #fff);
    font-size: 0.55rem;
    font-weight: 900;
    letter-spacing: 0.08em;
  }

  .slot-card[data-rarity='empty'] .slot-nameplate span::after {
    content: '';
  }

  .bench-meta {
    display: flex;
    align-items: center;
    gap: 0.6rem;
  }

  .bench-count {
    color: var(--ur-muted);
    font-size: 0.74rem;
    font-variant-numeric: tabular-nums;
  }

  .bench-grid {
    display: grid;
    gap: 0.5rem;
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .bench-row,
  .owned-row,
  .minutes-row {
    display: flex;
    align-items: center;
    gap: 0.6rem;
    padding: 0.45rem 0.5rem;
    border: 1px solid color-mix(in srgb, var(--ur-apex) 14%, var(--ur-line));
    border-radius: 0.6rem;
    background: linear-gradient(180deg, #141d22, #0d1418);
  }

  .bench-avatar {
    flex: 0 0 auto;
    overflow: hidden;
    border-radius: 0.5rem;
  }

  .bench-avatar :global(img) {
    border-radius: 0.5rem !important;
  }

  .avatar-fallback {
    display: grid;
    width: 2.25rem;
    height: 2.25rem;
    place-items: center;
    border-radius: 0.5rem;
    background: var(--ur-interrupt);
    font-weight: 900;
  }

  .bench-copy,
  .owned-copy,
  .minutes-label {
    min-width: 0;
    flex: 1;
  }

  .bench-copy strong,
  .owned-copy strong,
  .minutes-label strong {
    display: block;
    overflow: hidden;
    color: #fff;
    font-size: 0.8rem;
    font-weight: 800;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .bench-tags {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.3rem;
    margin-top: 0.2rem;
  }

  .pos-badge {
    display: inline-grid;
    min-width: 1.5rem;
    min-height: 1.15rem;
    place-items: center;
    padding-inline: 0.3rem;
    border: 1px solid color-mix(in srgb, var(--ur-apex) 60%, transparent);
    border-radius: 0.3rem;
    color: var(--ur-apex);
    font-size: 0.6rem;
    font-weight: 900;
  }

  .ovr-text {
    color: var(--ur-muted);
    font-size: 0.66rem;
    font-variant-numeric: tabular-nums;
  }

  .set-badge {
    padding: 0.12rem 0.35rem;
    border: 1px solid currentColor;
    border-radius: 0.3rem;
    font-size: 0.6rem;
    font-weight: 800;
  }

  .set-badge[data-rarity='apex'] {
    color: var(--ur-apex);
    background: rgb(255 197 61 / 10%);
  }
  .set-badge[data-rarity='eclipse'] {
    color: #c4b0ff;
    background: rgb(139 92 246 / 14%);
  }
  .set-badge[data-rarity='eruption'] {
    color: #ff8a5c;
    background: rgb(255 90 42 / 12%);
  }
  .set-badge[data-rarity='ember'] {
    color: #e0a37c;
    background: rgb(198 90 46 / 12%);
  }
  .set-badge[data-rarity='titan'] {
    color: var(--ur-titan);
    background: rgb(169 180 216 / 12%);
  }
  .set-badge[data-rarity='immortal'] {
    color: var(--ur-immortal);
    background: rgb(255 233 176 / 10%);
  }

  .on-team {
    padding: 0.12rem 0.35rem;
    border: 1px solid color-mix(in srgb, var(--ur-success) 50%, transparent);
    border-radius: 0.3rem;
    color: var(--ur-success);
    font-size: 0.6rem;
    font-weight: 800;
  }

  .bench-remove {
    display: grid;
    width: 2.5rem;
    height: 2.5rem;
    flex: 0 0 auto;
    place-items: center;
    border: 1px solid transparent;
    border-radius: 0.5rem;
    background: transparent;
    color: var(--ur-muted);
    font-size: 1.3rem;
    cursor: pointer;
  }

  .bench-remove:hover {
    border-color: var(--ur-danger);
    color: var(--ur-danger);
  }

  .bench-empty,
  .owned-empty {
    padding: 0.9rem;
    border: 1px dashed var(--ur-line-strong);
    border-radius: 0.6rem;
    color: var(--ur-muted);
    font-size: 0.8rem;
  }

  .minutes-score {
    color: var(--ur-apex);
    font-family: var(--font-display);
    font-size: clamp(1.9rem, 3.5vw, 2.5rem);
    font-weight: 900;
    font-variant-numeric: tabular-nums;
    letter-spacing: -0.02em;
    text-shadow: 0 0 18px rgb(255 197 61 / 30%);
  }

  .minutes-score span {
    color: var(--ur-muted);
    font-size: 0.65em;
  }

  .minute-track {
    display: flex;
    height: 0.55rem;
    overflow: hidden;
    border: 1px solid color-mix(in srgb, var(--ur-apex) 35%, transparent);
    border-radius: 999px;
    background: #0a0f12;
  }

  .minute-track span {
    display: block;
    height: 100%;
    transition: width 180ms ease;
  }
  .minute-track span:only-child {
    border-radius: 999px;
    background: linear-gradient(90deg, #e9a91f, var(--ur-apex) 60%, #ffda73);
    box-shadow: 0 0 12px rgb(255 197 61 / 45%);
  }
  .minute-starters {
    border-radius: 999px 0 0 999px;
    background: linear-gradient(90deg, #e9a91f, var(--ur-apex) 60%, #ffda73);
    box-shadow: 0 0 12px rgb(255 197 61 / 45%);
  }
  .minute-bench {
    border-radius: 0 999px 999px 0;
    background: linear-gradient(90deg, #6d5ef0, #a588ff);
    box-shadow: 0 0 12px rgb(139 92 246 / 45%);
  }
  .minutes-head-actions {
    display: flex;
    align-items: center;
    gap: 0.6rem;
  }
  .btn-auto {
    white-space: nowrap;
  }
  .panel-rotation {
    padding-bottom: 0.9rem;
  }
  .rotation-strip {
    display: grid;
    gap: 0.5rem;
    margin: 0;
    padding: 0;
    list-style: none;
    grid-template-columns: repeat(6, minmax(0, 1fr));
  }
  .rotation-strip > li {
    display: flex;
    min-width: 0;
    flex-direction: column;
    align-items: center;
    gap: 0.25rem;
    padding: 0.5rem 0.4rem;
    border: 1px solid var(--ur-line);
    border-radius: 0.6rem;
    background: #0e1418;
    text-align: center;
  }
  .rotation-strip strong {
    overflow: hidden;
    max-width: 100%;
    color: var(--ur-paper);
    font-size: 0.68rem;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .rotation-strip small {
    color: var(--ur-muted);
    font-size: 0.64rem;
  }
  .rotation-face {
    overflow: hidden;
    border-radius: 0.45rem;
  }
  .rotation-empty {
    grid-column: span 5;
    color: var(--ur-muted);
    font-size: 0.76rem;
  }
  .rotation-add {
    display: flex;
    width: 100%;
    min-height: 100%;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 0.2rem;
    border: 1px dashed var(--ur-line-strong);
    border-radius: 0.5rem;
    background: transparent;
    color: var(--ur-apex);
    cursor: pointer;
  }
  .rotation-add span {
    font-size: 1.4rem;
    line-height: 1;
  }
  .ovr-big {
    color: #fff;
    font-family: var(--font-display);
    font-size: 1rem;
    font-weight: 900;
    font-variant-numeric: tabular-nums;
  }
  .owned-minutes {
    flex: none;
    color: var(--ur-muted);
    font-size: 0.7rem;
    font-variant-numeric: tabular-nums;
  }

  .minute-guidance {
    margin: 0.4rem 0 0;
    color: var(--ur-muted);
    font-size: 0.72rem;
  }

  .minutes-list {
    display: grid;
    gap: 0.45rem;
    margin: 0.7rem 0 0;
    padding: 0;
    list-style: none;
  }

  .minutes-label {
    cursor: text;
  }

  .minutes-label span {
    display: flex;
    align-items: center;
    gap: 0.35rem;
    margin-top: 0.15rem;
    color: var(--ur-muted);
    font-size: 0.64rem;
  }

  .stepper {
    display: flex;
    flex: 0 0 auto;
    align-items: center;
    gap: 0.3rem;
  }

  .stepper button {
    display: grid;
    width: 2.25rem;
    height: 2.25rem;
    place-items: center;
    border: 1px solid var(--ur-line-strong);
    border-radius: 0.45rem;
    background: var(--ur-surface);
    color: var(--ur-paper);
    font-size: 1rem;
    font-weight: 800;
    cursor: pointer;
  }

  .stepper button:hover:not(:disabled) {
    border-color: var(--ur-apex);
    color: var(--ur-apex);
  }

  .stepper button:disabled {
    opacity: 0.35;
    cursor: not-allowed;
  }

  .stepper input {
    width: 3rem;
    height: 2.25rem;
    border: 1px solid var(--ur-line-strong);
    border-radius: 0.45rem;
    background: #0a0f12;
    color: #fff;
    font-size: 0.9rem;
    font-variant-numeric: tabular-nums;
    text-align: center;
  }

  .stepper input:focus {
    border-color: var(--ur-apex);
    outline: 2px solid color-mix(in srgb, var(--ur-apex) 55%, transparent);
    outline-offset: 1px;
  }

  .stepper input::-webkit-outer-spin-button,
  .stepper input::-webkit-inner-spin-button {
    -webkit-appearance: none;
    margin: 0;
  }

  .team-actions {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
    margin-top: 0.9rem;
  }

  .team-actions .btn-gold {
    flex: 1 1 10rem;
  }

  .save-note {
    margin: 0.65rem 0 0;
    color: var(--ur-muted);
    font-size: 0.76rem;
  }

  .link-button {
    margin-left: 0.5rem;
    padding: 0;
    border: 0;
    background: none;
    color: var(--ur-apex);
    font-size: inherit;
    font-weight: 800;
    text-decoration: underline;
    text-decoration-color: color-mix(in srgb, var(--ur-apex) 70%, transparent);
    text-underline-offset: 0.2em;
    cursor: pointer;
  }

  .link-button:hover {
    color: #ffda73;
  }

  .saved-line {
    margin: 0.5rem 0 0;
    color: var(--ur-muted);
    font-size: 0.76rem;
  }

  .saved-line a {
    margin-left: 0.35rem;
    color: var(--ur-apex);
    font-weight: 800;
  }

  .panel-owned {
    position: static;
  }

  .owned-badge {
    padding: 0.35rem 0.65rem;
    border: 1px solid color-mix(in srgb, var(--ur-apex) 45%, var(--ur-line-strong));
    border-radius: 999px;
    background: rgb(255 197 61 / 8%);
    color: var(--ur-apex);
    font-size: 0.7rem;
    font-weight: 800;
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
  }

  .owned-filters {
    display: grid;
    grid-template-columns: minmax(0, 1fr) 8.5rem;
    gap: 0.5rem;
  }

  .owned-search,
  .owned-select {
    min-height: 2.75rem;
    padding: 0.6rem 0.75rem;
    border: 1px solid var(--ur-line-strong);
    border-radius: 0.55rem;
    background: #0a0f12;
    color: var(--ur-paper);
    font-size: 0.8rem;
  }

  .owned-search:focus,
  .owned-select:focus {
    border-color: var(--ur-apex);
  }

  .picker-hint {
    margin: 0.6rem 0 0;
    padding: 0.5rem 0.65rem;
    border-left: 2px solid var(--ur-apex);
    background: color-mix(in srgb, var(--ur-apex) 8%, var(--ur-surface));
    font-size: 0.76rem;
  }

  .owned-list {
    display: grid;
    gap: 0.45rem;
    max-height: 38rem;
    margin: 0.7rem 0 0;
    padding: 0 0.15rem 0.15rem 0;
    overflow-y: auto;
    list-style: none;
    scrollbar-width: thin;
  }

  .owned-reason {
    display: block;
    margin-top: 0.2rem;
    color: var(--ur-muted);
    font-size: 0.62rem;
  }

  .owned-add {
    display: grid;
    width: 2.25rem;
    height: 2.25rem;
    flex: 0 0 auto;
    place-items: center;
    border: 1px solid color-mix(in srgb, var(--ur-apex) 65%, transparent);
    border-radius: 0.5rem;
    background: transparent;
    color: var(--ur-apex);
    font-size: 1.15rem;
    cursor: pointer;
  }

  .owned-add:hover:not(:disabled) {
    background: var(--ur-apex);
    color: #241a02;
  }

  .owned-add:disabled {
    border-color: var(--ur-line);
    color: var(--ur-muted);
    opacity: 0.55;
    cursor: not-allowed;
  }

  .eligibility-note {
    margin: 0.8rem 0 0;
    padding-top: 0.7rem;
    border-top: 1px solid var(--ur-line);
    color: var(--ur-muted);
    font-size: 0.66rem;
    line-height: 1.55;
  }

  .team-page button:focus-visible,
  .team-page input:focus-visible,
  .team-page select:focus-visible,
  .team-page a:focus-visible {
    outline: 3px solid var(--ur-focus);
    outline-offset: 2px;
  }

  @media (min-width: 768px) {
    .bench-grid {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }
  }

  @media (min-width: 1024px) {
    .team-layout {
      grid-template-columns: minmax(0, 1.12fr) minmax(20rem, 0.88fr);
    }

    .panel-owned {
      position: sticky;
      top: 1rem;
    }
  }

  @media (max-width: 520px) {
    .owned-filters {
      grid-template-columns: minmax(0, 1fr);
    }

    .court-slots {
      column-gap: 0.4rem;
      row-gap: 0.6rem;
      padding: 0.7rem 0.6rem 0.85rem;
    }

    .slot-card {
      width: min(100%, 8.5rem);
    }

    .slot-face,
    .slot-silhouette {
      min-height: 5.25rem;
    }

    .team-actions > * {
      flex: 1 1 calc(50% - 0.5rem);
    }

    .team-actions .btn-gold {
      flex-basis: 100%;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .slot-card,
    .minute-track span {
      transition: none;
    }
  }
</style>
