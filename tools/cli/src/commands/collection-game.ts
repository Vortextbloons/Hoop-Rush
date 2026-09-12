import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { z } from 'zod';
import {
  COLLECTION_CATALOG_VERSION,
  COLLECTION_GAME_REWARD_MARGIN_CAP_POINTS,
  COLLECTION_GAME_RULES_VERSION,
  COLLECTION_OBJECTIVE_IDS,
  COLLECTION_RARITY_ORDER,
  COLLECTION_REWARD_VERSION,
  canonicalJson,
  collectionGameRulesSchema,
  collectionPreparedGameUnionSchema,
  collectionScaleRewardCoins,
  eraSimulationProfileSchema,
  type CollectionCatalog,
  type CollectionDifficultyId,
  type CollectionDifficultyProfile,
  type CollectionGameResult,
  type CollectionGameRewardReceipt,
  type CollectionGameRules,
  type CollectionObjectiveDefinition,
  type CollectionObjectiveEvaluation,
  type CollectionObjectiveId,
  type CollectionPreparedGameV2,
  type CollectionRarity,
  type EraSimulationProfile,
} from '@hoop-rush/data-contracts';
import {
  checkCollectionGameResult,
  collectionGameRewardFor,
  collectionGameRewardReceiptFor,
  collectionObjectiveDefinitionsFromRules,
  collectionRewardTransactionId,
  cpuPerCardWeights,
  evaluateCollectionObjective,
  generateCollectionCpuTeamV2,
  initializeCollectionActiveTeam,
  prepareCollectionBasicGame,
  prepareCollectionBasicGameV2,
  reproduceCollectionGame,
  validateCollectionPlayableFive,
  verifyDifficultyRatingAdjustments,
  verifyMaterializedAdjustments,
} from '@hoop-rush/engine';
import { makeReport, type CliReport } from '../report.ts';
import {
  collectionGameAuditReportSchema,
  collectionGameReproduceReportSchema,
} from '../report-schemas.ts';
import { COLLECTION_GAME_CPU_LEGACY_WEIGHTS } from '../collection-game-constants.ts';
import { DEFAULT_MANIFEST, readJsonFile, sha256Hex } from './season-data.ts';
import { loadCollectionCatalog } from './collection.ts';

export const COLLECTION_GAME_AUDIT_OPTIONS: Record<string, boolean> = {
  manifest: true,
  games: true,
  format: true,
};

export const COLLECTION_GAME_REPRODUCE_OPTIONS: Record<string, boolean> = {
  input: true,
  manifest: true,
  format: true,
};

const FIXED_ROOT_SEED = 'c04c3c71061eca4c71061eca4c71061e';
const HELD_OUT_ROOT_SEED = '9a9e3e771061eca4c71061eca4c71061e';
export const COLLECTION_GAME_AUDIT_DIFFICULTIES: CollectionDifficultyId[] = [
  'street',
  'pro',
  'legend',
];
const V2_AUDIT_ROSTER_SIZE = 9;
const V2_AUDIT_MAX_SEQUENCES_PER_RANGE = 6;
const V1_ROSTER_SIZE_CYCLE = [5, 6, 7, 8, 9, 10, 11, 12];
const SCALE_BP = 10_000;

export function loadCollectionGameRules(manifestPath: string): {
  rules: CollectionGameRules;
  rulesHash: string;
} {
  const manifest = readJsonFile(manifestPath) as {
    collection?: { gameRules?: { url?: string; contentHash?: string } };
  };
  const ref = manifest.collection?.gameRules;
  if (ref?.url === undefined || ref.contentHash === undefined) {
    throw new Error(
      'manifest is missing collection.gameRules; run gen-collection-game-rules first',
    );
  }
  const resolved = resolve(dirname(manifestPath), ref.url);
  const content = readFileSync(resolved);
  const actual = sha256Hex(content);
  if (actual !== ref.contentHash) {
    throw new Error(
      `collection game rules content hash mismatch: expected ${ref.contentHash}, got ${actual}`,
    );
  }
  const parsed = collectionGameRulesSchema.safeParse(
    JSON.parse(content.toString('utf8')) as unknown,
  );
  if (!parsed.success) {
    throw new Error(
      `collection game rules fail the schema: ${parsed.error.issues[0]?.message ?? 'unknown'}`,
    );
  }
  return { rules: parsed.data, rulesHash: actual };
}

export function loadCollectionGameProfile(manifestPath: string): {
  profile: EraSimulationProfile;
  profileHash: string;
} {
  const manifest = readJsonFile(manifestPath) as {
    eraSimulationProfiles?: Array<{ eraId?: string; url?: string; contentHash?: string }>;
  };
  const ref = manifest.eraSimulationProfiles?.find((entry) => entry.eraId === '2020s');
  if (ref?.url === undefined || ref.contentHash === undefined) {
    throw new Error('manifest is missing the 2020s era simulation profile');
  }
  const resolved = resolve(dirname(manifestPath), ref.url);
  const content = readFileSync(resolved);
  const actual = sha256Hex(content);
  if (actual !== ref.contentHash) {
    throw new Error(
      `2020s profile content hash mismatch: expected ${ref.contentHash}, got ${actual}`,
    );
  }
  const parsed = eraSimulationProfileSchema.safeParse(
    JSON.parse(content.toString('utf8')) as unknown,
  );
  if (!parsed.success) {
    throw new Error(
      `2020s profile fails the schema: ${parsed.error.issues[0]?.message ?? 'unknown'}`,
    );
  }
  return { profile: parsed.data, profileHash: actual };
}

function spreadOwned(catalog: CollectionCatalog, size: number, offset: number): string[] {
  const ids = catalog.cards.map((card) => card.cardId);
  const picked: string[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < ids.length && picked.length < size; i += 1) {
    const id = ids[(offset + i * 3797) % ids.length];
    if (id === undefined || seen.has(id)) continue;
    seen.add(id);
    picked.push(id);
  }
  return picked;
}

function buildOwnedTeam(
  catalog: CollectionCatalog,
  rosterSize: number,
  baseOffset: number,
): { owned: string[]; team: ReturnType<typeof initializeCollectionActiveTeam> } | null {
  const byId = new Map(catalog.cards.map((card) => [card.cardId, card]));
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const owned = spreadOwned(catalog, rosterSize, baseOffset + attempt * 17);
    try {
      const team = initializeCollectionActiveTeam(owned, (cardId) => byId.get(cardId));
      return { owned, team };
    } catch {
      continue;
    }
  }
  return null;
}

interface AuditedV1Game {
  failures: string[];
  winner: 'home' | 'away' | null;
  overtimePeriods: number;
  exceptions: number;
  shortHanded: boolean;
  cpuRarities: CollectionRarity[];
  rewardAmount: number | null;
  rewardTransactionId: string | null;
  eventDigest: string | null;
  resultDigest: string | null;
}

