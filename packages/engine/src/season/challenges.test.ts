import { describe, expect, it } from 'vitest';
import {
  franchiseIdSchema,
  type SeasonLeague,
  type SeasonSchedule,
  type SeasonStandings,
} from '@hoop-rush/data-contracts';
import { dealSeasonBlockChallenges, evaluateSeasonBlockChallenges } from './challenges.ts';
import { fixtureSummary } from './season-economy-test-support.ts';
import { generateSeasonSchedule } from './schedule.ts';
import { buildSeasonLeague } from '@hoop-rush/test-fixtures';
import { seedSchema } from '@hoop-rush/data-contracts';

const HUMAN = 'lakers';
const ROOT = 'a1b2c3d4e5f60718293a4b5c6d7e8f9a';

function league(): SeasonLeague {
  return buildSeasonLeague({}, { humanFranchiseId: HUMAN });
}

function scheduleOf(lg: SeasonLeague): SeasonSchedule {
  return generateSeasonSchedule({ league: lg, seed: seedSchema.parse(ROOT) });
}

function emptyStandings(lg: SeasonLeague): SeasonStandings {
  return {
    schemaVersion: 1,
    standingsVersion: 'standings-v1',
    rows: lg.teams.map((team) => ({
      franchiseId: team.franchiseId,
      wins: 0,
      losses: 0,
      gamesPlayed: 0,
      homeWins: 0,
      homeLosses: 0,
      awayWins: 0,
      awayLosses: 0,
      conferenceWins: 0,
      conferenceLosses: 0,
      divisionWins: 0,
      divisionLosses: 0,
      pointsFor: 0,
      pointsAgainst: 0,
      headToHead: lg.teams
        .filter((other) => other.franchiseId !== team.franchiseId)
        .map((other) => ({ franchiseId: other.franchiseId, wins: 0, losses: 0 })),
    })),
  };
}

function standingsWith(
  lg: SeasonLeague,
  wins: Record<string, number>,
  losses: Record<string, number>,
): SeasonStandings {
  const base = emptyStandings(lg);
  return {
    ...base,
    rows: base.rows.map((row) => ({
      ...row,
      wins: wins[row.franchiseId] ?? 0,
      losses: losses[row.franchiseId] ?? 0,
      gamesPlayed: (wins[row.franchiseId] ?? 0) + (losses[row.franchiseId] ?? 0),
    })),
  };
}

function humanGame(
  gameId: string,
  homeScore: number,
  awayScore: number,
  opts: {
    humanHome?: boolean;
    opponent?: string;
    threeMade?: number;
    threeAttempted?: number;
    humanRebounds?: number;
    opponentRebounds?: number;
    humanTurnovers?: number;
  } = {},
) {
  const humanHome = opts.humanHome ?? true;
  const opponent = opts.opponent ?? 'celtics';
  const home = humanHome ? HUMAN : opponent;
  const away = humanHome ? opponent : HUMAN;
  const homeBox = {
    franchiseId: franchiseIdSchema.parse(home),
    points: homeScore,
    fieldGoalsMade: 0,
    fieldGoalsAttempted: 0,
    threePointersMade: humanHome ? (opts.threeMade ?? 0) : 0,
    threePointersAttempted: humanHome ? (opts.threeAttempted ?? 0) : 0,
    freeThrowsMade: 0,
    freeThrowsAttempted: 0,
    offensiveRebounds: Math.ceil(
      ((humanHome ? opts.humanRebounds : opts.opponentRebounds) ?? 40) / 2,
    ),
    defensiveRebounds: Math.floor(
      ((humanHome ? opts.humanRebounds : opts.opponentRebounds) ?? 40) / 2,
    ),
    assists: 0,
    steals: 0,
    blocks: 0,
    turnovers: humanHome ? (opts.humanTurnovers ?? 12) : 10,
    fouls: 0,
    possessions: 0,
  };
  const awayBox = {
    franchiseId: franchiseIdSchema.parse(away),
    points: awayScore,
    fieldGoalsMade: 0,
    fieldGoalsAttempted: 0,
    threePointersMade: !humanHome ? (opts.threeMade ?? 0) : 0,
    threePointersAttempted: !humanHome ? (opts.threeAttempted ?? 0) : 0,
    freeThrowsMade: 0,
    freeThrowsAttempted: 0,
    offensiveRebounds: Math.ceil(
      ((humanHome ? opts.opponentRebounds : opts.humanRebounds) ?? 40) / 2,
    ),
    defensiveRebounds: Math.floor(
      ((humanHome ? opts.opponentRebounds : opts.humanRebounds) ?? 40) / 2,
    ),
    assists: 0,
    steals: 0,
    blocks: 0,
    turnovers: !humanHome ? (opts.humanTurnovers ?? 12) : 10,
    fouls: 0,
    possessions: 0,
  };
  return fixtureSummary(gameId, home, away, homeScore, awayScore, { homeBox, awayBox });
}

