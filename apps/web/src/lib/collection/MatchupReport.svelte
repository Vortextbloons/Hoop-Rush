<script lang="ts">
  import type {
    CollectionCatalog,
    CollectionPreparedGameV2,
    CollectionPreparedGameV3,
  } from '@hoop-rush/data-contracts';
  import { formatMultiplier, objectiveConditionLabel, ratingLabel } from './collection-setup.ts';
  import { requirementLabel } from './collection-progression-view.ts';

  let {
    prepared,
    catalog,
  }: {
    prepared: CollectionPreparedGameV2 | CollectionPreparedGameV3;
    catalog: CollectionCatalog;
  } = $props();

  const challenge = $derived(
    prepared.gameVersion === 'collection-game-v3' ? prepared.challenge : null,
  );

  const cardById = $derived(new Map(catalog.cards.map((card) => [card.cardId, card])));
  const minutesById = $derived(
    new Map(prepared.construction.targetMinutes.map((entry) => [entry.cardId, entry.minutes])),
  );
  const closingFive = $derived(new Set(prepared.construction.closingFive));
  const cpuRoster = $derived([...prepared.construction.starters, ...prepared.construction.bench]);
  const chosenScoreMillionths = $derived(
    prepared.construction.candidates[prepared.construction.chosenCandidateIndex]?.score
      .rosterScoreMillionths ?? null,
  );
  const selectedOffer = $derived(
    prepared.objectives.offers.find(
      (offer) => offer.objectiveId === prepared.objectives.selectedObjectiveId,
    ) ?? null,
  );

  function nameOf(cardId: string): string {
    return cardById.get(cardId)?.displayName ?? 'Unknown card';
  }

  function overallOf(cardId: string): number | null {
    return cardById.get(cardId)?.summarySource?.overallRating ?? null;
  }

  function rarityClassOf(cardId: string): string {
    const rarity = cardById.get(cardId)?.rarity.toLowerCase() ?? '';
    return `ur-rarity ur-rarity-${rarity}`;
  }
</script>

