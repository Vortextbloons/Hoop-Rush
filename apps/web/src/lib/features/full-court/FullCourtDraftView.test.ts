import { describe, expect, test } from 'bun:test';
import type { FullCourtDraftState } from '@hoop-rush/data-contracts';
import {
  commandIdSchema,
  fullCourtCreateDraftCommandSchema,
  idSchema,
  seedSchema,
} from '@hoop-rush/data-contracts';
import {
  createFullCourtDraftState,
  fullCourtDraftIndexOf,
  fullCourtSalaryDollarsOf,
  type FullCourtCatalogIndex,
} from '@hoop-rush/engine';
import { buildCapRushTestCatalog, capRushTestCatalogSource } from '@hoop-rush/test-fixtures';
import { render } from 'svelte/server';
import FullCourtDraftView from './FullCourtDraftView.svelte';
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

function renderView(state: FullCourtDraftState, index: FullCourtCatalogIndex): string {
  return render(FullCourtDraftView, {
    props: {
      draft: state,
      index,
      busy: false,
      onPick: () => undefined,
      onRemove: () => undefined,
      onFinish: () => undefined,
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
});
