import { describe, expect, it } from 'bun:test';
import type { FullCourtDraftState } from '@hoop-rush/data-contracts';
import {
  FULL_COURT_DEFAULT_MONEY,
  POSITIONS,
  SIMULATION_RATINGS,
  fullCourtCrAmount,
  fullCourtDraftStateSchema,
  fullCourtMoneyConfigSchema,
  playerVersionId,
  seasonKeySchema,
} from '@hoop-rush/data-contracts';
import { buildCapRushTestCatalog, capRushTestCatalogSource } from '@hoop-rush/test-fixtures';
import {
  fullCourtAbsenceTolerance,
  fullCourtAssessPick,
  fullCourtDepthForecast,
  fullCourtEffectiveRatings,
  fullCourtPayrollDollars,
  fullCourtPayrollStatus,
  fullCourtWarChestDollars,
} from './draft-economy.ts';
import {
  fullCourtCheapestPeople,
  fullCourtDraftIndexOf,
  fullCourtMinimumCompletionDollars,
  fullCourtPlayerOf,
  fullCourtSalaryDollarsOf,
} from './draft-catalog.ts';
import { fullCourtTestSetup, type FullCourtTestSetup } from './draft-test-support.ts';

function money(overrides: Partial<typeof FULL_COURT_DEFAULT_MONEY> = {}) {
  return fullCourtMoneyConfigSchema.parse({ ...FULL_COURT_DEFAULT_MONEY, ...overrides });
}

/** An explicit money scale, so each rejection path is reachable with fixture salaries. */
function scale(config: {
  capLineDollars: number;
  firstApronDollars: number;
  hardLimitDollars: number;
  startingWarChestDollars?: number;
}) {
  return fullCourtMoneyConfigSchema.parse({
    moneyVersion: FULL_COURT_DEFAULT_MONEY.moneyVersion,
    startingWarChestDollars: 500_000_000,
    ...config,
  });
}

function playerAt(setup: FullCourtTestSetup, slot: string, overall: number) {
  const player = (setup.index.bySlot.get(slot as never) ?? []).find(
    (entry) => entry.originalOverall === overall,
  );
  if (player === undefined) throw new Error(`missing ${slot} ${String(overall)}`);
  return player;
}

function picksOf(
  setup: FullCourtTestSetup,
  entries: ReadonlyArray<{ slot: string; overall: number }>,
) {
  return entries.map((entry, pickOrdinal) => {
    const player = playerAt(setup, entry.slot, entry.overall);
    return {
      pickOrdinal,
      player,
      salaryDollars: fullCourtSalaryDollarsOf(player),
    };
  });
}

function stateWith(
  setup: FullCourtTestSetup,
  entries: ReadonlyArray<{ slot: string; overall: number }>,
  config = FULL_COURT_DEFAULT_MONEY,
): FullCourtDraftState {
  const picks = picksOf(setup, entries);
  return fullCourtDraftStateSchema.parse({
    ...setup.state,
    pool: undefined,
    money: config,
    picks,
    spending: picks.map((pick) => ({
      entryId: `fcs-${String(pick.pickOrdinal + 1).repeat(32)}`,
      kind: 'salary',
      dollars: pick.salaryDollars,
      commandId: `cmd-salary-${String(pick.pickOrdinal)}`,
      playerVersionId: pick.player.playerVersionId,
    })),
  });
}