<section aria-label="Declared matchup" class="mt-4 rounded-2xl border border-accent/50 bg-card p-5">
  <div class="flex flex-wrap items-end justify-between gap-2">
    <div>
      <p class="ultimate-eyebrow">Declared matchup</p>
      <h2 class="font-display text-xl font-extrabold">
        {challenge ? `Challenge · ${challenge.displayName}` : 'Matchup ready'}
      </h2>
      {#if challenge}
        <p class="mt-1 text-sm text-muted-foreground">
          {requirementLabel(challenge.requirement)} · snapshotted from the committed team before tip-off
        </p>
      {/if}
    </div>
    <p class="font-mono text-xs font-bold tracking-[0.12em] text-muted-foreground uppercase">
      Locked until abandoned
    </p>
  </div>

  {#if challenge}
    <dl class="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <div class="rounded-xl bg-surface-2 p-3">
        <dt class="text-xs text-muted-foreground">Challenge first clear</dt>
        <dd class="font-bold">
          {challenge.firstClearEligible ? 'Available' : 'Already claimed'}
        </dd>
        <dd class="text-xs text-muted-foreground tabular-nums">
          {challenge.firstClearCoins} Coins on the first completed win
        </dd>
      </div>
      <div class="rounded-xl bg-surface-2 p-3">
        <dt class="text-xs text-muted-foreground">Challenge repeat win</dt>
        <dd class="font-bold tabular-nums">{challenge.repeatWinCoins} Coins</dd>
        <dd class="text-xs text-muted-foreground">Applies once the challenge has been cleared</dd>
      </div>
      <div class="rounded-xl bg-surface-2 p-3">
        <dt class="text-xs text-muted-foreground">Snapshotted roster facts</dt>
        <dd class="font-bold tabular-nums">
          {challenge.validation.rosterCount}/{challenge.validation.requiredRosterCount} active
        </dd>
        <dd class="text-xs text-muted-foreground tabular-nums">
          {challenge.validation.starterCount}/{challenge.validation.requiredStarterCount} starters · team
          {challenge.validation.teamValid ? 'legal' : 'illegal'}
        </dd>
      </div>
      <div class="rounded-xl bg-surface-2 p-3">
        <dt class="text-xs text-muted-foreground">Challenge ID</dt>
        <dd class="truncate font-mono text-xs">{challenge.challengeId}</dd>
        <dd class="text-xs text-muted-foreground">
          Fixed {challenge.difficultyId} difficulty
        </dd>
      </div>
    </dl>
  {/if}

  <dl class="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
    <div class="rounded-xl bg-surface-2 p-3">
      <dt class="text-xs text-muted-foreground">Difficulty</dt>
      <dd class="font-display text-base font-extrabold">{prepared.difficulty.displayName}</dd>
      <dd class="text-xs text-muted-foreground">
        Rewards {formatMultiplier(prepared.difficulty.rewardMultiplierBp)} · CPU shift
        {prepared.difficulty.ratingShift > 0 ? '+' : ''}{prepared.difficulty.ratingShift}
      </dd>
    </div>
    <div class="rounded-xl bg-surface-2 p-3">
      <dt class="text-xs text-muted-foreground">CPU identity</dt>
      <dd class="font-bold">{prepared.construction.identity}</dd>
      <dd class="text-xs text-muted-foreground">
        Candidate {prepared.construction.chosenCandidateIndex + 1} of {prepared.construction
          .candidateCount}
        {chosenScoreMillionths === null
          ? ''
          : `· roster score ${(chosenScoreMillionths / 1_000_000).toFixed(2)}`}
      </dd>
    </div>
    <div class="rounded-xl bg-surface-2 p-3">
      <dt class="text-xs text-muted-foreground">CPU roster</dt>
      <dd class="font-bold">{cpuRoster.length} cards</dd>
      <dd class="text-xs text-muted-foreground tabular-nums">
        {prepared.construction.rarityCounts.Ember} Ember · {prepared.construction.rarityCounts
          .Eruption} Eruption · {prepared.construction.rarityCounts.Apex} Apex · {prepared
          .construction.rarityCounts.Titan} Titan · {prepared.construction.rarityCounts.Eclipse} Eclipse
        · {prepared.construction.rarityCounts.Immortal} Immortal · {prepared.construction
          .specialCount} special
      </dd>
    </div>
    <div class="rounded-xl bg-surface-2 p-3">
      <dt class="text-xs text-muted-foreground">First clear</dt>
      <dd class="font-bold">
        {prepared.firstClearEligible ? 'Available' : 'Already claimed'}
      </dd>
      <dd class="text-xs text-muted-foreground">
        {prepared.firstClearEligible
          ? 'A win claims this difficulty first-clear bonus.'
          : 'This game cannot claim a first-clear bonus.'}
      </dd>
    </div>
  </dl>

  <div class="mt-4 rounded-xl bg-surface-2 p-4">
    <h3 class="text-sm font-bold">Selected objective</h3>
    {#if selectedOffer && prepared.objectives.selectedObjectiveId !== null}
      <p class="mt-1 text-sm font-semibold">{selectedOffer.title}</p>
      <p class="text-xs text-muted-foreground">
        {objectiveConditionLabel(selectedOffer.condition)}
      </p>
    {:else}
      <p class="mt-1 text-sm text-muted-foreground">
        No objective. Only the outcome, margin, and first-clear rewards apply.
      </p>
    {/if}
  </div>

  <div class="mt-4 grid gap-4 lg:grid-cols-2">
    <div>
      <h3 class="text-sm font-bold">Your starters</h3>
      <ul class="mt-2 space-y-1 text-sm">
        {#each prepared.playerTeam.starters as cardId (cardId)}
          <li class="flex items-center justify-between gap-2 rounded-lg bg-surface-2 px-3 py-2">
            <span>{nameOf(cardId)}</span>
            <span class="text-xs text-muted-foreground tabular-nums">
              {overallOf(cardId) === null ? '' : `Overall ${overallOf(cardId)}`}
            </span>
          </li>
        {/each}
      </ul>
    </div>
    <div>
      <h3 class="text-sm font-bold">CPU roster</h3>
      <ul class="mt-2 space-y-1 text-sm">
        {#each cpuRoster as cardId (cardId)}
          <li class="flex items-center justify-between gap-2 rounded-lg bg-surface-2 px-3 py-2">
            <span class="flex items-center gap-2">
              <span class="{rarityClassOf(cardId)} rounded px-1.5 py-0.5 text-[10px] font-bold">
                {cardById.get(cardId)?.rarity ?? '—'}
              </span>
              <span>{nameOf(cardId)}</span>
              {#if prepared.construction.starters.includes(cardId)}
                <span class="text-[10px] font-bold tracking-wide text-muted-foreground uppercase">
                  starter
                </span>
              {/if}
              {#if closingFive.has(cardId)}
                <span class="text-[10px] font-bold tracking-wide text-accent uppercase">closer</span
                >
              {/if}
            </span>
            <span class="text-xs text-muted-foreground tabular-nums">
              {minutesById.get(cardId) ?? 0} min
            </span>
          </li>
        {/each}
      </ul>
    </div>
  </div>

  <div class="mt-4 rounded-xl border border-border bg-surface-2 p-4">
    <h3 class="text-sm font-bold">Declared CPU rating adjustment</h3>
    {#if prepared.adjustments.requestedDelta === 0}
      <p class="mt-1 text-sm text-muted-foreground">
        {prepared.difficulty.displayName} records a 0 rating shift, so no per-card adjustment facts were
        emitted.
      </p>
    {:else}
      <p class="mt-1 text-sm text-muted-foreground">
        {prepared.difficulty.displayName} applies
        {prepared.adjustments.requestedDelta > 0 ? '+' : ''}{prepared.adjustments.requestedDelta}
        to every simulation rating of all {prepared.adjustments.facts.length} CPU cards, clamped at 0–100
        before tip-off.
      </p>
      <div class="mt-3 grid gap-2 lg:grid-cols-2">
        {#each prepared.adjustments.facts as fact (fact.cardId)}
          <details class="rounded-lg bg-card px-3 py-2">
            <summary
              class="cursor-pointer text-sm font-semibold outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {nameOf(fact.cardId)} · {fact.requestedDelta > 0 ? '+' : ''}{fact.requestedDelta}
              {#if fact.boundedRatings.length > 0}
                <span class="text-xs font-normal text-muted-foreground">
                  ({fact.boundedRatings.length} clamped)
                </span>
              {/if}
            </summary>
            <ul class="mt-2 grid grid-cols-1 gap-x-4 gap-y-1 text-xs tabular-nums sm:grid-cols-2">
              {#each fact.ratings as entry (entry.rating)}
                <li class={fact.boundedRatings.includes(entry.rating) ? 'text-accent' : ''}>
                  {ratingLabel(entry.rating)}: {entry.before} → {entry.after}
                  {#if fact.boundedRatings.includes(entry.rating)}(clamped){/if}
                </li>
              {/each}
            </ul>
          </details>
        {/each}
      </div>
    {/if}
  </div>
</section>
