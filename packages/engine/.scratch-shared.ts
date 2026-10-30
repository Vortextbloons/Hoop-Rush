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
} from './src/index.ts';
import { capRushTestSetup } from './src/modes/cap-rush/cap-rush-test-support.ts';

export function buildScratchLocked() {
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
    takeover: {
      franchise: capRushAssignFranchise({ runSeed: state.runSeed, field }),
      games: buildCapRushLeagueSchedule({ runSeed: state.runSeed, field }).games,
    },
  });
}

export function playoffPlans(locked: ReturnType<typeof buildScratchLocked>) {
  const plans = [];
  const opponents = locked.opponents.map((entry) => entry.team.teamId);
  for (const [roundIndex, seriesCount] of [8, 4, 2, 1].entries()) {
    const round = roundIndex + 1;
    for (let seriesSlot = 0; seriesSlot < seriesCount; seriesSlot += 1) {
      for (let gameOrdinal = 1; gameOrdinal <= 5; gameOrdinal += 1) {
        const high = opponents[seriesSlot * 2] ?? opponents[0]!;
        const low = opponents[seriesSlot * 2 + 1] ?? opponents[1]!;
        const highHome = [1, 2, 5, 7].includes(gameOrdinal);
        plans.push({
          seriesId: `crs-${String(round)}-${String(seriesSlot)}`,
          round,
          seriesSlot,
          gameOrdinal,
          homeTeamId: highHome ? high : low,
          awayTeamId: highHome ? low : high,
          homeSeed: seriesSlot * 2 + 1,
          awaySeed: seriesSlot * 2 + 2,
          userSide: null,
          isFinals: round === 4,
          seed: capRushPlayoffGameSeed(locked.runSeed, round, seriesSlot, gameOrdinal),
        });
      }
    }
  }
  return plans;
}
