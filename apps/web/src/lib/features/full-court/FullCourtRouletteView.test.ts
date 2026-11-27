import { describe, expect, test } from 'bun:test';
import {
  commandIdSchema,
  fullCourtCreateDraftCommandSchema,
  fullCourtDraftStateSchema,
  idSchema,
  seedSchema,
  type FullCourtDraftState,
} from '@hoop-rush/data-contracts';
import {
  applyFullCourtCommand,
  createFullCourtDraftState,
  fullCourtDraftIndexOf,
  fullCourtSalaryDollarsOf,
  type FullCourtCatalogIndex,
} from '@hoop-rush/engine';
import { buildCapRushTestCatalog, capRushTestCatalogSource } from '@hoop-rush/test-fixtures';
import { render } from 'svelte/server';
import FullCourtRouletteView from './FullCourtRouletteView.svelte';

function setup(): { index: FullCourtCatalogIndex; draft: FullCourtDraftState } {
  const catalog = buildCapRushTestCatalog();
  const source = capRushTestCatalogSource(catalog);
  const index = fullCourtDraftIndexOf(catalog, source);
  const seed = createFullCourtDraftState(
    fullCourtCreateDraftCommandSchema.parse({
      command: 'create-full-court-draft',
      commandId: commandIdSchema.parse('cmd-roulette-view'),
      runId: idSchema.parse('run-roulette-view'),
      runSeed: seedSchema.parse('abc123def4567890'),
      variant: 'roulette',
      catalog: source,
    }),
    index,
    { pool: 'open' },
  );
  const picks = index.catalog.candidates.slice(0, 6).map((player, pickOrdinal) => ({
    pickOrdinal,
    player,
    salaryDollars: fullCourtSalaryDollarsOf(player),
  }));
  return {
    index,
    draft: fullCourtDraftStateSchema.parse({
      ...seed,
      stage: 'complete',
      picks,
      spending: picks.map((pick, ordinal) => ({
        entryId: `fcs-${String(ordinal).padStart(32, '0')}`,
        kind: 'salary',
        dollars: pick.salaryDollars,
        commandId: commandIdSchema.parse(`cmd-roulette-salary-${String(ordinal)}`),
        playerVersionId: pick.player.playerVersionId,
      })),
      roulette: { status: 'open', receipts: [] },
    }),
  };
}

function renderView(draft: FullCourtDraftState, index: FullCourtCatalogIndex): string {
  return render(FullCourtRouletteView, {
    props: {
      draft,
      index,
      busy: false,
      onPurchaseSpin: () => undefined,
      onSkipSpin: () => undefined,
      onFinalize: () => undefined,
      onPurchaseReport: () => undefined,
    },
  }).body;
}

describe('FullCourtRouletteView preseason preparation', () => {
  test('offers roster fit and training camp before spins are finalized', () => {
    const { draft, index } = setup();
    const body = renderView(draft, index);

    expect(body).toContain('aria-label="Full Court Roulette roster fit"');
    expect(body).toContain('Buy roster fit');
    expect(body).toContain('5 CR');
    expect(body).toContain('aria-label="Full Court Roulette training camp"');
    expect(body).toContain('Book training camp');
    expect(body).toContain('10 CR');
    expect(body).not.toContain('Owned');

    const campBooked = applyFullCourtCommand(
      draft,
      {
        command: 'purchase-full-court-report',
        commandId: commandIdSchema.parse('cmd-roulette-camp'),
        runId: draft.runId,
        expectedRevision: draft.revision,
        target: { kind: 'training-camp' },
      },
      { index },
    ).state;
    const booked = renderView(campBooked, index);
    expect(booked).toContain('Booked');
    expect(booked).toContain('Practice opens after the roster is finalized and before game 1.');
    expect(booked).not.toContain('Book training camp');
  });

  test('shows the run-level fit report once bought before spins', () => {
    const { draft, index } = setup();
    const purchased = applyFullCourtCommand(
      draft,
      {
        command: 'purchase-full-court-report',
        commandId: commandIdSchema.parse('cmd-roulette-fit'),
        runId: draft.runId,
        expectedRevision: draft.revision,
        target: { kind: 'lineup-fit' },
      },
      { index },
    ).state;
    const body = renderView(purchased, index);

    expect(body).toContain('Owned');
    expect(body).toContain('aria-label="Roster strengths"');
    expect(body).toContain('aria-label="Roster gaps"');
    expect(body).not.toContain('Buy roster fit');
  });
});
