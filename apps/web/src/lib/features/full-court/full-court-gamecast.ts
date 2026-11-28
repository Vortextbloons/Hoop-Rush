import { FULL_COURT_TAPE_STAT_FIELDS, type FullCourtTapeEvent } from '@hoop-rush/data-contracts';
import type { FullCourtGameHealthOutcome, FullCourtGameResult } from '@hoop-rush/engine';

export type FullCourtPlayedGameOutcome = Extract<FullCourtGameHealthOutcome, { kind: 'played' }>;

export type FullCourtGamecastSubstitution = Extract<FullCourtTapeEvent, { kind: 'substitution' }>;

export interface FullCourtRotationSummary {
  readonly substitutions: readonly FullCourtGamecastSubstitution[];
  readonly reasonSummary: string;
  readonly firstSubstitution: FullCourtGamecastSubstitution | null;
  readonly foulTrouble: readonly FullCourtGameResult['home']['players'][number][];
  readonly playersUsed: number;
  readonly starterMinutes: number;
  readonly benchMinutes: number;
  readonly disqualifications: number;
}

export function fullCourtSubstitutionReasonLabel(
  reason: FullCourtGamecastSubstitution['reason'],
): string {
  switch (reason) {
    case 'foul-out':
      return 'foul out';
    case 'fatigue':
      return 'fatigue';
    case 'minute-target':
      return 'minute target';
    case 'closing-five':
      return 'closing five';
    case 'coach-rule':
      return 'coach rule';
    case 'emergency-continuation':
      return 'emergency';
  }
}

/** Actual rotation facts already recorded in the result and tape. */
export function fullCourtRotationSummary(
  team: FullCourtGameResult['home'],
  side: 0 | 1,
  tape: readonly FullCourtTapeEvent[] | null,
): FullCourtRotationSummary {
  const substitutions = (tape ?? []).filter(
    (event): event is FullCourtGamecastSubstitution =>
      event.kind === 'substitution' && event.side === side,
  );
  const counts = new Map<string, number>();
  for (const event of substitutions) {
    const label = fullCourtSubstitutionReasonLabel(event.reason);
    counts.set(label, (counts.get(label) ?? 0) + 1);
  }
  return {
    substitutions,
    reasonSummary: [...counts].map(([label, count]) => `${String(count)} ${label}`).join(' · '),
    firstSubstitution: substitutions[0] ?? null,
    foulTrouble: team.players.filter((player) => player.fouls >= 4 || player.foulsOut),
    playersUsed: team.players.filter((player) => player.minutes > 0).length,
    starterMinutes: team.players
      .filter((player) => player.startedGame)
      .reduce((total, player) => total + player.minutes, 0),
    benchMinutes: team.players
      .filter((player) => !player.startedGame)
      .reduce((total, player) => total + player.minutes, 0),
    disqualifications: team.disqualifications,
  };
}

export interface FullCourtGamecastLineupEvidence {
  readonly players: readonly { readonly displayName: string }[];
  readonly sampleMet: boolean;
  readonly netRatingPer100: number | null;
  readonly pacePossessions: number;
}

/** Highest net rating among lineups that cleared the recorded sample floor. */
export function fullCourtBestLineup<Row extends FullCourtGamecastLineupEvidence>(
  rows: readonly Row[],
): Row | null {
  return (
    [...rows]
      .filter((row) => row.sampleMet && row.netRatingPer100 !== null)
      .sort((left, right) => (right.netRatingPer100 ?? 0) - (left.netRatingPer100 ?? 0))[0] ?? null
  );
}

export interface FullCourtGamecastFrame {
  readonly period: number;
  readonly clockSeconds: number;
  readonly homeScore: number;
  readonly awayScore: number;
  readonly homeUnit: readonly string[];
  readonly awayUnit: readonly string[];
  readonly side: 0 | 1 | null;
  readonly kind: FullCourtTapeEvent['kind'] | null;
  readonly possession: number;
  readonly caption: string | null;
}

