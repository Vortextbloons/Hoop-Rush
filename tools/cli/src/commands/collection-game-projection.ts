import {
  COLLECTION_RARITY_ORDER,
  type CollectionCatalog,
  type CollectionDifficultyId,
  type CollectionGameRules,
} from '@hoop-rush/data-contracts';
import {
  generateCollectionCpuTeamV2,
  resolveDifficultyRatingAdjustments,
} from '@hoop-rush/engine';

export interface CollectionGameProjectionJob {
  difficultyId: CollectionDifficultyId;
  rootSeed: string;
  gameSequence: number;
}

export interface CollectionGameProjection {
  difficultyId: CollectionDifficultyId;
  rootSeed: string;
  gameSequence: number;
  legalityOk: boolean;
  bandOk: boolean;
  specialCount: number;
  rosterScoreMillionths: number;
  adjustmentFacts: number;
  failures: string[];
}

export function projectCollectionGameJob(
  catalog: CollectionCatalog,
  rules: CollectionGameRules,
  job: CollectionGameProjectionJob,
): CollectionGameProjection {
  const profile = rules.difficulties.find((entry) => entry.difficultyId === job.difficultyId);
  const base = {
    difficultyId: job.difficultyId,
    rootSeed: job.rootSeed,
    gameSequence: job.gameSequence,
    legalityOk: false,
    bandOk: false,
    specialCount: 0,
    rosterScoreMillionths: 0,
    adjustmentFacts: 0,
  };
  if (profile === undefined) {
    return { ...base, failures: [`unknown difficulty ${job.difficultyId}`] };
  }
  const byId = new Map(catalog.cards.map((card) => [card.cardId, card]));
  let generated: ReturnType<typeof generateCollectionCpuTeamV2>;
  try {
    generated = generateCollectionCpuTeamV2(catalog, job.rootSeed, job.gameSequence, profile);
  } catch (error) {
    return { ...base, failures: [(error as Error).message] };
  }
  const failures: string[] = [];
  const roster = [...generated.team.starters, ...generated.team.bench];
  let specialCount = 0;
  let bandOk = true;
  const floor = COLLECTION_RARITY_ORDER.indexOf(profile.rarityBand.floor);
  const ceiling = COLLECTION_RARITY_ORDER.indexOf(profile.rarityBand.ceiling);
  for (const cardId of roster) {
    const card = byId.get(cardId);
    if (card === undefined) {
      failures.push(`unknown card ${cardId}`);
      continue;
    }
    if (card.family !== 'Base') specialCount += 1;
    const index = COLLECTION_RARITY_ORDER.indexOf(card.rarity);
    if (index < floor || index > ceiling) bandOk = false;
  }
  const legalityOk =
    roster.length === 12 &&
    new Set(roster).size === roster.length &&
    new Set(roster.map((cardId) => byId.get(cardId)?.playerId ?? 'missing')).size === roster.length;
  if (!legalityOk) failures.push('cpu roster is not twelve unique canonical players');
  if (!bandOk) failures.push('cpu roster leaves the difficulty band');
  const adjustments = resolveDifficultyRatingAdjustments(catalog, generated.team, profile);
  const expectedFacts = profile.ratingShift === 0 ? 0 : roster.length;
  if (adjustments.facts.length !== expectedFacts) {
    failures.push(
      `adjustment facts ${String(adjustments.facts.length)} != ${String(expectedFacts)}`,
    );
  }
  const chosen = generated.construction.candidates[generated.construction.chosenCandidateIndex];
  return {
    ...base,
    legalityOk,
    bandOk,
    specialCount,
    rosterScoreMillionths: chosen?.score.rosterScoreMillionths ?? 0,
    adjustmentFacts: adjustments.facts.length,
    failures,
  };
}
