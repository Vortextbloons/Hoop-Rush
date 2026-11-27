<script lang="ts">
  import type {
    FullCourtDraftState,
    FullCourtPracticeReport,
    FullCourtReportTarget,
  } from '@hoop-rush/data-contracts';
  import {
    fullCourtReportPriceDollars,
    fullCourtReportScope,
    fullCourtReportTargetKey,
  } from '@hoop-rush/data-contracts';
  import { fullCourtAssessPurchase, type FullCourtCatalogIndex } from '@hoop-rush/engine';
  import { ClipboardList, Play } from '@lucide/svelte';
  import Badge from '#lib/components/ui/Badge.svelte';
  import Button from '#lib/components/ui/Button.svelte';
  import Panel from '#lib/components/ui/Panel.svelte';
  import SectionHeading from '#lib/components/ui/SectionHeading.svelte';
  import FullCourtPortrait from './FullCourtPortrait.svelte';
  import type { FullCourtArt } from './full-court-art.ts';
  import { formatWarChestCr } from './full-court-draft-presentation.js';

  const CAMP_TARGET = { kind: 'training-camp' } as const satisfies FullCourtReportTarget;
  const CAMP_PRICE = fullCourtReportPriceDollars('training-camp');

  let {
    draft,
    index,
    busy,
    campOpen,
    practiceOpen,
    practice,
    onPurchaseReport,
    onRunPractice,
    ariaLabel = 'Full Court War Room training camp',
    art = null,
  }: {
    draft: FullCourtDraftState;
    index: FullCourtCatalogIndex;
    busy: boolean;
    campOpen: boolean;
    practiceOpen: boolean;
    practice: FullCourtPracticeReport | null;
    onPurchaseReport: (target: FullCourtReportTarget) => void;
    onRunPractice: () => void;
    ariaLabel?: string;
    art?: FullCourtArt | null;
  } = $props();

  const campRecord = $derived(
    (draft.reports ?? []).find(
      (report) => fullCourtReportTargetKey(report.target) === fullCourtReportTargetKey(CAMP_TARGET),
    ) ?? null,
  );
  const locked = $derived(draft.stage === 'complete');
  const campAssessment = $derived(
    fullCourtAssessPurchase({ index, state: draft, priceDollars: CAMP_PRICE }),
  );
  const scopeLabel = $derived(
    fullCourtReportScope('training-camp') === 'run' ? 'Before game 1' : 'This game only',
  );

  function minutesText(value: number): string {
    return Number.isInteger(value) ? String(value) : value.toFixed(1);
  }

  function percentText(value: number): string {
    const percent = value * 100;
    return `${Number.isInteger(percent) ? String(percent) : percent.toFixed(1)}%`;
  }

  function buyCamp(): void {
    if (busy || !locked || !campOpen || campRecord !== null || !campAssessment.legal) return;
    onPurchaseReport(CAMP_TARGET);
  }

  function runPractice(): void {
    if (busy || !practiceOpen || campRecord === null) return;
    onRunPractice();
  }
</script>

