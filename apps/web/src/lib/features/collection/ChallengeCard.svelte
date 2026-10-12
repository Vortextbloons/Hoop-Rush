<script lang="ts">
  import { resolve } from '$app/paths';
  import type { CollectionChallengeValidationFacts } from '@hoop-rush/data-contracts';
  import type { ChallengeCardView } from './collection-progression-view.ts';

  let {
    view,
    facts,
    difficultyLabel,
    teamPath,
    selected = false,
    onSelect,
  }: {
    view: ChallengeCardView;
    facts: CollectionChallengeValidationFacts;
    difficultyLabel: string;
    teamPath: string;
    selected?: boolean;
    onSelect: (challengeId: string) => void;
  } = $props();
</script>

<li
  class="flex min-w-0 flex-col rounded-2xl border-2 p-4 {selected
    ? 'border-accent'
    : 'border-border'} bg-card"
>
  <div class="flex flex-wrap items-start justify-between gap-2">
    <div class="min-w-0">
      <h3 class="font-display text-lg font-extrabold">{view.displayName}</h3>
      <p class="text-xs text-muted-foreground">{view.description}</p>
    </div>
    <span
      class="shrink-0 rounded-full px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide {view.cleared
        ? 'bg-surface-3 text-muted-foreground'
        : view.eligible
          ? 'bg-positive/20 text-positive'
          : 'bg-surface-3 text-muted-foreground'}"
    >
      {view.cleared ? 'Cleared' : view.eligible ? 'Eligible' : 'Not eligible'}
    </span>
  </div>

  <p class="mt-2 text-sm">
    <span class="font-semibold">Requirement:</span>
    {view.requirementLabel}
  </p>
  <p class="mt-1 text-sm">
    <span class="font-semibold">Difficulty:</span>
    {difficultyLabel} · fixed by the challenge
  </p>
  <p class="mt-1 text-sm tabular-nums">
    <span class="font-semibold">Team progress:</span>
    {view.progressLabel}
  </p>
  <p class="mt-1 text-sm">
    <span class="font-semibold">First clear:</span>
    {view.cleared ? 'claimed' : `${view.firstClearCoins} Coins`}
    · <span class="font-semibold">Repeat win:</span>
    {view.repeatWinCoins} Coins
  </p>
  <p class="mt-1 text-xs text-muted-foreground">{view.statusLabel}</p>

  {#if !view.eligible}
    <p class="mt-2 text-sm font-semibold text-destructive">{view.reason}</p>
  {/if}

  <details class="mt-3 rounded-xl bg-surface-2 p-3 text-xs">
    <summary
      class="cursor-pointer font-semibold outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      Full requirement facts
    </summary>
    <dl class="mt-2 grid gap-1 sm:grid-cols-2">
      <div class="flex justify-between gap-2">
        <dt class="text-muted-foreground">Challenge ID</dt>
        <dd class="font-mono">{facts.challengeId}</dd>
      </div>
      <div class="flex justify-between gap-2">
        <dt class="text-muted-foreground">Committed team legal</dt>
        <dd>{facts.teamValid ? 'Yes' : 'No'}</dd>
      </div>
      <div class="flex justify-between gap-2">
        <dt class="text-muted-foreground">Matching active cards</dt>
        <dd class="tabular-nums">{facts.rosterCount} / {facts.requiredRosterCount} required</dd>
      </div>
      <div class="flex justify-between gap-2">
        <dt class="text-muted-foreground">Matching starters</dt>
        <dd class="tabular-nums">{facts.starterCount} / {facts.requiredStarterCount} required</dd>
      </div>
      <div class="flex justify-between gap-2">
        <dt class="text-muted-foreground">Matching card IDs</dt>
        <dd class="truncate font-mono">
          {facts.matchingCardIds.length === 0 ? 'none' : facts.matchingCardIds.join(', ')}
        </dd>
      </div>
      <div class="flex justify-between gap-2">
        <dt class="text-muted-foreground">Team issues</dt>
        <dd class="truncate font-mono">
          {facts.teamIssueCodes.length === 0 ? 'none' : facts.teamIssueCodes.join(', ')}
        </dd>
      </div>
    </dl>
  </details>

  <div class="mt-3">
    {#if view.eligible}
      <button
        type="button"
        onclick={() => onSelect(view.challengeId)}
        aria-pressed={selected}
        class="min-h-11 rounded-xl bg-accent px-4 py-2 text-sm font-bold text-accent-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        {selected ? 'Objective selected' : 'Choose objective'}
      </button>
    {:else}
      <a
        href={resolve(teamPath as any)}
        class="inline-flex min-h-11 items-center rounded-xl bg-surface-2 px-4 py-2 text-sm font-semibold outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        Edit team
      </a>
    {/if}
  </div>
</li>
