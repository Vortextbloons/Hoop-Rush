import {
  collectionDifficultyProfileOf,
  collectionScaleRewardCoins,
  type CollectionDifficultyId,
  type CollectionDifficultyProfile,
  type CollectionGameRules,
  type CollectionObjectiveCondition,
  type CollectionObjectiveId,
  type CollectionObjectiveOffer,
  type CollectionRarityBand,
} from '@hoop-rush/data-contracts';

export function formatMultiplier(multiplierBp: number): string {
  return `${(multiplierBp / 10_000).toFixed(2)}×`;
}

export function formatBasisPointPercent(bp: number): string {
  const percent = bp / 100;
  if (Number.isInteger(percent)) return `${String(percent)}%`;
  return `${percent.toFixed(2).replace(/0+$/, '').replace(/\.$/, '')}%`;
}

export function rarityBandLabel(band: CollectionRarityBand): string {
  return `${band.floor}–${band.ceiling}`;
}

export function ratingLabel(rating: string): string {
  const spaced = rating
    .replace(/([A-Z])/g, ' $1')
    .replace(/^./, (character) => character.toUpperCase());
  return spaced.replace(/Iq\b/g, 'IQ');
}

export function difficultyRarityWeightsLabel(profile: CollectionDifficultyProfile): string {
  return profile.rarityWeightsBp
    .map((entry) => `${entry.rarity} ${formatBasisPointPercent(entry.weightBp)}`)
    .join(' · ');
}

export function difficultyConstructionLabel(profile: CollectionDifficultyProfile): string {
  const candidates =
    profile.candidateTeams === 1
      ? '1 candidate team'
      : `${String(profile.candidateTeams)} candidate teams`;
  const selection = profile.useGeneratedStarters
    ? 'first completion-safe five'
    : 'highest-scoring legal five';
  const identity =
    profile.identityFitWeightBp === 0
      ? 'no identity fit'
      : `${formatBasisPointPercent(profile.identityFitWeightBp)} identity fit`;
  const rotation = profile.useGeneratedStarters
    ? `balanced starter/bench rotation, ${String(profile.rotation.maxMinutes)} min cap`
    : `merit rotation, ${String(profile.rotation.maxMinutes)} min cap`;
  const specials = `specials ${formatMultiplier(profile.specialWeightMultiplierBp)} weight`;
  return [candidates, selection, identity, rotation, specials].join(' · ');
}

export function difficultyRatingShiftLabel(ratingShift: number): string {
  if (ratingShift === 0) return 'No CPU rating change';
  const sign = ratingShift > 0 ? '+' : '';
  return `${sign}${String(ratingShift)} to every CPU rating (clamped at 0–100)`;
}

export function objectiveConditionLabel(condition: CollectionObjectiveCondition): string {
  switch (condition.kind) {
    case 'player-team-three-pointers-made':
      return `Make at least ${String(condition.threshold)} three-pointers as a team`;
    case 'cpu-team-points-at-most':
      return `Hold the CPU to ${String(condition.threshold)} points or fewer`;
    case 'player-bench-points-at-least':
      return `Bench scores at least ${String(condition.threshold)} points`;
    case 'cpu-team-turnovers-at-least':
      return `Force at least ${String(condition.threshold)} CPU turnovers`;
    case 'player-rebound-margin-at-least':
      return `Out-rebound the CPU by ${String(condition.threshold)} or more`;
    case 'player-double-stat':
      return `One player records ${String(condition.threshold)}+ in any ${String(condition.categories)} of points, rebounds, assists, steals, blocks`;
  }
}

export function difficultyProfileOf(
  rules: CollectionGameRules,
  difficultyId: CollectionDifficultyId,
): CollectionDifficultyProfile {
  const profile = collectionDifficultyProfileOf(rules.difficulties, difficultyId);
  if (profile === undefined) throw new Error(`unknown difficulty ${difficultyId}`);
  return profile;
}

export interface DifficultyOptionView {
  difficultyId: CollectionDifficultyId;
  displayName: string;
  bandLabel: string;
  weightsLabel: string;
  constructionLabel: string;
  ratingShiftLabel: string;
  rewardMultiplierLabel: string;
  rewardMultiplierBp: number;
  firstClearCoins: number;
  firstClearClaimed: boolean;
  firstClearLabel: string;
}

export function difficultyOptionViews(
  rules: CollectionGameRules,
  clearedDifficultyIds: readonly CollectionDifficultyId[],
): DifficultyOptionView[] {
  return rules.difficulties.map((profile) => {
    const firstClearCoins = rules.rewardTable.firstClearCoins[profile.difficultyId];
    const firstClearClaimed = clearedDifficultyIds.includes(profile.difficultyId);
    return {
      difficultyId: profile.difficultyId,
      displayName: profile.displayName,
      bandLabel: rarityBandLabel(profile.rarityBand),
      weightsLabel: difficultyRarityWeightsLabel(profile),
      constructionLabel: difficultyConstructionLabel(profile),
      ratingShiftLabel: difficultyRatingShiftLabel(profile.ratingShift),
      rewardMultiplierLabel: formatMultiplier(profile.rewardMultiplierBp),
      rewardMultiplierBp: profile.rewardMultiplierBp,
      firstClearCoins,
      firstClearClaimed,
      firstClearLabel: firstClearClaimed
        ? 'First clear claimed'
        : `First clear available: +${String(firstClearCoins)} Coins`,
    };
  });
}

