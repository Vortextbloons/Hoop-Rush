import type { GameResult, GameSimulationInput, SimulationTeam } from '@hoop-rush/data-contracts';
import type { EngineContext } from './context.ts';
import { GameRecorder, type SideIndex } from './recorder.ts';
import { createGameState, createTripContext, resolveTrip } from './possession.ts';
import { buildFacts } from './facts.ts';

/**
 * Game orchestration (spec/03): four 12-minute regulation periods plus
 * repeating five-minute overtime periods until exactly one winner exists.
 * Each period resets the team-foul count used for the bonus.
 */

const REGULATION_PERIOD_SECONDS = 720;
const OVERTIME_PERIOD_SECONDS = 300;
const MAX_PERIODS = 12;

export function simulateGame(input: GameSimulationInput, context: EngineContext): GameResult {
  const rng = context.rngFactory(input.seed);
  const profile = input.profile;
  const teams: [SimulationTeam, SimulationTeam] = [input.home, input.away];
  const recorder = new GameRecorder();
  const state = createGameState();
  const tripContext = createTripContext(rng, recorder, state, profile, teams);

  // Neutral-site tip: the opening possession is a fair coin.
  let offense: SideIndex = rng.chance(0.5) ? 0 : 1;
  let secondsRemaining = REGULATION_PERIOD_SECONDS;
  state.periodIndex = 0;

  for (let period = 0; period < MAX_PERIODS; period += 1) {
    if (period > 0) {
      // Regulation periods all run; overtime only when the game is tied.
      if (period >= 4) {
        if (recorder.sides[0].points !== recorder.sides[1].points) break;
      }
      recorder.nextPeriod();
      secondsRemaining = period < 4 ? REGULATION_PERIOD_SECONDS : OVERTIME_PERIOD_SECONDS;
      state.periodIndex = period;
      state.periodFouls = [0, 0];
    }

    while (secondsRemaining > 0) {
      state.secondsRemaining = secondsRemaining;
      const result = resolveTrip(tripContext, offense);
      secondsRemaining = state.secondsRemaining;
      if (result.ended) offense = (1 - offense) as SideIndex;
      if (!result.ended && result.secondsElapsed === 0 && secondsRemaining > 0) {
        // Guard against a stalled clock (should not happen with valid inputs).
        break;
      }
    }
  }

  const overtimePeriods = Math.max(0, recorder.sides[0].periodPoints.length - 4);
  // No substitutions (sandbox v1): everyone plays all 48+OT minutes.
  recorder.assignMinutes(48 + overtimePeriods * 5);

  const homeScore = recorder.sides[0].points;
  const awayScore = recorder.sides[1].points;
  // A tie after the period cap is a pathological guard; the seeded draw decides.
  const winner: 'home' | 'away' =
    homeScore > awayScore
      ? 'home'
      : awayScore > homeScore
        ? 'away'
        : rng.chance(0.5)
          ? 'home'
          : 'away';

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
