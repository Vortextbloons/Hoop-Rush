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
      failures.push(`${side}: expected exactly five players, got ${players.length}`);
      return;
    }
    const ids = new Set(players.map((p) => p.playerId));
    if (ids.size !== players.length) {
      failures.push(`${side}: duplicate player ids in lineup`);
    }
    if (players.some((p) => p.minutes !== 48 + result.overtimePeriods * 5)) {
      failures.push(
        `${side}: player minutes must equal 48 + 5*OT (${48 + result.overtimePeriods * 5}) with no bench`,
      );
    }

    // Points identity: 2*(fgm - 3pm) + 3*3pm + ftm.
    const sumOf = (select: (p: PlayerBoxScore) => number): number =>
      players.reduce((acc, p) => acc + select(p), 0);
    const teamPoints = sumOf((p) => p.points);
    if (teamPoints !== box.points) {
      failures.push(`${side}: player points (${teamPoints}) != team points (${box.points})`);
    }
    const fgm = box.fieldGoals.made;
    const fga = box.fieldGoals.attempted;
    const tpm = box.threes.made;
    const tpa = box.threes.attempted;
    const ftm = box.freeThrows.made;
    const fta = box.freeThrows.attempted;
    if (box.points !== (fgm - tpm) * 2 + tpm * 3 + ftm) {
      failures.push(
        `${side}: points ${box.points} != 2*2fg + 3*3fg + ft (${(fgm - tpm) * 2 + tpm * 3 + ftm})`,
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
        failures.push(`${side}: player ${label} (${p}) != team ${label} (${teamValue})`);
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
      failures.push(`${side}: misses (${misses}) != own OReb + opponent DREB/team (${claimed})`);
    }

    // Possession reconciliation: every ended trip counted once.
    const opponentMisses =
      otherBox.fieldGoals.attempted -
      otherBox.fieldGoals.made +
      (otherBox.freeThrows.attempted - otherBox.freeThrows.made);
    const opponentRecoveries = otherBox.rebounds.offensive + rebounds.defensive + rebounds.team;
    if (opponentRecoveries !== opponentMisses) {
      failures.push(
        `${side}: opponent miss recoveries (${opponentRecoveries}) != opponent misses (${opponentMisses})`,
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
    failures.push(`home period scores (${homeTotal}) != home points (${result.home.box.points})`);
  }
  if (awayTotal !== result.away.box.points) {
    failures.push(`away period scores (${awayTotal}) != away points (${result.away.box.points})`);
  }
  if (result.periodScores.home.length !== result.periodScores.away.length) {
    failures.push(`period score lengths differ`);
  }
  if (result.periodScores.home.length !== 4 + result.overtimePeriods) {
    failures.push(
      `period count (${result.periodScores.home.length}) != 4 + OT (${result.overtimePeriods})`,
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

/** Whether a game result satisfies every exact invariant. */
export function isGameResultValid(result: GameResult): boolean {
  return checkGameResult(result).length === 0;
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
    `${box.fieldGoals.made}/${box.fieldGoals.attempted}`,
    `${box.threes.made}/${box.threes.attempted}`,
    `${box.freeThrows.made}/${box.freeThrows.attempted}`,
    `${box.rebounds.offensive}+${box.rebounds.defensive}+${box.rebounds.team}`,
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
    `${p.fieldGoals.made}/${p.fieldGoals.attempted}`,
    `${p.threes.made}/${p.threes.attempted}`,
    `${p.freeThrows.made}/${p.freeThrows.attempted}`,
    `${p.rebounds.offensive}+${p.rebounds.defensive}`,
    String(p.assists),
    String(p.steals),
    String(p.blocks),
    String(p.turnovers),
    String(p.fouls),
  ];
}