export interface ObjectiveOptionView {
  objectiveId: CollectionObjectiveId | null;
  title: string;
  conditionLabel: string;
  coinBonus: number | null;
}

export function objectiveOptionViews(input: {
  offers: readonly CollectionObjectiveOffer[];
  rules: CollectionGameRules;
  difficultyId: CollectionDifficultyId;
}): ObjectiveOptionView[] {
  const profile = difficultyProfileOf(input.rules, input.difficultyId);
  const bonus = collectionScaleRewardCoins(
    input.rules.rewardTable.objectiveCoins,
    profile.rewardMultiplierBp,
  );
  return [
    {
      objectiveId: null,
      title: 'No objective',
      conditionLabel: 'No objective bonus is available for this game',
      coinBonus: null,
    },
    ...input.offers.map((offer) => ({
      objectiveId: offer.objectiveId,
      title: offer.title,
      conditionLabel: objectiveConditionLabel(offer.condition),
      coinBonus: bonus,
    })),
  ];
}

export interface RewardPreviewRow {
  kind: 'outcome-win' | 'outcome-loss' | 'objective' | 'margin' | 'first-clear';
  label: string;
  detail: string;
  coins: number;
}

export interface RewardPreview {
  difficultyId: CollectionDifficultyId;
  multiplierBp: number;
  multiplierLabel: string;
  winCoins: number;
  lossCoins: number;
  objectiveCoins: number | null;
  marginMaxCoins: number;
  marginCapPoints: number;
  firstClearCoins: number;
  firstClearClaimed: boolean;
  maxRepeatCoins: number;
  maxTotalCoins: number;
  rows: RewardPreviewRow[];
}

export function rewardPreview(input: {
  rules: CollectionGameRules;
  difficultyId: CollectionDifficultyId;
  selectedObjectiveId: CollectionObjectiveId | null;
  clearedDifficultyIds: readonly CollectionDifficultyId[];
}): RewardPreview {
  const profile = difficultyProfileOf(input.rules, input.difficultyId);
  const multiplierBp = profile.rewardMultiplierBp;
  const multiplierLabel = formatMultiplier(multiplierBp);
  const table = input.rules.rewardTable;
  const winCoins = collectionScaleRewardCoins(table.winCoins, multiplierBp);
  const lossCoins = collectionScaleRewardCoins(table.lossCoins, multiplierBp);
  const objectiveCoins =
    input.selectedObjectiveId === null
      ? null
      : collectionScaleRewardCoins(table.objectiveCoins, multiplierBp);
  const marginMaxCoins = collectionScaleRewardCoins(
    table.marginCapPoints * table.marginCoinPerPoint,
    multiplierBp,
  );
  const firstClearClaimed = input.clearedDifficultyIds.includes(input.difficultyId);
  const firstClearCoins = firstClearClaimed ? 0 : table.firstClearCoins[input.difficultyId];
  const maxRepeatCoins = winCoins + (objectiveCoins ?? 0) + marginMaxCoins;
  const rows: RewardPreviewRow[] = [
    {
      kind: 'outcome-win',
      label: 'Win',
      detail: `${String(table.winCoins)} Coins × ${multiplierLabel}`,
      coins: winCoins,
    },
    {
      kind: 'outcome-loss',
      label: 'Loss',
      detail: `${String(table.lossCoins)} Coins × ${multiplierLabel}`,
      coins: lossCoins,
    },
  ];
  if (objectiveCoins !== null) {
    rows.push({
      kind: 'objective',
      label: 'Objective passed',
      detail: `${String(table.objectiveCoins)} Coins × ${multiplierLabel}`,
      coins: objectiveCoins,
    });
  }
  rows.push({
    kind: 'margin',
    label: 'Margin',
    detail: `${String(table.marginCoinPerPoint)} Coin per point, capped at ${String(table.marginCapPoints)} → up to ${String(marginMaxCoins)} Coins`,
    coins: marginMaxCoins,
  });
  rows.push({
    kind: 'first-clear',
    label: firstClearClaimed ? 'First clear (already claimed)' : 'First clear',
    detail: firstClearClaimed
      ? 'Not available again at this difficulty'
      : `${String(firstClearCoins)} Coins, not scaled`,
    coins: firstClearCoins,
  });
  return {
    difficultyId: input.difficultyId,
    multiplierBp,
    multiplierLabel,
    winCoins,
    lossCoins,
    objectiveCoins,
    marginMaxCoins,
    marginCapPoints: table.marginCapPoints,
    firstClearCoins,
    firstClearClaimed,
    maxRepeatCoins,
    maxTotalCoins: maxRepeatCoins + firstClearCoins,
    rows,
  };
}
