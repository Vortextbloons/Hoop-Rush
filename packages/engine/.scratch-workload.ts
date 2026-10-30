import { POSITIONS, type CapRushDraftPick, type CapRushDraftState } from '@hoop-rush/data-contracts';
import {
  capRushCardSchema,
  capRushDraftStateSchema,
  capRushOfferIdSchema,
  capRushPlayoffGameSeed,
} from '@hoop-rush/data-contracts';
import {
  buildCapRushLeagueSchedule,
  buildCapRushLockedInputs,
  capRushAssignFranchise,
  capRushEmptyAggregate,
  capRushLeagueSlotGames,
  createEngineContext,
  simulateCapRushGame,
  simulateCapRushLeagueGame,
  simulateCapRushPlayoffGame,
} from './src/index.ts';
import { capRushTestSetup } from './src/modes/cap-rush/cap-rush-test-support.ts';

const setup = capRushTestSetup();
const salaries = [10_000_000, 10_000_000, 10_000_000, 10_000_000, 10_000_000];
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
  variant: 'clash',
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

const field = setup.lockSources.bracket.opponents.map((opponent) => ({
  teamId: opponent.teamId,
  displayName: opponent.displayName,
}));

const locked = buildCapRushLockedInputs({
  runId: state.runId,
  runSeed: state.runSeed,
  variant: state.variant,
  versionSet: state.versionSet,
  catalog: state.catalog,
  picks: state.picks,
  spin: null,
  bracket: setup.lockSources.bracket,
  profile: setup.lockSources.profile,
  takeover: {
    franchise: capRushAssignFranchise({ runSeed: state.runSeed, field }),
    games: buildCapRushLeagueSchedule({ runSeed: state.runSeed, field }).games,
  },
});

const context = createEngineContext();
const started = performance.now();
for (let gameNumber = 1; gameNumber <= 10; gameNumber += 1) {
  simulateCapRushGame({ locked, gameNumber, context });
}
for (let slot = 1; slot <= 2; slot += 1) {
  for (const entry of capRushLeagueSlotGames(locked, slot)) {
    simulateCapRushLeagueGame({ locked, entry, context });
  }
}
for (let gameNumber = 41; gameNumber <= 45; gameNumber += 1) {
  simulateCapRushGame({ locked, gameNumber, context });
}
for (let round = 1; round <= 2; round += 1) {
  for (let seriesSlot = 0; seriesSlot < 2; seriesSlot += 1) {
    simulateCapRushPlayoffGame({
      locked,
      plan: {
        seriesId: `crs-${String(round)}-${String(seriesSlot)}`,
        round,
        seriesSlot,
        gameOrdinal: 1,
        homeTeamId: locked.opponents[0]!.team.teamId,
        awayTeamId: locked.opponents[1]!.team.teamId,
        homeSeed: 1,
        awaySeed: 8,
        userSide: null,
        isFinals: false,
        seed: capRushPlayoffGameSeed(locked.runSeed, round, seriesSlot, 1),
      },
      context,
    });
  }
}
console.log('done in', (performance.now() - started).toFixed(1), 'ms');
