import type {
  CapRushGameSummary,
  CapRushLockedInputs,
  CapRushSeasonAggregate,
  CapRushStoredGame,
  HavocGameAudit,
  HavocGameInput,
  HavocGameResult,
  HavocGameTape,
} from '@hoop-rush/data-contracts';
import { CAP_RUSH_GAME_COUNT } from '@hoop-rush/data-contracts';
import type { EngineContext } from '../../sim/kernel.ts';
import { havocGameInputDigest, havocGameResultDigest } from '../havoc/digests.ts';
import {
  battleToSoloResult,
  battleToSoloTape,
  soloToBattleInput,
} from '../havoc/core/battle-adapters.ts';
import { simulateHavocBattleGame } from '../havoc/core/battle-game.ts';
import { auditHavocBattleGame } from '../havoc/core/battle-audit.ts';
import { buildCapRushGameInput } from './input.ts';
import { capRushApronRuntimeFor } from './apron-runtime.ts';
import type { CapRushApronFact } from '@hoop-rush/data-contracts';

export interface CapRushGameSimulation {
  readonly input: HavocGameInput;
  readonly result: HavocGameResult;
  readonly tape: HavocGameTape;
  readonly audit: HavocGameAudit;
  readonly summary: CapRushGameSummary;
  readonly facts: readonly CapRushApronFact[];
}

export function capRushEmptyAggregate(): CapRushSeasonAggregate {
  return {
    games: 0,
    wins: 0,
    losses: 0,
    pointsFor: 0,
    pointsAgainst: 0,
    perfectSeason: false,
  };
}

export function capRushFoldAggregate(
  aggregate: CapRushSeasonAggregate,
  summary: CapRushGameSummary,
): CapRushSeasonAggregate {
  const games = aggregate.games + 1;
  const wins = aggregate.wins + (summary.won ? 1 : 0);
  const losses = aggregate.losses + (summary.won ? 0 : 1);
  return {
    games,
    wins,
    losses,
    pointsFor: aggregate.pointsFor + summary.humanPoints,
    pointsAgainst: aggregate.pointsAgainst + summary.opponentPoints,
    perfectSeason: games === CAP_RUSH_GAME_COUNT && losses === 0,
  };
}

export function simulateCapRushGame(input: {
  readonly locked: CapRushLockedInputs;
  readonly gameNumber: number;
  readonly context: EngineContext;
}): CapRushGameSimulation {
  const { locked, gameNumber } = input;
  const soloInput = buildCapRushGameInput({ locked, gameNumber });
  const humanSide = soloInput.humanSide;
  const apron = capRushApronRuntimeFor(locked, humanSide);
  const battleInput = soloToBattleInput(soloInput);
  const battle = simulateHavocBattleGame(battleInput, input.context, { apron });
  const entry = locked.schedule[gameNumber - 1];
  if (entry === undefined) {
    throw new Error(`cap rush: no schedule entry for game ${String(gameNumber)}`);
  }
  const inputDigest = havocGameInputDigest(soloInput);
  const soloResult = battleToSoloResult(battle.result, humanSide, inputDigest);
  const soloTape = battleToSoloTape(battle.tape, humanSide);
  const battleAudit = auditHavocBattleGame(battleInput, battle.result, battle.tape);
  const humanHome = humanSide === 'home';
  const humanPoints = humanHome ? battle.result.home.points : battle.result.away.points;
  const opponentPoints = humanHome ? battle.result.away.points : battle.result.home.points;
  const summary: CapRushGameSummary = {
    gameNumber,
    opponentId: entry.opponentId,
    humanHome,
    humanPoints,
    opponentPoints,
    won: humanPoints > opponentPoints,
    overtimePeriods: battle.result.overtimePeriods,
    inputDigest,
    resultDigest: havocGameResultDigest(soloResult),
  };
  return {
    input: soloInput,
    result: soloResult,
    tape: soloTape,
    audit: battleAudit,
    summary,
    facts: apron?.recordedFacts() ?? [],
  };
}

export function capRushStoredGameOf(simulation: CapRushGameSimulation): CapRushStoredGame {
  return {
    gameNumber: simulation.summary.gameNumber,
    summary: simulation.summary,
    audit: simulation.audit,
    result: simulation.result,
  };
}
