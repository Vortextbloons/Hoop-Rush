<script lang="ts">
  import type { FullCourtDraftState, FullCourtReportTarget } from '@hoop-rush/data-contracts';
  import {
    fullCourtReportPriceDollars,
    fullCourtReportScope,
    fullCourtReportTargetKey,
  } from '@hoop-rush/data-contracts';
  import {
    fullCourtAssessPurchase,
    fullCourtLineupFitReport,
    fullCourtPayrollDollars,
    fullCourtWarChestDollars,
    type FullCourtCatalogIndex,
  } from '@hoop-rush/engine';
  import { FileSearch } from '@lucide/svelte';
  import Badge from '#lib/components/ui/Badge.svelte';
  import Button from '#lib/components/ui/Button.svelte';
  import Panel from '#lib/components/ui/Panel.svelte';
  import SectionHeading from '#lib/components/ui/SectionHeading.svelte';
  import { formatMillions } from '#lib/features/cap-rush/cap-rush-presentation.js';
  import type { FullCourtArt } from './full-court-art.ts';
  import FullCourtScoutEvidence from './FullCourtScoutEvidence.svelte';

  type PurchaseAssessment = ReturnType<typeof fullCourtAssessPurchase>;

  const FIT_TARGET = { kind: 'lineup-fit' } as const satisfies FullCourtReportTarget;
  const FIT_PRICE = fullCourtReportPriceDollars('lineup-fit');

  const LINEUP_FINDING_LABELS = {
    'multiple-creators': 'Multiple creators',
    'spacing-volume': 'Spacing volume',
    'playmaking-depth': 'Playmaking depth',
    'rim-protection': 'Rim protection',
    'perimeter-defense': 'Perimeter defense',
    'glass-control': 'Glass control',
    'roster-depth': 'Roster depth',
    'no-primary-creator': 'No primary creator',
    'no-spacing': 'No spacing',
    'thin-spacing': 'Thin spacing',
    'no-rim-protection': 'No rim protection',
    'no-perimeter-stopper': 'No perimeter stopper',
    'weak-defensive-glass': 'Weak defensive glass',
    'turnover-risk': 'Turnover risk',
    'thin-depth': 'Thin depth',
  } as const;

  let {
    draft,
    index,
    busy,
    onPurchaseReport,
    ariaLabel = 'Full Court War Room roster fit',
    eyebrow = 'War Room',
    art = null,
  }: {
    draft: FullCourtDraftState;
    index: FullCourtCatalogIndex;
    busy: boolean;
    onPurchaseReport: (target: FullCourtReportTarget) => void;
    ariaLabel?: string;
    eyebrow?: string;
    art?: FullCourtArt | null;
  } = $props();

  const reportsByTarget = $derived(
    new Map(
      (draft.reports ?? []).map((report) => [fullCourtReportTargetKey(report.target), report]),
    ),
  );
  const fitRecord = $derived(reportsByTarget.get(fullCourtReportTargetKey(FIT_TARGET)) ?? null);
  const roster = $derived(draft.picks.map((pick) => pick.player));
  const fitReport = $derived(fitRecord === null ? null : fullCourtLineupFitReport(roster));
  const payrollDollars = $derived(fullCourtPayrollDollars(draft.picks));
  const warChestCr = $derived(formatMillions(fullCourtWarChestDollars(draft)));
  const locked = $derived(draft.stage === 'complete');
  const fitAssessment = $derived(
    fullCourtAssessPurchase({ index, state: draft, priceDollars: FIT_PRICE }),
  );
  const scopeLabel = $derived(
    fullCourtReportScope('lineup-fit') === 'run' ? 'Lifetime of this run' : 'This game only',
  );

  const rosterById = $derived(
    new Map<string, (typeof roster)[number]>(
      roster.map((player) => [player.playerId as string, player]),
    ),
  );
  const rosterByName = $derived(
    new Map<string, (typeof roster)[number]>(roster.map((player) => [player.displayName, player])),
  );

  function playerForEvidence(entry: { playerId?: string; displayName: string }) {
    const matched =
      (entry.playerId === undefined ? undefined : rosterById.get(entry.playerId)) ??
      rosterByName.get(entry.displayName);
    return (
      matched ?? {
        ...(entry.playerId === undefined ? {} : { playerId: entry.playerId }),
        displayName: entry.displayName,
      }
    );
  }

  function purchaseAffordance(assessment: PurchaseAssessment): string {
    if (assessment.legal) {
      return `${formatMillions(assessment.warChestAfterPurchase)} budget after the purchase.`;
    }
    if (assessment.reason === 'completion') {
      return 'No legal roster finish remains after this purchase.';
    }
    if (assessment.minimumCompletionDollars !== null) {
      return `Needs ${formatMillions(assessment.minimumCompletionDollars)} for the cheapest legal finish.`;
    }
    return 'Budget cannot cover this report.';
  }

  function buyFit(): void {
    if (busy || !locked || fitRecord !== null || !fitAssessment.legal) return;
    onPurchaseReport(FIT_TARGET);
  }
