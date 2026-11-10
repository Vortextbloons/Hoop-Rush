import type {
  CapRushConferenceSeries,
  CapRushApronFact,
  CapRushConferencePostseason,
  CapRushLeagueGame,
  CapRushMultiplayerLockedInputs,
  CapRushMultiplayerPlayoffState,
  CapRushMultiplayerSeatId,
  CapRushPlayoffGamePlan,
  CapRushPlayoffGameSummary,
  CapRushPostseasonUserOutcome,
  HavocBattleInput,
  HavocBattleResult,
  HavocBattleTape,
} from '@hoop-rush/data-contracts';
import {
  CAP_RUSH_CONFERENCE_POSTSEASON_VERSION,
  CAP_RUSH_MULTIPLAYER_POSTSEASON_VERSION,
  CAP_RUSH_PLAYOFF_ROUNDS,
  capRushPlayoffGameSummarySchema,
  capRushSeriesComplete,
  capRushSeriesWinner,
} from '@hoop-rush/data-contracts';
import type { EngineContext } from '../../../sim/kernel.ts';
import { simulateAuditedHavocBattleGame } from '../../havoc/core/battle-game.ts';
import { havocBattleGameResultDigest } from '../../havoc/core/battle-digests.ts';
import {
  capRushConferenceFinalsMvp,
  capRushConferenceOpeningSeries,
  capRushRefreshConferencePostseason,
} from '../conference-postseason.ts';
import { capRushNextPlayoffGamePlan, capRushPlayoffSummaryOf } from '../playoff-shared.ts';
import { capRushMultiplayerPlayoffInputFor } from './input.ts';
import { capRushMultiplayerApronFor } from './apron.ts';
import { capRushMultiplayerStandings } from './league.ts';

export interface CapRushMultiplayerPlayoffPlan {
  readonly plan: CapRushPlayoffGamePlan;
  readonly seat: CapRushMultiplayerSeatId | null;
}

export interface CapRushMultiplayerPlayoffSimulation {
  readonly game: CapRushPlayoffGameSummary;
  readonly tape: HavocBattleTape;
  readonly facts: readonly CapRushApronFact[];
  readonly input: HavocBattleInput;
  readonly result: HavocBattleResult;
}

function outcomeOf(
  status: CapRushPostseasonUserOutcome['status'],
  round: number | null,
): CapRushPostseasonUserOutcome {
  return { status, round };
}

export function capRushMultiplayerOpenPostseason(input: {
  readonly locked: CapRushMultiplayerLockedInputs;
  readonly games: readonly CapRushLeagueGame[];
}): CapRushMultiplayerPlayoffState {
  const standings = capRushMultiplayerStandings(input.locked, input.games);
  const series = capRushConferenceOpeningSeries(standings);
  const qualified = new Set(standings.qualifiedTeamIds);
  const seatOutcome = (seat: CapRushMultiplayerSeatId): CapRushPostseasonUserOutcome => {
    const teamId = input.locked.seats[seat].franchise.franchiseId;
    return qualified.has(teamId) ? outcomeOf('pending', null) : outcomeOf('not-qualified', null);
  };
  return {
    version: CAP_RUSH_MULTIPLAYER_POSTSEASON_VERSION,
    phase: 'playoffs',
    standings,
    series,
    outcomes: { p1: seatOutcome('p1'), p2: seatOutcome('p2') },
    plans: { p1: null, p2: null },
    planRound: 1,
    championTeamId: null,
    finalsMvp: null,
    completedAt: null,
  };
}

function seatInSeries(
  locked: CapRushMultiplayerLockedInputs,
  series: { readonly highTeamId: string; readonly lowTeamId: string },
): CapRushMultiplayerSeatId | null {
  for (const seat of ['p1', 'p2'] as const) {
    const teamId = locked.seats[seat].franchise.franchiseId;
    if (series.highTeamId === teamId || series.lowTeamId === teamId) return seat;
  }
  return null;
}

export function capRushMultiplayerCurrentRound(state: CapRushMultiplayerPlayoffState): number {
  if (state.series.length === 0) return 1;
  return Math.max(...state.series.map((series) => series.round));
}

export function capRushMultiplayerPlayoffPlans(input: {
  readonly locked: CapRushMultiplayerLockedInputs;
  readonly state: CapRushMultiplayerPlayoffState;
}): CapRushMultiplayerPlayoffPlan[] {
  const round = capRushMultiplayerCurrentRound(input.state);
  const current = input.state.series
    .filter((series) => series.round === round)
    .sort((left, right) => left.seriesSlot - right.seriesSlot);
  const plans: CapRushMultiplayerPlayoffPlan[] = [];
  for (const series of current) {
    if (capRushSeriesComplete(series)) continue;
    const seat = seatInSeries(input.locked, series);
    const userTeamId =
      seat === null
        ? input.locked.seats.p1.franchise.franchiseId
        : input.locked.seats[seat].franchise.franchiseId;
    plans.push({
      plan: capRushNextPlayoffGamePlan({
        series,
        runSeed: input.locked.rootSeed,
        userTeamId,
      }),
      seat,
    });
  }
  return plans;
}

