import type { GameResult, PlayerBoxScore, TeamBoxScore } from '@hoop-rush/data-contracts';
import { auditSideAccounting } from './accounting-core.ts';

export function checkGameResult(result: GameResult): string[] {
  const failures: string[] = [];

  const checkSide = (side: 'home' | 'away'): void => {
    const team = result[side];
    const box = team.box;
    const players = team.players;
    const other = side === 'home' ? 'away' : 'home';

    if (players.length !== 5) {
      failures.push(`${side}: expected exactly five players, got ${String(players.length)}`);
      return;
    }
    const ids = new Set(players.map((p) => p.playerId));
    if (ids.size !== players.length) {
      failures.push(`${side}: duplicate player ids in lineup`);
    }
    if (players.some((p) => p.minutes !== 48 + result.overtimePeriods * 5)) {
      failures.push(
        `${side}: player minutes must equal 48 + 5*OT (${String(48 + result.overtimePeriods * 5)}) with no bench`,
      );
    }

    const accounting = auditSideAccounting(players, box, team.shotZones, (p) => p.playerId);
    if (accounting.playerPointsTotal !== box.points) {
      failures.push(
        `${side}: player points (${String(accounting.playerPointsTotal)}) != team points (${String(box.points)})`,
      );
    }
    if (!accounting.pointsIdentityOk) {
      failures.push(
        `${side}: points ${String(box.points)} != 2*2fg + 3*3fg + ft (${String(accounting.pointsIdentity)})`,
      );
    }
    if (accounting.makesExceed.includes('fieldGoal')) {
      failures.push(`${side}: field-goal makes exceed attempts`);
    }
    if (accounting.makesExceed.includes('three')) {
      failures.push(`${side}: three-point makes exceed attempts`);
    }
    if (accounting.makesExceed.includes('freeThrow')) {
      failures.push(`${side}: free-throw makes exceed attempts`);
    }
    if (accounting.assistsExceedMade) failures.push(`${side}: assists exceed made field goals`);
    if (!accounting.reboundBucketsOk) {
      failures.push(`${side}: rebound buckets do not sum to total`);
    }
    for (const row of accounting.reconciliations) {
      if (row.playerTotal !== row.teamValue) {
        failures.push(
          `${side}: player ${row.label} (${String(row.playerTotal)}) != team ${row.label} (${String(row.teamValue)})`,
        );
      }
    }

    if (box.diagnostics) {
      const d = box.diagnostics;
      const misses =
        box.fieldGoals.attempted -
        box.fieldGoals.made +
        box.freeThrows.attempted -
        box.freeThrows.made;
      if (!accounting.reboundOpportunitiesOk) {
        failures.push(
          `${side}: rebound opportunities (${String(d.reboundOpportunities)}) != misses (${String(misses)})`,
        );
      }
      if (!accounting.assistedUnassistedOk) {
        failures.push(
          `${side}: assisted (${String(d.assistedFieldGoals)}) + unassisted (${String(d.unassistedFieldGoals)}) != made field goals (${String(box.fieldGoals.made)})`,
        );
      }
      if (!accounting.contestedShotsOk) {
        failures.push(`${side}: player contested shots != team contested shots`);
      }

      if (!accounting.offensiveReboundChancesOk) {
        failures.push(
          `${side}: player offensive-rebound chances != 5 * team rebound opportunities`,
        );
      }
      const otherDiagnostics = result[other].box.diagnostics;
      if (
        otherDiagnostics &&
        players.reduce(
          (acc, p) => acc + (p.diagnostics ? p.diagnostics.defensiveReboundChances : 0),
          0,
        ) !==
          otherDiagnostics.reboundOpportunities * 5
      ) {
        failures.push(
          `${side}: player defensive-rebound chances != 5 * opponent rebound opportunities`,
        );
      }
    }

    for (const zone of accounting.zoneSplits) {
      if (zone.playerAttempts !== zone.teamAttempts) {
        failures.push(
          `${side}: player zone attempts (${zone.zone}) ${String(zone.playerAttempts)} != team ${String(zone.teamAttempts)}`,
        );
      }
      if (zone.playerMakes !== zone.teamMakes) {
        failures.push(
          `${side}: player zone makes (${zone.zone}) ${String(zone.playerMakes)} != team ${String(zone.teamMakes)}`,
        );
      }
    }
    const violationCount = Math.max(
      accounting.usageViolations.length,
      accounting.assistOpportunityViolations.length,
    );
    for (let i = 0; i < violationCount; i += 1) {
      const usage = accounting.usageViolations[i];
      if (usage !== undefined) {
        failures.push(
          `${side}: usage ${usage.usage.toFixed(2)} != fga + 0.44*fta + tov (${usage.identity.toFixed(2)})`,
        );
      }
      const assist = accounting.assistOpportunityViolations[i];
      if (assist !== undefined) {
        failures.push(
          `${side}: assist opportunities (${String(assist.assistOpportunities)}) < assists (${String(assist.assists)})`,
        );
      }
    }

    const otherBox = result[other].box;
    const rebounds = box.rebounds;
    const misses =
      box.fieldGoals.attempted -
      box.fieldGoals.made +
      (box.freeThrows.attempted - box.freeThrows.made);
    const claimed = rebounds.offensive + otherBox.rebounds.defensive + otherBox.rebounds.team;
    if (misses !== claimed) {
      failures.push(
        `${side}: misses (${String(misses)}) != own OReb + opponent DREB/team (${String(claimed)})`,
      );
    }

    const opponentMisses =
      otherBox.fieldGoals.attempted -
      otherBox.fieldGoals.made +
      (otherBox.freeThrows.attempted - otherBox.freeThrows.made);
    const opponentRecoveries = otherBox.rebounds.offensive + rebounds.defensive + rebounds.team;
    if (opponentRecoveries !== opponentMisses) {
      failures.push(
        `${side}: opponent miss recoveries (${String(opponentRecoveries)}) != opponent misses (${String(opponentMisses)})`,
      );
    }
    if (box.possessions < box.fieldGoals.attempted - rebounds.offensive + box.turnovers) {
      failures.push(`${side}: possessions below minimal trip count`);
    }
  };

  checkSide('home');
  checkSide('away');

  const homeTotal = result.periodScores.home.reduce((a, b) => a + b, 0);
  const awayTotal = result.periodScores.away.reduce((a, b) => a + b, 0);
  if (homeTotal !== result.home.box.points) {
    failures.push(
      `home period scores (${String(homeTotal)}) != home points (${String(result.home.box.points)})`,
    );
  }
  if (awayTotal !== result.away.box.points) {
    failures.push(
      `away period scores (${String(awayTotal)}) != away points (${String(result.away.box.points)})`,
    );
  }
  if (result.periodScores.home.length !== result.periodScores.away.length) {
    failures.push(`period score lengths differ`);
  }
  if (result.periodScores.home.length !== 4 + result.overtimePeriods) {
    failures.push(
      `period count (${String(result.periodScores.home.length)}) != 4 + OT (${String(result.overtimePeriods)})`,
    );
  }
  if (result.home.box.points === result.away.box.points) {
    failures.push('tied final score: exactly one winner required');
  }
  const winnerScore = result.winner === 'home' ? result.home.box.points : result.away.box.points;
  const loserScore = result.winner === 'home' ? result.away.box.points : result.home.box.points;
  if (winnerScore <= loserScore) {
    failures.push(`winner ${result.winner} did not outscore the loser`);
  }

  return failures;
}

