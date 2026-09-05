import type { ExplanationFact, GameResult, TeamResult } from '@hoop-rush/data-contracts';
import { usageOf } from './recorder.ts';
export const FACT_THRESHOLDS = {
  turnoverMargin: 2,
  shotEfficiencyEfgDiff: 0.02,
  offensiveReboundDiff: 3,
  freeThrowAttemptDiff: 4,
  usageShare: 0.28,
} as const;
function efg(team: TeamResult): number {
  const fg = team.box.fieldGoals;
  const three = team.box.threes;
  return (fg.made + 0.5 * three.made) / Math.max(1, fg.attempted);
}
export function buildFacts(result: GameResult): ExplanationFact[] {
  const facts: ExplanationFact[] = [];
  const winner = result[result.winner];
  const loser = result[result.winner === 'home' ? 'away' : 'home'];
  const t = FACT_THRESHOLDS;
  const turnoverDiff = loser.box.turnovers - winner.box.turnovers;
  if (turnoverDiff >= t.turnoverMargin) {
    facts.push({
      kind: 'turnoverMargin',
      teamId: winner.teamId,
      magnitude: turnoverDiff,
      evidence: {
        teamTurnovers: winner.box.turnovers,
        opponentTurnovers: loser.box.turnovers,
        margin: turnoverDiff,
      },
      playerIds: [],
    });
  }
  const winnerEfg = efg(winner);
  const loserEfg = efg(loser);
  const efgDiff = winnerEfg - loserEfg;
  if (efgDiff >= t.shotEfficiencyEfgDiff) {
    facts.push({
      kind: 'shotEfficiency',
      teamId: winner.teamId,
      magnitude: efgDiff * 100,
      evidence: {
        efgPct: winnerEfg,
        opponentEfgPct: loserEfg,
        efgDiff,
        madeFieldGoals: winner.box.fieldGoals.made,
        attemptedFieldGoals: winner.box.fieldGoals.attempted,
      },
      playerIds: [],
    });
  }
  const orebDiff = winner.box.rebounds.offensive - loser.box.rebounds.offensive;
  if (orebDiff >= t.offensiveReboundDiff) {
    facts.push({
      kind: 'offensiveRebounds',
      teamId: winner.teamId,
      magnitude: orebDiff,
      evidence: {
        teamOffensiveRebounds: winner.box.rebounds.offensive,
        opponentOffensiveRebounds: loser.box.rebounds.offensive,
        margin: orebDiff,
      },
      playerIds: [],
    });
  }
  const ftaDiff = winner.box.freeThrows.attempted - loser.box.freeThrows.attempted;
  if (ftaDiff >= t.freeThrowAttemptDiff) {
    facts.push({
      kind: 'freeThrows',
      teamId: winner.teamId,
      magnitude: ftaDiff,
      evidence: {
        teamFreeThrowAttempts: winner.box.freeThrows.attempted,
        teamFreeThrowMakes: winner.box.freeThrows.made,
        opponentFreeThrowAttempts: loser.box.freeThrows.attempted,
        margin: ftaDiff,
      },
      playerIds: [],
    });
  }
  function playerUsage(player: TeamResult['players'][number]): number {
    if (player.diagnostics) return player.diagnostics.usage;
    return usageOf(player.fieldGoals.attempted, player.freeThrows.attempted, player.turnovers);
  }
  const topUsage = [...winner.players].sort((a, b) => playerUsage(b) - playerUsage(a))[0];
  const teamUsage = winner.players.reduce((sum, player) => sum + playerUsage(player), 0);
  if (topUsage && teamUsage > 0) {
    const share = playerUsage(topUsage) / teamUsage;
    if (share >= t.usageShare) {
      facts.push({
        kind: 'usage',
        teamId: winner.teamId,
        magnitude: share,
        evidence: {
          playerUsage: playerUsage(topUsage),
          teamUsage,
          usageShare: share,
          playerFieldGoalAttempts: topUsage.fieldGoals.attempted,
          playerMinutes: topUsage.minutes,
        },
        playerIds: [topUsage.playerId],
      });
    }
  }
  if (result.overtimePeriods > 0) {
    const homeOtPoints = result.periodScores.home.slice(4).reduce((a, b) => a + b, 0);
    const awayOtPoints = result.periodScores.away.slice(4).reduce((a, b) => a + b, 0);
    const margin = Math.abs(homeOtPoints - awayOtPoints);
    facts.push({
      kind: 'overtime',
      teamId: winner.teamId,
      magnitude: result.overtimePeriods,
      evidence: {
        periods: result.overtimePeriods,
        homeOvertimePoints: homeOtPoints,
        awayOvertimePoints: awayOtPoints,
        overtimeMargin: margin,
        finalMargin: Math.abs(result.home.box.points - result.away.box.points),
      },
      playerIds: [],
    });
  }
  return facts;
}
