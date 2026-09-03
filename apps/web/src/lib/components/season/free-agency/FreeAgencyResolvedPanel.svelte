<script lang="ts">
  import { ChevronDown, Trophy, X } from '@lucide/svelte';
  import type { HoopRushManifest, SeasonFreeAgencyWindowState } from '@hoop-rush/data-contracts';
  import type { SeasonFreeAgencyTraceStep } from '@hoop-rush/data-contracts';
  import SeasonPlayerFace from '$lib/components/season/SeasonPlayerFace.svelte';
  import type { SeasonFaceRef } from '$lib/season/season-branding';
  import {
    CRITERION_LABEL,
    FREE_AGENCY_BAND_LABEL,
    humanSigningOf,
    ROLE_EXPECTATION_LABEL,
  } from './free-agency-view';
  let {
    window,
    humanFranchiseId,
    franchiseName,
    playerName,
    manifest = null,
    faceOf = null,
    signingCount,
    seasonSpend,
    resolvedInThisSession = false,
  }: {
    window: SeasonFreeAgencyWindowState;
    humanFranchiseId: string | null;
    franchiseName: (franchiseId: string) => string;
    playerName: (playerVersionId: string) => string;
    manifest?: HoopRushManifest | null;
    faceOf?: ((playerVersionId: string) => SeasonFaceRef | null) | null;
    signingCount: number;
    seasonSpend: number;
    resolvedInThisSession?: boolean;
  } = $props();
  const humanSigning = $derived(humanSigningOf(window, humanFranchiseId ?? null) ?? null);
  const traceGroups = $derived.by(() => {
    const groups: Record<string, SeasonFreeAgencyTraceStep[]> = {};
    for (const trace of window.traces) {
      for (const step of trace.steps) {
        const list = groups[step.candidatePlayerVersionId] ?? [];
        list.push(step);
        groups[step.candidatePlayerVersionId] = list;
      }
    }
    return Object.entries(groups).map(([playerVersionId, steps]) => ({
      playerVersionId,
      steps,
    }));
  });
</script>

<section
  aria-labelledby="free-agency-resolved-heading"
  class="rounded-none border border-border bg-surface-1 p-4 sm:rounded-xl sm:p-5"
  data-fa-window-resolved
>
  {#if resolvedInThisSession}
    <p role="status" aria-live="polite" data-fa-resolution-announcement class="sr-only">
      Free Agency Window {window.windowIndex + 1} resolved.
    </p>
  {/if}

  <div class="flex flex-wrap items-baseline justify-between gap-2">
    <h2
      id="free-agency-resolved-heading"
      class="font-display text-lg font-extrabold uppercase tracking-tight"
    >
      Free Agency Window {window.windowIndex + 1} — resolved
    </h2>
    <span class="font-mono text-[10px] text-muted-foreground">
      {window.signings.length} signing{window.signings.length === 1 ? '' : 's'}
    </span>
  </div>

  {#if window.signings.length === 0}
    <p class="mt-3 text-sm text-muted-foreground" data-fa-no-signings>
      No team signed this window.
    </p>
  {:else}
    <ul class="mt-3 flex flex-col gap-1.5" data-fa-signings>
      {#each window.signings as signing (signing.signingId)}
        {@const human = signing.franchiseId === humanFranchiseId}
        {@const face = manifest !== null ? (faceOf?.(signing.playerVersionId) ?? null) : null}
        <li
          data-fa-signing
          data-fa-signing-human={human ? 'true' : 'false'}
          class="flex flex-wrap items-center gap-x-2 gap-y-0.5 rounded-lg bg-surface-2 px-3 py-2 text-sm {human
            ? 'border border-positive/40'
            : ''}"
        >
          {#if human}
            <Trophy class="h-4 w-4 shrink-0 text-positive" aria-hidden="true" />
          {:else}
            <X class="h-4 w-4 shrink-0 text-muted-foreground/40" aria-hidden="true" />
          {/if}
          {#if manifest !== null && face !== null}
            <SeasonPlayerFace {face} {manifest} size="sm" />
          {:else}
            <span
              class="grid h-9 w-9 shrink-0 place-items-center rounded-md bg-surface-3 font-display text-xs font-extrabold text-muted-foreground"
              aria-hidden="true"
            >
              ?
            </span>
          {/if}
          <span class="min-w-0 truncate font-semibold">
            {franchiseName(signing.franchiseId)}
            {#if human}
              <span class="text-positive">· you</span>
            {/if}
          </span>
          <span class="min-w-0 truncate text-muted-foreground">
            signed {playerName(signing.playerVersionId)}
          </span>
          <span class="font-mono text-[10px] text-muted-foreground">
            {FREE_AGENCY_BAND_LABEL[signing.band]} · {ROLE_EXPECTATION_LABEL[
              signing.roleExpectation
            ]} · {signing.influenceCost} Influence
          </span>
        </li>
      {/each}
    </ul>
  {/if}

  <p class="mt-3 text-sm" data-fa-human-result>
    {#if humanSigning !== null}
      <strong class="text-positive">You signed {playerName(humanSigning.playerVersionId)}.</strong>
      <span class="text-muted-foreground">
        {humanSigning.influenceCost} Influence debited, {String(signingCount)} season signing
        {signingCount === 1 ? '' : 's'}.
      </span>
    {:else}
      <span class="text-muted-foreground">
        Your team did not sign this window. Season free-agency spend:
        {String(seasonSpend)} of 6 Influence · {String(signingCount)} of 3 signings.
      </span>
    {/if}
  </p>

  {#if traceGroups.length > 0}
    <div class="mt-4 flex flex-col gap-2" data-fa-traces>
      {#each traceGroups as group (group.playerVersionId)}
        <details data-fa-trace-disclosure class="rounded-lg border border-border bg-surface-2">
          <summary
            class="flex min-h-10 cursor-pointer items-center justify-between gap-2 px-3 py-2 text-sm font-semibold outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <span class="min-w-0 truncate"
              >Why {playerName(group.playerVersionId)} signed where</span
            >
            <ChevronDown class="h-4 w-4 shrink-0 text-muted-foreground" />
          </summary>
          <ol class="flex flex-col divide-y divide-border/50 px-3 pb-3">
            {#each group.steps as step, index (index)}
              <li class="flex flex-col gap-1 py-2">
                <div class="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                  <span
                    class="font-mono text-[9px] font-bold tracking-[0.12em] text-primary uppercase"
                  >
                    {CRITERION_LABEL[step.criterion]}
                  </span>
                  <span class="font-mono text-[10px] font-semibold text-foreground">
                    {step.category}
                  </span>
                  <span class="ml-auto font-mono text-[9px] text-muted-foreground/70">
                    {franchiseName(step.franchiseId)}
                  </span>
                </div>
                {#if step.citedFacts.length > 0}
                  <ul class="list-inside list-disc pl-4">
                    {#each step.citedFacts as fact (fact)}
                      <li class="text-xs leading-snug text-muted-foreground">{fact}</li>
                    {/each}
                  </ul>
                {/if}
              </li>
            {/each}
          </ol>
        </details>
      {/each}
    </div>
  {/if}
</section>
