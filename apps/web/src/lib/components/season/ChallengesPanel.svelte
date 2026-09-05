<script lang="ts">
  import type {
    SeasonBlockChallengeEvaluation,
    SeasonChallengeDeal,
    SeasonChallengeId,
  } from '@hoop-rush/data-contracts';
  import { SEASON_CHALLENGE_CATALOG } from '@hoop-rush/data-contracts';
  let {
    blockIndex,
    deal = null,
    evaluation = null,
    franchiseName = (id: string) => id,
  }: {
    blockIndex: number | null;
    deal: SeasonChallengeDeal | null;
    evaluation: SeasonBlockChallengeEvaluation | null;
    franchiseName?: (franchiseId: string) => string;
  } = $props();
  const catalogById = new Map(SEASON_CHALLENGE_CATALOG.map((entry) => [entry.challengeId, entry]));
  const results = $derived(evaluation?.results ?? null);
  const completedCount = $derived(results?.filter((r) => r.success).length ?? 0);
  const earnedCount = $derived(
    results?.reduce(
      (sum, r) => sum + (r.success ? (catalogById.get(r.challengeId)?.reward ?? 0) : 0),
      0,
    ) ?? 0,
  );
  function goalLine(challengeId: SeasonChallengeId): string {
    const definition = catalogById.get(challengeId);
    if (challengeId === 'beat-leader' && deal?.targets.leaderFranchiseId) {
      return `Beat ${franchiseName(deal.targets.leaderFranchiseId)} — ${definition?.description ?? ''}`;
    }
    if (challengeId === 'beat-higher' && (deal?.targets.qualifyingOpponentIds.length ?? 0) > 0) {
      const names = (deal?.targets.qualifyingOpponentIds ?? []).slice(0, 2).map(franchiseName);
      return `Beat a better-record team (${names.join(', ')})`;
    }
    if (challengeId === 'winning-block' && deal) {
      return `${definition?.description ?? ''} (${String(deal.targets.gamesInBlock)} games)`;
    }
    return definition?.description ?? challengeId;
  }
  function factLine(challengeId: SeasonChallengeId): string {
    const result = results?.find((r) => r.challengeId === challengeId);
    if (!result) return '';
    const facts = result.facts;
    switch (challengeId) {
      case 'winning-block':
      case 'win-six':
      case 'statement-block':
        return `${String(facts.wins)}–${String(facts.games - facts.wins)} across ${String(facts.games)}`;
      case 'three-point-mark':
        if (facts.threePointersAttempted < 20) {
          return `${String(facts.threePointersMade)}/${String(facts.threePointersAttempted)} 3P — need 20 attempts`;
        }
        return `${String(facts.threePointersMade)}/${String(facts.threePointersAttempted)} 3P (${((facts.threePointPct ?? 0) * 100).toFixed(1)}%, need 35%)`;
      case 'protect-glass':
        return `${facts.reboundMargin >= 0 ? '+' : ''}${String(facts.reboundMargin)} rebound margin`;
      case 'take-care':
        return facts.turnoversPerGame === null
          ? `${String(facts.turnovers)} turnovers (no games)`
          : `${facts.turnoversPerGame.toFixed(1)} turnovers/game (need ≤ 13.0)`;
      case 'beat-leader':
        return result.success ? 'Beat the leader' : 'No win vs the leader';
      case 'beat-higher':
        return result.success ? 'Beat a better-record team' : 'No win vs a better-record team';
    }
  }
</script>

<section
  aria-labelledby="challenges-panel-heading"
  class="scroll-mb-24 rounded-lg bg-surface-2 p-3"
  data-season-challenges-panel
>
  <div class="flex flex-wrap items-baseline justify-between gap-2">
    <h3
      id="challenges-panel-heading"
      class="font-mono text-[11px] font-bold uppercase tracking-[0.14em] text-muted-foreground"
    >
      Challenges — all 3 live
    </h3>
    <span class="font-mono text-[10px] text-muted-foreground">
      {blockIndex === null
        ? 'No challenges remain'
        : evaluation !== null
          ? `${String(completedCount)}/3 (+${String(earnedCount)})`
          : `Block ${String(blockIndex + 1)} of 9`}
    </span>
  </div>
  {#if blockIndex === null || deal === null}
    <p class="mt-2 text-sm text-muted-foreground">The final two-game block has no challenges.</p>
  {:else}
    <div class="mt-2 flex flex-col gap-2">
      {#each deal.challengeIds as challengeId (challengeId)}
        {@const definition = catalogById.get(challengeId)}
        {@const result = results?.find((r) => r.challengeId === challengeId) ?? null}
        <div
          class="flex min-w-0 flex-col gap-0.5 rounded-lg border border-border bg-surface-1 px-3 py-2"
          data-challenge-card={challengeId}
          data-challenge-state={result === null ? 'live' : result.success ? 'completed' : 'missed'}
        >
          <span class="flex items-center justify-between gap-2">
            <span class="text-sm font-semibold">{definition?.name ?? challengeId}</span>
            <span class="flex items-center gap-1">
              <span
                class="rounded-full bg-surface-3 px-2 py-0.5 font-mono text-[10px] font-bold uppercase tracking-[0.12em] text-muted-foreground"
              >
                +{String(definition?.reward ?? 1)}{definition?.difficulty === 'hard' ? ' hard' : ''}
              </span>
              {#if result === null}
                <span
                  class="rounded-full bg-primary/15 px-2 py-0.5 font-mono text-[10px] font-bold uppercase tracking-[0.12em] text-primary"
                >
                  Live
                </span>
              {:else if result.success}
                <span
                  class="rounded-full bg-green-500/15 px-2 py-0.5 font-mono text-[10px] font-bold uppercase tracking-[0.12em] text-green-700 dark:text-green-300"
                >
                  Done +{String(definition?.reward ?? 1)}
                </span>
              {:else}
                <span
                  class="rounded-full bg-surface-3 px-2 py-0.5 font-mono text-[10px] font-bold uppercase tracking-[0.12em] text-muted-foreground"
                >
                  Missed
                </span>
              {/if}
            </span>
          </span>
          <span class="text-xs text-muted-foreground">{goalLine(challengeId)}</span>
          {#if result !== null}
            <span class="font-mono text-[10px] text-muted-foreground">{factLine(challengeId)}</span>
          {/if}
        </div>
      {/each}
    </div>
  {/if}
</section>
