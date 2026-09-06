import {
  SEASON_CHALLENGE_CATALOG,
  SEASON_SEED_NAMESPACES,
  blockRoundRange,
  canonicalJson,
  franchiseIdSchema,
  seasonDigestHex,
  seasonNamespaceSeed,
  type SeasonChallengeDeal,
  type SeasonChallengeId,
  type SeasonLeague,
  type SeasonSchedule,
  type SeasonStandings,
  type SeasonGameSummary,
  type SeasonBlockChallengeEvaluation,
  type SeasonChallengeEvaluationFacts,
} from '@hoop-rush/data-contracts';

const HARD_IDS: readonly SeasonChallengeId[] = ['beat-leader', 'beat-higher', 'statement-block'];

const REWARD_OF: Record<SeasonChallengeId, 1 | 2> = {
  'winning-block': 1,
  'win-six': 1,
  'three-point-mark': 1,
  'protect-glass': 1,
  'take-care': 1,
  'beat-leader': 2,
  'beat-higher': 2,
  'statement-block': 2,
};

export function challengeRewardOf(challengeId: SeasonChallengeId): 1 | 2 {
  return REWARD_OF[challengeId];
}

export function challengeDifficultyOf(challengeId: SeasonChallengeId): 'standard' | 'hard' {
  return (HARD_IDS as readonly string[]).includes(challengeId) ? 'hard' : 'standard';
}

export function challengeCatalog(): readonly (typeof SEASON_CHALLENGE_CATALOG)[number][] {
  return SEASON_CHALLENGE_CATALOG;
}

interface StandingsRow {
  franchiseId: string;
  wins: number;
  losses: number;
  pointsFor: number;
  pointsAgainst: number;
}

function rowsById(standings: SeasonStandings): Map<string, StandingsRow> {
  const map = new Map<string, StandingsRow>();
  for (const row of standings.rows) {
    map.set(row.franchiseId, {
      franchiseId: row.franchiseId,
      wins: row.wins,
      losses: row.losses,
      pointsFor: row.pointsFor,
      pointsAgainst: row.pointsAgainst,
    });
  }
  return map;
}

function orderedByStandings(rows: StandingsRow[]): StandingsRow[] {
  return [...rows].sort(
    (a, b) =>
      b.wins - a.wins ||
      b.pointsFor - b.pointsAgainst - (a.pointsFor - a.pointsAgainst) ||
      (a.franchiseId < b.franchiseId ? -1 : 1),
  );
}

function conferenceOf(league: SeasonLeague, franchiseId: string): string {
  const team = league.teams.find((entry) => entry.franchiseId === franchiseId);
  if (team === undefined) throw new Error(`franchise ${franchiseId} is not part of the league`);
  return team.conference;
}

function humanGamesInBlock(
  schedule: SeasonSchedule,
  blockIndex: number,
  humanFranchiseId: string,
): { gameIds: string[]; opponents: string[]; count: number } {
  const { fromRound, toRound } = blockRoundRange(blockIndex);
  const gameIds: string[] = [];
  const opponents: string[] = [];
  for (const game of schedule.games) {
    if (game.round < fromRound || game.round > toRound) continue;
    if (game.homeFranchiseId === humanFranchiseId) {
      gameIds.push(game.gameId);
      opponents.push(game.awayFranchiseId);
    } else if (game.awayFranchiseId === humanFranchiseId) {
      gameIds.push(game.gameId);
      opponents.push(game.homeFranchiseId);
    }
  }
  gameIds.sort();
  opponents.sort();
  return { gameIds, opponents, count: gameIds.length };
}

function isStrictlyBetter(opp: StandingsRow, human: StandingsRow): boolean {
  if (opp.wins !== human.wins) return opp.wins > human.wins;
  return opp.losses < human.losses;
}

export interface ChallengeDealContext {
  league: SeasonLeague;
  schedule: SeasonSchedule;
  standings: SeasonStandings;
  humanFranchiseId: string;
}

