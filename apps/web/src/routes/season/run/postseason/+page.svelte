<script lang="ts">import { getContext } from 'svelte';
import { resolve } from '$app/paths';
import type { RouteId } from '$app/types';
import { SEASON_RUN_SHELL_CONTEXT, type SeasonRunShellData, } from '$lib/season/season-shell-context';
import { postseasonStageLabel } from '$lib/season/season-postseason-presentation';
import PostseasonBracket from '$lib/components/season/PostseasonBracket.svelte';
const shell = getContext<SeasonRunShellData>(SEASON_RUN_SHELL_CONTEXT);
const run = $derived(shell.run);
const humanFranchiseId = $derived(shell.humanFranchiseId);
const manifest = $derived(shell.manifest);
const stage = $derived(run?.stage ?? null);
const stageLabel = $derived(postseasonStageLabel(stage ?? 'regular-season'));
const postseasonStarted = $derived(stage === 'play-in' || stage === 'playoffs' || stage === 'completed');
const champion = $derived(run?.postseason.championFranchiseId ?? null);
</script>

<svelte:head>
  <title>Season Run — Postseason — Hoop Rush</title>
</svelte:head>

{#if !shell.ready || run === null || humanFranchiseId === null}
  <p class="py-10 font-mono text-sm text-muted-foreground">Preparing the postseason…</p>
{:else if !postseasonStarted}
  <section aria-labelledby="postseason-empty-heading" class="min-w-0 pt-6">
    <div class="mx-auto w-full max-w-xl px-3 sm:px-0">
      <div class="scoreboard-panel p-6">
        <h1
          id="postseason-empty-heading"
          class="font-display text-2xl font-extrabold uppercase tracking-tight"
        >
          The postseason hasn't started
        </h1>
        <p class="mt-2 text-sm text-muted-foreground">
          Finish the regular season — all nine checkpoints — then start the postseason from the hub.
        </p>
        <a
          href={resolve('/season/run' as any)}
          class="mt-4 inline-flex items-center justify-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition-opacity outline-none focus-visible:ring-2 focus-visible:ring-ring hover:opacity-90"
        >
          Back to the hub
        </a>
      </div>
    </div>
  </section>
{:else if manifest === null}
  <p class="py-10 font-mono text-sm text-muted-foreground">Preparing the postseason…</p>
{:else}
  <section aria-labelledby="postseason-heading" class="min-w-0 pt-6">
    <div class="flex flex-col gap-3 px-3 sm:flex-row sm:items-end sm:justify-between sm:px-0">
      <div class="min-w-0">
        <p class="font-mono text-xs tracking-[0.16em] text-primary uppercase">
          Season Run · {stageLabel}
        </p>
        <h1
          id="postseason-heading"
          class="font-display mt-1 text-2xl font-extrabold tracking-tight uppercase sm:text-3xl"
        >
          Postseason
        </h1>
        <p class="mt-1 font-mono text-[10px] text-muted-foreground">
          Play-In · First Round · Conference Semis · Conference Finals · Finals
        </p>
      </div>
      <a
        href={resolve('/season/run' as any)}
        class="inline-flex w-fit items-center justify-center gap-2 rounded-lg border border-border px-4 py-2 text-sm font-semibold text-muted-foreground transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring hover:text-foreground"
      >
        Hub
      </a>
    </div>

    {#if champion !== null}
      <div
        class="mt-4 rounded-none border border-primary/40 bg-gradient-to-b from-primary/15 to-surface-1 px-4 py-3 sm:rounded-xl"
        data-season-bracket-champion
      >
        <p class="font-mono text-[10px] font-bold uppercase tracking-[0.18em] text-primary">
          Champion
        </p>
        <p class="font-display text-xl font-extrabold uppercase tracking-tight">
          {shell.franchiseName(champion)}
          {#if champion === humanFranchiseId}
            <span class="text-primary" aria-label="your team">*</span>
          {/if}
        </p>
      </div>
    {/if}

    <div class="mt-6">
      <PostseasonBracket
        postseason={run.postseason}
        franchiseName={shell.franchiseName}
        franchiseAbbrev={shell.franchiseAbbrev}
        {manifest}
        {humanFranchiseId}
      />
    </div>

    <p class="mt-6 px-3 font-mono text-[10px] text-muted-foreground sm:px-0">
      Every series is best of seven; the home-court side plays games 1, 2, 5, and 7. Play-In games
      are single elimination. Facts come from the saved postseason state — no predictions.
    </p>
  </section>
{/if}
