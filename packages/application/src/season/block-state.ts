import {
  seasonAcceptedBlockSchema,
  type SeasonAcceptedBlock,
  type SeasonCampaignState,
  type SeasonCandidateCheckpoint,
  type SeasonChallengeState,
  type SeasonCheckpointState,
  type SeasonEvolutionState,
  type SeasonFreeAgencyState,
  type SeasonGameSummary,
  type SeasonObjectiveState,
  type SeasonRetainedGameDetail,
  type SeasonRotation,
  type SeasonRun,
  type SeasonSchedule,
  type SeasonSponsorGearState,
} from '@hoop-rush/data-contracts';
import { reconstructSeasonGames } from '@hoop-rush/engine';
import type { SeasonRunSnapshot, SeasonWindowOpenResult } from '@hoop-rush/persistence';

export function dedupeByGameId(details: SeasonRetainedGameDetail[]): SeasonRetainedGameDetail[] {
  const seen = new Set<string>();
  const result: SeasonRetainedGameDetail[] = [];
  for (const detail of details) {
    if (seen.has(detail.gameId)) continue;
    seen.add(detail.gameId);
    result.push(detail);
  }
  return result;
}

export function dedupeNewByGameId(
  prior: readonly SeasonRetainedGameDetail[],
  incoming: readonly SeasonRetainedGameDetail[],
): SeasonRetainedGameDetail[] {
  if (prior.length === 0) return dedupeByGameId([...incoming]);
  const seen = new Set<string>();
  for (const detail of prior) seen.add(detail.gameId);
  const result: SeasonRetainedGameDetail[] = [];
  for (const detail of incoming) {
    if (seen.has(detail.gameId)) continue;
    seen.add(detail.gameId);
    result.push(detail);
  }
  return result;
}

export function isSortedByGameId(items: readonly { gameId: string }[]): boolean {
  for (let i = 1; i < items.length; i += 1) {
    const prev = items[i - 1];
    const curr = items[i];
    if (prev === undefined || curr === undefined) continue;
    if (prev.gameId > curr.gameId) return false;
  }
  return true;
}

export function mergeSortedByGameId<T extends { gameId: string }>(
  prior: readonly T[],
  next: readonly T[],
): T[] {
  if (prior.length === 0) return [...next].sort((a, b) => (a.gameId < b.gameId ? -1 : 1));
  if (next.length === 0) return [...prior];
  if (!isSortedByGameId(prior))
    return [...prior, ...next].sort((a, b) => (a.gameId < b.gameId ? -1 : 1));
  const sortedNext = [...next].sort((a, b) => (a.gameId < b.gameId ? -1 : 1));
  const result: T[] = [];
  let i = 0;
  let j = 0;
  while (i < prior.length && j < sortedNext.length) {
    const a = prior[i];
    const b = sortedNext[j];
    if (a === undefined || b === undefined) break;
    if (a.gameId <= b.gameId) {
      const last = result[result.length - 1];
      if (last === undefined || last.gameId !== a.gameId) result.push(a);
      i += 1;
    } else {
      const last = result[result.length - 1];
      if (last === undefined || last.gameId !== b.gameId) result.push(b);
      j += 1;
    }
  }
  while (i < prior.length) {
    const a = prior[i];
    if (a === undefined) break;
    const last = result[result.length - 1];
    if (last === undefined || last.gameId !== a.gameId) result.push(a);
    i += 1;
  }
  while (j < sortedNext.length) {
    const b = sortedNext[j];
    if (b === undefined) break;
    const last = result[result.length - 1];
    if (last === undefined || last.gameId !== b.gameId) result.push(b);
    j += 1;
  }
  return result;
}

