import {
  seasonAwardsDigest,
  type SeasonAwards,
  type SeasonGameSummary,
  type SeasonRoster,
} from '@hoop-rush/data-contracts';

/**
 * Season awards derivation (spec/2.0/02, M2.6, awards-v1). MVP, Defensive
 * Player of the Year, Sixth Man of the Year, and All-League First Team are
 * pure functions of the recorded REGULAR-SEASON facts: the compact game
 * summaries (which are frozen from postseason qualification onward) and the
 * rosters. The caller passes the regular-season summary set; postseason
 * summaries never enter this module.
 *
 * ## Appearance and start facts
 *
 * A player APPEARS in a game only when their recorded on-court seconds are
 * greater than zero (a zero-second line is not an appearance). A START is
 * recorded only when the compact line's `started` flag is true (the actual
 * opening period-1 unit). Traded players aggregate by `playerVersionId`
 * across franchises; the primary franchise is the one with the most
 * appearances (tie: more starts, then franchiseId ascending), and awards
 * report that franchise.
 *
 * ## Eligibility
 *
 * A player is eligible when `appearances >= ceil(0.7 * teamGames)` where
 * teamGames is the primary franchise's regular-season games played (82 in a
 * complete season, so normally 58). This mirrors the leader table's
 * `SEASON_LEADER_MIN_GAME_SHARE` convention. Zero-appearance players are
 * never recipients. When no player meets the gate for an award, the gate is
 * dropped for that award only (zero-appearance exclusion still applies) so
 * the derivation always returns a valid, deterministic record.
 *
 * ## Availability factor
 *
 * Every composite multiplies by `0.75 + 0.25 * appearances / 82`, so a
 * full-availability season contributes the full composite and a part-time
 * season is discounted proportionally.
 *
 * ## MVP composite (transparent, follows the challenge/mvp.ts precedent)
 *
 * Per appearance: Game Score (PTS + 0.4*FGM - 0.7*FGA - 0.4*(FTA-FTM) +
 * 0.7*ORB + 0.3*DRB + STL + 0.7*AST + 0.7*BLK - 0.4*PF - TOV) plus an
 * efficiency bonus (player true-shooting percentage minus the league average
 * on the same shot volume: (ts - leagueAvgTs) * shotsUsed), a defense bonus
 * (0.6*STL + 0.6*BLK + 0.15*DRB), a playmaking bonus (0.5*AST), and a
 * game-result bonus (+0.75 for a win, -0.75 for a loss). The league-average
 * true shooting is points/(2*shotsUsed) over every line with shots used.
 * The composite is the mean per-appearance value minus a consistency penalty
 * (0.08 * population standard deviation), times the availability factor.
 *
 * ## DPOY composite
 *
 * Per-game defensive production (2.0*STL + 2.0*BLK + 0.5*DRB, divided by
 * appearances) plus a team defensive-rating advantage: (leagueAvgDefRtg -
 * teamDefRtg) / 100 where teamDefRtg = opponent points per 100 possessions
 * from the recorded boxes, weighted by the player's share of the team's
 * total on-court seconds, times 3.0; the sum times the availability factor.
 * Monotonic in steals, blocks, defensive rebounds, defensive advantage, and
 * minutes.
 *
 * ## Sixth Man
 *
 * The MVP composite, eligible only when bench appearances exceed starts
 * (`appearances - started > started`).
 *
 * ## All-League First Team
 *
 * The five highest eligible players by the MVP composite, positionless.
 *
 * ## Tie-breaks (every award)
 *
 * Unrounded composite score, then the primary component (MVP / Sixth Man /
 * First Team: mean per-appearance Game Score; DPOY: per-game defensive
 * production), then total seconds, then playerVersionId ascending.
 *
 * Pure TypeScript: no Svelte, persistence, worker, or network code.
 */

/** Input facts of the awards derivation (regular-season facts only). */
export interface SeasonAwardsInput {
  runId: string;
  rosters: SeasonRoster[];
  /** Regular-season compact summaries (frozen at postseason qualification). */
  summaries: SeasonGameSummary[];
}

/** Season-long eligibility share of a franchise's games (leader convention). */
export const SEASON_AWARD_MIN_GAME_SHARE = 0.7;

