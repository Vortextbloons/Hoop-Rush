import { POSITIONS, capRushCardSchema } from '@hoop-rush/data-contracts';
import {
  buildCapRushLeagueSchedule,
  buildCapRushLockedInputs,
  capRushAssignFranchise,
  capRushLeagueFieldOf,
} from '@hoop-rush/engine';
import { capRushTestSetup } from '../../../../../../packages/engine/src/modes/cap-rush/cap-rush-test-support.ts';

export function lockedRun() {
  const setup = capRushTestSetup();
  const field = capRushLeagueFieldOf(setup.lockSources.bracket);
  return buildCapRushLockedInputs({
    runId: setup.state.runId,
    runSeed: setup.state.runSeed,
    variant: 'clash',
    versionSet: setup.versionSet,
    catalog: setup.source,
    spin: null,
    picks: POSITIONS.map((slot, index) => ({
      pickOrdinal: index,
      slot,
      card: capRushCardSchema.parse({
        cardId: `crc-${String(index).repeat(32)}`,
        offerId: `cro-${'0'.repeat(32)}`,
        cardIndex: index,
        slot,
        bucket: 'budget',
        source: setup.index.bySlot.get(slot)?.[0],
        salaryDollars: 30_000_000,
      }),
    })),
    bracket: setup.lockSources.bracket,
    profile: setup.lockSources.profile,
    takeover: {
      franchise: capRushAssignFranchise({ runSeed: setup.state.runSeed, field }),
      games: buildCapRushLeagueSchedule({ runSeed: setup.state.runSeed, field }).games,
    },
  });
}
