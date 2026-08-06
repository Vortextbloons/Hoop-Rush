import {
  SEASON_GAME_SUMMARY_VERSION,
  type SeasonCompactPlayerLine,
  type SeasonEffectsRollup,
  type SeasonGameEffectsTransition,
  type SeasonGameSimulationResult,
  type SeasonGameSummary,
  type SeasonMechanismEvidence,
  type SeasonRetainedGameDetail,
  type SeasonScheduleGame,
  type SeasonTeamBox,
} from '@hoop-rush/data-contracts';

/**
 * Compact summary conversion (spec/2.0/02 retention policy, M2.3,
 * season-game-summary-v1). Every league game reduces to one compact summary
 * carrying the identity, result state, complete team boxes, and 20 compact
 * player lines; richer facts are retained only for human-team games through
 * `seasonRetainedDetailFromResult`. Player lines are canonically sorted by
 * playerVersionId so serialization is stable for digests.
 *
 * A forfeited game's official result is 2-0 with zero boxes and empty player
 * arrays; the forfeit loser is named. The `no-legal-five-both` outcome is a
 * typed invariant failure with no legal summary representation; the block
 * pipeline throws instead of fabricating a winner.
 *
 * Pure TypeScript: no Svelte, persistence, worker, or network code.
 */

/** One compact player line from a full result player line. */
function compactLineOf(player: {
  playerVersionId: string;
  seconds: number;
  points: number;
  fieldGoals: { made: number; attempted: number };
  threes: { made: number; attempted: number };
  freeThrows: { made: number; attempted: number };
  rebounds: { offensive: number; defensive: number };
  assists: number;
  steals: number;
  blocks: number;
  turnovers: number;
  fouls: number;
}): SeasonCompactPlayerLine {
  return {
    playerVersionId: player.playerVersionId,
    seconds: player.seconds,
    points: player.points,
    fieldGoalsMade: player.fieldGoals.made,
    fieldGoalsAttempted: player.fieldGoals.attempted,
    threePointersMade: player.threes.made,
    threePointersAttempted: player.threes.attempted,
    freeThrowsMade: player.freeThrows.made,
    freeThrowsAttempted: player.freeThrows.attempted,
    offensiveRebounds: player.rebounds.offensive,
    defensiveRebounds: player.rebounds.defensive,
    assists: player.assists,
    steals: player.steals,
    blocks: player.blocks,
    turnovers: player.turnovers,
    fouls: player.fouls,
  };
}

/** Complete team box from a result side box. */
function teamBoxOf(side: {
  franchiseId: string;
  box: {
    points: number;
    fieldGoals: { made: number; attempted: number };
    threes: { made: number; attempted: number };
    freeThrows: { made: number; attempted: number };
    rebounds: { offensive: number; defensive: number };
    assists: number;
    steals: number;
    blocks: number;
    turnovers: number;
    fouls: number;
    possessions: number;
  };
}): SeasonTeamBox {
  const box = side.box;
  return {
    franchiseId: side.franchiseId,
    points: box.points,
    fieldGoalsMade: box.fieldGoals.made,
    fieldGoalsAttempted: box.fieldGoals.attempted,
    threePointersMade: box.threes.made,
    threePointersAttempted: box.threes.attempted,
    freeThrowsMade: box.freeThrows.made,
    freeThrowsAttempted: box.freeThrows.attempted,
    offensiveRebounds: box.rebounds.offensive,
    defensiveRebounds: box.rebounds.defensive,
    assists: box.assists,
    steals: box.steals,
    blocks: box.blocks,
    turnovers: box.turnovers,
    fouls: box.fouls,
    possessions: box.possessions,
  };
}

function sortedLines(lines: readonly SeasonCompactPlayerLine[]): SeasonCompactPlayerLine[] {
  return [...lines].sort((a, b) =>
    a.playerVersionId < b.playerVersionId ? -1 : a.playerVersionId > b.playerVersionId ? 1 : 0,
  );
}

/** Zero team box used on forfeits (official 2-0 result, no statistics). */
function zeroTeamBox(franchiseId: string): SeasonTeamBox {
  return {
    franchiseId,
    points: 0,
    fieldGoalsMade: 0,
    fieldGoalsAttempted: 0,
    threePointersMade: 0,
    threePointersAttempted: 0,
    freeThrowsMade: 0,
    freeThrowsAttempted: 0,
    offensiveRebounds: 0,
    defensiveRebounds: 0,
    assists: 0,
    steals: 0,
    blocks: 0,
    turnovers: 0,
    fouls: 0,
    possessions: 0,
  };
}

/**
 * Converts one simulation result plus its schedule game into a compact
 * summary. The schedule game is the source of identity (gameId, round,
 * home/away franchise); the result's side boxes carry the franchise ids and
 * statistics. A forfeit becomes the official 2-0 with zero boxes and empty
 * player arrays. `no-legal-five-both` throws: it has no legal summary
 * representation and must never be fabricated into a winner.
 */
