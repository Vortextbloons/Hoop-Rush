import {
  SEASON_COURT_INNOVATION_CATALOG,
  SEASON_COURT_INNOVATION_VERSION,
  SEASON_EVOLUTION_TARGETS_VERSION,
  SEASON_FRONT_OFFICE_VERSION,
  SEASON_SPONSOR_CATALOG,
  frontOfficeEntryOf,
  type SeasonCourtInnovationId,
  type SeasonEvolutionState,
  type SeasonFrontOfficeId,
  type SeasonSponsorWrapper,
  type SeasonEvolutionSelection,
  type SeasonGameSummary,
  type SeasonRotation,
  type SeasonSchedule,
} from '@hoop-rush/data-contracts';
import { franchiseIdSchema } from '@hoop-rush/data-contracts';
import { seasonNamespaceSeed, seasonDigestHex } from '@hoop-rush/data-contracts';
import { createRng } from '../sim/rng.ts';
export const FRONT_OFFICE_BASE_REHAB_COST = 2;
export const FRONT_OFFICE_MIN_REHAB_COST = 1;
export const TRADE_INQUIRY_TOTAL_CAP = 5;
export const SPONSOR_WRAP_PROBABILITY = 0.5;
export const SPONSOR_CONTENT_VERSION = 'sponsor-content-v1';

export function rehabPriceOf(executiveId: SeasonFrontOfficeId | null | undefined): number {
  if (executiveId === undefined || executiveId === null) return FRONT_OFFICE_BASE_REHAB_COST;
  const entry = frontOfficeEntryOf(executiveId);
  const price = FRONT_OFFICE_BASE_REHAB_COST + entry.rehabDelta;
  return Math.max(FRONT_OFFICE_MIN_REHAB_COST, price);
}

export function rehabPriceExplanation(executiveId: SeasonFrontOfficeId | null | undefined): string {
  if (executiveId === null || executiveId === undefined)
    return 'Risky rehabilitation costs 2 Influence.';
  const entry = frontOfficeEntryOf(executiveId);
  const price = rehabPriceOf(executiveId);
  if (entry.rehabDelta === 0) return `Risky rehabilitation costs ${String(price)} Influence.`;
  if (entry.rehabDelta < 0)
    return `Risky rehabilitation costs ${String(price)} Influence (${entry.displayName} recovery discount, minimum ${String(FRONT_OFFICE_MIN_REHAB_COST)}).`;
  return `Risky rehabilitation costs ${String(price)} Influence (${entry.displayName} drawback).`;
}

export function baseInquiryAllowanceOf(
  executiveId: SeasonFrontOfficeId | null | undefined,
): number {
  if (executiveId === undefined || executiveId === null) return 3;
  return frontOfficeEntryOf(executiveId).baseInquiryAllowance;
}

export function purchasedInquiryCostOf(
  executiveId: SeasonFrontOfficeId | null | undefined,
): number {
  if (executiveId === undefined || executiveId === null) return 1;
  return frontOfficeEntryOf(executiveId).purchasedInquiryCost;
}

export function inquiryAllowanceExplanation(
  executiveId: SeasonFrontOfficeId | null | undefined,
): string {
  const base = baseInquiryAllowanceOf(executiveId);
  const cost = purchasedInquiryCostOf(executiveId);
  if (executiveId === null || executiveId === undefined)
    return `Base allowance ${String(base)} per window (cap ${String(TRADE_INQUIRY_TOTAL_CAP)}); purchased inquiries cost ${String(cost)} Influence.`;
  const entry = frontOfficeEntryOf(executiveId);
  return `Base allowance ${String(base)} per window (cap ${String(TRADE_INQUIRY_TOTAL_CAP)}); purchased inquiries cost ${String(cost)} Influence (${entry.displayName} ${entry.id === 'morgan-vale' ? 'ability' : entry.id === 'alex-chen' ? 'drawback' : 'standard'}).`;
}

export function campaignBonusOf(executiveId: SeasonFrontOfficeId | null | undefined): number {
  if (executiveId === undefined || executiveId === null) return 0;
  return frontOfficeEntryOf(executiveId).campaignBonus;
}

export function applyCampaignBonus(
  executiveId: SeasonFrontOfficeId | null | undefined,
  balanceBefore: number,
  cap: number,
): { requested: number; credited: number } {
  const bonus = campaignBonusOf(executiveId);
  if (bonus <= 0) return { requested: 0, credited: 0 };
  const requested = 1;
  const credited = Math.max(0, Math.min(requested, cap - balanceBefore));
  return { requested, credited };
}

