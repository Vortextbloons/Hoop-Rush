import { describe, expect, it } from 'bun:test';
import type {
  CapRushCard,
  CapRushDraftPick,
  CapRushSourcePlayer,
  SeasonDraftCatalog,
} from '@hoop-rush/data-contracts';
import { CAP_RUSH_HARD_LIMIT_DOLLARS, POSITIONS } from '@hoop-rush/data-contracts';
import { buildCapRushTestCatalog, capRushTestCatalogSource } from '@hoop-rush/test-fixtures';
import {
  adaptCapRushCatalog,
  buildCapRushCatalogIndex,
  type CapRushCatalogIndex,
} from './catalog.ts';
import {
  assertCapRushCatalogCoverage,
  capRushAssessSigning,
  capRushCatalogCoverageIssues,
  capRushMinimumCompletionPayroll,
} from './feasibility.ts';
import { capRushSalaryDollars } from './salary.ts';

function testIndex(catalog: SeasonDraftCatalog = buildCapRushTestCatalog()): CapRushCatalogIndex {
  return buildCapRushCatalogIndex(adaptCapRushCatalog(catalog, capRushTestCatalogSource(catalog)));
}

function playerOf(index: CapRushCatalogIndex, slot: string, overall: number): CapRushSourcePlayer {
  const player = [...index.byPlayerId.values()]
    .flat()
    .find((entry) => entry.positions.includes(slot as never) && entry.originalOverall === overall);
  if (player === undefined) throw new Error(`missing ${slot} ${String(overall)}`);
  return player;
}

function cardOf(player: CapRushSourcePlayer, slot: string): CapRushCard {
  return {
    cardId: `crc-${'a'.repeat(32)}`,
    offerId: `cro-${'b'.repeat(32)}`,
    cardIndex: 0,
    slot: slot as CapRushCard['slot'],
    bucket: 'budget',
    source: player,
    salaryDollars: capRushSalaryDollars(player.originalOverall, player.seasonKey),
  };
}

function picksOf(
  index: CapRushCatalogIndex,
  entries: ReadonlyArray<{ slot: string; overall: number }>,
): CapRushDraftPick[] {
  return entries.map((entry, pickOrdinal) => ({
    pickOrdinal,
    slot: entry.slot as CapRushDraftPick['slot'],
    card: cardOf(playerOf(index, entry.slot, entry.overall), entry.slot),
  }));
}

describe('cap rush catalog coverage', () => {
  it('accepts the packaged-shape fixture coverage', () => {
    expect(capRushCatalogCoverageIssues(testIndex())).toEqual([]);
    expect(() => assertCapRushCatalogCoverage(testIndex())).not.toThrow();
  });

  it('reports a missing generation band per exact position', () => {
    const catalog = buildCapRushTestCatalog({
      overalls: [89, 86, 83, 81, 80, 79, 77, 75, 74, 70, 68, 65, 62, 60],
    });
    const issues = capRushCatalogCoverageIssues(testIndex(catalog));
    expect(issues.length).toBeGreaterThan(0);
    expect(issues.every((issue) => issue.slot !== null)).toBe(true);
    expect(issues.some((issue) => issue.slot === 'PG' && issue.message.includes('star'))).toBe(
      true,
    );
  });

  it('rejects a catalog whose cheapest legal lineup is over the hard limit', () => {
    const catalog = buildCapRushTestCatalog({
      positions: ['PG', 'SG', 'SF', 'PF', 'C'],
      overalls: [99, 98, 97, 95, 96],
    });
    const issues = capRushCatalogCoverageIssues(testIndex(catalog));
    expect(issues.some((issue) => issue.message.includes('hard limit'))).toBe(true);
    expect(() => assertCapRushCatalogCoverage(testIndex(catalog))).toThrow();
  });
});

