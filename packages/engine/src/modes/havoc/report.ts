import type {
  HavocDifference,
  HavocReport,
  HavocSeasonAggregate,
  HavocSeasonTotals,
  HavocWildGame,
  Seed,
} from '@hoop-rush/data-contracts';
import {
  HAVOC_REPORT_VERSION,
  HAVOC_SCHEMA_VERSION,
  havocGameSeed,
  havocReportSchema,
} from '@hoop-rush/data-contracts';
import type { DeriveHavocReportInput, HavocStoredGame } from './api.ts';
import { havocHumanTeamOf, havocOpponentTeamOf, havocSeasonTotalsOf } from './comparison.ts';

const MATCHED_GAMES = 82;
const MAX_WILD_GAMES = 5;

function validateGames(
  games: readonly HavocStoredGame[],
  variant: 'havoc' | 'normal',
  runSeed: Seed,
  humanHome: readonly boolean[],
): void {
  const seen = new Set<number>();
  for (const game of games) {
    if (game.gameNumber < 1 || game.gameNumber > MATCHED_GAMES) {
      throw new Error(
        `havoc report: ${variant} game number out of range (${String(game.gameNumber)})`,
      );
    }
    if (seen.has(game.gameNumber)) {
      throw new Error(`havoc report: duplicate ${variant} game ${String(game.gameNumber)}`);
    }
    seen.add(game.gameNumber);
    if (game.result.gameNumber !== game.gameNumber) {
      throw new Error(
        `havoc report: ${variant} stored game ${String(game.gameNumber)} carries result game ${String(game.result.gameNumber)}`,
      );
    }
    if (game.result.variant !== variant) {
      throw new Error(
        `havoc report: game ${String(game.gameNumber)} ${variant} slot carries variant ${game.result.variant}`,
      );
    }
    const expectedSeed = havocGameSeed(runSeed, game.gameNumber);
    if (game.result.seed !== expectedSeed) {
      throw new Error(
        `havoc report: game ${String(game.gameNumber)} ${variant} seed does not match the shared game seed`,
      );
    }
    const expectedSide = humanHome[game.gameNumber - 1] === true ? 'home' : 'away';
    if (game.result.humanSide !== expectedSide) {
      throw new Error(
        `havoc report: game ${String(game.gameNumber)} ${variant} human side ${game.result.humanSide} != schedule ${expectedSide}`,
      );
    }
  }
}

function reconcileAggregate(
  label: string,
  aggregate: HavocSeasonAggregate,
  totals: HavocSeasonTotals,
): void {
  const mismatches: string[] = [];
  if (aggregate.games !== totals.games) {
    mismatches.push(`games ${String(aggregate.games)} != ${String(totals.games)}`);
  }
  if (aggregate.wins !== totals.wins) {
    mismatches.push(`wins ${String(aggregate.wins)} != ${String(totals.wins)}`);
  }
  if (aggregate.losses !== totals.losses) {
    mismatches.push(`losses ${String(aggregate.losses)} != ${String(totals.losses)}`);
  }
  if (aggregate.pointsFor !== totals.pointsFor) {
    mismatches.push(`pointsFor ${String(aggregate.pointsFor)} != ${String(totals.pointsFor)}`);
  }
  if (aggregate.pointsAgainst !== totals.pointsAgainst) {
    mismatches.push(
      `pointsAgainst ${String(aggregate.pointsAgainst)} != ${String(totals.pointsAgainst)}`,
    );
  }
  if (aggregate.adjustments !== totals.adjustments) {
    mismatches.push(
      `adjustments ${String(aggregate.adjustments)} != ${String(totals.adjustments)}`,
    );
  }
  if (mismatches.length > 0) {
    throw new Error(
      `havoc report: ${label} aggregate does not reconcile: ${mismatches.join(', ')}`,
    );
  }
}

function reconcileTotals(
  label: string,
  expected: HavocSeasonTotals,
  actual: HavocSeasonTotals,
): void {
  const mismatches: string[] = [];
  for (const key of [
    'games',
    'wins',
    'losses',
    'pointsFor',
    'pointsAgainst',
    'differential',
    'largestPointsFor',
    'largestPointsAgainst',
    'adjustments',
  ] as const) {
    if (expected[key] !== actual[key]) {
      mismatches.push(`${key} ${String(expected[key])} != ${String(actual[key])}`);
    }
  }
  if (expected.averagePointsFor !== actual.averagePointsFor) {
    mismatches.push(
      `averagePointsFor ${String(expected.averagePointsFor)} != ${String(actual.averagePointsFor)}`,
    );
  }
  if (expected.averagePointsAgainst !== actual.averagePointsAgainst) {
    mismatches.push(
      `averagePointsAgainst ${String(expected.averagePointsAgainst)} != ${String(actual.averagePointsAgainst)}`,
    );
  }
  if (mismatches.length > 0) {
    throw new Error(`havoc report: ${label} totals do not reconcile: ${mismatches.join(', ')}`);
  }
}

