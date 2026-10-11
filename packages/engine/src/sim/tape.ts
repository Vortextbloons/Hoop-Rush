import type {
  DraftDuelTapeEvent,
  DraftDuelTapeStatLine,
  DraftDuelTapeTrip,
  GameResult,
  GameSimulationInput,
} from '@hoop-rush/data-contracts';
import { simulateGame, type GameObservers } from './game.ts';
import type { EngineContext } from './kernel.ts';

const LINE_LENGTH = 15;
function zeroLine(): DraftDuelTapeStatLine {
  return [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
}
function emptyLines(): DraftDuelTapeStatLine[] {
  return Array.from({ length: 5 }, () => zeroLine());
}
function lineDelta(current: readonly number[], previous: readonly number[]): DraftDuelTapeStatLine {
  const delta = new Array<number>(LINE_LENGTH);
  for (let index = 0; index < LINE_LENGTH; index += 1) {
    delta[index] = (current[index] ?? 0) - (previous[index] ?? 0);
  }
  return delta as unknown as DraftDuelTapeStatLine;
}
export interface RecordedGameOutput {
  result: GameResult;
  tape: DraftDuelTapeEvent[];
}
export function simulateRecordedGame(
  input: GameSimulationInput,
  context: EngineContext,
): RecordedGameOutput {
  const tape: DraftDuelTapeEvent[] = [];
  let previousHome = emptyLines();
  let previousAway = emptyLines();
  let previousHomeTeam = zeroLine();
  let previousAwayTeam = zeroLine();
  let index = 0;
  const observers: GameObservers = {
    onTrip: (observation) => {
      const homeDeltas = observation.homeLines.map((line, slot) =>
        lineDelta(line, previousHome[slot] ?? []),
      );
      const awayDeltas = observation.awayLines.map((line, slot) =>
        lineDelta(line, previousAway[slot] ?? []),
      );
      const trip: DraftDuelTapeTrip = {
        kind: 'trip',
        index,
        period: observation.period,
        clockSeconds: observation.clockSeconds,
        offense: observation.offense,
        ended: observation.ended,
        secondsElapsed: observation.secondsElapsed,
        homeScore: observation.homeScore,
        awayScore: observation.awayScore,
        homeDeltas,
        awayDeltas,
        homeTeamDeltas: lineDelta(observation.homeTeamLine, previousHomeTeam),
        awayTeamDeltas: lineDelta(observation.awayTeamLine, previousAwayTeam),
      };
      tape.push(trip);
      index += 1;
      previousHome = observation.homeLines.map((line) => [...line] as DraftDuelTapeStatLine);
      previousAway = observation.awayLines.map((line) => [...line] as DraftDuelTapeStatLine);
      previousHomeTeam = [...observation.homeTeamLine] as DraftDuelTapeStatLine;
      previousAwayTeam = [...observation.awayTeamLine] as DraftDuelTapeStatLine;
    },
    onPeriod: (observation) => {
      tape.push({
        kind: 'period',
        index,
        period: observation.period,
        homeScore: observation.homeScore,
        awayScore: observation.awayScore,
      });
      index += 1;
    },
  };
  const result = simulateGame(input, context, observers);
  return { result, tape };
}
