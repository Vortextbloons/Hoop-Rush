import type {
  CapRushApronFact,
  CapRushLeagueGame,
  CapRushLeagueScheduleEntry,
  CapRushMultiplayerLockedInputs,
  CapRushMultiplayerSeatId,
  HavocBattleInput,
  HavocBattleResult,
  HavocBattleTape,
} from '@hoop-rush/data-contracts';
import { capRushLeagueGameSchema } from '@hoop-rush/data-contracts';
import type { EngineContext } from '../../../sim/kernel.ts';
import { simulateAuditedHavocBattleGame } from '../../havoc/core/battle-game.ts';
import { havocBattleGameResultDigest } from '../../havoc/core/battle-digests.ts';
import { capRushBoxOf } from '../league-simulation.ts';
import { buildCapRushConferenceStandings } from '../conference-standings.ts';
import { capRushMultiplayerGameInputFor } from './input.ts';
import { capRushMultiplayerApronFor } from './apron.ts';
import { capRushMultiplayerFieldOfLocked } from './locked.ts';

export interface CapRushMultiplayerSlotSimulation {
  readonly games: CapRushLeagueGame[];
  readonly tapes: Map<string, HavocBattleTape>;
  readonly facts: readonly CapRushApronFact[];
}

export function capRushMultiplayerSlotEntries(
  locked: CapRushMultiplayerLockedInputs,
  slot: number,
): CapRushLeagueScheduleEntry[] {
  return locked.leagueSchedule
    .filter((entry) => entry.slot === slot)
    .sort((left, right) => (left.gameId < right.gameId ? -1 : left.gameId > right.gameId ? 1 : 0));
}

export function capRushMultiplayerH2HSlots(locked: CapRushMultiplayerLockedInputs): number[] {
  const ids = new Set([
    locked.seats.p1.franchise.franchiseId,
    locked.seats.p2.franchise.franchiseId,
  ]);
  return [
    ...new Set(
      locked.leagueSchedule
        .filter((entry) => ids.has(entry.homeTeamId) && ids.has(entry.awayTeamId))
        .map((entry) => entry.slot),
    ),
  ].sort((left, right) => left - right);
}

export function capRushMultiplayerSimulateGame(input: {
  readonly locked: CapRushMultiplayerLockedInputs;
  readonly entry: CapRushLeagueScheduleEntry;
  readonly context: EngineContext;
}): {
  readonly game: CapRushLeagueGame;
  readonly tape: HavocBattleTape;
  readonly facts: readonly CapRushApronFact[];
  readonly input: HavocBattleInput;
  readonly result: HavocBattleResult;
} {
  const battleInput = capRushMultiplayerGameInputFor({
    locked: input.locked,
    entry: input.entry,
  });
  const apron = capRushMultiplayerApronFor({
    locked: input.locked,
    homeTeamId: input.entry.homeTeamId,
    awayTeamId: input.entry.awayTeamId,
  });
  const battle = simulateAuditedHavocBattleGame(battleInput, input.context, {
    apron: apron?.hooks,
  });
  const audit = battle.audit;
  if (!audit.ok) {
    throw new Error(
      `cap rush multiplayer: game ${input.entry.gameId} failed accounting: ${audit.findings
        .map((finding) => finding.message)
        .join('; ')}`,
    );
  }
  const game = capRushLeagueGameSchema.parse({
    gameId: input.entry.gameId,
    slot: input.entry.slot,
    homeTeamId: input.entry.homeTeamId,
    awayTeamId: input.entry.awayTeamId,
    homePoints: battle.result.home.points,
    awayPoints: battle.result.away.points,
    winnerTeamId:
      battle.result.home.points > battle.result.away.points
        ? input.entry.homeTeamId
        : input.entry.awayTeamId,
    box: capRushBoxOf(battle.result.home, battle.result.away, battle.result.overtimePeriods),
    inputDigest: battle.result.inputDigest,
    resultDigest: havocBattleGameResultDigest(battle.result),
  });
  const facts = apron?.facts() ?? [];
  apron?.dispose();
  return {
    game,
    get tape() {
      return battle.tape;
    },
    facts,
    input: battleInput,
    result: battle.result,
  };
}

export function simulateCapRushMultiplayerSlot(input: {
  readonly locked: CapRushMultiplayerLockedInputs;
  readonly slot: number;
  readonly context: EngineContext;
  readonly tapeGameIds?: readonly string[] | undefined;
  readonly partition?: 0 | 1;
}): CapRushMultiplayerSlotSimulation {
  const entries = capRushMultiplayerSlotEntries(input.locked, input.slot);
  if (entries.length === 0) {
    throw new Error(`cap rush multiplayer: slot ${String(input.slot)} has no games`);
  }
  const tapes = new Map<string, HavocBattleTape>();
  const games: CapRushLeagueGame[] = [];
  const facts: CapRushApronFact[] = [];
  const tapeIds = new Set(input.tapeGameIds ?? []);
  const midpoint = Math.ceil(entries.length / 2);
  const selected =
    input.partition === undefined
      ? entries
      : input.partition === 0
        ? entries.slice(0, midpoint)
        : entries.slice(midpoint);
  for (const entry of selected) {
    const simulated = capRushMultiplayerSimulateGame({
      locked: input.locked,
      entry,
      context: input.context,
    });
    games.push(simulated.game);
    if (tapeIds.has(entry.gameId)) tapes.set(entry.gameId, simulated.tape);
    facts.push(...simulated.facts);
  }
  return { games, tapes, facts };
}

export function capRushMultiplayerStandings(
  locked: CapRushMultiplayerLockedInputs,
  games: readonly CapRushLeagueGame[],
) {
  return buildCapRushConferenceStandings({
    teams: capRushMultiplayerFieldOfLocked(locked),
    games: games.map((game) => ({
      gameId: game.gameId,
      homeTeamId: game.homeTeamId,
      awayTeamId: game.awayTeamId,
      homePoints: game.homePoints,
      awayPoints: game.awayPoints,
    })),
  });
}

export function capRushMultiplayerSeatRecord(
  locked: CapRushMultiplayerLockedInputs,
  games: readonly CapRushLeagueGame[],
  seat: CapRushMultiplayerSeatId,
): { wins: number; losses: number; pointsFor: number; pointsAgainst: number; played: number } {
  const teamId = locked.seats[seat].franchise.franchiseId;
  let wins = 0;
  let losses = 0;
  let pointsFor = 0;
  let pointsAgainst = 0;
  let played = 0;
  for (const game of games) {
    if (game.homeTeamId !== teamId && game.awayTeamId !== teamId) continue;
    played += 1;
    const home = game.homeTeamId === teamId;
    const own = home ? game.homePoints : game.awayPoints;
    const other = home ? game.awayPoints : game.homePoints;
    pointsFor += own;
    pointsAgainst += other;
    if (own > other) wins += 1;
    else losses += 1;
  }
  return { wins, losses, pointsFor, pointsAgainst, played };
}

export function capRushMultiplayerAcceptedThrough(games: readonly CapRushLeagueGame[]): number {
  let highest = 0;
  for (const game of games) {
    if (game.slot > highest) highest = game.slot;
  }
  return highest;
}
