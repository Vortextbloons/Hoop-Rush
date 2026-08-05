<script lang="ts">
  import {
    ROTATION_PRESETS,
    presetLabel,
    type RotationEditor,
    type RotationMember,
  } from '$lib/season/season-rotation-editor';

  /**
   * Season Run rotation editor (spec/2.0/04 M2.2 contract, M2.3 hub).
   * Mutates the page-owned `RotationEditor` (engine-validated commits only),
   * shows presets, starter/closing slot assignment, per-player target minutes
   * (must total exactly 240), and the audit failures that block submission.
   */

  let {
    editor,
    disabled,
    onchange,
  }: {
    editor: RotationEditor;
    disabled: boolean;
    onchange: (rotation: RotationEditor['rotation'], failures: string[]) => void;
  } = $props();

  const rows = $derived(editor.rows());
  const minutesTotal = $derived(rows.reduce((sum, row) => sum + row.minutes, 0));
  const failures = $derived(editor.validate());

  function emit() {
    onchange(editor.rotation, editor.validate());
  }

  function commit(failuresAfter: string[]) {
    if (failuresAfter.length === 0) emit();
  }

  function changeMinutes(playerVersionId: string, delta: number) {
    if (disabled) return;
    // Steppers keep the 240 total intact by compensating another player.
    commit(editor.adjustMinutes(playerVersionId, delta));
  }

  function changeStarter(slotIndex: number, playerVersionId: string) {
    if (disabled) return;
    commit(editor.assignStarter(slotIndex, playerVersionId));
  }

  function changeClosing(slotIndex: number, playerVersionId: string) {
    if (disabled) return;
    commit(editor.assignClosing(slotIndex, playerVersionId));
  }

  function applyPreset(preset: (typeof ROTATION_PRESETS)[number]) {
    if (disabled) return;
    commit(editor.applyPreset(preset));
  }
</script>

