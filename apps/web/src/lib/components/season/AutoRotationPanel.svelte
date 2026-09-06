<script lang="ts">
  import type { SeasonRotation } from '@hoop-rush/data-contracts';
  import type { RecommendSeasonRotationResult } from '@hoop-rush/engine';
  import {
    createProjectionRunner,
    type ProjectionRunner,
  } from '$lib/season/season-projection-runner';
  import {
    AutoUndoState,
    autoUndoKeyOf,
    buildAutoRecommendInput,
    hasActiveSwaps,
    swapPairsOf,
    type AutoScopeOption,
  } from '$lib/season/season-auto-rotation';
  import type { ProjectionRotationLoadRow } from '$lib/season/season-projection-wire';
  import type { RotationEditor } from '$lib/season/season-rotation-editor';

  let {
    editor,
    disabled,
    rosterIds,
    unavailable,
    load,
    overall,
    horizon,
    seed,
    runId,
    blockIndex,
    names = null,
    onAutoApplied,
  }: {
    editor: RotationEditor | null;
    disabled: boolean;
    rosterIds: readonly string[];
    unavailable: readonly string[];
    load: readonly ProjectionRotationLoadRow[];
    overall: readonly { playerVersionId: string; overall: number }[];
    horizon: number;
    seed: string | null;
    runId: string | null;
    blockIndex: number | null;
    names?: ReadonlyMap<string, string> | null;
    onAutoApplied: () => void;
  } = $props();

  let runner = $state<ProjectionRunner | null>(null);
  let mounted = $state(true);
  $effect(() => {
    mounted = true;
    const created = createProjectionRunner();
    runner = created;
    return () => {
      mounted = false;
      created.destroy();
      if (runner === created) runner = null;
    };
  });

  let option = $state<AutoScopeOption>('full-auto');
  let busy = $state(false);
  let error = $state<string | null>(null);
  let result = $state<RecommendSeasonRotationResult | null>(null);
  let controller = $state<AbortController | null>(null);
  let confirmingSwaps = $state(false);
  let hasUndo = $state(false);
  const undoStore = new AutoUndoState();
  let applying = false;

  const undoKey = $derived(
    runId !== null && blockIndex !== null ? autoUndoKeyOf(runId, blockIndex) : null,
  );
  const preview = $derived(result !== null && result.status === 'recommended' ? result : null);
  const unavailableResult = $derived(
    result !== null && result.status === 'unavailable' ? result : null,
  );
  const swaps = $derived(preview !== null ? swapPairsOf(preview) : []);
  const needsSwapConfirm = $derived(preview !== null && hasActiveSwaps(preview));
  const canRun = $derived(
    editor !== null &&
      runner !== null &&
      seed !== null &&
      horizon > 0 &&
      rosterIds.length >= 10 &&
      !busy &&
      !disabled,
  );
  const nameOf = (id: string): string => names?.get(id) ?? id;
  const minutesOf = (rotation: SeasonRotation, id: string): number =>
    rotation.targetMinutes.find((row) => row.playerVersionId === id)?.minutes ?? 0;

  $effect(() => {
    void runId;
    void blockIndex;
    if (!mounted) return;
    result = null;
    error = null;
    confirmingSwaps = false;
    undoStore.invalidate();
    if (mounted) hasUndo = false;
  });

  export function notifyManualEdit(): void {
    if (applying) return;
    if (!mounted) return;
    result = null;
    error = null;
    confirmingSwaps = false;
    undoStore.invalidate();
    hasUndo = false;
  }

  export function notifyBlockSubmit(): void {
    if (!mounted) return;
    result = null;
    confirmingSwaps = false;
    undoStore.invalidate();
    hasUndo = false;
  }

  async function runAuto(): Promise<void> {
    if (!canRun || editor === null || runner === null || seed === null) return;
    const activeRunner = runner;
    const current = editor.rotation;
    busy = true;
    error = null;
    result = null;
    confirmingSwaps = false;
    const aborter = new AbortController();
    controller = aborter;
    try {
      const input = buildAutoRecommendInput({
        roster: rosterIds,
        unavailable,
        current,
        load,
        overall,
        horizon,
        seed,
        option,
      });
      const next = await activeRunner.recommendRotation(input, { signal: aborter.signal });
      if (!mounted || runner === null) return;
      result = next;
      if (next.status === 'unavailable') {
        error = null;
      }
    } catch (caught) {
      if (!mounted) return;
      if (caught instanceof Error && caught.name === 'AbortError') {
        error = null;
        result = null;
      } else {
        error = caught instanceof Error ? caught.message : String(caught);
        result = null;
      }
    } finally {
      if (mounted) {
        busy = false;
        controller = null;
      }
    }
  }

  function cancelAuto(): void {
    controller?.abort();
  }

  function applyAuto(): void {
    if (preview === null || editor === null || undoKey === null) return;
    if (needsSwapConfirm && !confirmingSwaps) {
      confirmingSwaps = true;
      return;
    }
    applying = true;
    try {
      undoStore.capture(undoKey, editor.rotation);
      editor.applyAutoRotation(preview.candidate);
      hasUndo = true;
      result = null;
      error = null;
      confirmingSwaps = false;
      onAutoApplied();
    } catch (caught) {
      undoStore.invalidate();
      hasUndo = false;
      error = caught instanceof Error ? caught.message : String(caught);
    } finally {
      applying = false;
    }
  }

  function discardPreview(): void {
    result = null;
    error = null;
    confirmingSwaps = false;
  }

  function undoAuto(): void {
    if (editor === null || undoKey === null) return;
    const previous = undoStore.take(undoKey);
    if (previous === null) {
      hasUndo = false;
      return;
    }
    applying = true;
    try {
      editor.applyAutoRotation(previous);
      hasUndo = false;
      result = null;
      confirmingSwaps = false;
      error = null;
      onAutoApplied();
    } catch (caught) {
      error = caught instanceof Error ? caught.message : String(caught);
    } finally {
      applying = false;
    }
  }