export function dealSeasonBlockChallenges(
  rootSeed: string,
  blockIndex: number,
  context: ChallengeDealContext,
): SeasonChallengeDeal | null {
  if (blockIndex < 0 || blockIndex > 7) return null;
  const { league, schedule, standings, humanFranchiseId } = context;
  const humanGames = humanGamesInBlock(schedule, blockIndex, humanFranchiseId);
  const gamesInBlock = humanGames.count;
  const byId = rowsById(standings);
  const humanRow = byId.get(humanFranchiseId);
  if (humanRow === undefined) throw new Error(`no standings row for ${humanFranchiseId}`);
  const humanConference = conferenceOf(league, humanFranchiseId);
  const confRows = league.teams
    .filter((team) => team.conference === humanConference)
    .map((team) => byId.get(team.franchiseId))
    .filter((row): row is StandingsRow => row !== undefined);
  const orderedConf = orderedByStandings(confRows);
  const leader = orderedConf[0] ?? null;
  const leaderFranchiseId =
    leader !== null && leader.franchiseId !== humanFranchiseId ? leader.franchiseId : null;
  const scheduledOpponents = new Set(humanGames.opponents);
  const beatLeaderFeasible =
    leaderFranchiseId !== null && scheduledOpponents.has(leaderFranchiseId);
  const qualifyingOpponentIds: string[] = [];
  for (const opponentId of scheduledOpponents) {
    if (opponentId === humanFranchiseId) continue;
    const oppRow = byId.get(opponentId);
    if (oppRow === undefined) continue;
    if (isStrictlyBetter(oppRow, humanRow)) qualifyingOpponentIds.push(opponentId);
  }
  qualifyingOpponentIds.sort();
  const beatHigherFeasible = qualifyingOpponentIds.length > 0;
  const winSixFeasible = gamesInBlock >= 8;
  const statementFeasible = gamesInBlock >= 4;
  const feasibleStandard: SeasonChallengeId[] = ['winning-block'];
  if (winSixFeasible) feasibleStandard.push('win-six');
  feasibleStandard.push('three-point-mark', 'protect-glass', 'take-care');
  const feasibleHard: SeasonChallengeId[] = [];
  if (beatLeaderFeasible) feasibleHard.push('beat-leader');
  if (beatHigherFeasible) feasibleHard.push('beat-higher');
  if (statementFeasible) feasibleHard.push('statement-block');
  const ranked = (ids: SeasonChallengeId[]): SeasonChallengeId[] =>
    ids
      .map((challengeId) => ({
        challengeId,
        hash: seasonNamespaceSeed(
          rootSeed,
          SEASON_SEED_NAMESPACES.challenges,
          'deal',
          String(blockIndex),
          challengeId,
        ),
      }))
      .sort((a, b) => {
        if (a.hash !== b.hash) return a.hash < b.hash ? -1 : 1;
        return a.challengeId < b.challengeId ? -1 : 1;
      })
      .map(({ challengeId }) => challengeId);
  const orderedStandard = ranked(feasibleStandard);
  const orderedHard = ranked(feasibleHard);
  let picked: SeasonChallengeId[];
  if (orderedHard.length > 0) {
    const hard = orderedHard[0];
    if (hard === undefined) throw new Error('hard pick missing after feasibility');
    picked = [...orderedStandard.slice(0, 2), hard];
  } else {
    picked = orderedStandard.slice(0, 3);
  }
  picked = [...picked].sort();
  if (picked.length !== 3 || new Set(picked).size !== 3) {
    throw new Error(`challenge deal for block ${String(blockIndex)} must hold 3 distinct ids`);
  }
  const [first, second, third] = picked;
  if (first === undefined || second === undefined || third === undefined) {
    throw new Error('challenge deal pick underflow');
  }
  const challengeIds = [first, second, third];
  const seedDigest = seasonNamespaceSeed(
    rootSeed,
    SEASON_SEED_NAMESPACES.challenges,
    'deal',
    String(blockIndex),
  );
  const snapshotRows = [...byId.values()]
    .map((row) => ({ franchiseId: row.franchiseId, wins: row.wins, losses: row.losses }))
    .sort((a, b) => (a.franchiseId < b.franchiseId ? -1 : 1));
  const contextDigest = seasonDigestHex(
    canonicalJson({
      rootSeed,
      blockIndex,
      humanFranchiseId,
      gamesInBlock,
      gameIds: humanGames.gameIds,
      standings: snapshotRows,
    }),
  );
  return {
    blockIndex,
    challengeIds,
    seedDigest,
    contextDigest,
    seedPath: ['challenges', 'deal', String(blockIndex)],
    standingsSnapshot: snapshotRows.map((row) => ({
      franchiseId: franchiseIdSchema.parse(row.franchiseId),
      wins: row.wins,
      losses: row.losses,
    })),
    targets: {
      gamesInBlock: Math.min(10, Math.max(1, gamesInBlock)),
      leaderFranchiseId:
        leaderFranchiseId === null || !beatLeaderFeasible
          ? null
          : franchiseIdSchema.parse(leaderFranchiseId),
      qualifyingOpponentIds: qualifyingOpponentIds.map((id) => franchiseIdSchema.parse(id)),
      threePointAttemptFloor: 20,
    },
  };
}

export interface ChallengeFold {
  games: number;
  wins: number;
  losses: number;
  nonForfeitGames: number;
  threePointersMade: number;
  threePointersAttempted: number;
  reboundMargin: number;
  turnovers: number;
  winsByOpponent: Map<string, number>;
}

