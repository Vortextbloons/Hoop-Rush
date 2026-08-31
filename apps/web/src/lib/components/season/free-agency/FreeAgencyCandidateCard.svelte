<script lang="ts">
  import { Check, Minus, Plus } from '@lucide/svelte';
  import type {
    HoopRushManifest,
    SeasonFreeAgencyCandidate,
    SeasonFreeAgencyRoleExpectation,
  } from '@hoop-rush/data-contracts';
  import { formatPositions } from '$lib/player-positions';
  import type { SeasonFaceRef } from '$lib/season/season-branding';
  import { initialsOf } from '$lib/season/season-branding';
  import SeasonPlayerFace from '$lib/components/season/SeasonPlayerFace.svelte';
  import type { CandidateFitFacts, InterestedTeam } from './free-agency-view';
  import {
    FREE_AGENCY_BAND_BLURB,
    FREE_AGENCY_BAND_LABEL,
    ROLE_EXPECTATION_LABEL,
  } from './free-agency-view';
  const MAX_STRENGTHS = 4;
  const MAX_LIMITATIONS = 3;
  let {
    candidate,
    fit = null,
    isBestFit = false,
    interested = [],
    franchiseName,
    face = null,
    overallRating = null,
    manifest = null,
    priority = 0,
    role = null,
    influence = null,
    editable = false,
    disabled = false,
    canAddTarget = true,
    onToggleTarget,
    onPriorityChange,
    onRoleChange,
    onInfluenceChange,
  }: {
    candidate: SeasonFreeAgencyCandidate;
    fit?: CandidateFitFacts | null;
    isBestFit?: boolean;
    interested?: InterestedTeam[];
    franchiseName: (franchiseId: string) => string;
    face?: SeasonFaceRef | null;
    overallRating?: number | null;
    manifest?: HoopRushManifest | null;
    priority?: 0 | 1 | 2;
    role?: SeasonFreeAgencyRoleExpectation | null;
    influence?: number | null;
    editable?: boolean;
    disabled?: boolean;
    canAddTarget?: boolean;
    onToggleTarget: () => void;
    onPriorityChange: (priority: 0 | 1 | 2) => void;
    onRoleChange: (role: SeasonFreeAgencyRoleExpectation) => void;
    onInfluenceChange: (influence: number) => void;
  } = $props();
  const selected = $derived(priority !== 0);
  const effectiveInfluence = $derived(influence ?? candidate.minimumInfluence);
  const displayFace = $derived<SeasonFaceRef>(
    face ?? {
      playerId: candidate.playerId,
      playerExternalId: '',
      altIds: null,
      initials: initialsOf(candidate.displayName),
    },
  );
  let influenceDraft: string | null = $state(null);
  function onInputValue(raw: string) {
    influenceDraft = raw;
    const parsed = Number(raw);
    if (raw.trim() !== '' && !Number.isNaN(parsed)) {
      onInfluenceChange(Math.max(candidate.minimumInfluence, Math.min(3, Math.round(parsed))));
    }
  }
  function commitInfluence() {
    const raw = influenceDraft ?? String(effectiveInfluence);
    const parsed = Number(raw);
    influenceDraft = null;
    if (!Number.isNaN(parsed)) {
      onInfluenceChange(Math.max(candidate.minimumInfluence, Math.min(3, Math.round(parsed))));
    }
  }
  function stepInfluence(delta: number) {
    if (!editable || disabled || !selected) return;
    influenceDraft = null;
    const next = Math.max(candidate.minimumInfluence, Math.min(3, effectiveInfluence + delta));
    onInfluenceChange(next);
  }
</script>

<article
  data-fa-candidate-card
  data-fa-candidate-status={selected ? 'targeted' : 'available'}
  class="flex min-w-0 flex-col gap-3 rounded-none border border-border bg-surface-1 p-3 sm:rounded-xl sm:p-4 {selected
    ? 'border-primary/50 ring-1 ring-primary/30'
    : ''}"
