<script lang="ts">
  import type { HoopRushManifest } from '@hoop-rush/data-contracts';
  import SeasonPlayerFace from '$lib/components/season/SeasonPlayerFace.svelte';
  import type { SeasonFaceRef } from '$lib/season/season-branding';
  import {
    indexRotationFailures,
    ROTATION_PRESETS,
    presetLabel,
    type RotationEditor,
  } from '$lib/season/season-rotation-editor';

  /**
   * Season Run rotation editor (spec/2.0/04 M2.2 contract, M2.3 hub,
   * M2.3.5 team workspace). Mutates the shell-owned `RotationEditor`
   * (engine-validated commits only), shows presets, starter/closing slot
   * assignment, per-player target minutes (must total exactly 240), and the
   * audit failures that block submission. The layout is responsive: below `md`,
   * mobile uses tabbed sections (Starters / Minutes / Closing) with 44px
   * steppers and touch-sized selects; desktop shows the full starter/bench/
   * closing/minutes workspace. Audit failures are attached to the affected
   * player row (aria-invalid + message) when they name a player; global
   * failures render in the alert block. An illegal starter/closing swap is
   * rejected by the engine without committing; the rejection surfaces under
   * the control.
   */

  let {
    editor,
    disabled,
    onchange,
    faces = null,
    manifest = null,
    overallByVersion = null,
  }: {
    editor: RotationEditor;
    disabled: boolean;
    onchange: (rotation: RotationEditor['rotation'], failures: string[]) => void;
    /** playerVersionId -> face refs for compact rows (optional). */
    faces?: ReadonlyMap<string, SeasonFaceRef> | null;
    manifest?: HoopRushManifest | null;
    /** playerVersionId -> summary Overall rating (optional presentation data). */
    overallByVersion?: ReadonlyMap<string, number> | null;
  } = $props();

  const rows = $derived.by(() => {
    void revision;
    return editor.rows();
  });
  const minutesTotal = $derived(rows.reduce((sum, row) => sum + row.minutes, 0));
  const failures = $derived.by(() => {
    void revision;
    return editor.validate();
  });
  const failureIndex = $derived(indexRotationFailures(failures));

  /** Transient engine rejection of an illegal slot swap (nothing committed). */
  let rejection: string | null = $state(null);

  type MobileSection = 'starters' | 'minutes' | 'closing';
  let mobileSection = $state<MobileSection>('minutes');

  const minutesProgress = $derived(Math.min(100, Math.round((minutesTotal / 240) * 100)));

  /**
   * Re-render tick for DOM reactivity when the editor is a plain (non-$state)
   * object — e.g. in component tests. In the app the shell proxies the
   * editor through `$state`, so this is a harmless extra invalidation.
   */
  let revision = $state(0);

  function emit() {
    onchange(editor.rotation, editor.validate());
  }

  function commit(failuresAfter: string[]) {
    revision += 1;
    if (failuresAfter.length === 0) emit();
  }

  function changeMinutes(playerVersionId: string, delta: number) {
    if (disabled) return;
    rejection = null;
    // Steppers keep the 240 total intact by compensating another player.
    commit(editor.adjustMinutes(playerVersionId, delta));
  }

  function changeStarter(slotIndex: number, playerVersionId: string) {
    if (disabled) return;
    const failuresAfter = editor.assignStarter(slotIndex, playerVersionId);
    revision += 1;
    if (failuresAfter.length === 0) {
      rejection = null;
      emit();
    } else {
      rejection = `That starter swap is rejected: ${failuresAfter[0]}`;
    }
  }

  function changeClosing(slotIndex: number, playerVersionId: string) {
    if (disabled) return;
    const failuresAfter = editor.assignClosing(slotIndex, playerVersionId);
    revision += 1;
    if (failuresAfter.length === 0) {
      rejection = null;
      emit();
    } else {
      rejection = `That closing-five swap is rejected: ${failuresAfter[0]}`;
    }
  }

  function applyPreset(preset: (typeof ROTATION_PRESETS)[number]) {
    if (disabled) return;
    rejection = null;
    commit(editor.applyPreset(preset));
  }

  function slotLabel(slotIndex: number): string {
    return slotIndex === 0 || slotIndex === 1 ? 'G' : slotIndex === 4 ? 'C' : 'F';
  }

  function faceOf(playerVersionId: string): SeasonFaceRef | null {
    return faces?.get(playerVersionId) ?? null;
  }
