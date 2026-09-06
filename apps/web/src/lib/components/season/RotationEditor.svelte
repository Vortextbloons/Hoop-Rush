<script lang="ts">
  import { ChevronDown, ChevronUp, Star, UserMinus, UserPlus } from '@lucide/svelte';
  import type {
    HoopRushManifest,
    SeasonEffectsState,
    SeasonGameSummary,
  } from '@hoop-rush/data-contracts';
  import SeasonPlayerFace from '$lib/components/season/SeasonPlayerFace.svelte';
  import type { SeasonFaceRef } from '$lib/season/season-branding';
  import { eraIdentityOf } from '$lib/season/season-branding';
  import {
    FATIGUE_BAND_BADGE,
    FATIGUE_BAND_LABEL,
    fatigueBand,
    fatiguePercent,
    loadStateOf,
  } from '$lib/season/season-effects-view';
  import {
    CLOSING_SLOT_LABELS,
    displayRotationFailures,
    indexRotationFailures,
    ROTATION_PRESETS,
    presetLabel,
    type MinuteAdjustment,
    type RotationEditor,
    type RotationMember,
  } from '$lib/season/season-rotation-editor';
  import { formatPositions } from '$lib/player-positions';
  let {
    editor,
    disabled,
    onchange,
    faces = null,
    manifest = null,
    overallByVersion = null,
    effects = null,
    summaries = [],
    onpending = null,
    presetLoad = null,
    presetHorizon = null,
  }: {
    editor: RotationEditor;
    disabled: boolean;
    onchange: (rotation: RotationEditor['rotation'], failures: string[]) => void;
    faces?: ReadonlyMap<string, SeasonFaceRef> | null;
    manifest?: HoopRushManifest | null;
    overallByVersion?: ReadonlyMap<string, number> | null;
    effects?: SeasonEffectsState | null;
    summaries?: SeasonGameSummary[];
    onpending?: ((pending: boolean) => void) | null;
    presetLoad?: ReadonlyArray<{
      playerVersionId: string;
      staminaRating: number;
      durability: number;
      fatigueBasisPoints: number;
      recentLoadBasisPoints: number;
    }> | null;
    presetHorizon?: number | null;
  } = $props();
  const rows = $derived.by(() => {
    void revision;
    return editor.rows();
  });
  const rowByVersion = $derived(
    new Map(rows.map((row) => [row.member.playerVersionId, row] as const)),
  );
  const starterIds = $derived.by(() => {
    void revision;
    return editor.rotation.starters;
  });
  const benchIds = $derived.by(() => {
    void revision;
    return editor.rotation.benchOrder;
  });
  const closingIds = $derived.by(() => {
    void revision;
    return editor.rotation.closingFive;
  });
  const activeOrdered = $derived.by(() => {
    void revision;
    const byId = new Map(rows.map((row) => [row.member.playerVersionId, row] as const));
    const starters = starterIds
      .map((id, slotIndex) => {
        const row = byId.get(id);
        if (row === undefined) return null;
        return { ...row, activePos: slotIndex + 1, isStarter: true, slotIndex };
      })
      .filter((row) => row !== null);
    const bench = benchIds
      .map((id, benchIndex) => {
        const row = byId.get(id);
        if (row === undefined) return null;
        return { ...row, activePos: benchIndex + 6, isStarter: false, slotIndex: benchIndex };
      })
      .filter((row) => row !== null);
    return [...starters, ...bench];
  });
  const minutesTotal = $derived(rows.reduce((sum, row) => sum + row.minutes, 0));
  const minutesRemaining = $derived(240 - minutesTotal);
  const rawFailures = $derived.by(() => {
    void revision;
    return [...editor.validate(), ...attemptFailures];
  });
  const failureIndex = $derived(indexRotationFailures(rawFailures));
  const humanizedGlobal = $derived(displayRotationFailures(failureIndex.global, editor.names));
  const closingValid = $derived(!rawFailures.some((failure) => failure.includes('closing')));
  let swap: {
    kind: 'promote' | 'demote';
    playerVersionId: string;
  } | null = $state(null);
  let swapNotice: string | null = $state(null);
  let attemptFailures: string[] = $state([]);
  const inactiveRows = $derived.by(() => {
    void revision;
    return editor.inactiveMembers();
  });
  let highlightIds = $state<ReadonlySet<string>>(new Set());
  let rebalanceNotice: string | null = $state(null);
  let appliedPreset: string | null = $state(null);
  let editingId: string | null = $state(null);
  let editingMinutes: number | null = $state(null);
  let draft = $state('');
  let editError: { playerVersionId: string; message: string } | null = $state(null);
  let editingInput: HTMLInputElement | null = $state(null);
  let revision = $state(0);
  const minutesProgress = $derived(Math.min(100, Math.round((minutesTotal / 240) * 100)));
  $effect(() => {
    if (editingId !== null && editingInput !== null) {
      editingInput.focus();
      editingInput.select();
    }
  });
  $effect(() => {
    onpending?.(swap !== null);
  });
  function emit() {
    onchange(editor.rotation, editor.validate());
  }
  function succeed() {
    attemptFailures = [];
    editError = null;
    revision += 1;
    emit();
  }
  function fail(failuresAfter: string[]) {
    attemptFailures = failuresAfter;
  }
  function humanizedFor(playerVersionId: string): string[] | null {
    const raw = failureIndex.byPlayer.get(playerVersionId) ?? null;
    if (raw === null) return null;
    return displayRotationFailures(raw, editor.names);
  }
  function flashAdjustments(adjustments: MinuteAdjustment[]) {
    if (adjustments.length === 0) return;
    highlightIds = new Set(adjustments.map((a) => a.playerVersionId));
    rebalanceNotice = buildRebalanceNotice(adjustments);
  }
  function buildRebalanceNotice(adjustments: MinuteAdjustment[]): string {
    const target = adjustments[0];
    if (target === undefined) return '';
    const nameOf = (id: string) => editor.names.get(id) ?? id;
    const others = adjustments.slice(1).map((a) => ({ ...a, name: nameOf(a.playerVersionId) }));
    const tail =
      others.length === 0
        ? ''
        : others.length === 1 && others[0] !== undefined
          ? ` · ${target.delta > 0 ? 'took' : 'gave'} ${Math.abs(others[0].delta)} from ${others[0].name}`
          : ` · ${target.delta > 0 ? 'took' : 'gave'} ${others
              .map((o) => `${Math.abs(o.delta)} from ${o.name}`)
              .join(', ')}`;
    const sign = target.delta > 0 ? '+' : '';
    return `${sign}${String(target.delta)} ${nameOf(target.playerVersionId)} ${String(target.minutes)} min${tail}`;
  }
  function changeMinutes(playerVersionId: string, delta: number) {
    if (disabled) return;
    const result = editor.rebalanceMinutes(
      playerVersionId,
      editor.minutesFor(playerVersionId) + delta,
    );
    if (result.failures.length === 0) {
      appliedPreset = null;
      flashAdjustments(result.adjustments);
      succeed();
    } else {
      fail(result.failures);
      revision += 1;
    }
  }
  function startEdit(playerVersionId: string, current: number) {
    if (disabled) return;
    editingId = playerVersionId;
    editingMinutes = current;
    draft = String(current);
    editError = null;
  }
  function cancelEdit() {
    editingId = null;
    editingMinutes = null;
    draft = '';
    editError = null;
  }
  function commitEdit() {
    const targetId = editingId;
    const current = editingMinutes;
    const parsed = Number.parseInt(draft, 10);
    if (targetId === null || current === null || disabled) return;
    if (!Number.isInteger(parsed) || Number.isNaN(parsed)) {
      const displayName = editor.names.get(targetId) ?? targetId;
      editError = {
        playerVersionId: targetId,
        message: `Target minutes for ${displayName} must be a whole number from 0-48.`,
      };
      return;
    }
    const activeRow = rowByVersion.get(targetId);
    if (activeRow !== undefined && parsed === activeRow.minutes) {
      cancelEdit();
      return;
    }
    editingId = null;
    editingMinutes = null;
    draft = '';
    editError = null;
    const result = editor.rebalanceMinutes(targetId, parsed);
    if (result.failures.length === 0) {
      appliedPreset = null;
      flashAdjustments(result.adjustments);
      succeed();
    } else {
      fail(result.failures);
      revision += 1;
    }
  }
  function changeStarter(slotIndex: number, playerVersionId: string) {
    if (disabled) return;
    const failuresAfter = editor.assignStarter(slotIndex, playerVersionId);
    if (failuresAfter.length === 0) {
      appliedPreset = null;
      succeed();
    } else {
      fail(failuresAfter);
      revision += 1;
    }
  }
  function toggleClosingFor(playerVersionId: string) {
    if (disabled) return;
    const failuresAfter = editor.toggleClosing(playerVersionId);
    if (failuresAfter.length === 0) {
      appliedPreset = null;
      succeed();
    } else {
      fail(failuresAfter);
      revision += 1;
    }
  }
  function moveBenchRow(benchIndex: number, delta: -1 | 1) {
    if (disabled) return;
    const failuresAfter = editor.moveBench(benchIndex, delta);
    if (failuresAfter.length === 0) {
      appliedPreset = null;
      if (failuresAfter.length === 0 && editor.validate().length === 0) {
        attemptFailures = [];
      }
      revision += 1;
      emit();
    } else {
      fail(failuresAfter);
      revision += 1;
    }
  }
  function openSwap(kind: 'promote' | 'demote', playerVersionId: string) {
    if (disabled) return;
    attemptFailures = [];
    swap = { kind, playerVersionId };
  }
  function closeSwap() {
    swap = null;
  }
  function commitSwap(inactiveId: string, activeId: string) {
    if (disabled || swap === null) return;
    const failuresAfter = editor.promoteToRotation(inactiveId, activeId);
    swap = null;
    if (failuresAfter.length === 0) {
      const inactiveName = editor.names.get(inactiveId) ?? inactiveId;
      const activeName = editor.names.get(activeId) ?? activeId;
      swapNotice = `${inactiveName} joined the rotation replacing ${activeName}. Takes effect at the next block lock.`;
      appliedPreset = null;
      succeed();
    } else {
      fail(failuresAfter);
      revision += 1;
    }
  }
  function applyPreset(preset: (typeof ROTATION_PRESETS)[number]) {
    if (disabled) return;
    const failures = editor.applyPreset(preset, presetContext());
    if (failures.length > 0) {
      fail(failures);
      revision += 1;
      return;
    }
    rebalanceNotice = `Applied ${presetLabel(preset)} preset.`;
    highlightIds = new Set();
    succeed();
    appliedPreset = preset;
  }
  function presetContext(): {
    overallByVersion?: ReadonlyMap<string, number> | null;
    loadByVersion?: ReadonlyMap<
      string,
      {
        staminaRating: number;
        durability: number;
        fatigueBasisPoints: number;
        recentLoadBasisPoints: number;
      }
    > | null;
    horizonGames?: number | null;
  } {
    const loadByVersion = new Map<
      string,
      {
        staminaRating: number;
        durability: number;
        fatigueBasisPoints: number;
        recentLoadBasisPoints: number;
      }
    >();
    for (const row of presetLoad ?? []) {
      loadByVersion.set(row.playerVersionId, {
        staminaRating: row.staminaRating,
        durability: row.durability,
        fatigueBasisPoints: row.fatigueBasisPoints,
        recentLoadBasisPoints: row.recentLoadBasisPoints,
      });
    }
    if (effects !== null) {
      const states = new Map(
        [...effects.playerStates, ...effects.inactivePlayerStates].map((state) => [
          state.playerVersionId,
          state,
        ]),
      );
      for (const id of editor.activeMemberIds()) {
        if (loadByVersion.has(id)) continue;
        const state = states.get(id);
        if (state === undefined) continue;
        loadByVersion.set(id, {
          staminaRating: 70,
          durability: 70,
          fatigueBasisPoints: state.fatigueBasisPoints,
          recentLoadBasisPoints: state.recentLoadBasisPoints,
        });
      }
    }
    return {
      overallByVersion,
      loadByVersion: loadByVersion.size > 0 ? loadByVersion : null,
      horizonGames: presetHorizon,
    };
  }
  function scrollToRow(playerVersionId: string) {
    highlightIds = new Set([playerVersionId]);
    if (typeof document === 'undefined') return;
    const el = document.getElementById(`rotation-row-${playerVersionId}`);
    if (el === null) return;
    const reduced =
      typeof window !== 'undefined' &&
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    el.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block: 'center' });
  }
  function faceOf(playerVersionId: string): SeasonFaceRef | null {
    return faces?.get(playerVersionId) ?? null;
  }
  function fatigueOf(row: (typeof rows)[number]): {
    label: string;
    badge: string;
    percent: number;
  } | null {
    if (effects === null) return null;
    const load = loadStateOf(effects, row.member.playerVersionId);
    if (load === null) return null;
    const band = fatigueBand(load.fatigueBasisPoints);
    return {
      label: FATIGUE_BAND_LABEL[band],
      badge: FATIGUE_BAND_BADGE[band],
      percent: fatiguePercent(load.fatigueBasisPoints),
    };
  }
  function eraLabelOf(member: RotationMember): string | null {
    if (manifest === null || member.franchiseId === undefined || member.eraId === undefined) {
      return null;
    }
    const label = eraIdentityOf(manifest, member.franchiseId, member.eraId).displayLabel;
    return label;
  }
  function highlightOf(playerVersionId: string): string {
    return highlightIds.has(playerVersionId) ? ' ring-2 ring-primary' : '';
  }
