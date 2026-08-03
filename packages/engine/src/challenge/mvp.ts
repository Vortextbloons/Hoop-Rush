import type { ChallengeRun, PlayerBoxScore } from '@hoop-rush/data-contracts';

/**
 * League MVP aggregation across a challenge run (spec/01). Every home and
 * away player box score recorded in the run's games is one candidate,
 * keyed by (teamId, playerId), so a mirror matchup (same player on the user
 * side and an opponent side) keeps two separate candidates.
 */

/**
 * Game Score (Hollinger-style all-around rating) for one player appearance:
 * PTS + 0.4*FGM - 0.7*FGA - 0.4*(FTA-FTM) + 0.7*ORB + 0.3*DRB + STL + 0.7*AST + 0.7*BLK - 0.4*PF - TOV
 */
export function gameScore(box: PlayerBoxScore): number {
  return (
    box.points +
    0.4 * box.fieldGoals.made -
    0.7 * box.fieldGoals.attempted -
    0.4 * (box.freeThrows.attempted - box.freeThrows.made) +
    0.7 * box.rebounds.offensive +
    0.3 * box.rebounds.defensive +
    box.steals +
    0.7 * box.assists +
    0.7 * box.blocks -
    0.4 * box.fouls -
    box.turnovers
  );
}

export interface LeagueMvp {
  playerId: string;
  /** Display name resolved from run snapshots; falls back to playerId. */
  playerName: string;
  teamId: string;
  /** Home: the run's homeDisplayName. Away: the opponent display name from the game result. */
  teamName: string;
  /** True when the candidate is the user's five (teamId === 'user'). */
  isUserTeam: boolean;
  /** Number of appearances (games played by this side/player candidate). */
  appearances: number;
  /** Unrounded average Game Score per appearance. */
  averageGameScore: number;
  /** Unrounded per-game points. */
  averagePoints: number;
  averageRebounds: number;
  averageAssists: number;
  averageSteals: number;
  averageBlocks: number;
}

/** Candidate accumulation totals; all averaging happens at ranking time. */
interface Accumulator {
  scoreSum: number;
  pointsSum: number;
  reboundsSum: number;
  assistsSum: number;
  stealsSum: number;
  blocksSum: number;
  appearances: number;
}

/** Internal ranking shape: carries the unrounded combined tie-break value. */
interface RankedMvp extends LeagueMvp {
  averageCombined: number;
}

/**
 * The League MVP across the whole 82-game run. Every home and away player
 * appearance contributes one candidate keyed by (teamId, playerId), so a
 * mirror matchup (same player on the user side and an opponent) keeps two
 * separate candidates. Returns null for a run with no games.
 */
export function leagueMvp(run: ChallengeRun): LeagueMvp | null {
  const accumulators = new Map<string, Accumulator>();
  const teamNames = new Map<string, string>();

  for (const game of run.games) {
    for (const side of [game.home, game.away]) {
      teamNames.set(side.teamId, side.displayName);
      for (const box of side.players) {
        const key = `${side.teamId}:${box.playerId}`;
        const current = accumulators.get(key) ?? {
          scoreSum: 0,
          pointsSum: 0,
          reboundsSum: 0,
          assistsSum: 0,
          stealsSum: 0,
          blocksSum: 0,
          appearances: 0,
        };
        current.scoreSum += gameScore(box);
        current.pointsSum += box.points;
        current.reboundsSum += box.rebounds.total;
        current.assistsSum += box.assists;
        current.stealsSum += box.steals;
        current.blocksSum += box.blocks;
        current.appearances += 1;
        accumulators.set(key, current);
      }
    }
  }

  if (accumulators.size === 0) return null;

  const playerNameFor = buildPlayerNameLookup(run);
  const ranked: RankedMvp[] = [];
  for (const [key, acc] of accumulators) {
    const separator = key.indexOf(':');
    const teamId = key.slice(0, separator);
    const playerId = key.slice(separator + 1);
    const appearances = acc.appearances;
    ranked.push({
      playerId,
      playerName: playerNameFor(teamId, playerId),
      teamId,
      teamName: teamNames.get(teamId) ?? teamId,
      isUserTeam: teamId === 'user',
      appearances,
      averageGameScore: acc.scoreSum / appearances,
      averagePoints: acc.pointsSum / appearances,
      averageRebounds: acc.reboundsSum / appearances,
      averageAssists: acc.assistsSum / appearances,
      averageSteals: acc.stealsSum / appearances,
      averageBlocks: acc.blocksSum / appearances,
      averageCombined:
        (acc.reboundsSum + acc.assistsSum + acc.stealsSum + acc.blocksSum) / appearances,
    });
  }

  ranked.sort(compareRanked);
  return ranked[0] ?? null;
}

/**
 * playerId → displayName for the user five from run snapshots, and per-opponent
 * from the bracket by teamId (cached). Falls back to the playerId itself.
 */
function buildPlayerNameLookup(run: ChallengeRun): (teamId: string, playerId: string) => string {
  const userNames = new Map(run.players.map((p) => [p.playerId, p.displayName]));
  const opponentsByTeamId = new Map(run.bracket.opponents.map((o) => [o.teamId, o]));
  const perTeamCache = new Map<string, Map<string, string>>();
  return (teamId, playerId) => {
    if (teamId === 'user') {
      return userNames.get(playerId) ?? playerId;
    }
    let names = perTeamCache.get(teamId);
    if (!names) {
      names = new Map<string, string>();
      const opponent = opponentsByTeamId.get(teamId);
      if (opponent) {
        for (const p of opponent.players) names.set(p.playerId, p.displayName);
      }
      perTeamCache.set(teamId, names);
    }
    return names.get(playerId) ?? playerId;
  };
}

/** Unrounded average Game Score desc, then points, then combined, then identity. */
function compareRanked(a: RankedMvp, b: RankedMvp): number {
  if (b.averageGameScore !== a.averageGameScore) {
    return b.averageGameScore - a.averageGameScore;
  }
  if (b.averagePoints !== a.averagePoints) {
    return b.averagePoints - a.averagePoints;
  }
  if (b.averageCombined !== a.averageCombined) {
    return b.averageCombined - a.averageCombined;
  }
  const teamOrder = a.teamId.localeCompare(b.teamId);
  if (teamOrder !== 0) return teamOrder;
  return a.playerId.localeCompare(b.playerId);
}
