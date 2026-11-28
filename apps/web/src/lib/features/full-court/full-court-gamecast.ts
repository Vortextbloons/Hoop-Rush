import type { FullCourtWatchedReplay } from '@hoop-rush/data-contracts';
import type {
  FullCourtGameHealthOutcome,
  FullCourtGameResult,
  FullCourtTapeEvent,
} from '@hoop-rush/engine';

export type FullCourtPlayedGameOutcome = Extract<FullCourtGameHealthOutcome, { kind: 'played' }>;

export interface FullCourtWatchedReplaySummary {
  readonly gameId: string;
  readonly gameSeed: string;
  readonly phase: FullCourtWatchedReplay['identity']['phase'];
  readonly gameLabel: string;
  readonly matchupLabel: string;
  readonly scoreLabel: string;
  readonly replayNote: string;
}

/**
 * Rehydrates a stored watched replay into the Gamecast view payload without
 * rolling any possessions or invoking simulation workers. Saved replays start
 * from tipoff (cursor 0) so playback never writes per-frame checkpoints.
 */
export function fullCourtWatchedReplayOutcome(
  replay: FullCourtWatchedReplay,
): FullCourtPlayedGameOutcome {
  return {
    kind: 'played',
    result: replay.result,
    tape: replay.tape,
    health: replay.health,
    injuries: replay.injuries,
  };
}

export function fullCourtWatchedReplaySummary(
  replay: FullCourtWatchedReplay,
): FullCourtWatchedReplaySummary {
  const { identity, result, facts } = replay;
  const gameLabel =
    identity.phase === 'regular' && identity.slot !== null
      ? `Game ${String(identity.slot)}`
      : `Playoffs · Game ${String(identity.gameNumber)}`;
  const matchupLabel = `${result.away.displayName} @ ${result.home.displayName}`;
  const scoreLabel = `${String(result.away.box.points)}–${String(result.home.box.points)}`;
  const outcomeTag = facts.userWon ? 'W' : 'L';
  return {
    gameId: identity.gameId,
    gameSeed: identity.gameSeed,
    phase: identity.phase,
    gameLabel,
    matchupLabel,
    scoreLabel,
    replayNote: `${gameLabel} · ${matchupLabel} (${outcomeTag} ${scoreLabel}) · Starts from tipoff`,
  };
}

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
