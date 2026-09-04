<script lang="ts">
  import type {
    FixedFiveParticipantId,
    FixedFiveRoomMode,
    PlayersIndexEntry,
    PlayerId,
    SlotIndex,
  } from '@hoop-rush/data-contracts';
  import { franchiseAbbreviation, resolveEraTeamIdentity } from '@hoop-rush/data-contracts';
  import ClassicRollReel from '$lib/components/classic/ClassicRollReel.svelte';
  import DraftPoolBrowser from '$lib/components/draft/DraftPoolBrowser.svelte';
  import DraftRoundCard from '$lib/components/draft/DraftRoundCard.svelte';
  import LineupCourt from '$lib/components/LineupCourt.svelte';
  import PlayerFace from '$lib/components/PlayerFace.svelte';
  import DraftValuePanel from '$lib/components/DraftValuePanel.svelte';
  import LineupSummaryNav from '$lib/components/LineupSummaryNav.svelte';
  import TeamLogo from '$lib/components/TeamLogo.svelte';
  import { classicPoolRows } from '$lib/classic-draft';
  import { poolSortLabel, sortDraftRows, type DraftPresentation } from '$lib/draft-presentation';
  import type { RollAnimationAxis } from '$lib/fixed-five-roll-animation';
  import { displacementTargetFor } from '$lib/draft-slots';
  import { formatPositions } from '$lib/player-positions';
  import { resolvePlayerRefs } from '$lib/player-refs';
  import type { PeakPlayerSeason } from '@hoop-rush/data-contracts';
  import {
    isFixedFiveDraftTurn,
    type DraftReplay,
    type FixedFiveAssets,
  } from '$lib/fixed-five-room-state';

  let {
    mode,
    selfId,
    replay,
    assets,
    presentation,
    rollAxis = 'both',
    rollNonce = 0,
    disabled = false,
    deadlineText = null,
    lastAutopick = null,
    error = null,
    onPick,
    onReroll,
    onRemove,
    onLock,
  }: {
    mode: FixedFiveRoomMode;
    selfId: FixedFiveParticipantId;
    replay: DraftReplay;
    assets: FixedFiveAssets;
    presentation: DraftPresentation;
    rollAxis?: RollAnimationAxis;
    rollNonce?: number;
    disabled?: boolean;
    deadlineText?: string | null;
    lastAutopick?: { displayName: string; seedPath: string } | null;
    error?: string | null;
    onPick: (playerId: PlayerId, slotIndex: SlotIndex, moveTarget?: SlotIndex | null) => void;
    onReroll: (axis: 'franchise' | 'era') => void;
    onRemove: (slotIndex: SlotIndex) => void;
    onLock: () => void;
  } = $props();

  let slotPickerModule: Promise<
    typeof import('$lib/components/draft/SlotPickerDialog.svelte')
  > | null = null;
  function loadSlotPickerDialog(): Promise<
    typeof import('$lib/components/draft/SlotPickerDialog.svelte')
  > {
    slotPickerModule ??= import('$lib/components/draft/SlotPickerDialog.svelte');
    return slotPickerModule;
  }

  let pickerPlayer = $state<PlayersIndexEntry | null>(null);
  let pickerTrigger = $state<HTMLElement | null>(null);
  let pickerFallbackId = $state<string | null>(null);
  let resolvedLineupPlayers = $state.raw<PeakPlayerSeason[]>([]);

  const indexById = $derived(new Map(assets.index.players.map((p) => [p.playerId, p])));
  const catalogPairs = $derived(
    assets.catalog.map((e) => ({ franchiseId: e.franchiseId, eraId: e.eraId })),
  );
  const franchiseOptions = $derived([...new Set(catalogPairs.map((p) => p.franchiseId))]);
  const eraOptions = $derived([...new Set(catalogPairs.map((p) => p.eraId))]);

  interface RollView {
    franchiseId: string;
    eraId: string;
    label: string;
    round: number;
    spinKey: number;
    mySlotsUsed: Set<SlotIndex>;
    rerollFranchiseSpent: boolean;
    rerollEraSpent: boolean;
    complete: boolean;
    turn: boolean;
    turnText: string;
  }

  const rollView = $derived.by((): RollView | null => {
    if (mode === 'sandbox-shared-82') return null;
    if (replay.mode === 'sandbox-shared-82') return null;
    if (replay.mode === 'sandbox-duel') return null;
    if (replay.mode === 'classic-shared-82') {
      const draft = selfId === 'p1' ? replay.p1 : replay.p2;
      if (draft.status === 'complete' || !draft.roll) {
        return {
          franchiseId: '',
          eraId: '',
          label: 'Draft complete',
          round: 5,
          spinKey: 5,
          mySlotsUsed: new Set(draft.picks.map((p) => p.slotIndex)),
          rerollFranchiseSpent: true,
          rerollEraSpent: true,
          complete: true,
          turn: false,
          turnText: 'Your five is set.',
        };
      }
      return {
        franchiseId: draft.roll.franchiseId,
        eraId: draft.roll.eraId,
        label: `Round ${draft.round} of 5`,
        round: draft.round,
        spinKey: draft.round,
        mySlotsUsed: new Set(draft.picks.map((p) => p.slotIndex)),
        rerollFranchiseSpent: draft.rerolls.franchiseSpent,
        rerollEraSpent: draft.rerolls.eraSpent,
        complete: false,
        turn: true,
        turnText: 'Your pick — simultaneous draft.',
      };
    }
    const duel = replay.state;
    const mine = duel.picks.filter((p) => p.participantId === selfId).map((p) => p.slotIndex);
    if (duel.status === 'complete' || !duel.currentRoll) {
      return {
        franchiseId: '',
        eraId: '',
        label: 'Duel draft complete',
        round: 5,
        spinKey: 10,
        mySlotsUsed: new Set(mine),
        rerollFranchiseSpent: true,
        rerollEraSpent: true,
        complete: true,
        turn: false,
        turnText: 'Both fives are set.',
      };
    }
    const tokens = duel.rerolls[selfId];
    return {
      franchiseId: duel.currentRoll.franchiseId,
      eraId: duel.currentRoll.eraId,
      label: `Pick ${duel.pickOrdinal + 1} of 10`,
      round: Math.min(5, Math.floor(duel.pickOrdinal / 2) + 1),
      spinKey: duel.pickOrdinal,
      mySlotsUsed: new Set(mine),
      rerollFranchiseSpent: tokens.franchiseSpent,
      rerollEraSpent: tokens.eraSpent,
      complete: false,
      turn: isFixedFiveDraftTurn(replay, selfId),
      turnText: isFixedFiveDraftTurn(replay, selfId)
        ? 'Your pick — alternating draft.'
        : 'Opponent is picking…',
    };
  });

  interface SandboxDuelView {
    label: string;
    pickOrdinal: number;
    complete: boolean;
    turn: boolean;
    turnText: string;
    myClaimed: Set<PlayerId>;
  }

  const sandboxDuelView = $derived.by((): SandboxDuelView | null => {
    if (mode !== 'duel' || replay.mode !== 'sandbox-duel') return null;
    const turn = isFixedFiveDraftTurn(replay, selfId);
    const complete = replay.state.status === 'complete';
    return {
      label: `Pick ${Math.min(10, replay.state.pickOrdinal + 1)} of 10`,
      pickOrdinal: replay.state.pickOrdinal,
      complete,
      turn,
      turnText: complete
        ? 'Both fives are set.'
        : turn
          ? 'Your pick — claim any player.'
          : 'Opponent is picking…',
      myClaimed: new Set(
        replay.state.picks.filter((p) => p.participantId === selfId).map((p) => p.playerId),
      ),
    };
  });

  const sandboxDuelRows = $derived.by((): PlayersIndexEntry[] => {
    if (!sandboxDuelView || sandboxDuelView.complete) return [];
    return sortDraftRows(
      assets.index.players.filter((p) => !sandboxDuelView.myClaimed.has(p.playerId)),
      presentation,
    );
  });

  const sandboxDuelCountLabel = $derived(
    `${sandboxDuelRows.length} players · ${poolSortLabel(presentation)}`,
  );

  const rollRows = $derived.by((): PlayersIndexEntry[] => {
    if (!rollView || rollView.complete) return [];
    const rows = classicPoolRows(
      assets.index,
      { franchiseId: rollView.franchiseId, eraId: rollView.eraId },
      presentation,
    );
    if (replay.mode === 'duel') {
      const claimed = new Set(replay.state.claimedVersionIds);
      return rows.filter((row) => {
        const candidate = assets.poolById.get(row.playerId);
        const versionId = candidate?.playerVersionId ?? row.playerId;
        return !claimed.has(versionId) && !claimed.has(row.playerId);
      });
    }
    if (replay.mode === 'classic-shared-82') {
      const draft = selfId === 'p1' ? replay.p1 : replay.p2;
      const drafted = new Set(draft.picks.map((p) => p.playerId));
      return rows.filter((row) => !drafted.has(row.playerId));
    }
    return rows;
  });

  const myPicks = $derived.by((): Array<{ playerId: PlayerId; slotIndex: SlotIndex }> => {
    if (replay.mode === 'duel') {
      return replay.state.picks
        .filter((p) => p.participantId === selfId)
        .map((p) => ({ playerId: p.playerId, slotIndex: p.slotIndex }));
    }
    if (replay.mode === 'sandbox-duel') {
      return replay.state.picks
        .filter((p) => p.participantId === selfId)
        .map((p) => ({ playerId: p.playerId, slotIndex: p.slotIndex }));
    }
    if (replay.mode === 'sandbox-shared-82') {
      const builder = selfId === 'p1' ? replay.p1 : replay.p2;
      return builder.placements.map((p) => ({ playerId: p.playerId, slotIndex: p.slotIndex }));
    }
    const draft = selfId === 'p1' ? replay.p1 : replay.p2;
    return draft.picks.map((p) => ({ playerId: p.playerId, slotIndex: p.slotIndex }));
  });

  const myCourtRows = $derived.by((): (PlayersIndexEntry | null)[] => {
    if (replay.mode === 'sandbox-shared-82') return courtRows;
    const rows: (PlayersIndexEntry | null)[] = [null, null, null, null, null];
    for (const pick of myPicks) {
      rows[pick.slotIndex] = indexById.get(pick.playerId) ?? null;
    }
    return rows;
  });

  function displayNameOf(playerId: PlayerId): string {
    return indexById.get(playerId)?.displayName ?? playerId;
  }

  const sandboxRows = $derived(sortDraftRows(assets.index.players, presentation));
  const courtRows = $derived.by((): (PlayersIndexEntry | null)[] => {
    if (replay.mode !== 'sandbox-shared-82') return [null, null, null, null, null];
    const builder = selfId === 'p1' ? replay.p1 : replay.p2;
    const rows: (PlayersIndexEntry | null)[] = [null, null, null, null, null];
    for (const placement of builder.placements) {
      rows[placement.slotIndex] = indexById.get(placement.playerId) ?? null;
    }
    return rows;
  });
  const sandboxLocked = $derived(
    replay.mode === 'sandbox-shared-82' ? (selfId === 'p1' ? replay.p1 : replay.p2).locked : false,
  );

  const activeCourtRows = $derived(mode === 'sandbox-shared-82' ? courtRows : myCourtRows);
  const pickedCount = $derived(activeCourtRows.filter((p) => p !== null).length);
  const allowDisplacement = $derived(mode !== 'duel');

  const rollManifest = $derived(assets.manifest);
  const rollFranchise = $derived(
    rollView && !rollView.complete
      ? (rollManifest.modernFranchiseSlots.find((e) => e.franchiseId === rollView.franchiseId) ??
          null)
      : null,
  );
  const rollEra = $derived(
    rollView && !rollView.complete
      ? (rollManifest.eras.find((e) => e.eraId === rollView.eraId) ?? null)
      : null,
  );
  const rollIdentity = $derived(
    rollView && !rollView.complete
      ? resolveEraTeamIdentity(rollManifest, rollView.franchiseId, rollView.eraId)
      : null,
  );
  const rollFranchiseAbbreviation = $derived(
    rollView && !rollView.complete
      ? (rollIdentity?.abbreviationLabel ??
          (rollFranchise ? franchiseAbbreviation(rollFranchise.franchiseId) : rollView.franchiseId))
      : '',
  );
  const rollFranchiseDisplayName = $derived(
    rollView && !rollView.complete
      ? (rollIdentity?.displayLabel ?? rollFranchise?.displayName ?? null)
      : null,
  );
  const rollEraLabel = $derived(
    rollView && !rollView.complete ? (rollEra?.label ?? rollView.eraId) : '',
  );
  const poolHeading = $derived(
    rollView && !rollView.complete && rollFranchise && rollEra && rollIdentity
      ? `${rollIdentity.abbreviationLabel ?? franchiseAbbreviation(rollFranchise.franchiseId)} · ${rollEra.label}`
      : (rollView?.label ?? 'Draft pool'),
  );
  const poolCountLabel = $derived(`${rollRows.length} players · ${poolSortLabel(presentation)}`);

  $effect(() => {
    const rows = activeCourtRows;
    const manifest = assets.manifest;
    const refs = rows
      .filter((player): player is PlayersIndexEntry => player !== null)
      .map((player) => ({
        playerId: player.playerId,
        franchiseId: player.franchiseId,
        eraId: player.eraId,
      }));
    if (refs.length === 0) {
      resolvedLineupPlayers = [];
      return;
    }
    let cancelled = false;
    resolvePlayerRefs(refs, manifest).then(
      (players) => {
        if (!cancelled) resolvedLineupPlayers = players;
      },
      () => {
        if (!cancelled) resolvedLineupPlayers = [];
      },
    );
    return () => {
      cancelled = true;
    };
  });

  function openPicker(player: PlayersIndexEntry) {
    pickerTrigger = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    pickerFallbackId = pickerTrigger?.closest<HTMLElement>('[id^="court-slot-"]')?.id ?? null;
    pickerPlayer = player;
  }

  function closePicker() {
    pickerPlayer = null;
    const trigger = pickerTrigger;
    const fallback = pickerFallbackId;
    pickerTrigger = null;
    pickerFallbackId = null;
    queueMicrotask(() => {
      if (trigger?.isConnected) {
        trigger.focus();
      } else if (fallback) {
        document.getElementById(fallback)?.focus();
      }
    });
  }

  function placeWithDisplacement(player: PlayersIndexEntry, slotIndex: number) {
    const slots = activeCourtRows;
    const subjectSlot = slots.findIndex((p) => p !== null && p.playerId === player.playerId);
    const incumbent = slots[slotIndex] ?? null;
    let moveTarget: SlotIndex | null = null;
    if (incumbent && incumbent.playerId !== player.playerId && allowDisplacement) {
      moveTarget = displacementTargetFor(
        slots,
        incumbent,
        slotIndex,
        subjectSlot,
      ) as SlotIndex | null;
    }
    closePicker();
    onPick(player.playerId, slotIndex as SlotIndex, moveTarget);
  }

  function openPickerForCourt(player: PlayersIndexEntry) {
    if (mode === 'sandbox-shared-82') {
      openPicker(player);
      return;
    }
  }
