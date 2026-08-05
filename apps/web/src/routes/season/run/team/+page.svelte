<script lang="ts">
  import { getContext } from 'svelte';
  import { resolve } from '$app/paths';
  import type { RouteId } from '$app/types';
  import RotationEditor from '$lib/components/season/RotationEditor.svelte';
  import {
    blockPhaseAllowsSubmit,
    buildSubmitBlockEnvelope,
  } from '$lib/season/season-block-submit';
  import {
    SEASON_RUN_SHELL_CONTEXT,
    type SeasonRunShellData,
  } from '$lib/season/season-shell-context';

  /**
   * Season Run team tab (M2.3.5): rotation workspace for the human franchise.
   * The editor is shell-owned and survives tab switches; there is no separate
   * save — the rotation locks when the block submits. Roster cards live on the
   * Roster tab. The sticky action bar reports validation state; on mobile it
   * submits the block directly, on desktop it shortcuts to the Hub.
   */

  const shell = getContext<SeasonRunShellData>(SEASON_RUN_SHELL_CONTEXT);

  const manifest = $derived(shell.manifest);
  const failures = $derived(shell.editor?.validate() ?? []);
  const canSubmit = $derived(
    shell.snapshot !== null &&
      shell.editor !== null &&
      shell.nextBlockIndex !== null &&
      !shell.seasonComplete &&
      failures.length === 0 &&
      blockPhaseAllowsSubmit(shell.block.phase) &&
      shell.block.phase !== 'running',
  );

  let submitting = $state(false);
  let submitError: string | null = $state(null);

  async function submitBlock() {
    if (!canSubmit || submitting) return;
    submitting = true;
    submitError = null;
    try {
      const result = await buildSubmitBlockEnvelope(shell);
      if (!result.ok) {
        submitError = result.error.message;
        return;
      }
      shell.hub?.startBlock(result.envelope);
    } finally {
      submitting = false;
    }
  }
</script>

<svelte:head>
  <title>Season Run — Team — Hoop Rush</title>
</svelte:head>

<div class="flex min-w-0 flex-col gap-6 pt-6">
  {#if shell.editor === null || manifest === null}
    <p class="px-3 font-mono text-sm text-muted-foreground sm:px-0">
      Preparing the rotation editor…
    </p>
  {:else}
    <section
      aria-labelledby="workspace-heading"
      class="min-w-0 pb-[calc(5.25rem+env(safe-area-inset-bottom))] md:pb-0"
    >
      <h2
        id="workspace-heading"
        class="font-display px-3 text-base font-extrabold uppercase tracking-tight sm:px-0"
      >
        Rotation workspace
      </h2>
      <div class="mt-3">
        <RotationEditor
          editor={shell.editor}
          disabled={shell.block.phase === 'running'}
          faces={shell.facesByVersion}
          {manifest}
          onchange={() => {
            // The editor is shell-owned; reactive deriveds above already
            // mirror its state. Submission happens at block time.
          }}
        />
      </div>

      <!-- Sticky action bar: validation state + simulate -->
      <div
        class="sticky bottom-[calc(5.25rem+env(safe-area-inset-bottom))] z-20 mt-6 px-3 sm:bottom-4 sm:px-0"
      >
        <div
          class="flex flex-col gap-3 rounded-none border border-border bg-surface-1 p-3 shadow-2xl shadow-black/40 backdrop-blur supports-[backdrop-filter]:bg-surface-1/95 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between sm:rounded-xl"
        >
          <p class="min-w-0 text-sm" aria-live="polite">
            {#if failures.length === 0}
              <span class="font-semibold text-positive">Rotation valid</span>
              <span class="ml-2 hidden text-muted-foreground sm:inline">
                Locks when the next block submits.
              </span>
            {:else}
              <span class="font-semibold text-destructive">
                Rotation invalid — {failures.length} issue{failures.length === 1 ? '' : 's'}
              </span>
            {/if}
          </p>
          {#if submitError}
            <p role="alert" class="text-sm text-destructive">{submitError}</p>
          {/if}
          <div class="flex flex-col gap-2 sm:flex-row sm:items-center">
            <button
              type="button"
              onclick={() => void submitBlock()}
              disabled={!canSubmit || submitting}
              class="inline-flex w-full min-h-11 shrink-0 items-center justify-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground transition-opacity outline-none focus-visible:ring-2 focus-visible:ring-ring hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40 md:hidden"
            >
              {shell.block.phase === 'running'
                ? 'Simulating block…'
                : submitting
                  ? 'Preparing block…'
                  : 'Lock & simulate block'}
            </button>
            <a
              href={resolve('/season/run')}
              aria-disabled={failures.length > 0 ? 'true' : undefined}
              class="hidden min-h-11 shrink-0 items-center justify-center gap-2 rounded-lg border border-primary/60 bg-surface-2 px-4 py-2.5 text-sm font-semibold text-primary transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring hover:border-primary hover:bg-surface-3 md:inline-flex md:w-auto md:border-transparent md:bg-primary md:px-5 md:text-primary-foreground md:hover:opacity-90 {failures.length >
              0
                ? 'pointer-events-none opacity-40'
                : ''}"
            >
              Simulate next block
            </a>
          </div>
        </div>
      </div>
    </section>
  {/if}
</div>
