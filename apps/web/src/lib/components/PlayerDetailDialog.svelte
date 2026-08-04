<script lang="ts">
  import type { HoopRushManifest } from '@hoop-rush/data-contracts';
  import { resolveEraTeamIdentity } from '@hoop-rush/data-contracts';
  import { Dialog } from 'bits-ui';
  import { X } from '@lucide/svelte';
  import {
    formatDecimal,
    formatPct,
    formatPerGame,
    perGame,
    shotPct,
    type RosterDetailRow,
  } from '$lib/roster-browser';
  import PlayerFace from './PlayerFace.svelte';

  /**
   * Player detail dialog for the Roster browser: identity, ratings, per-game
   * and shooting lines, advanced numbers, and physical context for one
   * roster row. The page owns which row is open and closes through `onClose`.
   */

  let {
    player,
    manifest,
    franchiseName,
    eraLabel,
    onClose,
  }: {
    player: RosterDetailRow | null;
    manifest: HoopRushManifest;
    franchiseName: Map<string, string>;
    eraLabel: Map<string, string>;
    onClose: () => void;
  } = $props();

  /** Historical display name for the row's franchise/era context. */
  function teamNameFor(row: RosterDetailRow): string {
    const identity = resolveEraTeamIdentity(manifest, row.franchiseId, row.eraId);
    return identity.displayLabel ?? franchiseName.get(row.franchiseId) ?? row.franchiseId;
  }

  function statLine(row: RosterDetailRow) {
    const s = row.stats;
    return {
      mpg: perGame(s, 'minutes'),
      ppg: perGame(s, 'points'),
      rpg: perGame(s, 'rebounds'),
      apg: perGame(s, 'assists'),
      spg: perGame(s, 'steals'),
      bpg: perGame(s, 'blocks'),
      topg: perGame(s, 'turnovers'),
      fgPct: shotPct(s.fieldGoalsMade, s.fieldGoalsAttempted),
      threePct: shotPct(s.threesMade, s.threesAttempted),
      ftPct: shotPct(s.freeThrowsMade, s.freeThrowsAttempted),
      ts: s.tsPct ?? 0,
      efg: s.efgPct ?? 0,
      per: s.per ?? 0,
      bpm: s.boxPlusMinus ?? 0,
      usage: s.usageRate ?? 0,
    };
  }

  function heightLabel(row: RosterDetailRow): string {
    if (row.heightInches === null || row.heightInches === undefined) return '—';
    const feet = Math.floor(row.heightInches / 12);
    const inches = row.heightInches % 12;
    return `${feet}'${inches}"`;
  }

  function weightLabel(row: RosterDetailRow): string {
    if (row.weightLbs === null || row.weightLbs === undefined) return '—';
    return `${row.weightLbs} lbs`;
  }

  const sections = $derived.by(() => {
    const subject = player;
    if (!subject) return [] as { title: string; items: [string, string][] }[];
    const s = statLine(subject);
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
          ['Field goal', formatPct(s.fgPct)],
          ['Three point', formatPct(s.threePct)],
          ['Free throw', formatPct(s.ftPct)],
          ['Effective FG', formatPct(s.efg)],
          ['True shooting', formatPct(s.ts)],
        ],
      },
      {
        title: 'Advanced',
        items: [
          ['PER', formatDecimal(s.per)],
          ['Box plus/minus', formatDecimal(s.bpm)],
          ['Usage rate', formatDecimal(s.usage)],
        ],
      },
      {
        title: 'Context',
        items: [
          ['Games', String(subject.stats.gamesPlayed)],
          ['Minutes', String(subject.stats.minutes)],
          ['Height', heightLabel(subject)],
          ['Weight', weightLabel(subject)],
        ],
      },
    ];
  });
</script>

<Dialog.Root
  open={player !== null}
  onOpenChange={(open) => {
    if (!open) onClose();
  }}
>
  <Dialog.Portal>
    <Dialog.Overlay class="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm" />
    <Dialog.Content
      class="fixed inset-x-0 bottom-0 z-50 mx-auto max-h-[85dvh] w-full overflow-y-auto rounded-t-2xl border-t border-border bg-card p-4 pb-[max(1.25rem,env(safe-area-inset-bottom))] shadow-2xl shadow-black/40 outline-none sm:bottom-auto sm:left-1/2 sm:top-1/2 sm:max-w-lg sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-2xl sm:border sm:pb-4"
    >
      {#if player}
        {@const subject = player}
        {@const line = statLine(subject)}
        <div class="flex items-start justify-between gap-3">
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
                {teamNameFor(subject)} ·
                {eraLabel.get(subject.eraId) ?? subject.eraId} · {subject.seasonKey}
              </p>
            </div>
          </div>
          <Dialog.Close
            aria-label="Close"
            class="grid h-9 w-9 shrink-0 place-items-center rounded-full border border-border text-muted-foreground transition-colors hover:text-foreground"
          >
            <X class="h-4 w-4" />
          </Dialog.Close>
        </div>

        <div class="mt-3 flex flex-wrap items-center gap-1.5 font-mono text-[10px]">
          <span class="rounded bg-surface-3 px-1.5 py-0.5">
            {subject.positionsPlayable.join('/')}
          </span>
          <span class="rounded bg-primary/10 px-1.5 py-0.5 font-bold text-primary" title="Overall">
            O {subject.overall}
          </span>
          <span class="rounded bg-surface-3 px-1.5 py-0.5" title="Offense"
            >OF {subject.offense}</span
          >
          <span class="rounded bg-surface-3 px-1.5 py-0.5" title="Defense"
            >DF {subject.defense}</span
          >
        </div>

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

        <p class="mt-4 font-mono text-[10px] text-muted-foreground">
          Peak season by selection score · {line.usage.toFixed(1)}% usage ·
          {formatPerGame(line.mpg)} minutes per game
        </p>
      {/if}
    </Dialog.Content>
  </Dialog.Portal>
</Dialog.Root>
