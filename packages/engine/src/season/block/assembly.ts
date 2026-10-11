import {
  SEASON_CHALLENGE_CATALOG,
  blockRoundRange,
  type SeasonBlockChallengeEvaluation,
  type SeasonCandidateCheckpoint,
  type SeasonChallengeDeal,
  type SeasonCheckpointVersions,
  type SeasonEffectsState,
  type SeasonGameSummary,
  type SeasonHealthState,
  type SeasonRetainedGameDetail,
  type SeasonRun,
} from '@hoop-rush/data-contracts';
import {
  auditSeasonAggregates,
  extendSeasonPlayerAggregates,
  extendSeasonTeamAggregates,
  foldSeasonPlayerAggregates,
  foldSeasonTeamAggregates,
} from '../aggregates.ts';
import { reconstructSeasonGames, seasonCheckpointDigest } from '../checkpoint.ts';
import { evaluateSeasonBlockChallenges } from '../challenges.ts';
import { SEASON_CAMPAIGN_TARGETS_VERSION, SEASON_CAMPAIGN_VERSION } from '../campaign.ts';
import {
  applySeasonBlockInfluenceGrants,
  createInitialSeasonInfluenceState,
} from '../influence.ts';
import { evaluateSeasonBlockObjective } from '../objectives.ts';
import { auditSeasonBlockRecap, buildSeasonBlockRecap } from '../recap.ts';
import { extendSeasonStandings, reduceSeasonStandings } from '../standings.ts';
import { SeasonBlockInvariantError } from './errors.ts';
import { emptyFreeAgencyStateOf } from './preparation.ts';
import type { AssembleSeasonBlockCandidateArgs, SeasonBlockSimulationInput } from './types.ts';

