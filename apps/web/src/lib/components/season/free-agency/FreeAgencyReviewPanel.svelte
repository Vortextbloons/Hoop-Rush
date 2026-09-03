<script lang="ts">import { ShieldCheck } from '@lucide/svelte';
import type { HoopRushManifest, SeasonFreeAgencyCandidate } from '@hoop-rush/data-contracts';
import type { SeasonFreeAgencyDeclaration } from '@hoop-rush/data-contracts';
import SeasonPlayerFace from '$lib/components/season/SeasonPlayerFace.svelte';
import type { SeasonFaceRef } from '$lib/season/season-branding';
import { ROLE_EXPECTATION_LABEL } from './free-agency-view';
let { windowIndex, declaration, candidates, manifest = null, faceOf = null, overallOf = null, busy = false, onSubmit, onGoBackToMarket = null, }: {
    windowIndex: number;
    declaration: SeasonFreeAgencyDeclaration;
    candidates: readonly SeasonFreeAgencyCandidate[];
    manifest?: HoopRushManifest | null;
    faceOf?: ((playerVersionId: string) => SeasonFaceRef | null) | null;
    overallOf?: ((playerVersionId: string) => number | null) | null;
    busy?: boolean;
    onSubmit: () => void;
    onGoBackToMarket?: (() => void) | null;
} = $props();
const skipped = $derived(declaration.targets.length === 0);
const names = $derived(new Map(candidates.map((candidate) => [candidate.playerVersionId, candidate.displayName] as const)));
</script>

<section
  aria-labelledby="free-agency-review-heading"
  class="rounded-none border border-primary/30 bg-primary/5 p-4 sm:rounded-xl sm:p-5"
  data-fa-review-panel
>
  <div class="flex flex-wrap items-center justify-between gap-2">
    <h2
      id="free-agency-review-heading"
      class="font-display text-lg font-extrabold uppercase tracking-tight"
    >
      Declaration submitted
    </h2>
    <span
      class="inline-flex items-center gap-1.5 rounded-full bg-positive/15 px-2.5 py-1 font-mono text-[10px] font-bold text-positive"
    >
      <ShieldCheck class="h-3.5 w-3.5" />
      Immutable
    </span>
  </div>

  {#if skipped}
    <p class="mt-2 text-sm text-muted-foreground" data-fa-review-skip>
      Your team recorded a skip for this market — no targets, no Influence committed.
    </p>
  {:else}
    <ol class="mt-3 flex flex-col gap-1.5" data-fa-review-targets>
      {#each declaration.targets as target, index (target.playerVersionId)}
        {@const face = manifest !== null ? (faceOf?.(target.playerVersionId) ?? null) : null}
        {@const overall = overallOf?.(target.playerVersionId) ?? null}
        <li
          class="flex flex-wrap items-center gap-x-2 gap-y-0.5 rounded-lg bg-surface-2 px-3 py-2 text-sm"
        >
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
          <span class="font-mono text-[10px] font-bold text-primary uppercase">
            {index === 0 ? 'First priority' : 'Second priority'}
          </span>
          <span class="min-w-0 truncate font-semibold">
            {names.get(target.playerVersionId) ?? target.playerVersionId}
          </span>
          {#if overall !== null}
            <span
              class="shrink-0 rounded bg-surface-3 px-1.5 py-0.5 font-mono text-[10px] font-bold"
            >
              OVR {overall}
            </span>
          {/if}
          <span class="font-mono text-[10px] text-muted-foreground">
            {ROLE_EXPECTATION_LABEL[target.roleExpectation]}
          </span>
          <span class="ml-auto font-mono text-xs font-bold tabular-nums">
            {target.influence} Influence
          </span>
        </li>
      {/each}
    </ol>
    <p class="mt-2 font-mono text-[9px] text-muted-foreground/70">
      Paid only if the target wins; losing targets cost nothing.
    </p>
  {/if}

  <div class="mt-4 rounded-lg border border-border bg-surface-1 p-3">
    <p class="text-sm text-muted-foreground">
      Resolving compares every recorded declaration by candidate, then applies the winning signings.
      The next block cannot submit until this market resolves.
    </p>
    <div class="mt-3 flex flex-col gap-2 sm:flex-row sm:flex-wrap">
      <button
        type="button"
        data-fa-resolve
        onclick={onSubmit}
        disabled={busy}
        aria-busy={busy ? 'true' : undefined}
        class="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground transition-opacity outline-none focus-visible:ring-2 focus-visible:ring-ring hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
      >
        {busy ? 'Resolving…' : `Resolve Free Agency Window ${windowIndex + 1}`}
      </button>
      {#if onGoBackToMarket !== null}
        <button
          type="button"
          onclick={() => onGoBackToMarket?.()}
          disabled={busy}
          class="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border border-border px-5 py-2.5 text-sm font-semibold text-muted-foreground transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
        >
          Back to the market
        </button>
      {/if}
    </div>
  </div>
</section>
