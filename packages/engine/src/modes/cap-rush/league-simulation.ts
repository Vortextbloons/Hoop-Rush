import type {
  CapRushBoxParticipant,
  CapRushBoxScore,
  CapRushFranchiseAssignment,
  CapRushLeagueGame,
  CapRushLeagueScheduleEntry,
  CapRushLockedInputs,
  CapRushTeamBox,
  HavocBattleInput,
  HavocBattleTeamInput,
  HavocParticipantLine,
  HavocTeamInput,
  HavocTeamResult,
} from '@hoop-rush/data-contracts';
import {
  HAVOC_MUTATION_CATALOG_VERSION,
  HAVOC_RULES_VERSION,
  HAVOC_SCHEMA_VERSION,
  capRushLeagueGameSchema,
  capRushLeagueGameSeed,
} from '@hoop-rush/data-contracts';
import type { EngineContext } from '../../sim/kernel.ts';
import { simulateHavocBattleGame } from '../havoc/core/battle-game.ts';
import { auditHavocBattleGame } from '../havoc/core/battle-audit.ts';
import {
  havocBattleGameInputDigest,
  havocBattleGameResultDigest,
} from '../havoc/core/battle-digests.ts';
import { capRushBattleVersionSet } from './input.ts';

export function capRushLeagueFieldOfLocked(
  locked: CapRushLockedInputs,
): { teamId: string; displayName: string; isUserTeam: boolean }[] {
  return [
    { teamId: locked.human.teamId, displayName: locked.human.displayName, isUserTeam: true },
    ...locked.opponents.map((entry) => ({
      teamId: entry.team.teamId,
      displayName: entry.team.displayName,
      isUserTeam: false,
    })),
  ];
}

export function capRushTeamById(locked: CapRushLockedInputs, teamId: string): HavocTeamInput {
  if (locked.human.teamId === teamId) return locked.human;
  const opponent = locked.opponents.find((entry) => entry.team.teamId === teamId);
  if (opponent === undefined) {
    throw new Error(`cap rush league: unknown team ${teamId}`);
  }
  return opponent.team;
}

function leagueScheduleOf(locked: CapRushLockedInputs): readonly CapRushLeagueScheduleEntry[] {
  if (locked.leagueSchedule === undefined) {
    throw new Error('cap rush league: this run has no league schedule');
  }
  return locked.leagueSchedule;
}

export function capRushLeagueScheduleOf(locked: CapRushLockedInputs): CapRushLeagueScheduleEntry[] {
  return [...leagueScheduleOf(locked)];
}

export function capRushLeagueSlotGames(
  locked: CapRushLockedInputs,
  slot: number,
): CapRushLeagueScheduleEntry[] {
  return leagueScheduleOf(locked).filter(
    (game) =>
      game.slot === slot &&
      game.homeTeamId !== locked.human.teamId &&
      game.awayTeamId !== locked.human.teamId,
  );
}

export function capRushUserLeagueGameOf(
  locked: CapRushLockedInputs,
  slot: number,
): CapRushLeagueScheduleEntry {
  const game = leagueScheduleOf(locked).find(
    (entry) =>
      entry.slot === slot &&
      (entry.homeTeamId === locked.human.teamId || entry.awayTeamId === locked.human.teamId),
  );
  if (game === undefined) {
    throw new Error(`cap rush league: slot ${String(slot)} has no user game`);
  }
  return game;
}

function participantOf(line: HavocParticipantLine): CapRushBoxParticipant {
  return {
    slot: line.slot,
    kind: line.kind,
    playerId: line.sourcePlayerId,
    displayName: line.displayName,
    minutes: line.minutes,
    points: line.points,
    rebounds: line.rebounds.total,
    offensiveRebounds: line.rebounds.offensive,
    defensiveRebounds: line.rebounds.defensive,
    assists: line.assists,
    steals: line.steals,
    blocks: line.blocks,
    turnovers: line.turnovers,
    fouls: line.fouls,
    fieldGoalsMade: line.fieldGoals.made,
    fieldGoalsAttempted: line.fieldGoals.attempted,
    threesMade: line.threes.made,
    threesAttempted: line.threes.attempted,
    freeThrowsMade: line.freeThrows.made,
    freeThrowsAttempted: line.freeThrows.attempted,
    adjustments: line.adjustments,
  };
}

