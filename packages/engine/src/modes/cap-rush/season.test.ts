import { describe, expect, it } from 'bun:test';
import { CAP_RUSH_GAME_COUNT } from '@hoop-rush/data-contracts';
import { createEngineContext } from '../../sim/kernel.ts';
import { capRushTestSetup } from './cap-rush-test-support.ts';
import { capRushEmptyAggregate, capRushFoldAggregate, simulateCapRushGame } from './season.ts';
import { buildCapRushLockedInputs } from './lock.ts';
import { POSITIONS } from '@hoop-rush/data-contracts';
import type { CapRushDraftPick, CapRushDraftState } from '@hoop-rush/data-contracts';
import {
  capRushCardSchema,
  capRushDraftStateSchema,
  capRushOfferIdSchema,
  capRushPlayoffGameSeed,
} from '@hoop-rush/data-contracts';
import { simulateCapRushPlayoffGame } from './playoff-sim.ts';
import { havocBattleGameInputDigest } from '../havoc/core/battle-digests.ts';

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
  const state: CapRushDraftState = capRushDraftStateSchema.parse({
    schemaVersion: setup.state.schemaVersion,
    runId: setup.state.runId,
    revision: 9,
    runSeed: setup.state.runSeed,
    variant,
    versionSet: setup.state.versionSet,
    catalog: setup.state.catalog,
    stage: 'complete',
    round: 5,
    offer: null,
    rerollsRemaining: 2,
    picks,
    spin: { status: 'unavailable' },
    locked: null,
    season: {
      games: [],
      aggregate: capRushEmptyAggregate(),
      apronTriggers: { isolations: 0, strikes: 0 },
      completedAt: null,
    },
  });
  return buildCapRushLockedInputs({
    runId: state.runId,
    runSeed: state.runSeed,
    variant: state.variant,
    versionSet: state.versionSet,
    catalog: state.catalog,
    picks: state.picks,
    spin: null,
    bracket: setup.lockSources.bracket,
    profile: setup.lockSources.profile,
  });
}

const UNDER_CAP = [10_000_000, 10_000_000, 10_000_000, 10_000_000, 10_000_000];

describe('cap rush season simulation', () => {
  it('simulates a game on the frozen schedule with a clean audit', () => {
    const locked = buildLocked(UNDER_CAP);
    const game = simulateCapRushGame({
      locked,
      gameNumber: 1,
      context: createEngineContext(),
    });
    expect(game.audit.ok).toBe(true);
    expect(game.audit.findings).toEqual([]);
    expect(game.summary.gameNumber).toBe(1);
    expect(game.summary.opponentId).toBe(locked.schedule[0]?.opponentId ?? '');
    expect(game.summary.inputDigest).toMatch(/^[0-9a-f]{32}$/);
    expect(game.summary.resultDigest).toMatch(/^[0-9a-f]{32}$/);
    expect(game.summary.inputDigest).not.toBe(game.summary.resultDigest);
    expect(game.summary.humanPoints).toBeGreaterThan(0);
  });

  it('replays the same game number to identical digests', () => {
    const locked = buildLocked(UNDER_CAP);
    const first = simulateCapRushGame({ locked, gameNumber: 7, context: createEngineContext() });
    const second = simulateCapRushGame({ locked, gameNumber: 7, context: createEngineContext() });
    expect(second.summary).toEqual(first.summary);
    expect(second.result).toEqual(first.result);
  });

  it('produces different results for different game numbers', () => {
    const locked = buildLocked(UNDER_CAP);
    const first = simulateCapRushGame({ locked, gameNumber: 1, context: createEngineContext() });
    const second = simulateCapRushGame({ locked, gameNumber: 2, context: createEngineContext() });
    expect(second.summary.inputDigest).not.toBe(first.summary.inputDigest);
  });

  it('records apron facts in the second apron but not under the cap', () => {
    const under = buildLocked(UNDER_CAP);
    const clean = simulateCapRushGame({
      locked: under,
      gameNumber: 1,
      context: createEngineContext(),
    });
    expect(clean.facts).toEqual([]);

    const over = buildLocked([35_000_000, 35_000_000, 35_000_000, 35_000_000, 35_000_000]);
    expect(over.payrollStatus).toBe('second-apron');
    let isolations = 0;
    let strikes = 0;
    for (let gameNumber = 1; gameNumber <= 3; gameNumber += 1) {
      const game = simulateCapRushGame({
        locked: over,
        gameNumber,
        context: createEngineContext(),
      });
      expect(game.audit.ok).toBe(true);
      isolations += game.facts.filter((fact) => fact.kind === 'isolation').length;
      strikes += game.facts.filter((fact) => fact.kind === 'strike').length;
    }
    expect(isolations).toBe(0);
    expect(strikes).toBeGreaterThan(0);
  });

  it('folds accepted summaries into a season aggregate', () => {
    let aggregate = capRushEmptyAggregate();
    aggregate = capRushFoldAggregate(aggregate, {
      gameNumber: 1,
      opponentId: 'bracket-x',
      humanHome: true,
      humanPoints: 110,
      opponentPoints: 100,
      won: true,
      overtimePeriods: 0,
      inputDigest: 'a'.repeat(32),
      resultDigest: 'b'.repeat(32),
    });
    expect(aggregate.games).toBe(1);
    expect(aggregate.wins).toBe(1);
    expect(aggregate.losses).toBe(0);
    expect(aggregate.pointsFor).toBe(110);
    expect(aggregate.perfectSeason).toBe(false);
  });

  it('marks a perfect season only after all 82 wins', () => {
    let aggregate = capRushEmptyAggregate();
    for (let index = 0; index < CAP_RUSH_GAME_COUNT; index += 1) {
      aggregate = capRushFoldAggregate(aggregate, {
        gameNumber: index + 1,
        opponentId: 'bracket-x',
        humanHome: index % 2 === 0,
        humanPoints: 100,
        opponentPoints: 90,
        won: true,
        overtimePeriods: 0,
        inputDigest: 'a'.repeat(32),
        resultDigest: 'b'.repeat(32),
      });
    }
    expect(aggregate.games).toBe(CAP_RUSH_GAME_COUNT);
    expect(aggregate.wins).toBe(CAP_RUSH_GAME_COUNT);
    expect(aggregate.perfectSeason).toBe(true);
  });
});

describe('cap rush playoff simulation', () => {
  it('reports the audited battle input digest for a seeded playoff game', () => {
    const locked = buildLocked(UNDER_CAP);
    const plan = {
      seriesId: 'crs-1-0',
      round: 1,
      seriesSlot: 0,
      gameOrdinal: 1,
      homeTeamId: locked.human.teamId,
      awayTeamId: locked.opponents[0]?.team.teamId ?? '',
      homeSeed: 1,
      awaySeed: 8,
      userSide: 'home' as const,
      isFinals: false,
      seed: capRushPlayoffGameSeed(locked.runSeed, 1, 0, 1),
    };
    const simulation = simulateCapRushPlayoffGame({ locked, plan, context: createEngineContext() });
    expect(simulation.game.audit.ok).toBe(true);
    expect(simulation.inputDigest).toBe(havocBattleGameInputDigest(simulation.battleInput));
    expect(simulation.game.summary.inputDigest).toBe(simulation.inputDigest);
    expect(simulation.game.summary.resultDigest).toBe(simulation.resultDigest);
    const replay = simulateCapRushPlayoffGame({ locked, plan, context: createEngineContext() });
    expect(replay.resultDigest).toBe(simulation.resultDigest);
    expect(replay.game.result).toEqual(simulation.game.result);
  });
});
