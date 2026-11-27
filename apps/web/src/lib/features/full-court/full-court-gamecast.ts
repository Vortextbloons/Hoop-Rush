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

export interface FullCourtGamecastFrame {
  readonly period: number;
  readonly clockSeconds: number;
  readonly homeScore: number;
  readonly awayScore: number;
  readonly homeUnit: readonly string[];
  readonly awayUnit: readonly string[];
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
        caption: scoreEventCaption(
          result.home.displayName,
          result.away.displayName,
          homeDelta,
          awayDelta,
        ),
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
        caption: event.made ? 'Technical free throw made' : 'Technical free throw missed',
      };
    }
    frames.push(frame);
  }
  return frames;
}
