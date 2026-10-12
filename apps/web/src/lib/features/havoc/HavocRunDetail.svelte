<script lang="ts">
  import { resolve } from '$app/paths';
  import type { HavocHistoryState } from './havoc-history-state.svelte';
  import HavocComparisonView from './HavocComparisonView.svelte';
  import HavocReportView from './HavocReportView.svelte';
  import HavocTierBadge from './HavocTierBadge.svelte';
  import HavocSquadReport from './HavocSquadReport.svelte';
  import HavocAbilityReport from './HavocAbilityReport.svelte';
  import HavocLineupLock from './HavocLineupLock.svelte';
  import {
    havocComparisonStatusLabel,
    havocRecordLabel,
    mutationEntriesSummary,
  } from './havoc-presentation';

  let { state, runId }: { state: HavocHistoryState; runId: string } = $props();

  const detail = $derived(state.detail);
  const run = $derived(detail?.run ?? null);
  const report = $derived(detail?.report ?? null);
  const comparison = $derived(detail?.comparison ?? null);
  const comparisonComplete = $derived(run?.comparisonStatus === 'complete' && comparison !== null);
</script>

<section class="h-shell" data-havoc-run-detail>
  <a
    href={resolve('/havoc/history')}
    class="font-mono text-xs text-muted-foreground underline-offset-4 hover:underline"
  >
    ← Hall of Freaks
  </a>

  {#if state.detailLoading}
    <p class="mt-6 font-mono text-sm text-muted-foreground" aria-live="polite">Loading run…</p>
  {:else if detail === null || run === null}
    <div class="mt-6 rounded-xl bg-surface-1 p-6">
      <h1 class="font-display text-xl font-extrabold tracking-tight uppercase">Run unavailable</h1>
      <p class="mt-2 text-sm text-muted-foreground">
        {state.error ?? `No completed Havoc run with id ${runId} was found on this device.`}
      </p>
    </div>
  {:else}
    <header
      class="mt-4 flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end sm:justify-between"
    >
      <div class="min-w-0">
        <p class="font-mono text-[10px] font-bold tracking-[0.16em] text-primary uppercase">
          Hoop Havoc · Saved season
        </p>
        <h1 class="font-display mt-1 text-3xl font-extrabold tracking-tight uppercase">
          {havocRecordLabel(run.havocWins, run.havocLosses)}
          {#if run.perfectSeason}
            <span class="text-primary">· 82–0</span>
          {/if}
        </h1>
        <p class="mt-1 text-sm text-muted-foreground" data-havoc-detail-comparison-status>
          Comparison: {havocComparisonStatusLabel(run.comparisonStatus)}
        </p>
      </div>
      {#if run.completionState === 'abandoned'}
        <span
          class="rounded-full border border-border px-2.5 py-1 font-mono text-[10px] font-bold tracking-[0.12em] text-muted-foreground uppercase"
        >
          Unsuccessful run preserved
        </span>
      {/if}
    </header>

    {#if comparisonComplete && comparison !== null}<HavocSquadReport
        {comparison}
        lineup={run.lineup}
      />{:else}<div class="mt-6"><HavocLineupLock slots={run.lineup} /></div>{/if}
    <details class="h-panel mt-6">
      <summary>Full season report & game details</summary>
      <div class="mt-4 grid gap-4 lg:grid-cols-2">
        <section class="rounded-xl bg-surface-1 p-4 sm:p-5">
          <h2 class="font-display text-base font-extrabold tracking-tight uppercase">Record</h2>
          <dl class="mt-3 grid grid-cols-2 gap-3 text-sm">
            <div>
              <dt class="font-mono text-[10px] tracking-[0.1em] text-muted-foreground uppercase">
                Havoc record
              </dt>
              <dd class="font-mono text-lg font-bold">
                {havocRecordLabel(run.havocWins, run.havocLosses)}
              </dd>
            </div>
            <div>
              <dt class="font-mono text-[10px] tracking-[0.1em] text-muted-foreground uppercase">
                Normal record
              </dt>
              <dd class="font-mono text-lg font-bold" data-havoc-detail-normal-record>
                {#if comparisonComplete && comparison !== null}
                  {havocRecordLabel(comparison.normal.wins, comparison.normal.losses)}
                {:else}
                  <span class="text-muted-foreground">Hidden until the comparison completes</span>
                {/if}
              </dd>
            </div>
          </dl>
          {#if report !== null}
            <details class="mt-3">
              <summary
                class="cursor-pointer font-mono text-[10px] font-bold tracking-[0.12em] text-muted-foreground uppercase outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                Seed & version identifiers
              </summary>
              <dl class="mt-2 grid gap-1 font-mono text-[11px] text-muted-foreground">
                <div class="flex flex-wrap gap-x-2">
                  <dt class="font-bold uppercase">Run</dt>
                  <dd class="break-all">{run.runId}</dd>
                </div>
                <div class="flex flex-wrap gap-x-2">
                  <dt class="font-bold uppercase">Rules</dt>
                  <dd>{report.versions.rulesVersion}</dd>
                </div>
                <div class="flex flex-wrap gap-x-2">
                  <dt class="font-bold uppercase">Mutations</dt>
                  <dd>{report.versions.mutationCatalogVersion}</dd>
                </div>
                <div class="flex flex-wrap gap-x-2">
                  <dt class="font-bold uppercase">Seeds</dt>
                  <dd>{report.versions.seedDerivationVersion}</dd>
                </div>
                <div class="flex flex-wrap gap-x-2">
                  <dt class="font-bold uppercase">Engine</dt>
                  <dd>{report.versions.engineVersion}</dd>
                </div>
                <div class="flex flex-wrap gap-x-2">
                  <dt class="font-bold uppercase">Profile</dt>
                  <dd>{report.versions.profileVersion}</dd>
                </div>
                <div class="flex flex-wrap gap-x-2">
                  <dt class="font-bold uppercase">Data</dt>
                  <dd>{report.versions.dataVersion}</dd>
                </div>
                <div class="flex flex-wrap gap-x-2">
                  <dt class="font-bold uppercase">Catalog</dt>
                  <dd class="break-all">{report.versions.catalogVersion}</dd>
                </div>
              </dl>
            </details>
          {/if}
        </section>

        <section class="rounded-xl bg-surface-1 p-4 sm:p-5">
          <h2 class="font-display text-base font-extrabold tracking-tight uppercase">
            Lineup & packages
          </h2>
          <ul class="mt-3 flex flex-col gap-2">
            {#each run.lineup as slot (slot.slot)}
              <li class="flex min-w-0 flex-wrap items-start gap-x-3 gap-y-1">
                <span
                  class="w-8 shrink-0 font-mono text-xs font-bold text-muted-foreground uppercase"
                >
                  {slot.slot}
                </span>
                <div class="min-w-0 flex-1">
                  <p class="flex flex-wrap items-center gap-2">
                    <span class="font-display text-sm font-extrabold tracking-tight uppercase">
                      {slot.nickname}
                    </span>
                    <HavocTierBadge tier={slot.tier} size="sm" />
                  </p>
                  <p class="text-xs text-muted-foreground">
                    {slot.displayName} · Overall {slot.overall}
                  </p>
                  <p class="mt-0.5 text-xs text-muted-foreground">
                    {mutationEntriesSummary(slot.mutations)}
                  </p>
                </div>
              </li>
            {/each}
          </ul>
        </section>
      </div>

      <div class="mt-4">
        {#if report !== null}
          <HavocReportView {report} />
        {:else if comparisonComplete && comparison !== null}
          <HavocComparisonView {comparison} />
        {:else}
          <section class="rounded-xl bg-surface-1 p-4 sm:p-5">
            <h2 class="font-display text-base font-extrabold tracking-tight uppercase">
              Report unavailable
            </h2>
            <p class="mt-2 text-xs text-muted-foreground">
              This run has no stored report. Its lineup and record above are the surviving record.
            </p>
          </section>
        {/if}
      </div>
    </details>
  {/if}
</section>
