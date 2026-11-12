import type {
  CapRushLockedInputs,
  CapRushApronFact,
  CapRushPlayoffGamePlan,
  CapRushPlayoffGameSummary,
  CapRushStoredPlayoffGame,
  HavocBattleInput,
  HavocBattleTape,
  HavocBattleTeamInput,
  HavocTeamInput,
} from '@hoop-rush/data-contracts';
import {
  HAVOC_MUTATION_CATALOG_VERSION,
  HAVOC_RULES_VERSION,
  HAVOC_SCHEMA_VERSION,
  havocBattleInputSchema,
} from '@hoop-rush/data-contracts';
import type { EngineContext } from '../../sim/kernel.ts';
import { battleToSoloResult } from '../havoc/core/battle-adapters.ts';
import { simulateAuditedHavocBattleGame } from '../havoc/core/battle-game.ts';
import {
  havocBattleGameInputDigest,
  havocBattleGameResultDigest,
} from '../havoc/core/battle-digests.ts';
import { havocGameResultDigest } from '../havoc/digests.ts';
import { capRushApronRuntimeFor } from './apron-runtime.ts';
import { capRushBattleVersionSet } from './input.ts';
import { capRushPlayoffSummaryOf } from './playoff-shared.ts';
import { capRushPlayoffTeam } from './playoff.ts';

function battleTeamOf(team: HavocTeamInput, side: 'home' | 'away'): HavocBattleTeamInput {
  return { ...team, side };
}

function playoffGameNumber(plan: CapRushPlayoffGamePlan): number {
  const index = (plan.round - 1) * 56 + plan.seriesSlot * 7 + plan.gameOrdinal - 1;
  return (index % 82) + 1;
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
  const battle = simulateAuditedHavocBattleGame(battleInput, input.context, { apron });
  const audit = battle.audit;
  const inputDigest = audit.ok
    ? battle.result.inputDigest
    : havocBattleGameInputDigest(battleInput);
  const userResult =
    humanSide === null ? null : battleToSoloResult(battle.result, humanSide, inputDigest);
  const resultDigest =
    userResult === null
      ? havocBattleGameResultDigest(battle.result)
      : havocGameResultDigest(userResult);
  const summary: CapRushPlayoffGameSummary = capRushPlayoffSummaryOf({
    plan,
    result: battle.result,
    inputDigest,
    resultDigest,
    userSide: humanSide,
    homeTeam,
    awayTeam,
  });
  const facts = apron?.recordedFacts() ?? [];
  apron?.dispose();
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
    get tape() {
      return battle.tape;
    },
    facts,
  };
}
