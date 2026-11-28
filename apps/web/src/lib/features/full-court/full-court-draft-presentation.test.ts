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
  fullCourtEligibleCandidates,
  fullCourtSalaryDollarsOf,
  type FullCourtCatalogIndex,
} from '@hoop-rush/engine';
import { buildCapRushTestCatalog, capRushTestCatalogSource } from '@hoop-rush/test-fixtures';
import { formatMillions } from '#lib/features/cap-rush/cap-rush-presentation.js';
import {
  FULL_COURT_CATALOG_PAGE_SIZE,
  fullCourtCatalogPage,
  fullCourtDraftSummary,
  fullCourtFaceIndex,
  fullCourtFaceKey,
  fullCourtLockCopy,
  fullCourtPickReasonLabel,
  fullCourtProfileReferences,
  fullCourtSigningImpact,
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

  it('filters the pool by search and optional position in mixed curated opening order', () => {
    const { index, state } = setup();
    const eligible = fullCourtEligibleCandidates(index, state);
    const all = fullCourtCatalogPage(index, state);
    expect(all.rows).toHaveLength(FULL_COURT_CATALOG_PAGE_SIZE);
    expect(all.total).toBe(eligible.length);
    expect(all.rows.map((row) => row.player.playerVersionId)).toEqual(
      eligible.slice(0, FULL_COURT_CATALOG_PAGE_SIZE).map((player) => player.playerVersionId),
    );
    const firstPageOveralls = all.rows.map((row) => row.player.originalOverall);
    expect(Math.max(...firstPageOveralls)).toBeGreaterThanOrEqual(85);
    expect(Math.min(...firstPageOveralls)).toBeLessThan(76);

    const firstPage = fullCourtCatalogPage(index, state, { limit: 5 });
    const secondPage = fullCourtCatalogPage(index, state, { limit: 5, offset: 5 });
    expect(firstPage.rows).toHaveLength(5);
    expect(secondPage.rows).toHaveLength(5);
    expect(secondPage.rows[0]?.player.playerVersionId).not.toBe(
      firstPage.rows[0]?.player.playerVersionId,
    );

    const pointGuards = fullCourtCatalogPage(index, state, {
      position: 'PG',
      limit: eligible.length,
    });
    expect(pointGuards.total).toBeGreaterThan(0);
    expect(pointGuards.rows.every((row) => row.player.positions.includes('PG'))).toBe(true);

    const target = eligible.find((player) => player.positions.includes('PG'));
    if (target === undefined) throw new Error('missing test point guard');
    const searched = fullCourtCatalogPage(index, state, { search: target.displayName });
    expect(searched.rows.some((row) => row.player.playerVersionId === target.playerVersionId)).toBe(
      true,
    );
  });

  it('preserves open catalog OVR-descending order for legacy saves without a pool', () => {
    const { index, state } = setup();
    const all = fullCourtCatalogPage(index, { ...state, pool: undefined });
    expect(all.total).toBe(index.catalog.candidates.length);
    expect(all.rows[0]?.player.originalOverall).toBe(99);
  });

  it('marks a rostered player version and blocks every version of that player', () => {
    const setupValue = setup();
    const target = fullCourtEligibleCandidates(setupValue.index, setupValue.state)[0];
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

  it('formats the budget in millions without credits', () => {
    expect(formatMillions(FULL_COURT_DEFAULT_MONEY.startingWarChestDollars)).toBe('$252M');
    expect(FULL_COURT_DEFAULT_MONEY.startingWarChestDollars).toBeGreaterThanOrEqual(
      FULL_COURT_DEFAULT_MONEY.hardLimitDollars,
    );
    expect(formatMillions(185_500_000)).toBe('$185.5M');
  });

  it('prices a signing from the engine assessment the card shows', () => {
    const { index, state } = setup();
    const page = fullCourtCatalogPage(index, state, { limit: 5 });
    const row = page.rows[0];
    if (row === undefined) throw new Error('missing catalog row');
    expect(row.assessment.legal).toBe(true);

    const impact = fullCourtSigningImpact(row, state.money);
    expect(impact.payrollAfter).toBe(formatMillions(row.assessment.payrollAfterPick));
    expect(impact.roomAfter).toBe(
      formatMillions(state.money.hardLimitDollars - row.assessment.payrollAfterPick),
    );
    expect(impact.warChestAfter).toBe(formatMillions(row.assessment.warChestAfterPick));
  });

  it('reports an apron shift only when the signing crosses a line', () => {
    const { index, state } = setup();
    const page = fullCourtCatalogPage(index, state, { limit: index.catalog.candidates.length });
    const row = page.rows[0];
    if (row === undefined) throw new Error('missing catalog row');
    expect(fullCourtSigningImpact(row, state.money).apronShift).toBeNull();

    const zeroCap = {
      ...state.money,
      capLineDollars: 0,
      firstApronDollars: state.money.hardLimitDollars,
    };
    expect(fullCourtSigningImpact(row, zeroCap).apronShift).toBe('Crosses the first apron');

    const zeroApron = { ...state.money, capLineDollars: 0, firstApronDollars: 0 };
    expect(fullCourtSigningImpact(row, zeroApron).apronShift).toBe('Crosses the second apron');
  });

  it('states the payroll and War Chest that lock with an unfinished or locked roster', () => {
    const setupValue = setup();
    const empty = fullCourtDraftSummary(setupValue.state, setupValue.index);
    const waiting = fullCourtLockCopy(setupValue.state, empty);
    expect(waiting.stamp).toBeNull();
    expect(waiting.headline).toBe('Add before locking');
    expect(waiting.detail).toContain('6 more signings reaches the 6-player minimum.');

    const six = stateWithPicks(setupValue, FULL_COURT_MIN_ROSTER_SIZE);
    const ready = fullCourtLockCopy(six, fullCourtDraftSummary(six, setupValue.index));
    expect(ready.stamp).toBeNull();
    expect(ready.headline).toBe('Lock the roster');
    expect(ready.detail).toContain('6 players');

    const locked = fullCourtDraftStateSchema.parse({ ...six, stage: 'complete' });
    const done = fullCourtLockCopy(locked, fullCourtDraftSummary(locked, setupValue.index));
    expect(done.stamp).toBe('Locked');
    expect(done.headline).toBe('Draft complete');
  });

  it('keeps profile percentiles inside the shared minimum cohort size', () => {
    const catalog = buildCapRushTestCatalog({ positions: ['PG'] });
    const index = fullCourtDraftIndexOf(catalog, capRushTestCatalogSource(catalog));
    const references = fullCourtProfileReferences(index);
    expect(references.forSlot('PG')?.sampleSize).toBe(catalog.candidates.length);
    expect(references.forSlot('C')).toBeNull();
    expect(fullCourtProfileReferences(index)).toBe(references);
  });

  it('labels the Full Court variant', () => {
    const { state } = setup();
    expect(fullCourtVariantLabel(state)).toBe('Full Court Standard');
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

  it('sorts by overall or salary and filters to signable players when requested', () => {
    const setupValue = setup();
    const { index, state } = setupValue;
    const lowToHigh = fullCourtCatalogPage(index, state, {
      sort: 'salary-asc',
      limit: index.catalog.candidates.length,
    });
    const highToLow = fullCourtCatalogPage(index, state, {
      sort: 'salary-desc',
      limit: index.catalog.candidates.length,
    });
    const lowFirst = lowToHigh.rows[0];
    const lowLast = lowToHigh.rows.at(-1);
    const highFirst = highToLow.rows[0];
    const highLast = highToLow.rows.at(-1);
    if (!lowFirst || !lowLast || !highFirst || !highLast) {
      throw new Error('Expected non-empty sorted catalog rows');
    }
    expect(lowFirst.salaryDollars).toBeLessThanOrEqual(lowLast.salaryDollars);
    expect(highFirst.salaryDollars).toBeGreaterThanOrEqual(highLast.salaryDollars);

    const drafted = stateWithPicks(setupValue, 1);
    const signable = fullCourtCatalogPage(index, drafted, {
      signableOnly: true,
      limit: index.catalog.candidates.length,
    });
    expect(signable.rows.length).toBeGreaterThan(0);
    expect(signable.rows.every((row) => row.assessment.legal && !row.onRoster)).toBe(true);
  });
});
