import type {
  EraSimulationProfile,
  FixedFiveCommand,
  FixedFiveCompetitionResult,
  FixedFiveLineupEntry,
  FixedFiveParticipantId,
  FixedFiveVersionLocks,
  OpponentBracket,
  Seed,
  SimulationTeam,
} from '@hoop-rush/data-contracts';
import {
  canonicalJson,
  contentHashSchema,
  fixedFiveCompetitionResultSchema,
  seasonDigestHex,
} from '@hoop-rush/data-contracts';
import type { EngineContext } from '../../sim/context.ts';
import { fixedFiveResultDigest } from './digest.ts';
import { findWeakestOpponent, simulateShared82 } from './shared82.ts';
import { simulateDuelSeries } from './duel-sim.ts';
import { fixedFiveDuelGameSeed, fixedFiveH2HSeed, fixedFiveSharedGameSeed } from './seeds.ts';
export interface FixedFiveVerificationInput {
  roomId: string;
  competition: 'shared-82' | 'duel';
  rootSeed: Seed;
  versions: FixedFiveVersionLocks;
  challenge: string;
  acceptedCommands: readonly FixedFiveCommand[];
  lineups: {
    p1: FixedFiveLineupEntry;
    p2: FixedFiveLineupEntry;
  };
  result: FixedFiveCompetitionResult;
  resultDigest: string;
  bracket: OpponentBracket;
  profile: EraSimulationProfile;
  dataVersion: string;
}
export interface FixedFiveReceiptGameSeed {
  gameNumber: number;
  seed: Seed;
  tag: 'h2h' | 'p1' | 'p2' | 'duel';
}
export interface FixedFiveVerificationReceipt {
  schemaVersion: 1;
  roomId: string;
  rootSeed: Seed;
  versions: FixedFiveVersionLocks;
  challenge: string;
  participantIds: [FixedFiveParticipantId, FixedFiveParticipantId];
  commandIds: string[];
  gameSeeds: FixedFiveReceiptGameSeed[];
  resultDigest: string;
  receiptDigest: string;
}
export type FixedFiveVerificationResult =
  | {
      ok: true;
      receipt: FixedFiveVerificationReceipt;
    }
  | {
      ok: false;
      failures: string[];
    };
function teamOf(
  participantId: FixedFiveParticipantId,
  entry: FixedFiveLineupEntry,
): SimulationTeam {
  return {
    teamId: participantId,
    displayName: participantId === 'p1' ? 'Player 1' : 'Player 2',
    players: [...entry.players],
  };
}
function receiptDigestOf(receipt: Omit<FixedFiveVerificationReceipt, 'receiptDigest'>): string {
  const material = canonicalJson(receipt);
  return contentHashSchema.parse(
    `${seasonDigestHex(`fixed-five-receipt-v1:${material}`)}${seasonDigestHex(`fixed-five-receipt-v2:${material}`)}`,
  );
}
export function verifyFixedFiveCompetition(
  input: FixedFiveVerificationInput,
  context: EngineContext,
): FixedFiveVerificationResult {
  const failures: string[] = [];
  const parsedResult = fixedFiveCompetitionResultSchema.safeParse(input.result);
  if (!parsedResult.success) {
    failures.push('the submitted competition result fails the result schema');
  }
  for (const participantId of ['p1', 'p2'] as const) {
    const entry = input.lineups[participantId];
    const ids = entry.players.map((player) => player.playerId);
    if (new Set(ids).size !== ids.length) {
      failures.push(`${participantId} lineup contains duplicate players`);
    }
    if (ids.length !== 5) {
      failures.push(`${participantId} lineup must contain exactly five players`);
    }
  }
  const ordered = [...input.acceptedCommands].sort((a, b) => a.ordinal - b.ordinal);
  ordered.forEach((command, index) => {
    if (command.ordinal !== index) {
      failures.push(`accepted command log is not dense at ordinal ${String(index)}`);
    }
    if (command.roomId !== input.roomId) {
      failures.push(`command ${command.commandId} does not belong to the room`);
    }
  });
  const commandIds = ordered.map((command) => command.commandId);
  if (new Set(commandIds).size !== commandIds.length) {
    failures.push('accepted command log contains duplicate command ids');
  }
  const p1Team = teamOf('p1', input.lineups.p1);
  const p2Team = teamOf('p2', input.lineups.p2);
  let gameSeeds: FixedFiveReceiptGameSeed[] = [];
  try {
    if (input.competition === 'shared-82') {
      const recomputed = simulateShared82(
        {
          p1Team,
          p2Team,
          bracket: input.bracket,
          profile: input.profile,
          rootSeed: input.rootSeed,
          dataVersion: input.dataVersion,
        },
        context,
      );
      if (canonicalJson(recomputed.result) !== canonicalJson(input.result)) {
        failures.push('the recomputed shared-82 result does not match the submitted result');
      }
      const weakest = findWeakestOpponent(input.bracket);
      const h2hNumbers = new Set(
        input.bracket.schedule
          .filter((entry) => entry.opponentId === weakest.opponentId)
          .map((entry) => entry.gameNumber),
      );
      gameSeeds = [];
      for (let gameNumber = 1; gameNumber <= 82; gameNumber += 1) {
        if (h2hNumbers.has(gameNumber)) {
          gameSeeds.push({
            gameNumber,
            seed: fixedFiveH2HSeed(input.rootSeed, gameNumber),
            tag: 'h2h',
          });
          continue;
        }
        gameSeeds.push({
          gameNumber,
          seed: fixedFiveSharedGameSeed(input.rootSeed, 'p1', gameNumber),
          tag: 'p1',
        });
        gameSeeds.push({
          gameNumber,
          seed: fixedFiveSharedGameSeed(input.rootSeed, 'p2', gameNumber),
          tag: 'p2',
        });
      }
    } else {
      const recomputed = simulateDuelSeries(
        {
          p1Team,
          p2Team,
          profile: input.profile,
          rootSeed: input.rootSeed,
          dataVersion: input.dataVersion,
        },
        context,
      );
      if (canonicalJson(recomputed.result) !== canonicalJson(input.result)) {
        failures.push('the recomputed duel result does not match the submitted result');
      }
      gameSeeds = [];
      for (let gameNumber = 1; gameNumber <= recomputed.games.length; gameNumber += 1) {
        gameSeeds.push({
          gameNumber,
          seed: fixedFiveDuelGameSeed(input.rootSeed, gameNumber),
          tag: 'duel',
        });
      }
    }
  } catch (error) {
    failures.push(
      `recomputation failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  const expectedDigest = fixedFiveResultDigest({
    rootSeed: input.rootSeed,
    versions: input.versions,
    lineups: { p1: input.lineups.p1, p2: input.lineups.p2 },
    acceptedCommands: ordered,
    result: input.result,
  });
  if (expectedDigest !== input.resultDigest) {
    failures.push('the submitted result digest does not match the recomputed digest');
  }
  if (failures.length > 0) {
    return { ok: false, failures };
  }
  const receiptBase: Omit<FixedFiveVerificationReceipt, 'receiptDigest'> = {
    schemaVersion: 1,
    roomId: input.roomId,
    rootSeed: input.rootSeed,
    versions: input.versions,
    challenge: input.challenge,
    participantIds: ['p1', 'p2'],
    commandIds,
    gameSeeds,
    resultDigest: input.resultDigest,
  };
  return {
    ok: true,
    receipt: { ...receiptBase, receiptDigest: receiptDigestOf(receiptBase) },
  };
}
