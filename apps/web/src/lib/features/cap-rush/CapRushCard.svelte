<script lang="ts">
  import type { CapRushCardView } from '@hoop-rush/application/cap-rush';
  import { franchiseAbbreviation } from '@hoop-rush/data-contracts';
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
    if (protectMode) return 'Keep this card and reroll the other seven';
    if (entry.signing.legal) return null;
    switch (entry.signing.reason) {
      case 'hard-limit':
        return `Past the $150M limit by ${formatMillions(entry.signing.payrollAfterSigning - 150_000_000)}`;
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
  class="group flex min-w-0 flex-col overflow-hidden rounded-xl border bg-card transition-colors sm:rounded-2xl {protectMode
    ? 'border-dashed border-accent/70'
    : entry.signing.legal
      ? 'border-border hover:border-line-strong'
      : 'border-border/70 opacity-80'}"
  data-card-id={card.cardId}
  data-legal={entry.signing.legal}
>
  <div class="flex items-start gap-2 p-2.5 sm:gap-2.5 sm:p-3.5">
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
      <div class="flex items-center gap-1">
        <h3 class="truncate font-display text-sm leading-tight font-extrabold">
          {player.displayName}
        </h3>
        <span
          class="shrink-0 rounded bg-surface-2 px-1 py-0.5 font-mono text-[9px] font-bold tabular-nums sm:hidden"
          aria-label={`Overall ${String(player.originalOverall)}`}>{player.originalOverall}</span
        >
      </div>
      <p class="mt-0.5 flex min-w-0 items-center gap-1 font-mono text-[9px] text-muted-foreground">
        {#if team !== null && art !== null}
          <TeamLogo
            manifest={art.manifest}
            franchiseId={team.franchiseId}
            teamExternalId={team.teamExternalId}
            className="h-4 w-4"
          />
        {/if}
        <span class="truncate uppercase"
          >{team?.abbreviation ?? franchiseAbbreviation(player.franchiseId)} ·
          {player.seasonKey}</span
        >
      </p>
    </div>
    <span
      class="hidden shrink-0 flex-col items-center rounded-md bg-surface-2 px-1.5 py-1 sm:flex"
      aria-label={`Overall ${String(player.originalOverall)}`}
    >
      <span class="font-mono text-[7px] font-bold tracking-[0.08em] text-muted-foreground uppercase"
        >OVR</span
      >
      <span class="font-display text-base leading-none font-extrabold"
        >{player.originalOverall}</span
      >
    </span>
  </div>

  <div class="flex flex-wrap gap-1 px-2.5 sm:px-3.5">
    <span
      class="rounded border px-1.5 py-0.5 font-mono text-[8px] font-bold tracking-[0.08em] uppercase {bucketClass(
        card.bucket,
      )}">{bucketLabel(card.bucket)}</span
    >
    <span
      class="rounded border border-line-soft bg-surface-1 px-1.5 py-0.5 font-mono text-[8px] font-bold tracking-[0.08em] text-muted-foreground uppercase"
      >{player.positions.join('/')}</span
    >
  </div>

  <div
    class="mx-2.5 mt-2 flex items-end justify-between gap-2 border-t border-line-soft py-2 sm:mx-3.5"
  >
    <div class="min-w-0">
      <p class="font-mono text-[8px] tracking-[0.1em] text-muted-foreground uppercase">Salary</p>
      <p class="font-display text-lg font-extrabold tracking-tight tabular-nums sm:text-2xl">
        {formatMillions(card.salaryDollars)}
      </p>
    </div>
    <div class="shrink-0 text-right">
      <span
        class="inline-flex rounded-full border px-1.5 py-0.5 font-mono text-[8px] font-bold tracking-[0.06em] uppercase {capStatusClass(
          projectedStatus,
        )}"
      >
        <span class="sm:hidden">{capStatusShortLabel(projectedStatus)}</span>
        <span class="hidden sm:inline">{capStatusLabel(projectedStatus)}</span>
      </span>
      <p class="mt-0.5 font-mono text-[9px] text-muted-foreground tabular-nums">
        {formatMillions(entry.signing.payrollAfterSigning)}
      </p>
    </div>
  </div>

  {#if entry.signing.legal && entry.signing.projectedPayroll !== null}
    <p class="px-2.5 pb-1 font-mono text-[9px] text-muted-foreground sm:px-3.5">
      Legal finish
      <span class="font-semibold text-foreground tabular-nums"
        >{formatMillions(entry.signing.projectedPayroll)}</span
      >
    </p>
  {/if}

  {#if projectedImpact.length > 0}
    <p class="line-clamp-2 px-2.5 pb-1.5 text-[10px] leading-snug text-muted-foreground sm:px-3.5">
      <span class="font-semibold text-foreground">Apron:</span>
      {projectedImpact
        .slice(0, 3)
        .map((row) => `${row.label} ${row.original}→${row.effective}`)
        .join(' · ')}
    </p>
  {/if}

  {#if reason !== null}
    <p
      class="mx-2.5 mb-1.5 rounded border px-1.5 py-1 text-[10px] leading-snug sm:mx-3.5 {protectMode
        ? 'border-accent/30 bg-accent/5 text-accent'
        : 'border-line-soft bg-surface-1 text-muted-foreground'}"
    >
      {reason}
    </p>
  {/if}

  <details class="order-2 mx-2.5 mb-1.5 rounded bg-surface-1 px-2 sm:mx-3.5 md:order-1">
    <summary
      class="cursor-pointer py-1.5 font-mono text-[9px] font-bold tracking-[0.08em] text-muted-foreground uppercase outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      Attributes<span class="hidden sm:inline"> &amp; apron preview</span>
    </summary>
    <dl class="grid grid-cols-3 gap-1 pb-2">
      {#each KEY_RATING_FIELDS as [field, label] (field)}
        <div class="rounded bg-background/60 px-1 py-0.5">
          <dt class="truncate text-[8px] text-muted-foreground">{label}</dt>
          <dd class="text-[10px] font-bold tabular-nums">{ratings[field]}</dd>
        </div>
      {/each}
    </dl>
    <div class="grid gap-2 pb-2 sm:grid-cols-2">
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

  <div class="order-1 p-2.5 pt-0 sm:p-3.5 md:order-2 md:mt-auto">
    {#if protectMode}
      <button
        type="button"
        class="inline-flex min-h-10 w-full items-center justify-center rounded-lg border border-accent/60 bg-accent/10 px-2 py-1.5 text-xs font-bold text-accent outline-none transition-colors hover:bg-accent/20 focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50 sm:min-h-11 sm:text-sm"
        {disabled}
        onclick={() => onProtect(card.cardId)}
      >
        Keep this card
      </button>
    {:else}
      <button
        type="button"
        class="inline-flex min-h-10 w-full items-center justify-center rounded-lg bg-primary px-2 py-1.5 text-xs font-bold text-primary-foreground outline-none transition-colors hover:bg-primary/90 focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-40 sm:min-h-11 sm:text-sm"
        disabled={!canSign}
        onclick={() => onSign(card.cardId)}
      >
        <span class="sm:hidden">Sign</span>
        <span class="hidden truncate sm:inline">Sign {player.displayName}</span>
      </button>
    {/if}
  </div>
</article>
