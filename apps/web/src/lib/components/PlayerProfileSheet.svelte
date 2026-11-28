<script lang="ts">
  import { Dialog } from 'bits-ui';
  import type { Snippet } from 'svelte';
  import { X } from '@lucide/svelte';
  import DialogShell from '#lib/components/DialogShell.svelte';
  import PlayerFace from '#lib/components/PlayerFace.svelte';
  import type { HoopRushManifest, PlayersIndexEntry } from '@hoop-rush/data-contracts';
  import type { PlayerApronView } from '#lib/players/player-apron.js';
  import { apronTierLabel } from '#lib/players/player-apron.js';
  import type {
    PlayerProfileShare,
    PlayerProfileTrait,
    PlayerProfileView,
  } from '#lib/players/player-profile.js';

  export type ProfileTab =
    'details' | 'production' | 'tendencies' | 'ratings' | 'scouting' | 'apron';

  let {
    profile,
    open = false,
    onOpenChange,
    apron = null,
    face = null,
    manifest = null,
    money = null,
    tabs,
    tab = $bindable<ProfileTab>('details'),
    scouting = null,
  }: {
    profile: PlayerProfileView;
    open?: boolean;
    onOpenChange: (open: boolean) => void;
    apron?: PlayerApronView | null;
    face?: PlayersIndexEntry | null;
    manifest?: HoopRushManifest | null;
    money?: {
      readonly salaryLabel: string;
      readonly statusLabel: string;
      readonly note: string | null;
    } | null;
    tabs?: readonly ProfileTab[];
    /** Owned by the caller, so a trigger can open the sheet on a chosen tab. */
    tab?: ProfileTab;
    scouting?: Snippet | null;
  } = $props();

  const availableTabs = $derived.by((): ProfileTab[] => {
    let base: ProfileTab[] = tabs ? [...tabs] : ['details', 'production', 'ratings'];
    // Production needs a stat line; drop it rather than show an empty tab.
    if (profile.production === null) base = base.filter((entry) => entry !== 'production');
    if (apron !== null && apron.status.kind === 'none') {
      base = base.filter((entry) => entry !== 'apron');
    }
    if (scouting !== null && !base.includes('scouting')) base = [...base, 'scouting'];
    return base;
  });

  // Apron disappears when there is nothing to pay, so fall back rather than
  // leaving a stale selection pointing at a hidden tab.
  const active = $derived(availableTabs.includes(tab) ? tab : 'details');

  const apronTier = $derived(
    apron === null || apron.status.kind === 'none' ? null : apronTierLabel(apron.status.tier),
  );
  const apronApplied = $derived(apron !== null && apron.status.kind === 'applied');

  function pct(value: number): string {
    return `${String(Math.round(value * 100))}`;
  }

  function sharePct(value: number): string {
    return `${String(Math.round(value * 100))}%`;
  }

  function toneOf(percentile: number): 'positive' | 'negative' | 'neutral' {
    if (percentile >= 0.8) return 'positive';
    if (percentile <= 0.2) return 'negative';
    return 'neutral';
  }

  function traitRows(traits: readonly PlayerProfileTrait[]) {
    return traits.map((trait) => ({
      label: trait.label,
      rank: `${pct(trait.percentile)}th`,
      width: Math.max(2, Math.round(trait.percentile * 100)),
    }));
  }

  function shareRows(shares: readonly PlayerProfileShare[]) {
    const max = Math.max(...shares.map((entry) => entry.share), 0.0001);
    return shares.map((entry) => ({
      label: entry.label,
      value: sharePct(entry.share),
      width: Math.round((entry.share / max) * 100),
    }));
  }

  const SHOT_ZONE_TONES = [
    'var(--color-primary)',
    'color-mix(in oklab, var(--color-primary) 70%, var(--color-accent))',
    'var(--color-accent)',
    'color-mix(in oklab, var(--color-positive) 65%, var(--color-chart-4, #6bb8ff))',
    'color-mix(in oklab, var(--color-chart-4, #6bb8ff) 70%, var(--color-surface-3))',
  ];
</script>

<DialogShell
  {open}
  {onOpenChange}
  size="lg"
  grabHandle
  showClose={false}
  contentClass="flex max-h-[85dvh] flex-col overflow-hidden p-0"
  headerClass="hidden"