describe('full court money', () => {
  it('pins integer defaults with ordered thresholds and an independent War Chest', () => {
    const config = FULL_COURT_DEFAULT_MONEY;
    for (const value of [
      config.capLineDollars,
      config.firstApronDollars,
      config.hardLimitDollars,
      config.startingWarChestDollars,
    ]) {
      expect(Number.isInteger(value)).toBe(true);
    }
    expect(config.capLineDollars).toBeLessThan(config.firstApronDollars);
    expect(config.firstApronDollars).toBeLessThan(config.hardLimitDollars);
    expect(config.startingWarChestDollars).toBeGreaterThan(0);
  });

  it('rejects a money config whose thresholds are out of order', () => {
    expect(() =>
      fullCourtMoneyConfigSchema.parse({
        ...FULL_COURT_DEFAULT_MONEY,
        capLineDollars: FULL_COURT_DEFAULT_MONEY.firstApronDollars + 1,
      }),
    ).toThrow();
    expect(() =>
      fullCourtMoneyConfigSchema.parse({
        ...FULL_COURT_DEFAULT_MONEY,
        firstApronDollars: FULL_COURT_DEFAULT_MONEY.hardLimitDollars + 1,
      }),
    ).toThrow();
  });

  it('derives apron status from payroll alone using the pinned thresholds', () => {
    const config = money({ capLineDollars: 100_000_000, firstApronDollars: 120_000_000 });
    expect(fullCourtPayrollStatus(config.capLineDollars, config)).toBe('under-cap');
    expect(fullCourtPayrollStatus(config.capLineDollars + 1, config)).toBe('first-apron');
    expect(fullCourtPayrollStatus(config.firstApronDollars + 1, config)).toBe('second-apron');
    expect(fullCourtPayrollStatus(config.hardLimitDollars + 1, config)).toBe('illegal');
    expect(() => fullCourtPayrollStatus(1.5, config)).toThrow();
    expect(() => fullCourtPayrollStatus(-1, config)).toThrow();
  });

  it('reuses the Cap Rush apron reduction tables', () => {
    expect(fullCourtEffectiveRatings(SIMULATION_RATINGS, 'under-cap')).toEqual(SIMULATION_RATINGS);
    expect(fullCourtEffectiveRatings(SIMULATION_RATINGS, 'first-apron').passing).toBe(
      SIMULATION_RATINGS.passing - 3,
    );
    expect(fullCourtEffectiveRatings(SIMULATION_RATINGS, 'second-apron').passing).toBe(
      SIMULATION_RATINGS.passing - 8,
    );
  });

  it('converts War Chest dollars into CR with one fixed unit', () => {
    expect(fullCourtCrAmount(145_000_000)).toBe(145);
    expect(fullCourtCrAmount(0)).toBe(0);
    expect(() => fullCourtCrAmount(1.5)).toThrow();
    expect(() => fullCourtCrAmount(-1)).toThrow();
  });

  it('pins defaults against the measured real-catalog build costs', () => {
    // Payrolls measured from the packaged catalog using each real player's cheapest version.
    const twelveBudget = 65_093_000;
    const twelveDepth = 171_630_000;
    const eightCompetitive = 232_323_000;
    const sixStarHeavy = 428_490_000;
    const config = FULL_COURT_DEFAULT_MONEY;
    expect(twelveBudget).toBeLessThan(config.capLineDollars);
    expect(twelveDepth).toBeLessThan(config.capLineDollars);
    expect(eightCompetitive).toBeGreaterThan(config.capLineDollars);
    expect(eightCompetitive).toBeLessThan(config.hardLimitDollars);
    expect(sixStarHeavy).toBeGreaterThan(config.hardLimitDollars);
  });
});

describe('full court catalog completion cost', () => {
  it('prices one entry per real player at their cheapest catalog season', () => {
    const catalog = buildCapRushTestCatalog();
    const index = fullCourtDraftIndexOf(catalog, capRushTestCatalogSource(catalog));
    const people = fullCourtCheapestPeople(index);
    expect(people.length).toBe(index.playerIds.length);
    expect(new Set(people.map((person) => person.playerId)).size).toBe(people.length);
    for (let ordinal = 1; ordinal < people.length; ordinal += 1) {
      const previous = people[ordinal - 1];
      const current = people[ordinal];
      if (previous === undefined || current === undefined) throw new Error('missing person');
      expect(previous.salaryDollars).toBeLessThanOrEqual(current.salaryDollars);
    }
  });

  it('sums the cheapest distinct people for six and twelve open places', () => {
    const setup = fullCourtTestSetup();
    expect(fullCourtMinimumCompletionDollars(setup.index, new Set(), 6)).toBe(20_105_000);
    expect(fullCourtMinimumCompletionDollars(setup.index, new Set(), 12)).toBe(43_705_000);
    expect(fullCourtMinimumCompletionDollars(setup.index, new Set(), 0)).toBe(0);
  });

  it('excludes current picks from the completion pool and never repeats a person', () => {
    const setup = fullCourtTestSetup();
    const cheapest = fullCourtCheapestPeople(setup.index);
    const first = cheapest[0];
    const second = cheapest[1];
    if (first === undefined || second === undefined) throw new Error('missing cheapest people');
    expect(fullCourtMinimumCompletionDollars(setup.index, new Set([first.playerId]), 1)).toBe(
      second.salaryDollars,
    );
    expect(fullCourtMinimumCompletionDollars(setup.index, new Set(), 1_000_000)).toBeNull();
  });

  it('forecasts the required completion before six picks and one depth player afterwards', () => {
    const setup = fullCourtTestSetup();
    const five = stateWith(
      setup,
      POSITIONS.map((slot) => ({ slot, overall: 60 })),
    );
    expect(fullCourtDepthForecast({ index: setup.index, state: five })).toEqual({
      costDollars: 3_715_000,
      missingPlayers: 1,
    });
    const six = stateWith(setup, [
      ...POSITIONS.map((slot) => ({ slot, overall: 60 })),
      { slot: 'PG', overall: 62 },
    ]);
    expect(fullCourtDepthForecast({ index: setup.index, state: six })).toEqual({
      costDollars: 3_715_000,
      missingPlayers: 0,
    });
    expect(
      fullCourtDepthForecast({ index: setup.index, state: { ...six, stage: 'complete' } }),
    ).toEqual({ costDollars: null, missingPlayers: 0 });
  });

  it('reports simultaneous absences the roster can absorb', () => {
    expect(fullCourtAbsenceTolerance(5)).toBe(0);
    expect(fullCourtAbsenceTolerance(6)).toBe(1);
    expect(fullCourtAbsenceTolerance(12)).toBe(7);
  });
});