export function evolutionVersions(): {
  frontOfficeVersion: typeof SEASON_FRONT_OFFICE_VERSION;
  courtInnovationVersion: typeof SEASON_COURT_INNOVATION_VERSION;
  targetsVersion: typeof SEASON_EVOLUTION_TARGETS_VERSION;
} {
  return {
    frontOfficeVersion: SEASON_FRONT_OFFICE_VERSION,
    courtInnovationVersion: SEASON_COURT_INNOVATION_VERSION,
    targetsVersion: SEASON_EVOLUTION_TARGETS_VERSION,
  };
}

type SponsorCandidate = {
  opportunityId: string;
  family: string;
  blockIndex: number;
};

export function wrapSponsorshipsForBlock(input: {
  rootSeed: string;
  blockIndex: number;
  opportunities: readonly SponsorCandidate[];
}): { wrappedOpportunityId: string | null; wrapper: SeasonSponsorWrapper | null } {
  const seed = seasonNamespaceSeed(input.rootSeed, 'sponsorship', String(input.blockIndex), 'wrap');
  const rng = createRng(seed);
  if (!rng.chance(SPONSOR_WRAP_PROBABILITY)) return { wrappedOpportunityId: null, wrapper: null };
  const compatible = input.opportunities
    .filter((o) =>
      SEASON_SPONSOR_CATALOG.some((s) => s.compatibleFamilies.includes(o.family as never)),
    )
    .sort((a, b) => (a.opportunityId < b.opportunityId ? -1 : 1));
  if (compatible.length === 0) return { wrappedOpportunityId: null, wrapper: null };
  const picked = rng.pick(compatible);
  const brands = SEASON_SPONSOR_CATALOG.filter((s) =>
    s.compatibleFamilies.includes(picked.family as never),
  ).sort((a, b) => (a.id < b.id ? -1 : 1));
  if (brands.length === 0) return { wrappedOpportunityId: null, wrapper: null };
  const brand = rng.pick(brands);
  const seedPath = [
    'sponsorship',
    String(input.blockIndex),
    'wrap',
    picked.opportunityId,
    brand.id,
  ];
  return {
    wrappedOpportunityId: picked.opportunityId,
    wrapper: {
      sponsorId: brand.id,
      contentVersion: SPONSOR_CONTENT_VERSION,
      wrappedOpportunityId: picked.opportunityId,
      blockIndex: input.blockIndex,
      seedPath,
    },
  };
}

export function createEvolutionDiscovery(input: { rootSeed: string; acceptedBlockIndex: number }): {
  blockIndex: 2;
  offeredInnovationIds: readonly [
    SeasonCourtInnovationId,
    SeasonCourtInnovationId,
    SeasonCourtInnovationId,
  ];
  version: typeof SEASON_COURT_INNOVATION_VERSION;
  seed: string;
} | null {
  if (input.acceptedBlockIndex !== 2) return null;
  const offered = SEASON_COURT_INNOVATION_CATALOG.map((entry) => entry.id);
  if (offered.length !== 3) return null;
  const [first, second, third] = offered as [
    SeasonCourtInnovationId,
    SeasonCourtInnovationId,
    SeasonCourtInnovationId,
  ];
  return {
    blockIndex: 2,
    offeredInnovationIds: [first, second, third],
    version: SEASON_COURT_INNOVATION_VERSION,
    seed: seasonNamespaceSeed(input.rootSeed, 'evolution', 'discovery', 'block-2'),
  };
}

export function evolutionGateAllowsBlock(
  evolution: SeasonEvolutionState | null | undefined,
  nextBlockIndex: number,
): boolean {
  if (nextBlockIndex < 3) return true;
  if (!evolution?.discovery) return true;
  const humanSelected = Object.keys(evolution.selections).length > 0;
  return humanSelected;
}

export { resolveHomeGameRule } from '@hoop-rush/data-contracts';

export interface AiInnovationScorer {
  (innovationId: SeasonCourtInnovationId): number;
}

