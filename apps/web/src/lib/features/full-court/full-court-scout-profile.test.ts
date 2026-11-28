import { expect, test } from 'bun:test';
import {
  commandIdSchema,
  fullCourtCreateDraftCommandSchema,
  fullCourtDraftStateSchema,
  idSchema,
  seedSchema,
} from '@hoop-rush/data-contracts';
import {
  applyFullCourtCommand,
  createFullCourtDraftState,
  fullCourtDraftIndexOf,
  fullCourtEligibleCandidates,
  fullCourtSalaryDollarsOf,
} from '@hoop-rush/engine';
import { buildCapRushTestCatalog, capRushTestCatalogSource } from '@hoop-rush/test-fixtures';
import { fullCourtScoutProfile, fullCourtScoutingOwned } from './full-court-scout-profile.ts';

function setup() {
  const catalog = buildCapRushTestCatalog();
  const source = capRushTestCatalogSource(catalog);
  const index = fullCourtDraftIndexOf(catalog, source);
  let state = createFullCourtDraftState(
    fullCourtCreateDraftCommandSchema.parse({
      command: 'create-full-court-draft',
      commandId: commandIdSchema.parse('cmd-scout-profile'),
      runId: idSchema.parse('run-scout-profile'),
      runSeed: seedSchema.parse('abc123def4567890'),
      variant: 'standard',
      catalog: source,
    }),
    index,
  );
  const player = fullCourtEligibleCandidates(index, state)[0];
  if (player === undefined) throw new Error('Missing draft candidate');
  state = fullCourtDraftStateSchema.parse({
    ...state,
    picks: [{ pickOrdinal: 0, player, salaryDollars: fullCourtSalaryDollarsOf(player) }],
    spending: [
      {
        entryId: `fcs-${'0'.repeat(32)}`,
        kind: 'salary',
        dollars: fullCourtSalaryDollarsOf(player),
        commandId: commandIdSchema.parse('cmd-scout-pick'),
        playerVersionId: player.playerVersionId,
      },
    ],
  });
  return { index, state, player };
}

test('scouting ownership follows the purchased report', () => {
  const { index, state } = setup();
  expect(fullCourtScoutingOwned(state)).toBe(false);

  const purchased = applyFullCourtCommand(
    state,
    {
      command: 'purchase-full-court-report',
      commandId: commandIdSchema.parse('cmd-scout-report'),
      runId: state.runId,
      expectedRevision: state.revision,
      target: { kind: 'player-scouting' },
    },
    { index },
  ).state;
  expect(fullCourtScoutingOwned(purchased)).toBe(true);
});

test('scout profile includes the same strengths and limitations as the draft', () => {
  const { index, player } = setup();
  const { profile, report } = fullCourtScoutProfile(index, player, null);

  expect(profile.archetype.length).toBeGreaterThan(0);
  expect(report.usage.usageRate).toBeGreaterThanOrEqual(0);
  expect(Array.isArray(report.strengths)).toBe(true);
  expect(Array.isArray(report.limitations)).toBe(true);
  expect(report.shotProfile.length).toBeGreaterThan(0);
});