/** Full-season games denominator of the availability factor. */
export const SEASON_AWARD_FULL_SEASON_GAMES = 82;

/** Consistency penalty multiplier on the per-appearance standard deviation. */
const CONSISTENCY_PENALTY = 0.08;

/** Defense-bonus weights (challenge/mvp.ts precedent). */
const DEFENSE_WEIGHTS = { steal: 0.6, block: 0.6, defensiveRebound: 0.15 } as const;

/** Playmaking-bonus weight (challenge/mvp.ts precedent). */
const PLAYMAKING_ASSIST_WEIGHT = 0.5;

/** Game-result bonus per appearance (challenge/mvp.ts precedent). */
const TEAM_BONUS = { win: 0.75, loss: -0.75 } as const;

/** DPOY composite coefficients. */
const DPOY = { steal: 2.0, block: 2.0, defensiveRebound: 0.5, advantage: 3.0 } as const;

/** Per-player folding totals over the regular-season summaries. */
interface PlayerTotals {
  playerVersionId: string;
  appearances: number;
  starts: number;
  seconds: number;
  points: number;
  fieldGoalsMade: number;
  fieldGoalsAttempted: number;
  freeThrowsMade: number;
  freeThrowsAttempted: number;
  offensiveRebounds: number;
  defensiveRebounds: number;
  assists: number;
  steals: number;
  blocks: number;
  turnovers: number;
  fouls: number;
  /** Per-appearance MVP value bases (defense/playmaking included). */
  valueBases: number[];
  /** Per-appearance inputs (one entry per appearance). */
  gameScores: number[];
  efficiencyValues: number[];
  shotsList: number[];
  wins: boolean[];
  /** Appearances per franchise (primary-franchise resolution). */
  franchiseAppearances: Map<string, number>;
  franchiseStarts: Map<string, number>;
}

/** Team-level facts derived from the summaries. */
interface TeamFacts {
  gamesPlayed: number;
  pointsAgainst: number;
  possessions: number;
  seconds: number;
}

function shotsUsedOf(line: { fieldGoalsAttempted: number; freeThrowsAttempted: number }): number {
  return line.fieldGoalsAttempted + 0.44 * line.freeThrowsAttempted;
}

function trueShootingOf(line: {
  points: number;
  fieldGoalsAttempted: number;
  freeThrowsAttempted: number;
}): number {
  const shots = shotsUsedOf(line);
  return shots <= 0 ? 0 : line.points / (2 * shots);
}

function gameScoreOf(line: {
  points: number;
  fieldGoalsMade: number;
  fieldGoalsAttempted: number;
  freeThrowsMade: number;
  freeThrowsAttempted: number;
  offensiveRebounds: number;
  defensiveRebounds: number;
  assists: number;
  steals: number;
  blocks: number;
  fouls: number;
  turnovers: number;
}): number {
  return (
    line.points +
    0.4 * line.fieldGoalsMade -
    0.7 * line.fieldGoalsAttempted -
    0.4 * (line.freeThrowsAttempted - line.freeThrowsMade) +
    0.7 * line.offensiveRebounds +
    0.3 * line.defensiveRebounds +
    line.steals +
    0.7 * line.assists +
    0.7 * line.blocks -
    0.4 * line.fouls -
    line.turnovers
  );
}

/** Population standard deviation; 0 for fewer than 2 values. */
function populationStdDev(values: readonly number[], mean: number): number {
  if (values.length < 2) return 0;
  let sumOfSquares = 0;
  for (const value of values) {
    const deviation = value - mean;
    sumOfSquares += deviation * deviation;
  }
  return Math.sqrt(sumOfSquares / values.length);
}

/** Per-appearance MVP value without the baseline efficiency bonus. */
function mvpValueBase(line: {
  points: number;
  fieldGoalsMade: number;
  fieldGoalsAttempted: number;
  freeThrowsMade: number;
  freeThrowsAttempted: number;
  offensiveRebounds: number;
  defensiveRebounds: number;
  assists: number;
  steals: number;
  blocks: number;
  fouls: number;
  turnovers: number;
}): number {
  return (
    gameScoreOf(line) +
    DEFENSE_WEIGHTS.steal * line.steals +
    DEFENSE_WEIGHTS.block * line.blocks +
    DEFENSE_WEIGHTS.defensiveRebound * line.defensiveRebounds +
    PLAYMAKING_ASSIST_WEIGHT * line.assists
  );
}

