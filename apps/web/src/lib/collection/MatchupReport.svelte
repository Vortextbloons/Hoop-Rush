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

  function positionOf(cardId: string): string {
    return cardById.get(cardId)?.positions[0] ?? '—';
  }
</script>

<section aria-label="Declared matchup" class="ur-matchup-report mt-4">
  <div class="ur-prepared-hero">
    <div class="ur-prepared-copy">
      <p class="ur-prepared-kicker">Matchup prepared</p>
      <h2 class="ur-prepared-title">
        {challenge ? `Challenge · ${challenge.displayName}` : 'Under the lights'}
      </h2>
      <p class="ur-prepared-sub">
        {challenge
          ? `${requirementLabel(challenge.requirement)} · snapshotted from the committed team before tip-off.`
          : 'The simulation is ready. Start the game and watch the action unfold.'}
      </p>
    </div>
    <p class="ur-lock-stamp">Locked until abandoned</p>
  </div>

  {#if challenge}
    <dl class="ur-fact-grid">
      <div class="ur-fact">
        <dt>Challenge first clear</dt>
        <dd>{challenge.firstClearEligible ? 'Available' : 'Already claimed'}</dd>
        <dd class="ur-fact-sub">{challenge.firstClearCoins} Coins on the first completed win</dd>
      </div>
      <div class="ur-fact">
        <dt>Challenge repeat win</dt>
        <dd class="tabular-nums">{challenge.repeatWinCoins} Coins</dd>
        <dd class="ur-fact-sub">Applies once the challenge has been cleared</dd>
      </div>
      <div class="ur-fact">
        <dt>Snapshotted roster facts</dt>
        <dd class="tabular-nums">
          {challenge.validation.rosterCount}/{challenge.validation.requiredRosterCount} active
        </dd>
        <dd class="ur-fact-sub tabular-nums">
          {challenge.validation.starterCount}/{challenge.validation.requiredStarterCount} starters · team
          {challenge.validation.teamValid ? 'legal' : 'illegal'}
        </dd>
      </div>
      <div class="ur-fact">
        <dt>Challenge ID</dt>
        <dd class="ur-mono">{challenge.challengeId}</dd>
        <dd class="ur-fact-sub">
          Fixed {challenge.difficultyId} difficulty
        </dd>
      </div>
    </dl>
  {/if}

  <dl class="ur-fact-grid">
    <div class="ur-fact">
      <dt>Difficulty</dt>
      <dd class="ur-fact-strong">{prepared.difficulty.displayName}</dd>
      <dd class="ur-fact-sub">
        Rewards {formatMultiplier(prepared.difficulty.rewardMultiplierBp)} · CPU shift
        {prepared.difficulty.ratingShift > 0 ? '+' : ''}{prepared.difficulty.ratingShift}
      </dd>
    </div>
    <div class="ur-fact">
      <dt>CPU identity</dt>
      <dd class="ur-fact-strong ur-capitalize">{prepared.construction.identity}</dd>
      <dd class="ur-fact-sub">
        Candidate {prepared.construction.chosenCandidateIndex + 1} of {prepared.construction
          .candidateCount}
        {chosenScoreMillionths === null
          ? ''
          : ` · roster score ${(chosenScoreMillionths / 1_000_000).toFixed(2)}`}
      </dd>
    </div>
    <div class="ur-fact">
      <dt>CPU roster</dt>
      <dd class="ur-fact-strong">{cpuRoster.length} cards</dd>
      <dd class="ur-fact-sub tabular-nums">
        {prepared.construction.rarityCounts.Ember} Ember · {prepared.construction.rarityCounts
          .Eruption} Eruption · {prepared.construction.rarityCounts.Apex} Apex · {prepared
          .construction.rarityCounts.Titan} Titan · {prepared.construction.rarityCounts.Eclipse} Eclipse
        · {prepared.construction.rarityCounts.Immortal} Immortal · {prepared.construction
          .specialCount} special
      </dd>
    </div>
    <div class="ur-fact">
      <dt>First clear</dt>
      <dd class="ur-fact-strong">
        {prepared.firstClearEligible ? 'Available' : 'Already claimed'}
      </dd>
      <dd class="ur-fact-sub">
        {prepared.firstClearEligible
          ? 'A win claims this difficulty first-clear bonus.'
          : 'This game cannot claim a first-clear bonus.'}
      </dd>
    </div>
  </dl>

  <div class="ur-objective-strip">
    <h3>Selected objective</h3>
    {#if selectedOffer && prepared.objectives.selectedObjectiveId !== null}
      <p class="ur-objective-title">{selectedOffer.title}</p>
      <p class="ur-objective-cond">
        {objectiveConditionLabel(selectedOffer.condition)}
      </p>
    {:else}
      <p class="ur-objective-cond">
        No objective. Only the outcome, margin, and first-clear rewards apply.
      </p>
    {/if}
  </div>

  <div class="ur-roster-grid">
    <div class="ur-roster-col">
      <h3>Your starters</h3>
      <ul>
        {#each prepared.playerTeam.starters as cardId (cardId)}
          <li>
            <span class="ur-row-main">
              <span class="ur-row-name">{nameOf(cardId)}</span>
              <span class="ur-row-sub tabular-nums">
                {overallOf(cardId) === null ? '' : `OVR ${overallOf(cardId)}`}
              </span>
            </span>
            <span class="ur-pos-badge">{positionOf(cardId)}</span>
          </li>
        {/each}
      </ul>
    </div>
    <div class="ur-roster-col">
      <h3>CPU roster</h3>
      <ul>
        {#each cpuRoster as cardId (cardId)}
          <li>
            <span class="ur-row-main">
              <span class="ur-cpu-tags">
                <span
                  class="ur-rarity-pill"
                  data-rarity={(cardById.get(cardId)?.rarity ?? '').toLowerCase()}
                >
                  {cardById.get(cardId)?.rarity ?? '—'}
                </span>
                <span class="ur-row-name">{nameOf(cardId)}</span>
                {#if prepared.construction.starters.includes(cardId)}
                  <span class="ur-tag">starter</span>
                {/if}
                {#if closingFive.has(cardId)}
                  <span class="ur-tag ur-tag-closer">closer</span>
                {/if}
              </span>
            </span>
            <span class="ur-row-sub tabular-nums">
              {minutesById.get(cardId) ?? 0} min
            </span>
          </li>
        {/each}
      </ul>
    </div>
  </div>

  <div class="ur-adjustment-strip">
    <h3>Declared CPU rating adjustment</h3>
    {#if prepared.adjustments.requestedDelta === 0}
      <p>
        {prepared.difficulty.displayName} records a 0 rating shift, so no per-card adjustment facts were
        emitted.
      </p>
    {:else}
      <p>
        {prepared.difficulty.displayName} applies
        {prepared.adjustments.requestedDelta > 0 ? '+' : ''}{prepared.adjustments.requestedDelta}
        to every simulation rating of all {prepared.adjustments.facts.length} CPU cards, clamped at 0–100
        before tip-off.
      </p>
      <div class="ur-adjust-grid">
        {#each prepared.adjustments.facts as fact (fact.cardId)}
          <details>
            <summary>
              {nameOf(fact.cardId)} · {fact.requestedDelta > 0 ? '+' : ''}{fact.requestedDelta}
              {#if fact.boundedRatings.length > 0}
                <span class="ur-clamped">
                  ({fact.boundedRatings.length} clamped)
                </span>
              {/if}
            </summary>
            <ul>
              {#each fact.ratings as entry (entry.rating)}
                <li class:ur-hit={fact.boundedRatings.includes(entry.rating)}>
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

<style>
  .ur-matchup-report {
    overflow: hidden;
    border: 1px solid color-mix(in srgb, var(--ur-apex) 30%, var(--ur-line-strong));
    border-radius: 0.85rem;
    background: linear-gradient(165deg, #141c21, #0b1114 78%);
    box-shadow:
      0 1.2rem 2.5rem rgb(0 0 0 / 40%),
      inset 0 1px 0 rgb(255 255 255 / 6%);
  }
  .ur-prepared-hero {
    display: flex;
    flex-wrap: wrap;
    align-items: flex-start;
    justify-content: space-between;
    gap: 0.8rem;
    padding: clamp(1rem, 3vw, 1.5rem);
    border-bottom: 1px solid var(--ur-line);
    background:
      radial-gradient(ellipse 60% 90% at 50% 0%, rgb(255 196 64 / 16%), transparent 65%),
      radial-gradient(ellipse 50% 70% at 85% 20%, rgb(255 122 26 / 14%), transparent 60%),
      linear-gradient(180deg, #1a2228, #0d1216);
  }
  .ur-prepared-kicker {
    margin: 0;
    color: var(--ur-apex);
    font-size: 0.66rem;
    font-weight: 800;
    letter-spacing: 0.22em;
    text-transform: uppercase;
  }
  .ur-prepared-title {
    margin: 0.3rem 0 0;
    color: #fff;
    font-family: var(--font-display);
    font-size: clamp(1.7rem, 4vw, 2.4rem);
    font-weight: 900;
    letter-spacing: -0.02em;
    line-height: 1;
  }
  .ur-prepared-sub {
    max-width: 62ch;
    margin: 0.45rem 0 0;
    color: var(--ur-muted);
    font-size: 0.82rem;
  }
  .ur-lock-stamp {
    flex: none;
    margin: 0;
    padding: 0.4rem 0.7rem;
    border: 1px solid color-mix(in srgb, var(--ur-apex) 40%, var(--ur-line));
    border-radius: 999px;
    background: rgb(6 9 12 / 72%);
    color: var(--ur-muted);
    font-size: 0.66rem;
    font-weight: 800;
    letter-spacing: 0.08em;
    text-transform: uppercase;
  }
  .ur-fact-grid {
    display: grid;
    gap: 0.6rem;
    margin: 0;
    padding: clamp(0.85rem, 2.4vw, 1.25rem);
    grid-template-columns: repeat(4, minmax(0, 1fr));
  }
  .ur-fact {
    min-width: 0;
    padding: 0.7rem 0.8rem;
    border: 1px solid var(--ur-line);
    border-top: 2px solid var(--ur-apex);
    border-radius: 0.6rem;
    background: #10171c;
  }
  .ur-fact dt {
    color: var(--ur-muted);
    font-size: 0.66rem;
    font-weight: 700;
  }
  .ur-fact dd {
    margin: 0.2rem 0 0;
    color: var(--ur-paper);
    font-size: 0.82rem;
    font-weight: 800;
  }
  .ur-fact-strong {
    font-family: var(--font-display);
    font-size: 0.95rem !important;
  }
  .ur-capitalize {
    text-transform: capitalize;
  }
  .ur-fact-sub {
    color: var(--ur-muted) !important;
    font-size: 0.7rem !important;
    font-weight: 500 !important;
    line-height: 1.45;
  }
  .ur-mono {
    font-family: ui-monospace, monospace;
    font-size: 0.72rem !important;
    overflow-wrap: anywhere;
  }
  .ur-objective-strip {
    margin: 0 clamp(0.85rem, 2.4vw, 1.25rem);
    padding: 0.75rem 0.9rem;
    border-left: 3px solid var(--ur-apex);
    border-radius: 0.15rem 0.6rem 0.6rem 0.15rem;
    background: #10171c;
  }
  .ur-objective-strip h3 {
    margin: 0;
    color: var(--ur-paper);
    font-size: 0.78rem;
    font-weight: 800;
  }
  .ur-objective-title {
    margin: 0.2rem 0 0;
    color: #fff;
    font-size: 0.86rem;
    font-weight: 800;
  }
  .ur-objective-cond {
    margin: 0.15rem 0 0;
    color: var(--ur-muted);
    font-size: 0.76rem;
  }
  .ur-roster-grid {
    display: grid;
    gap: 0.9rem;
    padding: clamp(0.85rem, 2.4vw, 1.25rem);
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
  .ur-roster-col h3 {
    margin: 0 0 0.55rem;
    padding-bottom: 0.45rem;
    border-bottom: 1px solid var(--ur-line-strong);
    color: #fff;
    font-family: var(--font-display);
    font-size: 0.95rem;
    font-weight: 850;
  }
  .ur-roster-col ul {
    display: grid;
    gap: 0.35rem;
    margin: 0;
    padding: 0;
    list-style: none;
  }
  .ur-roster-col li {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.6rem;
    min-height: 2.6rem;
    padding: 0.45rem 0.6rem;
    border: 1px solid var(--ur-line);
    border-radius: 0.55rem;
    background: #0e1418;
  }
  .ur-row-main {
    display: flex;
    min-width: 0;
    flex: 1;
    flex-direction: column;
  }
  .ur-row-name {
    overflow: hidden;
    color: var(--ur-paper);
    font-size: 0.8rem;
    font-weight: 700;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .ur-row-sub {
    color: var(--ur-muted);
    font-size: 0.68rem;
  }
  .ur-pos-badge {
    display: inline-grid;
    min-width: 1.7rem;
    height: 1.45rem;
    flex: none;
    place-items: center;
    padding-inline: 0.35rem;
    border: 1px solid color-mix(in srgb, var(--ur-apex) 55%, transparent);
    border-radius: 0.35rem;
    color: var(--ur-apex);
    font-size: 0.64rem;
    font-weight: 900;
  }
  .ur-cpu-tags {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.35rem;
  }
  .ur-rarity-pill {
    padding: 0.14rem 0.4rem;
    border: 1px solid currentColor;
    border-radius: 0.3rem;
    font-size: 0.6rem;
    font-weight: 800;
  }
  .ur-rarity-pill[data-rarity='apex'] {
    color: var(--ur-apex);
    background: rgb(255 197 61 / 10%);
  }
  .ur-rarity-pill[data-rarity='eclipse'] {
    color: #c4b0ff;
    background: rgb(139 92 246 / 14%);
  }
  .ur-rarity-pill[data-rarity='eruption'] {
    color: #ff8a5c;
    background: rgb(255 90 42 / 12%);
  }
  .ur-rarity-pill[data-rarity='ember'] {
    color: #e0a37c;
    background: rgb(198 90 46 / 12%);
  }
  .ur-rarity-pill[data-rarity='titan'] {
    color: var(--ur-titan);
    background: rgb(169 180 216 / 12%);
  }
  .ur-rarity-pill[data-rarity='immortal'] {
    color: var(--ur-immortal);
    background: rgb(255 233 176 / 10%);
  }
  .ur-tag {
    color: var(--ur-muted);
    font-size: 0.6rem;
    font-weight: 800;
    letter-spacing: 0.08em;
    text-transform: uppercase;
  }
  .ur-tag-closer {
    color: var(--ur-apex);
  }
  .ur-adjustment-strip {
    margin: 0 clamp(0.85rem, 2.4vw, 1.25rem) clamp(0.85rem, 2.4vw, 1.25rem);
    padding: 0.8rem 0.9rem;
    border: 1px solid var(--ur-line);
    border-left: 3px solid var(--ur-apex);
    border-radius: 0.15rem 0.6rem 0.6rem 0.15rem;
    background: #10171c;
  }
  .ur-adjustment-strip h3 {
    margin: 0;
    color: #fff;
    font-size: 0.8rem;
    font-weight: 800;
  }
  .ur-adjustment-strip p {
    margin: 0.3rem 0 0;
    color: var(--ur-muted);
    font-size: 0.76rem;
  }
  .ur-adjust-grid {
    display: grid;
    gap: 0.4rem;
    margin-top: 0.6rem;
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
  .ur-adjust-grid details {
    padding: 0.5rem 0.6rem;
    border: 1px solid var(--ur-line);
    border-radius: 0.5rem;
    background: #0b1114;
  }
  .ur-adjust-grid summary {
    color: var(--ur-paper);
    cursor: pointer;
    font-size: 0.76rem;
    font-weight: 700;
  }
  .ur-clamped {
    color: var(--ur-muted);
    font-weight: 500;
  }
  .ur-adjust-grid ul {
    display: grid;
    gap: 0.15rem;
    margin: 0.45rem 0 0;
    padding: 0;
    list-style: none;
    color: var(--ur-muted);
    font-size: 0.68rem;
    font-variant-numeric: tabular-nums;
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
  .ur-hit {
    color: var(--ur-apex);
  }
  @media (max-width: 900px) {
    .ur-fact-grid {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }
    .ur-roster-grid {
      grid-template-columns: minmax(0, 1fr);
    }
    .ur-adjust-grid {
      grid-template-columns: minmax(0, 1fr);
    }
  }
  @media (max-width: 520px) {
    .ur-fact-grid {
      grid-template-columns: minmax(0, 1fr);
    }
  }
</style>