<div class="flex flex-col gap-4">
  <div class="flex flex-wrap items-center justify-between gap-3">
    <h2 class="font-display text-base font-extrabold uppercase tracking-tight">Rotation</h2>
    <div class="flex flex-wrap items-center gap-2" role="group" aria-label="Minute presets">
      {#each ROTATION_PRESETS as preset (preset)}
        <button
          type="button"
          onclick={() => applyPreset(preset)}
          {disabled}
          class="rounded-lg bg-surface-2 px-3 py-1.5 text-sm font-semibold transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring hover:bg-surface-3 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {presetLabel(preset)}
        </button>
      {/each}
    </div>
  </div>

  <p class="text-sm text-muted-foreground">
    Target minutes total <strong class="text-foreground">{minutesTotal}</strong> of 240. Starters are
    ordered G, G, F, F, C; the closing five is an independent legal five.
  </p>

  {#if failures.length > 0}
    <div role="alert" class="rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm">
      <p class="font-semibold">This rotation cannot be submitted:</p>
      <ul class="mt-1 list-inside list-disc text-muted-foreground">
        {#each failures as failure (failure)}
          <li>{failure}</li>
        {/each}
      </ul>
    </div>
  {/if}

  <div class="grid gap-4 lg:grid-cols-2">
    <section aria-labelledby="starter-heading" class="rounded-xl bg-surface-1 p-4">
      <h3
        id="starter-heading"
        class="font-mono text-[11px] font-bold uppercase tracking-[0.14em] text-muted-foreground"
      >
        Starters
      </h3>
      <ul class="mt-2 flex flex-col gap-2">
        {#each editor.rotation.starters as playerVersionId, slotIndex (slotIndex)}
          {@const row = rows.find((r) => r.member.playerVersionId === playerVersionId)}
          <li class="flex items-center gap-2">
            <span
              class="w-7 shrink-0 font-mono text-[10px] font-bold uppercase text-muted-foreground"
            >
              {slotIndex === 0 || slotIndex === 1 ? 'G' : slotIndex === 4 ? 'C' : 'F'}{slotIndex +
                1}
            </span>
            <select
              value={playerVersionId}
              {disabled}
              aria-label={`Starter slot ${slotIndex + 1}`}
              onchange={(event) =>
                changeStarter(slotIndex, (event.currentTarget as HTMLSelectElement).value)}
              class="min-w-0 flex-1 rounded-lg bg-surface-2 px-2 py-1.5 text-sm font-semibold outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-40"
            >
              {#each rows as r (r.member.playerVersionId)}
                <option value={r.member.playerVersionId}>
                  {r.member.displayName}
                </option>
              {/each}
            </select>
            <span class="w-10 shrink-0 text-right font-mono text-[10px] text-muted-foreground">
              {row?.minutes ?? 0} min
            </span>
          </li>
        {/each}
      </ul>
    </section>

    <section aria-labelledby="bench-heading" class="rounded-xl bg-surface-1 p-4">
      <h3
        id="bench-heading"
        class="font-mono text-[11px] font-bold uppercase tracking-[0.14em] text-muted-foreground"
      >
        Bench order
      </h3>
      <ul class="mt-2 flex flex-col gap-2">
        {#each editor.rotation.benchOrder as playerVersionId, benchIndex (benchIndex)}
          {@const row = rows.find((r) => r.member.playerVersionId === playerVersionId)}
          <li class="flex items-center gap-2">
            <span
              class="w-7 shrink-0 font-mono text-[10px] font-bold uppercase text-muted-foreground"
            >
              {benchIndex + 6}
            </span>
            <span class="min-w-0 flex-1 truncate text-sm font-semibold">
              {row?.member.displayName ?? playerVersionId}
            </span>
            <span class="w-10 shrink-0 text-right font-mono text-[10px] text-muted-foreground">
              {row?.minutes ?? 0} min
            </span>
          </li>
        {/each}
      </ul>
    </section>
  </div>

  <section aria-labelledby="closing-heading" class="rounded-xl bg-surface-1 p-4">
    <h3
      id="closing-heading"
      class="font-mono text-[11px] font-bold uppercase tracking-[0.14em] text-muted-foreground"
    >
      Closing five (preferred in the final minutes and overtimes)
    </h3>
    <ul class="mt-2 flex flex-col gap-2">
      {#each editor.rotation.closingFive as playerVersionId, slotIndex (slotIndex)}
        {@const row = rows.find((r) => r.member.playerVersionId === playerVersionId)}
        <li class="flex items-center gap-2">
          <span
            class="w-7 shrink-0 font-mono text-[10px] font-bold uppercase text-muted-foreground"
          >
            {slotIndex === 0 || slotIndex === 1 ? 'G' : slotIndex === 4 ? 'C' : 'F'}{slotIndex + 1}
          </span>
          <select
            value={playerVersionId}
            {disabled}
            aria-label={`Closing slot ${slotIndex + 1}`}
            onchange={(event) =>
              changeClosing(slotIndex, (event.currentTarget as HTMLSelectElement).value)}
            class="min-w-0 flex-1 rounded-lg bg-surface-2 px-2 py-1.5 text-sm font-semibold outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-40"
          >
            {#each rows as r (r.member.playerVersionId)}
              <option value={r.member.playerVersionId}>
                {r.member.displayName}
              </option>
            {/each}
          </select>
          <span class="w-10 shrink-0 text-right font-mono text-[10px] text-muted-foreground">
            {row?.minutes ?? 0} min
          </span>
        </li>
      {/each}
    </ul>
  </section>

  <section aria-labelledby="minutes-heading" class="rounded-xl bg-surface-1 p-4">
    <h3
      id="minutes-heading"
      class="font-mono text-[11px] font-bold uppercase tracking-[0.14em] text-muted-foreground"
    >
      Target minutes
    </h3>
    <ul class="mt-2 flex flex-col divide-y divide-border/60">
      {#each rows as row (row.member.playerVersionId)}
        <li class="flex items-center gap-3 py-2">
          <span class="min-w-0 flex-1 truncate text-sm font-semibold">
            {row.member.displayName}
          </span>
          <span class="hidden font-mono text-[10px] text-muted-foreground sm:block">
            {row.role}
          </span>
          <div
            class="flex items-center gap-1"
            role="group"
            aria-label={`Minutes for ${row.member.displayName}`}
          >
            <button
              type="button"
              aria-label={`Decrease minutes for ${row.member.displayName}`}
              onclick={() => changeMinutes(row.member.playerVersionId, -1)}
              {disabled}
              class="grid h-8 w-8 place-items-center rounded-lg bg-surface-2 text-sm font-bold outline-none focus-visible:ring-2 focus-visible:ring-ring hover:bg-surface-3 disabled:opacity-40"
            >
              −
            </button>
            <output class="w-12 text-center font-mono text-sm font-bold" aria-live="polite">
              {row.minutes}
            </output>
            <button
              type="button"
              aria-label={`Increase minutes for ${row.member.displayName}`}
              onclick={() => changeMinutes(row.member.playerVersionId, 1)}
              {disabled}
              class="grid h-8 w-8 place-items-center rounded-lg bg-surface-2 text-sm font-bold outline-none focus-visible:ring-2 focus-visible:ring-ring hover:bg-surface-3 disabled:opacity-40"
            >
              +
            </button>
          </div>
        </li>
      {/each}
    </ul>
  </section>
</div>
