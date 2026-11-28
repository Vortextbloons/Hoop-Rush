<script lang="ts">
  import { franchiseAbbreviation, type CapRushBucket } from '@hoop-rush/data-contracts';
  import TeamLogo from '#lib/components/TeamLogo.svelte';
  import Badge from '#lib/components/ui/Badge.svelte';
  import {
    bucketClass,
    bucketLabel,
    capStatusClass,
    capStatusLabel,
    formatMillions,
  } from '#lib/features/cap-rush/cap-rush-presentation.js';
  import type { FullCourtArt } from './full-court-art.js';
  import type { FullCourtCatalogRow } from './full-court-draft-presentation.js';
  import FullCourtPortrait from './FullCourtPortrait.svelte';
  import FullCourtRating from './FullCourtRating.svelte';

  let {
    row,
    bucket,
    art = null,
    selected,
    onSelect,
  }: {
    row: FullCourtCatalogRow;
    bucket?: CapRushBucket;
    art?: FullCourtArt | null;
    selected: boolean;
    onSelect: () => void;
  } = $props();

  const player = $derived(row.player);
  const team = $derived(art?.teamFor(player.franchiseId) ?? null);
  const abbreviation = $derived(team?.abbreviation ?? franchiseAbbreviation(player.franchiseId));
</script>

<article
  class="flex h-full min-w-0 flex-col overflow-hidden rounded-xl border bg-card transition-colors {selected
    ? 'border-primary bg-surface-2/70'
    : 'border-border hover:border-line-strong'} {!row.assessment.legal && !row.onRoster
    ? 'opacity-75'
    : ''}"
>
  <button
    type="button"
    class="flex min-w-0 flex-1 flex-col gap-2 p-2.5 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring"
    aria-label={`${player.displayName} details`}
    aria-pressed={selected}
    onclick={onSelect}
  >
    <div class="flex min-w-0 items-start gap-2">
      <FullCourtPortrait {player} {art} size="sm" />
      <div class="min-w-0 flex-1">
        <p class="font-display truncate text-sm leading-tight font-extrabold">
          {player.displayName}
        </p>
        <p
          class="mt-0.5 flex min-w-0 items-center gap-1 font-mono text-[9px] text-muted-foreground uppercase"
        >
          {#if team !== null && art !== null}
            <TeamLogo
              manifest={art.manifest}
              franchiseId={team.franchiseId}
              teamExternalId={team.teamExternalId}
              className="h-3.5 w-3.5"
            />
          {/if}
          <span class="truncate">{abbreviation} · {player.seasonKey}</span>
        </p>
      </div>
      <div class="shrink-0">
        <FullCourtRating value={player.originalOverall} size="md" layout="stacked" />
      </div>
    </div>

    <div class="flex min-h-5 flex-wrap items-center gap-1">
      <span
        class="rounded border border-line-soft bg-surface-1 px-1.5 py-0.5 font-mono text-[8px] font-bold tracking-[0.06em] text-muted-foreground uppercase"
      >
        {player.positions.join('/')}
      </span>
      {#if bucket !== undefined}
        <span
          class="rounded border px-1 py-0.5 font-mono text-[8px] font-bold uppercase {bucketClass(
            bucket,
          )}">{bucketLabel(bucket)}</span
        >
      {/if}
      {#if row.onRoster}
        <Badge tone="positive">Signed</Badge>
      {:else if row.playerRostered}
        <Badge tone="neutral">Rostered</Badge>
      {/if}
    </div>

    <div
      class="mt-auto flex flex-wrap items-end justify-between gap-x-2 gap-y-1 border-t border-line-soft pt-2"
    >
      <div class="min-w-0">
        <span class="ui-micro">Salary</span>
        <p
          class="font-display mt-0.5 text-base leading-none font-extrabold tracking-tight tabular-nums"
        >
          {formatMillions(row.salaryDollars)}
        </p>
      </div>
      <span
        class="inline-flex rounded-full border px-1.5 py-0.5 font-mono text-[8px] font-bold tracking-[0.04em] uppercase {capStatusClass(
          row.statusAfterPick,
        )}"
      >
        {capStatusLabel(row.statusAfterPick)}
      </span>
    </div>
  </button>
</article>
