import {
  SEASON_GAME_SUMMARY_VERSION,
  type SeasonCompactInjuryEvent,
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

function compactLineOf(
  player: {
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
  },
  started: boolean,
): SeasonCompactPlayerLine {
  return {
    playerVersionId: player.playerVersionId,
    seconds: player.seconds,
    started,
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
 * The actual opening lineup of one side: the five players on the court at
 * the first tipoff. The opening stint is the recorded period-1 stint with
 * the latest start clock (largest `startSecondsRemaining`); when the
 * simulation records no stints (defensive fallback), no player is a
 * starter. M2.6 awards facts.
 */
function openingStartersOf(result: SeasonGameSimulationResult, side: 'home' | 'away'): Set<string> {
  if (result.outcome !== 'completed') return new Set();
  let opening: { startSecondsRemaining: number; players: readonly string[] } | null = null;
  for (const stint of result.unitStints) {
    if (stint.side !== side || stint.period !== 1) continue;
    if (opening === null || stint.startSecondsRemaining > opening.startSecondsRemaining) {
      opening = { startSecondsRemaining: stint.startSecondsRemaining, players: stint.players };
    }
  }
  if (opening === null) return new Set();
  return new Set(opening.players);
}

/**
 * Converts one simulation result plus its schedule game into a compact
 * summary. The schedule game is the source of identity (gameId, round,
 * home/away franchise); the result's side boxes carry the franchise ids and
 * statistics. A forfeit becomes the official 2-0 with zero boxes and empty
 * player arrays. `no-legal-five-both` throws: it has no legal summary
 * representation and must never be fabricated into a winner. M2.5: the
 * optional `injuryEvents` (compact per-game injury facts) ride the summary;
 * a zero-injury game carries an empty array.
 */
export function seasonGameSummaryFromResult(
  result: SeasonGameSimulationResult,
  game: SeasonScheduleGame,
  effectsTransition?: SeasonGameEffectsTransition,
  injuryEvents: readonly SeasonCompactInjuryEvent[] = [],
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
      // M2.5: a forfeit-after-removal game's injury rolls are real facts
      // (the removals happened mid-game before the forfeit); the compact
      // events ride the summary so records and events stay 1:1. Tipoff
      // forfeits roll nothing (no exposure), so they carry no events.
      injuryEvents: [...injuryEvents],
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
    homePlayers: sortedLines(
      result.home.players.map((player) =>
        compactLineOf(player, openingStartersOf(result, 'home').has(player.playerVersionId)),
      ),
    ),
    awayPlayers: sortedLines(
      result.away.players.map((player) =>
        compactLineOf(player, openingStartersOf(result, 'away').has(player.playerVersionId)),
      ),
    ),
    ...(effectsTransition !== undefined && effectsTransition.evidence.length > 0
      ? { effectsRollup: seasonEffectsRollupFromEvidence(effectsTransition.evidence) }
      : {}),
    injuryEvents: [...injuryEvents],
  };
}

/**
 * Wraps the full simulation result as a retained detail row (human-team
 * games only). Reuses the complete M2.2 result contract, so substitutions,
 * unit stints, deviations, foul-outs, removals, shot-zone facts, and
 * diagnostics are preserved exactly where the product explains them. M2.5:
 * the compact injury-event rollup rides the detail for display.
 */
export function seasonRetainedDetailFromResult(
  result: SeasonGameSimulationResult,
  game: SeasonScheduleGame,
  runId: string,
  effectsTransition?: SeasonGameEffectsTransition,
  injuryEvents: readonly SeasonCompactInjuryEvent[] = [],
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
    injuryEvents: [...injuryEvents],
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

export function seasonEffectsEvidenceOf(
  transition: SeasonGameEffectsTransition,
): SeasonMechanismEvidence[] {
  return transition.evidence;
}

/**
 * Audits one compact summary: for final games the team boxes equal the sum
 * of the player lines and the scores are consistent with the boxes; for
 * forfeits every non-zero field is flagged. M2.5: the compact injury events
 * are validated structurally — forfeits carry none; every event references a
 * rostered version of its side; one event per player per game; a returned
 * event always carries its return clock and a non-returned event never does.
 * Returns failure strings; empty means valid.
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
    // M2.5: a forfeit-after-removal game's compact injury events are real
    // facts (uniqueness + return-clock consistency; side/membership checks
    // need rosters the summary audit cannot see — the block audit covers
    // them against the expanded set).
    const seenForfeit = new Set<string>();
    for (const event of summary.injuryEvents) {
      if (seenForfeit.has(event.playerVersionId)) {
        failures.push(`duplicate injury event for ${event.playerVersionId}`);
      }
      seenForfeit.add(event.playerVersionId);
      if (event.returned && event.returnClock === null) {
        failures.push(`returned injury event for ${event.playerVersionId} carries no return clock`);
      }
      if (!event.returned && event.returnClock !== null) {
        failures.push(
          `injury event for ${event.playerVersionId} carries a return clock without returning`,
        );
      }
    }
    return failures;
  }
  if (summary.forfeitLoserFranchiseId !== null) {
    failures.push('final summary must not carry a forfeit loser');
  }
  if (summary.homeScore === summary.awayScore) {
    failures.push('final game cannot be tied');
  }

  // M2.5 compact injury-event audit (final games only; forfeits carry none).
  {
    const rosteredOf = new Map<string, string>();
    for (const side of sides) {
      for (const line of side === 'home' ? summary.homePlayers : summary.awayPlayers) {
        rosteredOf.set(line.playerVersionId, side);
      }
    }
    const seen = new Set<string>();
    for (const event of summary.injuryEvents) {
      const rosteredSide = rosteredOf.get(event.playerVersionId);
      if (rosteredSide === undefined) {
        failures.push(`injury event references an unrostered version ${event.playerVersionId}`);
      } else if (rosteredSide !== event.side) {
        failures.push(
          `injury event side ${event.side} does not match the rostered side ${rosteredSide} for ${event.playerVersionId}`,
        );
      }
      if (seen.has(event.playerVersionId)) {
        failures.push(`duplicate injury event for ${event.playerVersionId}`);
      }
      seen.add(event.playerVersionId);
      if (event.returned && event.returnClock === null) {
        failures.push(`returned injury event for ${event.playerVersionId} carries no return clock`);
      }
      if (!event.returned && event.returnClock !== null) {
        failures.push(
          `non-returned injury event for ${event.playerVersionId} carries a return clock`,
        );
      }
    }
  }
  return failures;
}
