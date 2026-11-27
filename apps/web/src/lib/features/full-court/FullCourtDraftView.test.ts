import { describe, expect, test } from 'bun:test';
import type { FullCourtDraftState, FullCourtReportTarget } from '@hoop-rush/data-contracts';
import {
  commandIdSchema,
  fullCourtCreateDraftCommandSchema,
  idSchema,
  seedSchema,
} from '@hoop-rush/data-contracts';
import {
  applyFullCourtCommand,
  createFullCourtDraftState,
  fullCourtDraftIndexOf,
  fullCourtSalaryDollarsOf,
  fullCourtScoutPlayer,
  type FullCourtCatalogIndex,
} from '@hoop-rush/engine';
import { buildCapRushTestCatalog, capRushTestCatalogSource } from '@hoop-rush/test-fixtures';
import { render } from 'svelte/server';
import FullCourtDraftView from './FullCourtDraftView.svelte';
import FullCourtScoutReport from './FullCourtScoutReport.svelte';
import { FULL_COURT_MIN_ROSTER_SIZE, fullCourtDraftStateSchema } from '@hoop-rush/data-contracts';
function setup(): { index: FullCourtCatalogIndex; state: FullCourtDraftState } {
  const catalog = buildCapRushTestCatalog();
  const source = capRushTestCatalogSource(catalog);
  const index = fullCourtDraftIndexOf(catalog, source);
  const state = createFullCourtDraftState(
    fullCourtCreateDraftCommandSchema.parse({
      command: 'create-full-court-draft',
      commandId: commandIdSchema.parse('cmd-draft-view'),
      runId: idSchema.parse('run-draft-view'),
      runSeed: seedSchema.parse('abc123def4567890'),
      variant: 'standard',
      catalog: source,
    }),
    index,
  );
  return { index, state };
}

function renderView(
  state: FullCourtDraftState,
  index: FullCourtCatalogIndex,
  onPurchaseReport?: (target: FullCourtReportTarget) => void,
): string {
  return render(FullCourtDraftView, {
    props: {
      draft: state,
      index,
      busy: false,
      onPick: () => undefined,
      onRemove: () => undefined,
      onFinish: () => undefined,
      ...(onPurchaseReport === undefined ? {} : { onPurchaseReport }),
    },
  }).body;
}

function completedState(
  index: FullCourtCatalogIndex,
  seed: FullCourtDraftState,
): FullCourtDraftState {
  const players = index.catalog.candidates.slice(0, FULL_COURT_MIN_ROSTER_SIZE);
  const picks = players.map((player, pickOrdinal) => ({
    pickOrdinal,
    player,
    salaryDollars: fullCourtSalaryDollarsOf(player),
  }));
  return fullCourtDraftStateSchema.parse({
    ...seed,
    stage: 'complete',
    picks,
    spending: picks.map((pick, ordinal) => ({
      entryId: `fcs-${String(ordinal).padStart(32, '0')}`,
      kind: 'salary',
      dollars: pick.salaryDollars,
      commandId: commandIdSchema.parse(`cmd-locked-${String(ordinal)}`),
      playerVersionId: pick.player.playerVersionId,
    })),
  });
}

function scoutedState(
  index: FullCourtCatalogIndex,
  state: FullCourtDraftState,
  displayName: string,
): FullCourtDraftState {
  const player = index.catalog.candidates.find(
    (candidate) => candidate.displayName === displayName,
  );
  if (player === undefined) throw new Error(`missing test player ${displayName}`);
  return applyFullCourtCommand(
    state,
    {
      command: 'purchase-full-court-report',
      commandId: commandIdSchema.parse(
        `cmd-scout-${displayName.replace(/\s+/g, '-').toLowerCase()}`,
      ),
      runId: state.runId,
      expectedRevision: state.revision,
      target: { kind: 'player-scouting', playerVersionId: player.playerVersionId },
    },
    { index },
  ).state;
}

