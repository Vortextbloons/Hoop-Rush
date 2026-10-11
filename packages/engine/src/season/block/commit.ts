import {
  normalizeEvolutionState,
  normalizeSponsorGearState,
  type EraSimulationProfile,
  type SeasonCandidateCheckpoint,
  type SeasonChallengeState,
  type SeasonCheckpointState,
  type SeasonDraftCatalog,
  type SeasonEffectsState,
  type SeasonEvolutionState,
  type SeasonFreeAgencyIndex,
  type SeasonFreeAgencyState,
  type SeasonFreeAgencyWindowState,
  type SeasonGameSummary,
  type SeasonObjectiveState,
  type SeasonRosterTargets,
  type SeasonRun,
  type SeasonSchedule,
  type SeasonSponsorGearState,
} from '@hoop-rush/data-contracts';
import { normalizeCampaignState } from '../campaign.ts';
import { dealSeasonBlockChallenges } from '../challenges.ts';
import { evolutionWithBlockCommit, type AiSelectionDataSource } from '../evolution.ts';
import { freeAgencyUnresolvedWindowIndex, openSeasonFreeAgencyWindow } from '../free-agency.ts';
import { generateSeasonSchedule } from '../schedule.ts';
import { sponsorsWithBlockCommit } from '../sponsors.ts';
import { seasonRunStateDigest, seasonRunStateDigestFactsOf } from '../state-digest.ts';
import { openSeasonTradeWindow, type SeasonWindowOpenResult } from '../trades.ts';
import { SeasonBlockInvariantError } from './errors.ts';

function objectivesWithBlockSuccess(
  objectives: SeasonObjectiveState | undefined,
  candidate: SeasonCandidateCheckpoint,
): SeasonObjectiveState | undefined {
  if (objectives === undefined) return undefined;
  if (candidate.blockIndex === 8) return objectives;
  if (candidate.objective === undefined) return objectives;
  const selection = objectives.selections[candidate.blockIndex];
  if (selection === undefined) return objectives;
  return {
    ...objectives,
    selections: {
      ...objectives.selections,
      [candidate.blockIndex]: { ...selection, success: candidate.objective.success },
    },
  };
}
function challengesWithBlockEvaluation(
  challenges: SeasonChallengeState | undefined,
  candidate: SeasonCandidateCheckpoint,
): SeasonChallengeState | undefined {
  if (challenges === undefined) return undefined;
  if (candidate.challenges == null) return challenges;
  const evaluation = candidate.challenges;
  const existing = challenges.evaluations.some(
    (entry) => entry.blockIndex === evaluation.blockIndex,
  );
  if (existing) return challenges;
  return {
    ...challenges,
    evaluations: [...challenges.evaluations, evaluation].sort(
      (a, b) => a.blockIndex - b.blockIndex,
    ),
  };
}