function pointsLabel(points: number): string {
  return `${String(points)} ${points === 1 ? 'point' : 'points'}`;
}

function scoreEventCaption(
  homeName: string,
  awayName: string,
  homeDelta: number,
  awayDelta: number,
): string | null {
  const parts: string[] = [];
  if (homeDelta > 0) parts.push(`${homeName} scores ${pointsLabel(homeDelta)}`);
  else if (homeDelta < 0) parts.push(`${homeName} loses ${pointsLabel(-homeDelta)}`);
  if (awayDelta > 0) parts.push(`${awayName} scores ${pointsLabel(awayDelta)}`);
  else if (awayDelta < 0) parts.push(`${awayName} loses ${pointsLabel(-awayDelta)}`);
  return parts.length > 0 ? parts.join(' · ') : null;
}

/**
 * One frame per tape event, so frame `index + 1` always describes tape event
 * `index`. Playback and the live-box fold share that index space.
 */
export function fullCourtGamecastFrames(
  result: FullCourtGameResult,
  tape: readonly FullCourtTapeEvent[],
): readonly FullCourtGamecastFrame[] {
  const homeNames = new Map<string, string>(
    result.home.players.map((player) => [player.playerId, player.displayName]),
  );
  const awayNames = new Map<string, string>(
    result.away.players.map((player) => [player.playerId, player.displayName]),
  );
  const frames: FullCourtGamecastFrame[] = [];
  let frame: FullCourtGamecastFrame = {
    period: 0,
    clockSeconds: 12 * 60,
    homeScore: 0,
    awayScore: 0,
    homeUnit: result.home.stints[0]?.playerIds ?? [],
    awayUnit: result.away.stints[0]?.playerIds ?? [],
    side: null,
    kind: null,
    possession: 0,
    caption: null,
  };
  frames.push(frame);
  for (const event of tape) {
    if (event.kind === 'period') {
      frame = {
        ...frame,
        period: event.period,
        homeScore: event.homeScore,
        awayScore: event.awayScore,
        clockSeconds: (event.period < 4 ? 12 : 5) * 60,
        side: null,
        kind: event.kind,
        caption: null,
      };
    } else if (event.kind === 'trip') {
      const homeDelta = event.homeScore - frame.homeScore;
      const awayDelta = event.awayScore - frame.awayScore;
      frame = {
        period: event.period,
        clockSeconds: event.clockSeconds,
        homeScore: event.homeScore,
        awayScore: event.awayScore,
        homeUnit: event.homeUnit,
        awayUnit: event.awayUnit,
        side: event.offense,
        kind: event.kind,
        possession: frame.possession + Number(event.ended),
        caption:
          scoreEventCaption(
            result.home.displayName,
            result.away.displayName,
            homeDelta,
            awayDelta,
          ) ??
          {
            defensiveRebound: 'Defensive rebound',
            offensiveRebound: 'Offensive rebound',
            liveTurnover: 'Live-ball turnover',
            deadBall: 'Dead ball',
            madeBasket: 'Made basket',
            neutral: 'No score',
          }[event.nextPossessionStart],
      };
    } else if (event.kind === 'substitution') {
      const key = event.side === 0 ? 'homeUnit' : 'awayUnit';
      const names = event.side === 0 ? homeNames : awayNames;
      const incoming = names.get(event.inPlayerId) ?? 'Reserve';
      const outgoing = names.get(event.outPlayerId) ?? 'Player';
      frame = {
        ...frame,
        period: event.period,
        clockSeconds: event.clockSeconds,
        [key]: frame[key].map((player) =>
          player === event.outPlayerId ? event.inPlayerId : player,
        ),
        side: event.side,
        kind: event.kind,
        caption: `${incoming} replaces ${outgoing} · ${event.reason.replaceAll('-', ' ')}`,
      };
    } else {
      const key = event.side === 0 ? 'homeScore' : 'awayScore';
      frame = {
        ...frame,
        period: event.period,
        clockSeconds: event.clockSeconds,
        [key]: frame[key] + Number(event.made),
        homeUnit: event.homeUnit ?? frame.homeUnit,
        awayUnit: event.awayUnit ?? frame.awayUnit,
        side: event.side,
        kind: event.kind,
        caption: event.made ? 'Technical free throw made' : 'Technical free throw missed',
      };
    }
    frames.push(frame);
  }
  return frames;
}

