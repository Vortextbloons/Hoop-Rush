<script lang="ts">
  import type { HoopRushManifest, PlayoffPerformance } from '@hoop-rush/data-contracts';
  import { resolveEraTeamIdentity } from '@hoop-rush/data-contracts';
  import { Dialog } from 'bits-ui';
  import { ExternalLink, X } from '@lucide/svelte';
  import DialogShell from '#lib/components/DialogShell.svelte';
  import TeamLogo from '#lib/components/TeamLogo.svelte';
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
  import PlayoffEffectDetails from './PlayoffEffectDetails.svelte';
  import { capRushPlayoffEffectOf } from '@hoop-rush/engine';

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

  function rosterPlayoffSampleLabel(performance: PlayoffPerformance): string {
    const games = performance.playoffs.gamesPlayed;
    const minutes = Math.round(performance.playoffs.minutes);
    return `${String(games)} GP · ${String(minutes)} min`;
  }

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

  function teamSlotFor(row: RosterRow): string | null {
    return (
      manifest.modernFranchiseSlots.find((entry) => entry.franchiseId === row.franchiseId)
        ?.teamExternalId ?? null
    );
  }

  function eraIdentityFor(row: RosterRow) {
    return resolveEraTeamIdentity(manifest, row.franchiseId, row.eraId);
  }

  const sections = $derived.by(() => {
    const subject = player;
    const detail = subject?.detail;
    if (!subject || !detail)
      return [] as {
        title: string;
        items: { label: string; value: string; href?: string }[];
      }[];
    const s = statLine(detail);
    const sources = detail.statSources;
    return [
      {
        title: 'Per game',
        items: [
          { label: 'Minutes', value: formatPerGame(s.mpg) },
          { label: 'Points', value: formatPerGame(s.ppg) },
          { label: 'Rebounds', value: formatPerGame(s.rpg) },
          { label: 'Assists', value: formatPerGame(s.apg) },
          { label: 'Steals', value: formatPerGame(s.spg) },
          { label: 'Blocks', value: formatPerGame(s.bpg) },
          { label: 'Turnovers', value: formatPerGame(s.topg) },
        ],
      },
      {
        title: 'Shooting',
        items: [
          { label: 'FG%', value: formatPct(s.fgPct) },
          { label: '3P%', value: formatPct(s.threePct) },
          { label: 'FT%', value: formatPct(s.ftPct) },
          { label: 'eFG%', value: formatPct(s.efg) },
          { label: 'TS%', value: formatPct(s.ts) },
        ],
      },
      {
        title: 'Advanced',
        items: [
          { label: 'PER', value: formatDecimal(s.per), href: sources?.per },
          { label: 'BPM', value: formatDecimal(s.bpm), href: sources?.boxPlusMinus },
          { label: 'USG%', value: formatDecimal(s.usage), href: sources?.usageRate },
        ],
      },
      {
        title: 'Info',
        items: [
          { label: 'Games', value: String(detail.stats.gamesPlayed) },
          { label: 'Minutes', value: String(detail.stats.minutes) },
          { label: 'Height', value: heightLabel(subject) },
          { label: 'Weight', value: weightLabel(subject) },
        ],
      },
    ];
  });

  const spotlight = $derived.by(() => {
    const subject = player;
    const detail = subject?.detail;
    if (!subject || !detail) return null;
    const s = statLine(detail);
    return [
      { label: 'PTS', value: formatPerGame(s.ppg) },
      { label: 'REB', value: formatPerGame(s.rpg) },
      { label: 'AST', value: formatPerGame(s.apg) },
      { label: 'PER', value: formatDecimal(s.per) },
    ];
  });

  const playoffSection = $derived.by(() => {
    const performance = player?.detail?.playoffPerformance;
    if (performance === undefined) return null;
    return {
      sample: rosterPlayoffSampleLabel(performance),
      season: performance.season,
      adjustment: performance.adjustment,
      applied: capRushPlayoffEffectOf({
        profile: performance,
        authoritativeChannels: [],
        observedFieldGoalAttemptsPerGame:
          performance.regularSeason.gamesPlayed > 0
            ? performance.regularSeason.fga / performance.regularSeason.gamesPlayed
            : null,
      }),
    };
  });
</script>

<DialogShell
  open={player !== null}
  onOpenChange={(open) => {
    if (!open) onClose();
  }}
  size="lg"
  grabHandle
  showClose={false}
  contentClass="overflow-hidden p-0"
  headerClass="h-0 min-h-0 overflow-hidden p-0"
