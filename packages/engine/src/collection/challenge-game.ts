import {
  COLLECTION_CATALOG_VERSION,
  COLLECTION_CHALLENGE_VERSION,
  COLLECTION_DIFFICULTY_VERSION,
  COLLECTION_GAME_ENVIRONMENT_ERA_ID,
  COLLECTION_GAME_HOME_COURT_POLICY,
  COLLECTION_GAME_REPLAY_VERSION,
  COLLECTION_GAME_RULES_VERSION,
  COLLECTION_GAME_VERSION,
  COLLECTION_OBJECTIVE_VERSION,
  COLLECTION_REWARD_VERSION,
  COLLECTION_TEAM_VERSION,
  collectionPreparedGameV3Schema,
  type CollectionActiveTeam,
  type CollectionCatalog,
  type CollectionChallengeValidationFacts,
  type CollectionDifficultyId,
  type CollectionDifficultyProfile,
  type CollectionObjectiveDefinition,
  type CollectionObjectiveId,
  type CollectionPreparedGameV3,
  type CollectionProgressionRules,
} from '@hoop-rush/data-contracts';
import { validateCollectionActiveTeam } from './active-team.ts';
import { validateCollectionChallengeTeam } from './challenges.ts';
import { generateCollectionCpuTeamV2 } from './cpu.ts';
import { resolveDifficultyRatingAdjustments } from './difficulty.ts';
import { CollectionGameError, collectionPreparedInputDigest } from './game.ts';
import { buildCollectionObjectiveFacts } from './objectives.ts';
import { resolveCollectionChallenge } from './progression.ts';
import { collectionGameIdV2, collectionGameSeedPathsV2, collectionGameSeedV2 } from './seeds.ts';

export class CollectionChallengeTeamIneligibleError extends CollectionGameError {
  readonly validation: CollectionChallengeValidationFacts;
  constructor(validation: CollectionChallengeValidationFacts) {
    super(
      'challenge-team-ineligible',
      validation.failureCode === 'challenge-roster-requirement'
        ? `challenge ${validation.challengeId} roster requirement is not met`
        : `challenge ${validation.challengeId} requires a legal committed team`,
    );
    this.validation = validation;
  }
}