export function selectAiCourtInnovation(input: {
  rootSeed: string;
  franchiseId: string;
  scorer: AiInnovationScorer;
  aiOrderIndex: number;
}): {
  innovationId: SeasonCourtInnovationId;
  candidateScores: { innovationId: SeasonCourtInnovationId; score: number }[];
  inputDigest: string;
} {
  const ids: readonly SeasonCourtInnovationId[] = SEASON_COURT_INNOVATION_CATALOG.map(
    (entry) => entry.id,
  );
  const candidateScores = ids.map((id) => ({ innovationId: id, score: input.scorer(id) }));
  const digestInput = `${input.franchiseId}|${candidateScores.map((c) => `${c.innovationId}:${String(c.score)}`).join(',')}|${String(input.aiOrderIndex)}`;
  const inputDigest = seasonDigestHex(digestInput);
  const ranked = [...candidateScores].sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return a.innovationId < b.innovationId ? -1 : 1;
  });
  const top = ranked[0];
  const tied = ranked.filter((c) => top && c.score === top.score);
  if (!top) throw new Error('ai innovation selection has no candidates');
  if (tied.length === 1) return { innovationId: top.innovationId, candidateScores, inputDigest };
  const tieSeed = seasonNamespaceSeed(
    input.rootSeed,
    'evolution',
    'ai-tiebreak',
    input.franchiseId,
  );
  const rng = createRng(tieSeed);
  const pick = rng.pick(tied);
  return { innovationId: pick.innovationId, candidateScores, inputDigest };
}
export interface AiSelectionDataSource {
  summaries: readonly SeasonGameSummary[];
  rotations: readonly SeasonRotation[];
  schedule: SeasonSchedule;
  completedRounds: number;
  aiOrderIndexOf: (franchiseId: string) => number;
}
interface AiTeamRates {
  games: number;
  possessionsPerGame: number;
  weightedThreesPerGame: number;
  weightedPointsPerGame: number;
  weightedFreeThrowsPerGame: number;
  threesAllowedPerGame: number;
  pointsAllowedPerGame: number;
}
function minuteShares(
  rotations: readonly SeasonRotation[],
  franchiseId: string,
): Map<string, number> {
  const rotation = rotations.find((entry) => entry.franchiseId === franchiseId);
  const shares = new Map<string, number>();
  if (rotation === undefined) return shares;
  let total = 0;
  for (const entry of rotation.targetMinutes) total += Math.max(0, entry.minutes);
  if (total <= 0) return shares;
  for (const entry of rotation.targetMinutes) {
    shares.set(entry.playerVersionId, Math.max(0, entry.minutes) / total);
  }
  return shares;
}
function teamRatesOf(
  summaries: readonly SeasonGameSummary[],
  rotations: readonly SeasonRotation[],
  franchiseId: string,
): AiTeamRates {
  const shares = minuteShares(rotations, franchiseId);
  let games = 0;
  let possessions = 0;
  let weightedThrees = 0;
  let weightedPoints = 0;
  let weightedFreeThrows = 0;
  let threesAllowed = 0;
  let pointsAllowed = 0;
  for (const summary of summaries) {
    if (summary.status !== 'final') continue;
    const isHome = summary.homeFranchiseId === franchiseId;
    if (!isHome && summary.awayFranchiseId !== franchiseId) continue;
    const ownBox = isHome ? summary.homeBox : summary.awayBox;
    const ownLines = isHome ? summary.homePlayers : summary.awayPlayers;
    const oppBox = isHome ? summary.awayBox : summary.homeBox;
    games += 1;
    possessions += ownBox.possessions;
    threesAllowed += oppBox.threePointersMade;
    pointsAllowed += oppBox.points;
    for (const line of ownLines) {
      const share = shares.get(line.playerVersionId) ?? 0;
      weightedThrees += share * line.threePointersMade;
      weightedPoints += share * line.points;
      weightedFreeThrows += share * line.freeThrowsMade;
    }
  }
  if (games === 0) {
    return {
      games: 0,
      possessionsPerGame: 0,
      weightedThreesPerGame: 0,
      weightedPointsPerGame: 0,
      weightedFreeThrowsPerGame: 0,
      threesAllowedPerGame: 0,
      pointsAllowedPerGame: 0,
    };
  }
  return {
    games,
    possessionsPerGame: possessions / games,
    weightedThreesPerGame: weightedThrees / games,
    weightedPointsPerGame: weightedPoints / games,
    weightedFreeThrowsPerGame: weightedFreeThrows / games,
    threesAllowedPerGame: threesAllowed / games,
    pointsAllowedPerGame: pointsAllowed / games,
  };
}
function mean(values: readonly number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}
function standardDeviation(values: readonly number[], center: number): number {
  if (values.length === 0) return 1;
  const variance =
    values.reduce((sum, value) => sum + (value - center) * (value - center), 0) / values.length;
  return Math.sqrt(variance) || 1;
}
function winProbabilityFromEdge(edge: number): number {
  return 1 / (1 + Math.exp(-edge));
}
const AI_OVERTIME_TIE_PROBABILITY = 0.06;
const AI_OVERTIME_MEAN_WIN = 0.5;