/** Per-appearance MVP values for the consistency computation. */
function mvpValuesOf(facts: AwardsFacts, row: PlayerTotals): number[] {
  const baseline = facts.leagueAverageTs;
  const values: number[] = [];
  for (let i = 0; i < row.valueBases.length; i += 1) {
    const valueBase = row.valueBases[i] ?? 0;
    const shots = row.shotsList[i] ?? 0;
    const efficiency = row.efficiencyValues[i] ?? 0;
    const won = row.wins[i] ?? false;
    values.push(
      valueBase + (efficiency - baseline) * shots + (won ? TEAM_BONUS.win : TEAM_BONUS.loss),
    );
  }
  return values;
}

/** Folded per-player totals plus the league baseline facts. */
interface AwardsFacts {
  totals: Map<string, PlayerTotals>;
  leagueAverageTs: number;
  teamFacts: Map<string, TeamFacts>;
  leagueAverageDefRtg: number;
}

/** Folds the regular-season summaries into per-player totals and baselines. */
function foldAwardsFacts(input: SeasonAwardsInput): AwardsFacts {
  const totals = new Map<string, PlayerTotals>();
  const teamFacts = new Map<string, TeamFacts>();
  let leaguePoints = 0;
  let leagueShots = 0;

  const lineOf = (line: { playerVersionId: string }): PlayerTotals => {
    let row = totals.get(line.playerVersionId);
    if (row === undefined) {
      row = {
        playerVersionId: line.playerVersionId,
        appearances: 0,
        starts: 0,
        seconds: 0,
        points: 0,
        fieldGoalsMade: 0,
        fieldGoalsAttempted: 0,
        freeThrowsMade: 0,
        freeThrowsAttempted: 0,
        offensiveRebounds: 0,
        defensiveRebounds: 0,
        assists: 0,
        steals: 0,
        blocks: 0,
        turnovers: 0,
        fouls: 0,
        valueBases: [],
        gameScores: [],
        efficiencyValues: [],
        shotsList: [],
        wins: [],
        franchiseAppearances: new Map(),
        franchiseStarts: new Map(),
      };
      totals.set(line.playerVersionId, row);
    }
    return row;
  };

  const teamOf = (franchiseId: string): TeamFacts => {
    let facts = teamFacts.get(franchiseId);
    if (facts === undefined) {
      facts = { gamesPlayed: 0, pointsAgainst: 0, possessions: 0, seconds: 0 };
      teamFacts.set(franchiseId, facts);
    }
    return facts;
  };

  for (const summary of input.summaries) {
    const homeFacts = teamOf(summary.homeFranchiseId);
    const awayFacts = teamOf(summary.awayFranchiseId);
    homeFacts.gamesPlayed += 1;
    awayFacts.gamesPlayed += 1;
    homeFacts.pointsAgainst += summary.awayScore;
    awayFacts.pointsAgainst += summary.homeScore;
    if (summary.status === 'forfeit') continue;
    homeFacts.possessions += summary.homeBox.possessions;
    awayFacts.possessions += summary.awayBox.possessions;
    for (const side of ['home', 'away'] as const) {
      const franchiseId = summary[`${side}FranchiseId`];
      const lines = side === 'home' ? summary.homePlayers : summary.awayPlayers;
      const won =
        (side === 'home' && summary.homeScore > summary.awayScore) ||
        (side === 'away' && summary.awayScore > summary.homeScore);
      for (const line of lines) {
        const row = lineOf(line);
        const seconds = line.seconds;
        const shots = shotsUsedOf(line);
        if (seconds > 0) {
          row.appearances += 1;
          row.franchiseAppearances.set(
            franchiseId,
            (row.franchiseAppearances.get(franchiseId) ?? 0) + 1,
          );
          row.gameScores.push(gameScoreOf(line));
          row.valueBases.push(mvpValueBase(line));
          row.efficiencyValues.push(trueShootingOf(line));
          row.shotsList.push(shots);
          row.wins.push(won);
        }
        if (line.started === true) {
          row.starts += 1;
          row.franchiseStarts.set(franchiseId, (row.franchiseStarts.get(franchiseId) ?? 0) + 1);
        }
        row.seconds += seconds;
        row.points += line.points;
        row.fieldGoalsMade += line.fieldGoalsMade;
        row.fieldGoalsAttempted += line.fieldGoalsAttempted;
        row.freeThrowsMade += line.freeThrowsMade;
        row.freeThrowsAttempted += line.freeThrowsAttempted;
        row.offensiveRebounds += line.offensiveRebounds;
        row.defensiveRebounds += line.defensiveRebounds;
        row.assists += line.assists;
        row.steals += line.steals;
        row.blocks += line.blocks;
        row.turnovers += line.turnovers;
        row.fouls += line.fouls;
        if (shots > 0) {
          leaguePoints += line.points;
          leagueShots += shots;
        }
      }
      teamOf(franchiseId).seconds += lines.reduce((sum, line) => sum + line.seconds, 0);
    }
  }

  let defensiveRtgSum = 0;
  let defensiveRtgCount = 0;
  for (const facts of teamFacts.values()) {
    if (facts.possessions > 0) {
      defensiveRtgSum += (facts.pointsAgainst * 100) / facts.possessions;
      defensiveRtgCount += 1;
    }
  }
  const leagueAverageDefRtg = defensiveRtgCount > 0 ? defensiveRtgSum / defensiveRtgCount : 100;
  const leagueAverageTs = leagueShots > 0 ? leaguePoints / (2 * leagueShots) : 0.5;
  return { totals, leagueAverageTs, teamFacts, leagueAverageDefRtg };
}