function auditOneV1Game(
  catalog: CollectionCatalog,
  profile: EraSimulationProfile,
  catalogHash: string,
  rulesHash: string,
  profileHash: string,
  rootSeed: string,
  gameSequence: number,
  rosterSize: number,
): AuditedV1Game {
  const failures: string[] = [];
  const byId = new Map(catalog.cards.map((card) => [card.cardId, card]));
  const built = buildOwnedTeam(catalog, rosterSize, gameSequence * 131);
  if (built === null) {
    return {
      failures: [`no feasible ${String(rosterSize)}-card team from catalog spreads`],
      winner: null,
      overtimePeriods: 0,
      exceptions: 0,
      shortHanded: rosterSize === 5,
      cpuRarities: [],
      rewardAmount: null,
      rewardTransactionId: null,
      eventDigest: null,
      resultDigest: null,
    };
  }
  const { owned, team } = built;
  let prepared: ReturnType<typeof prepareCollectionBasicGame>;
  try {
    prepared = prepareCollectionBasicGame({
      collectionId: 'collection-game-audit',
      rootSeed,
      gameSequence,
      ownedCardIds: new Set(owned),
      team,
      catalog,
      cpuWeights: { ...COLLECTION_GAME_CPU_LEGACY_WEIGHTS },
      profileVersion: profile.profileVersion,
      profileHash,
      catalogHash,
      rulesHash,
    });
  } catch (error) {
    return {
      failures: [`prepare failed: ${(error as Error).message}`],
      winner: null,
      overtimePeriods: 0,
      exceptions: 0,
      shortHanded: rosterSize === 5,
      cpuRarities: [],
      rewardAmount: null,
      rewardTransactionId: null,
      eventDigest: null,
      resultDigest: null,
    };
  }
  const cpuRoster = [...prepared.cpuTeam.starters, ...prepared.cpuTeam.bench];
  if (cpuRoster.length !== 12) {
    failures.push(`cpu roster has ${String(cpuRoster.length)} cards, want 12`);
  }
  if (new Set(cpuRoster).size !== cpuRoster.length) {
    failures.push('cpu roster has duplicate exact cards');
  }
  const cpuPlayers = cpuRoster.map((cardId) => byId.get(cardId)?.playerId ?? 'missing');
  if (new Set(cpuPlayers).size !== cpuPlayers.length) {
    failures.push('cpu roster has duplicate canonical players');
  }
  const cpuRarities: CollectionRarity[] = [];
  for (const cardId of cpuRoster) {
    const card = byId.get(cardId);
    if (card === undefined) {
      failures.push(`cpu references unknown card ${cardId}`);
      continue;
    }
    cpuRarities.push(card.rarity);
  }
  let reproduced: ReturnType<typeof reproduceCollectionGame>;
  try {
    reproduced = reproduceCollectionGame(prepared, catalog, profile);
  } catch (error) {
    failures.push(`simulate failed: ${(error as Error).message}`);
    return {
      failures,
      winner: null,
      overtimePeriods: 0,
      exceptions: 0,
      shortHanded: rosterSize === 5,
      cpuRarities,
      rewardAmount: null,
      rewardTransactionId: null,
      eventDigest: null,
      resultDigest: null,
    };
  }
  for (const failure of checkCollectionGameResult(
    reproduced.result,
    reproduced.events,
    prepared,
    catalog,
    profile,
  )) {
    failures.push(`audit: ${failure}`);
  }
  const reward = collectionGameRewardFor(reproduced.result, prepared.gameId);
  const expected = reproduced.result.winner === 'home' ? 100 : 10;
  if (reward.amount !== expected) {
    failures.push(`reward ${String(reward.amount)} != ${String(expected)}`);
  }
  const rewardCurrency: string = reward.currency;
  if (rewardCurrency !== 'Coins') failures.push('game reward must be Coins');
  const again = collectionGameRewardFor(reproduced.result, prepared.gameId);
  if (again.transactionId !== reward.transactionId) {
    failures.push('reward transaction id is not deterministic');
  }
  let overtimePeriods = 0;
  let exceptions = 0;
  if (reproduced.result.outcome === 'completed') {
    overtimePeriods = reproduced.result.overtimePeriods;
    exceptions =
      reproduced.result.home.foulLimitExceptions.length +
      reproduced.result.away.foulLimitExceptions.length;
  }
  return {
    failures,
    winner: reproduced.result.winner,
    overtimePeriods,
    exceptions,
    shortHanded: rosterSize === 5,
    cpuRarities,
    rewardAmount: reward.amount,
    rewardTransactionId: reward.transactionId,
    eventDigest: reproduced.eventDigest,
    resultDigest: reproduced.resultDigest,
  };
}

interface DifficultyAuditStats {
  difficultyId: CollectionDifficultyId;
  games: number;
  wins: number;
  losses: number;
  cpuSequences: number;
  rosterScoreTotal: number;
  specialTotal: number;
  adjustmentFacts: number;
  boundedRatingCount: number;
  firstClearEligibleGames: number;
  firstClearGranted: number;
  objectiveEvaluations: number;
  objectiveSuccesses: number;
  maxReward: number;
}

interface ObjectiveAuditStats {
  objectiveId: CollectionObjectiveId;
  threshold: number;
  offered: number;
  selected: number;
  evaluated: number;
  successes: number;
  minActualValue: number | null;
  maxActualValue: number | null;
}

interface AuditedV2Game {
  failures: string[];
  difficultyId: CollectionDifficultyId;
  gameId: string;
  seed: string;
  cpuTeamJson: string;
  constructionJson: string;
  adjustmentsJson: string;
  eventDigest: string;
  resultDigest: string;
  winner: 'home' | 'away' | null;
  overtimePeriods: number;
  exceptions: number;
  specialCount: number;
  rosterScoreMillionths: number;
  rarities: CollectionRarity[];
  adjustmentFacts: number;
  boundedRatingCount: number;
  firstClearEligible: boolean;
  firstClearGranted: boolean;
  offeredObjectiveIds: CollectionObjectiveId[];
  evaluation: CollectionObjectiveEvaluation;
  receipt: CollectionGameRewardReceipt | null;
  receiptReproduced: boolean;
  rewardVerified: boolean;
  adjustmentVerified: boolean;
}

function objectiveActualValue(
  evaluation: CollectionObjectiveEvaluation,
  result: CollectionGameResult,
  prepared: CollectionPreparedGameV2,
): number {
  if (evaluation.kind === 'not-selected') {
    throw new Error('objectiveActualValue requires an evaluated objective');
  }
  if (evaluation.kind === 'forfeit') {
    throw new Error('objectiveActualValue requires an evaluated objective');
  }
  const condition = evaluation.condition;
  if (result.outcome !== 'completed') {
    throw new Error('objectiveActualValue requires a completed result');
  }
  switch (condition.kind) {
    case 'player-team-three-pointers-made':
      return result.home.box.threes.made;
    case 'cpu-team-points-at-most':
      return result.away.score;
    case 'player-bench-points-at-least': {
      const benchIds = new Set(prepared.playerTeam.bench);
      return result.home.players
        .filter((player) => benchIds.has(player.cardId))
        .reduce((sum, player) => sum + player.points, 0);
    }
    case 'cpu-team-turnovers-at-least':
      return result.away.box.turnovers;
    case 'player-rebound-margin-at-least': {
      const home = result.home.box.rebounds.offensive + result.home.box.rebounds.defensive;
      const away = result.away.box.rebounds.offensive + result.away.box.rebounds.defensive;
      return home - away;
    }
    case 'player-double-stat': {
      let best = 0;
      for (const player of result.home.players) {
        const categories = [
          player.points,
          player.rebounds.total,
          player.assists,
          player.steals,
          player.blocks,
        ].filter((value) => value >= condition.threshold).length;
        best = Math.max(best, categories);
      }
      return best;
    }
  }
}