export function seasonGameSummaryFromResult(
  result: SeasonGameSimulationResult,
  game: SeasonScheduleGame,
  effectsTransition?: SeasonGameEffectsTransition,
): SeasonGameSummary {
  if (result.outcome === 'no-legal-five-both') {
    throw new Error(
      `season summary: game ${game.gameId} has no legal five on either side ` +
        `(no-legal-five-both); the block pipeline must treat this as an invariant failure`,
    );
  }
  if (result.outcome === 'forfeit') {
    return {
      schemaVersion: 1,
      summaryVersion: SEASON_GAME_SUMMARY_VERSION,
      gameId: game.gameId,
      round: game.round,
      homeFranchiseId: game.homeFranchiseId,
      awayFranchiseId: game.awayFranchiseId,
      status: 'forfeit',
      overtimePeriods: 0,
      homeScore: result.homeScore,
      awayScore: result.awayScore,
      forfeitLoserFranchiseId: result.losingFranchiseId,
      homeBox: zeroTeamBox(game.homeFranchiseId),
      awayBox: zeroTeamBox(game.awayFranchiseId),
      homePlayers: [],
      awayPlayers: [],
    };
  }
  return {
    schemaVersion: 1,
    summaryVersion: SEASON_GAME_SUMMARY_VERSION,
    gameId: game.gameId,
    round: game.round,
    homeFranchiseId: game.homeFranchiseId,
    awayFranchiseId: game.awayFranchiseId,
    status: 'final',
    overtimePeriods: result.overtimePeriods,
    homeScore: result.home.score,
    awayScore: result.away.score,
    forfeitLoserFranchiseId: null,
    homeBox: teamBoxOf(result.home),
    awayBox: teamBoxOf(result.away),
    homePlayers: sortedLines(result.home.players.map((player) => compactLineOf(player))),
    awayPlayers: sortedLines(result.away.players.map((player) => compactLineOf(player))),
    ...(effectsTransition !== undefined && effectsTransition.evidence.length > 0
      ? { effectsRollup: seasonEffectsRollupFromEvidence(effectsTransition.evidence) }
      : {}),
  };
}

/**
 * Wraps the full simulation result as a retained detail row (human-team
 * games only). Reuses the complete M2.2 result contract, so substitutions,
 * unit stints, deviations, foul-outs, removals, shot-zone facts, and
 * diagnostics are preserved exactly where the product explains them.
 */
export function seasonRetainedDetailFromResult(
  result: SeasonGameSimulationResult,
  game: SeasonScheduleGame,
  runId: string,
  effectsTransition?: SeasonGameEffectsTransition,
): SeasonRetainedGameDetail {
  return {
    schemaVersion: 1,
    runId,
    gameId: game.gameId,
    round: game.round,
    homeFranchiseId: game.homeFranchiseId,
    awayFranchiseId: game.awayFranchiseId,
    result,
    ...(effectsTransition !== undefined && effectsTransition.evidence.length > 0
      ? { mechanismEvidence: effectsTransition.evidence }
      : {}),
  };
}

/**
 * Compact per-game effects rollup for game summaries: mechanism, side,
 * opportunity count, and the accumulated probability delta in integer
 * millionths (season-game-summary-v2 retention policy).
 */
export function seasonEffectsRollupFromEvidence(
  evidence: readonly SeasonMechanismEvidence[],
): SeasonEffectsRollup[] {
  return evidence.map((row) => ({
    mechanism: row.mechanism,
    side: row.side,
    opportunities: row.opportunities,
    deltaTotal: row.deltaTotals,
  }));
}

/** The full mechanism evidence of a game's effects transition. */
export function seasonEffectsEvidenceOf(
  transition: SeasonGameEffectsTransition,
): SeasonMechanismEvidence[] {
  return transition.evidence;
}

/**
 * Audits one compact summary: for final games the team boxes equal the sum
 * of the player lines and the scores are consistent with the boxes; for
 * forfeits every non-zero field is flagged. Returns failure strings; empty
 * means valid.
 */