export function assembleCommittedSnapshot(input: {
  run: SeasonRun;
  rotations: SeasonRotation[];
  checkpoint: SeasonCandidateCheckpoint;
  commandId: string;
  rotationDigest: string;
  window: SeasonWindowOpenResult | null;
  freeAgency: SeasonFreeAgencyState;
  campaign?: SeasonCampaignState | null;
  challenges?: SeasonChallengeState | null;
  evolution?: SeasonEvolutionState | null;
  sponsors?: SeasonSponsorGearState | null;
  checkpointState: SeasonCheckpointState;
  stateRevision: number;
  stateDigest: string;
  schedule: SeasonSchedule;
  priorSummaries: SeasonGameSummary[];
  priorAcceptedBlocks: SeasonAcceptedBlock[];
  priorRetainedDetails: SeasonRetainedGameDetail[];
}): SeasonRunSnapshot {
  const { run, rotations, checkpoint, window, schedule } = input;
  const objectives = objectivesWithSuccess(run, checkpoint);
  const challenges = input.challenges ?? challengesWithSuccess(run, checkpoint);
  const campaign = input.campaign ?? run.campaign ?? null;
  const postCommitRun = {
    ...run,
    rosters: window !== null ? window.rosters : run.rosters,
    ownership: window !== null ? window.ownership : run.ownership,
    rotations: window !== null ? window.rotations : rotations,
    cursor: { schemaVersion: 1, completedRounds: checkpoint.completedRounds },
    standings: checkpoint.standings,
    health: window !== null ? window.health : checkpoint.health,
    influence: window !== null ? window.influence : checkpoint.influence,
    transactions: window !== null ? window.transactions : checkpoint.transactions,
    trade: window !== null ? window.trade : run.trade,
    freeAgency: input.freeAgency,
    objectives,
    challenges: challenges ?? run.challenges,
    campaign,
    evolution: input.evolution ?? run.evolution,
    sponsors: input.sponsors ?? run.sponsors,
    checkpointState: input.checkpointState,
    stateRevision: input.stateRevision,
    stateDigest: input.stateDigest,
  } as unknown as SeasonRun;
  const newDetails = dedupeNewByGameId(input.priorRetainedDetails, checkpoint.retainedDetails);
  const summaries = mergeSortedByGameId(input.priorSummaries, checkpoint.gameSummaries);
  const retainedDetails = mergeSortedByGameId(input.priorRetainedDetails, newDetails);
  const acceptedBlock = seasonAcceptedBlockSchema.parse({
    runId: checkpoint.runId,
    blockIndex: checkpoint.blockIndex,
    completedRounds: checkpoint.completedRounds,
    revision: checkpoint.revision + 1,
    commandId: input.commandId,
    rotationDigest: input.rotationDigest,
    checkpointDigest: checkpoint.digest,
    summaryCount: checkpoint.gameSummaries.length,
    stateRevision: input.stateRevision,
    stateDigest: input.stateDigest,
  });
  return {
    run: { ...postCommitRun, games: reconstructSeasonGames(schedule, summaries) },
    summaries,
    retainedDetails,
    acceptedBlocks: [...input.priorAcceptedBlocks, acceptedBlock],
    effects: window !== null ? window.effects : checkpoint.effects,
  };
}

export function objectivesWithSuccess(
  run: SeasonRun,
  checkpoint: SeasonCandidateCheckpoint,
): SeasonObjectiveState | undefined {
  const objectives = run.objectives as SeasonObjectiveState | undefined;
  if (objectives === undefined) return undefined;
  if (checkpoint.blockIndex === 8) return objectives;
  const selection = objectives.selections[checkpoint.blockIndex];
  if (selection === undefined) return objectives;
  return {
    ...objectives,
    selections: {
      ...objectives.selections,
      [checkpoint.blockIndex]: { ...selection, success: checkpoint.objective?.success ?? null },
    },
  };
}

export function challengesWithSuccess(
  run: SeasonRun,
  checkpoint: SeasonCandidateCheckpoint,
): SeasonRun['challenges'] {
  const base = run.challenges;
  if (base == null) return base;
  const evaluation = checkpoint.challenges;
  if (evaluation == null) return base;
  if (base.evaluations.some((entry) => entry.blockIndex === evaluation.blockIndex)) return base;
  return {
    ...base,
    evaluations: [...base.evaluations, evaluation].sort((a, b) => a.blockIndex - b.blockIndex),
  };
}