>
  {#snippet header()}
    {#if player}
      <Dialog.Title class="sr-only">{player.displayName}</Dialog.Title>
    {/if}
  {/snippet}

  {#if player}
    {@const subject = player}
    {@const identity = eraIdentityFor(subject)}
    {@const teamExternalId = teamSlotFor(subject)}
    <div class="relative border-b border-border bg-surface-1">
      <Dialog.Close
        aria-label="Close"
        class="ui-icon-btn absolute right-3 top-3 z-20 bg-card/90 shadow-md backdrop-blur-sm"
      >
        <X class="h-4 w-4" />
      </Dialog.Close>
      <div
        class="pointer-events-none absolute inset-0 bg-gradient-to-br from-primary/12 via-transparent to-transparent"
        aria-hidden="true"
      ></div>
      <div class="relative flex gap-3 px-4 pb-4 pt-10 sm:gap-4 sm:px-6 sm:pb-5 sm:pt-4 sm:pr-14">
        <div class="relative shrink-0">
          <div
            class="overflow-hidden rounded-xl border border-line-soft bg-card shadow-lg shadow-black/20"
          >
            <PlayerFace
              player={subject}
              {manifest}
              size="xl"
              fallbackInitials={subject.firstName[0]! + subject.lastName[0]!}
            />
          </div>
          {#if teamExternalId}
            <span
              class="absolute -bottom-1.5 -right-1.5 rounded-lg border border-border bg-card p-1 shadow-md"
            >
              <TeamLogo
                {manifest}
                franchiseId={subject.franchiseId}
                {teamExternalId}
                logoCandidates={identity.logoCandidates ?? []}
                className="h-6 w-6"
              />
            </span>
          {/if}
        </div>
        <div class="min-w-0 flex-1 pt-1">
          <p
            class="font-display text-xl font-extrabold leading-tight tracking-tight uppercase sm:text-2xl"
          >
            {subject.displayName}
          </p>
          <p class="mt-1 font-mono text-[11px] leading-snug text-muted-foreground">
            {teamNameFor(manifest, franchiseName, subject.franchiseId, subject.eraId)} ·
            {eraLabel.get(subject.eraId) ?? subject.eraId} · {subject.seasonKey}
          </p>
          <div class="mt-3 flex flex-wrap items-center gap-1.5">
            <span
              class="rounded-md bg-surface-3 px-2 py-0.5 font-mono text-[10px] font-semibold text-muted-foreground"
            >
              {formatPositions(subject.positionsPlayable)}
            </span>
            <span
              class="rounded-md bg-primary px-2 py-0.5 font-mono text-[10px] font-bold text-primary-foreground"
              title="Overall"
            >
              O {subject.overall}
            </span>
            <span
              class="rounded-md border border-line-soft bg-card/80 px-2 py-0.5 font-mono text-[10px] font-bold text-foreground"
              title="Offense"
            >
              OF {subject.offense}
            </span>
            <span
              class="rounded-md border border-line-soft bg-card/80 px-2 py-0.5 font-mono text-[10px] font-bold text-foreground"
              title="Defense"
            >
              DF {subject.defense}
            </span>
          </div>
        </div>
      </div>
      {#if spotlight}
        <dl
          class="relative grid grid-cols-2 border-t border-border/50 sm:grid-cols-4"
          aria-label="Season highlights"
        >
          {#each spotlight as item (item.label)}
            <div class="bg-surface-1 px-2 py-2.5 text-center sm:px-3">
              <dt
                class="font-mono text-[9px] font-bold tracking-[0.12em] text-muted-foreground uppercase"
              >
                {item.label}
              </dt>
              <dd
                class="font-display mt-0.5 text-lg font-extrabold tabular-nums text-foreground sm:text-xl"
              >
                {item.value}
              </dd>
            </div>
          {/each}
        </dl>
      {/if}
    </div>

    <div
      class="max-h-[min(50dvh,28rem)] overflow-y-auto overscroll-contain px-4 py-4 sm:max-h-[min(52vh,28rem)] sm:px-6"
    >
      {#if !subject.detail}
        <div
          class="flex flex-col gap-2 rounded-lg border border-border bg-surface-1 px-3 py-3 sm:flex-row sm:items-center sm:justify-between"
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
        <div class="grid gap-5 sm:grid-cols-2">
          {#each sections as section (section.title)}
            <section>
              <h3 class="font-mono text-[10px] font-bold tracking-[0.14em] text-primary uppercase">
                {section.title}
              </h3>
              <dl class="mt-2 divide-y divide-border/50 rounded-lg bg-surface-1">
                {#each section.items as item (item.label)}
                  <div class="flex items-center justify-between gap-3 px-3 py-2">
                    <dt class="font-mono text-[10px] text-muted-foreground">{item.label}</dt>
                    <dd class="flex items-center gap-1.5 font-mono text-xs font-bold tabular-nums">
                      {item.value}
                      {#if item.href}
                        <a
                          href={item.href}
                          target="_blank"
                          rel="noopener noreferrer"
                          class="inline-flex rounded p-0.5 text-muted-foreground outline-none transition-colors hover:text-primary focus-visible:ring-2 focus-visible:ring-ring"
                          aria-label={`Source for ${item.label}`}
                        >
                          <ExternalLink class="h-3 w-3" />
                        </a>
                      {/if}
                    </dd>
                  </div>
                {/each}
              </dl>
            </section>
          {/each}
        </div>
        {#if playoffSection}
          <section class="mt-5">
            <div class="flex flex-wrap items-baseline justify-between gap-2">
              <h3 class="font-mono text-[10px] font-bold tracking-[0.14em] text-primary uppercase">
                Playoffs
              </h3>
              <p class="font-mono text-[10px] text-muted-foreground">
                {playoffSection.season} · {playoffSection.sample}
              </p>
            </div>
            {#if playoffSection.adjustment}
              <div class="mt-2">
                <PlayoffEffectDetails
                  adjustment={playoffSection.adjustment}
                  applied={playoffSection.applied}
                />
              </div>
            {:else}
              <div class="mt-2 rounded-lg border border-border/60 bg-surface-1 p-3">
                <p class="text-sm font-bold">Insufficient evidence</p>
                <p class="mt-1 text-xs leading-relaxed text-muted-foreground">
                  No playoff bonus or penalty in new runs. Recorded stats have not been adjusted for
                  opponent strength and pace, so they cannot establish performance above or below
                  expectation.
                </p>
                <p class="mt-2 font-mono text-[11px] text-muted-foreground">
                  Shooting, shot volume, passing, rebounding and ball security: unchanged.
                </p>
                <p class="mt-2 text-xs text-muted-foreground">
                  Existing runs retain their saved playoff effects.
                </p>
              </div>
            {/if}
          </section>
        {/if}
        <p class="mt-4 text-[11px] leading-relaxed text-muted-foreground">
          — means unavailable in the historical source. Some stats were not recorded in older
          seasons.
        </p>
      {/if}
    </div>
  {/if}
</DialogShell>
