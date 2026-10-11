import {
  SEASON_ENDING_MISSED_GAMES_SENTINEL,
  SEASON_ROSTER_MAX_SIZE,
  SEASON_TEAM_COUNT,
  blockRoundRange,
  franchiseIdSchema,
  seasonGameIdSchema,
  seasonNamespaceSeed,
  type SeasonCandidateCheckpoint,
} from '@hoop-rush/data-contracts';
import { auditSeasonAggregates } from '../aggregates.ts';
import { reconstructSeasonGames, seasonCheckpointDigest } from '../checkpoint.ts';
import { auditSeasonGameSummary } from '../game-summary.ts';
import { evaluateSeasonBlockChallenges } from '../challenges.ts';
import { auditSeasonBlockRecap, seasonBlockGameCount } from '../recap.ts';
import { auditSeasonStandings, reduceSeasonStandings } from '../standings.ts';
import { seasonAcceptedBlockCount } from './validation.ts';
import type { SeasonBlockSimulationInput } from './types.ts';

export function auditSeasonBlock(
  candidate: SeasonCandidateCheckpoint,
  input: SeasonBlockSimulationInput,
): string[] {
  const failures: string[] = [];
  const command = input.command;
  const run = input.run;
  if (candidate.runId !== run.runId) failures.push('candidate runId does not match the run');
  if (candidate.blockIndex !== command.blockIndex) {
    failures.push('candidate blockIndex does not match the command');
  }
  if (candidate.rotationDigest !== command.rotationDigest) {
    failures.push('candidate rotationDigest does not match the command');
  }
  if (candidate.revision !== command.expectedRevision) {
    failures.push(
      `candidate revision ${String(candidate.revision)} does not match expectedRevision ${String(command.expectedRevision)}`,
    );
  }
  if (candidate.revision !== seasonAcceptedBlockCount(run.cursor.completedRounds)) {
    failures.push('candidate revision does not match the run cursor');
  }
  const { toRound } = blockRoundRange(command.blockIndex);
  if (candidate.completedRounds !== toRound) {
    failures.push(
      `candidate completedRounds ${String(candidate.completedRounds)} must be the block end ${String(toRound)} (cursor advanced)`,
    );
  }
  if (candidate.completedRounds !== command.blockIndex * 10 + (command.blockIndex >= 8 ? 2 : 10)) {
    failures.push('candidate completedRounds must equal the block end');
  }
  const expectedCount = seasonBlockGameCount(command.blockIndex);
  if (candidate.gameSummaries.length !== expectedCount) {
    failures.push(
      `candidate must carry exactly ${String(expectedCount)} summaries (got ${String(candidate.gameSummaries.length)})`,
    );
  }
  const gameIds = candidate.gameSummaries.map((summary) => summary.gameId);
  if (new Set(gameIds).size !== gameIds.length) {
    failures.push('candidate gameSummaries contain duplicate game ids');
  }
  const { fromRound } = blockRoundRange(command.blockIndex);
  const blockGameIds = new Set(
    input.schedule.games
      .filter((game) => game.round >= fromRound && game.round <= toRound)
      .map((game) => game.gameId),
  );
  for (const gameId of blockGameIds) {
    if (!gameIds.includes(gameId)) {
      failures.push(`candidate misses block game ${gameId}`);
    }
  }
  for (const gameId of gameIds) {
    if (!blockGameIds.has(gameId)) {
      failures.push(`candidate carries a game outside the block: ${gameId}`);
    }
  }
  for (const summary of candidate.gameSummaries) {
    failures.push(
      ...auditSeasonGameSummary(summary).map((failure) => `summary ${summary.gameId}: ${failure}`),
    );
  }
  const maxPlayerAggregates = SEASON_TEAM_COUNT * SEASON_ROSTER_MAX_SIZE;
  if (candidate.playerAggregates.length > maxPlayerAggregates) {
    failures.push(
      `candidate must carry at most ${String(maxPlayerAggregates)} player aggregates (got ${String(candidate.playerAggregates.length)})`,
    );
  }
  const aggregateIds = candidate.playerAggregates.map((player) => player.playerVersionId);
  if (new Set(aggregateIds).size !== aggregateIds.length) {
    failures.push('candidate player aggregates contain duplicate versions');
  }
  for (const player of candidate.playerAggregates) {
    if (!input.expanded.has(player.playerVersionId)) {
      failures.push(`player aggregate references an unrostered version ${player.playerVersionId}`);
    }
  }
  if (candidate.teamAggregates.length !== SEASON_TEAM_COUNT) {
    failures.push(
      `candidate must carry 30 team aggregates (got ${String(candidate.teamAggregates.length)})`,
    );
  }
  const allSummaries = [...input.priorSummaries, ...candidate.gameSummaries];
  failures.push(
    ...auditSeasonStandings(
      run.league,
      reconstructSeasonGames(input.schedule, allSummaries),
      candidate.standings,
    ),
  );
  failures.push(
    ...auditSeasonAggregates({
      teams: candidate.teamAggregates,
      players: candidate.playerAggregates,
      summaries: allSummaries,
      standings: candidate.standings,
    }),
  );
  if (candidate.retainedDetails.length > 10) {
    failures.push('candidate retained details exceed 10');
  }
  if (input.humanFranchiseId !== null) {
    for (const detail of candidate.retainedDetails) {
      if (
        detail.homeFranchiseId !== input.humanFranchiseId &&
        detail.awayFranchiseId !== input.humanFranchiseId
      ) {
        failures.push(`retained detail ${detail.gameId} is not a human-team game`);
      }
      if (!gameIds.includes(detail.gameId)) {
        failures.push(`retained detail ${detail.gameId} is outside the block`);
      }
    }
  }
  failures.push(
    ...auditSeasonBlockRecap(candidate.recap, {
      runId: run.runId,
      blockIndex: command.blockIndex,
      completedRounds: candidate.completedRounds,
      humanFranchiseId: input.humanFranchiseId,
      summaries: allSummaries,
      standingsBefore: reduceSeasonStandings(
        run.league,
        reconstructSeasonGames(input.schedule, input.priorSummaries),
      ),
      standingsAfter: candidate.standings,
      playerAggregates: candidate.playerAggregates,
      schedule: input.schedule,
      rosterPlayerIds: input.rosterPlayerIds,
      health: candidate.health,
      objective:
        candidate.objective === undefined
          ? null
          : {
              objectiveId: candidate.objective.objectiveId,
              success: candidate.objective.success,
              evaluation: candidate.objective.evaluation,
            },
      challenges: candidate.challenges ?? null,
      transactions: candidate.transactions,
      influence: candidate.influence,
    }),
  );
  const effectsVersions = new Set(candidate.effects.playerStates.map((p) => p.playerVersionId));
  if (effectsVersions.size !== 300) {
    failures.push(
      `effects state must carry 300 distinct players (got ${String(effectsVersions.size)})`,
    );
  }
  const expandedVersions = new Set(input.expanded.keys());
  if (
    effectsVersions.size === expandedVersions.size &&
    ![...effectsVersions].every((version) => expandedVersions.has(version))
  ) {
    failures.push('effects state player set does not match the expanded rosters');
  }
  for (const player of candidate.effects.playerStates) {
    if (player.lastCompletedRound > candidate.completedRounds) {
      failures.push(
        `effects ${player.playerVersionId} lastCompletedRound ${String(player.lastCompletedRound)} exceeds ${String(candidate.completedRounds)}`,
      );
    }
  }
  const expandedVersionsSet = new Set(input.expanded.keys());
  const leagueFranchiseIds = new Set(run.league.teams.map((team) => team.franchiseId));
  const scheduleRoundById = new Map(input.schedule.games.map((game) => [game.gameId, game.round]));
  for (const record of candidate.health.injuries) {
    if (!expandedVersionsSet.has(record.playerVersionId)) {
      failures.push(
        `injury ${record.injuryId} references an unrostered version ${record.playerVersionId}`,
      );
    }
    if (!leagueFranchiseIds.has(record.franchiseId)) {
      failures.push(`injury ${record.injuryId} references a franchise outside the league`);
    }
    const parsedGameId = seasonGameIdSchema.safeParse(record.gameId);
    const occurrenceRound = parsedGameId.success
      ? scheduleRoundById.get(parsedGameId.data)
      : undefined;
    if (occurrenceRound === undefined) {
      failures.push(`injury ${record.injuryId} references an unscheduled game ${record.gameId}`);
    } else if (occurrenceRound > candidate.completedRounds) {
      failures.push(`injury ${record.injuryId} references a game past the checkpoint cursor`);
    }
    if (record.actualReturnRound !== null && record.actualReturnRound > candidate.completedRounds) {
      failures.push(
        `injury ${record.injuryId} actualReturnRound ${String(record.actualReturnRound)} exceeds ${String(candidate.completedRounds)}`,
      );
    }
    if (record.seasonEnding !== (record.severity === 'season-ending')) {
      failures.push(`injury ${record.injuryId} seasonEnding flag does not match its severity`);
    }
    if (
      record.seasonEnding &&
      (record.missedGamesTotal !== SEASON_ENDING_MISSED_GAMES_SENTINEL ||
        record.missedGamesRemaining !== SEASON_ENDING_MISSED_GAMES_SENTINEL)
    ) {
      failures.push(
        `season-ending injury ${record.injuryId} must carry the missed-games sentinel ${String(SEASON_ENDING_MISSED_GAMES_SENTINEL)}`,
      );
    }
    if (record.recurrenceWindowRoundsRemaining > 0 && record.actualReturnRound === null) {
      failures.push(`injury ${record.injuryId} has an open window before its actual return`);
    }
    if (record.sameGameReturn && record.missedGamesTotal !== 0) {
      failures.push(`injury ${record.injuryId} same-game return must carry zero missed games`);
    }
  }
  const hasCandidateChallenges = candidate.challenges != null;
  if (hasCandidateChallenges) {
    const evaluation = candidate.challenges;
    if (evaluation == null) {
      failures.push('candidate challenges missing after presence check');
    } else {
      if (evaluation.blockIndex !== command.blockIndex) {
        failures.push('candidate challenges blockIndex does not match the command');
      }
      const deal = input.challengeDeal ?? null;
      if (deal !== null) {
        const dealIds = [...deal.challengeIds].sort();
        const resultIds = evaluation.results.map((result) => result.challengeId).sort();
        if (JSON.stringify(dealIds) !== JSON.stringify(resultIds)) {
          failures.push('candidate challenges do not match the dealt challengeIds');
        }
        if (deal.seedPath !== undefined) {
          const [seedNamespace, ...seedRest] = deal.seedPath;
          const reseeded = seasonNamespaceSeed(
            run.rootSeed,
            seedNamespace ?? 'challenges',
            ...seedRest,
          );
          if (reseeded !== deal.seedDigest) {
            failures.push('candidate challenge deal seedDigest does not match its seedPath');
          }
        }
        if (deal.standingsSnapshot !== undefined && input.humanFranchiseId !== null) {
          const snapshotById = new Map(deal.standingsSnapshot.map((row) => [row.franchiseId, row]));
          const humanSnapshot = snapshotById.get(franchiseIdSchema.parse(input.humanFranchiseId));
          if (humanSnapshot === undefined) {
            failures.push('candidate challenge deal snapshot misses the human franchise');
          } else {
            const { fromRound, toRound } = blockRoundRange(command.blockIndex);
            const scheduledOpponents = new Set(
              input.schedule.games
                .filter(
                  (game) =>
                    game.round >= fromRound &&
                    game.round <= toRound &&
                    (game.homeFranchiseId === input.humanFranchiseId ||
                      game.awayFranchiseId === input.humanFranchiseId),
                )
                .map((game) =>
                  game.homeFranchiseId === input.humanFranchiseId
                    ? game.awayFranchiseId
                    : game.homeFranchiseId,
                ),
            );
            const leader = deal.targets.leaderFranchiseId;
            if (leader !== null) {
              const leaderSnapshot = snapshotById.get(leader);
              if (leaderSnapshot === undefined) {
                failures.push('candidate challenge deal snapshot misses the dealt leader');
              } else if (!scheduledOpponents.has(leader)) {
                failures.push('dealt beat-leader target is not scheduled in the block');
              }
            }
            for (const opponent of deal.targets.qualifyingOpponentIds) {
              const oppSnapshot = snapshotById.get(opponent);
              if (oppSnapshot === undefined) {
                failures.push(`candidate challenge deal snapshot misses qualifier ${opponent}`);
                continue;
              }
              const better =
                oppSnapshot.wins !== humanSnapshot.wins
                  ? oppSnapshot.wins > humanSnapshot.wins
                  : oppSnapshot.losses < humanSnapshot.losses;
              if (!better) {
                failures.push(
                  `dealt beat-higher qualifier ${opponent} is not strictly better in the snapshot`,
                );
              }
              if (!scheduledOpponents.has(opponent)) {
                failures.push(
                  `dealt beat-higher qualifier ${opponent} is not scheduled in the block`,
                );
              }
            }
          }
        }
        const recomputed = evaluateSeasonBlockChallenges({
          deal,
          blockIndex: command.blockIndex,
          humanFranchiseId: input.humanFranchiseId,
          summaries: candidate.gameSummaries,
        });
        if (JSON.stringify(recomputed) !== JSON.stringify(evaluation)) {
          failures.push('candidate challenges do not replay from the recorded summaries and deal');
        }
      }
      if (candidate.challengeIds !== undefined) {
        const ordered = [...evaluation.results.map((r) => r.challengeId)].sort();
        if (
          JSON.stringify([...(candidate.challengeIds as readonly string[])].sort()) !==
          JSON.stringify(ordered)
        ) {
          failures.push('candidate challengeIds do not match the evaluated challenges');
        }
      }
      const recapEvidence = candidate.recap.challengeEvidence ?? [];
      if (recapEvidence.length !== 3) {
        failures.push('candidate recap must carry exactly 3 challenge results');
      }
      const rewardEntries = candidate.transactions.filter(
        (entry) => entry.type === 'challenge-reward' && entry.blockIndex === command.blockIndex,
      );
      const expectedRewards = evaluation.results.filter((r) => r.success).length;
      const humanRewards = rewardEntries.filter(
        (entry) => entry.franchiseId === input.humanFranchiseId,
      ).length;
      const priorHumanRewards = (input.transactions ?? []).filter(
        (entry) =>
          entry.type === 'challenge-reward' &&
          entry.blockIndex === command.blockIndex &&
          entry.franchiseId === input.humanFranchiseId,
      ).length;
      if (input.humanFranchiseId !== null && humanRewards !== priorHumanRewards + expectedRewards) {
        failures.push(
          `candidate must append ${String(expectedRewards)} challenge-reward transactions for the human (got ${String(humanRewards - priorHumanRewards)})`,
        );
      }
    }
    if (command.blockIndex === 8 && candidate.challenges !== undefined) {
      failures.push('the final two-game block must carry no challenges');
    }
  } else {
    const objective = candidate.objective;
    if (objective === undefined) {
      failures.push('candidate must carry an objective evaluation for legacy blocks');
    } else {
      if (objective.objectiveId !== command.objectiveId) {
        failures.push(
          `candidate objective ${String(objective.objectiveId)} does not match the command ${String(command.objectiveId)}`,
        );
      }
      if (objective.objectiveId !== null) {
        if (objective.evaluation.blockIndex !== command.blockIndex) {
          failures.push('candidate objective evaluation blockIndex does not match the command');
        }
        if (objective.success !== objective.evaluation.success) {
          failures.push('candidate objective success does not match its evaluation');
        }
      }
      if (command.blockIndex === 8 && objective.objectiveId !== null) {
        failures.push('the final two-game block must carry a null objective');
      }
    }
  }
  if (candidate.expectedStateRevision !== command.expectedStateRevision) {
    failures.push('candidate expectedStateRevision does not match the command');
  }
  if (candidate.expectedStateDigest !== command.expectedStateDigest) {
    failures.push('candidate expectedStateDigest does not match the command');
  }
  if (candidate.stateRevision !== 0 || candidate.stateDigest !== '0'.repeat(32)) {
    failures.push(
      'candidate post-block state facts must be the assembly placeholders (the commit side derives them)',
    );
  }
  const transactionIds = candidate.transactions.map((entry) => entry.transactionId);
  if (new Set(transactionIds).size !== transactionIds.length) {
    failures.push('candidate transactions contain duplicate ids');
  }
  const recomputed = seasonCheckpointDigest(candidate);
  if (recomputed !== candidate.digest) {
    failures.push(`digest mismatch: stored ${candidate.digest}, recomputed ${recomputed}`);
  }
  return failures;
}