function verifyObjectiveEvaluation(
  prepared: CollectionPreparedGameV2,
  result: CollectionGameResult,
  evaluation: CollectionObjectiveEvaluation,
  failures: string[],
): void {
  const selected = prepared.objectives.selectedObjectiveId;
  if (evaluation.kind === 'not-selected') {
    if (selected !== null)
      failures.push('objective: not-selected evaluation for a selected objective');
    return;
  }
  if (evaluation.objectiveId !== selected) {
    failures.push(
      `objective: evaluation ${evaluation.objectiveId} != selection ${String(selected)}`,
    );
    return;
  }
  if (evaluation.kind === 'forfeit') {
    if (result.outcome !== 'forfeit')
      failures.push('objective: forfeit evaluation for a completed game');
    return;
  }
  if (result.outcome !== 'completed') {
    failures.push('objective: completed evaluation for a non-completed game');
    return;
  }
  const actual = objectiveActualValue(evaluation, result, prepared);
  if (actual !== evaluation.actualValue) {
    failures.push(
      `objective ${evaluation.objectiveId}: actual ${String(evaluation.actualValue)} != recomputed ${String(actual)}`,
    );
  }
  const threshold = evaluation.condition.threshold;
  const success =
    evaluation.condition.kind === 'cpu-team-points-at-most'
      ? actual <= threshold
      : evaluation.condition.kind === 'player-double-stat'
        ? actual >= evaluation.condition.categories
        : actual >= threshold;
  if (success !== evaluation.success) {
    failures.push(`objective ${evaluation.objectiveId}: success flag does not reproduce`);
  }
}

function verifyRewardReceipt(input: {
  prepared: CollectionPreparedGameV2;
  result: CollectionGameResult;
  evaluation: CollectionObjectiveEvaluation;
  receipt: CollectionGameRewardReceipt;
  failures: string[];
}): boolean {
  const { prepared, result, evaluation, receipt } = input;
  const failures = input.failures;
  let ok = true;
  const measured = receipt.components.reduce((sum, component) => sum + component.amount, 0);
  if (measured !== receipt.total) {
    failures.push(`reward: total ${String(receipt.total)} != components ${String(measured)}`);
    ok = false;
  }
  const kinds = new Set<string>();
  for (const component of receipt.components) {
    if (kinds.has(component.kind)) {
      failures.push(`reward: duplicate component ${component.kind}`);
      ok = false;
    }
    kinds.add(component.kind);
    const scaled = collectionScaleRewardCoins(component.baseAmount, component.multiplierBp);
    if (component.amount !== scaled) {
      failures.push(
        `reward ${component.kind}: amount ${String(component.amount)} != scaled ${String(scaled)}`,
      );
      ok = false;
    }
    const expectedTxn = collectionRewardTransactionId(
      prepared.gameId,
      COLLECTION_REWARD_VERSION,
      component.kind,
    );
    if (component.transactionId !== expectedTxn) {
      failures.push(`reward ${component.kind}: nondeterministic transaction id`);
      ok = false;
    }
    if (component.kind === 'margin') {
      if (component.marginPoints === undefined || component.baseAmount !== component.marginPoints) {
        failures.push('reward margin: points and base amount disagree');
        ok = false;
      } else if (component.marginPoints > COLLECTION_GAME_REWARD_MARGIN_CAP_POINTS) {
        failures.push('reward margin: cap exceeded');
        ok = false;
      }
      if (!(receipt.playerWin && receipt.gameOutcome === 'completed')) {
        failures.push('reward margin: component without a completed win');
        ok = false;
      }
    }
    if (
      component.kind === 'objective' &&
      component.objectiveId !== prepared.objectives.selectedObjectiveId
    ) {
      failures.push('reward objective: component objective mismatch');
      ok = false;
    }
    if (component.kind === 'first-clear' && component.multiplierBp !== SCALE_BP) {
      failures.push('reward first clear: multiplier is not 1x');
      ok = false;
    }
  }
  const expectedObjective = evaluation.kind === 'evaluated' && evaluation.success;
  if (receipt.objectiveSucceeded !== expectedObjective) {
    failures.push('reward: objective success flag does not reproduce');
    ok = false;
  }
  const expectedFirstClear =
    result.outcome === 'completed' && result.winner === 'home' && prepared.firstClearEligible;
  if (receipt.firstClearGranted !== expectedFirstClear) {
    failures.push('reward: first-clear grant does not reproduce');
    ok = false;
  }
  if (receipt.difficultyId !== prepared.difficulty.difficultyId) {
    failures.push('reward: difficulty id mismatch');
    ok = false;
  }
  const again = collectionGameRewardReceiptFor({
    gameId: prepared.gameId,
    prepared,
    result,
    evaluation,
  });
  if (canonicalJson(again) !== canonicalJson(receipt)) {
    failures.push('reward: receipt does not reproduce');
    ok = false;
  }
  return ok;
}

function verifyCpuConstruction(input: {
  catalog: CollectionCatalog;
  difficulty: CollectionDifficultyProfile;
  prepared: CollectionPreparedGameV2;
  failures: string[];
}): { specialCount: number; rarities: CollectionRarity[]; rosterScoreMillionths: number } {
  const { catalog, difficulty, prepared, failures } = input;
  const byId = new Map(catalog.cards.map((card) => [card.cardId, card]));
  const roster = [...prepared.cpuTeam.starters, ...prepared.cpuTeam.bench];
  const rarities: CollectionRarity[] = [];
  let specialCount = 0;
  if (prepared.construction.candidateCount !== difficulty.candidateTeams) {
    failures.push(
      `cpu: candidate count ${String(prepared.construction.candidateCount)} != ${String(difficulty.candidateTeams)}`,
    );
  }
  if (prepared.construction.chosenCandidateIndex >= prepared.construction.candidateCount) {
    failures.push('cpu: chosen candidate index out of range');
  }
  const floorIndex = COLLECTION_RARITY_ORDER.indexOf(difficulty.rarityBand.floor);
  const ceilingIndex = COLLECTION_RARITY_ORDER.indexOf(difficulty.rarityBand.ceiling);
  for (const cardId of roster) {
    const card = byId.get(cardId);
    if (card === undefined) {
      failures.push(`cpu: roster references unknown card ${cardId}`);
      continue;
    }
    rarities.push(card.rarity);
    if (card.family !== 'Base') specialCount += 1;
    const rarityIndex = COLLECTION_RARITY_ORDER.indexOf(card.rarity);
    if (rarityIndex < floorIndex || rarityIndex > ceilingIndex) {
      failures.push(
        `cpu: ${card.rarity} card ${cardId} is outside the ${difficulty.difficultyId} band`,
      );
    }
  }
  if (specialCount !== prepared.construction.specialCount) {
    failures.push(
      `cpu: special count ${String(prepared.construction.specialCount)} != ${String(specialCount)}`,
    );
  }
  const totalMinutes = prepared.cpuTeam.targetMinutes.reduce(
    (sum, entry) => sum + entry.minutes,
    0,
  );
  if (totalMinutes !== 240) {
    failures.push(`cpu: target minutes ${String(totalMinutes)} != 240`);
  }
  const starters = prepared.cpuTeam.starters;
  if (starters.length !== 5) failures.push(`cpu: ${String(starters.length)} starters, want 5`);
  const playable = validateCollectionPlayableFive(starters, (cardId) => byId.get(cardId));
  if (!playable.ok) {
    failures.push(
      `cpu: starters are not a legal G/G/F/F/C five: ${playable.issues[0]?.message ?? ''}`,
    );
  }
  if (new Set(roster).size !== roster.length) failures.push('cpu: duplicate exact cards');
  const players = roster.map((cardId) => byId.get(cardId)?.playerId ?? 'missing');
  if (new Set(players).size !== players.length) failures.push('cpu: duplicate canonical players');
  const chosenScore = prepared.construction.candidates[prepared.construction.chosenCandidateIndex];
  return {
    specialCount,
    rarities,
    rosterScoreMillionths: chosenScore?.score.rosterScoreMillionths ?? 0,
  };
}

