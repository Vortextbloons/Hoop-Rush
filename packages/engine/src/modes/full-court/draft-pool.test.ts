import { describe, expect, it } from 'bun:test';
import {
  FULL_COURT_DEFAULT_MONEY,
  FULL_COURT_POOL_MAX_SIZE,
  FULL_COURT_POOL_MIN_SIZE,
  FULL_COURT_POOL_VERSION,
  POSITIONS,
  fullCourtMoneyConfigSchema,
} from '@hoop-rush/data-contracts';
import { buildCapRushTestCatalog, capRushTestCatalogSource } from '@hoop-rush/test-fixtures';
import {
  fullCourtDraftIndexOf,
  fullCourtEligibleCandidates,
  fullCourtSalaryDollarsOf,
} from './draft-catalog.ts';
import { createFullCourtDraftPool } from './draft-pool.ts';

describe('createFullCourtDraftPool', () => {
  it('builds a deterministic versioned 60-90 distinct-player pool with broad OVR, position, and 95+ star coverage', () => {
    const catalog = buildCapRushTestCatalog();
    const index = fullCourtDraftIndexOf(catalog, capRushTestCatalogSource(catalog));
    const first = createFullCourtDraftPool({
      runSeed: '0123456789abcdef',
      index,
      money: FULL_COURT_DEFAULT_MONEY,
    });
    const second = createFullCourtDraftPool({
      runSeed: '0123456789abcdef',
      index,
      money: FULL_COURT_DEFAULT_MONEY,
    });
    const different = createFullCourtDraftPool({
      runSeed: 'fedcba9876543210',
      index,
      money: FULL_COURT_DEFAULT_MONEY,
    });

    expect(first).toEqual(second);
    expect(first.poolVersion).toBe(FULL_COURT_POOL_VERSION);
    expect(first.playerVersionIds.length).toBeGreaterThanOrEqual(FULL_COURT_POOL_MIN_SIZE);
    expect(first.playerVersionIds.length).toBeLessThanOrEqual(FULL_COURT_POOL_MAX_SIZE);
    expect(different.playerVersionIds).not.toEqual(first.playerVersionIds);

    const players = fullCourtEligibleCandidates(index, { pool: first });
    expect(new Set(players.map((p) => p.playerId)).size).toBe(players.length);
    expect(players[0]?.originalOverall).toBeGreaterThanOrEqual(95);
    expect(Math.min(...players.map((p) => p.originalOverall))).toBeLessThan(68);
    for (const position of POSITIONS) {
      expect(players.some((p) => p.positions.includes(position))).toBe(true);
    }

    const salaries = players.map((p) => fullCourtSalaryDollarsOf(p)).sort((a, b) => a - b);
    const cheapestSix = salaries.slice(0, 6).reduce((sum, salary) => sum + salary, 0);
    expect(cheapestSix).toBeLessThanOrEqual(FULL_COURT_DEFAULT_MONEY.hardLimitDollars);
    expect(cheapestSix).toBeLessThanOrEqual(FULL_COURT_DEFAULT_MONEY.startingWarChestDollars);
  });

  it('degrades gracefully when a catalog has no 95+ OVR players', () => {
    const catalog = buildCapRushTestCatalog({ overalls: [88, 84, 80, 76, 72, 68, 64, 60] });
    const index = fullCourtDraftIndexOf(catalog, capRushTestCatalogSource(catalog));
    const pool = createFullCourtDraftPool({
      runSeed: 'no-95-plus-seed',
      index,
      money: FULL_COURT_DEFAULT_MONEY,
    });

    expect(pool.playerVersionIds).toHaveLength(40);
    const players = fullCourtEligibleCandidates(index, { pool });
    expect(Math.max(...players.map((p) => p.originalOverall))).toBe(88);
  });

  it('guarantees pool affordability when default random sampling would exceed a tight budget', () => {
    const catalog = buildCapRushTestCatalog({
      overalls: [98, 96, 92, 90, 88, 86, 84, 82, 80, 78, 76, 74, 72, 70, 60],
    });
    const index = fullCourtDraftIndexOf(catalog, capRushTestCatalogSource(catalog));
    const tightMoney = fullCourtMoneyConfigSchema.parse({
      ...FULL_COURT_DEFAULT_MONEY,
      capLineDollars: 80_000_000,
      firstApronDollars: 85_000_000,
      hardLimitDollars: 90_000_000,
      startingWarChestDollars: 90_000_000,
    });
    const pool = createFullCourtDraftPool({
      runSeed: 'tight-budget-seed',
      index,
      money: tightMoney,
    });
    const players = fullCourtEligibleCandidates(index, { pool });
    const star = players[0];
    if (star === undefined) throw new Error('Expected the draft pool to contain a franchise star');
    expect(star.originalOverall).toBeGreaterThanOrEqual(95);
    const cheapestFive = players
      .slice(1)
      .map(fullCourtSalaryDollarsOf)
      .sort((a, b) => a - b)
      .slice(0, 5)
      .reduce((sum, salary) => sum + salary, 0);
    expect(fullCourtSalaryDollarsOf(star) + cheapestFive).toBeLessThanOrEqual(90_000_000);
  });
});
