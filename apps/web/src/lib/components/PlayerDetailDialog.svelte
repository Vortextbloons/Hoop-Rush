<script lang="ts">
  import type { HoopRushManifest } from '@hoop-rush/data-contracts';
  import { Dialog } from 'bits-ui';
  import DialogShell from '#lib/components/DialogShell.svelte';
  import {
    formatDecimal,
    formatPct,
    formatPerGame,
    perGame,
    shotPct,
    type RosterRow,
  } from '#lib/roster-browser.js';
  import { formatPositions } from '#lib/player-positions.js';
  import { teamNameFor } from '#lib/branding.js';
  import PlayerFace from './PlayerFace.svelte';
  let {
    player,
    manifest,
    franchiseName,
    eraLabel,
    onClose,
    detailsError = null,
    onRetry,
  }: {
    player: RosterRow | null;
    manifest: HoopRushManifest;
    franchiseName: Map<string, string>;
    eraLabel: Map<string, string>;
    onClose: () => void;
    detailsError?: string | null;
    onRetry?: () => void;
  } = $props();
  function statLine(detail: NonNullable<RosterRow['detail']>) {
    const s = detail.stats;
    return {
      mpg: perGame(s, 'minutes'),
      ppg: perGame(s, 'points'),
      rpg: perGame(s, 'rebounds'),
      apg: perGame(s, 'assists'),
      spg: s.steals === null ? null : perGame(s, 'steals'),
      bpg: s.blocks === null ? null : perGame(s, 'blocks'),
      topg: s.turnovers === null ? null : perGame(s, 'turnovers'),
      fgPct: shotPct(s.fieldGoalsMade, s.fieldGoalsAttempted),
      threePct: shotPct(s.threesMade, s.threesAttempted),
      ftPct: shotPct(s.freeThrowsMade, s.freeThrowsAttempted),
      ts: s.tsPct,
      efg: s.efgPct,
      per: s.per,
      bpm: s.boxPlusMinus,
      usage: s.usageRate,
    };
  }
  function heightLabel(row: RosterRow): string {
    if (row.detail?.heightInches === null || row.detail?.heightInches === undefined) return '—';
    const feet = Math.floor(row.detail.heightInches / 12);
    const inches = row.detail.heightInches % 12;
    return `${feet}'${inches}"`;
  }
  function weightLabel(row: RosterRow): string {
    if (row.detail?.weightLbs === null || row.detail?.weightLbs === undefined) return '—';
    return `${row.detail.weightLbs} lbs`;
  }
  const sections = $derived.by(() => {
    const subject = player;
    const detail = subject?.detail;
    if (!subject || !detail)
      return [] as {
        title: string;
        items: [string, string][];
      }[];
    const s = statLine(detail);
    return [
      {
        title: 'Per game',
        items: [
          ['Minutes', formatPerGame(s.mpg)],
          ['Points', formatPerGame(s.ppg)],
          ['Rebounds', formatPerGame(s.rpg)],
          ['Assists', formatPerGame(s.apg)],
          ['Steals', formatPerGame(s.spg)],
          ['Blocks', formatPerGame(s.bpg)],
          ['Turnovers', formatPerGame(s.topg)],
        ],
      },
      {
        title: 'Shooting',
        items: [
          ['FG%', formatPct(s.fgPct)],
          ['3P%', formatPct(s.threePct)],
          ['FT%', formatPct(s.ftPct)],
          ['eFG%', formatPct(s.efg)],
          ['TS%', formatPct(s.ts)],
        ],
      },
      {
        title: 'Advanced',
        items: [
          ['PER', formatDecimal(s.per)],
          ['BPM', formatDecimal(s.bpm)],
          ['USG%', formatDecimal(s.usage)],
        ],
      },
      {
        title: 'Info',
        items: [
          ['Games', String(detail.stats.gamesPlayed)],
          ['Minutes', String(detail.stats.minutes)],
          ['Height', heightLabel(subject)],
          ['Weight', weightLabel(subject)],
        ],
      },
    ];
  });
</script>

<DialogShell
  open={player !== null}
  onOpenChange={(open) => {
    if (!open) onClose();
  }}
  size="md"
>
  {#snippet header()}
    {#if player}
      {@const subject = player}
      <div class="flex min-w-0 items-center gap-3">
        <PlayerFace
          player={subject}
          {manifest}
          size="md"
          fallbackInitials={subject.firstName[0]! + subject.lastName[0]!}
        />
        <div class="min-w-0">
          <Dialog.Title
            class="font-display truncate text-lg font-extrabold tracking-tight uppercase"
          >
            {subject.displayName}
          </Dialog.Title>
          <p class="font-mono text-[10px] text-muted-foreground">
            {teamNameFor(manifest, franchiseName, subject.franchiseId, subject.eraId)} ·
            {eraLabel.get(subject.eraId) ?? subject.eraId} · {subject.seasonKey}
          </p>
        </div>
      </div>
    {/if}
  {/snippet}

  {#if player}
    {@const subject = player}
    <div class="mt-3 flex flex-wrap items-center gap-1.5 font-mono text-[10px]">
      <span class="rounded bg-surface-3 px-1.5 py-0.5">
        {formatPositions(subject.positionsPlayable)}
      </span>
      <span class="rounded bg-primary/10 px-1.5 py-0.5 font-bold text-primary" title="Overall">
        O {subject.overall}
      </span>
      <span class="rounded bg-surface-3 px-1.5 py-0.5" title="Offense">OF {subject.offense}</span>
      <span class="rounded bg-surface-3 px-1.5 py-0.5" title="Defense">DF {subject.defense}</span>
    </div>

    {#if !subject.detail}
      <div
        class="mt-4 flex flex-col gap-2 rounded-md border border-border bg-surface-1 px-3 py-3 sm:flex-row sm:items-center sm:justify-between"
      >
        <p class="font-mono text-xs text-muted-foreground">
          {detailsError ?? 'Loading detailed stats…'}
        </p>
        {#if detailsError && onRetry}
          <button
            type="button"
            onclick={onRetry}
            class="self-start rounded-md border border-border px-3 py-1.5 font-mono text-xs font-bold text-foreground outline-none transition-colors hover:border-line-strong focus-visible:ring-2 focus-visible:ring-ring sm:self-auto"
          >
            Retry
          </button>
        {/if}
      </div>
    {:else}
      <div class="mt-4 grid gap-4 sm:grid-cols-2">
        {#each sections as section (section.title)}
          <div>
            <h3
              class="font-mono text-[10px] font-bold tracking-[0.14em] text-muted-foreground uppercase"
            >
              {section.title}
            </h3>
            <dl class="mt-2 grid grid-cols-2 gap-1.5">
              {#each section.items as [label, value] (label)}
                <div
                  class="flex items-center justify-between gap-2 rounded-md border border-border bg-surface-1 px-2.5 py-1.5"
                >
                  <dt class="font-mono text-[10px] text-muted-foreground">{label}</dt>
                  <dd class="font-mono text-xs font-bold tabular-nums">{value}</dd>
                </div>
              {/each}
            </dl>
          </div>
        {/each}
      </div>
      <p class="mt-3 text-xs text-muted-foreground">
        — means unavailable in the historical source. Some stats were not recorded in older seasons.
      </p>
    {/if}
  {/if}
</DialogShell>