function auditOneV2Game(input: {
  catalog: CollectionCatalog;
  rules: CollectionGameRules;
  difficulty: CollectionDifficultyProfile;
  objectiveDefinitions: readonly CollectionObjectiveDefinition[];
  profile: EraSimulationProfile;
  catalogHash: string;
  rulesHash: string;
  profileHash: string;
  rootSeed: string;
  gameSequence: number;
  rosterSize: number;
  objectiveId: CollectionObjectiveId | null;
  clearedDifficultyIds: CollectionDifficultyId[];
}): AuditedV2Game {
  const failures: string[] = [];
  const difficultyId = input.difficulty.difficultyId;
  const built = buildOwnedTeam(input.catalog, input.rosterSize, input.gameSequence * 131 + 4096);
  const empty: AuditedV2Game = {
    failures,
    difficultyId,
    gameId: '',
    seed: '',
    cpuTeamJson: '',
    constructionJson: '',
    adjustmentsJson: '',
    eventDigest: '',
    resultDigest: '',
    winner: null,
    overtimePeriods: 0,
    exceptions: 0,
    specialCount: 0,
    rosterScoreMillionths: 0,
    rarities: [],
    adjustmentFacts: 0,
    boundedRatingCount: 0,
    firstClearEligible: false,
    firstClearGranted: false,
    offeredObjectiveIds: [],
    evaluation: { kind: 'not-selected' },
    receipt: null,
    receiptReproduced: false,
    rewardVerified: false,
    adjustmentVerified: false,
  };
  if (built === null) {
    failures.push(`no feasible ${String(input.rosterSize)}-card team from catalog spreads`);
    return empty;
  }
  const { owned, team } = built;
  let prepared: CollectionPreparedGameV2;
  try {
    prepared = prepareCollectionBasicGameV2({
      collectionId: 'collection-game-audit-v2',
      rootSeed: input.rootSeed,
      gameSequence: input.gameSequence,
      ownedCardIds: new Set(owned),
      team,
      catalog: input.catalog,
      difficulty: input.difficulty,
      objectiveDefinitions: input.objectiveDefinitions,
      selectedObjectiveId: input.objectiveId,
      clearedDifficultyIds: input.clearedDifficultyIds,
      profileVersion: input.profile.profileVersion,
      profileHash: input.profileHash,
      catalogHash: input.catalogHash,
      rulesHash: input.rulesHash,
    });
  } catch (error) {
    failures.push(`v2 prepare failed: ${(error as Error).message}`);
    return empty;
  }
  const cpuRoster = [...prepared.cpuTeam.starters, ...prepared.cpuTeam.bench];
  if (cpuRoster.length !== 12)
    failures.push(`cpu roster has ${String(cpuRoster.length)} cards, want 12`);
  const cpu = verifyCpuConstruction({
    catalog: input.catalog,
    difficulty: input.difficulty,
    prepared,
    failures,
  });
  const offers = prepared.objectives.offers;
  if (offers.length !== 3) failures.push(`objectives: ${String(offers.length)} offers, want 3`);
  const offeredIds = new Set(offers.map((offer) => offer.objectiveId));
  if (offeredIds.size !== offers.length) failures.push('objectives: duplicate offers');
  if (
    prepared.objectives.selectedObjectiveId !== null &&
    !offeredIds.has(prepared.objectives.selectedObjectiveId)
  ) {
    failures.push('objectives: selection is not among the offers');
  }
  const expectedFacts = input.difficulty.ratingShift === 0 ? 0 : cpuRoster.length;
  if (prepared.adjustments.facts.length !== expectedFacts) {
    failures.push(
      `adjustments: ${String(prepared.adjustments.facts.length)} facts != ${String(expectedFacts)}`,
    );
  }
  const boundedRatingCount = prepared.adjustments.facts.reduce(
    (sum, fact) => sum + fact.boundedRatings.length,
    0,
  );
  const adjustmentFailures = [
    ...verifyDifficultyRatingAdjustments(prepared, input.catalog),
    ...verifyMaterializedAdjustments(prepared, input.catalog),
  ];
  for (const failure of adjustmentFailures) failures.push(`adjustments: ${failure}`);
  const adjustmentVerified = adjustmentFailures.length === 0;
  let reproduced: ReturnType<typeof reproduceCollectionGame> | null = null;
  try {
    reproduced = reproduceCollectionGame(prepared, input.catalog, input.profile);
  } catch (error) {
    failures.push(`v2 simulate failed: ${(error as Error).message}`);
  }
  if (reproduced === null) {
    return {
      ...empty,
      ...cpu,
      failures,
      adjustmentFacts: prepared.adjustments.facts.length,
      boundedRatingCount,
      adjustmentVerified,
    };
  }
  if (reproduced.result.gameVersion !== 'collection-game-v2') {
    failures.push('v2 audit produced a legacy result version');
    return {
      ...empty,
      ...cpu,
      failures,
      adjustmentFacts: prepared.adjustments.facts.length,
      boundedRatingCount,
      adjustmentVerified,
    };
  }
  const result = reproduced.result;
  for (const failure of checkCollectionGameResult(
    result,
    reproduced.events,
    prepared,
    input.catalog,
    input.profile,
  )) {
    failures.push(`audit: ${failure}`);
  }
  const evaluation = evaluateCollectionObjective({ prepared, result });
  verifyObjectiveEvaluation(prepared, result, evaluation, failures);
  const receipt = collectionGameRewardReceiptFor({
    gameId: prepared.gameId,
    prepared,
    result,
    evaluation,
  });
  const rewardVerified = verifyRewardReceipt({
    prepared,
    result,
    evaluation,
    receipt,
    failures,
  });
  const secondReceipt = collectionGameRewardReceiptFor({
    gameId: prepared.gameId,
    prepared,
    result,
    evaluation,
  });
  const receiptReproduced = canonicalJson(secondReceipt) === canonicalJson(receipt);
  if (!receiptReproduced) failures.push('reward: second computation diverged');
  let overtimePeriods = 0;
  let exceptions = 0;
  if (result.outcome === 'completed') {
    overtimePeriods = result.overtimePeriods;
    exceptions = result.home.foulLimitExceptions.length + result.away.foulLimitExceptions.length;
  }
  return {
    failures,
    difficultyId,
    gameId: prepared.gameId,
    seed: prepared.seed,
    cpuTeamJson: canonicalJson(prepared.cpuTeam),
    constructionJson: canonicalJson(prepared.construction),
    adjustmentsJson: canonicalJson(prepared.adjustments),
    eventDigest: reproduced.eventDigest,
    resultDigest: reproduced.resultDigest,
    winner: result.winner,
    overtimePeriods,
    exceptions,
    specialCount: cpu.specialCount,
    rosterScoreMillionths: cpu.rosterScoreMillionths,
    rarities: cpu.rarities,
    adjustmentFacts: prepared.adjustments.facts.length,
    boundedRatingCount,
    firstClearEligible: prepared.firstClearEligible,
    firstClearGranted: receipt.firstClearGranted,
    offeredObjectiveIds: offers.map((offer) => offer.objectiveId),
    evaluation,
    receipt,
    receiptReproduced,
    rewardVerified,
    adjustmentVerified,
  };
}