describe('challenge dealing', () => {
  it('deals exactly 3 canonical challenges for blocks 0-7 and none for block 8', () => {
    const lg = league();
    const schedule = scheduleOf(lg);
    const standings = emptyStandings(lg);
    for (let block = 0; block <= 7; block += 1) {
      const deal = dealSeasonBlockChallenges(ROOT, block, {
        league: lg,
        schedule,
        standings,
        humanFranchiseId: HUMAN,
      });
      expect(deal).not.toBeNull();
      expect(deal?.challengeIds).toHaveLength(3);
      expect([...(deal?.challengeIds ?? [])].sort()).toEqual(deal?.challengeIds);
      expect(new Set(deal?.challengeIds).size).toBe(3);
    }
    expect(
      dealSeasonBlockChallenges(ROOT, 8, {
        league: lg,
        schedule,
        standings,
        humanFranchiseId: HUMAN,
      }),
    ).toBeNull();
  });

  it('persists seed path, standings snapshot facts, and context digest on the deal', () => {
    const lg = league();
    const schedule = scheduleOf(lg);
    const standings = emptyStandings(lg);
    const deal = dealSeasonBlockChallenges(ROOT, 0, {
      league: lg,
      schedule,
      standings,
      humanFranchiseId: HUMAN,
    });
    expect(deal?.seedPath).toEqual(['challenges', 'deal', '0']);
    expect(deal?.standingsSnapshot).toHaveLength(30);
    expect(deal?.standingsSnapshot?.find((row) => row.franchiseId === HUMAN)).toMatchObject({
      wins: 0,
      losses: 0,
    });
    expect(deal?.contextDigest).toMatch(/^[0-9a-f]{32}$/);
    expect(deal?.seedDigest).toMatch(/^[0-9a-f]{32}$/);
  });

  it('is deterministic for the same seed, block, schedule, and standings', () => {
    const lg = league();
    const schedule = scheduleOf(lg);
    const standings = emptyStandings(lg);
    const first = dealSeasonBlockChallenges(ROOT, 2, {
      league: lg,
      schedule,
      standings,
      humanFranchiseId: HUMAN,
    });
    const second = dealSeasonBlockChallenges(ROOT, 2, {
      league: lg,
      schedule,
      standings,
      humanFranchiseId: HUMAN,
    });
    expect(second).toEqual(first);
  });

  it('makes beat-higher generally infeasible at block zero (all tied)', () => {
    const lg = league();
    const schedule = scheduleOf(lg);
    const standings = emptyStandings(lg);
    const deal = dealSeasonBlockChallenges(ROOT, 0, {
      league: lg,
      schedule,
      standings,
      humanFranchiseId: HUMAN,
    });
    expect(deal?.targets.qualifyingOpponentIds).toEqual([]);
    expect(deal?.challengeIds).not.toContain('beat-higher');
  });

  it('names the conference leader opponent at deal time when scheduled', () => {
    const lg = buildSeasonLeague({}, { humanFranchiseId: HUMAN });
    const schedule = scheduleOf(lg);
    const humanConference = lg.teams.find((t) => t.franchiseId === HUMAN)?.conference ?? 'west';
    const leader = lg.teams.find(
      (t) => t.conference === humanConference && t.franchiseId !== HUMAN,
    )?.franchiseId;
    if (leader === undefined) throw new Error('no leader candidate');
    const wins: Record<string, number> = { [leader]: 8 };
    const losses: Record<string, number> = { [leader]: 2, [HUMAN]: 5 };
    const standings = standingsWith(lg, wins, losses);
    const deal = dealSeasonBlockChallenges(ROOT, 1, {
      league: lg,
      schedule,
      standings,
      humanFranchiseId: HUMAN,
    });
    expect(deal).not.toBeNull();
    if (deal?.challengeIds.includes('beat-leader')) {
      expect(deal.targets.leaderFranchiseId).not.toBeNull();
    }
    if (deal?.challengeIds.includes('beat-higher')) {
      expect(deal.targets.qualifyingOpponentIds.length).toBeGreaterThan(0);
    }
  });

  it('never deals win-six below 8 human games or statement below 4', () => {
    const lg = league();
    const schedule = scheduleOf(lg);
    const standings = emptyStandings(lg);
    for (let block = 0; block <= 7; block += 1) {
      const deal = dealSeasonBlockChallenges(ROOT, block, {
        league: lg,
        schedule,
        standings,
        humanFranchiseId: HUMAN,
      });
      const games = deal?.targets.gamesInBlock ?? 10;
      if (games < 8) expect(deal?.challengeIds).not.toContain('win-six');
      if (games < 4) expect(deal?.challengeIds).not.toContain('statement-block');
    }
  });
});

