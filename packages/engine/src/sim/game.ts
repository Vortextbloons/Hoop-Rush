import type { GameResult, GameSimulationInput, SimulationTeam } from '@hoop-rush/data-contracts';
import type { EngineContext } from './context.ts';
import {
  MAX_PERIODS,
  OVERTIME_PERIOD_SECONDS,
  REGULATION_PERIOD_SECONDS,
  resolveGameWinner,
} from './periods.ts';
import { GameRecorder, type SideIndex } from './recorder.ts';
import { createGameState, createTripContext, resolveTrip } from './possession.ts';
import { buildFacts } from './facts.ts';

export function playFixedFivePeriods(
  rng: ReturnType<EngineContext['rngFactory']>,
  recorder: GameRecorder,
  state: ReturnType<typeof createGameState>,
  tripContext: ReturnType<typeof createTripContext>,
): { overtimePeriods: number; winner: 'home' | 'away' } {
  let offense: SideIndex = rng.chance(0.5) ? 0 : 1;
  let secondsRemaining = REGULATION_PERIOD_SECONDS;
  state.periodIndex = 0;

  for (let period = 0; period < MAX_PERIODS; period += 1) {
    if (period > 0) {
      if (period >= 4) {
        if (recorder.sides[0].points !== recorder.sides[1].points) break;
      }
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
      if (result.ended) offense = (1 - offense) as SideIndex;
      if (!result.ended && result.secondsElapsed === 0 && secondsRemaining > 0) {
        break;
      }
    }
  }

  const overtimePeriods = Math.max(0, recorder.sides[0].periodPoints.length - 4);

  recorder.assignMinutes(48 + overtimePeriods * 5);

  const homeScore = recorder.sides[0].points;
  const awayScore = recorder.sides[1].points;
  const winner = resolveGameWinner(homeScore, awayScore, rng);

  return { overtimePeriods, winner };
}

export function simulateGame(input: GameSimulationInput, context: EngineContext): GameResult {
  const rng = context.rngFactory(input.seed);
  const profile = input.profile;
  const teams: [SimulationTeam, SimulationTeam] = [input.home, input.away];
  const recorder = new GameRecorder();
  const state = createGameState();
  const tripContext = createTripContext(rng, recorder, state, profile, teams);

  const { overtimePeriods, winner } = playFixedFivePeriods(rng, recorder, state, tripContext);

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