function auditCpuSweep(input: {
  catalog: CollectionCatalog;
  difficulty: CollectionDifficultyProfile;
  rootSeed: string;
  sequenceOffset: number;
  sequences: number;
}): { failures: string[]; sequences: number; specialTotal: number; rosterScoreTotal: number } {
  const failures: string[] = [];
  let specialTotal = 0;
  let rosterScoreTotal = 0;
  const byId = new Map(input.catalog.cards.map((card) => [card.cardId, card]));
  for (let index = 0; index < input.sequences; index += 1) {
    const gameSequence = input.sequenceOffset + index;
    let generated: ReturnType<typeof generateCollectionCpuTeamV2>;
    try {
      generated = generateCollectionCpuTeamV2(
        input.catalog,
        input.rootSeed,
        gameSequence,
        input.difficulty,
      );
    } catch (error) {
      failures.push(
        `cpu sweep ${input.difficulty.difficultyId}/${String(gameSequence)}: ${(error as Error).message}`,
      );
      continue;
    }
    const roster = [...generated.team.starters, ...generated.team.bench];
    if (roster.length !== 12) failures.push('cpu sweep: roster size != 12');
    if (new Set(roster).size !== roster.length) failures.push('cpu sweep: duplicate exact cards');
    const players = roster.map((cardId) => byId.get(cardId)?.playerId ?? 'missing');
    if (new Set(players).size !== players.length)
      failures.push('cpu sweep: duplicate canonical players');
    const floorIndex = COLLECTION_RARITY_ORDER.indexOf(input.difficulty.rarityBand.floor);
    const ceilingIndex = COLLECTION_RARITY_ORDER.indexOf(input.difficulty.rarityBand.ceiling);
    for (const cardId of roster) {
      const card = byId.get(cardId);
      if (card === undefined) {
        failures.push(`cpu sweep: unknown card ${cardId}`);
        continue;
      }
      const rarityIndex = COLLECTION_RARITY_ORDER.indexOf(card.rarity);
      if (rarityIndex < floorIndex || rarityIndex > ceilingIndex) {
        failures.push(
          `cpu sweep: ${card.rarity} outside the ${input.difficulty.difficultyId} band`,
        );
      }
      if (card.family !== 'Base') specialTotal += 1;
    }
    const totalMinutes = generated.team.targetMinutes.reduce(
      (sum, entry) => sum + entry.minutes,
      0,
    );
    if (totalMinutes !== 240) failures.push('cpu sweep: minutes != 240');
    const playable = validateCollectionPlayableFive(generated.team.starters, (cardId) =>
      byId.get(cardId),
    );
    if (!playable.ok) failures.push('cpu sweep: starters are not a legal five');
    const chosen = generated.construction.candidates[generated.construction.chosenCandidateIndex];
    rosterScoreTotal += chosen?.score.rosterScoreMillionths ?? 0;
  }
  return { failures, sequences: input.sequences, specialTotal, rosterScoreTotal };
}