export function foldChallengeFacts(
  summaries: readonly SeasonGameSummary[],
  humanFranchiseId: string,
): ChallengeFold {
  let games = 0;
  let wins = 0;
  let nonForfeitGames = 0;
  let threePointersMade = 0;
  let threePointersAttempted = 0;
  let reboundMargin = 0;
  let turnovers = 0;
  const winsByOpponent = new Map<string, number>();
  for (const summary of summaries) {
    const homeIsHuman = summary.homeFranchiseId === humanFranchiseId;
    const awayIsHuman = summary.awayFranchiseId === humanFranchiseId;
    if (!homeIsHuman && !awayIsHuman) continue;
    games += 1;
    const opponent = homeIsHuman ? summary.awayFranchiseId : summary.homeFranchiseId;
    let won = false;
    if (summary.status === 'forfeit') {
      won = summary.forfeitLoserFranchiseId !== humanFranchiseId;
    } else if (homeIsHuman) {
      won = summary.homeScore > summary.awayScore;
    } else {
      won = summary.awayScore > summary.homeScore;
    }
    if (won) {
      wins += 1;
      winsByOpponent.set(opponent, (winsByOpponent.get(opponent) ?? 0) + 1);
    }
    if (summary.status === 'forfeit') continue;
    nonForfeitGames += 1;
    const humanBox = homeIsHuman ? summary.homeBox : summary.awayBox;
    const opponentBox = homeIsHuman ? summary.awayBox : summary.homeBox;
    threePointersMade += humanBox.threePointersMade;
    threePointersAttempted += humanBox.threePointersAttempted;
    reboundMargin +=
      humanBox.offensiveRebounds +
      humanBox.defensiveRebounds -
      (opponentBox.offensiveRebounds + opponentBox.defensiveRebounds);
    turnovers += humanBox.turnovers;
  }
  return {
    games,
    wins,
    losses: games - wins,
    nonForfeitGames,
    threePointersMade,
    threePointersAttempted,
    reboundMargin,
    turnovers,
    winsByOpponent,
  };
}

export function evaluateSeasonBlockChallenges(input: {
  deal: SeasonChallengeDeal;
  blockIndex: number;
  humanFranchiseId: string | null;
  summaries: readonly SeasonGameSummary[];
}): SeasonBlockChallengeEvaluation {
  const { deal } = input;
  if (input.blockIndex !== deal.blockIndex) {
    throw new Error('challenge evaluation blockIndex does not match the deal');
  }
  const unevaluatedFacts: SeasonChallengeEvaluationFacts = {
    games: 0,
    wins: 0,
    threePointersMade: 0,
    threePointersAttempted: 0,
    threePointPct: null,
    reboundMargin: 0,
    turnovers: 0,
    turnoversPerGame: null,
    beatLeader: null,
    beatHigher: null,
    sweptBlock: false,
  };
  if (input.humanFranchiseId === null) {
    return {
      blockIndex: deal.blockIndex,
      results: deal.challengeIds.map((challengeId) => ({
        challengeId,
        blockIndex: deal.blockIndex,
        success: false,
        facts: { ...unevaluatedFacts },
      })),
    };
  }
  const human = input.humanFranchiseId;
  const fold = foldChallengeFacts(input.summaries, human);
  const threePointPct =
    fold.threePointersAttempted > 0 ? fold.threePointersMade / fold.threePointersAttempted : null;
  const turnoversPerGame = fold.nonForfeitGames > 0 ? fold.turnovers / fold.nonForfeitGames : null;
  const leaderId = deal.targets.leaderFranchiseId;
  const beatLeader = leaderId === null ? null : (fold.winsByOpponent.get(leaderId) ?? 0) > 0;
  const qualifying = deal.targets.qualifyingOpponentIds;
  const beatHigher =
    qualifying.length === 0
      ? null
      : qualifying.some((opponent) => (fold.winsByOpponent.get(opponent) ?? 0) > 0);
  const sweptBlock = fold.games > 0 && fold.wins === fold.games;
  const facts: SeasonChallengeEvaluationFacts = {
    games: fold.games,
    wins: fold.wins,
    threePointersMade: fold.threePointersMade,
    threePointersAttempted: fold.threePointersAttempted,
    threePointPct,
    reboundMargin: fold.reboundMargin,
    turnovers: fold.turnovers,
    turnoversPerGame,
    beatLeader,
    beatHigher,
    sweptBlock,
  };
  const successOf = (challengeId: SeasonChallengeId): boolean => {
    switch (challengeId) {
      case 'winning-block':
        return fold.wins > fold.games / 2;
      case 'win-six':
        return fold.wins >= 6;
      case 'three-point-mark':
        return fold.threePointersAttempted >= 20 && (threePointPct ?? 0) >= 0.35;
      case 'protect-glass':
        return fold.reboundMargin > 0;
      case 'take-care':
        return turnoversPerGame !== null && turnoversPerGame <= 13.0;
      case 'beat-leader':
        return beatLeader === true;
      case 'beat-higher':
        return beatHigher === true;
      case 'statement-block':
        return sweptBlock && fold.games >= 4;
    }
  };
  const results = deal.challengeIds.map((challengeId) => ({
    challengeId,
    blockIndex: deal.blockIndex,
    success: successOf(challengeId),
    facts: { ...facts },
  }));
  return {
    blockIndex: deal.blockIndex,
    results,
  };
}

export function challengeResultById(
  evaluation: SeasonBlockChallengeEvaluation,
  challengeId: SeasonChallengeId,
): boolean | null {
  return evaluation.results.find((result) => result.challengeId === challengeId)?.success ?? null;
}