describe('cap rush completion matching', () => {
  it('uses the cheapest distinct person for every open slot', () => {
    const index = testIndex();
    expect(
      capRushMinimumCompletionPayroll({
        index,
        signedPlayerIds: new Set(),
        slots: POSITIONS,
      }),
    ).toBe(17_250_000);
  });

  it('never counts one multi-position person twice', () => {
    const catalog = buildCapRushTestCatalog({
      positions: ['PG', 'SG', 'C'],
      extraPlayers: [{ positions: ['SF', 'PF'], overall: 60 }],
    });
    expect(
      capRushMinimumCompletionPayroll({
        index: testIndex(catalog),
        signedPlayerIds: new Set(),
        slots: ['SF', 'PF'],
      }),
    ).toBeNull();
  });

  it('fills both forward slots with two distinct multi-position people', () => {
    const catalog = buildCapRushTestCatalog({
      positions: ['PG', 'SG', 'C'],
      extraPlayers: [
        { positions: ['SF', 'PF'], overall: 60 },
        { positions: ['SF', 'PF'], overall: 62 },
      ],
    });
    expect(
      capRushMinimumCompletionPayroll({
        index: testIndex(catalog),
        signedPlayerIds: new Set(),
        slots: ['SF', 'PF'],
      }),
    ).toBe(7_360_000);
  });

  it('excludes already signed people from the completion pool', () => {
    const index = testIndex();
    const cheapestPg = playerOf(index, 'PG', 60);
    expect(
      capRushMinimumCompletionPayroll({
        index,
        signedPlayerIds: new Set([cheapestPg.playerId]),
        slots: ['PG'],
      }),
    ).toBe(capRushSalaryDollars(62, '1995-96'));
  });
});

describe('cap rush budget-safe signing', () => {
  it('accepts a signing whose cheapest completion fits the hard limit', () => {
    const index = testIndex();
    const picks = picksOf(index, [
      { slot: 'C', overall: 99 },
      { slot: 'SG', overall: 92 },
      { slot: 'SF', overall: 86 },
    ]);
    const card = cardOf(playerOf(index, 'PG', 60), 'PG');
    const assessment = capRushAssessSigning({ picks }, index, card);
    expect(assessment.legal).toBe(true);
    expect(assessment.payrollAfterSigning).toBe(146_510_000);
    expect(assessment.minimumCompletionPayroll).toBe(3_450_000);
    expect(assessment.projectedPayroll).toBe(149_960_000);
  });

  it('rejects a signing whose completion would exceed the hard limit', () => {
    const index = testIndex();
    const picks = picksOf(index, [
      { slot: 'C', overall: 99 },
      { slot: 'SG', overall: 92 },
      { slot: 'SF', overall: 86 },
    ]);
    const card = cardOf(playerOf(index, 'PG', 62), 'PG');
    const assessment = capRushAssessSigning({ picks }, index, card);
    expect(assessment.legal).toBe(false);
    expect(assessment.reason).toBe('completion');
    expect(assessment.payrollAfterSigning + (assessment.minimumCompletionPayroll ?? 0)).toBe(
      150_420_000,
    );
    expect(
      assessment.payrollAfterSigning + (assessment.minimumCompletionPayroll ?? 0),
    ).toBeGreaterThan(CAP_RUSH_HARD_LIMIT_DOLLARS);
  });

  it('rejects a signing that alone breaks the hard limit', () => {
    const index = testIndex();
    const picks = picksOf(index, [
      { slot: 'C', overall: 99 },
      { slot: 'SG', overall: 95 },
      { slot: 'SF', overall: 90 },
      { slot: 'PF', overall: 89 },
    ]);
    const card = cardOf(playerOf(index, 'PG', 70), 'PG');
    const assessment = capRushAssessSigning({ picks }, index, card);
    expect(assessment.legal).toBe(false);
    expect(assessment.reason).toBe('hard-limit');
  });

  it('rejects a signing that leaves no matching for the remaining slots', () => {
    const catalog = buildCapRushTestCatalog({
      positions: ['PG', 'SG', 'C'],
      extraPlayers: [{ positions: ['SF', 'PF'], overall: 60 }],
    });
    const index = testIndex(catalog);
    const picks = picksOf(index, [
      { slot: 'PG', overall: 60 },
      { slot: 'SG', overall: 62 },
      { slot: 'C', overall: 65 },
    ]);
    const forward = playerOf(index, 'SF', 60);
    const assessment = capRushAssessSigning({ picks }, index, cardOf(forward, 'SF'));
    expect(assessment.legal).toBe(false);
    expect(assessment.reason).toBe('no-completion');
  });
});
