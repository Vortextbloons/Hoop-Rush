import { expect, test } from 'bun:test';
import {
  CAP_RUSH_CONFERENCE_GAMES_PER_TEAM,
  CAP_RUSH_PLAYOFF_ROUNDS,
  FULL_COURT_COACHING_SCHEMA_VERSION,
  FULL_COURT_HISTORY_SCHEMA_VERSION,
  commandIdSchema,
  fullCourtCreateDraftCommandSchema,
  fullCourtHistoryRecordSchema,
  idSchema,
  seedSchema,
} from '@hoop-rush/data-contracts';
import {
  applyFullCourtCommand,
  createFullCourtDraftState,
  fullCourtDraftIndexOf,
} from '@hoop-rush/engine';
import { buildCapRushTestCatalog, capRushTestCatalogSource } from '@hoop-rush/test-fixtures';
import { presentFullCourtHistoryEntry } from './full-court-history-presentation.ts';

test('presents variant, roster, strategy, economy, season finish, and achievements', () => {
  const catalog = buildCapRushTestCatalog({ overalls: [70, 71, 72, 73, 74, 75] });
  const source = capRushTestCatalogSource(catalog);
  const index = fullCourtDraftIndexOf(catalog, source);
  let draft = createFullCourtDraftState(
    fullCourtCreateDraftCommandSchema.parse({
      command: 'create-full-court-draft',
      commandId: commandIdSchema.parse('create'),
      runId: idSchema.parse('fc-present'),
      runSeed: seedSchema.parse('c'.repeat(32)),
      variant: 'standard',
      catalog: source,
    }),
    index,
  );
  for (const candidate of catalog.candidates.filter(
    (player) => player.positions.primary === 'PG',
  )) {
    draft = applyFullCourtCommand(
      draft,
      {
        command: 'pick-full-court-player',
        commandId: commandIdSchema.parse(`pick-${String(draft.revision)}`),
        runId: draft.runId,
        expectedRevision: draft.revision,
        playerVersionId: candidate.playerVersionId,
      },
      { index },
    ).state;
  }
  draft = applyFullCourtCommand(
    draft,
    {
      command: 'finish-full-court-draft',
      commandId: commandIdSchema.parse('finish'),
      runId: draft.runId,
      expectedRevision: draft.revision,
    },
    { index },
  ).state;

  const rosterIds = draft.picks.map((pick) => pick.player.playerId);
  const minuteTargets = Object.fromEntries(rosterIds.map((id, idx) => [id, idx < 5 ? 40 : 40]));
  const record = fullCourtHistoryRecordSchema.parse({
    schemaVersion: FULL_COURT_HISTORY_SCHEMA_VERSION,
    runId: draft.runId,
    completedAtIso: '2026-10-05T12:00:00.000Z',
    draft,
    teamId: 'atl',
    teamName: 'Atlanta Hawks',
    coaching: {
      schemaVersion: FULL_COURT_COACHING_SCHEMA_VERSION,
      tactics: { pace: 'fast', offense: 'perimeter', defense: 'pressure' },
      rotation: {
        startingFive: rosterIds.slice(0, 5),
        minuteTargets,
      },
    },
    regularSeason: {
      wins: 55,
      losses: CAP_RUSH_CONFERENCE_GAMES_PER_TEAM - 55,
      pointDifferential: 320,
    },
    playoffs: {
      status: 'champion',
      championTeamId: 'atl',
      championName: 'Atlanta Hawks',
      seriesWon: CAP_RUSH_PLAYOFF_ROUNDS,
      eliminatedRound: null,
    },
    achievements: ['bench-mob', 'the-chess-match'],
  });

  const presented = presentFullCourtHistoryEntry(record);
  expect(presented.variantLabel).toBe('Full Court Standard');
  expect(presented.regularRecordLabel).toBe('55–27');
  expect(presented.pointDiffLabel).toBe('+320');
  expect(presented.playoffLabel).toBe('Champions');
  expect(presented.strategySummary).toBe('Fast pace · Perimeter offense · Pressure defense');
  expect(presented.customRotation).toBe(true);
  expect(['Under the cap', 'First apron', 'Second apron', 'Over the hard limit']).toContain(
    presented.capStatusLabel,
  );
  expect(presented.roster).toHaveLength(6);
  expect(presented.roster.every((row) => row.teamAbbreviation.length > 0)).toBe(true);
  const overalls = presented.roster.map((row) => row.overall);
  expect(overalls).toEqual([...overalls].sort((left, right) => right - left));
  expect(new Set(overalls).size).toBeGreaterThan(1);
  expect(presented.achievements.map((a) => a.name)).toEqual(['Bench Mob', 'The Chess Match']);
  expect(presented.benchSummaryLabel).toBeNull();
  expect(presented.benchBestGameLabel).toBeNull();

  const withBench = fullCourtHistoryRecordSchema.parse({
    ...record,
    bench: {
      gamesRecorded: 2,
      totalBenchPoints: -3,
      averageBenchPoints: -1.5,
      bestGame: { gameId: 'fc-1', gameNumber: 1, benchPoints: -1 },
    },
  });
  const benchPresented = presentFullCourtHistoryEntry(withBench);
  expect(benchPresented.benchSummaryLabel).toContain('-3 total');
  expect(benchPresented.benchSummaryLabel).toContain('-1.5 average');
  expect(benchPresented.benchBestGameLabel).toContain('-1 points');
});