<Panel as="section" padding="md" aria-label={ariaLabel}>
  <SectionHeading
    eyebrow="Preseason"
    title="Training Camp"
    level={2}
    size="md"
    description="A paid practice report. It estimates rotations, fatigue, and bench usage from one scrimmage and never changes ratings."
  >
    {#snippet actions()}
      {#if campRecord !== null}
        <Badge tone="positive">Booked</Badge>
      {:else}
        <span class="font-mono text-[10px] font-bold text-muted-foreground tabular-nums">
          {formatWarChestCr(CAMP_PRICE)}
        </span>
      {/if}
    {/snippet}
  </SectionHeading>

  <div class="mt-2 flex flex-wrap items-baseline gap-x-3 gap-y-1">
    <p class="font-mono text-[10px] text-muted-foreground uppercase">
      {scopeLabel} · separate practice seed
    </p>
    <p class="font-mono text-[9px] text-muted-foreground uppercase">
      No fixture, health, record, achievement, or Gamecast entry
    </p>
  </div>

  {#if !locked}
    <p class="mt-3 text-xs leading-relaxed text-muted-foreground">
      Confirm the roster before booking training camp.
    </p>
  {:else if campRecord === null}
    {#if campOpen}
      <div class="mt-3 flex flex-wrap items-center gap-2 border-t border-line-soft pt-3">
        <Button
          size="sm"
          tone="primary"
          disabled={busy || !campAssessment.legal}
          aria-label={`Book training camp for ${formatWarChestCr(CAMP_PRICE)}`}
          onclick={buyCamp}
        >
          <ClipboardList size={14} aria-hidden="true" />
          Book training camp
        </Button>
        <p class="min-w-0 flex-1 text-[11px] text-muted-foreground">
          {#if campAssessment.legal}
            {formatWarChestCr(campAssessment.warChestAfterPurchase)} War Chest after booking.
          {:else if campAssessment.minimumCompletionDollars !== null}
            Needs {formatWarChestCr(campAssessment.minimumCompletionDollars)} for the cheapest legal finish.
          {:else}
            The War Chest cannot cover training camp.
          {/if}
        </p>
      </div>
    {:else}
      <p class="mt-3 text-xs leading-relaxed text-muted-foreground">
        Training camp closed before game 1. The practice report is no longer available.
      </p>
    {/if}
  {:else}
    <div class="mt-3 border-t border-line-soft pt-3">
      {#if practiceOpen}
        <div class="flex flex-wrap items-center gap-2">
          <Button
            size="sm"
            tone="secondary"
            disabled={busy}
            aria-label={practice === null ? 'Open training camp practice' : 'Run practice again'}
            onclick={runPractice}
          >
            <Play size={14} aria-hidden="true" />
            {practice === null ? 'Open practice' : 'Run practice again'}
          </Button>
          <p class="min-w-0 flex-1 text-[11px] text-muted-foreground">
            Free to open and rerun. Coaching edits stay free; the same seed keeps comparisons fair.
          </p>
        </div>
      {:else if campOpen}
        <p class="text-xs leading-relaxed text-muted-foreground">
          Camp is booked. Practice opens after the roster is finalized and before game 1.
        </p>
      {:else}
        <p class="text-xs leading-relaxed text-muted-foreground">
          Practice is closed once the regular season starts. The camp sample never enters the season
          record.
        </p>
      {/if}

      {#if practice !== null}
        <section
          class="mt-3 rounded-xl border border-line-soft bg-surface-1 p-3"
          aria-label="Practice summary"
        >
          <div class="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
            <p class="ui-label text-muted-foreground">Scrimmage · not official</p>
            <p class="font-mono text-[10px] font-bold tabular-nums">
              {practice.score.user}–{practice.score.opponent} vs {practice.opponentTeamName}
            </p>
          </div>
          <p class="mt-1 font-mono text-[9px] text-muted-foreground uppercase">
            {minutesText(practice.totalSeconds / 60)} minutes
            {#if practice.overtimePeriods > 0}
              · {practice.overtimePeriods} OT
            {/if}
            · one-sample estimate
          </p>

          <ul class="mt-2 flex flex-col gap-1">
            {#each practice.rotation as player (player.playerId)}
              <li class="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px]">
                <FullCourtPortrait {player} {art} size="sm" />
                <span class="min-w-0 flex-1 truncate font-semibold">{player.displayName}</span>
                <span class="shrink-0 font-mono text-[8px] font-bold text-primary uppercase">
                  {player.kind === 'clone' ? 'Clone' : player.starter ? 'Starter' : 'Bench'}
                </span>
                <span class="shrink-0 font-mono text-[9px] text-muted-foreground tabular-nums">
                  {minutesText(player.minutes)} min · target {minutesText(player.plannedMinutes)}
                </span>
                <span class="shrink-0 font-mono text-[9px] font-bold tabular-nums">
                  {percentText(player.energyRemaining)} energy
                </span>
                <span class="shrink-0 font-mono text-[9px] text-muted-foreground tabular-nums">
                  {player.points} pts · {player.stints} stints
                </span>
              </li>
            {/each}
          </ul>

          <div class="mt-2 grid gap-2 border-t border-line-soft pt-2 sm:grid-cols-2">
            <p class="font-mono text-[10px] text-muted-foreground">
              Bench: {practice.bench.playersUsed} used ·
              {minutesText(practice.bench.minutes)} min · {practice.bench.points} pts
            </p>
            <p class="font-mono text-[10px] text-muted-foreground">
              Fatigue: {practice.fatigue.tiredPlayers} tired · lowest
              {percentText(practice.fatigue.lowestEnergy)} energy
            </p>
          </div>
        </section>
      {/if}
    </div>
  {/if}
</Panel>
