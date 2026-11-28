<script lang="ts">
  import type { FullCourtMoneyConfig } from '@hoop-rush/data-contracts';
  import { franchiseAbbreviation } from '@hoop-rush/data-contracts';
  import { Check, ChevronDown } from '@lucide/svelte';
  import TeamLogo from '#lib/components/TeamLogo.svelte';
  import { buildPlayerProfile, defaultSlotForPositions } from '#lib/players/player-profile.js';
  import { capRushProfileInput } from '#lib/features/cap-rush/cap-rush-player-profile.js';
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
    fullCourtProfileReferences,
    type FullCourtCatalogRow,
  } from './full-court-draft-presentation.js';
  import type { FullCourtCatalogIndex } from '@hoop-rush/engine';
  import FullCourtPortrait from './FullCourtPortrait.svelte';
  import FullCourtRating from './FullCourtRating.svelte';

  let {
    row,
    index,
    art = null,
    money,
    busy,
    complete,
    selected,
    onSelect,
    onPick,
  }: {
    row: FullCourtCatalogRow;
    /** Only used to resolve positional reference traits for the playstyle read. */
    index: FullCourtCatalogIndex;
    art?: FullCourtArt | null;
    money: FullCourtMoneyConfig;
    busy: boolean;
    complete: boolean;
    selected: boolean;
    onSelect: () => void;
    onPick: () => void;
  } = $props();

  const player = $derived(row.player);
  const team = $derived(art === null ? null : art.teamFor(player.franchiseId));
  const abbreviation = $derived(team?.abbreviation ?? franchiseAbbreviation(player.franchiseId));
  const signable = $derived(row.assessment.legal && !row.onRoster && !complete);
  const actionLabel = $derived(row.onRoster ? 'Signed' : row.playerRostered ? 'Rostered' : 'Sign');
  const blocker = $derived(fullCourtPickReasonLabel(row.assessment, money));

  // Playstyle is free information, the way Cap Rush shows it on every card.
  let expanded = $state(false);
  const profile = $derived.by(() => {
    const slot = defaultSlotForPositions(player.positions);
    const reference = fullCourtProfileReferences(index).forSlot(slot) ?? null;
    return buildPlayerProfile(
      capRushProfileInput(player, team?.abbreviation ?? abbreviation, slot),
      reference,
    );
  });
  const chips = $derived([
    ...profile.strengths
      .slice(0, 3)
      .map((trait) => ({ label: trait.label, tone: 'good' as const })),
    ...profile.weaknesses
      .slice(0, 3)
      .map((trait) => ({ label: trait.label, tone: 'bad' as const })),
  ]);
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

  <!-- Playstyle is always available, matching Cap Rush's card treatment. -->
  <button
    type="button"
    class="mx-2 flex min-h-8 items-center justify-between gap-2 rounded border border-line-soft bg-surface-1 px-1.5 font-mono text-[8px] font-bold tracking-[0.07em] text-muted-foreground uppercase outline-none transition-colors hover:border-line-strong hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring sm:mx-2.5"
    aria-expanded={expanded}
    aria-controls={`${player.playerVersionId}-playstyle`}
    aria-label={`${expanded ? 'Hide' : 'Show'} ${player.displayName} playstyle`}
    onclick={() => (expanded = !expanded)}
  >
    <span>{expanded ? 'Hide playstyle' : 'Show playstyle'}</span>
    <ChevronDown
      size={11}
      class="shrink-0 transition-transform {expanded ? 'rotate-180' : ''}"
      aria-hidden="true"
    />
  </button>

  {#if expanded}
    <div
      id={`${player.playerVersionId}-playstyle`}
      class="mx-2 mt-1.5 grid shrink-0 gap-2 sm:mx-2.5"
    >
      <p
        class="w-full truncate font-mono text-[8px] font-bold tracking-[0.08em] text-accent uppercase"
      >
        {profile.archetype}
      </p>
      {#if chips.length > 0}
        <div class="flex w-full flex-wrap items-start gap-1">
          {#each chips as chip (chip.label)}
            <span
              class="shrink-0 rounded border px-1 py-0.5 font-mono text-[7.5px] leading-tight font-bold tracking-[0.04em] uppercase {chip.tone ===
              'good'
                ? 'border-positive/40 bg-positive/10 text-positive'
                : 'border-negative/45 bg-negative/10 text-negative'}">{chip.label}</span
            >
          {/each}
        </div>
      {/if}
    </div>
  {/if}

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