export function fullCourtPossessionCursor(
  frames: readonly FullCourtGamecastFrame[],
  cursor: number,
  direction: -1 | 1,
): number {
  const possession = frames[cursor]?.possession ?? 0;
  for (let index = cursor + direction; index > 0 && index < frames.length; index += direction) {
    const frame = frames[index];
    if (
      frame?.kind === 'trip' &&
      frame.possession !== frames[index - 1]?.possession &&
      (direction === 1 ? frame.possession > possession : frame.possession < possession)
    ) {
      return index;
    }
  }
  return direction === 1 ? Math.max(0, frames.length - 1) : 0;
}

/** One player's live line during the broadcast. */
export interface FullCourtLiveLine {
  readonly playerId: string;
  readonly displayName: string;
  readonly startedGame: boolean;
  points: number;
  fieldGoalsMade: number;
  fieldGoalsAttempted: number;
  threeMade: number;
  threeAttempted: number;
  freeThrowsMade: number;
  freeThrowsAttempted: number;
  rebounds: number;
  assists: number;
  steals: number;
  blocks: number;
  turnovers: number;
  fouls: number;
}

export interface FullCourtLiveBox {
  readonly home: readonly FullCourtLiveLine[];
  readonly away: readonly FullCourtLiveLine[];
}

function fieldIndex(field: (typeof FULL_COURT_TAPE_STAT_FIELDS)[number]): number {
  return FULL_COURT_TAPE_STAT_FIELDS.indexOf(field);
}
const POINTS = fieldIndex('points');
const FG_MADE = fieldIndex('fieldGoalMakes');
const FG_ATTEMPTED = fieldIndex('fieldGoalAttempts');
const THREE_MADE = fieldIndex('threeMakes');
const THREE_ATTEMPTED = fieldIndex('threeAttempts');
const FT_MADE = fieldIndex('freeThrowMakes');
const FT_ATTEMPTED = fieldIndex('freeThrowAttempts');
const OFF_REBOUNDS = fieldIndex('offensiveRebounds');
const DEF_REBOUNDS = fieldIndex('defensiveRebounds');
const ASSISTS = fieldIndex('assists');
const STEALS = fieldIndex('steals');
const BLOCKS = fieldIndex('blocks');
const TURNOVERS = fieldIndex('turnovers');
const FOULS = fieldIndex('fouls');

export interface FullCourtLiveBoxFold {
  linesAt(cursor: number): FullCourtLiveBox;
}

/**
 * Folds the recorded possession deltas into live player lines. A backward seek
 * rebuilds from tipoff, so the result is identical however the cursor arrived.
 */
