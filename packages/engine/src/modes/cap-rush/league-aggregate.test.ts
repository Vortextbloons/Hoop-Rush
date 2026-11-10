import { describe, expect, it } from 'bun:test';
import type {
  CapRushLeagueGame,
  CapRushLockedInputs,
  CapRushStoredGame,
} from '@hoop-rush/data-contracts';
import { CAP_RUSH_GAME_COUNT, POSITIONS, capRushCardSchema } from '@hoop-rush/data-contracts';
import { createEngineContext } from '../../sim/kernel.ts';
import { capRushTestSetup } from './cap-rush-test-support.ts';
import {
  buildCapRushLeagueSchedule,
  capRushAssignFranchise,
  capRushLeagueFieldOf,
} from './league-schedule.ts';
import { buildCapRushLockedInputs } from './lock.ts';
import { capRushEmptyLeagueAggregate, capRushFoldLeagueAggregate } from './league-aggregate.ts';
import { simulateCapRushLeagueSlot } from './league-simulation.ts';
import { capRushReport } from './report.ts';
import {
  capRushEmptyAggregate,
  capRushFoldAggregate,
  capRushStoredGameOf,
  simulateCapRushGame,
} from './season.ts';

function lockedWithLeague(): CapRushLockedInputs {
  const setup = capRushTestSetup();
  const picks = POSITIONS.map((slot, index) => {
    const player = setup.index.bySlot.get(slot)?.[0];
    if (player === undefined) throw new Error(`missing ${slot}`);
    return {
      pickOrdinal: index,
      slot,
      card: capRushCardSchema.parse({
        cardId: `crc-${String(index).repeat(32)}`,
        offerId: `cro-${'0'.repeat(32)}`,
        cardIndex: index,
        slot,
        bucket: 'budget',
        source: player,
        salaryDollars: 10_000_000,
      }),
    };
  });
  const field = capRushLeagueFieldOf(setup.lockSources.bracket);
  const takeover = {
    franchise: capRushAssignFranchise({ runSeed: setup.state.runSeed, field }),
    games: buildCapRushLeagueSchedule({ runSeed: setup.state.runSeed, field }).games,
  };
  return buildCapRushLockedInputs({
    runId: setup.state.runId,
    runSeed: setup.state.runSeed,
    variant: setup.state.variant,
    versionSet: setup.state.versionSet,
    catalog: setup.state.catalog,
    picks,
    spin: null,
    bracket: setup.lockSources.bracket,
    profile: setup.lockSources.profile,
    takeover,
  });
}

function playUserSeason(locked: CapRushLockedInputs): {
  games: CapRushStoredGame[];
  aggregate: ReturnType<typeof capRushEmptyAggregate>;
  apronTriggers: { isolations: number; strikes: number };
} {
  const context = createEngineContext();
  const games: CapRushStoredGame[] = [];
  let aggregate = capRushEmptyAggregate();
  const apronTriggers = { isolations: 0, strikes: 0 };
  for (let gameNumber = 1; gameNumber <= CAP_RUSH_GAME_COUNT; gameNumber += 1) {
    const simulation = simulateCapRushGame({ locked, gameNumber, context });
    games.push(capRushStoredGameOf(simulation));
    aggregate = capRushFoldAggregate(aggregate, simulation.summary);
    apronTriggers.isolations += simulation.facts.filter((fact) => fact.kind === 'isolation').length;
    apronTriggers.strikes += simulation.facts.filter((fact) => fact.kind === 'strike').length;
  }
  return { games, aggregate, apronTriggers };
}

describe('cap rush league aggregate', () => {
  it('keeps the aggregate fold idempotent across retries and equal to the box fold', () => {
    const locked = lockedWithLeague();
    const context = createEngineContext();
    let committed: CapRushLeagueGame[] = [];
    let aggregate = capRushEmptyLeagueAggregate();
    for (let slot = 1; slot <= 3; slot += 1) {
      const games = simulateCapRushLeagueSlot({ locked, slot, context });
      aggregate = capRushFoldLeagueAggregate(aggregate, games);
      committed = [...committed, ...games];
    }
    expect(aggregate.games).toBe(committed.length);
    expect(aggregate.gameIds).toHaveLength(committed.length);

    // A retried or resumed commit replays the same games; the aggregate must not double count.
    const replayAggregate = capRushFoldLeagueAggregate(aggregate, committed);
    expect(replayAggregate).toEqual(aggregate);

    // Folding one slot at a time equals folding every game in one pass.
    const onePass = capRushFoldLeagueAggregate(capRushEmptyLeagueAggregate(), committed);
    expect(onePass).toEqual(aggregate);

    const season = playUserSeason(locked);
    const fromAggregate = capRushReport({
      locked,
      games: season.games,
      aggregate: season.aggregate,
      apronTriggers: season.apronTriggers,
      leagueAggregate: aggregate,
    });
    const fromBoxes = capRushReport({
      locked,
      games: season.games,
      aggregate: season.aggregate,
      apronTriggers: season.apronTriggers,
      leagueGames: committed,
    });
    expect(fromAggregate.mvp).toEqual(fromBoxes.mvp);
    expect(fromAggregate.leagueBaselineTs).toBe(fromBoxes.leagueBaselineTs);
    expect(fromAggregate.leagueGamesAccepted).toBe(committed.length);
  }, 180_000);
});