export function collectionGameAudit(args: {
  manifest: string | null;
  games: string | null;
}): CliReport {
  const manifestPath = args.manifest ?? DEFAULT_MANIFEST;
  const perRange = Math.max(8, Number.parseInt(args.games ?? '24', 10) || 24);
  let loaded: { catalog: CollectionCatalog; catalogHash: string };
  try {
    loaded = loadCollectionCatalog(manifestPath);
  } catch (error) {
    return makeReport(
      'collection game-audit',
      { manifest: manifestPath },
      {
        failures: [(error as Error).message],
        exitCode: 2,
      },
    );
  }
  let rules: CollectionGameRules;
  let rulesHash: string;
  let profile: EraSimulationProfile;
  let profileHash: string;
  try {
    ({ rules, rulesHash } = loadCollectionGameRules(manifestPath));
    ({ profile, profileHash } = loadCollectionGameProfile(manifestPath));
  } catch (error) {
    return makeReport(
      'collection game-audit',
      { manifest: manifestPath },
      {
        failures: [(error as Error).message],
        exitCode: 2,
      },
    );
  }
  const { catalog, catalogHash } = loaded;
  const failures: string[] = [];
  const details: string[] = [];
  const rulesVersion: string = rules.rulesVersion;
  if (rulesVersion !== COLLECTION_GAME_RULES_VERSION) {
    failures.push(`rules version ${rulesVersion} unexpected`);
  }
  try {
    const perCard = cpuPerCardWeights(catalog, { ...COLLECTION_GAME_CPU_LEGACY_WEIGHTS });
    const specials = catalog.cards.filter((card) => card.family !== 'Base');
    if (specials.length !== 12) {
      failures.push(`catalog has ${String(specials.length)} specials, want 12`);
    }
    for (const special of specials) {
      if (!((perCard.get(special.cardId) ?? 0) > 0)) {
        failures.push(`special ${special.cardId} has no positive cpu weight`);
        break;
      }
    }
  } catch (error) {
    failures.push(`cpu weights invalid: ${(error as Error).message}`);
  }

  const ranges = [
    { label: 'fixed', rootSeed: FIXED_ROOT_SEED },
    { label: 'held-out', rootSeed: HELD_OUT_ROOT_SEED },
  ];
  let wins = 0;
  let losses = 0;
  let shortHandedGames = 0;
  let overtimeGames = 0;
  let foulLimitExceptions = 0;
  let v1Reproductions = 0;
  const rarityCounts: Record<string, number> = {};
  const seenTransactions = new Set<string>();
  for (const range of ranges) {
    let rangeGames = 0;
    let rangeShortHanded = 0;
    const rangeRarities: CollectionRarity[] = [];
    for (let game = 0; game < perRange; game += 1) {
      const rosterSize = V1_ROSTER_SIZE_CYCLE[game % V1_ROSTER_SIZE_CYCLE.length] ?? 5;
      const audited = auditOneV1Game(
        catalog,
        profile,
        catalogHash,
        rulesHash,
        profileHash,
        range.rootSeed,
        game,
        rosterSize,
      );
      for (const failure of audited.failures) {
        failures.push(`${range.label} v1 game ${String(game)}: ${failure}`);
      }
      v1Reproductions += 1;
      rangeGames += 1;
      if (audited.winner === 'home') wins += 1;
      if (audited.winner === 'away') losses += 1;
      if (audited.overtimePeriods > 0) overtimeGames += 1;
      foulLimitExceptions += audited.exceptions;
      if (audited.shortHanded) {
        shortHandedGames += 1;
        rangeShortHanded += 1;
      }
      for (const rarity of audited.cpuRarities) {
        rangeRarities.push(rarity);
        rarityCounts[rarity] = (rarityCounts[rarity] ?? 0) + 1;
      }
      if (audited.rewardTransactionId !== null) {
        if (seenTransactions.has(audited.rewardTransactionId)) {
          failures.push(`${range.label} game ${String(game)}: duplicate reward transaction id`);
        }
        seenTransactions.add(audited.rewardTransactionId);
      }
    }
    if (rangeShortHanded === 0) {
      failures.push(`${range.label}: no short-handed games completed`);
    }
    const picks = rangeRarities.length;
    const share = (rarity: CollectionRarity): number =>
      picks === 0 ? 0 : rangeRarities.filter((entry) => entry === rarity).length / picks;
    if (picks > 0) {
      if (share('Ember') < 0.55 || share('Ember') > 0.85) {
        failures.push(
          `${range.label}: Ember share ${share('Ember').toFixed(3)} outside [0.55, 0.85]`,
        );
      }
      if (share('Eruption') < 0.12 || share('Eruption') > 0.34) {
        failures.push(
          `${range.label}: Eruption share ${share('Eruption').toFixed(3)} outside [0.12, 0.34]`,
        );
      }
      if (rangeRarities.filter((entry) => entry === 'Apex').length < 1) {
        failures.push(`${range.label}: no Apex cpu cards sampled`);
      }
      if (share('Titan') > 0.12) {
        failures.push(`${range.label}: Titan share ${share('Titan').toFixed(3)} above 0.12`);
      }
      if (rangeRarities.filter((entry) => entry === 'Eclipse').length > 8) {
        failures.push(`${range.label}: too many Eclipse cpu cards`);
      }
      if (rangeRarities.filter((entry) => entry === 'Immortal').length > 3) {
        failures.push(`${range.label}: too many Immortal cpu cards`);
      }
    }
    details.push(
      `${range.label}: ${String(rangeGames)} v1 games · short-handed ${String(rangeShortHanded)} · Ember ${share('Ember').toFixed(3)} / Eruption ${share('Eruption').toFixed(3)}`,
    );
  }

  const objectiveDefinitions = collectionObjectiveDefinitionsFromRules(rules);
  const difficultyStats = new Map<CollectionDifficultyId, DifficultyAuditStats>();
  for (const difficulty of rules.difficulties) {
    difficultyStats.set(difficulty.difficultyId, {
      difficultyId: difficulty.difficultyId,
      games: 0,
      wins: 0,
      losses: 0,
      cpuSequences: 0,
      rosterScoreTotal: 0,
      specialTotal: 0,
      adjustmentFacts: 0,
      boundedRatingCount: 0,
      firstClearEligibleGames: 0,
      firstClearGranted: 0,
      objectiveEvaluations: 0,
      objectiveSuccesses: 0,
      maxReward: 0,
    });
  }
  const objectiveStats = new Map<CollectionObjectiveId, ObjectiveAuditStats>();
  for (const objectiveId of COLLECTION_OBJECTIVE_IDS) {
    const definition = objectiveDefinitions.find((entry) => entry.objectiveId === objectiveId);
    objectiveStats.set(objectiveId, {
      objectiveId,
      threshold: definition?.condition.threshold ?? 0,
      offered: 0,
      selected: 0,
      evaluated: 0,
      successes: 0,
      minActualValue: null,
      maxActualValue: null,
    });
  }
  let v2Reproductions = 0;
  let selectionInvariantGames = 0;
  let deterministicIds = 0;
  let adjustmentChecks = 0;
  let rewardChecks = 0;
  const cpuSweepSequences = Math.max(4, Math.min(perRange, 12));

  for (const range of ranges) {
    for (const difficulty of rules.difficulties) {
      const stats = difficultyStats.get(difficulty.difficultyId);
      if (stats === undefined) continue;
      const invarianceBySequence = new Map<
        string,
        {
          gameId: string;
          seed: string;
          cpuTeamJson: string;
          constructionJson: string;
          adjustmentsJson: string;
          eventDigest: string;
          resultDigest: string;
        }
      >();
      const selectedObjectives = new Set<CollectionObjectiveId>();
      const register = (
        audited: AuditedV2Game,
        selectedObjectiveId: CollectionObjectiveId | null,
        gameSequence: number,
      ): void => {
        for (const failure of audited.failures) {
          failures.push(
            `${range.label} v2 ${difficulty.difficultyId} game ${String(gameSequence)} objective ${selectedObjectiveId ?? 'none'}: ${failure}`,
          );
        }
        stats.games += 1;
        v2Reproductions += 1;
        if (audited.winner === 'home') stats.wins += 1;
        if (audited.winner === 'away') stats.losses += 1;
        stats.rosterScoreTotal += audited.rosterScoreMillionths;
        stats.specialTotal += audited.specialCount;
        stats.adjustmentFacts += audited.adjustmentFacts;
        stats.boundedRatingCount += audited.boundedRatingCount;
        if (audited.firstClearEligible) stats.firstClearEligibleGames += 1;
        if (audited.firstClearGranted) stats.firstClearGranted += 1;
        if (audited.adjustmentVerified) adjustmentChecks += 1;
        if (audited.rewardVerified) rewardChecks += 1;
        if (audited.receiptReproduced) deterministicIds += 1;
        stats.maxReward = Math.max(stats.maxReward, audited.receipt?.total ?? 0);
        if (audited.overtimePeriods > 0) overtimeGames += 1;
        foulLimitExceptions += audited.exceptions;
        for (const rarity of audited.rarities) {
          rarityCounts[rarity] = (rarityCounts[rarity] ?? 0) + 1;
        }
        for (const offeredId of audited.offeredObjectiveIds) {
          const objective = objectiveStats.get(offeredId);
          if (objective !== undefined) objective.offered += 1;
        }
        if (selectedObjectiveId !== null) {
          const objective = objectiveStats.get(selectedObjectiveId);
          if (objective !== undefined) objective.selected += 1;
        }
        if (audited.evaluation.kind === 'evaluated') {
          const evaluation = audited.evaluation;
          const objective = objectiveStats.get(evaluation.objectiveId);
          stats.objectiveEvaluations += 1;
          if (evaluation.success) stats.objectiveSuccesses += 1;
          if (objective !== undefined) {
            objective.evaluated += 1;
            if (evaluation.success) objective.successes += 1;
            objective.minActualValue = Math.min(
              objective.minActualValue ?? evaluation.actualValue,
              evaluation.actualValue,
            );
            objective.maxActualValue = Math.max(
              objective.maxActualValue ?? evaluation.actualValue,
              evaluation.actualValue,
            );
          }
        }
        const invarianceKey = `${range.label}/${String(gameSequence)}`;
        const previous = invarianceBySequence.get(invarianceKey);
        const current = {
          gameId: audited.gameId,
          seed: audited.seed,
          cpuTeamJson: audited.cpuTeamJson,
          constructionJson: audited.constructionJson,
          adjustmentsJson: audited.adjustmentsJson,
          eventDigest: audited.eventDigest,
          resultDigest: audited.resultDigest,
        };
        if (previous === undefined) {
          invarianceBySequence.set(invarianceKey, current);
        } else {
          selectionInvariantGames += 1;
          for (const key of [
            'gameId',
            'seed',
            'cpuTeamJson',
            'constructionJson',
            'adjustmentsJson',
            'eventDigest',
            'resultDigest',
          ] as const) {
            if (previous[key] !== current[key]) {
              failures.push(
                `${range.label} v2 ${difficulty.difficultyId} game ${String(gameSequence)}: objective selection changed ${key} (${selectedObjectiveId ?? 'none'})`,
              );
            }
          }
        }
      };
      for (
        let gameSequence = 0;
        gameSequence < V2_AUDIT_MAX_SEQUENCES_PER_RANGE;
        gameSequence += 1
      ) {
        const none = auditOneV2Game({
          catalog,
          rules,
          difficulty,
          objectiveDefinitions,
          profile,
          catalogHash,
          rulesHash,
          profileHash,
          rootSeed: range.rootSeed,
          gameSequence,
          rosterSize: V2_AUDIT_ROSTER_SIZE,
          objectiveId: null,
          clearedDifficultyIds: [],
        });
        register(none, null, gameSequence);
        for (const objectiveId of none.offeredObjectiveIds) {
          const audited = auditOneV2Game({
            catalog,
            rules,
            difficulty,
            objectiveDefinitions,
            profile,
            catalogHash,
            rulesHash,
            profileHash,
            rootSeed: range.rootSeed,
            gameSequence,
            rosterSize: V2_AUDIT_ROSTER_SIZE,
            objectiveId,
            clearedDifficultyIds: [],
          });
          register(audited, objectiveId, gameSequence);
          selectedObjectives.add(objectiveId);
        }
        if (selectedObjectives.size === COLLECTION_OBJECTIVE_IDS.length) break;
      }
      const sweep = auditCpuSweep({
        catalog,
        difficulty,
        rootSeed: range.rootSeed,
        sequenceOffset: 1000,
        sequences: cpuSweepSequences,
      });
      for (const failure of sweep.failures) {
        failures.push(`${range.label} v2 ${difficulty.difficultyId} cpu sweep: ${failure}`);
      }
      stats.cpuSequences += sweep.sequences;
      stats.rosterScoreTotal += sweep.rosterScoreTotal;
      stats.specialTotal += sweep.specialTotal;
    }
  }

  const difficultyReports = rules.difficulties.map((difficulty) => {
    const stats = difficultyStats.get(difficulty.difficultyId);
    const games = stats?.games ?? 0;
    const sequences = (stats?.cpuSequences ?? 0) + games;
    return {
      difficultyId: difficulty.difficultyId,
      games,
      wins: stats?.wins ?? 0,
      losses: stats?.losses ?? 0,
      cpuSequences: sequences,
      meanRosterScoreMillionths:
        sequences === 0 ? 0 : Math.round((stats?.rosterScoreTotal ?? 0) / sequences),
      meanSpecialCount: sequences === 0 ? 0 : (stats?.specialTotal ?? 0) / sequences,
      adjustmentFacts: stats?.adjustmentFacts ?? 0,
      boundedRatingCount: stats?.boundedRatingCount ?? 0,
      firstClearEligibleGames: stats?.firstClearEligibleGames ?? 0,
      firstClearGranted: stats?.firstClearGranted ?? 0,
      objectiveEvaluations: stats?.objectiveEvaluations ?? 0,
      objectiveSuccesses: stats?.objectiveSuccesses ?? 0,
      maxReward: stats?.maxReward ?? 0,
    };
  });

  for (let index = 0; index < difficultyReports.length; index += 1) {
    if (index === 0) continue;
    const previous = difficultyReports[index - 1];
    const current = difficultyReports[index];
    if (previous === undefined || current === undefined) continue;
    if (current.meanRosterScoreMillionths < previous.meanRosterScoreMillionths) {
      failures.push(
        `construction quality inverts: ${current.difficultyId} ${String(current.meanRosterScoreMillionths)} < ${previous.difficultyId} ${String(previous.meanRosterScoreMillionths)}`,
      );
    }
    if (current.meanSpecialCount < previous.meanSpecialCount) {
      failures.push(
        `special share inverts: ${current.difficultyId} ${current.meanSpecialCount.toFixed(2)} < ${previous.difficultyId} ${previous.meanSpecialCount.toFixed(2)}`,
      );
    }
  }
  for (const report of difficultyReports) {
    details.push(
      `${report.difficultyId}: ${String(report.games)} games · ${String(report.cpuSequences)} cpu sequences · mean roster score ${String(report.meanRosterScoreMillionths)} · mean specials ${report.meanSpecialCount.toFixed(2)} · adjustments ${String(report.adjustmentFacts)} · objective ${String(report.objectiveSuccesses)}/${String(report.objectiveEvaluations)} · max reward ${String(report.maxReward)}`,
    );
  }

  const firstCleared = auditOneV2Game({
    catalog,
    rules,
    difficulty: rules.difficulties[0] as CollectionDifficultyProfile,
    objectiveDefinitions,
    profile,
    catalogHash,
    rulesHash,
    profileHash,
    rootSeed: FIXED_ROOT_SEED,
    gameSequence: 0,
    rosterSize: V2_AUDIT_ROSTER_SIZE,
    objectiveId: null,
    clearedDifficultyIds: ['street'],
  });
  for (const failure of firstCleared.failures) {
    failures.push(`first-clear eligibility: ${failure}`);
  }
  if (firstCleared.firstClearEligible) {
    failures.push('first-clear eligibility: a cleared difficulty stayed eligible');
  }
  if (firstCleared.firstClearGranted) {
    failures.push('first-clear eligibility: a cleared difficulty granted first clear');
  }

  const shortHandedBuilt = (() => {
    for (let offset = 0; offset < 64; offset += 1) {
      const candidate = buildOwnedTeam(catalog, 5, offset * 31);
      if (candidate !== null) return candidate;
    }
    return null;
  })();
  if (shortHandedBuilt === null) {
    failures.push('objective feasibility: no five-card team available');
  } else {
    try {
      const prepared = prepareCollectionBasicGameV2({
        collectionId: 'collection-game-audit-short',
        rootSeed: FIXED_ROOT_SEED,
        gameSequence: 0,
        ownedCardIds: new Set(shortHandedBuilt.owned),
        team: shortHandedBuilt.team,
        catalog,
        difficulty: rules.difficulties[0] as CollectionDifficultyProfile,
        objectiveDefinitions,
        selectedObjectiveId: null,
        clearedDifficultyIds: [],
        profileVersion: profile.profileVersion,
        profileHash,
        catalogHash,
        rulesHash,
      });
      if (prepared.objectives.offers.some((offer) => offer.objectiveId === 'obj-bench-spark-v1')) {
        failures.push('objective feasibility: bench spark offered to a five-card team');
      }
      try {
        prepareCollectionBasicGameV2({
          collectionId: 'collection-game-audit-short',
          rootSeed: FIXED_ROOT_SEED,
          gameSequence: 0,
          ownedCardIds: new Set(shortHandedBuilt.owned),
          team: shortHandedBuilt.team,
          catalog,
          difficulty: rules.difficulties[0] as CollectionDifficultyProfile,
          objectiveDefinitions,
          selectedObjectiveId: 'obj-bench-spark-v1',
          clearedDifficultyIds: [],
          profileVersion: profile.profileVersion,
          profileHash,
          catalogHash,
          rulesHash,
        });
        failures.push('objective feasibility: infeasible bench spark selection was accepted');
      } catch {
        // expected rejection
      }
    } catch (error) {
      failures.push(`objective feasibility check failed: ${(error as Error).message}`);
    }
  }

  details.push(
    `rewards: v1 ${String(wins)} wins / ${String(losses)} losses · overtime ${String(overtimeGames)} · foul-limit exceptions ${String(foulLimitExceptions)}`,
  );
  details.push(
    `mixed reproduction: ${String(v1Reproductions)} v1 + ${String(v2Reproductions)} v2 games · objective-selection invariance checks ${String(selectionInvariantGames)} · deterministic receipts ${String(deterministicIds)} · reward checks ${String(rewardChecks)}`,
  );
  const payload = collectionGameAuditReportSchema.parse({
    schemaVersion: 1,
    command: 'collection game-audit',
    catalogVersion: COLLECTION_CATALOG_VERSION,
    catalogHash,
    rulesVersion: rules.rulesVersion,
    rulesHash,
    profileVersion: profile.profileVersion,
    fixedGames: perRange,
    heldOutGames: perRange,
    wins,
    losses,
    rarityCounts,
    shortHandedGames,
    overtimeGames,
    foulLimitExceptions,
    difficulties: difficultyReports,
    objectives: [...objectiveStats.values()],
    v1Reproductions,
    v2Reproductions,
    selectionInvariantGames,
    deterministicIds,
    adjustmentChecks,
    rewardChecks,
  });
  return makeReport(
    'collection game-audit',
    { manifest: manifestPath },
    {
      details,
      failures,
      payload,
    },
  );
}