</script>

<section
  aria-labelledby="auto-rotation-heading"
  class="rounded-none bg-surface-1 p-3 sm:rounded-xl"
>
  <div class="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
    <div>
      <h3
        id="auto-rotation-heading"
        class="font-mono text-[11px] font-bold uppercase tracking-[0.14em] text-muted-foreground"
      >
        Auto build rotation
      </h3>
      <p class="mt-0.5 text-xs text-muted-foreground">
        {option === 'full-auto'
          ? 'Picks the 10, starters, minutes, and closing five.'
          : option === 'minutes-only'
            ? 'Keeps your 10. Retunes minutes only.'
            : 'Keeps your 10. Retunes starters, minutes, and closing.'}
      </p>
    </div>
    {#if hasUndo}
      <button
        type="button"
        onclick={undoAuto}
        disabled={disabled || busy}
        class="inline-flex min-h-11 shrink-0 items-center justify-center rounded-lg border border-border px-3 py-1.5 text-xs font-semibold outline-none focus-visible:ring-2 focus-visible:ring-ring hover:bg-surface-2 disabled:cursor-not-allowed disabled:opacity-40"
      >
        Undo auto
      </button>
    {/if}
  </div>

  <div class="mt-2 flex flex-col gap-2 sm:flex-row">
    <label class="sr-only" for="auto-scope-select">Auto scope</label>
    <select
      id="auto-scope-select"
      aria-label="Auto scope"
      value={option}
      onchange={(event) => {
        option = (event.currentTarget as HTMLSelectElement).value as AutoScopeOption;
      }}
      disabled={busy || disabled}
      class="min-h-11 min-w-0 flex-1 rounded-lg border border-border bg-surface-2 px-3 py-2 text-xs font-semibold outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-40 sm:max-w-56"
    >
      <option value="full-auto">Full auto</option>
      <option value="minutes-only">Minutes only</option>
      <option value="keep-10">Keep my 10</option>
    </select>
    {#if busy}
      <button
        type="button"
        onclick={cancelAuto}
        aria-label="Cancel auto rotation"
        class="inline-flex min-h-11 flex-1 items-center justify-center rounded-lg bg-surface-2 px-4 py-2 text-sm font-semibold outline-none focus-visible:ring-2 focus-visible:ring-ring hover:bg-surface-3"
      >
        Cancel…
      </button>
    {:else}
      <button
        type="button"
        onclick={() => void runAuto()}
        disabled={!canRun}
        aria-busy={busy ? 'true' : undefined}
        class="inline-flex min-h-11 flex-1 items-center justify-center rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
      >
        Auto build
      </button>
    {/if}
  </div>

  {#if error !== null}
    <p
      role="alert"
      class="mt-2 rounded-lg border border-destructive/40 bg-destructive/10 p-2.5 text-xs text-destructive"
    >
      Auto unavailable — {error}
    </p>
  {/if}

  {#if unavailableResult !== null}
    <p role="status" class="mt-2 rounded-lg border border-border bg-surface-2 p-2.5 text-xs">
      {unavailableResult.reason}
    </p>
  {/if}

  {#if preview !== null}
    <div
      role="status"
      aria-live="polite"
      class="mt-2 rounded-lg border border-primary/40 bg-primary/5 p-3"
    >
      <p class="text-sm font-semibold">Preview — nothing applied yet</p>
      {#if preview.metrics.projectedNetRating !== null}
        <p class="mt-1 font-mono text-[11px]">
          Projected net {preview.metrics.projectedNetRating > 0
            ? '+'
            : ''}{preview.metrics.projectedNetRating.toFixed(1)}
        </p>
      {/if}

      {#if swaps.length > 0}
        <div class="mt-2">
          <p
            class="font-mono text-[10px] font-bold uppercase tracking-[0.14em] text-muted-foreground"
          >
            Active-10 swaps
          </p>
          <ul class="mt-1 flex flex-col gap-1 text-xs">
            {#each swaps as swap (swap.inPlayerVersionId)}
              <li class="rounded bg-surface-2 px-2 py-1.5">
                <span class="font-semibold text-positive">IN {nameOf(swap.inPlayerVersionId)}</span>
                <span class="text-muted-foreground"> · </span>
                <span class="font-semibold text-destructive"
                  >OUT {nameOf(swap.outPlayerVersionId)}</span
                >
              </li>
            {/each}
          </ul>
        </div>
      {/if}

      <div class="mt-2 grid gap-2 sm:grid-cols-3">
        <div>
          <p
            class="font-mono text-[10px] font-bold uppercase tracking-[0.14em] text-muted-foreground"
          >
            Starters
          </p>
          <ol class="mt-1 flex flex-col gap-0.5 text-xs">
            {#each preview.candidate.starters as id, index (id)}
              <li class="flex justify-between gap-2 rounded bg-surface-2 px-2 py-1">
                <span class="min-w-0 truncate">S{index + 1} {nameOf(id)}</span>
                <span class="font-mono text-[10px] text-muted-foreground"
                  >{minutesOf(preview.candidate, id)}m</span
                >
              </li>
            {/each}
          </ol>
        </div>
        <div>
          <p
            class="font-mono text-[10px] font-bold uppercase tracking-[0.14em] text-muted-foreground"
          >
            Bench
          </p>
          <ol class="mt-1 flex flex-col gap-0.5 text-xs">
            {#each preview.candidate.benchOrder as id, index (id)}
              <li class="flex justify-between gap-2 rounded bg-surface-2 px-2 py-1">
                <span class="min-w-0 truncate">B{index + 1} {nameOf(id)}</span>
                <span class="font-mono text-[10px] text-muted-foreground"
                  >{minutesOf(preview.candidate, id)}m</span
                >
              </li>
            {/each}
          </ol>
        </div>
        <div>
          <p
            class="font-mono text-[10px] font-bold uppercase tracking-[0.14em] text-muted-foreground"
          >
            Closing
          </p>
          <ol class="mt-1 flex flex-col gap-0.5 text-xs">
            {#each preview.candidate.closingFive as id, index (id)}
              <li class="flex justify-between gap-2 rounded bg-surface-2 px-2 py-1">
                <span class="min-w-0 truncate">C{index + 1} {nameOf(id)}</span>
                <span class="font-mono text-[10px] text-muted-foreground"
                  >{minutesOf(preview.candidate, id)}m</span
                >
              </li>
            {/each}
          </ol>
        </div>
      </div>

      {#if preview.changes.length > 0}
        <details class="mt-2">
          <summary
            class="inline-flex min-h-11 cursor-pointer items-center rounded-lg px-2 py-1 font-mono text-[10px] font-bold uppercase tracking-[0.14em] text-muted-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring [&::-webkit-details-marker]:hidden"
          >
            Why ({preview.changes.length})
          </summary>
          <ul class="mt-1 flex max-h-48 flex-col gap-1 overflow-y-auto text-xs">
            {#each preview.changes as change, index (index)}
              <li class="rounded bg-surface-2 px-2 py-1">
                <span class="text-muted-foreground">{change.reason}</span>
              </li>
            {/each}
          </ul>
        </details>
      {/if}

      {#if needsSwapConfirm && confirmingSwaps}
        <div
          role="alertdialog"
          aria-label="Confirm active swaps"
          class="mt-2 rounded-lg border border-primary/40 bg-background p-2.5"
        >
          <p class="text-xs font-semibold">Applying changes the active 10. Confirm swaps:</p>
          <ul class="mt-1 flex flex-col gap-1 text-xs">
            {#each swaps as swap (swap.inPlayerVersionId)}
              <li>IN {nameOf(swap.inPlayerVersionId)} · OUT {nameOf(swap.outPlayerVersionId)}</li>
            {/each}
          </ul>
          <div class="mt-2 flex gap-2">
            <button
              type="button"
              onclick={applyAuto}
              class="inline-flex min-h-11 flex-1 items-center justify-center rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring hover:opacity-90"
            >
              Confirm apply
            </button>
            <button
              type="button"
              onclick={() => {
                confirmingSwaps = false;
              }}
              class="inline-flex min-h-11 items-center justify-center rounded-lg border border-border px-3 py-1.5 text-xs font-semibold outline-none focus-visible:ring-2 focus-visible:ring-ring hover:bg-surface-2"
            >
              Back
            </button>
          </div>
        </div>
      {:else}
        <div class="mt-2 flex gap-2">
          <button
            type="button"
            onclick={applyAuto}
            class="inline-flex min-h-11 flex-1 items-center justify-center rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring hover:opacity-90"
          >
            {needsSwapConfirm ? 'Review swaps & apply' : 'Apply'}
          </button>
          <button
            type="button"
            onclick={discardPreview}
            class="inline-flex min-h-11 items-center justify-center rounded-lg border border-border px-3 py-1.5 text-xs font-semibold outline-none focus-visible:ring-2 focus-visible:ring-ring hover:bg-surface-2"
          >
            Keep mine
          </button>
        </div>
      {/if}
    </div>
  {/if}
</section>