>
  <div class="flex min-w-0 items-start gap-2.5">
    {#if manifest !== null}
      <SeasonPlayerFace face={displayFace} {manifest} size="sm" />
    {:else}
      <span
        class="grid h-9 w-9 shrink-0 place-items-center rounded-md bg-surface-3 font-display text-xs font-extrabold text-muted-foreground"
        aria-hidden="true"
      >
        ?
      </span>
    {/if}
    <div class="min-w-0 flex-1">
      <div class="flex min-w-0 items-center gap-1.5">
        <h4 class="truncate text-sm font-bold leading-snug">{candidate.displayName}</h4>
        {#if overallRating !== null}
          <span
            class="shrink-0 rounded bg-surface-3 px-1.5 py-0.5 font-mono text-[10px] font-bold"
            data-fa-overall
            title="Packaged summary Overall (report only)"
          >
            OVR {overallRating}
          </span>
        {/if}
      </div>
      <p class="mt-0.5 font-mono text-[10px] leading-snug text-muted-foreground">
        {formatPositions(candidate.positions.playable)}
      </p>
    </div>
    <div class="flex shrink-0 flex-col items-end gap-1">
      <span
        class="rounded-full px-2 py-0.5 font-mono text-[10px] font-bold uppercase tracking-[0.1em] {candidate.band ===
        'featured'
          ? 'bg-primary/15 text-primary'
          : 'bg-surface-3 text-muted-foreground'}"
        data-fa-band
      >
        {FREE_AGENCY_BAND_LABEL[candidate.band]}
      </span>
      {#if fit !== null}
        <span
          class="rounded-full bg-surface-3 px-2 py-0.5 font-mono text-[10px] font-bold text-muted-foreground"
          data-fa-fit-badge
        >
          Need: {fit.needTier}
        </span>
      {/if}
    </div>
  </div>

  {#if isBestFit}
    <p
      class="rounded-lg bg-primary/10 px-2.5 py-1.5 text-xs font-semibold text-primary"
      data-fa-best-fit
    >
      <Check class="mr-1 inline h-3.5 w-3.5" />
      Best fit for your rotation
    </p>
  {/if}

  <dl class="flex flex-col gap-1.5">
    <div class="flex flex-wrap items-center gap-x-2 gap-y-0.5">
      <dt class="font-mono text-[9px] font-bold tracking-[0.12em] text-muted-foreground uppercase">
        {FREE_AGENCY_BAND_LABEL[candidate.band]}
      </dt>
      <dd class="text-xs text-muted-foreground">{FREE_AGENCY_BAND_BLURB[candidate.band]}</dd>
    </div>
    <div class="flex flex-wrap items-center gap-x-2 gap-y-0.5">
      <dt class="font-mono text-[9px] font-bold tracking-[0.12em] text-muted-foreground uppercase">
        Expected role
      </dt>
      <dd class="flex flex-wrap gap-1">
        {#each candidate.supportedRoles as supportedRole (supportedRole)}
          <span
            class="rounded bg-surface-3 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-foreground"
          >
            {ROLE_EXPECTATION_LABEL[supportedRole]}
          </span>
        {/each}
      </dd>
    </div>
    <div class="flex flex-wrap items-center gap-x-2 gap-y-0.5">
      <dt class="font-mono text-[9px] font-bold tracking-[0.12em] text-muted-foreground uppercase">
        Minutes
      </dt>
      <dd class="font-mono text-xs font-semibold text-foreground">
        {candidate.minutesPerGame.toFixed(1)} mpg
      </dd>
      <dt
        class="ml-2 font-mono text-[9px] font-bold tracking-[0.12em] text-muted-foreground uppercase"
      >
        Durability
      </dt>
      <dd class="font-mono text-xs font-semibold text-foreground">{candidate.durabilityRating}</dd>
      <dt
        class="ml-2 font-mono text-[9px] font-bold tracking-[0.12em] text-muted-foreground uppercase"
      >
        Availability
      </dt>
      <dd
        class="text-xs {candidate.availability.healthy
          ? 'text-positive'
          : 'text-amber-600 dark:text-amber-400'}"
      >
        {candidate.availability.healthy
          ? 'Healthy'
          : candidate.availability.notes || 'Limited availability'}
      </dd>
    </div>
  </dl>

  <div class="grid gap-2 sm:grid-cols-2">
    <div class="min-w-0">
      <p class="font-mono text-[9px] font-bold tracking-[0.12em] text-muted-foreground uppercase">
        Strengths
      </p>
      <ul class="mt-1 flex flex-col gap-0.5">
        {#each candidate.strengths.slice(0, MAX_STRENGTHS) as strength (strength)}
          <li class="text-xs leading-snug text-muted-foreground">
            <span class="mr-1 text-positive" aria-hidden="true">+</span>{strength}
          </li>
        {/each}
        {#if candidate.strengths.length > MAX_STRENGTHS}
          <li class="font-mono text-[9px] text-muted-foreground/70">
            +{candidate.strengths.length - MAX_STRENGTHS} more
          </li>
        {/if}
      </ul>
    </div>
    <div class="min-w-0">
      <p class="font-mono text-[9px] font-bold tracking-[0.12em] text-muted-foreground uppercase">
        Limitations
      </p>
      <ul class="mt-1 flex flex-col gap-0.5">
        {#each candidate.limitations.slice(0, MAX_LIMITATIONS) as limitation (limitation)}
          <li class="text-xs leading-snug text-muted-foreground">
            <span class="mr-1 text-destructive" aria-hidden="true">–</span>{limitation}
          </li>
        {/each}
        {#if candidate.limitations.length > MAX_LIMITATIONS}
          <li class="font-mono text-[9px] text-muted-foreground/70">
            +{candidate.limitations.length - MAX_LIMITATIONS} more
          </li>
        {/if}
      </ul>
    </div>
  </div>

  {#if fit !== null}
    <div class="flex flex-wrap items-center gap-2">
      <span
        class="rounded bg-surface-3 px-2 py-0.5 font-mono text-[10px] font-bold text-foreground"
      >
        Opportunity: {fit.opportunity}
      </span>
      {#if interested.length > 0}
        <span class="font-mono text-[10px] text-muted-foreground">
          {interested.length}
          {interested.length === 1 ? 'team' : 'teams'} interested
        </span>
      {/if}
    </div>
  {/if}

  {#if interested.length > 0}
    <div class="min-w-0">
      <p class="font-mono text-[9px] font-bold tracking-[0.12em] text-muted-foreground uppercase">
        Interested
      </p>
      <p class="mt-0.5 text-xs leading-snug text-muted-foreground" data-fa-interest>
        {interested
          .slice(0, 3)
          .map((team) => franchiseName(team.franchiseId))
          .join(', ')}
        {#if interested.length > 3}
          <span class="text-muted-foreground/70">+{interested.length - 3} more</span>
        {/if}
      </p>
    </div>
  {/if}

  <div class="mt-auto flex flex-col gap-2 border-t border-border/50 pt-2.5">
    {#if editable}
      <button
        type="button"
        data-fa-candidate-target
        aria-pressed={selected}
        onclick={onToggleTarget}
        disabled={disabled || (!selected && !canAddTarget)}
        class="inline-flex min-h-10 items-center justify-center rounded-lg px-3 py-1.5 text-sm font-semibold outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-40 {selected
          ? 'bg-primary text-primary-foreground'
          : 'bg-surface-2 text-foreground hover:bg-surface-3'}"
      >
        {selected ? 'Remove target' : 'Target'}
      </button>
    {/if}
    <div class="flex items-center gap-2">
      <label class="sr-only" for="fa-priority-{candidate.playerVersionId}">
        Target {candidate.displayName} as
      </label>
      <select
        id="fa-priority-{candidate.playerVersionId}"
        data-fa-candidate-priority
        disabled={!editable || disabled}
        bind:value={
          () => priority,
          (next) => onPriorityChange((typeof next === 'number' ? next : Number(next)) as 0 | 1 | 2)
        }
        class="min-h-10 min-w-0 flex-1 rounded-lg bg-surface-2 px-2 py-1.5 text-sm font-semibold outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-40"
      >
        <option value={0}>Not targeting</option>
        <option value={1}>First priority</option>
        <option value={2}>Second priority</option>
      </select>
    </div>

    {#if selected}
      <div class="flex flex-col gap-2 sm:flex-row sm:items-center">
        <label class="sr-only" for="fa-role-{candidate.playerVersionId}">
          Role expectation for {candidate.displayName}
        </label>
        <select
          id="fa-role-{candidate.playerVersionId}"
          value={role ?? candidate.supportedRoles[0]}
          data-fa-candidate-role
          disabled={!editable || disabled}
          onchange={(event) =>
            onRoleChange(
              (event.currentTarget as HTMLSelectElement).value as SeasonFreeAgencyRoleExpectation,
            )}
          class="min-h-10 min-w-0 flex-1 rounded-lg bg-surface-2 px-2 py-1.5 text-sm font-semibold outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-40"
        >
          {#each candidate.supportedRoles as supportedRole (supportedRole)}
            <option value={supportedRole}>{ROLE_EXPECTATION_LABEL[supportedRole]}</option>
          {/each}
        </select>
        <div
          class="flex shrink-0 items-center gap-1"
          role="group"
          aria-label={`Influence commitment for ${candidate.displayName}`}
        >
          <button
            type="button"
            aria-label={`Lower Influence for ${candidate.displayName}`}
            data-fa-influence-down
            onclick={() => stepInfluence(-1)}
            disabled={!editable || disabled || effectiveInfluence <= candidate.minimumInfluence}
            class="grid h-10 w-10 place-items-center rounded-lg bg-surface-2 text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring hover:bg-surface-3 disabled:cursor-not-allowed disabled:opacity-40"
          >
            <Minus class="h-4 w-4" />
          </button>
          <input
            type="number"
            value={influenceDraft ?? String(effectiveInfluence)}
            min={candidate.minimumInfluence}
            max={3}
            step={1}
            inputmode="numeric"
            aria-label={`Influence commitment for ${candidate.displayName}`}
            data-fa-influence-input
            disabled={!editable || disabled}
            oninput={(event) => onInputValue((event.currentTarget as HTMLInputElement).value)}
            onchange={commitInfluence}
            onblur={commitInfluence}
            class="h-10 w-14 rounded-md bg-surface-2 px-1 text-center font-mono text-sm font-bold tabular-nums outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-40"
          />
          <button
            type="button"
            aria-label={`Raise Influence for ${candidate.displayName}`}
            data-fa-influence-up
            onclick={() => stepInfluence(1)}
            disabled={!editable || disabled || effectiveInfluence >= 3}
            class="grid h-10 w-10 place-items-center rounded-lg bg-surface-2 text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring hover:bg-surface-3 disabled:cursor-not-allowed disabled:opacity-40"
          >
            <Plus class="h-4 w-4" />
          </button>
        </div>
      </div>
      <p class="font-mono text-[9px] text-muted-foreground/70">
        Minimum {String(candidate.minimumInfluence)} · paid only if this target wins
      </p>
    {/if}
  </div>
</article>