export function prepareCollectionChallengeGame(input: {
  collectionId: string;
  rootSeed: string;
  gameSequence: number;
  ownedCardIds: ReadonlySet<string>;
  team: CollectionActiveTeam;
  catalog: CollectionCatalog;
  challengeId: string;
  difficultyProfiles: readonly CollectionDifficultyProfile[];
  objectiveDefinitions: readonly CollectionObjectiveDefinition[];
  selectedObjectiveId: CollectionObjectiveId | null;
  clearedDifficultyIds: readonly CollectionDifficultyId[];
  clearedChallengeIds: readonly string[];
  progression: CollectionProgressionRules;
  profileVersion: string;
  profileHash: string;
  catalogHash: string;
  rulesHash: string;
}): CollectionPreparedGameV3 {
  const challenge = resolveCollectionChallenge(input.progression, input.challengeId);
  if (challenge === undefined) {
    throw new CollectionGameError('unknown-challenge', `unknown challenge ${input.challengeId}`);
  }
  if (challenge.challengeVersion !== COLLECTION_CHALLENGE_VERSION) {
    throw new CollectionGameError(
      'challenge-version-mismatch',
      `challenge ${challenge.challengeId} version ${challenge.challengeVersion}`,
    );
  }
  const resolve = (cardId: string) => input.catalog.cards.find((card) => card.cardId === cardId);
  const teamCheck = validateCollectionActiveTeam(input.team, resolve, input.ownedCardIds);
  if (!teamCheck.ok) {
    const first = teamCheck.issues[0];
    throw new CollectionGameError(
      first?.code ?? 'illegal-starters',
      first?.message ?? 'invalid active team',
    );
  }
  const challengeCheck = validateCollectionChallengeTeam({
    definition: challenge,
    team: input.team,
    catalog: input.catalog,
    ownedCardIds: input.ownedCardIds,
  });
  if (!challengeCheck.facts.success) {
    throw new CollectionChallengeTeamIneligibleError(challengeCheck.facts);
  }
  const difficulty = input.difficultyProfiles.find(
    (profile) => profile.difficultyId === challenge.difficultyId,
  );
  if (difficulty === undefined) {
    throw new CollectionGameError(
      'challenge-difficulty-divergence',
      `challenge ${challenge.challengeId} difficulty ${challenge.difficultyId} is not packaged`,
    );
  }
  const cpu = generateCollectionCpuTeamV2(
    input.catalog,
    input.rootSeed,
    input.gameSequence,
    difficulty,
  );
  const adjustments = resolveDifficultyRatingAdjustments(input.catalog, cpu.team, difficulty);
  const objectives = buildCollectionObjectiveFacts({
    definitions: input.objectiveDefinitions,
    rootSeed: input.rootSeed,
    difficultyId: difficulty.difficultyId,
    gameSequence: input.gameSequence,
    team: input.team,
    selectedObjectiveId: input.selectedObjectiveId,
  });
  const seedPaths = collectionGameSeedPathsV2(difficulty.difficultyId, input.gameSequence);
  const seed = collectionGameSeedV2(input.rootSeed, input.gameSequence);
  const gameId = collectionGameIdV2(input.rootSeed, difficulty.difficultyId, input.gameSequence);
  const prepared: CollectionPreparedGameV3 = {
    gameVersion: COLLECTION_GAME_VERSION,
    teamVersion: COLLECTION_TEAM_VERSION,
    rewardVersion: COLLECTION_REWARD_VERSION,
    replayVersion: COLLECTION_GAME_REPLAY_VERSION,
    rulesVersion: COLLECTION_GAME_RULES_VERSION,
    difficultyVersion: COLLECTION_DIFFICULTY_VERSION,
    objectiveVersion: COLLECTION_OBJECTIVE_VERSION,
    collectionId: input.collectionId as CollectionPreparedGameV3['collectionId'],
    gameId,
    gameSequence: input.gameSequence,
    rootSeed: input.rootSeed as CollectionPreparedGameV3['rootSeed'],
    seedPaths,
    seed: seed as CollectionPreparedGameV3['seed'],
    playerTeam: input.team,
    cpuTeam: cpu.team,
    difficulty,
    construction: cpu.construction,
    adjustments,
    objectives,
    firstClearEligible: !input.clearedDifficultyIds.includes(difficulty.difficultyId),
    challenge: {
      challengeVersion: COLLECTION_CHALLENGE_VERSION,
      challengeId: challenge.challengeId,
      displayName: challenge.displayName,
      requirement: challenge.requirement,
      difficultyId: challenge.difficultyId,
      firstClearCoins: challenge.firstClearCoins,
      repeatWinCoins: challenge.repeatWinCoins,
      firstClearEligible: !input.clearedChallengeIds.includes(challenge.challengeId),
      validation: challengeCheck.facts,
    },
    environmentEraId: COLLECTION_GAME_ENVIRONMENT_ERA_ID,
    profileVersion: input.profileVersion,
    profileHash: input.profileHash as CollectionPreparedGameV3['profileHash'],
    catalogVersion: COLLECTION_CATALOG_VERSION,
    catalogHash: input.catalogHash as CollectionPreparedGameV3['catalogHash'],
    rulesHash: input.rulesHash as CollectionPreparedGameV3['rulesHash'],
    homeCourtPolicy: COLLECTION_GAME_HOME_COURT_POLICY,
    inputDigest: '0'.repeat(32),
  };
  const parsed = collectionPreparedGameV3Schema.parse(prepared);
  return { ...parsed, inputDigest: collectionPreparedInputDigest(parsed) };
}