export const collectionGameReproduceInputSchema = z.object({
  schemaVersion: z.literal(1),
  command: z.literal('collection game-reproduce'),
  prepared: collectionPreparedGameUnionSchema,
});
export type CollectionGameReproduceInput = z.infer<typeof collectionGameReproduceInputSchema>;

export function collectionGameReproduce(args: {
  input: string | null;
  manifest: string | null;
}): CliReport {
  if (args.input === null) {
    return makeReport(
      'collection game-reproduce',
      {},
      {
        failures: ['collection game-reproduce requires --input <game.json>'],
        exitCode: 2,
      },
    );
  }
  const parsedInput = collectionGameReproduceInputSchema.safeParse(readJsonFile(args.input));
  if (!parsedInput.success) {
    return makeReport(
      'collection game-reproduce',
      { input: args.input },
      {
        failures: [
          `game input fails the schema: ${parsedInput.error.issues[0]?.message ?? 'unknown'}`,
        ],
        exitCode: 2,
      },
    );
  }
  const manifestPath = args.manifest ?? DEFAULT_MANIFEST;
  let loaded: { catalog: CollectionCatalog; catalogHash: string };
  try {
    loaded = loadCollectionCatalog(manifestPath);
  } catch (error) {
    return makeReport(
      'collection game-reproduce',
      { input: args.input },
      {
        failures: [(error as Error).message],
        exitCode: 2,
      },
    );
  }
  let profile: EraSimulationProfile;
  let profileHash: string;
  try {
    ({ profile, profileHash } = loadCollectionGameProfile(manifestPath));
  } catch (error) {
    return makeReport(
      'collection game-reproduce',
      { input: args.input },
      {
        failures: [(error as Error).message],
        exitCode: 2,
      },
    );
  }
  const { prepared } = parsedInput.data;
  if (prepared.catalogHash !== loaded.catalogHash) {
    return makeReport(
      'collection game-reproduce',
      { input: args.input },
      {
        failures: ['prepared catalog hash does not match the packaged catalog'],
        exitCode: 2,
      },
    );
  }
  if (prepared.profileHash !== profileHash) {
    return makeReport(
      'collection game-reproduce',
      { input: args.input },
      {
        failures: ['prepared profile hash does not match the packaged 2020s profile'],
        exitCode: 2,
      },
    );
  }
  let reproduced: ReturnType<typeof reproduceCollectionGame>;
  try {
    reproduced = reproduceCollectionGame(prepared, loaded.catalog, profile);
  } catch (error) {
    return makeReport(
      'collection game-reproduce',
      { input: args.input },
      {
        failures: [`reproduction failed: ${(error as Error).message}`],
        exitCode: 2,
      },
    );
  }
  const failures = checkCollectionGameResult(
    reproduced.result,
    reproduced.events,
    prepared,
    loaded.catalog,
    profile,
  );
  const gameVersion: string = prepared.gameVersion;
  let difficultyId: string | null = null;
  let objectiveSuccess: boolean | null = null;
  let rewardVersion: string;
  let rewardReason: string;
  let rewardAmount: number;
  let rewardTotal: number;
  let rewardTransactionId: string;
  const v2Result =
    reproduced.result.gameVersion === 'collection-game-v2' ? reproduced.result : null;
  if (prepared.gameVersion === 'collection-game-v1') {
    const reward = collectionGameRewardFor(reproduced.result, prepared.gameId);
    rewardVersion = reward.rewardVersion;
    rewardReason = reward.reason;
    rewardAmount = reward.amount;
    rewardTotal = reward.amount;
    rewardTransactionId = reward.transactionId;
  } else if (v2Result === null) {
    failures.push('v2 prepared input produced a legacy result version');
    rewardVersion = COLLECTION_REWARD_VERSION;
    rewardReason = 'game-win-reward';
    rewardAmount = 0;
    rewardTotal = 0;
    rewardTransactionId = 'missing';
  } else {
    const evaluation = evaluateCollectionObjective({ prepared, result: v2Result });
    objectiveSuccess = evaluation.kind === 'evaluated' ? evaluation.success : false;
    const receipt = collectionGameRewardReceiptFor({
      gameId: prepared.gameId,
      prepared,
      result: v2Result,
      evaluation,
    });
    const outcome = receipt.components.find((component) => component.kind === 'outcome');
    rewardVersion = receipt.rewardVersion;
    rewardReason = outcome?.reason ?? 'game-win-reward';
    rewardAmount = outcome?.amount ?? 0;
    rewardTotal = receipt.total;
    rewardTransactionId = outcome?.transactionId ?? 'missing';
    difficultyId = prepared.difficulty.difficultyId;
    if (evaluation.kind !== 'evaluated') objectiveSuccess = null;
    if (
      receipt.total !== receipt.components.reduce((sum, component) => sum + component.amount, 0)
    ) {
      failures.push('reward receipt total does not reconcile');
    }
    for (const component of receipt.components) {
      const expected = collectionRewardTransactionId(
        prepared.gameId,
        rewardVersion,
        component.kind,
      );
      if (component.transactionId !== expected) {
        failures.push(`reward ${component.kind} transaction id is not deterministic`);
      }
    }
  }
  const payload = collectionGameReproduceReportSchema.parse({
    schemaVersion: 1,
    command: 'collection game-reproduce',
    gameId: prepared.gameId,
    gameSequence: prepared.gameSequence,
    gameVersion,
    difficultyId,
    objectiveSuccess,
    ok: failures.length === 0,
    eventDigest: reproduced.eventDigest,
    resultDigest: reproduced.resultDigest,
    rewardVersion,
    rewardReason,
    rewardAmount,
    rewardTotal,
    rewardTransactionId,
    failures,
  });
  return makeReport(
    'collection game-reproduce',
    { input: args.input },
    {
      details:
        failures.length === 0
          ? [
              `game ${prepared.gameId} (${gameVersion}) reproduces byte-identically · event ${reproduced.eventDigest} · result ${reproduced.resultDigest} · ${rewardReason} +${String(rewardAmount)} · total ${String(rewardTotal)}`,
            ]
          : [],
      failures,
      payload,
    },
  );
}