function lowWarChestSetup(): { index: FullCourtCatalogIndex; state: FullCourtDraftState } {
  const catalog = buildCapRushTestCatalog({ overalls: [40, 41, 42] });
  const source = capRushTestCatalogSource(catalog);
  const index = fullCourtDraftIndexOf(catalog, source);
  const state = createFullCourtDraftState(
    fullCourtCreateDraftCommandSchema.parse({
      command: 'create-full-court-draft',
      commandId: commandIdSchema.parse('cmd-low-chest'),
      runId: idSchema.parse('run-low-chest'),
      runSeed: seedSchema.parse('abc123def4567891'),
      variant: 'standard',
      catalog: source,
    }),
    index,
  );
  return {
    index,
    state: fullCourtDraftStateSchema.parse({
      ...state,
      money: { ...state.money, startingWarChestDollars: 8_000_000 },
    }),
  };
}

describe('FullCourtDraftView', () => {
  test('shows a signing cost and its blockers beside every sign action', () => {
    const { state, index } = setup();
    const body = renderView(state, index);

    expect(body).toContain('Payroll after');
    expect(body).toContain('Room left');
    expect(body).toContain('War Chest after');
    expect(body).toContain('aria-label="Sign PG 99"');
  });

  test('gates the lock on the six-player minimum and links the roster from the action bar', () => {
    const { state, index } = setup();
    const body = renderView(state, index);

    expect(body).toContain('Add before locking');
    expect(body).toContain('6 more signings reaches the 6-player minimum.');
    expect(body).toContain('href="#draft-roster"');
    expect(body).toContain('id="draft-roster"');
    expect(body).toContain('Lock the roster');
  });

  test('seals a locked roster with a confirmation stamp and the frozen payroll', () => {
    const { state, index } = setup();
    const body = renderView(completedState(index, state), index);

    expect(body).toContain('Locked');
    expect(body).toContain('Draft complete');
    expect(body).toContain('Every salary is fixed for the run.');
    expect(body).toContain('Locked');
  });

  test('prices player scouting per catalog version without replacing the catalog or profile actions', () => {
    const { state, index } = setup();
    const body = renderView(state, index, () => undefined);

    expect(body).toContain('Scout 2 CR · Lifetime of this run');
    expect(body).toContain('aria-label="Scout PG 99 for 2 CR"');
    expect(body).toContain('Open catalog');
    expect(body).toContain('aria-label="PG 99 details"');
  });

  test('marks a purchased scouting report as owned and opens it from the same row', () => {
    const { state, index } = setup();
    const body = renderView(scoutedState(index, state, 'PG 97'), index, () => undefined);

    expect(body).toContain('Scouting report · Lifetime of this run');
    expect(body).toContain('aria-label="Open scouting report for PG 97"');
    expect(body).not.toContain('aria-label="Scout PG 97 for 2 CR"');
  });

  test('blocks a scouting purchase when the War Chest cannot cover the cheapest legal finish', () => {
    const { state, index } = lowWarChestSetup();
    const body = renderView(state, index, () => undefined);

    expect(body).toContain('Scout 2 CR · Lifetime of this run');
    expect(body).toContain('to finish');
  });
});

describe('FullCourtScoutReport', () => {
  test('quotes the paid role, shot profile, and findings with real evidence', () => {
    const { index } = setup();
    const player = index.catalog.candidates.find((candidate) => candidate.displayName === 'PG 97');
    if (player === undefined) throw new Error('missing test player PG 97');
    const body = render(FullCourtScoutReport, {
      props: {
        report: fullCourtScoutPlayer(player),
        priceDollars: 2_000_000,
        purchasedRevision: 1,
      },
    }).body;

    expect(body).toContain('Owned');
    expect(body).toContain('Lifetime of this run');
    expect(body).toContain('Secondary creator');
    expect(body).toContain('Perimeter stopper');
    expect(body).toContain('Perimeter');
    expect(body).toContain('68');
    expect(body).toContain('Poor free throw');
    expect(body).toContain('Paid 2 CR');
    expect(body).toContain('Bought at draft revision 1.');
  });
});
