import { describe, expect, it } from 'bun:test';
import { CAP_RUSH_GAME_COUNT, POSITIONS } from '@hoop-rush/data-contracts';
import type { CapRushDraftPick, CapRushStoredGame } from '@hoop-rush/data-contracts';
import { capRushCardSchema, capRushOfferIdSchema } from '@hoop-rush/data-contracts';
import { createEngineContext } from '../../sim/kernel.ts';
import { capRushTestSetup } from './cap-rush-test-support.ts';
import { buildCapRushLockedInputs } from './lock.ts';
import {
  capRushEmptyAggregate,
  capRushFoldAggregate,
  capRushStoredGameOf,
  simulateCapRushGame,
} from './season.ts';
import { capRushReport, capRushWinsPerMillion } from './report.ts';
import { buildCapRushSpinReceipt } from './spin.ts';

const UNDER_CAP = [10_000_000, 10_000_000, 10_000_000, 10_000_000, 10_000_000];

function buildLocked(salaries: readonly number[], variant: 'clash' | 'roulette' = 'clash') {
  const setup = capRushTestSetup();
  const picks: CapRushDraftPick[] = POSITIONS.map((slot, index) => {
    const player = setup.index.bySlot.get(slot)?.[0];
    if (player === undefined) throw new Error(`missing ${slot}`);
    return {
      pickOrdinal: index,
      slot,
      card: capRushCardSchema.parse({
        cardId: `crc-${String(index).repeat(32)}`,
        offerId: capRushOfferIdSchema.parse(`cro-${'0'.repeat(32)}`),
        cardIndex: index,
        slot,
        bucket: 'budget',
        source: player,
        salaryDollars: salaries[index] ?? 0,
      }),
    };
  });
  return buildCapRushLockedInputs({
    runId: setup.state.runId,
    runSeed: setup.state.runSeed,
    variant,
    versionSet: setup.state.versionSet,
    catalog: setup.state.catalog,
    picks,
    spin: null,
    bracket: setup.lockSources.bracket,
    profile: setup.lockSources.profile,
  });
}

function buildSpunLocked(setup: ReturnType<typeof capRushTestSetup>, salaries: readonly number[]) {
  const picks: CapRushDraftPick[] = POSITIONS.map((slot, index) => {
    const player = setup.index.bySlot.get(slot)?.[0];
    if (player === undefined) throw new Error(`missing ${slot}`);
    return {
      pickOrdinal: index,
      slot,
      card: capRushCardSchema.parse({
        cardId: `crc-${String(index).repeat(32)}`,
        offerId: capRushOfferIdSchema.parse(`cro-${'0'.repeat(32)}`),
        cardIndex: index,
        slot,
        bucket: 'budget',
        source: player,
        salaryDollars: salaries[index] ?? 0,
      }),
    };
  });
  const receipt = buildCapRushSpinReceipt({
    runSeed: setup.state.runSeed,
    purchase: 'standard',
    payrollDollars: picks.reduce((total, pick) => total + pick.card.salaryDollars, 0),
    pick: picks[2] as CapRushDraftPick,
  });
  return buildCapRushLockedInputs({
    runId: setup.state.runId,
    runSeed: setup.state.runSeed,
    variant: 'roulette',
    versionSet: setup.state.versionSet,
    catalog: setup.state.catalog,
    picks,
    spin: receipt,
    additionalSpins: [
      buildCapRushSpinReceipt({
        runSeed: setup.state.runSeed,
        spinOrdinal: 1,
        purchase: 'standard',
        payrollDollars: receipt.payrollDollars + receipt.priceDollars,
        pick: picks[1] as CapRushDraftPick,
      }),
    ],
    bracket: setup.lockSources.bracket,
    profile: setup.lockSources.profile,
  });
}

function playSeason(locked: ReturnType<typeof buildLocked>) {
  const context = createEngineContext();
  const games: CapRushStoredGame[] = [];
  let aggregate = capRushEmptyAggregate();
  let isolations = 0;
  let strikes = 0;
  for (let gameNumber = 1; gameNumber <= CAP_RUSH_GAME_COUNT; gameNumber += 1) {
    const game = simulateCapRushGame({ locked, gameNumber, context });
    games.push(capRushStoredGameOf(game));
    aggregate = capRushFoldAggregate(aggregate, game.summary);
    isolations += game.facts.filter((fact) => fact.kind === 'isolation').length;
    strikes += game.facts.filter((fact) => fact.kind === 'strike').length;
  }
  return { games, aggregate, apronTriggers: { isolations, strikes } };
}