export function assembleSeasonBlockCandidate(
  args: AssembleSeasonBlockCandidateArgs,
): SeasonCandidateCheckpoint;
export function assembleSeasonBlockCandidate(
  input: SeasonBlockSimulationInput,
  summaries: readonly SeasonGameSummary[],
  retainedDetails: readonly SeasonRetainedGameDetail[],
  effects: SeasonEffectsState,
  health: SeasonHealthState,
): SeasonCandidateCheckpoint;
export function assembleSeasonBlockCandidate(
  argsOrInput: AssembleSeasonBlockCandidateArgs | SeasonBlockSimulationInput,
  positionalSummaries?: readonly SeasonGameSummary[],
  positionalRetainedDetails?: readonly SeasonRetainedGameDetail[],
  positionalEffects?: SeasonEffectsState,
  positionalHealth?: SeasonHealthState,
): SeasonCandidateCheckpoint {
  let input: SeasonBlockSimulationInput;
  let summaries: readonly SeasonGameSummary[];
  let retainedDetails: readonly SeasonRetainedGameDetail[];
  let effects: SeasonEffectsState;
  let health: SeasonHealthState;
  if (
    positionalSummaries !== undefined &&
    positionalRetainedDetails !== undefined &&
    positionalEffects !== undefined &&
    positionalHealth !== undefined
  ) {
    if (isAssembleSeasonBlockCandidateArgs(argsOrInput)) {
      throw new SeasonBlockInvariantError(
        'assembleSeasonBlockCandidate: ambiguous call shape (object and positional args)',
      );
    }
    input = argsOrInput;
    summaries = positionalSummaries;
    retainedDetails = positionalRetainedDetails;
    effects = positionalEffects;
    health = positionalHealth;
  } else {
    if (!isAssembleSeasonBlockCandidateArgs(argsOrInput)) {
      throw new SeasonBlockInvariantError(
        'assembleSeasonBlockCandidate: missing summaries/retainedDetails/effects/health',
      );
    }
    input = argsOrInput.input;
    summaries = argsOrInput.summaries;
    retainedDetails = argsOrInput.retainedDetails;
    effects = argsOrInput.effects;
    health = argsOrInput.health;
  }
  const command = input.command;
  const run = input.run;
  const allSummaries = [...input.priorSummaries, ...summaries];
  const freshStandingsBefore = reduceSeasonStandings(
    run.league,
    reconstructSeasonGames(input.schedule, input.priorSummaries),
  );
  const freshStandings = reduceSeasonStandings(
    run.league,
    reconstructSeasonGames(input.schedule, allSummaries),
  );
  const freshTeams = foldSeasonTeamAggregates(allSummaries);
  const freshPlayers = foldSeasonPlayerAggregates(allSummaries);
  const priorStandings = input.priorStandings;
  const priorTeamAggregates = input.priorTeamAggregates;
  const priorPlayerAggregates = input.priorPlayerAggregates;
  const canExtendAggregates =
    priorStandings !== undefined &&
    priorTeamAggregates !== undefined &&
    priorPlayerAggregates !== undefined &&
    input.priorSummaries.length > 0;
  const standingsBefore = canExtendAggregates ? priorStandings : freshStandingsBefore;
  const standings = canExtendAggregates
    ? extendSeasonStandings(run.league, priorStandings, summaries)
    : freshStandings;
  const teams = canExtendAggregates
    ? extendSeasonTeamAggregates(priorTeamAggregates, summaries)
    : freshTeams;
  const players = canExtendAggregates
    ? extendSeasonPlayerAggregates(priorPlayerAggregates, summaries)
    : freshPlayers;
  const { toRound } = blockRoundRange(command.blockIndex);
  const completedRounds = toRound;
  const participantIds = [
    ...(input.participantFranchiseIds ?? (input.humanFranchiseId ? [input.humanFranchiseId] : [])),
  ].sort();
  const primaryFranchiseId = participantIds[0] ?? input.humanFranchiseId;
  const humanRotation =
    primaryFranchiseId === null
      ? null
      : (run.rotations.find((rotation) => rotation.franchiseId === primaryFranchiseId) ?? null);
  const hasChallengeDeal =
    input.challengeDeal !== undefined ||
    input.challengeDealsByFranchise !== undefined ||
    input.challengeState !== undefined;
  const primaryDeal: SeasonChallengeDeal | null =
    input.challengeDeal ??
    (primaryFranchiseId !== null
      ? (input.challengeDealsByFranchise?.get(primaryFranchiseId) ?? null)
      : null);
  let challengeEvaluation: SeasonBlockChallengeEvaluation | null = null;
  const challengeEvaluationsByFranchise: Record<string, SeasonBlockChallengeEvaluation> = {};
  if (hasChallengeDeal && primaryDeal !== null) {
    challengeEvaluation = evaluateSeasonBlockChallenges({
      deal: primaryDeal,
      blockIndex: command.blockIndex,
      humanFranchiseId: primaryFranchiseId,
      summaries: [...summaries],
    });
    for (const pid of participantIds) {
      const dealForPid =
        input.challengeDealsByFranchise?.get(pid) ??
        (pid === primaryFranchiseId ? primaryDeal : null);
      if (dealForPid === null) continue;
      challengeEvaluationsByFranchise[pid] = evaluateSeasonBlockChallenges({
        deal: dealForPid,
        blockIndex: command.blockIndex,
        humanFranchiseId: pid,
        summaries: [...summaries],
      });
    }
  }
  const objective = evaluateSeasonBlockObjective({
    objectiveId: input.objectiveId,
    blockIndex: command.blockIndex,
    humanFranchiseId: primaryFranchiseId,
    rotation: humanRotation,
    summaries: [...summaries],
    tipAvailability: input.collectedTipAvailability ?? [],
  });
  const objectiveEvaluations: Record<
    string,
    import('@hoop-rush/data-contracts').SeasonObjectiveEvaluation
  > = {};
  const objectiveSuccessByFranchise: Record<string, boolean | null> = {};
  for (const pid of participantIds) {
    const oid =
      input.objectiveIds?.get(pid) ?? (pid === primaryFranchiseId ? input.objectiveId : null);
    const rot = run.rotations.find((r) => r.franchiseId === pid) ?? null;
    const evalRes = evaluateSeasonBlockObjective({
      objectiveId: oid,
      blockIndex: command.blockIndex,
      humanFranchiseId: pid,
      rotation: rot,
      summaries: [...summaries],
      tipAvailability: [...(input.collectedTipAvailability ?? [])],
    });
    objectiveEvaluations[pid] = evalRes.evaluation;
    objectiveSuccessByFranchise[pid] = evalRes.success;
  }
  if (participantIds.length === 0) {
    objectiveEvaluations['solo'] = objective.evaluation;
    objectiveSuccessByFranchise['solo'] = objective.success;
  }
  const campaign: {
    opportunityId: string | null;
    outcome: 'missed' | 'completed' | 'breakthrough' | null;
    evaluation: import('@hoop-rush/data-contracts').SeasonCampaignEvaluation | null;
  } = {
    opportunityId: null,
    outcome: null,
    evaluation: null,
  };
  const franchiseIds = run.league.teams.map((team) => team.franchiseId);
  const preBlockInfluence =
    input.influence ??
    (input.run as Partial<SeasonRun>).influence ??
    createInitialSeasonInfluenceState(franchiseIds);
  const grantResult = hasChallengeDeal
    ? applySeasonBlockInfluenceGrants({
        influence: preBlockInfluence,
        blockIndex: command.blockIndex,
        humanFranchiseId: primaryFranchiseId,
        participantFranchiseIds: participantIds,
        appliedAtStateRevision: input.command.expectedStateRevision + 1,
        challengeSuccesses: challengeEvaluation
          ? challengeEvaluation.results.map((result) => ({
              challengeId: result.challengeId,
              success: result.success,
              reward:
                SEASON_CHALLENGE_CATALOG.find((entry) => entry.challengeId === result.challengeId)
                  ?.reward ?? 1,
            }))
          : null,
        challengeSuccessesByFranchise: Object.fromEntries(
          Object.entries(challengeEvaluationsByFranchise).map(([franchiseId, evaluation]) => [
            franchiseId,
            evaluation.results.map((result) => ({
              challengeId: result.challengeId,
              success: result.success,
              reward:
                SEASON_CHALLENGE_CATALOG.find((entry) => entry.challengeId === result.challengeId)
                  ?.reward ?? 1,
            })),
          ]),
        ),
      })
    : applySeasonBlockInfluenceGrants({
        influence: preBlockInfluence,
        blockIndex: command.blockIndex,
        humanFranchiseId: primaryFranchiseId,
        participantFranchiseIds: participantIds,
        appliedAtStateRevision: input.command.expectedStateRevision + 1,
        objectiveSuccess: objective.success,
        objectiveSuccessByFranchise,
      });
  const postTransactions = [...(input.transactions ?? []), ...grantResult.entries];
  const recapInput = {
    runId: run.runId,
    blockIndex: command.blockIndex,
    completedRounds,
    humanFranchiseId: input.humanFranchiseId,
    summaries: allSummaries,
    standingsBefore,
    standingsAfter: standings,
    playerAggregates: players,
    schedule: input.schedule,
    rosterPlayerIds: input.rosterPlayerIds,
    health,
    objective,
    challenges: challengeEvaluation,
    campaign,
    transactions: postTransactions,
    influence: grantResult.influence,
  };
  const recap = buildSeasonBlockRecap(recapInput);
  const aggregateFailures = auditSeasonAggregates({
    teams,
    players,
    summaries: allSummaries,
    standings,
    freshTeams,
    freshPlayers,
  });
  const recapFailures = auditSeasonBlockRecap(recap, recapInput);
  if (aggregateFailures.length > 0 || recapFailures.length > 0) {
    throw new SeasonBlockInvariantError(
      `block ${String(command.blockIndex)} audit failed: ${[...aggregateFailures, ...recapFailures].join('; ')}`,
      { blockIndex: command.blockIndex },
    );
  }
  const versions: SeasonCheckpointVersions = {
    blockVersion: run.versions.blockVersion,
    summaryVersion: run.versions.summaryVersion,
    aggregatesVersion: run.versions.aggregatesVersion,
    recapVersion: run.versions.recapVersion,
    leadersVersion: run.versions.leadersVersion,
    homeCourtVersion: run.versions.homeCourtVersion,
    gameVersion: run.versions.gameVersion,
    gameTargetsVersion: run.versions.gameTargetsVersion,
    seedDerivationVersion: run.versions.seedDerivationVersion,
    staminaVersion: run.versions.staminaVersion,
    chemistryVersion: run.versions.chemistryVersion,
    effectsTargetsVersion: run.versions.effectsTargetsVersion,
    healthVersion: run.versions.healthVersion,
    tradeVersion: run.versions.tradeVersion,
    influenceVersion: run.versions.influenceVersion,
    objectiveVersion: run.versions.objectiveVersion,
    challengeVersion: run.versions.challengeVersion,
    challengeTargetsVersion: run.versions.challengeTargetsVersion,
    campaignVersion: run.versions.campaignVersion ?? SEASON_CAMPAIGN_VERSION,
    campaignTargetsVersion: run.versions.campaignTargetsVersion ?? SEASON_CAMPAIGN_TARGETS_VERSION,
    injuryTargetsVersion: run.versions.injuryTargetsVersion,
    tradeTargetsVersion: run.versions.tradeTargetsVersion,
    influenceTargetsVersion: run.versions.influenceTargetsVersion,
    freeAgencyVersion: run.versions.freeAgencyVersion,
    freeAgencyIndexVersion: run.versions.freeAgencyIndexVersion,
    freeAgencyTargetsVersion: run.versions.freeAgencyTargetsVersion,
  };
  const candidate: SeasonCandidateCheckpoint = {
    schemaVersion: 1,
    checkpointVersion: run.versions.checkpointVersion,
    runId: run.runId,
    rootSeed: run.rootSeed,
    versions,
    blockIndex: command.blockIndex,
    completedRounds,
    revision: command.expectedRevision,
    rotationDigest: command.rotationDigest,
    standings,
    teamAggregates: teams,
    playerAggregates: players,
    gameSummaries: [...summaries].sort((a, b) => (a.gameId < b.gameId ? -1 : 1)),
    retainedDetails: [...retainedDetails].sort((a, b) => (a.gameId < b.gameId ? -1 : 1)),
    recap,
    effects,
    health,
    influence: grantResult.influence,
    freeAgency: input.freeAgency ?? emptyFreeAgencyStateOf(run),
    transactions: postTransactions,
    objective: {
      objectiveId: objective.objectiveId,
      success: objective.success,
      evaluation: objective.evaluation,
    },
    objectiveEvaluations:
      Object.keys(objectiveEvaluations).length > 0 ? objectiveEvaluations : undefined,
    challenges: challengeEvaluation ?? undefined,
    challengeIds: primaryDeal
      ? ([...primaryDeal.challengeIds] as SeasonCandidateCheckpoint['challengeIds'])
      : undefined,
    campaign,
    expectedStateRevision: command.expectedStateRevision,
    expectedStateDigest: command.expectedStateDigest,
    stateRevision: 0,
    stateDigest: '0'.repeat(32),
    digest: '',
  };
  const digest = seasonCheckpointDigest(candidate);
  return { ...candidate, digest };
}

function isAssembleSeasonBlockCandidateArgs(
  value: AssembleSeasonBlockCandidateArgs | SeasonBlockSimulationInput,
): value is AssembleSeasonBlockCandidateArgs {
  return (
    'summaries' in value && 'retainedDetails' in value && 'effects' in value && 'health' in value
  );
}
