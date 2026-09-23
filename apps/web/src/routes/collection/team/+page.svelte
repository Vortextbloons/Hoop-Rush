<script lang="ts">
  import { resolve } from '$app/paths';
  import { page } from '$app/state';
  import '$lib/collection/ultimate-theme.css';
  import { onDestroy } from 'svelte';
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
  import CollectionNav from '$lib/collection/CollectionNav.svelte';
  import { loadCollectionCatalog } from '$lib/collection/collection-assets.ts';
  import {
    ensureCollection,
    ensurePlayState,
    setActiveTeam,
  } from '$lib/collection/collection-hub.ts';
  import {
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
  let saving = $state(false);
  let saveError = $state<string | null>(null);
  let announcement = $state('');

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
  const resolveCard = (cardId: string): CollectionCatalogCard | undefined => byId.get(cardId);
  const check = $derived(
    catalog ? checkDraft(draft, resolveCard, ownedSet) : { ok: false, issues: [] },
  );
  const message = $derived(firstValidationMessage(check, draft));
  const total = $derived(minutesTotal(draft));
  const blocked = $derived(blockedCardIds(draft, resolveCard, ownedIds));
  const committed = $derived(playState?.activeTeam ?? null);

  const filteredOwned = $derived.by(() => {
    const query = search.trim().toLowerCase();
    const roster = new Set(draftRoster(draft));
    return ownedCards
      .filter((card) => (query ? card.displayName.toLowerCase().includes(query) : true))
      .sort((a, b) => {
        const overallA = a.summarySource?.overallRating ?? 60;
        const overallB = b.summarySource?.overallRating ?? 60;
        if (overallA !== overallB) return overallB - overallA;
        return a.cardId < b.cardId ? -1 : 1;
      })
      .map((card) => ({ card, rostered: roster.has(card.cardId) }));
  });

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

  function selectStarterSlot(index: number): void {
    target = { kind: 'starter', index };
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

  function setMinutes(cardId: string, value: number): void {
    const minutes = Number.isInteger(value) ? Math.min(48, Math.max(0, value)) : 0;
    draft = { ...draft, minutes: { ...draft.minutes, [cardId]: minutes } };
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
  const balances = $derived(collectionState?.balances ?? { Coins: 0, Exchange: 0 });
  let returnChallengeId = $state<string | null>(null);
</script>

<svelte:head>
  <title>Team · Hoop Rush</title>
</svelte:head>

<div class="ultimate-root mx-auto w-full max-w-6xl px-3 py-6 sm:px-6">
  <div class="flex flex-wrap items-end justify-between gap-3">
    <div class="flex items-center gap-3">
      <div>
        <p class="ultimate-eyebrow">Ultimate Run</p>
        <h1 class="font-display text-3xl font-extrabold tracking-tight">Team</h1>
        <p class="text-sm text-muted-foreground">Five starters, up to seven bench, 240 minutes.</p>
      </div>
    </div>
    <div class="flex flex-wrap items-center gap-2 text-sm">
      <span><strong class="tabular-nums">{balances.Coins}</strong> Coins</span>
      <CollectionNav current="team" />
    </div>
  </div>

  <p class="sr-only" role="status">{announcement}</p>

  {#if returnChallengeId}
    <p
      class="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-card p-4 text-sm"
    >
      <span>
        Editing your team for challenge
        <code class="font-mono text-xs">{returnChallengeId}</code>. Save the team, then return to
        Play.
      </span>
      <a
        href={resolve(`/collection/play?challenge=${returnChallengeId}` as any)}
        class="inline-flex min-h-11 items-center rounded-xl bg-surface-2 px-4 py-2 text-sm font-semibold outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        Back to challenges
      </a>
    </p>
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
      href={resolve('/collection')}
      class="mt-3 inline-block min-h-[44px] rounded-xl bg-accent px-5 py-2.5 font-bold text-accent-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      Go to collection
    </a>
  {:else}
    {#if message}
      <p role="status" class="mt-4 rounded-xl border border-border bg-surface-2 p-4 text-sm">
        {message}
      </p>
    {:else}
      <p role="status" class="mt-4 rounded-xl border border-positive/40 bg-positive/10 p-4 text-sm">
        Team is valid. Save to unlock Play.
      </p>
    {/if}
    {#if saveError}
      <p role="alert" class="mt-3 text-sm text-negative">{saveError}</p>
    {/if}

    <div class="mt-4 flex flex-col gap-6 lg:grid lg:grid-cols-2">
      <section aria-label="Lineup board" class="order-first lg:order-2">
        <div class="rounded-2xl border border-border bg-card p-5">
          <h2 class="font-display text-xl font-extrabold">Coach's board</h2>
          <ol class="mt-3 space-y-2">
            {#each draft.starters as slot, index (index)}
              {@const card = slot ? (byId.get(slot) ?? null) : null}
              <li>
                <button
                  type="button"
                  onclick={() => selectStarterSlot(index)}
                  aria-pressed={target !== null &&
                    target.kind === 'starter' &&
                    target.index === index}
                  aria-label={card
                    ? `${STARTER_SLOT_LABELS[index]} starter: ${card.displayName}. Select to replace.`
                    : `Empty ${STARTER_SLOT_LABELS[index]} starter slot. Select, then pick a card.`}
                  class="flex min-h-[44px] w-full items-center justify-between gap-2 rounded-xl border border-border bg-surface-2 px-3 py-2 text-left text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <span class="font-bold">{STARTER_SLOT_LABELS[index]}</span>
                  <span class="truncate"
                    >{card ? card.displayName : 'Empty — tap, then pick a card'}</span
                  >
                  {#if card}
                    <span class="shrink-0 text-xs text-muted-foreground"
                      >Overall {overallOf(card)}</span
                    >
                  {/if}
                </button>
              </li>
            {/each}
          </ol>

          <h3 class="mt-5 font-display text-lg font-extrabold">Bench ({draft.bench.length}/7)</h3>
          <ul class="mt-2 space-y-2">
            {#each draft.bench as cardId (cardId)}
              {@const card = byId.get(cardId)}
              <li
                class="flex min-h-[44px] items-center justify-between gap-2 rounded-xl bg-surface-2 px-3 py-2 text-sm"
              >
                <span class="truncate font-semibold">{card?.displayName ?? cardId}</span>
                <button
                  type="button"
                  onclick={() => removeFromRoster(cardId)}
                  aria-label={`Remove ${card?.displayName ?? cardId} from the team`}
                  class="min-h-[44px] min-w-[44px] rounded-lg px-2 font-bold outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  ×
                </button>
              </li>
            {/each}
          </ul>
          <button
            type="button"
            onclick={() => {
              target = { kind: 'bench' };
            }}
            disabled={draft.bench.length >= 7}
            aria-pressed={target !== null && target.kind === 'bench'}
            class="mt-2 min-h-[44px] w-full rounded-xl border border-dashed border-border px-4 py-2 text-sm font-semibold outline-none disabled:opacity-40 focus-visible:ring-2 focus-visible:ring-ring"
          >
            {target !== null && target.kind === 'bench'
              ? 'Pick a card below for the bench'
              : 'Add to bench'}
          </button>

          <h3 class="mt-5 font-display text-lg font-extrabold">
            Minutes <span class="tabular-nums">({total}/{TEAM_MINUTES_TOTAL})</span>
          </h3>
          <ul class="mt-2 space-y-2">
            {#each draftRoster(draft) as cardId (cardId)}
              {@const card = byId.get(cardId)}
              <li class="flex min-h-[44px] items-center gap-2 text-sm">
                <label for={`minutes-${cardId}`} class="min-w-0 flex-1 truncate">
                  {card?.displayName ?? cardId}
                </label>
                <input
                  id={`minutes-${cardId}`}
                  type="number"
                  min="0"
                  max="48"
                  value={draft.minutes[cardId] ?? 0}
                  onchange={(event) => setMinutes(cardId, event.currentTarget.valueAsNumber)}
                  class="w-20 rounded-lg border border-border bg-surface-2 px-2 py-2 text-right tabular-nums outline-none focus-visible:ring-2 focus-visible:ring-ring"
                />
              </li>
            {/each}
          </ul>

          <div class="mt-4 flex flex-wrap gap-2">
            <button
              type="button"
              onclick={autoBuild}
              class="min-h-[44px] rounded-xl bg-surface-2 px-5 py-2.5 text-sm font-bold outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              Auto build
            </button>
            <button
              type="button"
              onclick={balanceMinutes}
              class="min-h-[44px] rounded-xl bg-surface-2 px-5 py-2.5 text-sm font-bold outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              Balance minutes
            </button>
            <button
              type="button"
              onclick={save}
              disabled={!check.ok || saving}
              class="min-h-[44px] rounded-xl bg-accent px-5 py-2.5 text-sm font-bold text-accent-foreground outline-none disabled:opacity-40 focus-visible:ring-2 focus-visible:ring-ring"
            >
              {saving ? 'Saving…' : 'Save team'}
            </button>
          </div>
          {#if committed}
            <p class="mt-3 text-sm text-muted-foreground">
              Saved team · revision {playState?.revision ?? 0}.
              <a href={resolve('/collection/play')} class="font-bold underline">Play</a>
            </p>
          {/if}
        </div>
      </section>

      <section aria-label="Owned cards" class="lg:order-1">
        <div class="rounded-2xl border border-border bg-card p-5">
          <h2 class="font-display text-xl font-extrabold">Owned cards ({ownedCards.length})</h2>
          <input
            type="search"
            placeholder="Search owned cards"
            aria-label="Search owned cards"
            value={search}
            oninput={(event) => {
              search = event.currentTarget.value;
            }}
            class="mt-3 min-h-[44px] w-full rounded-xl border border-border bg-surface-2 px-4 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
          {#if target !== null}
            <p class="mt-2 text-sm text-muted-foreground">
              {target.kind === 'bench'
                ? 'Pick a card for the bench.'
                : `Pick a ${STARTER_SLOT_LABELS[target.index]} starter.`}
            </p>
          {/if}
          <ul class="mt-3 max-h-[32rem] space-y-2 overflow-y-auto pr-1">
            {#each filteredOwned as { card, rostered } (card.cardId)}
              {@const reason = blocked.get(card.cardId)}
              <li>
                <button
                  type="button"
                  onclick={() => assignCard(card.cardId)}
                  disabled={reason !== undefined}
                  title={reason ?? ''}
                  aria-label={`${card.displayName}, ${card.seasonKey}, ${card.rarity}, overall ${overallOf(card)}${reason ? `. ${reason}` : ''}`}
                  class="flex min-h-[44px] w-full items-center gap-3 rounded-xl border border-border bg-surface-2 p-2 text-left text-sm outline-none disabled:opacity-50 focus-visible:ring-2 focus-visible:ring-ring"
                >
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
                  <span class="min-w-0 flex-1">
                    <span class="block truncate font-semibold">{card.displayName}</span>
                    <span class="block text-xs text-muted-foreground">
                      {card.seasonKey} · {card.rarity} · {card.positions.join('/')} · Overall
                      {overallOf(card)}{rostered ? ' · On team' : ''}{target !== null &&
                      target.kind === 'starter'
                        ? slotEligibility(card.positions, target.index)
                          ? ` · Fits ${STARTER_SLOT_LABELS[target.index]}`
                          : ` · Misses ${STARTER_SLOT_LABELS[target.index]}`
                        : ''}
                    </span>
                    {#if reason}
                      <span class="block text-xs text-muted-foreground">{reason}</span>
                    {/if}
                  </span>
                </button>
              </li>
            {:else}
              <li class="text-sm text-muted-foreground">No owned cards match.</li>
            {/each}
          </ul>
          <p class="mt-3 text-xs text-muted-foreground">
            Eligibility: {STARTER_SLOT_LABELS.map(
              (label, index) =>
                `${label} takes ${['guards', 'guards', 'forwards', 'forwards', 'centers'][index]}`,
            ).join(' · ')}.
          </p>
        </div>
      </section>
    </div>
  {/if}
</div>