describe('cap rush wins per million', () => {
  it('divides wins by player payroll in millions', () => {
    expect(capRushWinsPerMillion(41, 110_000_000)).toBeCloseTo(41 / 110, 10);
    expect(capRushWinsPerMillion(82, 82_000_000)).toBeCloseTo(1, 10);
  });

  it('returns null for a zero payroll', () => {
    expect(capRushWinsPerMillion(10, 0)).toBeNull();
  });
});

describe('cap rush full season report', () => {
  it('plays all 82 games with clean audits and builds a complete report', () => {
    const locked = buildLocked(UNDER_CAP);
    const season = playSeason(locked);
    expect(season.games).toHaveLength(CAP_RUSH_GAME_COUNT);
    expect(season.aggregate.games).toBe(CAP_RUSH_GAME_COUNT);
    expect(season.aggregate.wins + season.aggregate.losses).toBe(CAP_RUSH_GAME_COUNT);
    expect(season.games.every((game) => game.audit.ok)).toBe(true);

    const report = capRushReport({
      locked,
      games: season.games,
      aggregate: season.aggregate,
      apronTriggers: season.apronTriggers,
    });
    expect(report.games).toHaveLength(CAP_RUSH_GAME_COUNT);
    expect(report.players).toHaveLength(5);
    expect(report.payrollDollars).toBe(50_000_000);
    expect(report.spinSpendDollars).toBe(0);
    expect(report.totalSpendDollars).toBe(50_000_000);
    expect(report.unusedCapDollars).toBe(80_000_000);
    expect(report.spin).toBeNull();
    expect(report.winsPerMillion).toBeCloseTo(season.aggregate.wins / 50, 10);
    expect(report.apronTriggers.isolations).toBe(0);
    expect(report.apronTriggers.strikes).toBe(0);
    expect(report.mvp).not.toBeNull();
  }, 120_000);

  it('attributes starter lines to their signed slot', () => {
    const locked = buildLocked(UNDER_CAP);
    const season = playSeason(locked);
    const report = capRushReport({
      locked,
      games: season.games,
      aggregate: season.aggregate,
      apronTriggers: season.apronTriggers,
    });
    const totalPoints = report.players.reduce((sum, line) => sum + line.points, 0);
    const teamPoints = season.games.reduce((sum, game) => sum + game.summary.humanPoints, 0);
    expect(totalPoints).toBeGreaterThan(0);
    expect(Math.abs(totalPoints - teamPoints)).toBeLessThanOrEqual(0);
    expect(report.players.map((line) => line.slot)).toEqual([...POSITIONS]);
    expect(report.players.every((line) => line.gamesPlayed === CAP_RUSH_GAME_COUNT)).toBe(true);
  }, 120_000);

  it('separates player payroll from spin spend in a Roulette report', () => {
    const setup = capRushTestSetup();
    const salaries = [16_000_000, 16_000_000, 16_000_000, 16_000_000, 16_000_000];
    const locked = buildSpunLocked(setup, salaries);
    const season = playSeason(locked);
    const report = capRushReport({
      locked,
      games: season.games,
      aggregate: season.aggregate,
      apronTriggers: season.apronTriggers,
    });
    expect(report.variant).toBe('roulette');
    expect(report.payrollDollars).toBe(80_000_000);
    expect(report.spin).not.toBeNull();
    expect(report.spinSpendDollars).toBe(30_000_000);
    expect(report.totalSpendDollars).toBe(110_000_000);
    expect(report.unusedCapDollars).toBe(20_000_000);
    expect(report.winsPerMillion).toBeCloseTo(season.aggregate.wins / 80, 10);
    expect(report.spin?.targetCardId).toBe('crc-22222222222222222222222222222222');
    expect(report.spin?.tier).toBeGreaterThanOrEqual(1);
    expect(report.additionalSpins).toHaveLength(1);
  }, 120_000);
});