/** Primary franchise: most appearances, then more starts, then id ascending. */
function primaryFranchiseOf(row: PlayerTotals): string {
  let best = '';
  let bestAppearances = -1;
  let bestStarts = -1;
  for (const [franchiseId, appearances] of row.franchiseAppearances) {
    const starts = row.franchiseStarts.get(franchiseId) ?? 0;
    if (
      appearances > bestAppearances ||
      (appearances === bestAppearances && starts > bestStarts) ||
      (appearances === bestAppearances &&
        starts === bestStarts &&
        (best === '' || franchiseId < best))
    ) {
      best = franchiseId;
      bestAppearances = appearances;
      bestStarts = starts;
    }
  }
  return best;
}

/** Availability factor: 0.75 + 0.25 * appearances / 82. */
function availabilityFactorOf(row: PlayerTotals): number {
  return 0.75 + 0.25 * (row.appearances / SEASON_AWARD_FULL_SEASON_GAMES);
}

/** The MVP composite (mean per-appearance value minus consistency penalty). */
function mvpCompositeOf(facts: AwardsFacts, row: PlayerTotals): number {
  const values = mvpValuesOf(facts, row);
  const mean =
    row.appearances > 0 ? values.reduce((sum, value) => sum + value, 0) / row.appearances : 0;
  const stdDev = populationStdDev(values, mean);
  return (mean - CONSISTENCY_PENALTY * stdDev) * availabilityFactorOf(row);
}

/** Mean per-appearance Game Score (MVP primary tie-break component). */
function averageGameScoreOf(row: PlayerTotals): number {
  if (row.gameScores.length === 0) return 0;
  return row.gameScores.reduce((sum, value) => sum + value, 0) / row.gameScores.length;
}

/** The DPOY composite (per-game production + defensive-rating advantage). */
function dpoyCompositeOf(facts: AwardsFacts, row: PlayerTotals, franchiseId: string): number {
  const production = defensiveProductionOf(row);
  const team = facts.teamFacts.get(franchiseId);
  const teamSeconds = team?.seconds ?? 0;
  const teamDefRtg =
    team === undefined || team.possessions === 0
      ? facts.leagueAverageDefRtg
      : (team.pointsAgainst * 100) / team.possessions;
  const minutesShare = teamSeconds > 0 ? row.seconds / teamSeconds : 0;
  const advantage = (facts.leagueAverageDefRtg - teamDefRtg) / 100;
  return (production + DPOY.advantage * advantage * minutesShare) * availabilityFactorOf(row);
}

