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
  import { ClipboardList, Play, Shuffle } from '@lucide/svelte';
  import Badge from '#lib/components/ui/Badge.svelte';
  import Button from '#lib/components/ui/Button.svelte';
  import Panel from '#lib/components/ui/Panel.svelte';
  import SectionHeading from '#lib/components/ui/SectionHeading.svelte';
  import { formatMillions } from '#lib/features/cap-rush/cap-rush-presentation.js';
  import FullCourtPortrait from './FullCourtPortrait.svelte';
  import type { FullCourtArt } from './full-court-art.ts';

  const CAMP_TARGET = { kind: 'training-camp' } as const satisfies FullCourtReportTarget;
  const CAMP_PRICE = fullCourtReportPriceDollars('training-camp');

  let {
    draft,
    index,
    busy,
    campOpen,
    practiceOpen,
    practice,
    opponents = [],
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
    opponents?: readonly { readonly teamId: string; readonly displayName: string }[];
    onPurchaseReport: (target: FullCourtReportTarget) => void;
    onRunPractice: (opponentTeamId?: string) => void;
    ariaLabel?: string;
    art?: FullCourtArt | null;
  } = $props();

  let selectedOpponentId = $state('random');

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
    onRunPractice(selectedOpponentId === 'random' ? undefined : selectedOpponentId);
  }

  function runRandomPractice(): void {
    if (busy || !practiceOpen || campRecord === null) return;
    selectedOpponentId = 'random';
    onRunPractice(undefined);
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
          {formatMillions(CAMP_PRICE)}
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
          aria-label={`Book training camp for ${formatMillions(CAMP_PRICE)}`}
          onclick={buyCamp}
        >
          <ClipboardList size={14} aria-hidden="true" />
          Book training camp
        </Button>
        <p class="min-w-0 flex-1 text-[11px] text-muted-foreground">
          {#if campAssessment.legal}
            {formatMillions(campAssessment.warChestAfterPurchase)} budget after booking.
          {:else if campAssessment.minimumCompletionDollars !== null}
            Needs {formatMillions(campAssessment.minimumCompletionDollars)} for the cheapest legal finish.
          {:else}
            Budget cannot cover training camp.
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
          {#if opponents.length > 0}
            <select
              aria-label="Training camp opponent"
              bind:value={selectedOpponentId}
              class="h-9 rounded-lg border border-line-strong bg-surface-1 px-2.5 text-xs font-semibold outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <option value="random">Random opponent</option>
              {#each opponents as opponent (opponent.teamId)}
                <option value={opponent.teamId}>{opponent.displayName}</option>
              {/each}
            </select>
          {/if}
          <Button
            size="sm"
            tone="primary"
            disabled={busy}
            aria-label={practice === null ? 'Run scrimmage' : 'Run scrimmage again'}
            onclick={runPractice}
          >
            <Play size={14} aria-hidden="true" />
            {practice === null ? 'Run scrimmage' : 'Run scrimmage again'}
          </Button>
          <Button size="sm" tone="secondary" disabled={busy} onclick={runRandomPractice}>
            <Shuffle size={14} aria-hidden="true" />
            Pull random
          </Button>
          <p class="min-w-0 flex-1 text-[11px] text-muted-foreground">
            Free sandbox scrimmage against any league opponent. Tweak rotation or tactics and test
            again.
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
