<script lang="ts">
  import type { CapRushCardView } from '@hoop-rush/application/cap-rush';
  import { CAP_RUSH_HARD_LIMIT_DOLLARS, franchiseAbbreviation } from '@hoop-rush/data-contracts';
  import { capRushPayrollStatus } from '@hoop-rush/engine';
  import { ChevronDown } from '@lucide/svelte';
  import PlayerFace from '#lib/components/PlayerFace.svelte';
  import TeamLogo from '#lib/components/TeamLogo.svelte';
  import PlayerProfileSheet from '#lib/components/PlayerProfileSheet.svelte';
  import { buildPlayerProfile } from '#lib/players/player-profile.js';
  import type { PlayerProfileReferences } from '#lib/players/player-profile.js';
  import type { CapRushArt } from './cap-rush-art.ts';
  import {
    bucketClass,
    bucketLabel,
    capStatusClass,
    capStatusLabel,
    capStatusShortLabel,
    formatMillions,
    initialsOf,
  } from './cap-rush-presentation.ts';
  import {
    NO_APRON,
    capRushApronStrip,
    capRushProfileInput,
    capRushProjectedApron,
  } from './cap-rush-player-profile.ts';

  let {
    entry,
    protectMode = false,
    disabled = false,
    art = null,
    references = null,
    onSign,
    onProtect,
  }: {
    entry: CapRushCardView;
    protectMode?: boolean;
    disabled?: boolean;
    art?: CapRushArt | null;
    references?: PlayerProfileReferences | null;
    onSign: (cardId: string) => void;
    onProtect: (cardId: string) => void;
  } = $props();

  const card = $derived(entry.card);
  const player = $derived(card.source);
  const face = $derived(art !== null ? art.faceFor(player) : null);
  const team = $derived(art !== null ? art.teamFor(player.franchiseId) : null);
  const initials = $derived(initialsOf(player.displayName));
  const status = $derived(capRushPayrollStatus(entry.signing.payrollAfterSigning));

  const apron = $derived.by(() =>
    entry.signing.legal
      ? capRushProjectedApron(player, entry.signing.payrollAfterSigning)
      : NO_APRON,
  );
  const apronStrip = $derived(capRushApronStrip(apron));

  const profile = $derived.by(() => {
    const reference = references?.forSlot(player.positions[0] ?? '') ?? null;
    return buildPlayerProfile(
      capRushProfileInput(player, team?.abbreviation ?? franchiseAbbreviation(player.franchiseId)),
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

  // Two disclosure steps: the card stays a nameplate, "Playstyle" adds the
  // archetype and trait chips, and the sheet holds the full rating spread.
  let expanded = $state(false);
  let sheetOpen = $state(false);
  let sheetTab = $state<'details' | 'tendencies' | 'ratings' | 'apron'>('details');

  function openSheet(tab: 'details' | 'ratings'): void {
    sheetTab = tab;
    sheetOpen = true;
  }

  const reason = $derived.by(() => {
    if (protectMode) return 'Keep this card and reroll the other nine';
    if (entry.signing.legal) return null;
    switch (entry.signing.reason) {
      case 'hard-limit':
        return `Past the ${formatMillions(CAP_RUSH_HARD_LIMIT_DOLLARS)} limit by ${formatMillions(entry.signing.payrollAfterSigning - CAP_RUSH_HARD_LIMIT_DOLLARS)}`;
      case 'completion':
        return `Cheapest finish ${formatMillions(entry.signing.projectedPayroll ?? 0)}`;
      case 'no-completion':
        return 'No legal way to fill the other slots';
      default:
        return 'Unavailable';
    }
  });

  const canSign = $derived(entry.signing.legal && !protectMode && !disabled);
</script>

<article
  class="group flex min-w-0 flex-col overflow-hidden rounded-lg border bg-card transition-colors sm:rounded-xl {protectMode
    ? 'border-dashed border-accent/70'
    : entry.signing.legal
      ? 'border-border hover:border-line-strong'
      : 'border-border/70 opacity-80'}"
  data-card-id={card.cardId}
  data-legal={entry.signing.legal}
  data-expanded={expanded}
>
  <div class="flex min-w-0 flex-col gap-1.5 p-2 sm:p-2.5">
    <div class="flex w-full items-start gap-2">
      {#if face !== null && art !== null}
        <PlayerFace
          player={face}
          manifest={art.manifest}
          size="sm"
          fallbackInitials={initials}
          eager
        />
      {:else}
        <span
          class="grid h-9 w-9 shrink-0 place-items-center rounded-md bg-surface-3 font-display text-xs font-extrabold text-muted-foreground"
          aria-hidden="true">{initials}</span
        >
      {/if}
      <div class="min-w-0 flex-1">
        <div class="flex items-baseline justify-between gap-1">
          <p class="min-w-0 truncate font-display text-xs leading-tight font-extrabold sm:text-sm">
            {player.displayName}
          </p>
          <span
            class="shrink-0 font-mono text-[10px] font-bold text-muted-foreground tabular-nums"
            aria-label={`Overall ${String(player.originalOverall)}`}>{player.originalOverall}</span
          >
        </div>
        <p
          class="mt-0.5 flex min-w-0 items-center gap-1 font-mono text-[8px] text-muted-foreground"
        >
          {#if team !== null && art !== null}
            <TeamLogo
              manifest={art.manifest}
              franchiseId={team.franchiseId}
              teamExternalId={team.teamExternalId}
              className="h-3.5 w-3.5"
            />
          {/if}
          <span class="truncate uppercase"
            >{team?.abbreviation ?? franchiseAbbreviation(player.franchiseId)} ·
            {player.seasonKey}</span
          >
        </p>
      </div>
    </div>

    <div class="flex w-full flex-wrap items-center gap-1">
      <span
        class="rounded border px-1 py-0.5 font-mono text-[8px] font-bold uppercase tracking-[0.06em] {bucketClass(
          card.bucket,
        )}">{bucketLabel(card.bucket)}</span
      >
      <span
        class="rounded border border-line-soft bg-surface-1 px-1 py-0.5 font-mono text-[8px] font-bold uppercase tracking-[0.06em] text-muted-foreground"
        >{player.positions.join('/')}</span
      >
    </div>
  </div>

  <button
    type="button"
    class="mx-2 flex min-h-8 items-center justify-between gap-2 rounded border border-line-soft bg-surface-1 px-1.5 font-mono text-[8px] font-bold uppercase tracking-[0.07em] text-muted-foreground outline-none transition-colors hover:border-line-strong hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring sm:mx-2.5"
    aria-expanded={expanded}
    aria-controls={`${card.cardId}-playstyle`}
    onclick={() => (expanded = !expanded)}
  >
    <span>{expanded ? 'Playstyle' : 'Show playstyle'}</span>
    <ChevronDown
      size={11}
      class="shrink-0 transition-transform {expanded ? 'rotate-180' : ''}"
      aria-hidden="true"
    />
  </button>

  {#if expanded}
    <div id={`${card.cardId}-playstyle`} class="mx-2 mt-1.5 grid shrink-0 gap-2 sm:mx-2.5">
      <p
        class="w-full truncate font-mono text-[8px] font-bold uppercase tracking-[0.08em] text-accent"
      >
        {profile.archetype}
      </p>
      {#if chips.length > 0}
        <div class="flex w-full flex-wrap items-start gap-1">
          {#each chips as chip (chip.label)}
            <span
              class="shrink-0 rounded border px-1 py-0.5 font-mono text-[7.5px] leading-tight font-bold uppercase tracking-[0.04em] {chip.tone ===
              'good'
                ? 'border-positive/40 bg-positive/10 text-positive'
                : 'border-negative/45 bg-negative/10 text-negative'}">{chip.label}</span
            >
          {/each}
        </div>
      {/if}
      <button
        type="button"
        class="min-h-0 justify-self-center rounded border border-accent/40 bg-accent/10 px-2.5 py-1 font-mono text-[7.5px] leading-tight font-bold uppercase tracking-[0.07em] text-accent outline-none transition-colors hover:bg-accent/20 focus-visible:ring-2 focus-visible:ring-ring"
        onclick={() => openSheet('ratings')}
      >
        All attributes
      </button>
    </div>
  {/if}

  <div class="mx-2 mt-auto border-t border-line-soft py-1.5 sm:mx-2.5">
    <div class="flex items-baseline justify-between gap-1.5">
      <p
        class="font-display text-base leading-[1.2] font-extrabold tracking-tight tabular-nums sm:text-xl"
      >
        {formatMillions(card.salaryDollars)}
      </p>
      <span
        class="inline-flex shrink-0 rounded-full border px-1.5 py-0.5 font-mono text-[8px] font-bold uppercase tracking-[0.06em] {capStatusClass(
          status,
        )}"
      >
        <span class="sm:hidden">{capStatusShortLabel(status)}</span>
        <span class="hidden sm:inline">{capStatusLabel(status)}</span>
      </span>
    </div>
    {#if entry.signing.legal && entry.signing.projectedPayroll !== null}
      <p class="mt-1 font-mono text-[8px] leading-snug text-muted-foreground">
        Legal finish
        <span class="font-semibold text-foreground tabular-nums"
          >{formatMillions(entry.signing.projectedPayroll)}</span
        >
      </p>
    {/if}
  </div>

  {#if apronStrip !== null}
    <p
      class="mx-2 mb-1 rounded border border-accent/35 bg-accent/[0.08] px-1.5 py-1 font-mono text-[8px] font-bold uppercase leading-snug tracking-[0.03em] text-accent sm:mx-2.5"
    >
      {apronStrip}
    </p>
  {/if}

  {#if reason !== null}
    <p
      class="mx-2 mb-1 rounded border px-1.5 py-1 text-[9px] leading-snug sm:mx-2.5 {protectMode
        ? 'border-accent/30 bg-accent/5 text-accent'
        : 'border-line-soft bg-surface-1 text-muted-foreground'}"
    >
      {reason}
    </p>
  {/if}

  <div class="p-2 pt-0 sm:p-2.5">
    {#if protectMode}
      <button
        type="button"
        class="inline-flex min-h-10 w-full items-center justify-center rounded-lg border border-accent/60 bg-accent/10 px-2 py-1.5 text-xs font-bold text-accent outline-none transition-colors hover:bg-accent/20 focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
        {disabled}
        onclick={() => onProtect(card.cardId)}
      >
        Keep this card
      </button>
    {:else}
      <button
        type="button"
        class="inline-flex min-h-10 w-full items-center justify-center rounded-lg bg-primary px-2 py-1.5 text-xs font-bold text-primary-foreground outline-none transition-colors hover:bg-primary/90 focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-40"
        aria-label={`Sign ${player.displayName}`}
        disabled={!canSign}
        onclick={() => onSign(card.cardId)}
      >
        Sign
      </button>
    {/if}
  </div>

  <PlayerProfileSheet
    {profile}
    {apron}
    {face}
    manifest={art?.manifest ?? null}
    money={{
      salaryLabel: formatMillions(card.salaryDollars),
      statusLabel: capStatusLabel(status),
      note: entry.signing.legal ? 'Legal finish' : reason,
    }}
    tabs={['details', 'tendencies', 'ratings', 'apron']}
    bind:tab={sheetTab}
    open={sheetOpen}
    onOpenChange={(next) => (sheetOpen = next)}
  />
</article>