describe('challenge evaluation predicates', () => {
  function dealWith(ids: ['protect-glass', 'take-care', 'winning-block']) {
    return {
      blockIndex: 0,
      challengeIds: ids,
      seedDigest: '0'.repeat(32),
      contextDigest: '1'.repeat(32),
      targets: {
        gamesInBlock: 10,
        leaderFranchiseId: null,
        qualifyingOpponentIds: [],
        threePointAttemptFloor: 20,
      },
    } as unknown as import('@hoop-rush/data-contracts').SeasonChallengeDeal;
  }

  function dealFor(
    ids: [string, string, string],
    targets?: Partial<{
      gamesInBlock: number;
      leaderFranchiseId: string | null;
      qualifyingOpponentIds: string[];
    }>,
  ) {
    return {
      blockIndex: 0,
      challengeIds: [...ids].sort(),
      seedDigest: '0'.repeat(32),
      contextDigest: '1'.repeat(32),
      targets: {
        gamesInBlock: 10,
        leaderFranchiseId: null,
        qualifyingOpponentIds: [],
        threePointAttemptFloor: 20,
        ...targets,
      },
    } as unknown as import('@hoop-rush/data-contracts').SeasonChallengeDeal;
  }

  function resultOf(
    deal: import('@hoop-rush/data-contracts').SeasonChallengeDeal,
    summaries: Parameters<typeof evaluateSeasonBlockChallenges>[0]['summaries'],
    challengeId: string,
  ) {
    const evaluation = evaluateSeasonBlockChallenges({
      deal,
      blockIndex: 0,
      humanFranchiseId: HUMAN,
      summaries,
    });
    const result = evaluation.results.find((entry) => entry.challengeId === challengeId);
    if (result === undefined) throw new Error(`missing result for ${challengeId}`);
    return result;
  }

  it('win-six: six wins succeed, five fail', () => {
    const deal = dealFor(['protect-glass', 'take-care', 'win-six']);
    const sixWins = Array.from({ length: 10 }, (_, i) =>
      humanGame(`s${String(i + 1).padStart(6, '0')}`, i < 6 ? 100 : 90, i < 6 ? 90 : 100),
    );
    expect(resultOf(deal, sixWins, 'win-six').success).toBe(true);
    const fiveWins = sixWins.map((summary, index) =>
      index === 0 ? humanGame(summary.gameId, 90, 100) : summary,
    );
    const missed = resultOf(deal, fiveWins, 'win-six');
    expect(missed.success).toBe(false);
    expect(missed.facts.wins).toBe(5);
  });

  it('protect-glass: positive margin succeeds, zero or negative fails', () => {
    const deal = dealFor(['protect-glass', 'take-care', 'winning-block']);
    const plus = Array.from({ length: 4 }, (_, i) =>
      humanGame(`s${String(i + 1).padStart(6, '0')}`, 100, 90, {
        humanRebounds: 42,
        opponentRebounds: 40,
      }),
    );
    expect(resultOf(deal, plus, 'protect-glass').success).toBe(true);
    const flat = plus.map((summary) =>
      humanGame(summary.gameId, 100, 90, { humanRebounds: 40, opponentRebounds: 40 }),
    );
    expect(resultOf(deal, flat, 'protect-glass').success).toBe(false);
  });

  it('take-care: at most 13.0 turnovers per game succeeds', () => {
    const deal = dealFor(['protect-glass', 'take-care', 'winning-block']);
    const clean = Array.from({ length: 10 }, (_, i) =>
      humanGame(`s${String(i + 1).padStart(6, '0')}`, 100, 90, { humanTurnovers: 13 }),
    );
    const made = resultOf(deal, clean, 'take-care');
    expect(made.success).toBe(true);
    expect(made.facts.turnoversPerGame).toBe(13);
    const sloppy = clean.map((summary, index) =>
      index === 0 ? humanGame(summary.gameId, 100, 90, { humanTurnovers: 14 }) : summary,
    );
    const missed = resultOf(deal, sloppy, 'take-care');
    expect(missed.success).toBe(false);
    expect(missed.facts.turnoversPerGame).toBeCloseTo(13.1, 5);
  });

  it('beat-leader: only a win over the dealt leader succeeds', () => {
    const deal = dealFor(['beat-higher', 'beat-leader', 'winning-block'], {
      leaderFranchiseId: 'celtics',
      qualifyingOpponentIds: ['celtics'],
    });
    const beatLeader = [
      humanGame('s000001', 100, 90, { opponent: 'celtics' }),
      humanGame('s000002', 90, 100, { opponent: 'bulls' }),
    ];
    expect(resultOf(deal, beatLeader, 'beat-leader').success).toBe(true);
    const beatNobody = [
      humanGame('s000001', 90, 100, { opponent: 'celtics' }),
      humanGame('s000002', 100, 90, { opponent: 'bulls' }),
    ];
    expect(resultOf(deal, beatNobody, 'beat-leader').success).toBe(false);
    const noLeader = dealFor(['beat-higher', 'beat-leader', 'winning-block'], {
      leaderFranchiseId: null,
      qualifyingOpponentIds: [],
    });
    expect(resultOf(noLeader, beatLeader, 'beat-leader').success).toBe(false);
  });

  it('beat-higher: a win over any dealt qualifier succeeds', () => {
    const deal = dealFor(['beat-higher', 'take-care', 'winning-block'], {
      qualifyingOpponentIds: ['bulls', 'celtics'],
    });
    const beatOne = [
      humanGame('s000001', 90, 100, { opponent: 'celtics' }),
      humanGame('s000002', 100, 90, { opponent: 'bulls' }),
    ];
    expect(resultOf(deal, beatOne, 'beat-higher').success).toBe(true);
    const beatNeither = [
      humanGame('s000001', 90, 100, { opponent: 'celtics' }),
      humanGame('s000002', 90, 100, { opponent: 'bulls' }),
    ];
    expect(resultOf(deal, beatNeither, 'beat-higher').success).toBe(false);
  });

  it('statement-block: a sweep of 4+ games succeeds, any loss or short block fails', () => {
    const deal = dealFor(['protect-glass', 'statement-block', 'winning-block']);
    const sweep = Array.from({ length: 10 }, (_, i) =>
      humanGame(`s${String(i + 1).padStart(6, '0')}`, 100, 90),
    );
    const made = resultOf(deal, sweep, 'statement-block');
    expect(made.success).toBe(true);
    expect(made.facts.wins).toBe(10);
    const oneLoss = sweep.map((summary, index) =>
      index === 3 ? humanGame(summary.gameId, 90, 100) : summary,
    );
    expect(resultOf(deal, oneLoss, 'statement-block').success).toBe(false);
    const shortSweep = [
      humanGame('s000001', 100, 90),
      humanGame('s000002', 100, 90),
      humanGame('s000003', 100, 90),
    ];
    expect(resultOf(deal, shortSweep, 'statement-block').success).toBe(false);
  });

  it('snapshots a dealt block evaluation for replay stability', () => {
    const deal = dealFor(['protect-glass', 'take-care', 'winning-block']);
    const summaries = Array.from({ length: 10 }, (_, i) =>
      humanGame(`s${String(i + 1).padStart(6, '0')}`, 100 - i, 90, {
        humanRebounds: 42,
        opponentRebounds: 40,
        humanTurnovers: 12,
        threeMade: 4,
        threeAttempted: 10,
      }),
    );
    const evaluation = evaluateSeasonBlockChallenges({
      deal,
      blockIndex: 0,
      humanFranchiseId: HUMAN,
      summaries,
    });
    expect(evaluation).toMatchSnapshot();
    const replayed = evaluateSeasonBlockChallenges({
      deal,
      blockIndex: 0,
      humanFranchiseId: HUMAN,
      summaries,
    });
    expect(replayed).toEqual(evaluation);
  });

  it('winning-block needs over .500', () => {
    const deal = dealWith(['protect-glass', 'take-care', 'winning-block']);
    const sixFour = Array.from({ length: 10 }, (_, i) =>
      humanGame(`s${String(i + 1).padStart(6, '0')}`, i < 6 ? 100 : 90, i < 6 ? 90 : 100),
    );
    const result = evaluateSeasonBlockChallenges({
      deal,
      blockIndex: 0,
      humanFranchiseId: HUMAN,
      summaries: sixFour,
    });
    expect(result.results.find((r) => r.challengeId === 'winning-block')?.success).toBe(true);
    const fiveFive = sixFour.map((s, i) => (i === 0 ? humanGame(s.gameId, 90, 100) : s));
    const missed = evaluateSeasonBlockChallenges({
      deal,
      blockIndex: 0,
      humanFranchiseId: HUMAN,
      summaries: fiveFive,
    });
    expect(missed.results.find((r) => r.challengeId === 'winning-block')?.success).toBe(false);
  });

  it('three-point-mark needs >=20 attempts else missed with count', () => {
    const deal = {
      blockIndex: 0,
      challengeIds: ['protect-glass', 'take-care', 'three-point-mark'],
      seedDigest: '0'.repeat(32),
      contextDigest: '1'.repeat(32),
      targets: {
        gamesInBlock: 10,
        leaderFranchiseId: null,
        qualifyingOpponentIds: [],
        threePointAttemptFloor: 20,
      },
    } as unknown as import('@hoop-rush/data-contracts').SeasonChallengeDeal;
    const hot = Array.from({ length: 10 }, (_, i) =>
      humanGame(`s${String(i + 1).padStart(6, '0')}`, 100, 90, {
        threeMade: 4,
        threeAttempted: 10,
      }),
    );
    const made = evaluateSeasonBlockChallenges({
      deal,
      blockIndex: 0,
      humanFranchiseId: HUMAN,
      summaries: hot,
    });
    const three = made.results.find((r) => r.challengeId === 'three-point-mark');
    expect(three?.success).toBe(true);
    expect(three?.facts.threePointersAttempted).toBe(100);
    const short = [humanGame('s000001', 100, 90, { threeMade: 7, threeAttempted: 19 })];
    const missed = evaluateSeasonBlockChallenges({
      deal,
      blockIndex: 0,
      humanFranchiseId: HUMAN,
      summaries: short,
    });
    const threeMissed = missed.results.find((r) => r.challengeId === 'three-point-mark');
    expect(threeMissed?.success).toBe(false);
    expect(threeMissed?.facts.threePointersAttempted).toBe(19);
  });

  it('forfeits count W/L but add no boxes', () => {
    const deal = dealWith(['protect-glass', 'take-care', 'winning-block']);
    const win = humanGame('s000001', 100, 90);
    const forfeitWin = {
      ...humanGame('s000002', 2, 0),
      status: 'forfeit' as const,
      homeScore: 2,
      awayScore: 0,
      forfeitLoserFranchiseId: franchiseIdSchema.parse('celtics'),
    };
    const forfeitLoss = {
      ...humanGame('s000003', 0, 2),
      status: 'forfeit' as const,
      homeScore: 0,
      awayScore: 2,
      forfeitLoserFranchiseId: franchiseIdSchema.parse(HUMAN),
    };
    const result = evaluateSeasonBlockChallenges({
      deal,
      blockIndex: 0,
      humanFranchiseId: HUMAN,
      summaries: [win, forfeitWin, forfeitLoss],
    });
    const facts = result.results[0]?.facts;
    expect(facts?.games).toBe(3);
    expect(facts?.wins).toBe(2);
    expect(facts?.threePointersAttempted).toBe(0);
    expect(facts?.turnovers).toBe(12);
  });

  it('evaluates one fold in canonical order with shared facts', () => {
    const deal = dealWith(['protect-glass', 'take-care', 'winning-block']);
    const summaries = Array.from({ length: 10 }, (_, i) =>
      humanGame(`s${String(i + 1).padStart(6, '0')}`, 100, 90),
    );
    const first = evaluateSeasonBlockChallenges({
      deal,
      blockIndex: 0,
      humanFranchiseId: HUMAN,
      summaries,
    });
    const second = evaluateSeasonBlockChallenges({
      deal,
      blockIndex: 0,
      humanFranchiseId: HUMAN,
      summaries,
    });
    expect(second).toEqual(first);
    expect(first.results.map((r) => r.challengeId)).toEqual([
      'protect-glass',
      'take-care',
      'winning-block',
    ]);
    const [a, b, c] = first.results;
    expect(a?.facts).toEqual(b?.facts);
    expect(b?.facts).toEqual(c?.facts);
  });
});
