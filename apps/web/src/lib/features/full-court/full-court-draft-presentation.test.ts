import { describe, expect, it } from 'bun:test';
import type { FullCourtDraftState } from '@hoop-rush/data-contracts';
import {
  FULL_COURT_DEFAULT_MONEY,
  FULL_COURT_MAX_ROSTER_SIZE,
  FULL_COURT_MIN_ROSTER_SIZE,
  commandIdSchema,
  eraIdSchema,
  franchiseIdSchema,
  fullCourtCreateDraftCommandSchema,
  fullCourtDraftStateSchema,
  idSchema,
  playerIdSchema,
  playersIndexSchema,
  seasonKeySchema,
  seedSchema,
} from '@hoop-rush/data-contracts';
import {
  createFullCourtDraftState,
  fullCourtDraftIndexOf,
  fullCourtSalaryDollarsOf,
  type FullCourtCatalogIndex,
} from '@hoop-rush/engine';
import { buildCapRushTestCatalog, capRushTestCatalogSource } from '@hoop-rush/test-fixtures';
import {
  FULL_COURT_CATALOG_PAGE_SIZE,
  formatWarChestCr,
  fullCourtCatalogPage,
  fullCourtDraftSummary,
  fullCourtFaceIndex,
  fullCourtFaceKey,
  fullCourtPickReasonLabel,
  fullCourtVariantLabel,
} from './full-court-draft-presentation.ts';

interface Setup {
  readonly index: FullCourtCatalogIndex;
  readonly state: FullCourtDraftState;
}

function setup(): Setup {
  const catalog = buildCapRushTestCatalog();
  const source = capRushTestCatalogSource(catalog);
  const index = fullCourtDraftIndexOf(catalog, source);
  const state = createFullCourtDraftState(
    fullCourtCreateDraftCommandSchema.parse({
      command: 'create-full-court-draft',
      commandId: commandIdSchema.parse('cmd-create'),
      runId: idSchema.parse('run-full-court'),
      runSeed: seedSchema.parse('abc123def4567890'),
      variant: 'standard',
      catalog: source,
    }),
    index,
  );
  return { index, state };
}

function stateWithPicks(setupValue: Setup, count: number): FullCourtDraftState {
  const players = [...setupValue.index.catalog.candidates]
    .sort(
      (left, right) =>
        fullCourtSalaryDollarsOf(left) - fullCourtSalaryDollarsOf(right) ||
        left.playerVersionId.localeCompare(right.playerVersionId),
    )
    .slice(0, count);
  const picks = players.map((player, pickOrdinal) => ({
    pickOrdinal,
    player,
    salaryDollars: fullCourtSalaryDollarsOf(player),
  }));
  return fullCourtDraftStateSchema.parse({
    ...setupValue.state,
    picks,
    spending: picks.map((pick, index) => ({
      entryId: `fcs-${(index + 1).toString(16).padStart(32, '0')}`,
      kind: 'salary',
      dollars: pick.salaryDollars,
      commandId: commandIdSchema.parse(`cmd-salary-${String(index)}`),
      playerVersionId: pick.player.playerVersionId,
    })),
  });
}

