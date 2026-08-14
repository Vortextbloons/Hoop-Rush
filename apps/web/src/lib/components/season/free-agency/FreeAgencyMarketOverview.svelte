<script lang="ts">
  import type {
    HoopRushManifest,
    SeasonFreeAgencyCandidate,
    SeasonFreeAgencyRoleExpectation,
  } from '@hoop-rush/data-contracts';
  import type { SeasonFaceRef } from '$lib/season/season-branding';
  import FreeAgencyCandidateCard from './FreeAgencyCandidateCard.svelte';
  import type { CandidateFitFacts, InterestedTeam } from './free-agency-view';

  export interface FreeAgencyCardView {
    candidate: SeasonFreeAgencyCandidate;
    fit: CandidateFitFacts | null;
    isBestFit: boolean;
    interested: InterestedTeam[];
    priority: 0 | 1 | 2;
    role: SeasonFreeAgencyRoleExpectation | null;
    influence: number | null;

    face?: SeasonFaceRef | null;

    overallRating?: number | null;
  }

  let {
    cards,
    manifest = null,
    franchiseName,
    editable = false,
    disabled = false,
    onToggleTarget,
    onPriorityChange,
    onRoleChange,
    onInfluenceChange,
  }: {
    cards: FreeAgencyCardView[];
    manifest?: HoopRushManifest | null;
    franchiseName: (franchiseId: string) => string;
    editable?: boolean;
    disabled?: boolean;
    onToggleTarget: (playerVersionId: string) => void;
    onPriorityChange: (playerVersionId: string, priority: 0 | 1 | 2) => void;
    onRoleChange: (playerVersionId: string, role: SeasonFreeAgencyRoleExpectation) => void;
    onInfluenceChange: (playerVersionId: string, influence: number) => void;
  } = $props();

  const targetedCount = $derived(cards.filter((card) => card.priority !== 0).length);
</script>

<section aria-labelledby="free-agency-market-heading" class="min-w-0" data-fa-market>
  <div class="flex flex-wrap items-baseline justify-between gap-2">
    <h2
      id="free-agency-market-heading"
      class="font-display text-lg font-extrabold uppercase tracking-tight"
    >
      Market
    </h2>
    <span class="font-mono text-[10px] text-muted-foreground">
      {cards.length} candidate{cards.length === 1 ? '' : 's'} · {cards.filter(
        (card) => card.isBestFit,
      ).length} highlighted best fit{cards.filter((card) => card.isBestFit).length === 1 ? '' : 's'}
    </span>
  </div>
  {#if cards.length === 0}
    <p class="mt-2 text-sm text-muted-foreground" data-fa-empty-market>
      This market has no candidates to review.
    </p>
  {:else}
    <ul class="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
      {#each cards as card (card.candidate.playerVersionId)}
        <li class="min-w-0">
          <FreeAgencyCandidateCard
            candidate={card.candidate}
            fit={card.fit}
            isBestFit={card.isBestFit}
            interested={card.interested}
            {franchiseName}
            face={card.face ?? null}
            overallRating={card.overallRating ?? null}
            {manifest}
            priority={card.priority}
            role={card.role}
            influence={card.influence}
            {editable}
            {disabled}
            canAddTarget={card.priority !== 0 || targetedCount < 2}
            onToggleTarget={() => onToggleTarget(card.candidate.playerVersionId)}
            onPriorityChange={(priority) =>
              onPriorityChange(card.candidate.playerVersionId, priority)}
            onRoleChange={(role) => onRoleChange(card.candidate.playerVersionId, role)}
            onInfluenceChange={(influence) =>
              onInfluenceChange(card.candidate.playerVersionId, influence)}
          />
        </li>
      {/each}
    </ul>
  {/if}
</section>