</script>

<div class="flex min-w-0 flex-col gap-4">
  <div class="flex flex-col gap-3">
    <h2 class="font-display text-base font-extrabold uppercase tracking-tight">Rotation</h2>
    <div class="grid grid-cols-3 gap-2" role="group" aria-label="Minute presets">
      {#each ROTATION_PRESETS as preset (preset)}
        <button
          type="button"
          onclick={() => applyPreset(preset)}
          {disabled}
          class="min-h-11 rounded-lg bg-surface-2 px-2 py-1.5 text-xs font-semibold transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring hover:bg-surface-3 disabled:cursor-not-allowed disabled:opacity-40 sm:text-sm md:min-h-0"
        >
          {presetLabel(preset)}
        </button>
      {/each}
    </div>
  </div>

  <div class="flex flex-col gap-2">
    <p class="text-sm break-words text-muted-foreground">
      Target minutes
      <strong class="text-foreground">{minutesTotal}</strong>
      of 240
      <span class="hidden sm:inline">
        · Starters are ordered G, G, F, F, C; the closing five is an independent legal five.
      </span>
    </p>
    <div
      class="h-2 overflow-hidden rounded-full bg-surface-2 md:hidden"
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
  </div>

  <div
    role="group"
    aria-label="Rotation section"
    class="flex gap-1 overflow-x-auto rounded-lg bg-surface-2 p-1 md:hidden [scrollbar-width:none]"
  >
    {#each [{ id: 'starters' as const, label: 'Starters' }, { id: 'minutes' as const, label: 'Minutes' }, { id: 'closing' as const, label: 'Closing' }] as tab (tab.id)}
      <button
        type="button"
        aria-pressed={mobileSection === tab.id}
        onclick={() => {
          mobileSection = tab.id;
        }}
        class="shrink-0 rounded-md px-3 py-2 font-mono text-[10px] font-bold uppercase tracking-[0.12em] transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring {mobileSection ===
        tab.id
          ? 'bg-surface-1 text-foreground shadow-sm'
          : 'text-muted-foreground hover:text-foreground'}"
      >
        {tab.label}
      </button>
    {/each}
  </div>

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

  <!-- Mobile: tabbed rotation sections -->
  <section
    aria-labelledby="mobile-rotation-heading"
    class="min-w-0 overflow-hidden rounded-none bg-surface-1 p-3 md:hidden md:rounded-xl"
  >
    <h3
      id="mobile-rotation-heading"
      class="font-mono text-[11px] font-bold uppercase tracking-[0.14em] text-muted-foreground"
    >
      {#if mobileSection === 'starters'}
        Starter lineup
      {:else if mobileSection === 'minutes'}
        Players & minutes
      {:else}
        Closing five
      {/if}
    </h3>

    {#if mobileSection === 'starters'}
      <ul class="mt-2 flex flex-col gap-2">
        {#each editor.rotation.starters as playerVersionId, slotIndex (slotIndex)}
          {@const row = rows.find((r) => r.member.playerVersionId === playerVersionId)}
          {@const slotFailures = failureIndex.byPlayer.get(playerVersionId) ?? null}
          <li class="flex flex-col gap-1">
            <div class="flex items-center gap-2">
              <span
                class="w-7 shrink-0 font-mono text-[10px] font-bold uppercase text-muted-foreground"
              >
                {slotLabel(slotIndex)}{slotIndex + 1}
              </span>
              <select
                value={playerVersionId}
                {disabled}
                aria-label={`Starter slot ${slotIndex + 1}`}
                aria-invalid={slotFailures !== null ? 'true' : undefined}
                aria-describedby={slotFailures !== null
                  ? `mobile-starter-failure-${String(slotIndex)}`
                  : undefined}
                onchange={(event) =>
                  changeStarter(slotIndex, (event.currentTarget as HTMLSelectElement).value)}
                class="min-h-11 min-w-0 flex-1 rounded-lg bg-surface-2 px-3 py-2 text-sm font-semibold outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-40"
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
            </div>
            {#if slotFailures !== null}
              <ul
                id="mobile-starter-failure-{String(slotIndex)}"
                class="list-inside list-disc pl-7 text-xs text-destructive"
              >
                {#each slotFailures as failure (failure)}
                  <li>{failure}</li>
                {/each}
              </ul>
            {/if}
          </li>
        {/each}
      </ul>
      <p class="mt-3 text-xs text-muted-foreground">
        Swapping a bench player into a starter slot promotes them; the displaced starter takes that
        bench spot.
      </p>
    {:else if mobileSection === 'closing'}
      <ul class="mt-2 flex flex-col gap-2">
        {#each editor.rotation.closingFive as playerVersionId, slotIndex (slotIndex)}
          {@const row = rows.find((r) => r.member.playerVersionId === playerVersionId)}
          {@const slotFailures = failureIndex.byPlayer.get(playerVersionId) ?? null}
          <li class="flex flex-col gap-1">
            <div class="flex items-center gap-2">
              <span
                class="w-7 shrink-0 font-mono text-[10px] font-bold uppercase text-muted-foreground"
              >
                {slotLabel(slotIndex)}{slotIndex + 1}
              </span>
              <select
                value={playerVersionId}
                {disabled}
                aria-label={`Closing slot ${slotIndex + 1}`}
                aria-invalid={slotFailures !== null ? 'true' : undefined}
                aria-describedby={slotFailures !== null
                  ? `mobile-closing-failure-${String(slotIndex)}`
                  : undefined}
                onchange={(event) =>
                  changeClosing(slotIndex, (event.currentTarget as HTMLSelectElement).value)}
                class="min-h-11 min-w-0 flex-1 rounded-lg bg-surface-2 px-3 py-2 text-sm font-semibold outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-40"
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
            </div>
            {#if slotFailures !== null}
              <ul
                id="mobile-closing-failure-{String(slotIndex)}"
                class="list-inside list-disc pl-7 text-xs text-destructive"
              >
                {#each slotFailures as failure (failure)}
                  <li>{failure}</li>
                {/each}
              </ul>
            {/if}
          </li>
        {/each}
      </ul>
      <p class="mt-3 text-xs text-muted-foreground">
        Preferred in the final minutes and overtimes — independent from the starting five.
      </p>
    {:else}
      <ul class="mt-2 flex flex-col divide-y divide-border/60">
        {#each rows as row (row.member.playerVersionId)}
          {@const rowFailures = failureIndex.byPlayer.get(row.member.playerVersionId) ?? null}
          <li class="py-3">
            <div class="flex min-w-0 items-center gap-3">
              {#if manifest !== null}
                {#if faceOf(row.member.playerVersionId) !== null}
                  <SeasonPlayerFace
                    face={faceOf(row.member.playerVersionId)!}
                    {manifest}
                    size="sm"
                  />
                {:else}
                  <span
                    class="grid h-9 w-9 shrink-0 place-items-center rounded-md bg-surface-3 font-display font-extrabold text-muted-foreground"
                    aria-hidden="true"
                  >
                    ?
                  </span>
                {/if}
              {/if}
              <div class="min-w-0 flex-1">
                <div class="flex min-w-0 items-center gap-2">
                  <p class="min-w-0 truncate text-sm font-semibold">{row.member.displayName}</p>
                  {#if overallByVersion?.has(row.member.playerVersionId)}
                    <span
                      class="shrink-0 rounded bg-surface-3 px-1.5 py-0.5 font-mono text-[10px] font-bold text-foreground"
                    >
                      OVR {overallByVersion.get(row.member.playerVersionId)}
                    </span>
                  {/if}
                </div>
                <p class="truncate font-mono text-[10px] text-muted-foreground">
                  {row.role}
                  {#if row.member.playable.length > 0}· {row.member.playable.join('/')}{/if}
                </p>
              </div>
            </div>
            <div class="mt-2 flex items-center justify-end gap-1 pl-12">
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
                  class="grid h-11 w-11 place-items-center rounded-lg bg-surface-2 text-base font-bold outline-none focus-visible:ring-2 focus-visible:ring-ring hover:bg-surface-3 disabled:opacity-40"
                >
                  −
                </button>
                <output
                  class="w-10 text-center font-mono text-sm font-bold tabular-nums"
                  aria-live="polite"
                >
                  {row.minutes}
                </output>
                <button
                  type="button"
                  aria-label={`Increase minutes for ${row.member.displayName}`}
                  onclick={() => changeMinutes(row.member.playerVersionId, 1)}
                  {disabled}
                  class="grid h-11 w-11 place-items-center rounded-lg bg-surface-2 text-base font-bold outline-none focus-visible:ring-2 focus-visible:ring-ring hover:bg-surface-3 disabled:opacity-40"
                >
                  +
                </button>
              </div>
            </div>
            {#if rowFailures !== null}
              <ul
                id="rotation-failure-{row.member.playerVersionId}"
                class="mt-1 list-inside list-disc text-xs text-destructive"
              >
                {#each rowFailures as failure (failure)}
                  <li>{failure}</li>
                {/each}
              </ul>
            {/if}
          </li>
        {/each}
      </ul>
    {/if}
  </section>

  <!-- Desktop: starter slots + bench order -->
  <div class="hidden gap-4 md:grid lg:grid-cols-2">
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
          {@const slotFailures = failureIndex.byPlayer.get(playerVersionId) ?? null}
          <li class="flex flex-col gap-1">
            <div class="flex items-center gap-2">
              <span
                class="w-7 shrink-0 font-mono text-[10px] font-bold uppercase text-muted-foreground"
              >
                {slotLabel(slotIndex)}{slotIndex + 1}
              </span>
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
            </div>
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

  <!-- Desktop: closing five -->
  <section aria-labelledby="closing-heading" class="hidden rounded-xl bg-surface-1 p-4 md:block">
    <h3
      id="closing-heading"
      class="font-mono text-[11px] font-bold uppercase tracking-[0.14em] text-muted-foreground"
    >
      Closing five (preferred in the final minutes and overtimes)
    </h3>
    <ul class="mt-2 flex flex-col gap-2">
      {#each editor.rotation.closingFive as playerVersionId, slotIndex (slotIndex)}
        {@const row = rows.find((r) => r.member.playerVersionId === playerVersionId)}
        {@const slotFailures = failureIndex.byPlayer.get(playerVersionId) ?? null}
        <li class="flex flex-col gap-1">
          <div class="flex items-center gap-2">
            <span
              class="w-7 shrink-0 font-mono text-[10px] font-bold uppercase text-muted-foreground"
            >
              {slotLabel(slotIndex)}{slotIndex + 1}
            </span>
            <select
              value={playerVersionId}
              {disabled}
              aria-label={`Closing slot ${slotIndex + 1}`}
              aria-invalid={slotFailures !== null ? 'true' : undefined}
              aria-describedby={slotFailures !== null
                ? `closing-failure-${String(slotIndex)}`
                : undefined}
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
          </div>
          {#if slotFailures !== null}
            <ul
              id="closing-failure-{String(slotIndex)}"
              class="list-inside list-disc pl-7 text-xs text-destructive"
            >
              {#each slotFailures as failure (failure)}
                <li>{failure}</li>
              {/each}
            </ul>
          {/if}
        </li>
      {/each}
    </ul>
  </section>

  <!-- Desktop: target minutes -->
  <section aria-labelledby="minutes-heading" class="hidden rounded-xl bg-surface-1 p-4 md:block">
    <h3
      id="minutes-heading"
      class="font-mono text-[11px] font-bold uppercase tracking-[0.14em] text-muted-foreground"
    >
      Target minutes
    </h3>
    <ul class="mt-2 flex flex-col divide-y divide-border/60">
      {#each rows as row (row.member.playerVersionId)}
        {@const rowFailures = failureIndex.byPlayer.get(row.member.playerVersionId) ?? null}
        <li class="flex flex-col gap-1 py-2">
          <div class="flex items-center gap-3">
            <div class="flex min-w-0 flex-1 items-center gap-2">
              <span class="min-w-0 truncate text-sm font-semibold">
                {row.member.displayName}
              </span>
              {#if overallByVersion?.has(row.member.playerVersionId)}
                <span
                  class="shrink-0 rounded bg-surface-3 px-1.5 py-0.5 font-mono text-[10px] font-bold text-foreground"
                >
                  OVR {overallByVersion.get(row.member.playerVersionId)}
                </span>
              {/if}
            </div>
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
</div>
