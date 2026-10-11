import type {
  DraftDuelTapeStatLine,
  GameResult,
  GameSimulationInput,
  SimulationTeam,
} from '@hoop-rush/data-contracts';
import type { EngineContext } from './kernel.ts';
import {
  MAX_PERIODS_HARD_CAP,
  OVERTIME_PERIOD_SECONDS,
  REGULATION_PERIOD_SECONDS,
  overtimePeriodsOf,
} from './clock.ts';
import {
  GameRecorder,
  recorderPlayerStatLine,
  recorderSideStatLine,
  type SideIndex,
} from './recorder.ts';
import { createGameState, createTripContext, resolveTrip } from './possession.ts';
import { buildFacts } from './facts.ts';
export interface TripObservation {
  period: number;
  offense: SideIndex;
  clockSeconds: number;
  secondsElapsed: number;
  ended: boolean;
  homeScore: number;
  awayScore: number;
  homeLines: readonly DraftDuelTapeStatLine[];
  awayLines: readonly DraftDuelTapeStatLine[];
  homeTeamLine: DraftDuelTapeStatLine;
  awayTeamLine: DraftDuelTapeStatLine;
}
export interface PeriodObservation {
  period: number;
  homeScore: number;
  awayScore: number;
}
export interface GameObservers {
  onTrip?: (observation: TripObservation) => void;
  onPeriod?: (observation: PeriodObservation) => void;
}
function playFixedFivePeriods(
  rng: ReturnType<EngineContext['rngFactory']>,
  recorder: GameRecorder,
  state: ReturnType<typeof createGameState>,
  tripContext: ReturnType<typeof createTripContext>,
  observers?: GameObservers,
): {
  overtimePeriods: number;
  winner: 'home' | 'away';
} {
  let offense: SideIndex = rng.chance(0.5) ? 0 : 1;
  let secondsRemaining = REGULATION_PERIOD_SECONDS;
  let period = 0;
  for (;;) {
    if (period > 0) {
      if (period >= 4 && recorder.sides[0].points !== recorder.sides[1].points) break;
      if (period >= MAX_PERIODS_HARD_CAP) {
        throw new Error(
          `simulation: exceeded hard cap ${String(MAX_PERIODS_HARD_CAP)} periods without a winner (${String(recorder.sides[0].points)}-${String(recorder.sides[1].points)})`,
        );
      }
      observers?.onPeriod?.({
        period,
        homeScore: recorder.sides[0].points,
        awayScore: recorder.sides[1].points,
      });
      recorder.nextPeriod();
      secondsRemaining = period < 4 ? REGULATION_PERIOD_SECONDS : OVERTIME_PERIOD_SECONDS;
      state.periodIndex = period;
      state.periodFouls = [0, 0];
      tripContext.possessionStart = 'neutral';
    }
    while (secondsRemaining > 0) {
      state.secondsRemaining = secondsRemaining;
      const result = resolveTrip(tripContext, offense);
      secondsRemaining = state.secondsRemaining;
      observers?.onTrip?.({
        period: state.periodIndex + 1,
        offense,
        clockSeconds: secondsRemaining,
        secondsElapsed: result.secondsElapsed,
        ended: result.ended,
        homeScore: recorder.sides[0].points,
        awayScore: recorder.sides[1].points,
        homeLines: recorder.players[0].map(recorderPlayerStatLine),
        awayLines: recorder.players[1].map(recorderPlayerStatLine),
        homeTeamLine: recorderSideStatLine(recorder.sides[0]),
        awayTeamLine: recorderSideStatLine(recorder.sides[1]),
      });
      if (result.ended) offense = (1 - offense) as SideIndex;
      if (!result.ended && result.secondsElapsed === 0 && secondsRemaining > 0) {
        break;
      }
    }
    period += 1;
    if (period >= MAX_PERIODS_HARD_CAP) break;
  }
  const overtimePeriods = overtimePeriodsOf(recorder.sides[0].periodPoints.length);
  recorder.assignMinutes(48 + overtimePeriods * 5);
  const homeScore = recorder.sides[0].points;
  const awayScore = recorder.sides[1].points;
  if (homeScore === awayScore) {
    throw new Error(
      `simulation: game ended tied ${String(homeScore)}-${String(awayScore)} after ${String(overtimePeriods)} overtime periods`,
    );
  }
  const winner = homeScore > awayScore ? 'home' : 'away';
  return { overtimePeriods, winner };
}
export function simulateGame(
  input: GameSimulationInput,
  context: EngineContext,
  observers?: GameObservers,
): GameResult {
  const rng = context.rngFactory(input.seed);
  const profile = input.profile;
  const teams: [SimulationTeam, SimulationTeam] = [input.home, input.away];
  const recorder = new GameRecorder();
  const state = createGameState();
  const tripContext = createTripContext(rng, recorder, state, profile, teams);
  const { overtimePeriods, winner } = playFixedFivePeriods(
    rng,
    recorder,
    state,
    tripContext,
    observers,
  );
  const side = (index: SideIndex): GameResult['home'] => ({
    teamId: index === 0 ? input.home.teamId : input.away.teamId,
    displayName: index === 0 ? input.home.displayName : input.away.displayName,
    box: recorder.teamBox(index, index === 0 ? input.home.teamId : input.away.teamId),
    players: teams[index].players.map((p, slot) => {
      const box = recorder.playerBox(index, slot);
      return { ...box, playerId: p.playerId };
    }),
    shotZones: recorder.zoneSummary(index),
  });
  const result: GameResult = {
    schemaVersion: 1,
    gameNumber: input.gameNumber,
    seed: input.seed,
    engineVersion: context.engineVersion,
    dataVersion: input.dataVersion,
    profileVersion: profile.profileVersion,
    home: side(0),
    away: side(1),
    periodScores: {
      home: recorder.sides[0].periodPoints,
      away: recorder.sides[1].periodPoints,
    },
    winner,
    overtimePeriods,
    facts: [],
  };
  result.facts = buildFacts(result);
  return result;
}