</script>

<div class="flex min-w-0 flex-col gap-4">
  <div class="flex flex-col gap-3">
    <div>
      <h2 class="font-display text-base font-extrabold uppercase tracking-tight">Rotation</h2>
      <p class="mt-0.5 text-xs text-muted-foreground">
        Set your starters, minutes, and closing five.
      </p>
    </div>
    <div>
      <div class="grid grid-cols-3 gap-2" role="group" aria-label="Minute strategies">
        {#each ROTATION_PRESETS as preset (preset)}
          <button
            type="button"
            onclick={() => applyPreset(preset)}
            {disabled}
            aria-pressed={appliedPreset === preset ? 'true' : 'false'}
            class="min-h-11 rounded-lg px-2 py-1.5 text-xs font-semibold transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-40 sm:text-sm motion-reduce:transition-none {appliedPreset ===
            preset
              ? 'bg-primary text-primary-foreground'
              : 'bg-surface-2 hover:bg-surface-3'}"
          >
            {presetLabel(preset)}
          </button>
        {/each}
      </div>
      <p class="mt-1.5 text-xs text-muted-foreground">
        Presets retune target minutes from ratings, stamina, and fatigue. Starters and closing five
        stay the same.
      </p>
    </div>
  </div>

  <div class="flex flex-col gap-2">
    <p class="text-base font-bold break-words" aria-live="polite">
      {minutesTotal} / 240 minutes assigned
      {#if minutesRemaining !== 0}
        <span class="text-destructive">· {Math.abs(minutesRemaining)} remaining</span>
      {:else}
        <span class="text-positive">✓</span>
      {/if}
    </p>
    <p
      class="inline-flex items-center gap-1 font-mono text-[10px]"
      aria-label={closingValid ? 'Closing five valid' : 'Closing five needs work'}
    >
      <span
        aria-hidden="true"
        class="inline-block h-2 w-2 rounded-full {closingValid ? 'bg-positive' : 'bg-destructive'}"
      ></span>
      {closingValid ? '5 closers set' : 'Closers need work'}
    </p>
    <div
      class="h-2 overflow-hidden rounded-full bg-surface-2"
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={240}
      aria-valuenow={minutesTotal}
      aria-label="Target minutes total"
    >
      <div
        class="h-full rounded-full transition-[width] duration-200 motion-reduce:transition-none {minutesTotal ===
        240
          ? 'bg-positive'
          : 'bg-primary'}"
        style:width="{minutesProgress}%"
      ></div>
    </div>
    {#if rebalanceNotice !== null}
      <p role="status" class="text-xs font-semibold text-primary">{rebalanceNotice}</p>
    {/if}
  </div>

  <section
    aria-labelledby="active10-heading"
    class="min-w-0 overflow-x-hidden rounded-none bg-surface-1 p-3 sm:rounded-xl"
  >
    <h3
      id="active10-heading"
      class="font-mono text-[11px] font-bold uppercase tracking-[0.14em] text-muted-foreground"
    >
      Active 10
    </h3>

    <ol class="mt-2 flex flex-col gap-2" aria-label="Active 10 in playing order">
      {#each activeOrdered as row, index (row.member.playerVersionId)}
        {#if index === 0}
          <li
            aria-hidden="true"
            class="pt-1 font-mono text-[10px] font-bold uppercase tracking-[0.14em] text-muted-foreground"
          >
            Starters
          </li>
        {/if}
        {#if index === 5}
          <li
            aria-hidden="true"
            class="pt-2 font-mono text-[10px] font-bold uppercase tracking-[0.14em] text-muted-foreground"
          >
            Bench
          </li>
        {/if}
        {@const rowFailures = humanizedFor(row.member.playerVersionId)}
        {@const fatigue = fatigueOf(row)}
        {@const isCloser = row.closingIndex !== -1}
        <li
          id="rotation-row-{row.member.playerVersionId}"
          data-rotation-active-row
          data-player-version-id={row.member.playerVersionId}
          aria-label="{row.member.displayName}, {row.role}, {row.minutes} minutes"
          class="flex scroll-mt-24 flex-col gap-2 rounded-none bg-surface-2/60 p-3 outline-none focus-visible:ring-2 focus-visible:ring-ring sm:rounded-xl md:flex-row md:items-center md:gap-3{highlightOf(
            row.member.playerVersionId,
          )}"
        >
          <div class="flex min-w-0 flex-1 items-start gap-2 md:items-center md:gap-3">
            <span
              class="w-8 shrink-0 pt-0.5 font-mono text-[10px] font-bold uppercase text-muted-foreground md:pt-0"
              aria-hidden="true"
            >
              {#if row.isStarter}S{row.slotIndex + 1}{:else}B{row.slotIndex + 1}{/if}
            </span>
            {#if manifest !== null && faceOf(row.member.playerVersionId) !== null}
              <SeasonPlayerFace
                face={faceOf(row.member.playerVersionId)!}
                {manifest}
                size="sm"
                eager={row.activePos <= 2}
              />
            {/if}
            <div class="min-w-0 flex-1">
              <p class="text-sm font-semibold leading-snug">
                {row.member.displayName}
                {#if isCloser}
                  <span
                    class="ml-1.5 inline-flex items-center rounded-full bg-primary/15 px-1.5 py-0.5 font-mono text-[10px] font-bold text-primary"
                  >
                    Closer
                  </span>
                {/if}
              </p>
              <div class="mt-1 flex min-w-0 flex-wrap items-center gap-1.5">
                {#if overallByVersion?.has(row.member.playerVersionId)}
                  <span
                    class="shrink-0 rounded bg-surface-3 px-1.5 py-0.5 font-mono text-[10px] font-bold text-foreground"
                  >
                    OVR {overallByVersion.get(row.member.playerVersionId)}
                  </span>
                {/if}
                {#if fatigue !== null}
                  <span
                    class={`shrink-0 rounded-full px-2 py-0.5 font-mono text-[10px] font-bold ${fatigue.badge}`}
                  >
                    {fatigue.label}
                    {fatigue.percent}%
                  </span>
                {/if}
                {#if row.isStarter}
                  <span
                    class="shrink-0 rounded-full bg-surface-3 px-2 py-0.5 font-mono text-[10px] font-bold text-muted-foreground"
                  >
                    Starter
                  </span>
                {:else}
                  <span
                    class="shrink-0 rounded-full bg-surface-3 px-2 py-0.5 font-mono text-[10px] font-bold text-muted-foreground"
                  >
                    Bench {row.slotIndex + 1}
                  </span>
                {/if}
              </div>
              <p class="mt-1 font-mono text-[10px] leading-snug text-muted-foreground">
                {#if row.member.playable.length > 0}{formatPositions(row.member.playable)}{/if}
                {#if row.member.seasonKey !== undefined}
                  · {row.member.seasonKey}{/if}
              </p>
            </div>
          </div>
          <div class="flex w-full min-w-0 flex-col gap-2 md:w-auto md:shrink-0">
            <div
              class="flex min-w-0 flex-col gap-2 md:flex-row md:items-center md:gap-2"
            >
              <div class="flex min-w-0 flex-wrap items-center gap-1.5 md:gap-2">
                {#if row.isStarter}
                  <select
                    value={row.member.playerVersionId}
                    {disabled}
                    aria-label={`Starter slot ${row.slotIndex + 1}`}
                    aria-invalid={rowFailures !== null ? 'true' : undefined}
                    aria-describedby={rowFailures !== null
                      ? `rotation-failure-${row.member.playerVersionId}`
                      : undefined}
                    onchange={(event) =>
                      changeStarter(row.slotIndex, (event.currentTarget as HTMLSelectElement).value)}
                    class="min-h-11 min-w-0 w-full rounded-lg bg-surface-2 px-3 py-2 text-sm font-semibold outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-40 md:min-h-11 md:w-48 md:flex-none"
                  >
                    {#each editor.eligibleForSlot(row.slotIndex) as member (member.playerVersionId)}
                      <option value={member.playerVersionId}>{member.displayName}</option>
                    {/each}
                  </select>
                {:else}
                  <div
                    class="flex items-center gap-1"
                    role="group"
                    aria-label={`Bench order for ${row.member.displayName}`}
                  >
                    <button
                      type="button"
                      aria-label={`Move ${row.member.displayName} up in bench order`}
                      onclick={() => moveBenchRow(row.slotIndex, -1)}
                      disabled={disabled || row.slotIndex === 0}
                      class="grid h-10 w-10 place-items-center rounded-lg bg-surface-2 text-muted-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring hover:bg-surface-3 hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40 motion-reduce:transition-none sm:h-11 sm:w-11"
                    >
                      <ChevronUp class="h-4 w-4" />
                    </button>
                    <button
                      type="button"
                      aria-label={`Move ${row.member.displayName} down in bench order`}
                      onclick={() => moveBenchRow(row.slotIndex, 1)}
                      disabled={disabled || row.slotIndex === 4}
                      class="grid h-10 w-10 place-items-center rounded-lg bg-surface-2 text-muted-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring hover:bg-surface-3 hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40 motion-reduce:transition-none sm:h-11 sm:w-11"
                    >
                      <ChevronDown class="h-4 w-4" />
                    </button>
                  </div>
                {/if}
                <button
                  type="button"
                  aria-pressed={row.closingIndex !== -1 ? 'true' : 'false'}
                  aria-label={row.closingIndex !== -1
                    ? `Remove ${row.member.displayName} from closing five`
                    : `Add ${row.member.displayName} to closing five`}
                  onclick={() => toggleClosingFor(row.member.playerVersionId)}
                  {disabled}
                  class="inline-flex h-10 min-h-10 shrink-0 items-center gap-1 rounded-lg px-2 outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-40 transition-colors motion-reduce:transition-none sm:h-11 sm:min-h-11 sm:px-2.5 {row.closingIndex !==
                  -1
                    ? 'bg-primary/15 text-primary'
                    : 'bg-surface-2 text-muted-foreground hover:bg-surface-3'}"
                >
                  <Star class="h-4 w-4" fill={row.closingIndex !== -1 ? 'currentColor' : 'none'} />
                  <span class="font-mono text-[10px] font-bold">CLOSE</span>
                </button>
                {#if inactiveRows.length > 0}
                  <button
                    type="button"
                    aria-label={`Demote ${row.member.displayName} to inactive`}
                    onclick={() => openSwap('demote', row.member.playerVersionId)}
                    {disabled}
                    class="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-surface-2 text-muted-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring hover:bg-surface-3 hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40 motion-reduce:transition-none sm:h-11 sm:w-11"
                  >
                    <UserMinus class="h-4 w-4" />
                  </button>
                {/if}
              </div>
              <div class="flex shrink-0 justify-end md:justify-start">
                {@render minutesControl(row)}
              </div>
            </div>
            {#if swap?.kind === 'demote' && swap.playerVersionId === row.member.playerVersionId}
              {@render swapPicker(inactiveRows, (optionId) =>
                commitSwap(optionId, row.member.playerVersionId),
              )}
            {/if}
            {#if editError !== null && editError.playerVersionId === row.member.playerVersionId}
              <p role="alert" class="text-xs font-semibold text-destructive">{editError.message}</p>
            {/if}
            {#if rowFailures !== null}
              <ul
                id="rotation-failure-{row.member.playerVersionId}"
                class="list-inside list-disc pl-1 text-xs text-destructive"
              >
                {#each rowFailures as failure, failureIndex (failureIndex)}
                  <li>{failure}</li>
                {/each}
              </ul>
            {/if}
          </div>
        </li>
      {/each}
    </ol>
  </section>

  {#if humanizedGlobal.length > 0}
    <div
      role="alert"
      data-rotation-global-failures
      class="rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm"
    >
      <p class="font-semibold">This rotation cannot be submitted:</p>
      <ul class="mt-1 list-inside list-disc text-muted-foreground">
        {#each humanizedGlobal as failure, failureIndex (failureIndex)}
          <li>{failure}</li>
        {/each}
      </ul>
    </div>
  {/if}

  <section
    aria-labelledby="closing-strip-heading"
    data-rotation-closing-strip
    class="rounded-none bg-surface-1 p-3 sm:rounded-xl"
  >
    <div class="flex items-center justify-between gap-2">
      <h3
        id="closing-strip-heading"
        class="font-mono text-[11px] font-bold uppercase tracking-[0.14em] text-muted-foreground"
      >
        Closing five
      </h3>
      <span class="font-mono text-[10px] text-muted-foreground">tap a chip to find the row</span>
    </div>
    <ul class="mt-2 flex flex-wrap gap-1.5" aria-label="Current closing five">
      {#each closingIds as playerVersionId, slotIndex (slotIndex)}
        {@const row = rowByVersion.get(playerVersionId)}
        <li>
          <button
            type="button"
            data-closing-chip={playerVersionId}
            onclick={() => scrollToRow(playerVersionId)}
            aria-label={`Show ${row?.member.displayName ?? playerVersionId} in Active 10`}
            class="flex min-h-11 items-center gap-1.5 rounded-full bg-surface-2 py-1 pr-3 pl-1 font-mono text-xs font-semibold text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring hover:bg-surface-3 motion-reduce:transition-none"
          >
            {#if manifest !== null && faceOf(playerVersionId) !== null}
              <SeasonPlayerFace face={faceOf(playerVersionId)!} {manifest} size="sm" />
            {/if}
            <span class="text-muted-foreground">{CLOSING_SLOT_LABELS[slotIndex]}</span>
            <span class="max-w-40 truncate">{row?.member.displayName ?? playerVersionId}</span>
          </button>
        </li>
      {/each}
    </ul>
    <p class="mt-2 text-xs text-muted-foreground">
      Finishes close games when available. Change it with the CLOSE toggles above.
    </p>
  </section>

  {#if inactiveRows.length > 0}
    <details
      data-rotation-inactive-section
      class="group rounded-none border-y border-dashed border-border bg-surface-1/60 p-3 sm:rounded-xl sm:border"
    >
      <summary
        class="flex min-h-11 cursor-pointer list-none items-center justify-between gap-2 rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-ring [&::-webkit-details-marker]:hidden"
      >
        <span
          id="inactive-heading"
          class="font-mono text-[11px] font-bold uppercase tracking-[0.14em] text-muted-foreground"
        >
          Inactive depth · does not play · {inactiveRows.length}
        </span>
        <span
          aria-hidden="true"
          class="grid h-11 w-11 shrink-0 place-items-center rounded-lg bg-surface-2 text-muted-foreground group-open:rotate-180 motion-reduce:transition-none"
        >
          <ChevronDown class="h-4 w-4" />
        </span>
      </summary>
      <p class="mt-1 text-xs text-muted-foreground">
        These players remain on your roster but receive no minutes. Swap one into the active 10 to
        make them eligible for the next block.
      </p>
      <ul class="mt-2 flex flex-col divide-y divide-border/60">
        {#each inactiveRows as member (member.playerVersionId)}
          {@const eraLabel = eraLabelOf(member)}
          {@const open =
            swap?.kind === 'promote' && swap.playerVersionId === member.playerVersionId}
          <li data-rotation-inactive-row class="flex flex-col gap-2 py-2.5 sm:py-2">
            <div
              class="grid min-w-0 grid-cols-1 gap-2 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center sm:gap-3"
            >
              <div class="flex min-w-0 items-start gap-2 sm:items-center sm:gap-3">
                {#if manifest !== null && faceOf(member.playerVersionId) !== null}
                  <SeasonPlayerFace face={faceOf(member.playerVersionId)!} {manifest} size="sm" />
                {/if}
                <div class="min-w-0 flex-1">
                  <p class="text-sm font-semibold leading-snug">{member.displayName}</p>
                  <div class="mt-1 flex min-w-0 flex-wrap items-center gap-1.5">
                    {#if overallByVersion?.has(member.playerVersionId)}
                      <span
                        class="shrink-0 rounded bg-surface-3 px-1.5 py-0.5 font-mono text-[10px] font-bold text-foreground"
                      >
                        OVR {overallByVersion.get(member.playerVersionId)}
                      </span>
                    {/if}
                    <span
                      class="shrink-0 rounded-full bg-surface-3 px-2 py-0.5 font-mono text-[10px] font-bold text-muted-foreground"
                    >
                      Inactive
                    </span>
                  </div>
                  <p class="mt-1 font-mono text-[10px] leading-snug text-muted-foreground">
                    {member.seasonKey ?? ''}
                    {#if member.playable.length > 0}· {formatPositions(member.playable)}{/if}
                  </p>
                  {#if eraLabel !== null}
                    <p
                      class="mt-0.5 line-clamp-2 font-mono text-[9px] leading-snug text-muted-foreground/70"
                    >
                      {eraLabel}
                    </p>
                  {/if}
                </div>
              </div>
              <div class="flex justify-end sm:justify-start">
                <button
                  type="button"
                  aria-expanded={open ? 'true' : 'false'}
                  aria-label={`Promote ${member.displayName} to the rotation`}
                  data-promote-button
                  onclick={() => (open ? closeSwap() : openSwap('promote', member.playerVersionId))}
                  {disabled}
                  class="inline-flex min-h-11 items-center gap-1.5 rounded-lg bg-surface-2 px-3 py-1.5 text-xs font-semibold outline-none focus-visible:ring-2 focus-visible:ring-ring hover:bg-surface-3 disabled:cursor-not-allowed disabled:opacity-40 motion-reduce:transition-none"
                >
                  <UserPlus class="h-4 w-4" />
                  {open ? 'Cancel swap' : 'Swap into active 10'}
                </button>
              </div>
            </div>
            {#if open}
              {@render swapPicker(
                editor
                  .activeMemberIds()
                  .map((activeId) => rowByVersion.get(activeId)?.member)
                  .filter((member) => member !== undefined),
                (optionId) => commitSwap(member.playerVersionId, optionId),
              )}
            {/if}
          </li>
        {/each}
      </ul>
    </details>
  {/if}

  {#if swapNotice !== null}
    <p role="status" class="text-xs font-semibold text-primary">{swapNotice}</p>
  {/if}
</div>

{#snippet swapPicker(options: RotationMember[], onPick: (optionPlayerVersionId: string) => void)}
  <div
    class="rounded-lg bg-surface-2 p-3"
    role="group"
    aria-label="Choose the player to swap into the rotation"
  >
    <p class="font-mono text-[10px] font-bold uppercase tracking-[0.14em] text-muted-foreground">
      Replace who?
    </p>
    <ul class="mt-2 flex flex-col gap-1">
      {#each options as option (option.playerVersionId)}
        {@const optionRow = rowByVersion.get(option.playerVersionId)}
        <li>
          <button
            type="button"
            data-promote-option
            onclick={() => onPick(option.playerVersionId)}
            class="flex min-h-11 w-full items-center justify-between gap-2 rounded-lg px-2.5 py-2 text-left text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring hover:bg-surface-3 motion-reduce:transition-none"
          >
            <span class="min-w-0 truncate font-semibold">{option.displayName}</span>
            <span class="shrink-0 font-mono text-[10px] text-muted-foreground">
              {optionRow?.role ?? 'Inactive'}
            </span>
          </button>
        </li>
      {/each}
    </ul>
    <button
      type="button"
      onclick={closeSwap}
      class="mt-2 inline-flex min-h-11 items-center rounded px-2 py-1 text-xs font-semibold text-muted-foreground underline-offset-2 outline-none focus-visible:ring-2 focus-visible:ring-ring hover:text-foreground"
    >
      Cancel
    </button>
  </div>
{/snippet}

{#snippet minutesControl(row: (typeof activeOrdered)[number])}
  <div
    class="flex shrink-0 items-center gap-1"
    role="group"
    aria-label={`Minutes for ${row.member.displayName}`}
  >
    <button
      type="button"
      aria-label={`Decrease minutes for ${row.member.displayName}`}
      onclick={() => changeMinutes(row.member.playerVersionId, -1)}
      {disabled}
      class="grid h-10 w-10 place-items-center rounded-lg bg-surface-2 text-base font-bold outline-none focus-visible:ring-2 focus-visible:ring-ring hover:bg-surface-3 disabled:opacity-40 motion-reduce:transition-none sm:h-11 sm:w-11"
    >
      −
    </button>
    {#if editingId === row.member.playerVersionId}
      <input
        bind:this={editingInput}
        value={draft}
        oninput={(event) => {
          draft = (event.currentTarget as HTMLInputElement).value;
        }}
        onkeydown={(event) => {
          if (event.key === 'Enter') commitEdit();
          else if (event.key === 'Escape') cancelEdit();
        }}
        onblur={commitEdit}
        inputmode="numeric"
        pattern="[0-9]*"
        autocomplete="off"
        aria-label={`Target minutes for ${row.member.displayName}`}
        aria-invalid={editError?.playerVersionId === row.member.playerVersionId
          ? 'true'
          : undefined}
        class="h-10 w-12 rounded-md bg-surface-2 px-1 text-center font-mono text-sm font-bold tabular-nums outline-none focus-visible:ring-2 focus-visible:ring-ring sm:h-11"
      />
    {:else}
      <button
        type="button"
        aria-label={`Edit target minutes for ${row.member.displayName}, currently ${row.minutes} minutes`}
        onclick={() => startEdit(row.member.playerVersionId, row.minutes)}
        {disabled}
        class="h-10 w-12 rounded-md text-center font-mono text-sm font-bold tabular-nums outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-40 sm:h-11"
      >
        {row.minutes}
      </button>
    {/if}
    <button
      type="button"
      aria-label={`Increase minutes for ${row.member.displayName}`}
      onclick={() => changeMinutes(row.member.playerVersionId, 1)}
      {disabled}
      class="grid h-10 w-10 place-items-center rounded-lg bg-surface-2 text-base font-bold outline-none focus-visible:ring-2 focus-visible:ring-ring hover:bg-surface-3 disabled:opacity-40 motion-reduce:transition-none sm:h-11 sm:w-11"
    >
      +
    </button>
  </div>
{/snippet}
