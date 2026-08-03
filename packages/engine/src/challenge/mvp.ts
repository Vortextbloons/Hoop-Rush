import type { ChallengeRun, PlayerBoxScore } from '@hoop-rush/data-contracts';

/**
 * League MVP aggregation across a challenge run (spec/01). Every home and
 * away player box score recorded in the run's games is one candidate,
 * keyed by (teamId, playerId), so a mirror matchup (same player on the user
 * side and an opponent side) keeps two separate candidates.
 */

/** Defense-bonus weights applied per appearance (spec/01 League MVP). */
const DEFENSE_WEIGHTS = {
  steal: 0.6,
  block: 0.6,
  defensiveRebound: 0.15,
  contestedShot: 0.04,
} as const;

/** Playmaking-bonus weights applied per appearance (spec/01 League MVP). */
const PLAYMAKING_WEIGHTS = {
  assist: 0.5,
  assistOpportunity: 0.25,
} as const;

/** Small team-context bonus for a win; the mirrored penalty for a loss. */
const TEAM_BONUS = { win: 0.75, loss: -0.75 } as const;

/** Consistency penalty: standard-deviation multiplier on per-game values. */
const CONSISTENCY_PENALTY = 0.08;

/**
 * True shooting attempts for one appearance: FGA + 0.44×FTA.
 */
export function shotsUsed(box: PlayerBoxScore): number {
  return box.fieldGoals.attempted + 0.44 * box.freeThrows.attempted;
}

/**
 * True shooting percentage for one appearance; 0 when the player did not shoot.
 */
export function trueShooting(box: PlayerBoxScore): number {
  const shots = shotsUsed(box);
  return shots <= 0 ? 0 : box.points / (2 * shots);
}

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

/**
 * Holistic per-appearance MVP value (spec/01 League MVP): Game Score plus an
 * efficiency bonus (points above or below league-average true shooting on the
 * same shot volume), a defense bonus, a playmaking bonus, and a small
 * team-context bonus for wins. `baselineTs` is the run-wide weighted-average
 * true shooting; `won` is whether the candidate's side won the game.
 */
export function mvpValue(box: PlayerBoxScore, baselineTs: number, won: boolean): number {
  const diagnostics = box.diagnostics;
  return (
    gameScore(box) +
    (trueShooting(box) - baselineTs) * shotsUsed(box) +
    DEFENSE_WEIGHTS.steal * box.steals +
    DEFENSE_WEIGHTS.block * box.blocks +
    DEFENSE_WEIGHTS.defensiveRebound * box.rebounds.defensive +
    (diagnostics ? DEFENSE_WEIGHTS.contestedShot * diagnostics.contestedShots : 0) +
    PLAYMAKING_WEIGHTS.assist * box.assists +
    (diagnostics ? PLAYMAKING_WEIGHTS.assistOpportunity * diagnostics.assistOpportunities : 0) +
    (won ? TEAM_BONUS.win : TEAM_BONUS.loss)
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
  /** Final composite: average per-game MVP value minus the consistency penalty. */
  mvpScore: number;
  /** Unrounded average Game Score per appearance. */
  averageGameScore: number;
  /** Average true shooting percentage per appearance. */
  averageEfficiency: number;
  /** Standard deviation of per-game MVP values (consistency). */
  consistency: number;
  /** Unrounded per-game points. */
  averagePoints: number;
  averageRebounds: number;
  averageAssists: number;
  averageSteals: number;
  averageBlocks: number;
}

/**
 * Candidate accumulation; per-appearance values are kept so variance
 * (consistency) is computed at ranking time.
 */
interface Accumulator {
  scoreSum: number;
  pointsSum: number;
  reboundsSum: number;
  assistsSum: number;
  stealsSum: number;
  blocksSum: number;
  efficiencySum: number;
  appearances: Array<{ valueBase: number; shots: number }>;
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

  let leaguePoints = 0;
  let leagueShots = 0;

  for (const game of run.games) {
    for (const [index, side] of [game.home, game.away].entries()) {
      const won = game.winner === (index === 0 ? 'home' : 'away');
      teamNames.set(side.teamId, side.displayName);
      for (const box of side.players) {
        const key = `${side.teamId}:${box.playerId}`;
        let current = accumulators.get(key);
        if (!current) {
          current = {
            scoreSum: 0,
            pointsSum: 0,
            reboundsSum: 0,
            assistsSum: 0,
            stealsSum: 0,
            blocksSum: 0,
            efficiencySum: 0,
            appearances: [],
          };
          accumulators.set(key, current);
        }
        const shots = shotsUsed(box);
        current.scoreSum += gameScore(box);
        current.pointsSum += box.points;
        current.reboundsSum += box.rebounds.total;
        current.assistsSum += box.assists;
        current.stealsSum += box.steals;
        current.blocksSum += box.blocks;
        current.efficiencySum += trueShooting(box);
        current.appearances.push({ valueBase: mvpValue(box, 0, won), shots });
        // Only appearances that took shots define the league efficiency
        // baseline; a scoreless-shots line contributes no shot volume.
        if (shots > 0) {
          leaguePoints += box.points;
          leagueShots += shots;
        }
      }
    }
  }

  if (accumulators.size === 0) return null;

  const baselineTs = leagueShots > 0 ? leaguePoints / (2 * leagueShots) : 0.5;

  const playerNameFor = buildPlayerNameLookup(run);
  const ranked: RankedMvp[] = [];
  for (const [key, acc] of accumulators) {
    const separator = key.indexOf(':');
    const teamId = key.slice(0, separator);
    const playerId = key.slice(separator + 1);
    const appearances = acc.appearances.length;
    const values = acc.appearances.map((a) => a.valueBase - baselineTs * a.shots);
    const meanValue = values.reduce((sum, value) => sum + value, 0) / appearances;
    const standardDeviation = populationStdDev(values, meanValue);
    ranked.push({
      playerId,
      playerName: playerNameFor(teamId, playerId),
      teamId,
      teamName: teamNames.get(teamId) ?? teamId,
      isUserTeam: teamId === 'user',
      appearances,
      mvpScore: meanValue - CONSISTENCY_PENALTY * standardDeviation,
      averageGameScore: acc.scoreSum / appearances,
      averageEfficiency: acc.efficiencySum / appearances,
      consistency: standardDeviation,
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

/** Population standard deviation of per-game values; 0 for fewer than 2 games. */
function populationStdDev(values: readonly number[], mean: number): number {
  if (values.length < 2) return 0;
  let sumOfSquares = 0;
  for (const value of values) {
    const deviation = value - mean;
    sumOfSquares += deviation * deviation;
  }
  return Math.sqrt(sumOfSquares / values.length);
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

/** Ranking: MVP score desc, then Game Score, points, combined, then identity. */
function compareRanked(a: RankedMvp, b: RankedMvp): number {
  if (b.mvpScore !== a.mvpScore) {
    return b.mvpScore - a.mvpScore;
  }
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