>
  {#snippet header()}
    <Dialog.Title class="sr-only">{profile.displayName} details</Dialog.Title>
  {/snippet}

  <div class="relative shrink-0 border-b border-border bg-surface-1">
    <div
      class="pointer-events-none absolute inset-0 bg-gradient-to-br from-primary/12 via-transparent to-transparent"
      aria-hidden="true"
    ></div>

    <div class="relative flex items-start justify-between gap-2 px-4 pt-2 sm:px-5">
      <span
        class="pt-1 font-mono text-[8px] font-bold tracking-[0.14em] text-muted-foreground uppercase"
        >Player profile</span
      >
      <Dialog.Close aria-label="Close player details" class="ui-icon-btn -mr-1 shrink-0 bg-card/90">
        <X class="h-4 w-4" />
      </Dialog.Close>
    </div>

    <div class="relative flex gap-3 px-4 pb-3 sm:gap-4 sm:px-5 sm:pb-4">
      <div class="relative shrink-0">
        {#if face !== null && manifest !== null}
          <PlayerFace player={face} {manifest} size="xl" fallbackInitials={profile.initials} />
        {:else}
          <span
            class="grid h-16 w-16 place-items-center rounded-xl bg-surface-3 font-display text-xl font-extrabold text-muted-foreground sm:h-20 sm:w-20"
            aria-hidden="true">{profile.initials}</span
          >
        {/if}
      </div>

      <div class="min-w-0 flex-1">
        <p
          class="font-display text-xl font-extrabold leading-tight tracking-tight uppercase sm:text-2xl"
        >
          {profile.displayName}
        </p>
        <p class="mt-1 font-mono text-[10px] leading-snug text-muted-foreground uppercase">
          {#if profile.franchiseLabel}{profile.franchiseLabel} ·
          {/if}{profile.seasonKey ?? 'Season unknown'}{#if profile.heightLabel}
            · {profile.heightLabel}{/if}{#if profile.weightLabel}
            · {profile.weightLabel}{/if}
        </p>
        <div class="mt-2 flex flex-wrap items-center gap-1.5">
          <span
            class="rounded bg-surface-3 px-1.5 py-0.5 font-mono text-[9px] font-semibold tracking-[0.06em] text-muted-foreground uppercase"
          >
            {profile.positionsLabel}
          </span>
          {#if apron !== null && apron.status.kind !== 'none'}
            <span
              class="rounded px-1.5 py-0.5 font-mono text-[9px] font-bold tracking-[0.06em] uppercase {apronApplied
                ? 'bg-negative/15 text-negative'
                : 'bg-accent/15 text-accent'}"
            >
              {apronTier}{apronApplied ? ' · live' : ' · signs in'}
            </span>
          {/if}
        </div>
      </div>

      <div class="flex shrink-0 flex-col items-end">
        <span
          class="font-display pt-px text-2xl font-extrabold leading-[1.15] tabular-nums sm:text-3xl"
          >{profile.overall}</span
        >
        <span
          class="font-mono text-[8px] font-bold tracking-[0.12em] text-muted-foreground uppercase"
          >Overall</span
        >
        {#if profile.offense !== null || profile.defense !== null}
          <span class="mt-1 font-mono text-[9px] tabular-nums text-muted-foreground">
            {#if profile.offense !== null}OFF {profile.offense}{/if}{#if profile.offense !== null && profile.defense !== null}
              ·
            {/if}{#if profile.defense !== null}DEF {profile.defense}{/if}
          </span>
        {/if}
      </div>
    </div>

    {#if money !== null}
      <div
        class="relative flex flex-wrap items-center gap-x-2 gap-y-1 border-t border-border/50 bg-surface-2/60 px-4 py-2 sm:px-5"
      >
        <span class="font-display text-lg font-extrabold tabular-nums">{money.salaryLabel}</span>
        <span
          class="rounded-full border border-positive/40 bg-positive/10 px-1.5 py-0.5 font-mono text-[9px] font-bold tracking-[0.06em] text-positive uppercase"
          >{money.statusLabel}</span
        >
        {#if money.note !== null}
          <span class="ml-auto font-mono text-[9px] text-muted-foreground">{money.note}</span>
        {/if}
      </div>
    {/if}

    <div
      class="relative grid border-t border-border/50"
      style:grid-template-columns="repeat({availableTabs.length}, minmax(0, 1fr))"
      role="tablist"
      aria-label="Player profile sections"
    >
      {#each availableTabs as entry (entry)}
        <button
          type="button"
          role="tab"
          aria-selected={active === entry}
          class="relative min-h-11 px-1 pb-2 pt-2 font-mono text-[9px] font-bold tracking-[0.08em] uppercase outline-none transition-colors focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring {active ===
          entry
            ? 'border-b-2 border-primary text-foreground'
            : 'border-b-2 border-transparent text-muted-foreground hover:text-foreground'}"
          onclick={() => (tab = entry)}
        >
          {entry === 'details' ? 'Details' : null}
          {entry === 'production' ? 'Stats' : null}
          {entry === 'tendencies' ? 'Tendencies' : null}
          {entry === 'ratings' ? 'Ratings' : null}
          {entry === 'scouting' ? 'Scouting' : null}
          {entry === 'apron' ? 'Apron' : null}
          {#if entry === 'apron'}
            <span
              class="ml-1 inline-block h-1 w-1 rounded-full align-middle {apronApplied
                ? 'bg-negative'
                : 'bg-accent'}"
              aria-hidden="true"
            ></span>
          {/if}
        </button>
      {/each}
    </div>
  </div>

  <div class="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-3.5 sm:px-5">
    {#if active === 'details'}
      <div class="grid gap-3.5">
        <div class="flex items-center gap-2">
          <span class="font-mono text-[9px] font-bold tracking-[0.12em] text-accent uppercase"
            >{profile.archetype}</span
          >
          <span
            class="h-px flex-1 bg-gradient-to-r from-accent/40 to-transparent"
            aria-hidden="true"
          ></span>
        </div>

        <p class="text-[13px] leading-relaxed text-foreground/85">{profile.summary}</p>

        {#if profile.strengths.length > 0}
          <section>
            <div class="mb-1.5 flex items-baseline justify-between gap-2">
              <h3 class="font-mono text-[9px] font-bold tracking-[0.13em] text-primary uppercase">
                Strengths
              </h3>
              {#if profile.cohort}
                <span class="font-mono text-[8px] text-muted-foreground uppercase"
                  >vs {profile.cohort.label}</span
                >
              {/if}
            </div>
            <ul class="divide-y divide-border/50 overflow-hidden rounded-lg bg-surface-2">
              {#each traitRows(profile.strengths) as row (row.label)}
                <li class="flex items-center gap-2.5 px-2.5 py-1.5">
                  <span class="min-w-0 flex-1 truncate text-[12px]">{row.label}</span>
                  <span class="font-mono text-[9px] font-bold tabular-nums text-muted-foreground"
                    >{row.rank}</span
                  >
                  <span class="h-1 w-11 shrink-0 overflow-hidden rounded-full bg-border/80">
                    <span
                      class="block h-full rounded-full bg-positive"
                      style:width={`${row.width}%`}
                    ></span>
                  </span>
                </li>
              {/each}
            </ul>
          </section>
        {/if}

        {#if profile.weaknesses.length > 0}
          <section>
            <div class="mb-1.5 flex items-baseline justify-between gap-2">
              <h3 class="font-mono text-[9px] font-bold tracking-[0.13em] text-negative uppercase">
                Weaknesses
              </h3>
              {#if profile.cohort}
                <span class="font-mono text-[8px] text-muted-foreground uppercase"
                  >vs {profile.cohort.label}</span
                >
              {/if}
            </div>
            <ul class="divide-y divide-border/50 overflow-hidden rounded-lg bg-surface-2">
              {#each traitRows(profile.weaknesses) as row (row.label)}
                <li class="flex items-center gap-2.5 px-2.5 py-1.5">
                  <span
                    class="min-w-0 flex-1 truncate font-mono text-[10px] font-bold uppercase tracking-[0.03em] text-negative"
                    >{row.label}</span
                  >
                  <span class="font-mono text-[9px] font-bold tabular-nums text-negative/80"
                    >{row.rank}</span
                  >
                  <span class="h-1 w-11 shrink-0 overflow-hidden rounded-full bg-border/80">
                    <span
                      class="block h-full rounded-full bg-negative"
                      style:width={`${row.width}%`}
                    ></span>
                  </span>
                </li>
              {/each}
            </ul>
          </section>
        {/if}

        {#if profile.workload !== null}
          <section>
            <div class="mb-1.5 flex items-baseline justify-between gap-2">
              <h3 class="font-mono text-[9px] font-bold tracking-[0.13em] text-primary uppercase">
                Workload
              </h3>
              <span class="font-mono text-[8px] text-muted-foreground uppercase">Per game</span>
            </div>
            <dl class="grid grid-cols-3 gap-px overflow-hidden rounded-lg bg-border/50">
              <div class="bg-surface-2 px-2.5 py-2">
                <dt class="font-mono text-[8px] uppercase tracking-[0.08em] text-muted-foreground">
                  Minutes
                </dt>
                <dd class="font-display mt-0.5 text-base font-extrabold leading-[1.2] tabular-nums">
                  {profile.workload.minutes === null ? '—' : profile.workload.minutes.toFixed(1)}
                </dd>
              </div>
              <div class="bg-surface-2 px-2.5 py-2">
                <dt class="font-mono text-[8px] uppercase tracking-[0.08em] text-muted-foreground">
                  Shots
                </dt>
                <dd class="font-display mt-0.5 text-base font-extrabold leading-[1.2] tabular-nums">
                  {profile.workload.shotAttempts === null
                    ? '—'
                    : profile.workload.shotAttempts.toFixed(1)}
                </dd>
              </div>
              <div class="bg-surface-2 px-2.5 py-2">
                <dt class="font-mono text-[8px] uppercase tracking-[0.08em] text-muted-foreground">
                  Usage
                </dt>
                <dd class="font-display mt-0.5 text-base font-extrabold leading-[1.2] tabular-nums">
                  {profile.workload.usage.toFixed(1)}%
                </dd>
              </div>
            </dl>
          </section>
        {/if}
      </div>
    {:else if active === 'production' && profile.production !== null}
      <div class="grid gap-3.5">
        {#each profile.production as group (group.title)}
          <section>
            <div class="mb-1.5 flex items-baseline justify-between gap-2">
              <h3 class="font-mono text-[9px] font-bold tracking-[0.13em] text-primary uppercase">
                {group.title}
              </h3>
              <span class="font-mono text-[8px] text-muted-foreground uppercase">
                {group.title === 'Shooting' ? 'Percentages' : 'Season totals'}
              </span>
            </div>
            <dl class="grid grid-cols-2 gap-px overflow-hidden rounded-lg bg-border/50">
              {#each group.rows as row (row.label)}
                <div class="flex items-baseline justify-between gap-2 bg-surface-2 px-2.5 py-1.5">
                  <dt class="truncate text-[11px] text-muted-foreground">{row.label}</dt>
                  <dd class="font-mono text-[12px] font-bold tabular-nums">{row.value}</dd>
                </div>
              {/each}
            </dl>
          </section>
        {/each}
        {#if profile.postseason !== null && profile.postseason.length > 0}
          <section>
            <div class="mb-1.5 flex items-baseline justify-between gap-2">
              <h3 class="font-mono text-[9px] font-bold tracking-[0.13em] text-accent uppercase">
                Playoffs
              </h3>
              <span class="font-mono text-[8px] text-muted-foreground uppercase"
                >Recorded sample</span
              >
            </div>
            <dl class="grid grid-cols-2 gap-px overflow-hidden rounded-lg bg-border/50">
              {#each profile.postseason.flatMap((group) => group.rows) as row (row.label)}
                <div class="flex items-baseline justify-between gap-2 bg-surface-2 px-2.5 py-1.5">
                  <dt class="truncate text-[11px] text-muted-foreground">{row.label}</dt>
                  <dd class="font-mono text-[12px] font-bold tabular-nums">{row.value}</dd>
                </div>
              {/each}
            </dl>
          </section>
        {/if}
        <p class="font-mono text-[8px] leading-relaxed text-muted-foreground">
          An em dash means the stat was not recorded for this season.
        </p>
      </div>
    {:else if active === 'tendencies'}
      <div class="grid gap-4">
        {#if profile.shotDiet !== null}
          <section>
            <div class="mb-1.5 flex items-baseline justify-between gap-2">
              <h3 class="font-mono text-[9px] font-bold tracking-[0.13em] text-primary uppercase">
                Where he shoots
              </h3>
              <span class="font-mono text-[8px] text-muted-foreground uppercase"
                >Share of attempts</span
              >
            </div>
            <div class="flex h-4 gap-px overflow-hidden rounded">
              {#each profile.shotDiet as zone, index (zone.label)}
                <div
                  class="grid place-items-center font-mono text-[8px] font-bold"
                  style:flex={zone.share}
                  style:background={SHOT_ZONE_TONES[index] ?? SHOT_ZONE_TONES[0]}
                  style:color={index === 4 ? 'var(--color-foreground)' : '#06080c'}
                >
                  {Math.round(zone.share * 100)}
                </div>
              {/each}
            </div>
            <dl class="mt-2 grid grid-cols-2 gap-x-3 gap-y-1">
              {#each profile.shotDiet as zone, index (zone.label)}
                <div class="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                  <span
                    class="h-1.5 w-1.5 shrink-0 rounded-sm"
                    style:background={SHOT_ZONE_TONES[index] ?? SHOT_ZONE_TONES[0]}
                  ></span>
                  <dt class="truncate">{zone.label}</dt>
                  <dd class="ml-auto font-mono text-[10px] font-bold text-foreground tabular-nums">
                    {sharePct(zone.share)}
                  </dd>
                </div>
              {/each}
            </dl>
          </section>
        {/if}

        {#if profile.actions !== null}
          <section>
            <div class="mb-1.5 flex items-baseline justify-between gap-2">
              <h3 class="font-mono text-[9px] font-bold tracking-[0.13em] text-primary uppercase">
                What he runs
              </h3>
              <span class="font-mono text-[8px] text-muted-foreground uppercase"
                >Share of possessions</span
              >
            </div>
            <ul class="grid gap-1.5">
              {#each shareRows(profile.actions) as row (row.label)}
                <li class="grid grid-cols-[minmax(0,5.5rem)_1fr_2rem] items-center gap-2">
                  <span class="truncate text-[11px] text-muted-foreground">{row.label}</span>
                  <span class="h-1 overflow-hidden rounded-full bg-border/80">
                    <span class="block h-full rounded-full bg-primary" style:width={`${row.width}%`}
                    ></span>
                  </span>
                  <span class="text-right font-mono text-[10px] font-bold tabular-nums"
                    >{row.value}</span
                  >
                </li>
              {/each}
            </ul>
          </section>
        {/if}

        {#if profile.habits.length > 0}
          <section>
            <div class="mb-1.5 flex items-baseline justify-between gap-2">
              <h3 class="font-mono text-[9px] font-bold tracking-[0.13em] text-primary uppercase">
                Habits
              </h3>
              {#if profile.cohort}
                <span class="font-mono text-[8px] text-muted-foreground uppercase"
                  >vs {profile.cohort.label}</span
                >
              {/if}
            </div>
            <ul class="divide-y divide-border/50 overflow-hidden rounded-lg bg-surface-2">
              {#each traitRows(profile.habits) as row (row.label)}
                <li class="flex items-center gap-2.5 px-2.5 py-1.5">
                  <span class="min-w-0 flex-1 truncate text-[12px]">{row.label}</span>
                  <span class="font-mono text-[9px] font-bold tabular-nums text-muted-foreground"
                    >{row.rank}</span
                  >
                  <span class="h-1 w-11 shrink-0 overflow-hidden rounded-full bg-border/80">
                    <span
                      class="block h-full rounded-full bg-muted-foreground/60"
                      style:width={`${row.width}%`}
                    ></span>
                  </span>
                </li>
              {/each}
            </ul>
          </section>
        {/if}
      </div>
    {:else if active === 'ratings'}
      <div class="grid gap-3">
        {#each profile.ratingGroups as group (group.title)}
          <section>
            <div class="mb-1.5 flex items-baseline justify-between gap-2">
              <h3
                class="font-mono text-[9px] font-bold tracking-[0.13em] text-muted-foreground uppercase"
              >
                {group.title}
              </h3>
              <span class="font-mono text-[8px] text-muted-foreground uppercase">Value · rank</span>
            </div>
            <ul class="divide-y divide-border/50 overflow-hidden rounded-lg bg-surface-2">
              {#each group.rows as row (row.label)}
                {@const tone = toneOf(row.percentile)}
                <li class="grid grid-cols-[4.5rem_1.5rem_1fr] items-center gap-2 px-2.5 py-1">
                  <span
                    class="truncate {tone === 'negative'
                      ? 'font-mono text-[9.5px] font-bold uppercase tracking-[0.03em] text-negative'
                      : 'text-[11px] text-muted-foreground'}">{row.label}</span
                  >
                  <span
                    class="text-right font-mono text-[11px] font-bold tabular-nums {tone ===
                    'positive'
                      ? 'text-positive'
                      : tone === 'negative'
                        ? 'text-negative'
                        : 'text-foreground'}">{row.value}</span
                  >
                  <span class="h-1 overflow-hidden rounded-full bg-border/80">
                    <span
                      class="block h-full rounded-full {tone === 'positive'
                        ? 'bg-positive'
                        : tone === 'negative'
                          ? 'bg-negative'
                          : 'bg-muted-foreground/60'}"
                      style:width={`${Math.max(2, Math.round(row.percentile * 100))}%`}
                    ></span>
                  </span>
                </li>
              {/each}
            </ul>
          </section>
        {/each}
        <p class="font-mono text-[8px] leading-relaxed text-muted-foreground">
          Green is the top 20% at this position, red the bottom 20%. Every raw value is unchanged
          from the underlying data.
        </p>
      </div>
    {:else if active === 'scouting' && scouting !== null}
      {@render scouting()}
    {:else if active === 'apron' && apron !== null && apron.status.kind !== 'none'}
      <div class="grid gap-3">
        <div
          class="rounded-lg border px-3 py-2.5 {apronApplied
            ? 'border-negative/40 bg-negative/[0.07]'
            : 'border-accent/40 bg-accent/[0.07]'}"
        >
          <div class="flex items-center gap-1.5">
            <span
              class="h-1.5 w-1.5 rounded-full {apronApplied ? 'bg-negative' : 'bg-accent'}"
              aria-hidden="true"
            ></span>
            <span
              class="font-mono text-[8px] font-bold tracking-[0.12em] uppercase {apronApplied
                ? 'text-negative'
                : 'text-accent'}"
            >
              {apronApplied ? 'Applied · all 82 games' : 'Would apply after signing'}
            </span>
          </div>
          <p class="font-display mt-1 text-base font-extrabold uppercase">{apronTier}</p>
          <p class="mt-1 text-[11px] leading-relaxed text-muted-foreground">
            {#if apron.status.kind === 'applied'}
              Active for this entire season. Every rating below is already reduced in the sim and in
              every box score.
            {:else}
              This signing crosses the {apronTier?.toLowerCase()} line. These reductions take effect the
              moment the lineup locks.
            {/if}
          </p>
        </div>

        <section>
          <div class="mb-1.5 flex items-baseline justify-between gap-2">
            <h3 class="font-mono text-[9px] font-bold tracking-[0.13em] text-primary uppercase">
              Ratings lost
            </h3>
            <span class="font-mono text-[8px] text-muted-foreground uppercase"
              >Original → effective</span
            >
          </div>
          <ul class="divide-y divide-border/50 overflow-hidden rounded-lg bg-surface-2">
            {#each apron.reductions as row (row.label)}
              <li class="grid grid-cols-[1fr_auto_1.75rem] items-center gap-2 px-2.5 py-1">
                <span class="truncate text-[11px] text-muted-foreground">{row.label}</span>
                <span
                  class="font-mono text-[10px] text-muted-foreground/70 line-through tabular-nums"
                  >{row.original}</span
                >
                <span class="text-right font-mono text-[11px] font-bold text-negative tabular-nums"
                  >{row.effective}</span
                >
              </li>
            {/each}
          </ul>
        </section>

        {#if apron.rules.length > 0}
          <div class="rounded-lg border border-border/80 bg-surface-2/50 px-2.5 py-2">
            <p class="font-mono text-[10px] font-bold">{apron.rules.join(' · ')}</p>
            {#if apron.ruleDetail !== null}
              <p class="mt-1 text-[10.5px] leading-relaxed text-muted-foreground">
                {apron.ruleDetail}
              </p>
            {/if}
          </div>
        {/if}
      </div>
    {/if}
  </div>

  {#if profile.cohort !== null}
    <p
      class="shrink-0 border-t border-border bg-surface-1 px-4 py-2 font-mono text-[8px] leading-relaxed text-muted-foreground sm:px-5"
    >
      Percentiles compare him with all {profile.cohort.size.toLocaleString()}
      {profile.cohort.label} in the pool.
    </p>
  {/if}
</DialogShell>
