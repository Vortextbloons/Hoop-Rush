<script lang="ts">
  import { canPlay } from '@hoop-rush/engine';
  import type {
    FixedFiveParticipantId,
    FixedFiveRoomMode,
    PlayersIndexEntry,
    PlayerId,
    SlotGroup,
    SlotIndex,
  } from '@hoop-rush/data-contracts';
  import ClassicRollReel from '$lib/components/classic/ClassicRollReel.svelte';
  import DraftPoolBrowser from '$lib/components/draft/DraftPoolBrowser.svelte';
  import LineupCourt from '$lib/components/LineupCourt.svelte';
  import PlayerFace from '$lib/components/PlayerFace.svelte';
  import { classicPoolRows } from '$lib/classic-draft';
  import type { DraftPresentation } from '$lib/draft-presentation';
  import type { DraftReplay, FixedFiveAssets } from '$lib/fixed-five-room-state';

  function slotRequirementOf(slot: SlotIndex): SlotGroup {
    if (slot <= 1) return 'G';
    if (slot <= 3) return 'F';
    return 'C';
  }

  let {
    mode,
    selfId,
    replay,
    assets,
    presentation,
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
    disabled?: boolean;
    deadlineText?: string | null;
    lastAutopick?: { displayName: string; seedPath: string } | null;
    error?: string | null;
    onPick: (playerId: PlayerId, slotIndex: SlotIndex) => void;
    onReroll: (axis: 'franchise' | 'era') => void;
    onRemove: (slotIndex: SlotIndex) => void;
    onLock: () => void;
  } = $props();

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
    if (replay.mode === 'classic-shared-82') {
      const draft = selfId === 'p1' ? replay.p1 : replay.p2;
      if (draft.status === 'complete' || !draft.roll) {
        return {
          franchiseId: '',
          eraId: '',
          label: 'Draft complete',
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
    const picker =
      duel.pickOrdinal % 2 === 0 ? duel.firstPicker : duel.firstPicker === 'p1' ? 'p2' : 'p1';
    const mine = duel.picks.filter((p) => p.participantId === selfId).map((p) => p.slotIndex);
    if (duel.status === 'complete' || !duel.currentRoll) {
      return {
        franchiseId: '',
        eraId: '',
        label: 'Duel draft complete',
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
      spinKey: duel.pickOrdinal,
      mySlotsUsed: new Set(mine),
      rerollFranchiseSpent: tokens.franchiseSpent,
      rerollEraSpent: tokens.eraSpent,
      complete: false,
      turn: picker === selfId,
      turnText:
        picker === selfId ? 'Your pick — alternating draft.' : 'Opponent is picking…',
    };
  });

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

  function legalSlotsFor(playerId: PlayerId): SlotIndex[] {
    const candidate = assets.poolById.get(playerId);
    const positions = candidate?.positions ?? [];
    const used = rollView?.mySlotsUsed ?? new Set<SlotIndex>();
    const open: SlotIndex[] = [];
    for (const slot of [0, 1, 2, 3, 4] as SlotIndex[]) {
      if (used.has(slot)) continue;
      if (positions.length > 0 && !canPlay(positions, slotRequirementOf(slot))) continue;
      open.push(slot);
    }
    return open;
  }

  const myPicks = $derived.by((): Array<{ playerId: PlayerId; slotIndex: SlotIndex }> => {
    if (replay.mode === 'duel') {
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

  function displayNameOf(playerId: PlayerId): string {
    return indexById.get(playerId)?.displayName ?? playerId;
  }

  const sandboxRows = $derived(assets.index.players);
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
    replay.mode === 'sandbox-shared-82'
      ? (selfId === 'p1' ? replay.p1 : replay.p2).locked
      : false,
  );
</script>

<div class="mt-2">
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
    <p class="mt-2 rounded-lg border border-destructive/40 bg-destructive/10 p-2 text-xs" role="alert">
      {error}
    </p>
  {/if}

  {#if mode !== 'sandbox-shared-82' && rollView}
    <div class="mt-3 rounded-xl border border-line-soft bg-card p-4">
      <div class="flex flex-wrap items-center justify-between gap-2">
        <h3 class="font-display text-sm font-extrabold uppercase">{rollView.label}</h3>
        <p class="text-xs text-muted-foreground" aria-live="polite">{rollView.turnText}</p>
      </div>
      {#if !rollView.complete}
        <div class="mt-3">
          <ClassicRollReel
            manifest={assets.manifest}
            franchiseId={rollView.franchiseId}
            eraId={rollView.eraId}
            {franchiseOptions}
            {eraOptions}
            spinKey={rollView.spinKey}
            announceText={`${rollView.label}: ${rollView.franchiseId} ${rollView.eraId}`}
            onSettled={() => {}}
          />
        </div>
        <div class="mt-3 flex flex-wrap gap-2">
          <button
            type="button"
            onclick={() => onReroll('franchise')}
            disabled={disabled || rollView.rerollFranchiseSpent || !rollView.turn}
            class="rounded-lg border border-line-soft bg-surface-1 px-3 py-1.5 text-xs font-semibold disabled:opacity-40"
          >
            Reroll franchise{rollView.rerollFranchiseSpent ? ' (spent)' : ''}
          </button>
          <button
            type="button"
            onclick={() => onReroll('era')}
            disabled={disabled || rollView.rerollEraSpent || !rollView.turn}
            class="rounded-lg border border-line-soft bg-surface-1 px-3 py-1.5 text-xs font-semibold disabled:opacity-40"
          >
            Reroll era{rollView.rerollEraSpent ? ' (spent)' : ''}
          </button>
        </div>
        <ul class="mt-3 space-y-2" aria-label="Rolled players">
          {#each rollRows as row (row.playerId)}
            {@const slots = legalSlotsFor(row.playerId)}
            <li class="flex items-center gap-3 rounded-xl border border-line-soft p-2">
              <PlayerFace
                player={row}
                manifest={assets.manifest}
                size="sm"
                fallbackInitials={row.displayName.slice(0, 2)}
              />
              <div class="min-w-0 flex-1">
                <p class="truncate text-sm font-semibold">{row.displayName}</p>
                <p class="text-xs text-muted-foreground">
                  {row.positionsPlayable.join('/')} · score {row.selectionScore.toFixed(1)}
                </p>
              </div>
              <div class="flex flex-wrap gap-1">
                {#each slots as slot (slot)}
                  <button
                    type="button"
                    onclick={() => onPick(row.playerId, slot)}
                    disabled={disabled || !rollView.turn}
                    aria-label={`Draft ${row.displayName} into slot ${slot + 1}`}
                    class="rounded-lg bg-primary px-2.5 py-1.5 text-xs font-bold text-primary-foreground disabled:opacity-40"
                  >
                    S{slot + 1}
                  </button>
                {:else}
                  <span class="text-xs text-muted-foreground">No open slot</span>
                {/each}
              </div>
            </li>
          {/each}
        </ul>
      {:else}
        <ul class="mt-3 space-y-1 text-sm">
          {#each myPicks as pick (pick.playerId)}
            <li>Slot {pick.slotIndex + 1}: {displayNameOf(pick.playerId)}</li>
          {/each}
        </ul>
      {/if}
    </div>
  {/if}

  {#if mode === 'sandbox-shared-82'}
    <div class="mt-3 rounded-xl border border-line-soft bg-card p-4">
      <h3 class="font-display text-sm font-extrabold uppercase">Build your five</h3>
      <p class="mt-1 text-xs text-muted-foreground">
        Same player may appear on both teams. Five minutes to build and lock; timeouts auto-fill
        from safe moves and then lock.
      </p>
      <div class="mt-3">
        <LineupCourt
          slots={courtRows}
          manifest={assets.manifest}
          ready={sandboxLocked}
          allowRemove={!sandboxLocked}
          onmove={(player) => {
            const at = courtRows.findIndex((row) => row?.playerId === player.playerId);
            if (at >= 0) onRemove(at as SlotIndex);
          }}
          onremove={(index) => onRemove(index as SlotIndex)}
        />
      </div>
      <div class="mt-3">
        <DraftPoolBrowser
          heading="Global pool"
          rows={sandboxRows}
          slots={courtRows}
          countLabel={`${sandboxRows.length} players`}
          filtersEditable={true}
          manifest={assets.manifest}
          presentation={presentation}
          error={null}
          emptyMessage="No players match."
          onpick={(player) => {
            const used = new Set(
              courtRows.flatMap((row, i) => (row ? [i as SlotIndex] : [])),
            );
            for (const slot of [0, 1, 2, 3, 4] as SlotIndex[]) {
              if (used.has(slot)) continue;
              if (!canPlay(player.positionsPlayable, slotRequirementOf(slot))) continue;
              onPick(player.playerId, slot);
              return;
            }
          }}
        />
      </div>
      <button
        type="button"
        onclick={onLock}
        disabled={disabled || sandboxLocked}
        class="mt-3 w-full rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground disabled:opacity-40"
      >
        {sandboxLocked ? 'Locked' : 'Lock my five'}
      </button>
    </div>
  {/if}
</div>
