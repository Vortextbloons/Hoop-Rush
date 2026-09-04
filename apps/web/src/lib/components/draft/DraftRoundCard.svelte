<script lang="ts">
  import type { HoopRushManifest } from '@hoop-rush/data-contracts';
  import TeamLogo from '$lib/components/TeamLogo.svelte';

  let {
    label,
    round,
    totalRounds = 5,
    turnText = null,
    ariaLabel,
    manifest,
    franchiseId,
    teamExternalId,
    logoCandidates = [],
    franchiseAbbreviation,
    franchiseDisplayName = null,
    eraLabel,
    franchiseRerollAvailable,
    franchiseRerollSpent,
    eraRerollAvailable,
    eraRerollSpent,
    controlsDisabled = false,
    onRerollFranchise,
    onRerollEra,
  }: {
    label: string;
    round: number;
    totalRounds?: number;
    turnText?: string | null;
    ariaLabel: string;
    manifest: HoopRushManifest;
    franchiseId: string;
    teamExternalId: string;
    logoCandidates?: string[];
    franchiseAbbreviation: string;
    franchiseDisplayName?: string | null;
    eraLabel: string;
    franchiseRerollAvailable: boolean;
    franchiseRerollSpent: boolean;
    eraRerollAvailable: boolean;
    eraRerollSpent: boolean;
    controlsDisabled?: boolean;
    onRerollFranchise: () => void;
    onRerollEra: () => void;
  } = $props();

  const dots = $derived(Array.from({ length: totalRounds }, (_, i) => i));
  const franchiseTitle = $derived(
    franchiseRerollSpent
      ? 'Already used'
      : !franchiseRerollAvailable
        ? 'No alternative'
        : 'Roll a different franchise',
  );
  const eraTitle = $derived(
    eraRerollSpent
      ? 'Already used'
      : !eraRerollAvailable
        ? 'No alternative'
        : 'Roll a different era',
  );
</script>

<div class="min-w-0 overflow-hidden rounded-xl bg-surface-1">
  <div
    class="flex min-w-0 flex-wrap items-center justify-between gap-2 px-3 py-2.5 sm:gap-3 sm:px-4 sm:py-3"
  >
    <span
      data-round-heading
      class="font-display min-w-0 flex-1 truncate text-base font-extrabold tracking-tight uppercase sm:text-lg"
    >
      {label}
    </span>
    <span class="flex shrink-0 gap-1.5" aria-hidden="true">
      {#each dots as i (i)}
        <span
          class="h-2 w-2 rounded-full {i < round - 1
            ? 'bg-primary'
            : i === round - 1
              ? 'bg-accent'
              : 'border border-border'}"
        ></span>
      {/each}
    </span>
  </div>
  {#if turnText}
    <p class="min-w-0 truncate px-3 text-xs text-muted-foreground sm:px-4" aria-live="polite">
      {turnText}
    </p>
  {/if}
  <div class="flex min-w-0 flex-col gap-2 px-3 pt-2 pb-3 sm:gap-3 sm:px-4 sm:pb-4">
    <div class="grid w-full min-w-0 grid-cols-2 gap-2" aria-label={ariaLabel}>
      <span
        class="flex min-w-0 items-center gap-2 overflow-hidden rounded-lg bg-surface-2 px-2.5 py-2 sm:px-3"
        data-indicator="franchise"
      >
        <span class="shrink-0">
          <TeamLogo {manifest} {franchiseId} {teamExternalId} {logoCandidates} />
        </span>
        <span class="min-w-0 flex-1">
          <span class="block truncate font-mono text-[10px] font-bold tracking-[0.12em] uppercase">
            {franchiseAbbreviation}
          </span>
          {#if franchiseDisplayName}
            <span class="block truncate text-sm font-bold">
              {franchiseDisplayName}
            </span>
          {/if}
        </span>
      </span>
      <span
        class="flex min-w-0 items-center justify-center overflow-hidden rounded-lg bg-surface-2 px-2.5 py-2 sm:px-3"
        data-indicator="era"
      >
        <span class="font-display truncate text-sm font-extrabold tracking-tight">
          {eraLabel}
        </span>
      </span>
    </div>
    <div class="grid w-full min-w-0 grid-cols-2 gap-2">
      <button
        type="button"
        disabled={controlsDisabled || !franchiseRerollAvailable}
        title={franchiseTitle}
        onclick={onRerollFranchise}
        class="flex min-h-11 min-w-0 flex-col items-center justify-center overflow-hidden rounded-lg bg-surface-2 px-2 py-2 text-center transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring hover:bg-surface-3 disabled:cursor-not-allowed disabled:opacity-40 sm:flex-row sm:gap-2 sm:px-3"
      >
        <span class="block w-full truncate text-[11px] font-semibold leading-tight sm:text-sm"
          >Reroll franchise</span
        >
        {#if franchiseRerollSpent}
          <span
            class="mt-0.5 shrink-0 font-mono text-[9px] font-bold tracking-[0.12em] text-muted-foreground uppercase sm:mt-0"
          >
            Used
          </span>
        {/if}
      </button>
      <button
        type="button"
        disabled={controlsDisabled || !eraRerollAvailable}
        title={eraTitle}
        onclick={onRerollEra}
        class="flex min-h-11 min-w-0 flex-col items-center justify-center overflow-hidden rounded-lg bg-surface-2 px-2 py-2 text-center transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring hover:bg-surface-3 disabled:cursor-not-allowed disabled:opacity-40 sm:flex-row sm:gap-2 sm:px-3"
      >
        <span class="block w-full truncate text-[11px] font-semibold leading-tight sm:text-sm"
          >Reroll era</span
        >
        {#if eraRerollSpent}
          <span
            class="mt-0.5 shrink-0 font-mono text-[9px] font-bold tracking-[0.12em] text-muted-foreground uppercase sm:mt-0"
          >
            Used
          </span>
        {/if}
      </button>
    </div>
  </div>
</div>
