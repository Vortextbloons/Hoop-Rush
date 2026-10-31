import type {
  CapRushLockedInputs,
  CapRushApronFact,
  CapRushPlayoffGamePlan,
  CapRushPlayoffGameSummary,
  CapRushPlayoffParticipant,
  CapRushStoredPlayoffGame,
  HavocBattleInput,
  HavocBattleTape,
  HavocBattleTeamInput,
  HavocParticipantLine,
  HavocTeamInput,
  Position,
} from '@hoop-rush/data-contracts';
import {
  CAP_RUSH_PLAYOFF_ROUNDS,
  HAVOC_MUTATION_CATALOG_VERSION,
  HAVOC_RULES_VERSION,
  HAVOC_SCHEMA_VERSION,
  havocBattleInputSchema,
  playerIdSchema,
} from '@hoop-rush/data-contracts';
import type { EngineContext } from '../../sim/kernel.ts';
import { battleToSoloResult } from '../havoc/core/battle-adapters.ts';
import { simulateValidatedHavocBattleGame } from '../havoc/core/battle-game.ts';
import { auditHavocBattleGame } from '../havoc/core/battle-audit.ts';
import {
  havocBattleGameInputDigest,
  havocBattleGameResultDigest,
} from '../havoc/core/battle-digests.ts';
import { havocGameResultDigest } from '../havoc/digests.ts';
import { capRushApronRuntimeFor } from './apron-runtime.ts';
import { capRushBattleVersionSet } from './input.ts';
import { capRushBoxOf } from './league-simulation.ts';
import { capRushPlayoffTeam } from './playoff.ts';

function battleTeamOf(team: HavocTeamInput, side: 'home' | 'away'): HavocBattleTeamInput {
  return { ...team, side };
}

function playoffGameNumber(plan: CapRushPlayoffGamePlan): number {
  const index = (plan.round - 1) * 56 + plan.seriesSlot * 7 + plan.gameOrdinal - 1;
  return (index % 82) + 1;
}

function ownerSlotMapsOf(team: HavocTeamInput): {
  readonly slotByInstance: Map<string, Position>;
  readonly starterBySlot: Map<Position, HavocTeamInput['starters'][number]>;
} {
  const slotByInstance = new Map<string, Position>();
  const starterBySlot = new Map<Position, HavocTeamInput['starters'][number]>();
  for (const starter of team.starters) {
    slotByInstance.set(starter.instanceId, starter.slot);
    starterBySlot.set(starter.slot, starter);
  }
  for (const replacement of team.replacements) {
    slotByInstance.set(replacement.instanceId, replacement.slot);
  }
  for (const clone of team.clones) {
    slotByInstance.set(clone.instanceId, clone.slot);
  }
  return { slotByInstance, starterBySlot };
}

function participantGroupOf(
  line: HavocParticipantLine,
  maps: ReturnType<typeof ownerSlotMapsOf>,
): Position | null {
  const ownerId = line.ownerInstanceId ?? line.instanceId;
  return maps.slotByInstance.get(ownerId) ?? null;
}

function finalsLinesOf(input: {
  readonly team: HavocTeamInput;
  readonly resultParticipants: readonly HavocParticipantLine[];
}): CapRushPlayoffParticipant[] {
  const maps = ownerSlotMapsOf(input.team);
  return input.resultParticipants.flatMap((line) => {
    const slot = participantGroupOf(line, maps);
    if (slot === null) return [];
    const starter = maps.starterBySlot.get(slot);
    if (starter === undefined) return [];
    return [
      {
        teamId: input.team.teamId,
        slot,
        playerId: playerIdSchema.parse(starter.source.playerId),
        displayName: starter.source.displayName,
        kind: line.kind,
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
        freeThrowsMade: line.freeThrows.made,
        freeThrowsAttempted: line.freeThrows.attempted,
        threesMade: line.threes.made,
        threesAttempted: line.threes.attempted,
        adjustments: line.adjustments,
      },
    ];
  });
}

export interface CapRushPlayoffSimulation {
  readonly game: CapRushStoredPlayoffGame;
  readonly inputDigest: string;
  readonly resultDigest: string;
  readonly battleInput: HavocBattleInput;
  readonly tape: HavocBattleTape;
  readonly facts: readonly CapRushApronFact[];
}