export function simulateCapRushMultiplayerPlayoffGame(input: {
  readonly locked: CapRushMultiplayerLockedInputs;
  readonly plan: CapRushPlayoffGamePlan;
  readonly context: EngineContext;
}): CapRushMultiplayerPlayoffSimulation {
  const battleInput = capRushMultiplayerPlayoffInputFor({
    locked: input.locked,
    plan: input.plan,
  });
  const apron = capRushMultiplayerApronFor({
    locked: input.locked,
    homeTeamId: input.plan.homeTeamId,
    awayTeamId: input.plan.awayTeamId,
  });
  const battle = simulateAuditedHavocBattleGame(battleInput, input.context, {
    apron: apron?.hooks,
  });
  const audit = battle.audit;
  if (!audit.ok) {
    throw new Error(
      `cap rush multiplayer: playoff game failed accounting: ${audit.findings
        .map((finding) => finding.message)
        .join('; ')}`,
    );
  }
  const homeTeam =
    input.plan.homeTeamId === input.locked.seats.p1.franchise.franchiseId
      ? input.locked.seats.p1.team
      : input.plan.homeTeamId === input.locked.seats.p2.franchise.franchiseId
        ? input.locked.seats.p2.team
        : input.locked.opponents.find((entry) => entry.team.teamId === input.plan.homeTeamId)?.team;
  const awayTeam =
    input.plan.awayTeamId === input.locked.seats.p1.franchise.franchiseId
      ? input.locked.seats.p1.team
      : input.plan.awayTeamId === input.locked.seats.p2.franchise.franchiseId
        ? input.locked.seats.p2.team
        : input.locked.opponents.find((entry) => entry.team.teamId === input.plan.awayTeamId)?.team;
  if (homeTeam === undefined || awayTeam === undefined) {
    throw new Error('cap rush multiplayer: unknown playoff team');
  }
  const summary = capRushPlayoffGameSummarySchema.parse(
    capRushPlayoffSummaryOf({
      plan: input.plan,
      result: battle.result,
      inputDigest: battle.result.inputDigest,
      resultDigest: havocBattleGameResultDigest(battle.result),
      userSide: input.plan.userSide,
      homeTeam,
      awayTeam,
    }),
  );
  return {
    game: summary,
    get tape() {
      return battle.tape;
    },
    facts: apron?.facts() ?? [],
    input: battleInput,
    result: battle.result,
  };
}

function outcomeForSeat(input: {
  readonly locked: CapRushMultiplayerLockedInputs;
  readonly postseason: CapRushConferencePostseason;
  readonly seat: CapRushMultiplayerSeatId;
}): CapRushPostseasonUserOutcome {
  const teamId = input.locked.seats[input.seat].franchise.franchiseId;
  if (input.postseason.championTeamId !== null) {
    if (input.postseason.championTeamId === teamId) {
      return outcomeOf('champion', CAP_RUSH_PLAYOFF_ROUNDS);
    }
    const qualified = input.postseason.standings?.qualifiedTeamIds.includes(teamId) ?? false;
    return qualified
      ? outcomeOf('eliminated', CAP_RUSH_PLAYOFF_ROUNDS)
      : outcomeOf('not-qualified', null);
  }
  const rounds = input.postseason.series
    .filter((series) => series.highTeamId === teamId || series.lowTeamId === teamId)
    .sort((left, right) => right.round - left.round);
  const latest = rounds[0];
  if (latest === undefined) return outcomeOf('not-qualified', null);
  if (capRushSeriesComplete(latest) && capRushSeriesWinner(latest) !== teamId) {
    return outcomeOf('eliminated', latest.round);
  }
  return outcomeOf('pending', null);
}

export function capRushMultiplayerApplyPlayoffStep(input: {
  readonly locked: CapRushMultiplayerLockedInputs;
  readonly state: CapRushMultiplayerPlayoffState;
  readonly games: readonly CapRushPlayoffGameSummary[];
}): CapRushMultiplayerPlayoffState {
  const series = input.state.series.map((entry) => ({
    ...entry,
    games: [...entry.games],
  }));
  for (const game of input.games) {
    const target = series.find((entry) => entry.seriesId === game.seriesId);
    if (target === undefined) {
      throw new Error(`cap rush multiplayer: unknown playoff series ${game.seriesId}`);
    }
    if (!target.games.some((existing) => existing.gameId === game.gameId)) {
      target.games.push(game);
    }
  }
  const p1TeamId = input.locked.seats.p1.franchise.franchiseId;
  const base: CapRushConferencePostseason = {
    version: CAP_RUSH_CONFERENCE_POSTSEASON_VERSION,
    format: 'conference',
    phase: 'playoffs',
    standings: input.state.standings,
    series,
    userOutcome: input.state.outcomes.p1,
    championTeamId: input.state.championTeamId,
    finalsMvp: input.state.finalsMvp,
    completedAt: input.state.completedAt,
  };
  const refreshed = capRushRefreshConferencePostseason({
    postseason: base,
    userTeamId: p1TeamId,
  });
  const outcomes = {
    p1: outcomeForSeat({ locked: input.locked, postseason: refreshed, seat: 'p1' }),
    p2: outcomeForSeat({ locked: input.locked, postseason: refreshed, seat: 'p2' }),
  };
  const champion = refreshed.championTeamId;
  const finalsMvp =
    champion === null
      ? null
      : capRushConferenceFinalsMvp(
          refreshed,
          champion === p1TeamId ? p1TeamId : input.locked.seats.p2.franchise.franchiseId,
        );
  const round = capRushMultiplayerCurrentRound({
    ...input.state,
    series: refreshed.series,
  });
  const advanced = round > input.state.planRound;
  return {
    ...input.state,
    series: refreshed.series,
    outcomes,
    championTeamId: champion,
    finalsMvp,
    plans: advanced ? { p1: null, p2: null } : input.state.plans,
    planRound: round,
  };
}

export function capRushMultiplayerHumanFinals(
  locked: CapRushMultiplayerLockedInputs,
  state: CapRushMultiplayerPlayoffState,
): CapRushConferenceSeries | null {
  const ids = [locked.seats.p1.franchise.franchiseId, locked.seats.p2.franchise.franchiseId];
  return (
    state.series.find(
      (series) =>
        series.round === 4 && (ids.includes(series.highTeamId) || ids.includes(series.lowTeamId)),
    ) ?? null
  );
}