function wildestGamesOf(
  games: readonly HavocStoredGame[],
  opponentOf: (gameNumber: number) => string,
): HavocWildGame[] {
  const wild: HavocWildGame[] = [];
  for (const game of games) {
    const human = havocHumanTeamOf(game.result);
    const opponent = havocOpponentTeamOf(game.result);
    wild.push({
      gameNumber: game.gameNumber,
      opponentId: opponentOf(game.gameNumber),
      humanScore: human.points,
      opponentScore: opponent.points,
      adjustments: human.adjustments,
      absoluteMargin: Math.abs(human.points - opponent.points),
    });
  }
  wild.sort((a, b) =>
    b.absoluteMargin !== a.absoluteMargin
      ? b.absoluteMargin - a.absoluteMargin
      : a.gameNumber - b.gameNumber,
  );
  return wild.slice(0, MAX_WILD_GAMES);
}

function copyDifference(difference: HavocDifference): HavocDifference {
  return { ...difference };
}

function directMutationPointsOf(games: readonly HavocStoredGame[]): number {
  let total = 0;
  for (const game of games) {
    for (const rollup of game.result.rollups) {
      total += rollup.pointsDelta;
    }
  }
  return total;
}

export function deriveHavocReport(input: DeriveHavocReportInput): HavocReport {
  const { state, havocGames, normalGames, comparison } = input;
  const locked = state.locked;
  if (locked === null) {
    throw new Error('havoc report: run state has no locked inputs');
  }
  if (havocGames.length !== state.havocCursor) {
    throw new Error(
      `havoc report: ${String(havocGames.length)} havoc games stored but the run cursor is ${String(state.havocCursor)}`,
    );
  }
  const humanHome = locked.schedule.map((entry) => entry.humanHome);
  validateGames(havocGames, 'havoc', locked.runSeed, humanHome);
  const havoc = havocSeasonTotalsOf(havocGames);
  reconcileAggregate('havoc', state.havocAggregate, havoc);
  const perfectSeason = havoc.games === MATCHED_GAMES && havoc.losses === 0;
  if (state.perfectSeason !== perfectSeason) {
    throw new Error(
      `havoc report: perfect-season flag ${String(state.perfectSeason)} disagrees with the havoc record (${String(havoc.wins)}-${String(havoc.losses)})`,
    );
  }
  if (comparison !== null) {
    if (comparison.runId !== state.runId) {
      throw new Error('havoc report: comparison belongs to another run');
    }
    if (normalGames.length > 0) {
      if (normalGames.length !== MATCHED_GAMES) {
        throw new Error(
          `havoc report: expected ${String(MATCHED_GAMES)} normal games, got ${String(normalGames.length)}`,
        );
      }
      validateGames(normalGames, 'normal', locked.runSeed, humanHome);
      reconcileTotals('normal', comparison.normal, havocSeasonTotalsOf(normalGames));
    }
  }
  const opponentOf = (gameNumber: number): string => {
    const entry = locked.schedule[gameNumber - 1];
    if (entry === undefined) {
      throw new Error(`havoc report: no schedule entry for game ${String(gameNumber)}`);
    }
    return entry.opponentId;
  };
  const lineup = [...locked.picks]
    .sort((a, b) => a.pickOrdinal - b.pickOrdinal)
    .map((pick) => ({
      slot: pick.slot,
      displayName: pick.card.source.displayName,
      nickname: pick.card.nickname,
      playerId: pick.card.source.playerId,
      playerVersionId: pick.card.source.playerVersionId,
      tier: pick.card.tier,
      mutations: pick.card.mutations,
    }));
  return havocReportSchema.parse({
    schemaVersion: HAVOC_SCHEMA_VERSION,
    reportVersion: HAVOC_REPORT_VERSION,
    runId: state.runId,
    versions: state.versionSet,
    status: comparison === null ? 'comparison-pending' : 'complete',
    lineup,
    havoc,
    normal: comparison === null ? null : comparison.normal,
    perfectSeason,
    directMutationPoints: directMutationPointsOf(havocGames),
    mvp: comparison === null ? null : comparison.mvp,
    comparison,
    topGains: comparison === null ? [] : comparison.largestPositiveDifferences.map(copyDifference),
    topLosses: comparison === null ? [] : comparison.largestNegativeDifferences.map(copyDifference),
    wildestGames: wildestGamesOf(havocGames, opponentOf),
  });
}
