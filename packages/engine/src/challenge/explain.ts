import type {
  ChallengeRun,
  MadeAttempted,
  ShotZone,
  ShotZoneSummary,
} from '@hoop-rush/data-contracts';
import { usageOf } from '../sim/recorder.ts';

export const EXPLAIN_THRESHOLDS = {
  minimumZoneAttempts: 60,

  minimumZoneEdge: 0.02,

  usageShare: 0.28,

  opponentOffensiveReboundRate: 0.3,
} as const;

export interface OpponentSeasonTotals {
  gamesPlayed: number;
  points: number;
  fieldGoals: MadeAttempted;
  threes: MadeAttempted;
  freeThrows: MadeAttempted;
  rebounds: { offensive: number; defensive: number };
  turnovers: number;
  possessions: number;
  shotZones: ShotZoneSummary[];
  contestedShots: number;
  reboundOpportunities: number;
}

export function opponentSeasonTotals(run: ChallengeRun): OpponentSeasonTotals {
  const zoneTotals = new Map<ShotZone, { attempts: number; makes: number }>();
  const totals: OpponentSeasonTotals = {
    gamesPlayed: 0,
    points: 0,
    fieldGoals: { made: 0, attempted: 0 },
    threes: { made: 0, attempted: 0 },
    freeThrows: { made: 0, attempted: 0 },
    rebounds: { offensive: 0, defensive: 0 },
    turnovers: 0,
    possessions: 0,
    shotZones: [],
    contestedShots: 0,
    reboundOpportunities: 0,
  };
  for (const game of run.games) {
    const away = game.away;
    const box = away.box;
    totals.gamesPlayed += 1;
    totals.points += box.points;
    totals.fieldGoals.made += box.fieldGoals.made;
    totals.fieldGoals.attempted += box.fieldGoals.attempted;
    totals.threes.made += box.threes.made;
    totals.threes.attempted += box.threes.attempted;
    totals.freeThrows.made += box.freeThrows.made;
    totals.freeThrows.attempted += box.freeThrows.attempted;
    totals.rebounds.offensive += box.rebounds.offensive;
    totals.rebounds.defensive += box.rebounds.defensive;
    totals.turnovers += box.turnovers;
    totals.possessions += box.possessions;
    if (box.diagnostics) {
      totals.contestedShots += box.diagnostics.contestedShots;
      totals.reboundOpportunities += box.diagnostics.reboundOpportunities;
    }
    for (const zone of away.shotZones) {
      const acc = zoneTotals.get(zone.zone) ?? { attempts: 0, makes: 0 };
      acc.attempts += zone.attempts;
      acc.makes += zone.makes;
      zoneTotals.set(zone.zone, acc);
    }
  }
  totals.shotZones = [...zoneTotals.entries()].map(([zone, acc]) => ({
    zone,
    attempts: acc.attempts,
    makes: acc.makes,
  }));
  return totals;
}

export interface ZoneComparison {
  zone: ShotZone;
  attempts: number;
  makes: number;

  pct: number;
  opponentAttempts: number;
  opponentMakes: number;
  opponentPct: number;

  edge: number;
}

export interface UsageLeader {
  playerId: string;
  playerUsage: number;
  teamUsage: number;
  usageShare: number;
}

export interface SeasonExplanation {
  turnoverBattleWins: number;

  turnoverBattleLosses: number;

  netRatingPer100: number;

  zoneAdvantage: ZoneComparison | null;

  opponentOffensiveReboundRate: number;

  defensiveReboundPct: number;

  usageLeader: UsageLeader | null;
}

function pct(made: number, attempted: number): number {
  return attempted <= 0 ? 0 : made / attempted;
}

export function explainSeason(run: ChallengeRun): SeasonExplanation {
  const team = run.aggregates.team;
  const opponents = opponentSeasonTotals(run);
  const t = EXPLAIN_THRESHOLDS;

  let turnoverBattleWins = 0;
  let turnoverBattleLosses = 0;
  for (const game of run.games) {
    if (game.home.box.turnovers < game.away.box.turnovers) turnoverBattleWins += 1;
    if (game.away.box.turnovers < game.home.box.turnovers) turnoverBattleLosses += 1;
  }

  const userPossessions = Math.max(1, team.possessions);
  const netRatingPer100 = ((team.points - opponents.points) / userPossessions) * 100;

  const userZoneTotals = new Map<ShotZone, { attempts: number; makes: number }>();
  for (const game of run.games) {
    for (const zone of game.home.shotZones) {
      const acc = userZoneTotals.get(zone.zone) ?? { attempts: 0, makes: 0 };
      acc.attempts += zone.attempts;
      acc.makes += zone.makes;
      userZoneTotals.set(zone.zone, acc);
    }
  }
  let zoneAdvantage: ZoneComparison | null = null;
  for (const zone of opponents.shotZones) {
    const user = userZoneTotals.get(zone.zone) ?? { attempts: 0, makes: 0 };
    if (user.attempts < t.minimumZoneAttempts || zone.attempts < t.minimumZoneAttempts) continue;
    const userPct = pct(user.makes, user.attempts);
    const oppPct = pct(zone.makes, zone.attempts);
    const edge = userPct - oppPct;
    if (edge < t.minimumZoneEdge) continue;
    if (zoneAdvantage === null || edge > zoneAdvantage.edge) {
      zoneAdvantage = {
        zone: zone.zone,
        attempts: user.attempts,
        makes: user.makes,
        pct: userPct,
        opponentAttempts: zone.attempts,
        opponentMakes: zone.makes,
        opponentPct: oppPct,
        edge,
      };
    }
  }

  const opponentMisses = Math.max(
    1,
    opponents.fieldGoals.attempted -
      opponents.fieldGoals.made +
      opponents.freeThrows.attempted -
      opponents.freeThrows.made,
  );
  const opponentOffensiveReboundRate = opponents.rebounds.offensive / opponentMisses;
  const defensiveReboundPct = pct(
    team.rebounds.defensive,
    team.rebounds.defensive + opponents.rebounds.offensive,
  );

  let usageLeader: UsageLeader | null = null;
  const teamUsage = usageOf(team.fieldGoals.attempted, team.freeThrows.attempted, team.turnovers);
  if (teamUsage > 0) {
    let leader: { playerId: string; usage: number } | null = null;
    for (const player of run.aggregates.players) {
      const usage = usageOf(
        player.fieldGoals.attempted,
        player.freeThrows.attempted,
        player.turnovers,
      );
      if (leader === null || usage > leader.usage) {
        leader = { playerId: player.playerId, usage };
      }
    }
    if (leader && leader.usage / teamUsage >= t.usageShare) {
      usageLeader = {
        playerId: leader.playerId,
        playerUsage: leader.usage,
        teamUsage,
        usageShare: leader.usage / teamUsage,
      };
    }
  }

  return {
    turnoverBattleWins,
    turnoverBattleLosses,
    netRatingPer100,
    zoneAdvantage,
    opponentOffensiveReboundRate,
    defensiveReboundPct,
    usageLeader,
  };
}
