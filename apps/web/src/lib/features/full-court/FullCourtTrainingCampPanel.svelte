<script lang="ts">
  import type { FullCourtDraftState, FullCourtPracticeReport } from '@hoop-rush/data-contracts';
  import { fullCourtReportTargetKey } from '@hoop-rush/data-contracts';
  import { Play, Shuffle } from '@lucide/svelte';
  import Badge from '#lib/components/ui/Badge.svelte';
  import Button from '#lib/components/ui/Button.svelte';
  import Panel from '#lib/components/ui/Panel.svelte';
  import SectionHeading from '#lib/components/ui/SectionHeading.svelte';
  import FullCourtPortrait from './FullCourtPortrait.svelte';
  import type { FullCourtArt } from './full-court-art.ts';

  const CAMP_TARGET = { kind: 'training-camp' } as const;

  let {
    draft,
    busy,
    practiceOpen,
    practice,
    opponents = [],
    onRunPractice,
    ariaLabel = 'Full Court War Room training camp',
    art = null,
  }: {
    draft: FullCourtDraftState;
    busy: boolean;
    practiceOpen: boolean;
    practice: FullCourtPracticeReport | null;
    opponents?: readonly { readonly teamId: string; readonly displayName: string }[];
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

  function minutesText(value: number): string {
    return Number.isInteger(value) ? String(value) : value.toFixed(1);
  }

  function percentText(value: number): string {
    const percent = value * 100;
    return `${Number.isInteger(percent) ? String(percent) : percent.toFixed(1)}%`;
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
  <SectionHeading eyebrow="Preseason" title="Training Camp" level={2} size="md">
    {#snippet actions()}
      {#if campRecord !== null}
        <Badge tone="positive">Booked</Badge>
      {:else}
        <Badge tone="neutral">Not purchased</Badge>
      {/if}
    {/snippet}
  </SectionHeading>

  <p class="mt-2 font-mono text-[10px] text-muted-foreground uppercase">
    Before game 1 · sandbox scrimmage
  </p>

  {#if campRecord === null}
    <p class="mt-3 text-xs text-muted-foreground">Not purchased at run setup.</p>
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
        </div>
      {:else}
        <p class="text-xs text-muted-foreground">Closed before game 1.</p>
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
