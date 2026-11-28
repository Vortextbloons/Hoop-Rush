<script lang="ts">
  import type { FullCourtMoneyConfig } from '@hoop-rush/data-contracts';
  import { franchiseAbbreviation } from '@hoop-rush/data-contracts';
  import { Check } from '@lucide/svelte';
  import TeamLogo from '#lib/components/TeamLogo.svelte';
  import Badge from '#lib/components/ui/Badge.svelte';
  import Button from '#lib/components/ui/Button.svelte';
  import {
    capStatusClass,
    capStatusLabel,
    formatMillions,
  } from '#lib/features/cap-rush/cap-rush-presentation.js';
  import type { FullCourtArt } from './full-court-art.js';
  import {
    fullCourtPickReasonLabel,
    type FullCourtCatalogRow,
  } from './full-court-draft-presentation.js';
  import FullCourtPortrait from './FullCourtPortrait.svelte';
  import FullCourtRating from './FullCourtRating.svelte';

  let {
    row,
    art = null,
    money,
    busy,
    complete,
    selected,
    scouted,
    onSelect,
    onPick,
  }: {
    row: FullCourtCatalogRow;
    art?: FullCourtArt | null;
    money: FullCourtMoneyConfig;
    busy: boolean;
    complete: boolean;
    selected: boolean;
    scouted: boolean;
    onSelect: () => void;
    onPick: () => void;
  } = $props();

  const player = $derived(row.player);
  const team = $derived(art === null ? null : art.teamFor(player.franchiseId));
  const abbreviation = $derived(team?.abbreviation ?? franchiseAbbreviation(player.franchiseId));
  const signable = $derived(row.assessment.legal && !row.onRoster && !complete);
  const actionLabel = $derived(row.onRoster ? 'Signed' : row.playerRostered ? 'Rostered' : 'Sign');
  const blocker = $derived(fullCourtPickReasonLabel(row.assessment, money));
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
      {#if row.onRoster}
        <Badge tone="positive">Signed</Badge>
      {:else if row.playerRostered}
        <Badge tone="neutral">Rostered</Badge>
      {/if}
      {#if scouted}
        <Badge tone="accent">Scouted</Badge>
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

  <div class="border-t border-line-soft p-2 pt-1.5">
    {#if blocker !== null && !row.onRoster}
      <p class="mb-1.5 text-[10px] leading-snug font-semibold text-negative">{blocker}</p>
    {/if}
    <Button
      size="sm"
      class="w-full"
      tone={signable ? 'primary' : 'secondary'}
      disabled={busy || !signable}
      aria-label={`${actionLabel} ${player.displayName}`}
      onclick={onPick}
    >
      {#if row.onRoster}
        <Check size={13} aria-hidden="true" />
      {/if}
      {actionLabel}
    </Button>
  </div>
</article>