function teamBoxOf(result: HavocTeamResult): CapRushTeamBox {
  return {
    teamId: result.teamId,
    displayName: result.displayName,
    points: result.points,
    adjustments: result.adjustments,
    teamBonusPoints: result.teamBonusPoints,
    periods: [...result.periods],
    participants: result.participants.map((line) => participantOf(line)),
  };
}

export function capRushBoxOf(
  home: HavocTeamResult,
  away: HavocTeamResult,
  overtimePeriods: number,
): CapRushBoxScore {
  return { home: teamBoxOf(home), away: teamBoxOf(away), overtimePeriods };
}

function battleTeamOf(team: HavocTeamInput, side: 'home' | 'away'): HavocBattleTeamInput {
  return { ...team, side };
}

export function simulateCapRushLeagueGame(input: {
  readonly locked: CapRushLockedInputs;
  readonly entry: CapRushLeagueScheduleEntry;
  readonly context: EngineContext;
}): CapRushLeagueGame {
  const { locked, entry } = input;
  if (entry.homeTeamId === locked.human.teamId || entry.awayTeamId === locked.human.teamId) {
    throw new Error('cap rush league: the user game is simulated through the season path');
  }
  const home = capRushTeamById(locked, entry.homeTeamId);
  const away = capRushTeamById(locked, entry.awayTeamId);
  const battleInput: HavocBattleInput = {
    schemaVersion: HAVOC_SCHEMA_VERSION,
    rulesVersion: HAVOC_RULES_VERSION,
    mutationCatalogVersion: HAVOC_MUTATION_CATALOG_VERSION,
    gameNumber: entry.slot,
    variant: 'havoc',
    seed: capRushLeagueGameSeed(locked.runSeed, entry.gameId),
    profile: locked.profile,
    home: battleTeamOf(home, 'home'),
    away: battleTeamOf(away, 'away'),
    versionSet: capRushBattleVersionSet(locked),
  };
  const battle = simulateHavocBattleGame(battleInput, input.context);
  const audit = auditHavocBattleGame(battleInput, battle.result, battle.tape);
  if (!audit.ok) {
    throw new Error(
      `cap rush league: game ${entry.gameId} failed accounting: ${audit.findings.map((finding) => finding.message).join('; ')}`,
    );
  }
  return capRushLeagueGameSchema.parse({
    gameId: entry.gameId,
    slot: entry.slot,
    homeTeamId: entry.homeTeamId,
    awayTeamId: entry.awayTeamId,
    homePoints: battle.result.home.points,
    awayPoints: battle.result.away.points,
    winnerTeamId:
      battle.result.home.points > battle.result.away.points ? entry.homeTeamId : entry.awayTeamId,
    box: capRushBoxOf(battle.result.home, battle.result.away, battle.result.overtimePeriods),
    inputDigest: havocBattleGameInputDigest(battleInput),
    resultDigest: havocBattleGameResultDigest(battle.result),
  });
}

export function simulateCapRushLeagueSlot(input: {
  readonly locked: CapRushLockedInputs;
  readonly slot: number;
  readonly context: EngineContext;
}): CapRushLeagueGame[] {
  return capRushLeagueSlotGames(input.locked, input.slot).map((entry) =>
    simulateCapRushLeagueGame({ locked: input.locked, entry, context: input.context }),
  );
}

export function capRushLeagueGamesTotal(locked: CapRushLockedInputs): number {
  return leagueScheduleOf(locked).filter(
    (game) => game.homeTeamId !== locked.human.teamId && game.awayTeamId !== locked.human.teamId,
  ).length;
}

export function capRushFranchiseOfLocked(locked: CapRushLockedInputs): CapRushFranchiseAssignment {
  if (locked.franchise === undefined) {
    throw new Error('cap rush league: this run has no franchise assignment');
  }
  return locked.franchise;
}
