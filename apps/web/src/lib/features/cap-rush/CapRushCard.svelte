<script lang="ts">
  import type { CapRushCardView } from '@hoop-rush/application/cap-rush';
  import { franchiseAbbreviation, CAP_RUSH_HARD_LIMIT_DOLLARS } from '@hoop-rush/data-contracts';
  import { capRushPayrollStatus } from '@hoop-rush/engine';
  import PlayerFace from '#lib/components/PlayerFace.svelte';
  import TeamLogo from '#lib/components/TeamLogo.svelte';
  import type { CapRushArt } from './cap-rush-art.ts';
  import {
    apronImpact,
    bucketClass,
    bucketLabel,
    capStatusClass,
    capStatusLabel,
    capStatusShortLabel,
    formatMillions,
    initialsOf,
    KEY_RATING_FIELDS,
  } from './cap-rush-presentation.ts';

  let {
    entry,
    protectMode = false,
    disabled = false,
    art = null,
    onSign,
    onProtect,
  }: {
    entry: CapRushCardView;
    protectMode?: boolean;
    disabled?: boolean;
    art?: CapRushArt | null;
    onSign: (cardId: string) => void;
    onProtect: (cardId: string) => void;
  } = $props();

  const card = $derived(entry.card);
  const player = $derived(card.source);
  const ratings = $derived(player.profile.ratings);
  const face = $derived(art !== null ? art.faceFor(player) : null);
  const team = $derived(art !== null ? art.teamFor(player.franchiseId) : null);
  const projectedStatus = $derived(capRushPayrollStatus(entry.signing.payrollAfterSigning));
  const projectedImpact = $derived(
    apronImpact(ratings, projectedStatus).filter((row) => row.reduction > 0),
  );
  const firstImpact = $derived(apronImpact(ratings, 'first-apron'));
  const secondImpact = $derived(apronImpact(ratings, 'second-apron'));
  const initials = $derived(initialsOf(player.displayName));
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
>
  <div class="flex items-start gap-2 p-2 sm:p-2.5">
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
        <h3 class="min-w-0 truncate font-display text-xs leading-tight font-extrabold sm:text-sm">
          {player.displayName}
        </h3>
        <span
          class="shrink-0 font-mono text-[10px] font-bold text-muted-foreground tabular-nums"
          aria-label={`Overall ${String(player.originalOverall)}`}>{player.originalOverall}</span
        >
      </div>
      <p class="mt-0.5 flex min-w-0 items-center gap-1 font-mono text-[8px] text-muted-foreground">
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

  <div class="flex flex-wrap gap-1 px-2 sm:px-2.5">
    <span
      class="rounded border px-1 py-0.5 font-mono text-[8px] font-bold tracking-[0.06em] uppercase {bucketClass(
        card.bucket,
      )}">{bucketLabel(card.bucket)}</span
    >
    <span
      class="rounded border border-line-soft bg-surface-1 px-1 py-0.5 font-mono text-[8px] font-bold tracking-[0.06em] text-muted-foreground uppercase"
      >{player.positions.join('/')}</span
    >
  </div>

  <div class="mx-2 mt-1.5 border-t border-line-soft py-1.5 sm:mx-2.5">
    <div class="flex items-baseline justify-between gap-1.5">
      <p
        class="font-display text-base leading-none font-extrabold tracking-tight tabular-nums sm:text-xl"
      >
        {formatMillions(card.salaryDollars)}
      </p>
      <span
        class="inline-flex shrink-0 rounded-full border px-1.5 py-0.5 font-mono text-[8px] font-bold tracking-[0.06em] uppercase {capStatusClass(
          projectedStatus,
        )}"
      >
        <span class="sm:hidden">{capStatusShortLabel(projectedStatus)}</span>
        <span class="hidden sm:inline">{capStatusLabel(projectedStatus)}</span>
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

  {#if projectedImpact.length > 0}
    <p class="line-clamp-2 px-2 pb-1 text-[9px] leading-snug text-muted-foreground sm:px-2.5">
      <span class="font-semibold text-foreground">Apron:</span>
      {projectedImpact
        .slice(0, 3)
        .map((row) => `${row.label} ${row.original}→${row.effective}`)
        .join(' · ')}
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

  <details class="mx-2 mb-1 rounded bg-surface-1 px-1.5 sm:mx-2.5">
    <summary
      class="flex min-h-8 cursor-pointer items-center py-1 font-mono text-[9px] font-bold tracking-[0.08em] text-muted-foreground uppercase outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      Attributes<span class="hidden sm:inline"> &amp; apron preview</span>
    </summary>
    <dl class="grid grid-cols-2 gap-1 pb-1.5 sm:grid-cols-3">
      {#each KEY_RATING_FIELDS as [field, label] (field)}
        <div class="rounded bg-background/60 px-1 py-0.5">
          <dt class="truncate text-[8px] text-muted-foreground">{label}</dt>
          <dd class="text-[10px] font-bold tabular-nums">{ratings[field]}</dd>
        </div>
      {/each}
    </dl>
    <div class="grid gap-1.5 pb-1.5 sm:grid-cols-2">
      {#each [{ title: 'First apron', rows: firstImpact }, { title: 'Second apron', rows: secondImpact }] as tier (tier.title)}
        <div>
          <p
            class="font-mono text-[8px] font-bold tracking-[0.08em] text-muted-foreground uppercase"
          >
            {tier.title}
          </p>
          <ul class="mt-0.5 space-y-0.5">
            {#each tier.rows as row (row.label)}
              <li class="flex justify-between gap-1 text-[9px]">
                <span class="truncate text-muted-foreground">{row.label}</span>
                <span class="shrink-0 font-mono tabular-nums"
                  >{row.original}<span class="text-muted-foreground">→</span><span
                    class="font-bold text-primary">{row.effective}</span
                  ></span
                >
              </li>
            {/each}
          </ul>
        </div>
      {/each}
    </div>
  </details>

  <div class="mt-auto p-2 pt-0 sm:p-2.5">
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
</article>