describe('full court pick affordability', () => {
  it('accepts a pick whose cheapest completion keeps payroll under the hard limit', () => {
    const setup = fullCourtTestSetup();
    const state = stateWith(setup, [{ slot: 'PG', overall: 99 }]);
    const player = playerAt(setup, 'SG', 60);
    const salaryDollars = fullCourtSalaryDollarsOf(player);
    const assessment = fullCourtAssessPick({
      index: setup.index,
      state,
      playerId: player.playerId,
      salaryDollars,
    });
    expect(assessment.legal).toBe(true);
    expect(assessment.payrollAfterPick).toBe(75_383_000);
    expect(assessment.minimumCompletionDollars).toBe(13_112_000);
    expect(assessment.projectedPayroll).toBe(88_495_000);
    expect(assessment.warChestAfterPick).toBe(
      FULL_COURT_DEFAULT_MONEY.startingWarChestDollars - 75_383_000,
    );
  });

  it('rejects a pick that leaves payroll room short of the cheapest completion', () => {
    const setup = fullCourtTestSetup();
    const config = scale({
      capLineDollars: 80_000_000,
      firstApronDollars: 82_000_000,
      hardLimitDollars: 85_000_000,
    });
    const state = stateWith(setup, [], config);
    const player = playerAt(setup, 'PG', 99);
    const assessment = fullCourtAssessPick({
      index: setup.index,
      state,
      playerId: player.playerId,
      salaryDollars: fullCourtSalaryDollarsOf(player),
    });
    expect(assessment.legal).toBe(false);
    expect(assessment.reason).toBe('completion');
    expect(assessment.payrollAfterPick).toBe(72_105_000);
    expect(assessment.minimumCompletionDollars).toBe(16_390_000);
    expect(assessment.projectedPayroll).toBe(88_495_000);
  });

  it('rejects a pick the War Chest cannot cover, independently of the hard limit', () => {
    const setup = fullCourtTestSetup();
    const config = money({ startingWarChestDollars: 80_000_000 });
    const state = stateWith(setup, [], config);
    const player = playerAt(setup, 'PG', 99);
    const assessment = fullCourtAssessPick({
      index: setup.index,
      state,
      playerId: player.playerId,
      salaryDollars: fullCourtSalaryDollarsOf(player),
    });
    expect(assessment.legal).toBe(false);
    expect(assessment.reason).toBe('cash');
    expect(assessment.warChestAfterPick).toBe(7_895_000);
    expect(assessment.minimumCompletionDollars).toBe(16_390_000);
    expect(assessment.projectedPayroll).toBe(88_495_000);
    expect(assessment.projectedPayroll).toBeLessThan(FULL_COURT_DEFAULT_MONEY.hardLimitDollars);
  });

  it('rejects a pick past the hard limit even with a large War Chest', () => {
    const setup = fullCourtTestSetup();
    const config = scale({
      capLineDollars: 82_000_000,
      firstApronDollars: 90_000_000,
      hardLimitDollars: 140_000_000,
    });
    const state = stateWith(
      setup,
      [
        { slot: 'PG', overall: 99 },
        { slot: 'SG', overall: 98 },
      ],
      config,
    );
    const player = playerAt(setup, 'SF', 96);
    const assessment = fullCourtAssessPick({
      index: setup.index,
      state,
      playerId: player.playerId,
      salaryDollars: fullCourtSalaryDollarsOf(player),
    });
    expect(assessment.legal).toBe(false);
    expect(assessment.reason).toBe('hard-limit');
    expect(assessment.warChestAfterPick).toBeGreaterThan(0);
  });

  it('stops reserving completion payroll once six picks are secured', () => {
    const setup = fullCourtTestSetup();
    const config = scale({
      capLineDollars: 60_000_000,
      firstApronDollars: 70_000_000,
      hardLimitDollars: 100_000_000,
    });
    const six = stateWith(
      setup,
      [...POSITIONS.map((slot) => ({ slot, overall: 60 })), { slot: 'PG', overall: 62 }],
      config,
    );
    const target = playerAt(setup, 'C', 99);
    const assessment = fullCourtAssessPick({
      index: setup.index,
      state: six,
      playerId: target.playerId,
      salaryDollars: fullCourtSalaryDollarsOf(target),
    });
    expect(assessment.legal).toBe(true);
    expect(assessment.minimumCompletionDollars).toBeNull();
    expect(assessment.projectedPayroll).toBeNull();
    expect(assessment.payrollAfterPick).toBe(20_105_000 + 72_105_000);
    expect(fullCourtDepthForecast({ index: setup.index, state: six }).missingPlayers).toBe(0);
  });
});