export function auditSeasonGameSummary(summary: SeasonGameSummary): string[] {
  const failures: string[] = [];
  const sides = ['home', 'away'] as const;
  for (const side of sides) {
    const box = side === 'home' ? summary.homeBox : summary.awayBox;
    const lines = side === 'home' ? summary.homePlayers : summary.awayPlayers;
    if (box.franchiseId !== summary[`${side}FranchiseId`]) {
      failures.push(`${side} box franchise ${box.franchiseId} does not match the game identity`);
    }
    if (summary.status === 'forfeit') {
      const expectedZero: Array<[string, number]> = [
        ['points', box.points],
        ['fieldGoalsMade', box.fieldGoalsMade],
        ['fieldGoalsAttempted', box.fieldGoalsAttempted],
        ['threePointersMade', box.threePointersMade],
        ['threePointersAttempted', box.threePointersAttempted],
        ['freeThrowsMade', box.freeThrowsMade],
        ['freeThrowsAttempted', box.freeThrowsAttempted],
        ['offensiveRebounds', box.offensiveRebounds],
        ['defensiveRebounds', box.defensiveRebounds],
        ['assists', box.assists],
        ['steals', box.steals],
        ['blocks', box.blocks],
        ['turnovers', box.turnovers],
        ['fouls', box.fouls],
        ['possessions', box.possessions],
      ];
      for (const [label, value] of expectedZero) {
        if (value !== 0)
          failures.push(`forfeit ${side} box ${label} must be zero (got ${String(value)})`);
      }
      if (lines.length !== 0) {
        failures.push(`forfeit ${side} must carry no player lines (got ${String(lines.length)})`);
      }
      continue;
    }
    if (summary[`${side}Score`] !== box.points) {
      failures.push(
        `${side} score ${String(summary[`${side}Score`])} != box points ${String(box.points)}`,
      );
    }
    if (lines.length !== 10) {
      failures.push(`final ${side} must carry 10 player lines (got ${String(lines.length)})`);
      continue;
    }
    if (new Set(lines.map((line) => line.playerVersionId)).size !== 10) {
      failures.push(`${side} player lines must be distinct`);
    }
    const sumOf = (select: (line: SeasonCompactPlayerLine) => number): number =>
      lines.reduce((acc, line) => acc + select(line), 0);
    const checks: Array<[string, number, number]> = [
      ['points', sumOf((l) => l.points), box.points],
      ['fieldGoalsMade', sumOf((l) => l.fieldGoalsMade), box.fieldGoalsMade],
      ['fieldGoalsAttempted', sumOf((l) => l.fieldGoalsAttempted), box.fieldGoalsAttempted],
      ['threePointersMade', sumOf((l) => l.threePointersMade), box.threePointersMade],
      [
        'threePointersAttempted',
        sumOf((l) => l.threePointersAttempted),
        box.threePointersAttempted,
      ],
      ['freeThrowsMade', sumOf((l) => l.freeThrowsMade), box.freeThrowsMade],
      ['freeThrowsAttempted', sumOf((l) => l.freeThrowsAttempted), box.freeThrowsAttempted],
      ['offensiveRebounds', sumOf((l) => l.offensiveRebounds), box.offensiveRebounds],
      ['defensiveRebounds', sumOf((l) => l.defensiveRebounds), box.defensiveRebounds],
      ['assists', sumOf((l) => l.assists), box.assists],
      ['steals', sumOf((l) => l.steals), box.steals],
      ['blocks', sumOf((l) => l.blocks), box.blocks],
      ['turnovers', sumOf((l) => l.turnovers), box.turnovers],
      ['fouls', sumOf((l) => l.fouls), box.fouls],
    ];
    for (const [label, playerTotal, boxTotal] of checks) {
      if (playerTotal !== boxTotal) {
        failures.push(
          `${side} player ${label} (${String(playerTotal)}) != box ${label} (${String(boxTotal)})`,
        );
      }
    }
    // Box-level identities: makes never exceed attempts; points reconcile.
    const fgm = box.fieldGoalsMade;
    const fga = box.fieldGoalsAttempted;
    const tpm = box.threePointersMade;
    const tpa = box.threePointersAttempted;
    const ftm = box.freeThrowsMade;
    const fta = box.freeThrowsAttempted;
    if (fgm > fga || tpm > tpa || ftm > fta) {
      failures.push(`${side} makes exceed attempts`);
    }
    if (box.points !== (fgm - tpm) * 2 + tpm * 3 + ftm) {
      failures.push(`${side} points do not reconcile with the box scoring`);
    }
    if (box.assists > fgm) {
      failures.push(`${side} assists exceed made field goals`);
    }
  }
  if (summary.status === 'forfeit') {
    if (summary.homeScore + summary.awayScore !== 2) {
      failures.push('forfeit must be an official 2-0 result');
    }
    const loser = summary.forfeitLoserFranchiseId;
    if (
      loser === null ||
      (loser !== summary.homeFranchiseId && loser !== summary.awayFranchiseId)
    ) {
      failures.push('forfeit loser must be one of the two teams');
    }
    if (summary.overtimePeriods !== 0) {
      failures.push('forfeit carries no overtime');
    }
    return failures;
  }
  if (summary.forfeitLoserFranchiseId !== null) {
    failures.push('final summary must not carry a forfeit loser');
  }
  if (summary.homeScore === summary.awayScore) {
    failures.push('final game cannot be tied');
  }
  return failures;
}
