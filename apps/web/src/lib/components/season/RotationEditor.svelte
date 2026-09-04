<script lang="ts">import { ChevronDown, ChevronUp, Star, UserMinus, UserPlus } from '@lucide/svelte';
import type { HoopRushManifest, SeasonEffectsState, SeasonGameSummary, SeasonRotation, } from '@hoop-rush/data-contracts';
import { minuteStrategyOfPreset, type MinutePlanOptimizationResult } from '@hoop-rush/engine';
import SeasonPlayerFace from '$lib/components/season/SeasonPlayerFace.svelte';
import type { SeasonFaceRef } from '$lib/season/season-branding';
import { eraIdentityOf } from '$lib/season/season-branding';
import { FATIGUE_BAND_BADGE, FATIGUE_BAND_LABEL, fatigueBand, fatiguePercent, loadStateOf, } from '$lib/season/season-effects-view';
import { indexRotationFailures, ROTATION_PRESETS, presetLabel, type MinuteAdjustment, type RotationEditor, type RotationMember, } from '$lib/season/season-rotation-editor';
import { formatPositions, SLOT_LABELS } from '$lib/player-positions';
let { editor, disabled, onchange, faces = null, manifest = null, overallByVersion = null, effects = null, summaries = [], optimize = null, }: {
    editor: RotationEditor;
    disabled: boolean;
    onchange: (rotation: RotationEditor['rotation'], failures: string[]) => void;
    faces?: ReadonlyMap<string, SeasonFaceRef> | null;
    manifest?: HoopRushManifest | null;
    overallByVersion?: ReadonlyMap<string, number> | null;
    effects?: SeasonEffectsState | null;
    summaries?: SeasonGameSummary[];
    optimize?: {
        run: (rotation: SeasonRotation) => Promise<MinutePlanOptimizationResult>;
        busy: boolean;
        error: string | null;
    } | null;
} = $props();
const rows = $derived.by(() => {
    void revision;
    return editor.rows();
});
const rowByVersion = $derived(new Map(rows.map((row) => [row.member.playerVersionId, row] as const)));
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
const orderedRows = $derived.by(() => {
    void revision;
    return [
        ...starterIds.map((id) => rowByVersion.get(id)).filter((row) => row !== undefined),
        ...benchIds.map((id) => rowByVersion.get(id)).filter((row) => row !== undefined),
    ];
});
const minutesTotal = $derived(rows.reduce((sum, row) => sum + row.minutes, 0));
const minutesRemaining = $derived(240 - minutesTotal);
const failures = $derived.by(() => {
    void revision;
    return editor.validate();
});
const failureIndex = $derived(indexRotationFailures(failures));
let rejection: string | null = $state(null);
let swap: {
    kind: 'promote' | 'demote';
    playerVersionId: string;
} | null = $state(null);
let swapNotice: string | null = $state(null);
let swapNoticeTimer: ReturnType<typeof setTimeout> | null = null;
const inactiveRows = $derived.by(() => {
    void revision;
    return editor.inactiveMembers();
});
let highlightIds = $state<ReadonlySet<string>>(new Set());
let rebalanceNotice: string | null = $state(null);
let noticeTimer: ReturnType<typeof setTimeout> | null = null;
let editingId: string | null = $state(null);
let editingMinutes: number | null = $state(null);
let draft = $state('');
let editingInput: HTMLInputElement | null = $state(null);
let revision = $state(0);
let optimizingPreset: (typeof ROTATION_PRESETS)[number] | null = $state(null);
const minutesProgress = $derived(Math.min(100, Math.round((minutesTotal / 240) * 100)));
const lastGameMinutes = $derived.by(() => {
    const last = summaries[summaries.length - 1];
    if (last === undefined)
        return new Map<string, number>();
    return new Map([...last.homePlayers, ...last.awayPlayers].map((line) => [
        line.playerVersionId,
        line.seconds / 60,
    ]));
});
$effect(() => {
    if (editingId !== null && editingInput !== null) {
        editingInput.focus();
        editingInput.select();
    }
});
$effect(() => () => {
    if (noticeTimer !== null)
        clearTimeout(noticeTimer);
    if (swapNoticeTimer !== null)
        clearTimeout(swapNoticeTimer);
});
function emit() {
    onchange(editor.rotation, editor.validate());
}
function commit(failuresAfter: string[]) {
    revision += 1;
    if (failuresAfter.length === 0)
        emit();
}
function flashAdjustments(adjustments: MinuteAdjustment[]) {
    if (adjustments.length === 0)
        return;
    highlightIds = new Set(adjustments.map((a) => a.playerVersionId));
    rebalanceNotice = buildRebalanceNotice(adjustments);
    if (noticeTimer !== null)
        clearTimeout(noticeTimer);
    noticeTimer = setTimeout(() => {
        highlightIds = new Set();
        rebalanceNotice = null;
    }, 2200);
}
function buildRebalanceNotice(adjustments: MinuteAdjustment[]): string {
    const target = adjustments[0];
    if (target === undefined)
        return '';
    const nameOf = (id: string) => editor.names.get(id) ?? id;
    const others = adjustments.slice(1).map((a) => ({ ...a, name: nameOf(a.playerVersionId) }));
    const tail = others.length === 0
        ? ''
        : others.length === 1 && others[0] !== undefined
            ? ` · ${target.delta > 0 ? 'took' : 'gave'} ${Math.abs(others[0].delta)} from ${others[0].name}`
            : ` · ${target.delta > 0 ? 'took' : 'gave'} ${others
                .map((o) => `${Math.abs(o.delta)} from ${o.name}`)
                .join(', ')}`;
    return `${nameOf(target.playerVersionId)} to ${String(target.minutes)} min${tail}`;
}
function changeMinutes(playerVersionId: string, delta: number) {
    if (disabled)
        return;
    rejection = null;
    const result = editor.rebalanceMinutes(playerVersionId, editor.minutesFor(playerVersionId) + delta);
    commit(result.failures);
    if (result.failures.length === 0)
        flashAdjustments(result.adjustments);
}
function startEdit(playerVersionId: string, current: number) {
    if (disabled)
        return;
    editingId = playerVersionId;
    editingMinutes = current;
    draft = String(current);
}
function cancelEdit() {
    editingId = null;
    editingMinutes = null;
    draft = '';
}
function commitEdit() {
    const targetId = editingId;
    const current = editingMinutes;
    const parsed = Number.parseInt(draft, 10);
    editingId = null;
    editingMinutes = null;
    draft = '';
    if (targetId === null || current === null || disabled || Number.isNaN(parsed))
        return;
    rejection = null;
    const result = editor.rebalanceMinutes(targetId, parsed);
    revision += 1;
    if (result.failures.length === 0) {
        emit();
        flashAdjustments(result.adjustments);
    }
    else {
        rejection = `That minutes change is rejected: ${result.failures[0]}`;
    }
}
function changeStarter(slotIndex: number, playerVersionId: string) {
    if (disabled)
        return;
    const failuresAfter = editor.assignStarter(slotIndex, playerVersionId);
    revision += 1;
    if (failuresAfter.length === 0) {
        rejection = null;
        emit();
    }
    else {
        rejection = `That starter swap is rejected: ${failuresAfter[0]}`;
    }
}
function toggleClosingFor(playerVersionId: string) {
    if (disabled)
        return;
    const failuresAfter = editor.toggleClosing(playerVersionId);
    revision += 1;
    if (failuresAfter.length === 0) {
        rejection = null;
        emit();
    }
    else {
        rejection = `That closing change is rejected: ${failuresAfter[0]}`;
    }
}
function moveBenchRow(benchIndex: number, delta: -1 | 1) {
    if (disabled)
        return;
    rejection = null;
    commit(editor.moveBench(benchIndex, delta));
}
function openSwap(kind: 'promote' | 'demote', playerVersionId: string) {
    if (disabled)
        return;
    rejection = null;
    swap = { kind, playerVersionId };
}
function closeSwap() {
    swap = null;
}
function commitSwap(inactiveId: string, activeId: string) {
    if (disabled || swap === null)
        return;
    const failuresAfter = editor.promoteToRotation(inactiveId, activeId);
    swap = null;
    revision += 1;
    if (failuresAfter.length === 0) {
        rejection = null;
        emit();
        const inactiveName = editor.names.get(inactiveId) ?? inactiveId;
        const activeName = editor.names.get(activeId) ?? activeId;
        swapNotice = `${inactiveName} joined the rotation replacing ${activeName}.`;
        if (swapNoticeTimer !== null)
            clearTimeout(swapNoticeTimer);
        swapNoticeTimer = setTimeout(() => {
            swapNotice = null;
        }, 2200);
    }
    else {
        rejection = `That roster move is rejected: ${failuresAfter[0]}`;
    }
}
async function applyPreset(preset: (typeof ROTATION_PRESETS)[number]) {
    if (disabled)
        return;
    rejection = null;
    if (optimize !== null && !optimize.busy && optimizingPreset === null) {
        optimizingPreset = preset;
        try {
            const result = await optimize.run(editor.rotation);
            const plan = result.plans.find((candidate) => candidate.strategy === minuteStrategyOfPreset(preset));
            if (plan !== undefined) {
                try {
                    editor.applyRotation(plan.rotation);
                }
                catch (error) {
                    rejection = `That plan is rejected: ${error instanceof Error ? error.message : String(error)}`;
                    return;
                }
                revision += 1;
                emit();
                return;
            }
        }
        catch {
        }
        finally {
            optimizingPreset = null;
        }
    }
    commit(editor.applyPreset(preset));
}
function faceOf(playerVersionId: string): SeasonFaceRef | null {
    return faces?.get(playerVersionId) ?? null;
}
function fatigueOf(row: (typeof rows)[number]): {
    label: string;
    badge: string;
    percent: number;
} | null {
    if (effects === null)
        return null;
    const load = loadStateOf(effects, row.member.playerVersionId);
    if (load === null)
        return null;
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
    <div class="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <h2 class="font-display text-base font-extrabold uppercase tracking-tight">Rotation</h2>
        <p class="mt-0.5 text-xs text-muted-foreground">
          Only 10 play. Inactives can be swapped in.
        </p>
      </div>
      <div
        class="grid shrink-0 grid-cols-2 overflow-hidden rounded-lg border border-border bg-surface-1"
        aria-label="Roster participation status"
      >
        <div class="border-r border-border px-3 py-2 text-center">
          <p class="font-display text-lg leading-none font-extrabold text-positive">10 / 10</p>
          <p class="mt-1 font-mono text-[9px] font-bold tracking-[0.12em] uppercase">Active</p>
        </div>
        <div class="px-3 py-2 text-center">
          <p class="font-display text-lg leading-none font-extrabold">{inactiveRows.length}</p>
          <p
            class="mt-1 font-mono text-[9px] font-bold tracking-[0.12em] uppercase text-muted-foreground"
          >
            Inactive
          </p>
        </div>
      </div>
    </div>
    <div class="grid grid-cols-3 gap-2" role="group" aria-label="Minute strategies">
      {#each ROTATION_PRESETS as preset (preset)}
        <button
          type="button"
          onclick={() => void applyPreset(preset)}
          disabled={disabled || optimizingPreset !== null}
          aria-busy={optimizingPreset === preset ? 'true' : undefined}
          class="min-h-11 rounded-lg bg-surface-2 px-2 py-1.5 text-xs font-semibold transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring hover:bg-surface-3 disabled:cursor-not-allowed disabled:opacity-40 sm:text-sm md:min-h-0"
        >
          {optimizingPreset === preset ? 'Optimizing…' : presetLabel(preset)}
        </button>
      {/each}
    </div>
    {#if optimize !== null && optimize.error !== null}
      <p
        role="alert"
        class="rounded-lg border border-destructive/40 bg-destructive/10 p-2.5 text-xs text-destructive"
      >
        Projection unavailable — applied the preset minutes: {optimize.error}
      </p>
    {/if}
  </div>

  <div class="flex flex-col gap-2">
    <p class="text-sm break-words text-muted-foreground">
      {minutesTotal} / 240 min
      {#if minutesRemaining !== 0}
        <span class="text-destructive">· {Math.abs(minutesRemaining)} left</span>
      {:else}
        <span class="text-positive">· complete</span>
      {/if}
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
        class="h-full rounded-full transition-[width] duration-200 {minutesTotal === 240
          ? 'bg-positive'
          : 'bg-primary'}"
        style:width="{minutesProgress}%"
      ></div>
    </div>
    {#if rebalanceNotice !== null}
      <p role="status" class="text-xs font-semibold text-primary">{rebalanceNotice}</p>
    {/if}
  </div>

  <section aria-labelledby="minutes-heading" class="rounded-none bg-surface-1 p-3 sm:rounded-xl">
    <div class="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between sm:gap-2">
      <h3
        id="minutes-heading"
        class="font-mono text-[11px] font-bold uppercase tracking-[0.14em] text-muted-foreground"
      >
        Target minutes
      </h3>
      <span class="font-mono text-[10px] leading-snug text-muted-foreground">
        <span class="sm:hidden">tap a value to type exactly 240</span>
        <span class="hidden sm:inline">tap a value to type · totals exactly 240</span>
      </span>
    </div>
    <ul class="mt-2 flex flex-col divide-y divide-border/60">
      {#each orderedRows as row (row.member.playerVersionId)}
        {@const rowFailures = failureIndex.byPlayer.get(row.member.playerVersionId) ?? null}
        {@const fatigue = fatigueOf(row)}
        {@const lastMinutes = lastGameMinutes.get(row.member.playerVersionId) ?? null}
        {@const eraLabel = eraLabelOf(row.member)}
        <li
          class="flex flex-col gap-2 py-2.5 sm:gap-1 sm:py-2{highlightOf(
            row.member.playerVersionId,
          )}"
        >
          <div
            class="grid min-w-0 grid-cols-1 gap-2 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center sm:gap-3"
          >
            <div class="flex min-w-0 items-start gap-2 sm:items-center sm:gap-3">
              {#if manifest !== null && faceOf(row.member.playerVersionId) !== null}
                <SeasonPlayerFace face={faceOf(row.member.playerVersionId)!} {manifest} size="sm" />
              {/if}
              <div class="min-w-0 flex-1">
                <p class="text-sm font-semibold leading-snug">{row.member.displayName}</p>
                <div class="mt-1 flex min-w-0 flex-wrap items-center gap-1.5">
                  {#if overallByVersion?.has(row.member.playerVersionId)}
                    <span
                      class="shrink-0 rounded bg-surface-3 px-1.5 py-0.5 font-mono text-xs font-bold text-foreground"
                    >
                      OVR {overallByVersion.get(row.member.playerVersionId)}
                    </span>
                  {/if}
                  {#if fatigue !== null}
                    <span
                      class={`shrink-0 rounded-full px-2 py-0.5 font-mono text-xs font-bold ${fatigue.badge}`}
                    >
                      {fatigue.label}
                      {fatigue.percent}%
                    </span>
                  {/if}
                </div>
                <p class="mt-1 font-mono text-xs leading-snug text-muted-foreground">
                  {row.role}
                  {#if row.member.seasonKey !== undefined}· {row.member.seasonKey}{/if}
                  {#if row.member.playable.length > 0}· {formatPositions(row.member.playable)}{/if}
                  {#if lastMinutes !== null}· last game {Math.round(lastMinutes)} min{/if}
                </p>
                {#if eraLabel !== null}
                  <p
                    class="mt-0.5 line-clamp-2 font-mono text-[10px] leading-snug text-muted-foreground/70"
                  >
                    {eraLabel}
                  </p>
                {/if}
              </div>
            </div>
            <div class="flex justify-end sm:justify-start">
              {@render minutesControl(row)}
            </div>
          </div>
          {#if rowFailures !== null}
            <ul
              id="minutes-failure-{row.member.playerVersionId}"
              class="list-inside list-disc pl-7 text-xs text-destructive"
            >
              {#each rowFailures as failure (failure)}
                <li>{failure}</li>
              {/each}
            </ul>
          {/if}
        </li>
      {/each}
    </ul>
  </section>

  {#if failureIndex.global.length > 0}
    <div role="alert" class="rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm">
      <p class="font-semibold">This rotation cannot be submitted:</p>
      <ul class="mt-1 list-inside list-disc text-muted-foreground">
        {#each failureIndex.global as failure (failure)}
          <li>{failure}</li>
        {/each}
      </ul>
    </div>
  {/if}

  {#if rejection}
    <p role="alert" class="rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm">
      {rejection}
    </p>
  {/if}

  <section
    aria-labelledby="closing-overview-heading"
    class="rounded-none bg-surface-1 p-3 sm:rounded-xl"
  >
    <div class="flex items-center justify-between gap-2">
      <h3
        id="closing-overview-heading"
        class="font-mono text-[11px] font-bold uppercase tracking-[0.14em] text-muted-foreground"
      >
        Closing five
      </h3>
      <span class="font-mono text-[10px] text-muted-foreground">
        preferred in the final minutes and overtimes
      </span>
    </div>
    <ul class="mt-2 flex flex-wrap gap-1.5" aria-label="Current closing five">
      {#each closingIds as playerVersionId, slotIndex (slotIndex)}
        {@const row = rowByVersion.get(playerVersionId)}
        <li
          class="flex items-center gap-1.5 rounded-full bg-surface-2 py-1 pr-3 pl-1 font-mono text-xs font-semibold text-foreground"
        >
          {#if manifest !== null && faceOf(playerVersionId) !== null}
            <SeasonPlayerFace face={faceOf(playerVersionId)!} {manifest} size="sm" />
          {/if}
          <span class="text-muted-foreground">{SLOT_LABELS[slotIndex]}{slotIndex + 1}</span>
          <span class="max-w-40 truncate">{row?.member.displayName ?? playerVersionId}</span>
        </li>
      {/each}
    </ul>
    <p class="mt-2 text-xs text-muted-foreground">
      Independent from the starting five. Use each player's star below to swap the closing lineup.
    </p>
  </section>

  <section aria-labelledby="starters-heading" class="min-w-0">
    <h3
      id="starters-heading"
      class="font-mono text-[11px] font-bold uppercase tracking-[0.14em] text-muted-foreground"
    >
      Starters
    </h3>
    <ul class="mt-2 flex flex-col gap-2">
      {#each starterIds as playerVersionId, slotIndex (slotIndex)}
        {@const row = rowByVersion.get(playerVersionId)}
        {#if row !== undefined}
          {@const slotFailures = failureIndex.byPlayer.get(playerVersionId) ?? null}
          {@const fatigue = fatigueOf(row)}
          {@const lastMinutes = lastGameMinutes.get(playerVersionId) ?? null}
          {@const eraLabel = eraLabelOf(row.member)}
          <li
            class="flex flex-col gap-2 rounded-none bg-surface-1 p-3 sm:rounded-xl md:flex-row md:items-center md:gap-3{highlightOf(
              playerVersionId,
            )}"
          >
            <div class="flex min-w-0 flex-1 items-start gap-2 md:items-center md:gap-3">
              <span
                class="w-6 shrink-0 pt-0.5 font-mono text-[10px] font-bold uppercase text-muted-foreground md:w-7 md:pt-0"
              >
                {SLOT_LABELS[slotIndex]}{slotIndex + 1}
              </span>
              {#if manifest !== null && faceOf(playerVersionId) !== null}
                <SeasonPlayerFace
                  face={faceOf(playerVersionId)!}
                  {manifest}
                  size="sm"
                  eager={slotIndex < 2}
                />
              {/if}
              <div class="min-w-0 flex-1">
                <p class="text-sm font-semibold leading-snug">{row.member.displayName}</p>
                <div class="mt-1 flex min-w-0 flex-wrap items-center gap-1.5">
                  {#if overallByVersion?.has(playerVersionId)}
                    <span
                      class="shrink-0 rounded bg-surface-3 px-1.5 py-0.5 font-mono text-[10px] font-bold text-foreground"
                    >
                      OVR {overallByVersion.get(playerVersionId)}
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
                </div>
                <p class="mt-1 font-mono text-[10px] leading-snug text-muted-foreground">
                  {row.member.seasonKey ?? ''}
                  {#if row.member.playable.length > 0}· {formatPositions(row.member.playable)}{/if}
                  {#if lastMinutes !== null}· last game {Math.round(lastMinutes)} min{/if}
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
            <div class="flex w-full items-center gap-2 pl-8 md:w-auto md:shrink-0 md:pl-0">
              <select
                value={playerVersionId}
                {disabled}
                aria-label={`Starter slot ${slotIndex + 1}`}
                aria-invalid={slotFailures !== null ? 'true' : undefined}
                aria-describedby={slotFailures !== null
                  ? `starter-failure-${String(slotIndex)}`
                  : undefined}
                onchange={(event) =>
                  changeStarter(slotIndex, (event.currentTarget as HTMLSelectElement).value)}
                class="min-h-11 min-w-0 flex-1 rounded-lg bg-surface-2 px-3 py-2 text-sm font-semibold outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-40 md:min-h-0 md:w-48 md:flex-none md:py-1.5"
              >
                {#each editor.eligibleForSlot(slotIndex) as member (member.playerVersionId)}
                  <option value={member.playerVersionId}>{member.displayName}</option>
                {/each}
              </select>
              <button
                type="button"
                aria-pressed={row.closingIndex !== -1 ? 'true' : 'false'}
                aria-label={row.closingIndex !== -1
                  ? `Remove ${row.member.displayName} from closing five`
                  : `Add ${row.member.displayName} to closing five`}
                onclick={() => toggleClosingFor(playerVersionId)}
                {disabled}
                class="grid h-10 w-10 shrink-0 place-items-center rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-40 transition-colors {row.closingIndex !==
                -1
                  ? 'bg-primary/15 text-primary'
                  : 'bg-surface-2 text-muted-foreground hover:bg-surface-3'}"
              >
                <Star
                  class="h-5 w-5 md:h-4 md:w-4"
                  fill={row.closingIndex !== -1 ? 'currentColor' : 'none'}
                />
              </button>
              {#if inactiveRows.length > 0}
                <button
                  type="button"
                  aria-label={`Demote ${row.member.displayName} to inactive`}
                  onclick={() => openSwap('demote', playerVersionId)}
                  {disabled}
                  class="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-surface-2 text-muted-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring hover:bg-surface-3 hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
                >
                  <UserMinus class="h-5 w-5 md:h-4 md:w-4" />
                </button>
              {/if}
            </div>
            {#if swap?.kind === 'demote' && swap.playerVersionId === playerVersionId}
              {@render swapPicker(inactiveRows, (optionId) =>
                commitSwap(optionId, playerVersionId),
              )}
            {/if}
            {#if slotFailures !== null}
              <ul
                id="starter-failure-{String(slotIndex)}"
                class="list-inside list-disc pl-7 text-xs text-destructive"
              >
                {#each slotFailures as failure (failure)}
                  <li>{failure}</li>
                {/each}
              </ul>
            {/if}
          </li>
        {/if}
      {/each}
    </ul>
  </section>

  <section aria-labelledby="bench-heading" class="min-w-0">
    <h3
      id="bench-heading"
      class="font-mono text-[11px] font-bold uppercase tracking-[0.14em] text-muted-foreground"
    >
      Bench order
    </h3>
    <ul class="mt-2 flex flex-col gap-2">
      {#each benchIds as playerVersionId, benchIndex (playerVersionId)}
        {@const row = rowByVersion.get(playerVersionId)}
        {#if row !== undefined}
          {@const rowFailures = failureIndex.byPlayer.get(playerVersionId) ?? null}
          {@const fatigue = fatigueOf(row)}
          {@const lastMinutes = lastGameMinutes.get(playerVersionId) ?? null}
          {@const eraLabel = eraLabelOf(row.member)}
          <li
            class="flex flex-col gap-2 rounded-none bg-surface-1 p-3 sm:rounded-xl md:flex-row md:items-center md:gap-3{highlightOf(
              playerVersionId,
            )}"
          >
            <div class="flex min-w-0 flex-1 items-start gap-2 md:items-center md:gap-3">
              <span
                class="w-6 shrink-0 pt-0.5 font-mono text-[10px] font-bold uppercase text-muted-foreground md:w-7 md:pt-0"
              >
                {benchIndex + 6}
              </span>
              {#if manifest !== null && faceOf(playerVersionId) !== null}
                <SeasonPlayerFace face={faceOf(playerVersionId)!} {manifest} size="sm" />
              {/if}
              <div class="min-w-0 flex-1">
                <p class="text-sm font-semibold leading-snug">{row.member.displayName}</p>
                <div class="mt-1 flex min-w-0 flex-wrap items-center gap-1.5">
                  {#if overallByVersion?.has(playerVersionId)}
                    <span
                      class="shrink-0 rounded bg-surface-3 px-1.5 py-0.5 font-mono text-[10px] font-bold text-foreground"
                    >
                      OVR {overallByVersion.get(playerVersionId)}
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
                </div>
                <p class="mt-1 font-mono text-[10px] leading-snug text-muted-foreground">
                  {row.role}
                  {#if row.member.playable.length > 0}· {formatPositions(row.member.playable)}{/if}
                  {#if lastMinutes !== null}· last game {Math.round(lastMinutes)} min{/if}
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
            <div class="flex shrink-0 items-center justify-end gap-2">
              {#if inactiveRows.length > 0}
                <button
                  type="button"
                  aria-label={`Demote ${row.member.displayName} to inactive`}
                  onclick={() => openSwap('demote', playerVersionId)}
                  {disabled}
                  class="grid h-10 w-10 place-items-center rounded-lg bg-surface-2 text-muted-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring hover:bg-surface-3 hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40 md:h-8 md:w-8"
                >
                  <UserMinus class="h-4 w-4" />
                </button>
              {/if}
              <div
                class="flex items-center gap-1"
                role="group"
                aria-label={`Bench order for ${row.member.displayName}`}
              >
                <button
                  type="button"
                  aria-label={`Move ${row.member.displayName} up in bench order`}
                  onclick={() => moveBenchRow(benchIndex, -1)}
                  disabled={disabled || benchIndex === 0}
                  class="grid h-10 w-10 place-items-center rounded-lg bg-surface-2 text-muted-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring hover:bg-surface-3 hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40 md:h-8 md:w-8"
                >
                  <ChevronUp class="h-4 w-4" />
                </button>
                <button
                  type="button"
                  aria-label={`Move ${row.member.displayName} down in bench order`}
                  onclick={() => moveBenchRow(benchIndex, 1)}
                  disabled={disabled || benchIndex === 4}
                  class="grid h-10 w-10 place-items-center rounded-lg bg-surface-2 text-muted-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring hover:bg-surface-3 hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40 md:h-8 md:w-8"
                >
                  <ChevronDown class="h-4 w-4" />
                </button>
              </div>
              <button
                type="button"
                aria-pressed={row.closingIndex !== -1 ? 'true' : 'false'}
                aria-label={row.closingIndex !== -1
                  ? `Remove ${row.member.displayName} from closing five`
                  : `Add ${row.member.displayName} to closing five`}
                onclick={() => toggleClosingFor(playerVersionId)}
                {disabled}
                class="grid h-10 w-10 shrink-0 place-items-center rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-40 transition-colors {row.closingIndex !==
                -1
                  ? 'bg-primary/15 text-primary'
                  : 'bg-surface-2 text-muted-foreground hover:bg-surface-3'}"
              >
                <Star
                  class="h-5 w-5 md:h-4 md:w-4"
                  fill={row.closingIndex !== -1 ? 'currentColor' : 'none'}
                />
              </button>
            </div>
            {#if swap?.kind === 'demote' && swap.playerVersionId === playerVersionId}
              {@render swapPicker(inactiveRows, (optionId) =>
                commitSwap(optionId, playerVersionId),
              )}
            {/if}
            {#if rowFailures !== null}
              <ul
                id="rotation-failure-{playerVersionId}"
                class="list-inside list-disc pl-7 text-xs text-destructive"
              >
                {#each rowFailures as failure (failure)}
                  <li>{failure}</li>
                {/each}
              </ul>
            {/if}
          </li>
        {/if}
      {/each}
    </ul>
  </section>

  {#if inactiveRows.length > 0}
    <section
      aria-labelledby="inactive-heading"
      data-rotation-inactive-section
      class="rounded-none border-y border-dashed border-border bg-surface-1/60 p-3 sm:rounded-xl sm:border"
    >
      <div class="flex items-center justify-between gap-2">
        <h3
          id="inactive-heading"
          class="font-mono text-[11px] font-bold uppercase tracking-[0.14em] text-muted-foreground"
        >
          Inactive depth · does not play
        </h3>
        <span class="font-mono text-[10px] text-muted-foreground">
          {inactiveRows.length} rostered {inactiveRows.length === 1 ? 'player' : 'players'} outside the
          ten-player rotation
        </span>
      </div>
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
                  onclick={() => openSwap('promote', member.playerVersionId)}
                  {disabled}
                  class="inline-flex min-h-10 items-center gap-1.5 rounded-lg bg-surface-2 px-3 py-1.5 text-xs font-semibold outline-none focus-visible:ring-2 focus-visible:ring-ring hover:bg-surface-3 disabled:cursor-not-allowed disabled:opacity-40"
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
    </section>
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
            class="flex w-full items-center justify-between gap-2 rounded-lg px-2.5 py-2 text-left text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring hover:bg-surface-3"
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
      class="mt-2 text-xs font-semibold text-muted-foreground underline-offset-2 outline-none focus-visible:ring-2 focus-visible:ring-ring hover:text-foreground"
    >
      Cancel
    </button>
  </div>
{/snippet}

{#snippet minutesControl(row: (typeof rows)[number])}
  <div
    class="flex w-full max-w-[9.5rem] shrink-0 items-center justify-end gap-1 sm:w-auto sm:max-w-none sm:justify-start"
    role="group"
    aria-label={`Minutes for ${row.member.displayName}`}
  >
    <button
      type="button"
      aria-label={`Decrease minutes for ${row.member.displayName}`}
      onclick={() => changeMinutes(row.member.playerVersionId, -1)}
      {disabled}
      class="grid h-11 w-11 place-items-center rounded-lg bg-surface-2 text-base font-bold outline-none focus-visible:ring-2 focus-visible:ring-ring hover:bg-surface-3 disabled:opacity-40 md:h-8 md:w-8"
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
        class="h-11 w-12 rounded-md bg-surface-2 px-1 text-center font-mono text-sm font-bold tabular-nums outline-none focus-visible:ring-2 focus-visible:ring-ring md:h-8"
      />
    {:else}
      <button
        type="button"
        aria-label={`Edit target minutes for ${row.member.displayName}`}
        onclick={() => startEdit(row.member.playerVersionId, row.minutes)}
        {disabled}
        class="h-11 w-12 rounded-md text-center font-mono text-sm font-bold tabular-nums outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-40 md:h-8"
      >
        {row.minutes}
      </button>
    {/if}
    <button
      type="button"
      aria-label={`Increase minutes for ${row.member.displayName}`}
      onclick={() => changeMinutes(row.member.playerVersionId, 1)}
      {disabled}
      class="grid h-11 w-11 place-items-center rounded-lg bg-surface-2 text-base font-bold outline-none focus-visible:ring-2 focus-visible:ring-ring hover:bg-surface-3 disabled:opacity-40 md:h-8 md:w-8"
    >
      +
    </button>
  </div>
{/snippet}
