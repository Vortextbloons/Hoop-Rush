<script lang="ts">
  import { getContext } from 'svelte';
  import { resolve } from '$app/paths';
  import type { RouteId } from '$app/types';
  import SeasonPlayerFace from '$lib/components/season/SeasonPlayerFace.svelte';
  import SeasonTeamLogo from '$lib/components/season/SeasonTeamLogo.svelte';
  import RotationEditor from '$lib/components/season/RotationEditor.svelte';
  import { eraIdentityOf, franchiseIdentityOf } from '$lib/season/season-branding';
  import {
    SEASON_RUN_SHELL_CONTEXT,
    type SeasonRunShellData,
  } from '$lib/season/season-shell-context';

  /**
   * Season Run team tab (M2.3.5): the human franchise's ten players with
   * their historical source identity (season face + era logo) beside the
   * rotation workspace. The editor itself is shell-owned and survives tab
   * switches; there is no separate save — the rotation locks when the block
   * submits. The sticky action bar reports validation state and shortcuts to
   * the Hub's simulate-block action.
   */

  const shell = getContext<SeasonRunShellData>(SEASON_RUN_SHELL_CONTEXT);

  const run = $derived(shell.run);
  const humanFranchiseId = $derived(shell.humanFranchiseId);
  const manifest = $derived(shell.manifest);

  const roster = $derived(
    run !== null && humanFranchiseId !== null
      ? (run.rosters.find((r) => r.franchiseId === humanFranchiseId) ?? null)
      : null,
  );

  const editorRows = $derived(shell.editor?.rows() ?? []);
  const failures = $derived(shell.editor?.validate() ?? []);

  const rowOf = (playerVersionId: string) =>
    editorRows.find((row) => row.member.playerVersionId === playerVersionId);

  const hubHref = $derived(resolve('/season/run'));
</script>

<svelte:head>
  <title>Season Run — Team — Hoop Rush</title>
</svelte:head>

<div class="flex flex-col gap-6 pt-6">
  {#if roster === null || run === null || humanFranchiseId === null}
    <p class="font-mono text-sm text-muted-foreground">Loading the roster…</p>
  {:else}
    <div class="grid gap-6 lg:grid-cols-5">
      <!-- 1. Roster section -->
      <section aria-labelledby="roster-heading" class="lg:col-span-2">
        <h2
          id="roster-heading"
          class="font-display text-base font-extrabold uppercase tracking-tight"
        >
          Roster
        </h2>
        <ul class="mt-3 flex flex-col gap-2">
          {#each roster.players as entry (entry.playerVersionId)}
            {@const face = shell.facesByVersion.get(entry.playerVersionId) ?? null}
            {@const eraIdentity =
              manifest !== null ? eraIdentityOf(manifest, entry.franchiseId, entry.eraId) : null}
            {@const modernIdentity =
              manifest !== null ? franchiseIdentityOf(manifest, entry.franchiseId) : null}
            {@const row = rowOf(entry.playerVersionId)}
            <li class="rounded-xl bg-surface-1 p-3">
              <div class="flex items-center gap-3">
                {#if manifest !== null && face !== null}
                  <SeasonPlayerFace {face} {manifest} size="sm" />
                {:else}
                  <span
                    class="grid h-9 w-9 shrink-0 place-items-center rounded-md bg-surface-3 font-display font-extrabold text-muted-foreground"
                    aria-hidden="true"
                  >
                    ?
                  </span>
                {/if}
                <div class="min-w-0 flex-1">
                  <p class="truncate text-sm font-semibold">{entry.displayName}</p>
                  <p class="truncate font-mono text-[10px] text-muted-foreground">
                    {entry.seasonKey}
                    {#if shell.playablePositions(entry.playerVersionId).length > 0}
                      · {shell.playablePositions(entry.playerVersionId).join('/')}
                    {/if}
                  </p>
                </div>
                <div class="flex shrink-0 flex-col items-end gap-1">
                  {#if manifest !== null}
                    <SeasonTeamLogo
                      {manifest}
                      franchiseId={entry.franchiseId}
                      teamExternalId={modernIdentity?.teamExternalId ?? ''}
                      logoCandidates={eraIdentity?.logoCandidates ?? []}
                      size="sm"
                      alt={eraIdentity?.displayLabel ?? modernIdentity?.displayName ?? ''}
                    />
                  {/if}
                  <span class="font-mono text-[10px] text-muted-foreground">
                    {row?.role ?? '—'} · {row?.minutes ?? '—'} min
                  </span>
                </div>
              </div>
              {#if eraIdentity?.displayLabel}
                <p class="mt-1 truncate font-mono text-[9px] text-muted-foreground/70">
                  {eraIdentity.displayLabel}
                </p>
              {/if}
            </li>
          {/each}
        </ul>
      </section>

      <!-- 2. Rotation workspace -->
      <section aria-labelledby="workspace-heading" class="lg:col-span-3">
        <h2
          id="workspace-heading"
          class="font-display text-base font-extrabold uppercase tracking-tight"
        >
          Rotation workspace
        </h2>
        <div class="mt-3">
          {#if shell.editor !== null && manifest !== null}
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
          {:else}
            <p class="font-mono text-sm text-muted-foreground">Preparing the rotation editor…</p>
          {/if}
        </div>

        <!-- Sticky action bar: validation state + simulate shortcut -->
        <div class="sticky bottom-20 z-20 mt-6 md:bottom-4">
          <div
            class="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-surface-1/95 p-3 shadow-2xl shadow-black/30 backdrop-blur supports-[backdrop-filter]:bg-surface-1/85"
          >
            <p class="text-sm" aria-live="polite">
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
            <a
              href={hubHref}
              aria-disabled={failures.length > 0 ? 'true' : undefined}
              class="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg bg-primary px-5 py-2.5 font-semibold text-primary-foreground transition-opacity outline-none focus-visible:ring-2 focus-visible:ring-ring hover:opacity-90 {failures.length >
              0
                ? 'pointer-events-none opacity-40'
                : ''}"
            >
              Simulate next block
            </a>
          </div>
        </div>
      </section>
    </div>
  {/if}
</div>