describe('full court draft presentation', () => {
  it('summarizes an empty draft with payroll, apron, and War Chest untouched', () => {
    const { index, state } = setup();
    const summary = fullCourtDraftSummary(state, index);
    expect(summary.rosterCount).toBe(0);
    expect(summary.payrollDollars).toBe(0);
    expect(summary.payrollRoomDollars).toBe(FULL_COURT_DEFAULT_MONEY.hardLimitDollars);
    expect(summary.warChestDollars).toBe(FULL_COURT_DEFAULT_MONEY.startingWarChestDollars);
    expect(summary.spentDollars).toBe(0);
    expect(summary.status).toBe('under-cap');
    expect(summary.canPick).toBe(true);
    expect(summary.canFinish).toBe(false);
    expect(summary.absenceTolerance).toBe(0);
    expect(summary.depthForecastDollars).not.toBeNull();
  });

  it('opens finishing at the six-player minimum and forecasts one depth place', () => {
    const setupValue = setup();
    const draft = stateWithPicks(setupValue, FULL_COURT_MIN_ROSTER_SIZE);
    const summary = fullCourtDraftSummary(draft, setupValue.index);
    expect(summary.rosterCount).toBe(6);
    expect(summary.canFinish).toBe(true);
    expect(summary.absenceTolerance).toBe(1);
    expect(summary.depthForecastDollars).not.toBeNull();
  });

  it('closes picking at twelve players and keeps the roster finishable', () => {
    const setupValue = setup();
    const draft = stateWithPicks(setupValue, FULL_COURT_MAX_ROSTER_SIZE);
    const summary = fullCourtDraftSummary(draft, setupValue.index);
    expect(summary.rosterCount).toBe(12);
    expect(summary.canPick).toBe(false);
    expect(summary.canFinish).toBe(true);
    expect(summary.absenceTolerance).toBe(7);
    expect(summary.depthForecastDollars).toBeNull();
  });

  it('filters the catalog by search and optional position with a bounded page', () => {
    const { index, state } = setup();
    const all = fullCourtCatalogPage(index, state);
    expect(all.rows).toHaveLength(FULL_COURT_CATALOG_PAGE_SIZE);
    expect(all.total).toBe(index.catalog.candidates.length);
    expect(all.rows[0]?.player.originalOverall).toBe(99);

    const firstPage = fullCourtCatalogPage(index, state, { limit: 5 });
    const secondPage = fullCourtCatalogPage(index, state, { limit: 5, offset: 5 });
    expect(firstPage.rows).toHaveLength(5);
    expect(secondPage.rows).toHaveLength(5);
    expect(secondPage.rows[0]?.player.playerVersionId).not.toBe(
      firstPage.rows[0]?.player.playerVersionId,
    );

    const pointGuards = fullCourtCatalogPage(index, state, {
      position: 'PG',
      limit: index.catalog.candidates.length,
    });
    expect(pointGuards.total).toBeGreaterThan(0);
    expect(pointGuards.rows.every((row) => row.player.positions.includes('PG'))).toBe(true);

    const target = index.catalog.candidates.find((player) => player.positions.includes('PG'));
    if (target === undefined) throw new Error('missing test point guard');
    const searched = fullCourtCatalogPage(index, state, { search: target.displayName });
    expect(searched.rows.some((row) => row.player.playerVersionId === target.playerVersionId)).toBe(
      true,
    );
  });

  it('marks a rostered player version and blocks every version of that player', () => {
    const setupValue = setup();
    const target = setupValue.index.catalog.candidates[0];
    if (target === undefined) throw new Error('missing test player');
    const draft = fullCourtDraftStateSchema.parse({
      ...setupValue.state,
      picks: [
        {
          pickOrdinal: 0,
          player: target,
          salaryDollars: fullCourtSalaryDollarsOf(target),
        },
      ],
      spending: [
        {
          entryId: `fcs-${'a'.repeat(32)}`,
          kind: 'salary',
          dollars: fullCourtSalaryDollarsOf(target),
          commandId: commandIdSchema.parse('cmd-pick'),
          playerVersionId: target.playerVersionId,
        },
      ],
    });
    const page = fullCourtCatalogPage(setupValue.index, draft, { search: target.displayName });
    const row = page.rows.find((entry) => entry.player.playerId === target.playerId);
    if (row === undefined) throw new Error('missing catalog row');
    expect(row.onRoster).toBe(true);
    expect(row.playerRostered).toBe(true);
    expect(row.assessment.legal).toBe(false);
    if (row.assessment.legal) throw new Error('expected a blocked pick');
    expect(row.assessment.reason).toBe('duplicate-player');
    expect(fullCourtPickReasonLabel(row.assessment, draft.money)).toBe('Already rostered');
  });

  it('formats the War Chest through the fixed CR conversion', () => {
    expect(formatWarChestCr(FULL_COURT_DEFAULT_MONEY.startingWarChestDollars)).toBe('450 CR');
    expect(formatWarChestCr(437_500_000)).toBe('437.5 CR');
  });

  it('labels both Full Court variants', () => {
    const { state } = setup();
    expect(fullCourtVariantLabel(state)).toBe('Full Court Standard');
    expect(fullCourtVariantLabel({ ...state, variant: 'roulette' })).toBe('Full Court Roulette');
  });

  it('indexes faces by the player season tuple', () => {
    const player = {
      playerId: playerIdSchema.parse('p-face'),
      franchiseId: franchiseIdSchema.parse('lakers'),
      eraId: eraIdSchema.parse('1990s'),
      seasonKey: seasonKeySchema.parse('1995-96'),
      firstName: 'Face',
      lastName: 'Test',
      displayName: 'Face Test',
      playerExternalId: '1234',
      positionsPlayable: ['PG'],
      overall: 80,
      offense: 80,
      defense: 80,
      selectionScore: 10,
    };
    const index = playersIndexSchema.parse({
      schemaVersion: 4,
      dataVersion: 'test',
      players: [player],
    });
    const faces = fullCourtFaceIndex(index);
    expect(faces.get(fullCourtFaceKey(player))?.playerId).toBe(player.playerId);
  });
});