function challengesWithNextDeal(input: {
  challenges: SeasonChallengeState | undefined;
  run: SeasonRun;
  candidate: SeasonCandidateCheckpoint;
  schedule: SeasonSchedule | null;
  humanFranchiseId: string | null;
}): SeasonChallengeState | undefined {
  const { challenges, run, candidate, schedule, humanFranchiseId } = input;
  if (challenges === undefined) return undefined;
  if (humanFranchiseId === null) return challenges;
  const nextBlockIndex = candidate.blockIndex + 1;
  if (nextBlockIndex < 0 || nextBlockIndex > 7) return challenges;
  if (challenges.deals[nextBlockIndex] !== undefined) return challenges;
  if (schedule === null) return challenges;
  const deal = dealSeasonBlockChallenges(run.rootSeed, nextBlockIndex, {
    league: run.league,
    schedule,
    standings: candidate.standings,
    humanFranchiseId,
  });
  if (deal === null) return challenges;
  return {
    ...challenges,
    deals: { ...challenges.deals, [nextBlockIndex]: deal },
  };
}
function campaignWithBlockEvaluation(
  campaignState: import('@hoop-rush/data-contracts').SeasonCampaignState | undefined,
  candidate: SeasonCandidateCheckpoint,
): import('@hoop-rush/data-contracts').SeasonCampaignState | undefined {
  if (!candidate.campaign || !candidate.campaign.evaluation) return campaignState;
  const base = normalizeCampaignState(campaignState);
  const evalResult = candidate.campaign.evaluation;
  const existing = base.evaluations.some(
    (e) => e.blockIndex === evalResult.blockIndex && e.opportunityId === evalResult.opportunityId,
  );
  const evaluations = existing ? base.evaluations : [...base.evaluations, evalResult];
  const branchId =
    (
      candidate.campaign.evaluation as unknown as {
        branchId?: string;
      }
    ).branchId ?? evalResult.opportunityId.slice(0, 12);
  const nextBranchState = { ...base.branchState };
  const oppId = evalResult.opportunityId;
  const offersForBlock = base.offers[evalResult.blockIndex] ?? [];
  const opp = offersForBlock.find((o) => o.opportunityId === oppId);
  const bId = opp?.branchId ?? branchId;
  if (bId) {
    if (evalResult.outcome === 'missed') nextBranchState[bId] = 'missed';
    else if (evalResult.outcome === 'completed') nextBranchState[bId] = 'open';
    else nextBranchState[bId] = 'completed';
  }
  const applied = [...base.appliedRewardIds];
  let influenceEarned = base.rewardEntitlements.influenceEarned;
  let inquiryCredits = base.rewardEntitlements.inquiryCredits;
  let informationBenefits = base.rewardEntitlements.informationBenefits;
  const followUpUnlocks = [...base.rewardEntitlements.followUpUnlocks];
  for (const rid of evalResult.appliedRewardIds) {
    if (!applied.includes(rid)) {
      applied.push(rid);
      const allOffers = Object.values(base.offers).flat();
      const offerForReward = allOffers.find(
        (o) => o.completedReward.rewardId === rid || o.breakthroughReward?.rewardId === rid,
      );
      const reward =
        offerForReward?.completedReward.rewardId === rid
          ? offerForReward.completedReward
          : offerForReward?.breakthroughReward;
      if (reward) {
        if (reward.type === 'influence') {
          const requested = reward.amount;
          influenceEarned = Math.min(8, influenceEarned + requested);
        } else if (reward.type === 'trade-inquiry-credit') inquiryCredits += reward.amount;
        else if (reward.type === 'trade-board-information') informationBenefits += reward.amount;
        else followUpUnlocks.push(rid);
      }
    }
  }
  return {
    ...base,
    evaluations,
    branchState: nextBranchState,
    rewardEntitlements: {
      ...base.rewardEntitlements,
      influenceEarned: Math.min(8, influenceEarned),
      inquiryCredits,
      informationBenefits,
      followUpUnlocks,
    },
    appliedRewardIds: applied,
  };
}
export function deriveSeasonPostBlockState(input: {
  run: SeasonRun;
  candidate: SeasonCandidateCheckpoint;
  commandId: string;
  rotationDigest: string;
  humanFranchiseId?: string | null;
  aiFranchiseIds?: readonly string[];
  evolutionData?: AiSelectionDataSource | null;
}): {
  checkpointState: SeasonCheckpointState;
  stateRevision: number;
  stateDigest: string;
  evolution: SeasonEvolutionState;
} {
  const objectives = objectivesWithBlockSuccess(input.run.objectives, input.candidate);
  const runChallenges = (input.run as unknown as { challenges?: SeasonChallengeState }).challenges;
  const challenges = challengesWithBlockEvaluation(runChallenges, input.candidate);
  const evolution = evolutionWithBlockCommit({
    rootSeed: input.run.rootSeed,
    blockIndex: input.candidate.blockIndex,
    evolution: normalizeEvolutionState((input.run as unknown as { evolution?: unknown }).evolution),
    humanFranchiseId: input.humanFranchiseId ?? null,
    aiFranchiseIds: input.aiFranchiseIds ?? input.run.league.teams.map((team) => team.franchiseId),
    data: input.evolutionData ?? null,
  });
  const campaign = campaignWithBlockEvaluation(
    (
      input.run as {
        campaign?: import('@hoop-rush/data-contracts').SeasonCampaignState;
      }
    ).campaign,
    input.candidate,
  );
  const checkpointState: SeasonCheckpointState = {
    runId: input.run.runId,
    blockIndex: input.candidate.blockIndex,
    completedRounds: input.candidate.completedRounds,
    revision: input.candidate.revision + 1,
    commandId: input.commandId,
    rotationDigest: input.rotationDigest,
    checkpointDigest: input.candidate.digest,
  };
  const stateRevision = input.run.stateRevision + 1;
  const stateDigest = seasonRunStateDigest({
    stateRevision,
    stage: input.run.stage,
    postseason: input.run.postseason,
    awards: input.run.awards,
    completion: input.run.completion,
    checkpointState,
    health: input.candidate.health,
    influence: input.candidate.influence,
    transactions: input.candidate.transactions,
    trade: input.run.trade,
    freeAgency: input.candidate.freeAgency,
    objectives,
    challenges: challenges ?? null,
    campaign: campaign,
    rosters: input.run.rosters,
    ownership: input.run.ownership,
    rotations: input.run.rotations,
    effects: input.candidate.effects,
    evolution,
    authority: input.run.authority,
  });
  return { checkpointState, stateRevision, stateDigest, evolution };
}
export function buildEvolutionDataSource(input: {
  run: SeasonRun;
  candidate: SeasonCandidateCheckpoint;
  priorSummaries?: readonly SeasonGameSummary[];
  schedule?: SeasonSchedule;
}): AiSelectionDataSource | null {
  if (input.schedule === undefined) return null;
  const run = input.run;
  const aiOrder = new Map<string, number>(
    run.aiAssignments.map((assignment, index) => [assignment.franchiseId, index] as const),
  );
  return {
    summaries: [...(input.priorSummaries ?? []), ...input.candidate.gameSummaries],
    rotations: run.rotations,
    schedule: input.schedule,
    completedRounds: input.candidate.completedRounds,
    aiOrderIndexOf: (franchiseId: string) => aiOrder.get(franchiseId) ?? 0,
  };
}
export function completeSeasonBlockCommit(input: {
  run: SeasonRun;
  candidate: SeasonCandidateCheckpoint;
  commandId: string;
  rotationDigest: string;
  humanFranchiseId: string | null;
  participantFranchiseIds?: readonly string[];
  catalog?: SeasonDraftCatalog;
  effects?: SeasonEffectsState;
  freeAgencyIndex?: SeasonFreeAgencyIndex;
  freeAgencyTargets?: SeasonRosterTargets;
  profile?: EraSimulationProfile;
  schedule?: SeasonSchedule;
  priorSummaries?: readonly SeasonGameSummary[];
}): {
  checkpointState: SeasonCheckpointState;
  stateRevision: number;
  stateDigest: string;
  window: SeasonWindowOpenResult | null;
  freeAgencyWindow: SeasonFreeAgencyWindowState | null;
  freeAgency: SeasonFreeAgencyState;
  campaign: import('@hoop-rush/data-contracts').SeasonCampaignState | null;
  challenges: SeasonChallengeState | undefined;
  evolution: SeasonEvolutionState;
  sponsors: SeasonSponsorGearState;
} {
  const objectives = objectivesWithBlockSuccess(input.run.objectives, input.candidate);
  const baseChallenges = (input.run as unknown as { challenges?: SeasonChallengeState }).challenges;
  const evaluatedChallenges = challengesWithBlockEvaluation(baseChallenges, input.candidate);
  const campaign = campaignWithBlockEvaluation(
    (
      input.run as {
        campaign?: import('@hoop-rush/data-contracts').SeasonCampaignState;
      }
    ).campaign,
    input.candidate,
  );
  const derived = deriveSeasonPostBlockState({
    run: { ...input.run, objectives, campaign: campaign } as SeasonRun,
    candidate: input.candidate,
    commandId: input.commandId,
    rotationDigest: input.rotationDigest,
    humanFranchiseId: input.humanFranchiseId,
    evolutionData: buildEvolutionDataSource({
      run: input.run,
      candidate: input.candidate,
      priorSummaries: input.priorSummaries,
      schedule: input.schedule,
    }),
  });
  const participantIds =
    input.participantFranchiseIds ?? (input.humanFranchiseId ? [input.humanFranchiseId] : []);
  const primaryFranchiseId = participantIds[0] ?? input.humanFranchiseId;
  let postBlockRun: SeasonRun = {
    ...input.run,
    cursor: { schemaVersion: 1, completedRounds: input.candidate.completedRounds },
    standings: input.candidate.standings,
    health: input.candidate.health,
    influence: input.candidate.influence,
    transactions: input.candidate.transactions,
    freeAgency: input.candidate.freeAgency,
    objectives,
    campaign: campaign,
    evolution: derived.evolution,
    checkpointState: derived.checkpointState,
    stateRevision: derived.stateRevision,
    stateDigest: derived.stateDigest,
  } as SeasonRun;
  const runChallengesAfterEval =
    evaluatedChallenges ??
    (postBlockRun as unknown as { challenges?: SeasonChallengeState }).challenges;
  if (runChallengesAfterEval !== undefined) {
    (postBlockRun as unknown as { challenges?: SeasonChallengeState }).challenges =
      runChallengesAfterEval;
  }
  const nextBlockIndex = input.candidate.blockIndex + 1;
  if (nextBlockIndex >= 0 && nextBlockIndex <= 7 && primaryFranchiseId !== null) {
    const currentDeals = (postBlockRun as unknown as { challenges?: SeasonChallengeState })
      .challenges;
    if (currentDeals !== undefined && currentDeals.deals[nextBlockIndex] === undefined) {
      let scheduleForDeal: SeasonSchedule | null = input.schedule ?? null;
      if (scheduleForDeal === null) {
        try {
          scheduleForDeal = generateSeasonSchedule({
            league: input.run.league,
            seed: input.run.schedule.generationSeed,
          });
        } catch {
          scheduleForDeal = null;
        }
      }
      if (scheduleForDeal !== null) {
        const withNext = challengesWithNextDeal({
          challenges: currentDeals,
          run: input.run,
          candidate: input.candidate,
          schedule: scheduleForDeal,
          humanFranchiseId: primaryFranchiseId,
        });
        if (withNext !== undefined) {
          (postBlockRun as unknown as { challenges?: SeasonChallengeState }).challenges = withNext;
          postBlockRun = {
            ...postBlockRun,
            stateDigest: seasonRunStateDigest(
              seasonRunStateDigestFactsOf(postBlockRun, input.effects ?? input.candidate.effects),
            ),
          };
        }
      }
    }
  }
  const sponsorRatings = new Map(
    (input.catalog?.candidates ?? []).map((candidate) => [
      candidate.playerVersionId,
      candidate.detailedRatings,
    ]),
  );
  const nextSponsors = sponsorsWithBlockCommit({
    rootSeed: input.run.rootSeed,
    acceptedBlockIndex: input.candidate.blockIndex,
    sponsors: normalizeSponsorGearState(postBlockRun.sponsors),
    rotations: postBlockRun.rotations,
    ratings: sponsorRatings,
    humanFranchiseId: primaryFranchiseId,
    aiFranchiseIds: postBlockRun.league.teams.map((team) => team.franchiseId),
  });
  const runWithSponsors: SeasonRun = { ...postBlockRun, sponsors: nextSponsors };
  postBlockRun = {
    ...runWithSponsors,
    stateDigest: seasonRunStateDigest(
      seasonRunStateDigestFactsOf(runWithSponsors, input.effects ?? input.candidate.effects),
    ),
  };
  const window = openSeasonTradeWindow({
    run: postBlockRun,
    blockIndex: input.candidate.blockIndex,
    rootSeed: input.run.rootSeed,
    humanFranchiseId: primaryFranchiseId,
    participantFranchiseIds: participantIds.length > 1 ? participantIds : undefined,
    catalog: input.catalog,
    effects: input.effects ?? input.candidate.effects,
  });
  let runAfterTrade: SeasonRun = postBlockRun;
  if (window !== null) {
    runAfterTrade = {
      ...postBlockRun,
      trade: window.trade,
      influence: window.influence,
      transactions: window.transactions,
      rosters: window.rosters,
      ownership: window.ownership,
      rotations: window.rotations,
      health: window.health,
      checkpointState: derived.checkpointState,
      stateRevision: window.stateRevision,
      stateDigest: window.stateDigest,
    };
  }
  let freeAgency: SeasonFreeAgencyState = input.candidate.freeAgency;
  let freeAgencyWindow: SeasonFreeAgencyWindowState | null = null;
  const freeAgencyBlockIndexes = [2, 4, 6];
  if (
    freeAgencyBlockIndexes.includes(input.candidate.blockIndex) &&
    freeAgencyUnresolvedWindowIndex(freeAgency) === null
  ) {
    const freeAgencyIndex = input.freeAgencyIndex;
    if (freeAgencyIndex === undefined) {
      throw new SeasonBlockInvariantError(
        `block ${String(input.candidate.blockIndex)} needs the packaged free-agency index to open its market window`,
        { blockIndex: input.candidate.blockIndex },
      );
    }
    const freeAgencyCatalog = input.catalog;
    if (freeAgencyCatalog === undefined) {
      throw new SeasonBlockInvariantError(
        `block ${String(input.candidate.blockIndex)} needs the packaged catalog to open its market window`,
        { blockIndex: input.candidate.blockIndex },
      );
    }
    const windowIndex = freeAgencyBlockIndexes.indexOf(input.candidate.blockIndex);
    const opened = openSeasonFreeAgencyWindow(
      {
        run: runAfterTrade,
        effects: input.effects ?? input.candidate.effects,
        catalog: freeAgencyCatalog,
        index: freeAgencyIndex,
        targets: input.freeAgencyTargets,
        humanFranchiseId: primaryFranchiseId,
      },
      windowIndex,
      input.candidate.blockIndex,
    );
    freeAgency = opened.freeAgency;
    freeAgencyWindow = opened.window;
    const postWindowEffects =
      window !== null ? window.effects : (input.effects ?? input.candidate.effects);
    const next: SeasonRun = {
      ...runAfterTrade,
      freeAgency,
      stateRevision: runAfterTrade.stateRevision + 1,
      stateDigest: '',
    };
    runAfterTrade = {
      ...next,
      stateDigest: seasonRunStateDigest(seasonRunStateDigestFactsOf(next, postWindowEffects)),
    };
  }
  const finalCampaign = runAfterTrade.campaign ?? campaign ?? null;
  const finalChallenges =
    (runAfterTrade as unknown as { challenges?: SeasonChallengeState }).challenges ??
    (postBlockRun as unknown as { challenges?: SeasonChallengeState }).challenges;
  if (window === null && freeAgencyWindow === null) {
    return {
      checkpointState: derived.checkpointState,
      stateRevision: derived.stateRevision,
      stateDigest: postBlockRun.stateDigest,
      window: null,
      freeAgencyWindow: null,
      freeAgency,
      campaign: finalCampaign,
      challenges: finalChallenges,
      evolution: derived.evolution,
      sponsors: nextSponsors,
    };
  }
  return {
    checkpointState: derived.checkpointState,
    stateRevision: runAfterTrade.stateRevision,
    stateDigest: runAfterTrade.stateDigest,
    window,
    freeAgencyWindow,
    freeAgency,
    campaign: finalCampaign,
    challenges: finalChallenges,
    evolution: derived.evolution,
    sponsors: nextSponsors,
  };
}
