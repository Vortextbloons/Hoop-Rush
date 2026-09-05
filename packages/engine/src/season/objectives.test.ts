import { describe, expect, it } from 'vitest';
import {
  SEASON_MINUTE_POLICY_VERSION,
  SEASON_ROTATION_VERSION,
  franchiseIdSchema,
  type SeasonRotation,
} from '@hoop-rush/data-contracts';
import {
  evaluateSeasonBlockObjective,
  seasonObjectiveCatalog,
  seasonObjectiveChoicesForBlock,
} from './objectives.ts';
import { fixtureSummary } from './season-economy-test-support.ts';
const HUMAN = 'lakers';
const BLOCK = 3;
const ROTATION: SeasonRotation = {
  franchiseId: franchiseIdSchema.parse(HUMAN),
  starters: ['pv-a', 'pv-b', 'pv-c', 'pv-d', 'pv-e'],
  benchOrder: ['pv-f', 'pv-g', 'pv-h', 'pv-i', 'pv-j'],
  targetMinutes: [
    { playerVersionId: 'pv-a', minutes: 33 },
    { playerVersionId: 'pv-b', minutes: 33 },
    { playerVersionId: 'pv-c', minutes: 33 },
    { playerVersionId: 'pv-d', minutes: 33 },
    { playerVersionId: 'pv-e', minutes: 33 },
    { playerVersionId: 'pv-f', minutes: 21 },
    { playerVersionId: 'pv-g', minutes: 18 },
    { playerVersionId: 'pv-h', minutes: 15 },
    { playerVersionId: 'pv-i', minutes: 12 },
    { playerVersionId: 'pv-j', minutes: 9 },
  ],
  closingFive: ['pv-a', 'pv-b', 'pv-c', 'pv-d', 'pv-e'],
  minutePolicy: { policyVersion: SEASON_MINUTE_POLICY_VERSION, strategy: 'balanced' },
  rotationVersion: SEASON_ROTATION_VERSION,
};
function humanLine(version: string, seconds: number, turnovers = 0) {
  return {
    playerVersionId: version,
    seconds,
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
    turnovers,
    fouls: 0,
  };
}
function opponentLine(version: string, seconds = 2400) {
  return {
    playerVersionId: version,
    seconds,
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
  };
}
const OPPONENT_VERSIONS = Array.from(
  { length: 10 },
  (_, index) => `pv-opp-${String(index).padStart(28, '0')}`,
);
function game(
  gameId: string,
  homeScore: number,
  awayScore: number,
  opts: {
    humanRebounds?: number;
    opponentRebounds?: number;
    humanTurnovers?: number;
    humanSeconds?: Record<string, number>;
  } = {},
) {
  const humanSeconds = opts.humanSeconds ?? {};
  const homeLines = Array.from({ length: 10 }, (_, index) => {
    const version = String.fromCharCode(97 + index);
    return humanLine(`pv-${version}`, humanSeconds[`pv-${version}`] ?? 1440);
  });
  const awayLines = OPPONENT_VERSIONS.map((version) => opponentLine(version));
  const homeBox = {
    franchiseId: franchiseIdSchema.parse(HUMAN),
    points: homeScore,
    fieldGoalsMade: 0,
    fieldGoalsAttempted: 0,
    threePointersMade: 0,
    threePointersAttempted: 0,
    freeThrowsMade: 0,
    freeThrowsAttempted: 0,
    offensiveRebounds: Math.ceil((opts.humanRebounds ?? 40) / 2),
    defensiveRebounds: Math.floor((opts.humanRebounds ?? 40) / 2),
    assists: 0,
    steals: 0,
    blocks: 0,
    turnovers: opts.humanTurnovers ?? 12,
    fouls: 0,
    possessions: 0,
  };
  const awayBox = {
    franchiseId: franchiseIdSchema.parse('celtics'),
    points: awayScore,
    fieldGoalsMade: 0,
    fieldGoalsAttempted: 0,
    threePointersMade: 0,
    threePointersAttempted: 0,
    freeThrowsMade: 0,
    freeThrowsAttempted: 0,
    offensiveRebounds: Math.ceil((opts.opponentRebounds ?? 40) / 2),
    defensiveRebounds: Math.floor((opts.opponentRebounds ?? 40) / 2),
    assists: 0,
    steals: 0,
    blocks: 0,
    turnovers: 10,
    fouls: 0,
    possessions: 0,
  };
  return fixtureSummary(gameId, HUMAN, 'celtics', homeScore, awayScore, {
    homeLines,
    awayLines,
    homeBox,
    awayBox,
  });
}
const TEN_TIPS = Array.from({ length: 10 }, (_, index) => ({
  gameId: `s${String(index + 1).padStart(6, '0')}`,
  availableCount: 9,
}));
function evaluate(
  objectiveId:
    | 'win-six'
    | 'defense-108'
    | 'rebound-plus-20'
    | 'availability-eight'
    | 'bench-320'
    | 'turnover-130',
  summaries: Parameters<typeof evaluateSeasonBlockObjective>[0]['summaries'],
  tips: Parameters<typeof evaluateSeasonBlockObjective>[0]['tipAvailability'],
  rotation: SeasonRotation | null = ROTATION,
) {
  return evaluateSeasonBlockObjective({
    objectiveId,
    blockIndex: BLOCK,
    humanFranchiseId: HUMAN,
    rotation,
    summaries,
    tipAvailability: tips,
  });
}
describe('season objective null safety', () => {
  it('returns the unevaluated shape for a null objective id (block 8)', () => {
    const result = evaluateSeasonBlockObjective({
      objectiveId: null,
      blockIndex: 8,
      humanFranchiseId: HUMAN,
      rotation: ROTATION,
      summaries: [game('s000001', 100, 90)],
      tipAvailability: [{ gameId: 's000001', availableCount: 9 }],
    });
    expect(result.objectiveId).toBeNull();
    expect(result.success).toBeNull();
    expect(result.evaluation.facts).toEqual({
      games: 0,
      wins: 0,
      pointsAllowed: 0,
      reboundMargin: 0,
      tipsWithAtLeastEightAvailable: 0,
      tipsTotal: 0,
      benchMinutes: 0,
      turnovers: 0,
    });
  });
  it('returns the unevaluated shape without a human franchise (AI context)', () => {
    const result = evaluateSeasonBlockObjective({
      objectiveId: 'win-six',
      blockIndex: 0,
      humanFranchiseId: null,
      rotation: ROTATION,
      summaries: [game('s000001', 100, 90)],
      tipAvailability: [{ gameId: 's000001', availableCount: 9 }],
    });
    expect(result.objectiveId).toBeNull();
    expect(result.success).toBeNull();
  });
});
describe('season objective measures', () => {
  it('win-six: succeeds with six wins, fails with five', () => {
    const sixWins = Array.from({ length: 10 }, (_, index) =>
      game(`s${String(index + 1).padStart(6, '0')}`, index < 6 ? 100 : 90, index < 6 ? 90 : 100),
    );
    const success = evaluate('win-six', sixWins, TEN_TIPS);
    expect(success.success).toBe(true);
    expect(success.evaluation.facts.wins).toBe(6);
    expect(success.evaluation.facts.games).toBe(10);
    const fiveWins = sixWins.map((summary, index) =>
      index === 0 ? game(summary.gameId, 90, 100) : summary,
    );
    const failure = evaluate('win-six', fiveWins, TEN_TIPS);
    expect(failure.success).toBe(false);
    expect(failure.evaluation.facts.wins).toBe(5);
  });
  it('win-six counts the official 2-0 result on forfeits', () => {
    const gamesList = Array.from({ length: 6 }, (_, index) =>
      game(`s${String(index + 1).padStart(6, '0')}`, 100, 90),
    );
    const forfeit = {
      ...game('s000007', 0, 0),
      status: 'forfeit' as const,
      homeScore: 0,
      awayScore: 2,
      forfeitLoserFranchiseId: franchiseIdSchema.parse(HUMAN),
    };
    const humanWonForfeit = {
      ...game('s000008', 2, 0),
      status: 'forfeit' as const,
      homeScore: 2,
      awayScore: 0,
      forfeitLoserFranchiseId: franchiseIdSchema.parse('celtics'),
    };
    const result = evaluate(
      'win-six',
      [...gamesList, forfeit, humanWonForfeit, ...gamesList.slice(0, 2)],
      TEN_TIPS,
    );
    expect(result.success).toBe(true);
    expect(result.evaluation.facts.wins).toBe(9);
  });
  it('defense-108: allows at most 1080 opponent box points', () => {
    const summaries = Array.from({ length: 10 }, (_, index) =>
      game(`s${String(index + 1).padStart(6, '0')}`, 100, 108),
    );
    expect(evaluate('defense-108', summaries, TEN_TIPS).success).toBe(true);
    const oneOver = summaries.map((summary, index) =>
      index === 9 ? game(summary.gameId, 100, 109) : summary,
    );
    const failure = evaluate('defense-108', oneOver, TEN_TIPS);
    expect(failure.success).toBe(false);
    expect(failure.evaluation.facts.pointsAllowed).toBe(1081);
  });
  it('rebound-plus-20: margin is human rebounds minus opponent rebounds', () => {
    const summaries = Array.from({ length: 10 }, (_, index) =>
      game(`s${String(index + 1).padStart(6, '0')}`, 100, 90, {
        humanRebounds: 46,
        opponentRebounds: 44,
      }),
    );
    const success = evaluate('rebound-plus-20', summaries, TEN_TIPS);
    expect(success.success).toBe(true);
    expect(success.evaluation.facts.reboundMargin).toBe(20);
    const failure = evaluate(
      'rebound-plus-20',
      summaries.map((summary, index) =>
        index === 0
          ? game(summary.gameId, 100, 90, { humanRebounds: 45, opponentRebounds: 44 })
          : summary,
      ),
      TEN_TIPS,
    );
    expect(failure.success).toBe(false);
    expect(failure.evaluation.facts.reboundMargin).toBe(19);
  });
  it('availability-eight: every counted tip needs 8+ available; forfeits excluded', () => {
    const summaries = Array.from({ length: 10 }, (_, index) =>
      game(`s${String(index + 1).padStart(6, '0')}`, 100, 90),
    );
    const success = evaluate('availability-eight', summaries, TEN_TIPS);
    expect(success.success).toBe(true);
    expect(success.evaluation.facts.tipsTotal).toBe(10);
    expect(success.evaluation.tipCountedGames).toBe(10);
    const oneShort = [{ gameId: 's000001', availableCount: 7 }, ...TEN_TIPS.slice(1)];
    const failure = evaluate('availability-eight', summaries, oneShort);
    expect(failure.success).toBe(false);
    expect(failure.evaluation.facts.tipsWithAtLeastEightAvailable).toBe(9);
    const forfeitSummary = {
      ...game('s000003', 0, 0),
      status: 'forfeit' as const,
      homeScore: 0,
      awayScore: 2,
      forfeitLoserFranchiseId: franchiseIdSchema.parse(HUMAN),
    };
    const withForfeit = summaries.map((summary, index) => (index === 2 ? forfeitSummary : summary));
    const tipsWithoutForfeit = TEN_TIPS.filter((tip) => tip.gameId !== 's000003');
    const forfeitRun = evaluate('availability-eight', withForfeit, tipsWithoutForfeit);
    expect(forfeitRun.evaluation.tipCountedGames).toBe(9);
    expect(forfeitRun.evaluation.facts.tipsTotal).toBe(9);
    expect(forfeitRun.success).toBe(true);
  });
  it('bench-320: non-starter seconds count; starters identified by rotation', () => {
    const summaries = Array.from({ length: 10 }, (_, index) =>
      game(`s${String(index + 1).padStart(6, '0')}`, 100, 90),
    );
    const result = evaluate('bench-320', summaries, TEN_TIPS);
    expect(result.evaluation.facts.benchMinutes).toBe(5 * 24 * 10);
    expect(result.success).toBe(true);
    const benchHeavy = summaries.map((summary) => ({
      ...summary,
      homePlayers: summary.homePlayers.map((line) =>
        ROTATION.benchOrder.includes(line.playerVersionId) ? { ...line, seconds: 1920 } : line,
      ),
    }));
    const heavy = evaluate('bench-320', benchHeavy, TEN_TIPS);
    expect(heavy.evaluation.facts.benchMinutes).toBe(5 * 32 * 10);
    expect(heavy.success).toBe(true);
    const noBench = summaries.map((summary) => ({
      ...summary,
      homePlayers: summary.homePlayers.map((line) =>
        ROTATION.benchOrder.includes(line.playerVersionId) ? { ...line, seconds: 0 } : line,
      ),
    }));
    const empty = evaluate('bench-320', noBench, TEN_TIPS);
    expect(empty.evaluation.facts.benchMinutes).toBe(0);
    expect(empty.success).toBe(false);
  });
  it('bench-320 floors fractional minutes from exact seconds', () => {
    const summaries = [
      game('s000001', 100, 90, {
        humanSeconds: { 'pv-f': 61, 'pv-g': 59, 'pv-h': 0, 'pv-i': 0, 'pv-j': 0 },
      }),
    ];
    const result = evaluate('bench-320', summaries, [{ gameId: 's000001', availableCount: 9 }]);
    expect(result.evaluation.facts.benchMinutes).toBe(2);
  });
  it('bench-320 ignores rotation starters with zero target minutes', () => {
    const zeroStarterRotation: SeasonRotation = {
      ...ROTATION,
      targetMinutes: ROTATION.targetMinutes.map((entry) =>
        entry.playerVersionId === 'pv-a' ? { ...entry, minutes: 0 } : entry,
      ),
    };
    const summaries = [game('s000001', 100, 90)];
    const result = evaluate(
      'bench-320',
      summaries,
      [{ gameId: 's000001', availableCount: 9 }],
      zeroStarterRotation,
    );
    expect(result.evaluation.facts.benchMinutes).toBe(6 * 24);
  });
  it('bench-320 measures zero when no rotation is supplied', () => {
    const summaries = [game('s000001', 100, 90)];
    const result = evaluate(
      'bench-320',
      summaries,
      [{ gameId: 's000001', availableCount: 9 }],
      null,
    );
    expect(result.evaluation.facts.benchMinutes).toBe(0);
  });
  it('turnover-130: at most 130 human turnovers', () => {
    const summaries = Array.from({ length: 10 }, (_, index) =>
      game(`s${String(index + 1).padStart(6, '0')}`, 100, 90, { humanTurnovers: 13 }),
    );
    const success = evaluate('turnover-130', summaries, TEN_TIPS);
    expect(success.success).toBe(true);
    expect(success.evaluation.facts.turnovers).toBe(130);
    const failure = evaluate(
      'turnover-130',
      summaries.map((summary, index) =>
        index === 9 ? game(summary.gameId, 100, 90, { humanTurnovers: 14 }) : summary,
      ),
      TEN_TIPS,
    );
    expect(failure.success).toBe(false);
    expect(failure.evaluation.facts.turnovers).toBe(131);
  });
  it('records every fact from the summaries and never invents numbers', () => {
    const summaries = Array.from({ length: 10 }, (_, index) =>
      game(`s${String(index + 1).padStart(6, '0')}`, 100 + index, 90 + index, {
        humanTurnovers: 12,
      }),
    );
    const result = evaluate('defense-108', summaries, TEN_TIPS);
    const facts = result.evaluation.facts;
    expect(facts.games).toBe(10);
    expect(facts.pointsAllowed).toBe(
      summaries.reduce((sum, summary) => sum + summary.awayBox.points, 0),
    );
    expect(facts.reboundMargin).toBe(
      summaries.reduce(
        (sum, summary) =>
          sum +
          summary.homeBox.offensiveRebounds +
          summary.homeBox.defensiveRebounds -
          summary.awayBox.offensiveRebounds -
          summary.awayBox.defensiveRebounds,
        0,
      ),
    );
    expect(facts.turnovers).toBe(
      summaries.reduce((sum, summary) => sum + summary.homeBox.turnovers, 0),
    );
    expect(result.evaluation.blockIndex).toBe(BLOCK);
  });
});
describe('season objective choices', () => {
  it('is deterministic per (seed, block) and stable across calls', () => {
    const seed = 'a1b2c3d4e5f60718293a4b5c6d7e8f9a';
    const first = seasonObjectiveChoicesForBlock(seed, 2);
    const second = seasonObjectiveChoicesForBlock(seed, 2);
    expect(first).toEqual(second);
    expect(first).toHaveLength(3);
  });
  it('offers three distinct catalog objectives', () => {
    const seed = 'a1b2c3d4e5f60718293a4b5c6d7e8f9a';
    const catalogIds = seasonObjectiveCatalog().map((entry) => entry.objectiveId);
    for (let blockIndex = 0; blockIndex < 8; blockIndex += 1) {
      const choices = seasonObjectiveChoicesForBlock(seed, blockIndex);
      expect(new Set(choices).size).toBe(3);
      for (const choice of choices) {
        expect(catalogIds).toContain(choice);
      }
    }
  });
  it('varies the trio across blocks and seeds', () => {
    const seed = 'a1b2c3d4e5f60718293a4b5c6d7e8f9a';
    const otherSeed = 'c0ffee2026a1b2c3d4e5f60718293a4b';
    const blockTrio = seasonObjectiveChoicesForBlock(seed, 0);
    const nextBlockTrio = seasonObjectiveChoicesForBlock(seed, 1);
    const otherSeedTrio = seasonObjectiveChoicesForBlock(otherSeed, 0);
    expect(blockTrio).not.toEqual(nextBlockTrio);
    expect(blockTrio).not.toEqual(otherSeedTrio);
  });
});