</script>

<Panel as="section" padding="md" class="border-line-strong bg-surface-1/90" aria-label={ariaLabel}>
  <SectionHeading
    {eyebrow}
    title="Locked roster fit"
    level={2}
    size="md"
    description="Team strengths, spacing, and defensive gaps."
  >
    {#snippet actions()}
      {#if fitRecord !== null}
        <Badge tone="positive">Owned</Badge>
      {:else}
        <span class="font-mono text-[10px] font-bold text-muted-foreground tabular-nums">
          {formatMillions(FIT_PRICE)}
        </span>
      {/if}
    {/snippet}
  </SectionHeading>

  <div class="mt-2 flex flex-wrap items-baseline gap-x-3 gap-y-1">
    <p class="font-mono text-[10px] text-muted-foreground uppercase">
      {roster.length} players · {formatMillions(payrollDollars)} payroll
    </p>
    <p class="font-mono text-[10px] text-muted-foreground uppercase">{warChestCr} War Chest</p>
    <p class="font-mono text-[9px] text-muted-foreground uppercase">{scopeLabel}</p>
  </div>

  {#if fitReport !== null}
    <div class="mt-4 grid items-start gap-3 sm:grid-cols-2">
      <section
        class="rounded-xl border border-positive/30 bg-positive/5 p-3.5"
        aria-label="Roster strengths"
      >
        <div class="flex items-center justify-between gap-2">
          <p class="ui-label text-positive">Strengths</p>
          <span class="font-mono text-[9px] font-bold text-positive/80 uppercase">
            {fitReport.strengths.length}
            {fitReport.strengths.length === 1 ? 'trait' : 'traits'}
          </span>
        </div>
        {#if fitReport.strengths.length === 0}
          <p class="mt-2 text-xs text-muted-foreground">
            No strength cleared the evidence thresholds.
          </p>
        {:else}
          <ul class="mt-2.5 flex flex-col gap-2.5">
            {#each fitReport.strengths as finding (finding.code)}
              <li class="rounded-lg border border-line-soft/70 bg-surface-1/80 p-2.5">
                <p class="text-xs font-bold text-foreground">
                  {LINEUP_FINDING_LABELS[finding.code]}
                </p>
                {#if finding.evidence.length > 0}
                  <div class="mt-1.5">
                    <FullCourtScoutEvidence
                      {art}
                      items={finding.evidence.map((entry) => ({
                        name: entry.displayName,
                        field: entry.field,
                        value: entry.value,
                        player: playerForEvidence(entry),
                      }))}
                    />
                  </div>
                {/if}
              </li>
            {/each}
          </ul>
        {/if}
      </section>

      <section
        class="rounded-xl border border-negative/30 bg-negative/5 p-3.5"
        aria-label="Roster gaps"
      >
        <div class="flex items-center justify-between gap-2">
          <p class="ui-label text-negative">Gaps</p>
          <span class="font-mono text-[9px] font-bold text-negative/80 uppercase">
            {fitReport.gaps.length}
            {fitReport.gaps.length === 1 ? 'gap' : 'gaps'}
          </span>
        </div>
        {#if fitReport.gaps.length === 0}
          <p class="mt-2 text-xs text-muted-foreground">No gap cleared the evidence thresholds.</p>
        {:else}
          <ul class="mt-2.5 flex flex-col gap-2.5">
            {#each fitReport.gaps as finding (finding.code)}
              <li class="rounded-lg border border-line-soft/70 bg-surface-1/80 p-2.5">
                <p class="text-xs font-bold text-foreground">
                  {LINEUP_FINDING_LABELS[finding.code]}
                </p>
                {#if finding.evidence.length > 0}
                  <div class="mt-1.5">
                    <FullCourtScoutEvidence
                      {art}
                      items={finding.evidence.map((entry) => ({
                        name: entry.displayName,
                        field: entry.field,
                        value: entry.value,
                        player: playerForEvidence(entry),
                      }))}
                    />
                  </div>
                {/if}
              </li>
            {/each}
          </ul>
        {/if}
      </section>
    </div>
  {:else if fitRecord !== null}
    <p class="mt-3 text-xs text-muted-foreground">
      The roster fit report is unavailable for this roster.
    </p>
  {:else}
    <div class="mt-3 flex flex-wrap items-center gap-2 border-t border-line-soft pt-3">
      <Button
        size="sm"
        tone="primary"
        disabled={busy || !locked || !fitAssessment.legal}
        aria-label={`Buy roster fit for ${formatMillions(FIT_PRICE)}`}
        onclick={buyFit}
      >
        <FileSearch size={14} aria-hidden="true" />
        Buy roster fit
      </Button>
      <p class="min-w-0 flex-1 text-[11px] text-muted-foreground">
        {purchaseAffordance(fitAssessment)}
      </p>
    </div>
  {/if}
</Panel>