export function gameResultDigest(result: GameResult): string {
  const { home, away, periodScores, winner, overtimePeriods, seed } = result;
  const digest = {
    seed,
    winner,
    overtimePeriods,
    homeScore: home.box.points,
    awayScore: away.box.points,
    periodScores,
    homeBox: boxDigest(home.box),
    awayBox: boxDigest(away.box),
    homePlayers: home.players.map(playerDigest),
    awayPlayers: away.players.map(playerDigest),
  };
  return JSON.stringify(digest);
}

function boxDigest(box: TeamBoxScore): string[] {
  return [
    `${String(box.fieldGoals.made)}/${String(box.fieldGoals.attempted)}`,
    `${String(box.threes.made)}/${String(box.threes.attempted)}`,
    `${String(box.freeThrows.made)}/${String(box.freeThrows.attempted)}`,
    `${String(box.rebounds.offensive)}+${String(box.rebounds.defensive)}+${String(box.rebounds.team)}`,
    String(box.assists),
    String(box.steals),
    String(box.blocks),
    String(box.turnovers),
    String(box.fouls),
    String(box.possessions),
  ];
}

function playerDigest(p: PlayerBoxScore): string[] {
  return [
    p.playerId,
    String(p.minutes),
    String(p.points),
    `${String(p.fieldGoals.made)}/${String(p.fieldGoals.attempted)}`,
    `${String(p.threes.made)}/${String(p.threes.attempted)}`,
    `${String(p.freeThrows.made)}/${String(p.freeThrows.attempted)}`,
    `${String(p.rebounds.offensive)}+${String(p.rebounds.defensive)}`,
    String(p.assists),
    String(p.steals),
    String(p.blocks),
    String(p.turnovers),
    String(p.fouls),
  ];
}