// The race score blends regulation edge with a league-mean overtime term. The
// mean opponent reuses the AI's own rates, so both race distributions match and
// the overtime term is exactly one half by symmetry; no DP run is needed.
function overtimeMeanWinProbability(): number {
  return AI_OVERTIME_MEAN_WIN;
}
export function srsRuleScorerFor(
  data: AiSelectionDataSource,
  franchiseId: string,
): AiInnovationScorer {
  return srsScorerForContext(srsContextOf(data), franchiseId);
}
interface SrsContext {
  data: AiSelectionDataSource;
  ratesByTeam: Map<string, AiTeamRates>;
  deepMean: number;
  deepSd: number;
  deepAllowedMean: number;
  deepAllowedSd: number;
  paceMean: number;
  paceSd: number;
  pointsMean: number;
  pointsSd: number;
  pointsAllowedMean: number;
  pointsAllowedSd: number;
}
function srsContextOf(data: AiSelectionDataSource): SrsContext {
  const teamIds = new Set<string>();
  for (const summary of data.summaries) {
    if (summary.status !== 'final') continue;
    teamIds.add(summary.homeFranchiseId);
    teamIds.add(summary.awayFranchiseId);
  }
  for (const game of data.schedule.games) {
    teamIds.add(game.homeFranchiseId);
    teamIds.add(game.awayFranchiseId);
  }
  const ratesByTeam = new Map<string, AiTeamRates>();
  for (const id of teamIds) ratesByTeam.set(id, teamRatesOf(data.summaries, data.rotations, id));
  const sampled = [...ratesByTeam.values()].filter((rates) => rates.games > 0);
  const meanOf = (pick: (rates: AiTeamRates) => number): number => mean(sampled.map(pick));
  const sdOf = (pick: (rates: AiTeamRates) => number): number => {
    const center = meanOf(pick);
    return standardDeviation(sampled.map(pick), center);
  };
  return {
    data,
    ratesByTeam,
    deepMean: meanOf((rates) => rates.weightedThreesPerGame),
    deepSd: sdOf((rates) => rates.weightedThreesPerGame),
    deepAllowedMean: meanOf((rates) => rates.threesAllowedPerGame),
    deepAllowedSd: sdOf((rates) => rates.threesAllowedPerGame),
    paceMean: meanOf((rates) => rates.possessionsPerGame),
    paceSd: sdOf((rates) => rates.possessionsPerGame),
    pointsMean: meanOf((rates) => rates.weightedPointsPerGame),
    pointsSd: sdOf((rates) => rates.weightedPointsPerGame),
    pointsAllowedMean: meanOf((rates) => rates.pointsAllowedPerGame),
    pointsAllowedSd: sdOf((rates) => rates.pointsAllowedPerGame),
  };
}
function srsScorerForContext(ctx: SrsContext, franchiseId: string): AiInnovationScorer {
  const data = ctx.data;
  let own = ctx.ratesByTeam.get(franchiseId);
  if (own === undefined) {
    own = teamRatesOf(data.summaries, data.rotations, franchiseId);
    ctx.ratesByTeam.set(franchiseId, own);
  }
  const teamRates = own;
  const opponents = data.schedule.games
    .filter((game) => game.round > data.completedRounds && game.homeFranchiseId === franchiseId)
    .map((game) => game.awayFranchiseId);
  const rateOf = (fid: string): AiTeamRates => {
    let rates = ctx.ratesByTeam.get(fid);
    if (rates === undefined) {
      rates = teamRatesOf(data.summaries, data.rotations, fid);
      ctx.ratesByTeam.set(fid, rates);
    }
    return rates;
  };
  const z = (value: number, center: number, spread: number): number => (value - center) / spread;
  const overtimeMeanWin = overtimeMeanWinProbability();
  const memo = new Map<string, number>();
  const scoreAgainst = (
    innovationId: SeasonCourtInnovationId,
    opponentId: string | null,
  ): number => {
    const key = `${innovationId}|${opponentId ?? ''}`;
    const cached = memo.get(key);
    if (cached !== undefined) return cached;
    const opponent = opponentId === null ? null : rateOf(opponentId);
    const ratedOpponent = opponent !== null && opponent.games > 0 ? opponent : null;
    let score: number;
    if (innovationId === 'deep-four') {
      const allowed =
        ratedOpponent === null ? ctx.deepAllowedMean : ratedOpponent.threesAllowedPerGame;
      score = winProbabilityFromEdge(
        z(teamRates.weightedThreesPerGame, ctx.deepMean, ctx.deepSd) -
          z(allowed, ctx.deepAllowedMean, ctx.deepAllowedSd),
      );
    } else if (innovationId === 'twenty-second-clock') {
      score = winProbabilityFromEdge(z(teamRates.possessionsPerGame, ctx.paceMean, ctx.paceSd));
    } else {
      const allowed =
        ratedOpponent === null ? ctx.pointsAllowedMean : ratedOpponent.pointsAllowedPerGame;
      const regulationEdge =
        z(teamRates.weightedPointsPerGame, ctx.pointsMean, ctx.pointsSd) -
        z(allowed, ctx.pointsAllowedMean, ctx.pointsAllowedSd);
      const regulationWin = winProbabilityFromEdge(regulationEdge);
      score =
        regulationWin * (1 - AI_OVERTIME_TIE_PROBABILITY) +
        AI_OVERTIME_TIE_PROBABILITY * overtimeMeanWin;
    }
    memo.set(key, score);
    return score;
  };
  return (innovationId) => {
    if (opponents.length === 0) return scoreAgainst(innovationId, null);
    let sum = 0;
    for (const opponentId of opponents) sum += scoreAgainst(innovationId, opponentId);
    return sum / opponents.length;
  };
}
export function resolveAiCourtInnovations(input: {
  rootSeed: string;
  evolution: SeasonEvolutionState;
  humanFranchiseId: string | null;
  aiFranchiseIds: readonly string[];
  data: AiSelectionDataSource | null;
}): SeasonEvolutionState {
  const selections = {
    ...(input.evolution.selections as unknown as Record<string, SeasonEvolutionSelection>),
  };
  const shared = input.data === null ? null : srsContextOf(input.data);
  let changed = false;
  for (const franchiseId of input.aiFranchiseIds) {
    if (franchiseId === input.humanFranchiseId) continue;
    if (selections[franchiseId] !== undefined) continue;
    const scorer = shared === null ? () => 0 : srsScorerForContext(shared, franchiseId);
    const orderIndex = input.data?.aiOrderIndexOf(franchiseId) ?? 0;
    const resolved = selectAiCourtInnovation({
      rootSeed: input.rootSeed,
      franchiseId,
      scorer,
      aiOrderIndex: orderIndex,
    });
    selections[franchiseId] = {
      franchiseId: franchiseIdSchema.parse(franchiseId),
      innovationId: resolved.innovationId,
      version: SEASON_COURT_INNOVATION_VERSION,
      selectedByCommandId: null,
      aiSelected: true,
      inputDigest: resolved.inputDigest,
      candidateScores: resolved.candidateScores,
    };
    changed = true;
  }
  if (!changed) return input.evolution;
  return { ...input.evolution, selections };
}
export function evolutionWithBlockCommit(input: {
  rootSeed: string;
  blockIndex: number;
  evolution: SeasonEvolutionState;
  humanFranchiseId: string | null;
  aiFranchiseIds: readonly string[];
  data: AiSelectionDataSource | null;
}): SeasonEvolutionState {
  let evolution = input.evolution;
  if (input.blockIndex === 2 && evolution.discovery === null) {
    const discovery = createEvolutionDiscovery({ rootSeed: input.rootSeed, acceptedBlockIndex: 2 });
    if (discovery !== null) {
      evolution = {
        ...evolution,
        discovery: {
          blockIndex: 2,
          offeredInnovationIds: [...discovery.offeredInnovationIds],
          version: discovery.version,
          seed: discovery.seed,
        },
      };
    }
  }
  if (input.blockIndex === 3) {
    evolution = resolveAiCourtInnovations({
      rootSeed: input.rootSeed,
      evolution,
      humanFranchiseId: input.humanFranchiseId,
      aiFranchiseIds: input.aiFranchiseIds,
      data: input.data,
    });
  }
  return evolution;
}