export function fullCourtLiveBoxFold(game: FullCourtPlayedGameOutcome): FullCourtLiveBoxFold {
  const tape = game.tape ?? [];
  const finalBox = (): FullCourtLiveBox => ({
    home: game.result.home.players.map((player) => ({
      playerId: player.playerId,
      displayName: player.displayName,
      startedGame: player.startedGame,
      points: player.points,
      fieldGoalsMade: player.fieldGoals.made,
      fieldGoalsAttempted: player.fieldGoals.attempted,
      threeMade: player.threes.made,
      threeAttempted: player.threes.attempted,
      freeThrowsMade: player.freeThrows.made,
      freeThrowsAttempted: player.freeThrows.attempted,
      rebounds: player.rebounds.total,
      assists: player.assists,
      steals: player.steals,
      blocks: player.blocks,
      turnovers: player.turnovers,
      fouls: player.fouls,
    })),
    away: game.result.away.players.map((player) => ({
      playerId: player.playerId,
      displayName: player.displayName,
      startedGame: player.startedGame,
      points: player.points,
      fieldGoalsMade: player.fieldGoals.made,
      fieldGoalsAttempted: player.fieldGoals.attempted,
      threeMade: player.threes.made,
      threeAttempted: player.threes.attempted,
      freeThrowsMade: player.freeThrows.made,
      freeThrowsAttempted: player.freeThrows.attempted,
      rebounds: player.rebounds.total,
      assists: player.assists,
      steals: player.steals,
      blocks: player.blocks,
      turnovers: player.turnovers,
      fouls: player.fouls,
    })),
  });
  const blank = (side: 'home' | 'away'): FullCourtLiveLine[] =>
    game.result[side].players.map((player) => ({
      playerId: player.playerId,
      displayName: player.displayName,
      startedGame: player.startedGame,
      points: 0,
      fieldGoalsMade: 0,
      fieldGoalsAttempted: 0,
      threeMade: 0,
      threeAttempted: 0,
      freeThrowsMade: 0,
      freeThrowsAttempted: 0,
      rebounds: 0,
      assists: 0,
      steals: 0,
      blocks: 0,
      turnovers: 0,
      fouls: 0,
    }));
  let home = blank('home');
  let away = blank('away');
  const byId = {
    home: new Map(home.map((line) => [line.playerId, line])),
    away: new Map(away.map((line) => [line.playerId, line])),
  };
  let folded = 0;
  let published: FullCourtLiveBox = { home, away };

  function reset(): void {
    home = blank('home');
    away = blank('away');
    byId.home = new Map(home.map((line) => [line.playerId, line]));
    byId.away = new Map(away.map((line) => [line.playerId, line]));
    folded = 0;
  }

  function apply(event: FullCourtTapeEvent): void {
    if (event.kind !== 'trip' || event.deltas === undefined) return;
    for (const delta of event.deltas) {
      const line = byId.home.get(delta.playerId) ?? byId.away.get(delta.playerId);
      if (line === undefined) continue;
      line.points += delta.line[POINTS] ?? 0;
      line.fieldGoalsMade += delta.line[FG_MADE] ?? 0;
      line.fieldGoalsAttempted += delta.line[FG_ATTEMPTED] ?? 0;
      line.threeMade += delta.line[THREE_MADE] ?? 0;
      line.threeAttempted += delta.line[THREE_ATTEMPTED] ?? 0;
      line.freeThrowsMade += delta.line[FT_MADE] ?? 0;
      line.freeThrowsAttempted += delta.line[FT_ATTEMPTED] ?? 0;
      line.rebounds += (delta.line[OFF_REBOUNDS] ?? 0) + (delta.line[DEF_REBOUNDS] ?? 0);
      line.assists += delta.line[ASSISTS] ?? 0;
      line.steals += delta.line[STEALS] ?? 0;
      line.blocks += delta.line[BLOCKS] ?? 0;
      line.turnovers += delta.line[TURNOVERS] ?? 0;
      line.fouls += delta.line[FOULS] ?? 0;
    }
  }

  return {
    linesAt(cursor: number): FullCourtLiveBox {
      const count = Number.isNaN(cursor)
        ? 0
        : Math.max(0, Math.min(tape.length, Math.trunc(cursor)));
      // The final frame reads the audited result so late technical free throws
      // and point adjustments can never leave the recap short.
      if (count >= tape.length) return finalBox();
      if (count < folded) reset();
      for (let index = folded; index < count; index += 1) {
        const event = tape[index];
        if (event !== undefined) apply(event);
      }
      folded = count;
      published = { home: [...home], away: [...away] };
      return published;
    },
  };
}