/** DPOY primary tie-break component: per-game defensive production. */
function defensiveProductionOf(row: PlayerTotals): number {
  return (
    (DPOY.steal * row.steals +
      DPOY.block * row.blocks +
      DPOY.defensiveRebound * row.defensiveRebounds) /
    Math.max(1, row.appearances)
  );
}

/** Eligibility gate: at least ceil(0.7 * teamGames) appearances. */
function eligibleFor(facts: AwardsFacts, row: PlayerTotals, franchiseId: string): boolean {
  const team = facts.teamFacts.get(franchiseId);
  const games = team === undefined ? 0 : team.gamesPlayed;
  const minimum = Math.ceil(SEASON_AWARD_MIN_GAME_SHARE * games);
  return row.appearances >= minimum;
}

/** Ranked candidate of one award. */
interface AwardCandidate {
  row: PlayerTotals;
  franchiseId: string;
  score: number;
  primary: number;
}

/** Comparators: score desc, primary desc, seconds desc, playerVersionId asc. */
function compareCandidates(a: AwardCandidate, b: AwardCandidate): number {
  if (b.score !== a.score) return b.score - a.score;
  if (b.primary !== a.primary) return b.primary - a.primary;
  if (b.row.seconds !== a.row.seconds) return b.row.seconds - a.row.seconds;
  return a.row.playerVersionId < b.row.playerVersionId
    ? -1
    : a.row.playerVersionId > b.row.playerVersionId
      ? 1
      : 0;
}

/**
 * Derives the season awards from recorded regular-season facts. The result
 * is a pure function of the inputs and carries a self-consistent canonical
 * digest (`seasonAwardsDigest`).
 */
export function deriveSeasonAwards(input: SeasonAwardsInput): SeasonAwards {
  const facts = foldAwardsFacts(input);

  const candidates: AwardCandidate[] = [];
  for (const row of facts.totals.values()) {
    const franchiseId = primaryFranchiseOf(row);
    if (franchiseId === '' || row.appearances === 0) continue;
    candidates.push({
      row,
      franchiseId,
      score: mvpCompositeOf(facts, row),
      primary: averageGameScoreOf(row),
    });
  }
  if (candidates.length === 0) {
    throw new Error('awards: no player has any recorded appearance');
  }

  const eligible = candidates.filter((candidate) =>
    eligibleFor(facts, candidate.row, candidate.franchiseId),
  );
  const gatePool = eligible.length > 0 ? eligible : candidates;

  const mvp = winnerOf(gatePool);

  const dpoyPool = gatePool.map((candidate) => ({
    ...candidate,
    score: dpoyCompositeOf(facts, candidate.row, candidate.franchiseId),
    primary: defensiveProductionOf(candidate.row),
  }));
  const dpoy = winnerOf(dpoyPool);

  const benchQualified = (candidatesOf: readonly AwardCandidate[]) =>
    candidatesOf.filter(
      (candidate) => candidate.row.appearances - candidate.row.starts > candidate.row.starts,
    );
  let sixthManPool = benchQualified(gatePool);
  if (sixthManPool.length === 0) sixthManPool = benchQualified(candidates);
  if (sixthManPool.length === 0) sixthManPool = gatePool;
  const sixthMan = winnerOf(sixthManPool);

  const firstTeam = [...gatePool].sort(compareCandidates).slice(0, 5);

  const recipientOf = (candidate: AwardCandidate) => ({
    playerVersionId: candidate.row.playerVersionId,
    franchiseId: candidate.franchiseId,
  });

  const awards: SeasonAwards = {
    schemaVersion: 1,
    awardsVersion: 'awards-v1',
    runId: input.runId,
    mvp: recipientOf(mvp),
    defensivePlayerOfYear: recipientOf(dpoy),
    sixthManOfYear: recipientOf(sixthMan),
    allLeagueFirstTeam: firstTeam.map(recipientOf),
    digest: '',
  };
  return { ...awards, digest: seasonAwardsDigest(awards) };
}

/** Winner of a candidate pool under the documented tie-break chain. */
function winnerOf(candidates: readonly AwardCandidate[]): AwardCandidate {
  const ordered = [...candidates].sort(compareCandidates);
  const winner = ordered[0];
  if (winner === undefined) {
    throw new Error('awards: cannot select a winner without candidates');
  }
  return winner;
}
