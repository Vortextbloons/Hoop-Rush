import type { ChallengeRun, LeaguePlayerTotals, TeamResult } from '@hoop-rush/data-contracts';
import { franchiseIdSchema, playerIdSchema } from '@hoop-rush/data-contracts';
import { accumulateLeagueAppearance, emptyLeaguePlayerTotals } from './league-value.ts';

const CONSISTENCY_PENALTY = 0.08;
export { gameScore, mvpValue, shotsUsed, trueShooting } from './league-value.ts';

export interface LeagueMvp {
  playerId: string;
  playerName: string;
  teamId: string;
  teamName: string;
  isUserTeam: boolean;
  appearances: number;
  mvpScore: number;
  averageGameScore: number;
  averageEfficiency: number;
  consistency: number;
  averagePoints: number;
  averageRebounds: number;
  averageAssists: number;
  averageSteals: number;
  averageBlocks: number;
}

interface RankedMvp extends LeagueMvp {
  averageCombined: number;
}

function totalsKey(teamId: string, playerId: string): string {
  return `${teamId}:${playerId}`;
}

export function leagueMvp(run: ChallengeRun): LeagueMvp | null {
  const totals = new Map<string, LeaguePlayerTotals>();
  if (run.league) {
    for (const entry of run.league.players) {
      totals.set(totalsKey(entry.teamId, entry.playerId), entry);
    }
  }
  const foldSide = (side: TeamResult, won: boolean): void => {
    for (const box of side.players) {
      const key = totalsKey(side.teamId, box.playerId);
      let entry = totals.get(key);
      if (!entry) {
        entry = emptyLeaguePlayerTotals(side.teamId, box.playerId);
        totals.set(key, entry);
      }
      accumulateLeagueAppearance(entry, box, won);
    }
  };
  for (const game of run.games) {
    foldSide(game.home, game.winner === 'home');
    foldSide(game.away, game.winner === 'away');
  }
  if (totals.size === 0) return null;
  let leaguePoints = 0;
  let leagueShots = 0;
  for (const entry of totals.values()) {
    leaguePoints += entry.totalPoints;
    leagueShots += entry.totalShots;
  }
  const baselineTs = leagueShots > 0 ? leaguePoints / (2 * leagueShots) : 0.5;
  const playerNameFor = buildPlayerNameLookup(run);
  const ranked: RankedMvp[] = [];
  for (const entry of totals.values()) {
    const appearances = entry.games;
    if (appearances <= 0) continue;
    const meanValue = (entry.totalValueBase - baselineTs * entry.totalShots) / appearances;
    const variance = Math.max(
      0,
      (entry.totalValueBaseSquared -
        2 * baselineTs * entry.totalValueShots +
        baselineTs * baselineTs * entry.totalShotsSquared) /
        appearances -
        meanValue * meanValue,
    );
    const standardDeviation = Math.sqrt(variance);
    const isUserTeam = entry.teamId === 'user';
    ranked.push({
      playerId: entry.playerId,
      playerName: playerNameFor(entry.teamId, entry.playerId),
      teamId: entry.teamId,
      teamName: teamNameFor(run, entry.teamId),
      isUserTeam,
      appearances,
      mvpScore: meanValue - CONSISTENCY_PENALTY * standardDeviation,
      averageGameScore: entry.totalGameScore / appearances,
      averageEfficiency: entry.totalTrueShooting / appearances,
      consistency: standardDeviation,
      averagePoints: entry.totalPoints / appearances,
      averageRebounds: entry.totalRebounds / appearances,
      averageAssists: entry.totalAssists / appearances,
      averageSteals: entry.totalSteals / appearances,
      averageBlocks: entry.totalBlocks / appearances,
      averageCombined:
        (entry.totalRebounds + entry.totalAssists + entry.totalSteals + entry.totalBlocks) /
        appearances,
    });
  }
  ranked.sort(compareRanked);
  return ranked[0] ?? null;
}

function teamNameFor(run: ChallengeRun, teamId: string): string {
  if (teamId === 'user') return run.homeDisplayName;
  const opponent = run.bracket.opponents.find((entry) => entry.teamId === teamId);
  return opponent?.displayName ?? teamId;
}

function buildPlayerNameLookup(run: ChallengeRun): (teamId: string, playerId: string) => string {
  const userNames = new Map(run.players.map((p) => [p.playerId, p.displayName]));
  const opponentsByTeamId = new Map(run.bracket.opponents.map((o) => [o.teamId, o]));
  const perTeamCache = new Map<string, Map<string, string>>();
  return (teamId, playerId) => {
    if (teamId === 'user') {
      return userNames.get(playerIdSchema.parse(playerId)) ?? playerId;
    }
    let names = perTeamCache.get(teamId);
    if (!names) {
      names = new Map<string, string>();
      const opponent = opponentsByTeamId.get(franchiseIdSchema.parse(teamId));
      if (opponent) {
        for (const p of opponent.players) names.set(p.playerId, p.displayName);
      }
      perTeamCache.set(teamId, names);
    }
    return names.get(playerId) ?? playerId;
  };
}

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
