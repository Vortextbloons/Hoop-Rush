import { GAME_TAPE_STAT_FIELDS, type GameTapeTrip } from '@hoop-rush/data-contracts';
import type { GamecastParticipantId, GamecastRecordedGame } from './gamecast-types';

export interface GamecastFeedLine {
  key: string;
  period: number;
  clockSeconds: number;
  offense: GamecastParticipantId;
  summary: string;
  points: number;
}

type TapeStatField = (typeof GAME_TAPE_STAT_FIELDS)[number];

function fieldIndex(field: TapeStatField): number {
  return GAME_TAPE_STAT_FIELDS.indexOf(field);
}

export const TAPE_STAT_INDEXES = {
  points: fieldIndex('points'),
  fieldGoalMakes: fieldIndex('fieldGoalMakes'),
  fieldGoalAttempts: fieldIndex('fieldGoalAttempts'),
  threeMakes: fieldIndex('threeMakes'),
  threeAttempts: fieldIndex('threeAttempts'),
  freeThrowMakes: fieldIndex('freeThrowMakes'),
  freeThrowAttempts: fieldIndex('freeThrowAttempts'),
  offensiveRebounds: fieldIndex('offensiveRebounds'),
  defensiveRebounds: fieldIndex('defensiveRebounds'),
  assists: fieldIndex('assists'),
  turnovers: fieldIndex('turnovers'),
  teamRebounds: fieldIndex('teamRebounds'),
} as const;

const {
  points: POINTS,
  offensiveRebounds: OFFENSIVE_REBOUNDS,
  defensiveRebounds: DEFENSIVE_REBOUNDS,
  turnovers: TURNOVERS,
  teamRebounds: TEAM_REBOUNDS,
} = TAPE_STAT_INDEXES;

function pointsText(points: number): string {
  return `${String(points)} pt${points === 1 ? '' : 's'}`;
}

function hasReboundDelta(line: readonly number[]): boolean {
  return (
    (line[OFFENSIVE_REBOUNDS] ?? 0) + (line[DEFENSIVE_REBOUNDS] ?? 0) + (line[TEAM_REBOUNDS] ?? 0) >
    0
  );
}

function soleScorerId(output: GamecastRecordedGame, trip: GameTapeTrip): string | null {
  let found: { side: 0 | 1; slot: number } | null = null;
  for (const side of [0, 1] as const) {
    const deltas = side === 0 ? trip.homeDeltas : trip.awayDeltas;
    for (let slot = 0; slot < deltas.length; slot += 1) {
      if ((deltas[slot]?.[POINTS] ?? 0) <= 0) continue;
      if (found !== null) return null;
      found = { side, slot };
    }
  }
  if (found === null) return null;
  const team = found.side === 0 ? output.result.home : output.result.away;
  return team.players[found.slot]?.playerId ?? null;
}

function summarizeTrip(output: GamecastRecordedGame, trip: GameTapeTrip): string {
  const offenseTeam = trip.offense === 0 ? trip.homeTeamDeltas : trip.awayTeamDeltas;
  const defenseTeam = trip.offense === 0 ? trip.awayTeamDeltas : trip.homeTeamDeltas;
  const points = offenseTeam[POINTS] ?? 0;
  const parts: string[] = [];
  if (points > 0) {
    const scorer = soleScorerId(output, trip);
    parts.push(scorer === null ? pointsText(points) : `${scorer} ${pointsText(points)}`);
  } else {
    parts.push('No score');
  }
  if ((offenseTeam[TURNOVERS] ?? 0) > 0 || (defenseTeam[TURNOVERS] ?? 0) > 0) {
    parts.push('Turnover');
  }
  if (hasReboundDelta(offenseTeam) || hasReboundDelta(defenseTeam)) {
    parts.push('Rebound');
  }
  return parts.join(' · ');
}

export function gamecastPeriodLabel(period: number): string {
  if (period <= 4) return `Q${String(period)}`;
  return `OT${String(period - 4)}`;
}

export function gamecastTeamOf(
  output: Pick<GamecastRecordedGame, 'homeParticipantId'>,
  participantId: GamecastParticipantId,
): 'home' | 'away' {
  return output.homeParticipantId === participantId ? 'home' : 'away';
}

export function gamecastFeedLines(
  output: GamecastRecordedGame,
  visibleCount: number,
): GamecastFeedLine[] {
  const count = Number.isNaN(visibleCount)
    ? 0
    : Math.max(0, Math.min(output.tape.length, Math.trunc(visibleCount)));
  const lines: GamecastFeedLine[] = [];
  for (let index = 0; index < count; index += 1) {
    const event = output.tape[index];
    if (event === undefined || event.kind !== 'trip') continue;
    const offenseTeam = event.offense === 0 ? event.homeTeamDeltas : event.awayTeamDeltas;
    lines.push({
      key: `trip-${String(event.index)}`,
      period: event.period,
      clockSeconds: event.clockSeconds,
      offense: event.offense === 0 ? output.homeParticipantId : output.awayParticipantId,
      summary: summarizeTrip(output, event),
      points: offenseTeam[POINTS] ?? 0,
    });
  }
  return lines;
}