describe('full court roster state totals', () => {
  it('keeps payroll and War Chest integer and independent', () => {
    const setup = fullCourtTestSetup();
    const config = money({
      capLineDollars: 150_000_000,
      firstApronDollars: 155_000_000,
      hardLimitDollars: 160_000_000,
      startingWarChestDollars: 200_000_000,
    });
    const state = stateWith(
      setup,
      [
        { slot: 'PG', overall: 99 },
        { slot: 'SG', overall: 98 },
        { slot: 'SF', overall: 60 },
        { slot: 'PF', overall: 60 },
        { slot: 'C', overall: 60 },
        { slot: 'PG', overall: 62 },
      ],
      config,
    );
    const payroll = fullCourtPayrollDollars(state.picks);
    expect(payroll).toBe(151_204_000);
    expect(Number.isInteger(payroll)).toBe(true);
    expect(fullCourtWarChestDollars(state)).toBe(config.startingWarChestDollars - payroll);
    expect(fullCourtPayrollStatus(payroll, config)).toBe('first-apron');
  });

  it('rejects a state that pays one real player twice through two versions', () => {
    const catalog = buildCapRushTestCatalog();
    const source = capRushTestCatalogSource(catalog);
    const candidate = catalog.candidates[0];
    if (candidate === undefined) throw new Error('missing candidate');
    const secondVersion = {
      ...candidate,
      playerVersionId: playerVersionId(
        candidate.playerId,
        candidate.franchiseId,
        candidate.eraId,
        '1996-97',
      ),
      seasonKey: seasonKeySchema.parse('1996-97'),
    };
    const index = fullCourtDraftIndexOf(
      { ...catalog, candidates: [...catalog.candidates, secondVersion] },
      source,
    );
    const first = fullCourtPlayerOf(index, candidate.playerVersionId);
    const second = fullCourtPlayerOf(index, secondVersion.playerVersionId);
    if (first === null || second === null) throw new Error('missing adapted player');
    const salaryDollars = fullCourtSalaryDollarsOf(first);
    expect(
      fullCourtDraftStateSchema.safeParse({
        ...fullCourtTestSetup().state,
        money: money({ startingWarChestDollars: 500_000_000 }),
        picks: [
          { pickOrdinal: 0, player: first, salaryDollars },
          { pickOrdinal: 1, player: second, salaryDollars },
        ],
        spending: [
          {
            entryId: `fcs-${'1'.repeat(32)}`,
            kind: 'salary',
            dollars: salaryDollars,
            commandId: 'cmd-salary-0',
            playerVersionId: first.playerVersionId,
          },
          {
            entryId: `fcs-${'2'.repeat(32)}`,
            kind: 'salary',
            dollars: salaryDollars,
            commandId: 'cmd-salary-1',
            playerVersionId: second.playerVersionId,
          },
        ],
      }).success,
    ).toBe(false);
  });

  it('rejects a state whose salary entries do not match its picks', () => {
    const setup = fullCourtTestSetup();
    const state = stateWith(setup, [{ slot: 'PG', overall: 60 }]);
    expect(
      fullCourtDraftStateSchema.safeParse({
        ...state,
        spending: state.spending.map((entry) => ({ ...entry, dollars: entry.dollars + 1_000 })),
      }).success,
    ).toBe(false);
  });

  it('rejects more than twelve picks and a short confirmed roster', () => {
    const setup = fullCourtTestSetup();
    const thirteen = picksOf(
      setup,
      Array.from({ length: 13 }, (_, ordinal) => ({
        slot: POSITIONS[ordinal % POSITIONS.length] ?? 'PG',
        overall: 60,
      })),
    );
    expect(
      fullCourtDraftStateSchema.safeParse({
        ...setup.state,
        money: money({ startingWarChestDollars: 500_000_000 }),
        stage: 'complete',
        picks: thirteen,
        spending: thirteen.map((pick, pickOrdinal) => ({
          entryId: `fcs-${String(pickOrdinal + 1).padStart(32, '0')}`,
          kind: 'salary',
          dollars: pick.salaryDollars,
          commandId: `cmd-salary-${String(pickOrdinal)}`,
          playerVersionId: pick.player.playerVersionId,
        })),
      }).success,
    ).toBe(false);

    const five = stateWith(
      setup,
      POSITIONS.map((slot) => ({ slot, overall: 60 })),
    );
    expect(fullCourtDraftStateSchema.safeParse({ ...five, stage: 'complete' }).success).toBe(false);
  });
});
