import type { GameResult, PlayerBoxScore, TeamBoxScore } from '@hoop-rush/data-contracts';

/**
 * Pure invariant checker (spec/06 exact invariants). Used by tests, the CLI,
 * and replay to validate scoring identities, player/team reconciliation,
 * possessions, rebounds, minutes, five-player uniqueness, determinism, and a
 * single winner. Returns a list of violated invariants; empty means valid.
 */

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

    // Points identity: 2*(fgm - 3pm) + 3*3pm + ftm.
    const sumOf = (select: (p: PlayerBoxScore) => number): number =>
      players.reduce((acc, p) => acc + select(p), 0);
    const teamPoints = sumOf((p) => p.points);
    if (teamPoints !== box.points) {
      failures.push(
        `${side}: player points (${String(teamPoints)}) != team points (${String(box.points)})`,
      );
    }
    const fgm = box.fieldGoals.made;
    const fga = box.fieldGoals.attempted;
    const tpm = box.threes.made;
    const tpa = box.threes.attempted;
    const ftm = box.freeThrows.made;
    const fta = box.freeThrows.attempted;
    if (box.points !== (fgm - tpm) * 2 + tpm * 3 + ftm) {
      failures.push(
        `${side}: points ${String(box.points)} != 2*2fg + 3*3fg + ft (${String((fgm - tpm) * 2 + tpm * 3 + ftm)})`,
      );
    }
    if (fgm > fga) failures.push(`${side}: field-goal makes exceed attempts`);
    if (tpm > tpa) failures.push(`${side}: three-point makes exceed attempts`);
    if (ftm > fta) failures.push(`${side}: free-throw makes exceed attempts`);
    if (box.assists > fgm) failures.push(`${side}: assists exceed made field goals`);
    if (
      box.rebounds.offensive + box.rebounds.defensive + box.rebounds.team !==
      box.rebounds.total
    ) {
      failures.push(`${side}: rebound buckets do not sum to total`);
    }

    // Player totals reconcile with team totals.
    const reconcile = (
      label: string,
      select: (p: PlayerBoxScore) => number,
      teamValue: number,
    ): void => {
      const p = sumOf(select);
      if (p !== teamValue) {
        failures.push(
          `${side}: player ${label} (${String(p)}) != team ${label} (${String(teamValue)})`,
        );
      }
    };
    reconcile('fieldGoalMakes', (p) => p.fieldGoals.made, fgm);
    reconcile('fieldGoalAttempts', (p) => p.fieldGoals.attempted, fga);
    reconcile('threeMakes', (p) => p.threes.made, tpm);
    reconcile('threeAttempts', (p) => p.threes.attempted, tpa);
    reconcile('freeThrowMakes', (p) => p.freeThrows.made, ftm);
    reconcile('freeThrowAttempts', (p) => p.freeThrows.attempted, fta);
    reconcile('assists', (p) => p.assists, box.assists);
    reconcile('steals', (p) => p.steals, box.steals);
    reconcile('blocks', (p) => p.blocks, box.blocks);
    reconcile('turnovers', (p) => p.turnovers, box.turnovers);
    reconcile('fouls', (p) => p.fouls, box.fouls);
    reconcile('offensiveRebounds', (p) => p.rebounds.offensive, box.rebounds.offensive);
    reconcile('defensiveRebounds', (p) => p.rebounds.defensive, box.rebounds.defensive);

    // Opportunity-level diagnostics (present on m3 engine results): usage
    // identity, zone reconciliation, rebound chances, and assist accounting.
    if (box.diagnostics || players.some((p) => p.diagnostics)) {
      const playerDiag = (select: (d: NonNullable<PlayerBoxScore['diagnostics']>) => number) =>
        players.reduce((acc, p) => acc + (p.diagnostics ? select(p.diagnostics) : 0), 0);
      if (box.diagnostics) {
        const d = box.diagnostics;
        const misses =
          box.fieldGoals.attempted -
          box.fieldGoals.made +
          box.freeThrows.attempted -
          box.freeThrows.made;
        if (d.reboundOpportunities !== misses) {
          failures.push(
            `${side}: rebound opportunities (${String(d.reboundOpportunities)}) != misses (${String(misses)})`,
          );
        }
        if (d.assistedFieldGoals + d.unassistedFieldGoals !== box.fieldGoals.made) {
          failures.push(
            `${side}: assisted (${String(d.assistedFieldGoals)}) + unassisted (${String(d.unassistedFieldGoals)}) != made field goals (${String(box.fieldGoals.made)})`,
          );
        }
        if (playerDiag((p) => p.contestedShots) !== d.contestedShots) {
          failures.push(`${side}: player contested shots != team contested shots`);
        }
        // Every miss gives all five players on the floor a rebound chance.
        if (playerDiag((p) => p.offensiveReboundChances) !== d.reboundOpportunities * 5) {
          failures.push(
            `${side}: player offensive-rebound chances != 5 * team rebound opportunities`,
          );
        }
        const otherDiagnostics = result[other].box.diagnostics;
        if (
          otherDiagnostics &&
          playerDiag((p) => p.defensiveReboundChances) !== otherDiagnostics.reboundOpportunities * 5
        ) {
          failures.push(
            `${side}: player defensive-rebound chances != 5 * opponent rebound opportunities`,
          );
        }
      }
      // Per-player zone splits reconcile with the team zone summary.
      for (const zone of team.shotZones) {
        const attempts = playerDiag(
          (p) => p.shotZones.find((z) => z.zone === zone.zone)?.attempts ?? 0,
        );
        const makes = playerDiag((p) => p.shotZones.find((z) => z.zone === zone.zone)?.makes ?? 0);
        if (attempts !== zone.attempts) {
          failures.push(
            `${side}: player zone attempts (${zone.zone}) ${String(attempts)} != team ${String(zone.attempts)}`,
          );
        }
        if (makes !== zone.makes) {
          failures.push(
            `${side}: player zone makes (${zone.zone}) ${String(makes)} != team ${String(zone.makes)}`,
          );
        }
      }
      for (const p of players) {
        if (!p.diagnostics) continue;
        const d = p.diagnostics;
        const usageIdentity = p.fieldGoals.attempted + p.freeThrows.attempted * 0.44 + p.turnovers;
        if (Math.abs(d.usage - usageIdentity) > 0.6) {
          failures.push(
            `${side}: usage ${d.usage.toFixed(2)} != fga + 0.44*fta + tov (${usageIdentity.toFixed(2)})`,
          );
        }
        if (d.assistOpportunities < p.assists) {
          failures.push(
            `${side}: assist opportunities (${String(d.assistOpportunities)}) < assists (${String(p.assists)})`,
          );
        }
      }
    }

    // Every miss resolves to exactly one rebound bucket on the two sides:
    // the shooter's offensive rebounds plus the defense's player/team rebounds.
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

    // Possession reconciliation: every ended trip counted once.
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

  // Period scores reconcile with totals and winner.
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

/** Compact box-score digest for replay comparison and golden fixtures. */
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
