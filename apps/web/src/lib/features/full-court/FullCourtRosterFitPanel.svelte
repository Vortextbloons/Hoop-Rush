<script lang="ts">
  import type { FullCourtDraftState } from '@hoop-rush/data-contracts';
  import { fullCourtReportTargetKey } from '@hoop-rush/data-contracts';
  import { fullCourtLineupFitReport, type FullCourtLineupFinding } from '@hoop-rush/engine';
  import Badge from '#lib/components/ui/Badge.svelte';
  import Panel from '#lib/components/ui/Panel.svelte';
  import SectionHeading from '#lib/components/ui/SectionHeading.svelte';
  import type { FullCourtArt } from './full-court-art.ts';
  import {
    LINEUP_FINDING_LABELS,
    scoutFieldLabel,
    scoutFieldValue,
  } from './full-court-scout-labels';

  const FIT_TARGET = { kind: 'lineup-fit' } as const;

  /** Only the roster-wide findings whose title alone leaves the threshold unclear. */
  const LINEUP_FINDING_READS: Partial<Record<keyof typeof LINEUP_FINDING_LABELS, string>> = {
    'roster-depth': 'Nine or more players signed.',
    'no-primary-creator': 'Nobody draws a real usage load.',
    'no-spacing': 'Nobody shoots enough threes to pull a defender.',
    'weak-defensive-glass': 'Nobody rebounds on the defensive end.',
    'thin-depth': 'Fewer than eight players signed.',
  };

  let {
    draft,
    ariaLabel = 'Full Court War Room roster fit',
    eyebrow = 'War Room',
    art = null,
  }: {
    draft: FullCourtDraftState;
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
  const groups = $derived.by(() => {
    if (fitReport === null) return [];
    return [
      {
        label: 'Strengths',
        tone: 'positive' as const,
        empty: 'No strength cleared the evidence thresholds.',
        findings: fitReport.strengths,
      },
      {
        label: 'Gaps',
        tone: 'negative' as const,
        empty: 'No gap cleared the evidence thresholds.',
        findings: fitReport.gaps,
      },
    ];
  });

  /** Second line of a card: what the number measures, then how deep that trait runs. */
  function supportLine(finding: FullCourtLineupFinding): string {
    const lead = finding.evidence[0];
    if (lead === undefined) return LINEUP_FINDING_READS[finding.code] ?? 'No player behind it.';
    const field = scoutFieldLabel(lead.field);
    const others = finding.evidence.length - 1;
    if (others === 0) return `${field} · only qualifier`;
    const backup = finding.evidence[1];
    return `${field} · ${others} more${backup === undefined ? '' : `, led by ${backup.displayName}`}`;
  }
</script>

{#snippet findingCard(finding: FullCourtLineupFinding, tone: 'positive' | 'negative')}
  {@const lead = finding.evidence[0]}
  <li
    class="flex min-w-0 flex-col gap-0.5 rounded-lg border border-line-soft/70 border-l-2 bg-surface-1/80 py-1.5 pr-2.5 pl-2 {tone ===
    'positive'
      ? 'border-l-positive/70'
      : 'border-l-negative/70'}"
  >
    <p class="font-display text-[10px] leading-tight font-extrabold tracking-[0.06em] uppercase">
      {LINEUP_FINDING_LABELS[finding.code]}
    </p>
    {#if lead !== undefined}
      <div class="flex items-baseline justify-between gap-1.5">
        <p class="min-w-0 flex-1 text-xs leading-tight font-semibold break-words text-foreground">
          {lead.displayName}
        </p>
        <p class="shrink-0 font-mono text-sm leading-none font-bold tabular-nums text-foreground">
          {scoutFieldValue(lead.field, lead.value)}
        </p>
      </div>
    {/if}
    <p class="line-clamp-2 text-[10px] leading-snug text-muted-foreground">
      {supportLine(finding)}
    </p>
  </li>
{/snippet}

<Panel as="section" padding="md" class="border-line-strong bg-surface-1/90" aria-label={ariaLabel}>
  <SectionHeading {eyebrow} title="Locked roster fit" level={2} size="md">
    {#snippet actions()}
      {#if fitRecord !== null}
        <Badge tone="positive">Owned</Badge>
      {:else}
        <Badge tone="neutral">Not purchased</Badge>
      {/if}
    {/snippet}
  </SectionHeading>

  {#if fitReport !== null}
    <div class="mt-2 flex flex-wrap items-baseline gap-x-3 gap-y-1">
      <span class="ml-auto flex items-baseline gap-2">
        <span class="ui-micro tabular-nums text-positive">
          {fitReport.strengths.length}
          {fitReport.strengths.length === 1 ? 'strength' : 'strengths'}
        </span>
        <span class="ui-micro tabular-nums text-negative">
          {fitReport.gaps.length}
          {fitReport.gaps.length === 1 ? 'gap' : 'gaps'}
        </span>
      </span>
    </div>
  {/if}

  {#if fitReport !== null}
    <div class="mt-3 flex flex-col gap-3">
      {#each groups as group (group.label)}
        <section aria-label={`Roster ${group.label.toLowerCase()}`} class="min-w-0">
          <div class="flex items-center gap-2">
            <p class="ui-label {group.tone === 'positive' ? 'text-positive' : 'text-negative'}">
              {group.label}
            </p>
            <span
              class="h-px min-w-4 flex-1 {group.tone === 'positive'
                ? 'bg-positive/25'
                : 'bg-negative/25'}"
              aria-hidden="true"
            ></span>
          </div>

          {#if group.findings.length === 0}
            <p class="mt-1.5 text-xs leading-snug text-muted-foreground">{group.empty}</p>
          {:else}
            <ul class="mt-1.5 grid grid-cols-[repeat(auto-fit,minmax(10rem,1fr))] gap-1.5">
              {#each group.findings as finding (finding.code)}
                {@render findingCard(finding, group.tone)}
              {/each}
            </ul>
          {/if}
        </section>
      {/each}
    </div>
  {:else if fitRecord !== null}
    <p class="mt-3 text-xs text-muted-foreground">
      The roster fit report is unavailable for this roster.
    </p>
  {:else}
    <p class="mt-3 text-xs text-muted-foreground">Not purchased at run setup.</p>
  {/if}
</Panel>