export function simulateCapRushPlayoffGame(input: {
  readonly locked: CapRushLockedInputs;
  readonly plan: CapRushPlayoffGamePlan;
  readonly context: EngineContext;
}): CapRushPlayoffSimulation {
  const { locked, plan } = input;
  if (plan.homeTeamId === plan.awayTeamId) {
    throw new Error('cap rush playoffs: a team cannot play itself');
  }
  const opponentById = new Map(locked.opponents.map((entry) => [entry.team.teamId, entry.team]));
  const performance = locked.playoffPerformance;
  const homeTeam =
    plan.homeTeamId === locked.human.teamId
      ? capRushPlayoffTeam({ team: locked.human, performance })
      : (() => {
          const team = opponentById.get(plan.homeTeamId);
          return team === undefined ? undefined : capRushPlayoffTeam({ team, performance });
        })();
  const awayTeam =
    plan.awayTeamId === locked.human.teamId
      ? capRushPlayoffTeam({ team: locked.human, performance })
      : (() => {
          const team = opponentById.get(plan.awayTeamId);
          return team === undefined ? undefined : capRushPlayoffTeam({ team, performance });
        })();
  if (homeTeam === undefined || awayTeam === undefined) {
    throw new Error('cap rush playoffs: unknown team in the playoff matchup');
  }
  const humanSide =
    plan.homeTeamId === locked.human.teamId
      ? 'home'
      : plan.awayTeamId === locked.human.teamId
        ? 'away'
        : null;
  const battleInput: HavocBattleInput = havocBattleInputSchema.parse({
    schemaVersion: HAVOC_SCHEMA_VERSION,
    rulesVersion: HAVOC_RULES_VERSION,
    mutationCatalogVersion: HAVOC_MUTATION_CATALOG_VERSION,
    gameNumber: playoffGameNumber(plan),
    variant: 'havoc',
    seed: plan.seed,
    profile: locked.profile,
    home: battleTeamOf(homeTeam, 'home'),
    away: battleTeamOf(awayTeam, 'away'),
    versionSet: capRushBattleVersionSet(locked),
  });
  const apron = humanSide === null ? undefined : capRushApronRuntimeFor(locked, humanSide);
  const battle = simulateValidatedHavocBattleGame(battleInput, input.context, { apron });
  const audit = auditHavocBattleGame(battleInput, battle.result, battle.tape);
  const inputDigest = audit.ok
    ? battle.result.inputDigest
    : havocBattleGameInputDigest(battleInput);
  const userResult =
    humanSide === null ? null : battleToSoloResult(battle.result, humanSide, inputDigest);
  const resultDigest =
    userResult === null
      ? havocBattleGameResultDigest(battle.result)
      : havocGameResultDigest(userResult);
  const summary: CapRushPlayoffGameSummary = {
    gameId: `crp-${String(plan.round)}-${String(plan.seriesSlot)}-${String(plan.gameOrdinal)}`,
    seriesId: plan.seriesId,
    round: plan.round,
    seriesSlot: plan.seriesSlot,
    gameOrdinal: plan.gameOrdinal,
    seed: plan.seed,
    homeTeamId: plan.homeTeamId,
    awayTeamId: plan.awayTeamId,
    homeSeed: plan.homeSeed,
    awaySeed: plan.awaySeed,
    userSide: humanSide,
    homePoints: battle.result.home.points,
    awayPoints: battle.result.away.points,
    winnerTeamId:
      battle.result.home.points > battle.result.away.points ? plan.homeTeamId : plan.awayTeamId,
    overtimePeriods: battle.result.overtimePeriods,
    inputDigest,
    resultDigest,
    box: capRushBoxOf(battle.result.home, battle.result.away, battle.result.overtimePeriods),
    ...(plan.round === CAP_RUSH_PLAYOFF_ROUNDS
      ? {
          finalsLines: [
            ...finalsLinesOf({
              team: homeTeam,
              resultParticipants: battle.result.home.participants,
            }),
            ...finalsLinesOf({
              team: awayTeam,
              resultParticipants: battle.result.away.participants,
            }),
          ],
        }
      : {}),
  };
  return {
    game: {
      gameId: summary.gameId,
      summary,
      audit,
      result: userResult,
    },
    inputDigest,
    resultDigest,
    battleInput,
    tape: battle.tape,
    facts: apron?.recordedFacts() ?? [],
  };
}
