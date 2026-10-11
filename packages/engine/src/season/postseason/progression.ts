import type {
  EraSimulationProfile,
  Position,
  SeasonDraftCatalog,
  SeasonGamePlayerInput,
  SeasonPostseasonSummary,
} from '@hoop-rush/data-contracts';
import { seasonFranchiseLegalFiveFacts } from '../health.ts';
import { seasonPlayerAvailable } from '../injuries.ts';
import type { SeasonEconomyRun } from '../trade-valuation.ts';
import {
  simulateSeasonPostseasonGame,
  type SeasonPostseasonGameOutcome,
  type SeasonPostseasonGameResolver,
} from './game.ts';
import { seasonPostseasonHumanPlaysGame, seasonPostseasonNextGame } from './schedule.ts';
import { seasonPostseasonApplyGameResult } from './state.ts';
export interface SeasonPostseasonProgressionDeps {
  catalog: SeasonDraftCatalog;
  profile: EraSimulationProfile;
  resolver?: SeasonPostseasonGameResolver;
}
export interface SeasonPostseasonProgressionOptions {
  humanFranchiseId: string | null;
  expanded: ReadonlyMap<string, SeasonGamePlayerInput>;
  targetGameId?: string;
  stopOnHumanRotation?: boolean;
  forfeitNextHumanGame?: boolean;
}
export type SeasonPostseasonProgressionOutcome =
  | {
      kind: 'progressed';
      run: SeasonEconomyRun;
      advancedGameIds: string[];
      summaries: SeasonPostseasonSummary[];
      humanWaitGameId: string | null;
    }
  | {
      kind: 'integrity-failure';
      reason: string;
    };
function applySeasonPostseasonGameOutcome(
  run: SeasonEconomyRun,
  outcome: Extract<SeasonPostseasonGameOutcome, { kind: 'simulated' }>,
): SeasonEconomyRun {
  return {
    ...run,
    postseason: seasonPostseasonApplyGameResult(
      run.postseason,
      outcome.facts,
      run.league,
      run.standings,
    ),
    health: outcome.nextHealth,
    effects: outcome.nextEffects,
  };
}
export function advanceSeasonPostseason(
  run: SeasonEconomyRun,
  deps: SeasonPostseasonProgressionDeps,
  options: SeasonPostseasonProgressionOptions,
): SeasonPostseasonProgressionOutcome {
  const humanFranchiseId = options.humanFranchiseId;
  const positions = new Map<string, readonly Position[]>();
  for (const player of options.expanded.values()) {
    positions.set(player.playerVersionId, player.positions);
  }
  let current = run;
  const advanced: string[] = [];
  const summaries: SeasonPostseasonSummary[] = [];
  let humanWait: string | null = null;
  let integrityReason: string | null = null;
  let forfeitedHumanGame = false;
  for (;;) {
    const decision = seasonPostseasonNextGame(current.postseason);
    if (decision.kind === 'integrity-failure') {
      integrityReason = decision.reason;
      break;
    }
    if (decision.kind === 'complete') break;
    const gameId = decision.gameId;
    if (
      humanFranchiseId !== null &&
      seasonPostseasonHumanPlaysGame(current.postseason, gameId, humanFranchiseId)
    ) {
      if (options.forfeitNextHumanGame === true) {
        const outcome = simulateSeasonPostseasonGame(
          {
            run: current,
            effects: current.effects,
            expanded: options.expanded,
            catalog: deps.catalog,
            profile: deps.profile,
            gameId,
            humanFranchiseId,
            forfeitHumanGame: true,
          },
          { resolver: deps.resolver },
        );
        if (outcome.kind === 'integrity-failure') {
          integrityReason = outcome.reason;
          break;
        }
        current = applySeasonPostseasonGameOutcome(current, outcome);
        advanced.push(gameId);
        summaries.push(outcome.summary);
        forfeitedHumanGame = true;
        break;
      }
      if (options.stopOnHumanRotation === true) {
        const humanRotation = current.rotations.find(
          (rotation) => rotation.franchiseId === humanFranchiseId,
        );
        const minutesOnUnavailable = (humanRotation?.targetMinutes ?? []).some(
          (entry) =>
            entry.minutes > 0 && !seasonPlayerAvailable(current.health, entry.playerVersionId),
        );
        const legalFacts = seasonFranchiseLegalFiveFacts(
          current,
          humanFranchiseId,
          current.health,
          positions,
        );
        if (minutesOnUnavailable || !legalFacts.legal) {
          humanWait = gameId;
          break;
        }
      }
    }
    const outcome = simulateSeasonPostseasonGame(
      {
        run: current,
        effects: current.effects,
        expanded: options.expanded,
        catalog: deps.catalog,
        profile: deps.profile,
        gameId,
        humanFranchiseId,
      },
      { resolver: deps.resolver },
    );
    if (outcome.kind === 'integrity-failure') {
      integrityReason = outcome.reason;
      break;
    }
    current = applySeasonPostseasonGameOutcome(current, outcome);
    advanced.push(gameId);
    summaries.push(outcome.summary);
    if (options.targetGameId !== undefined && gameId === options.targetGameId) break;
  }
  if (options.forfeitNextHumanGame === true && !forfeitedHumanGame && integrityReason === null) {
    integrityReason = 'forfeit requested, but the human franchise has no upcoming game';
  }
  if (integrityReason !== null) {
    return { kind: 'integrity-failure', reason: integrityReason };
  }
  return {
    kind: 'progressed',
    run: current,
    advancedGameIds: advanced,
    summaries,
    humanWaitGameId: humanWait,
  };
}