</script>

<div class="mt-2 flex min-w-0 flex-col gap-6 pb-24">
  {#if deadlineText}
    <p class="text-xs text-muted-foreground" role="status">{deadlineText}</p>
  {/if}
  {#if lastAutopick}
    <p class="mt-1 rounded-lg border border-line-soft bg-card p-2 text-xs" role="status">
      Timeout auto-pick: <strong>{lastAutopick.displayName}</strong>
      <span class="text-muted-foreground">({lastAutopick.seedPath})</span>
    </p>
  {/if}
  {#if error}
    <p
      class="mt-2 rounded-lg border border-destructive/40 bg-destructive/10 p-2 text-xs"
      role="alert"
    >
      {error}
    </p>
  {/if}

  {#if mode !== 'sandbox-shared-82' && rollView}
    {#if !rollView.complete}
      <DraftRoundCard
        label={rollView.label}
        round={rollView.round}
        turnText={rollView.turnText}
        turnPill={mode === 'duel' ? (rollView.turn ? 'you' : 'rival') : null}
        ariaLabel={rollFranchise && rollEra
          ? `${rollView.label} · ${rollIdentity?.displayLabel ?? rollFranchise.displayName} · ${rollEra.label}`
          : rollView.label}
        manifest={rollManifest}
        franchiseId={rollView.franchiseId}
        teamExternalId={rollFranchise?.teamExternalId ?? ''}
        logoCandidates={rollIdentity?.logoCandidates ?? []}
        franchiseAbbreviation={rollFranchiseAbbreviation}
        franchiseDisplayName={rollFranchiseDisplayName}
        eraLabel={rollEraLabel}
        franchiseRerollAvailable={!rollView.rerollFranchiseSpent}
        franchiseRerollSpent={rollView.rerollFranchiseSpent}
        eraRerollAvailable={!rollView.rerollEraSpent}
        eraRerollSpent={rollView.rerollEraSpent}
        controlsDisabled={disabled || !rollView.turn}
        onRerollFranchise={() => onReroll('franchise')}
        onRerollEra={() => onReroll('era')}
      />
      {#if mode === 'duel' && !rollView.turn}
        <div
          class="rival-roll"
          role="status"
          aria-label={`Rival's roll: ${rollView.label}, ${rollFranchiseDisplayName ?? rollView.franchiseId}, ${rollEraLabel}`}
        >
          <span class="rival-roll-pill">Rival's roll</span>
          <span class="rival-roll-main">
            {#if rollFranchise}
              <TeamLogo
                manifest={rollManifest}
                franchiseId={rollView.franchiseId}
                teamExternalId={rollFranchise.teamExternalId}
                logoCandidates={rollIdentity?.logoCandidates ?? []}
              />
            {/if}
            <span class="rival-roll-text">
              <span class="rival-roll-label">{rollView.label}</span>
              <span class="rival-roll-pair">
                {rollFranchiseAbbreviation} · {rollEraLabel}
              </span>
            </span>
          </span>
          <span class="rival-roll-hint">Your rival is picking — your pool opens on your turn.</span>
        </div>
      {:else}
        <ClassicRollReel
          manifest={assets.manifest}
          franchiseId={rollView.franchiseId}
          eraId={rollView.eraId}
          {franchiseOptions}
          {eraOptions}
          axis={rollAxis}
          spinKey={rollNonce}
          spotlight={mode === 'duel' ? 'you' : null}
          announceText={mode === 'duel'
            ? `Your roll: ${rollView.label}, ${rollFranchiseDisplayName ?? rollView.franchiseId}, ${rollEraLabel}`
            : `${rollView.label}: ${rollView.franchiseId} ${rollView.eraId}`}
          roundLabel={mode === 'duel' ? `Your roll · ${rollView.label}` : rollView.label}
          onSettled={() => {}}
        />
      {/if}
    {/if}
    {#if !rollView.complete}
      <DraftPoolBrowser
        heading={poolHeading}
        rows={rollRows}
        slots={myCourtRows}
        countLabel={poolCountLabel}
        manifest={assets.manifest}
        {presentation}
        filtersEditable={true}
        {allowDisplacement}
        selectionDisabled={disabled || !rollView.turn}
        error={null}
        emptyMessage="No players in this pool."
        onpick={openPicker}
      />
    {:else}
      <div class="rounded-xl bg-surface-1">
        <div class="px-3 py-3 sm:px-4">
          <h3 class="font-display text-lg font-extrabold tracking-tight uppercase">Your five</h3>
        </div>
        <ul class="flex flex-col divide-y divide-border/60">
          {#each myPicks as pick (pick.playerId)}
            {@const row = indexById.get(pick.playerId) ?? null}
            <li class="flex min-w-0 items-center gap-3 px-3 py-3 sm:px-4">
              {#if row}
                <PlayerFace
                  player={row}
                  manifest={rollManifest}
                  size="sm"
                  fallbackInitials={row.firstName[0]! + row.lastName[0]!}
                />
                <span class="min-w-0 flex-1 truncate text-sm font-bold">
                  {row.displayName}
                </span>
                <span
                  class="shrink-0 truncate font-mono text-[10px] text-muted-foreground"
                  title={`Slot ${pick.slotIndex + 1}`}
                >
                  {row.seasonKey} · {formatPositions(row.positionsPlayable)} ·
                  {resolveEraTeamIdentity(rollManifest, row.franchiseId, row.eraId)
                    .abbreviationLabel ?? franchiseAbbreviation(row.franchiseId)}
                </span>
              {:else}
                <span class="min-w-0 flex-1 truncate text-sm font-bold">
                  {displayNameOf(pick.playerId)}
                </span>
                <span class="shrink-0 font-mono text-[10px] text-muted-foreground">
                  Slot {pick.slotIndex + 1}
                </span>
              {/if}
            </li>
          {/each}
        </ul>
      </div>
    {/if}
    <LineupCourt
      slots={myCourtRows}
      manifest={assets.manifest}
      ready={rollView.complete}
      allowRemove={false}
      onmove={openPickerForCourt}
      onremove={() => undefined}
    />
    <DraftValuePanel players={resolvedLineupPlayers} {presentation} />
    <LineupSummaryNav slots={myCourtRows} {pickedCount} />
  {/if}

  {#if mode === 'duel' && sandboxDuelView && !sandboxDuelView.complete}
    <div class="min-w-0 rounded-xl bg-surface-1 p-3 sm:p-4">
      <div class="flex items-center justify-between gap-2">
        <h3 class="font-display text-sm font-extrabold uppercase">Duel · alternating free picks</h3>
        <span
          class="shrink-0 rounded-full px-2.5 py-1 font-mono text-[10px] font-extrabold tracking-[0.14em] uppercase {sandboxDuelView.turn
            ? 'bg-primary text-primary-foreground'
            : 'bg-destructive/15 text-destructive'}"
        >
          {sandboxDuelView.turn ? 'Your pick' : "Rival's pick"}
        </span>
      </div>
      <p class="mt-1 text-xs text-muted-foreground" role="status">
        {sandboxDuelView.label} · {sandboxDuelView.turnText} Same player may appear on both teams.
      </p>
    </div>
    <DraftPoolBrowser
      heading="Global pool"
      rows={sandboxDuelRows}
      slots={myCourtRows}
      countLabel={sandboxDuelCountLabel}
      filtersEditable={true}
      manifest={assets.manifest}
      {presentation}
      error={null}
      emptyMessage="No players match."
      allowDisplacement={false}
      selectionDisabled={disabled || !sandboxDuelView.turn}
      onpick={openPicker}
    />
    <LineupCourt
      slots={myCourtRows}
      manifest={assets.manifest}
      ready={false}
      allowRemove={false}
      onmove={openPickerForCourt}
      onremove={() => undefined}
    />
    <DraftValuePanel players={resolvedLineupPlayers} {presentation} />
    <LineupSummaryNav slots={myCourtRows} {pickedCount} />
  {/if}

  {#if mode === 'sandbox-shared-82'}
    <div class="min-w-0 rounded-xl bg-surface-1 p-3 sm:p-4">
      <h3 class="font-display text-sm font-extrabold uppercase">Build your five</h3>
      <p class="mt-1 text-xs text-muted-foreground">
        Same player may appear on both teams. Five minutes to build and lock; timeouts auto-fill
        from safe moves and then lock.
      </p>
    </div>
    <DraftPoolBrowser
      heading="Global pool"
      rows={sandboxRows}
      slots={courtRows}
      countLabel={`${sandboxRows.length} players · ${poolSortLabel(presentation)}`}
      filtersEditable={true}
      manifest={assets.manifest}
      {presentation}
      error={null}
      emptyMessage="No players match."
      allowDisplacement={true}
      selectionDisabled={disabled || sandboxLocked}
      onpick={openPicker}
    />
    <LineupCourt
      slots={courtRows}
      manifest={assets.manifest}
      ready={sandboxLocked}
      allowRemove={!sandboxLocked}
      onmove={openPicker}
      onremove={(index) => onRemove(index as SlotIndex)}
    />
    <DraftValuePanel players={resolvedLineupPlayers} {presentation} />
    {#if !sandboxLocked}
      <div>
        <button
          type="button"
          onclick={onLock}
          disabled={disabled || sandboxLocked}
          class="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-primary px-5 py-3 font-semibold text-primary-foreground transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40 outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          Lock my five
        </button>
      </div>
    {/if}
    <LineupSummaryNav slots={courtRows} {pickedCount} />
  {/if}
</div>

{#if pickerPlayer}
  {#await loadSlotPickerDialog() then { default: SlotPickerDialog }}
    <SlotPickerDialog
      player={pickerPlayer}
      slots={activeCourtRows}
      manifest={assets.manifest}
      {presentation}
      {allowDisplacement}
      onplace={placeWithDisplacement}
      onclose={closePicker}
    />
  {/await}
{/if}

<style>
  .rival-roll {
    display: flex;
    flex-direction: column;
    gap: 0.625rem;
    border-radius: 0.875rem;
    border: 1px dashed color-mix(in srgb, var(--color-destructive) 45%, transparent);
    background: color-mix(in srgb, var(--color-destructive) 6%, transparent);
    padding: 0.875rem 1rem;
  }
  .rival-roll-pill {
    align-self: flex-start;
    border-radius: 999px;
    background: var(--color-destructive);
    color: white;
    font-family: var(--font-mono);
    font-size: 10px;
    font-weight: 800;
    letter-spacing: 0.16em;
    text-transform: uppercase;
    padding: 0.25rem 0.65rem;
  }
  .rival-roll-main {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    min-width: 0;
  }
  .rival-roll-text {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
  }
  .rival-roll-label {
    font-family: var(--font-mono);
    font-size: 11px;
    color: var(--color-muted-foreground);
  }
  .rival-roll-pair {
    font-family: var(--font-display);
    font-size: 1.125rem;
    font-weight: 800;
  }
  .rival-roll-hint {
    font-size: 11px;
    color: var(--color-muted-foreground);
  }
</style>
