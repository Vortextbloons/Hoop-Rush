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
  fullCourtEligibleCandidates,
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
  const players = fullCourtEligibleCandidates(index, seed).slice(0, FULL_COURT_MIN_ROSTER_SIZE);
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

function scoutingReportState(
  index: FullCourtCatalogIndex,
  state: FullCourtDraftState,
): FullCourtDraftState {
  return applyFullCourtCommand(
    state,
    {
      command: 'purchase-full-court-report',
      commandId: commandIdSchema.parse('cmd-scouting-report'),
      runId: state.runId,
      expectedRevision: state.revision,
      target: { kind: 'player-scouting' },
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

test('counts a dual-position pick at both positions', () => {
  const { index, state } = setup();
  const complete = completedState(index, state);
  const picks = complete.picks.map((pick, i) => ({
    ...pick,
    player: { ...pick.player, positions: i === 0 ? (['PG', 'SG'] as const) : (['C'] as const) },
  }));
  const body = renderView(fullCourtDraftStateSchema.parse({ ...complete, picks }), index);
  const coverage = body.split('aria-label="Roster position coverage"')[1]?.split('</dl>')[0];
  expect(coverage).toMatch(/>PG<\/dt>\s*<dd class="[^"]*tabular-nums">1<\/dd>/);
  expect(coverage).toMatch(/>SG<\/dt>\s*<dd class="[^"]*tabular-nums">1<\/dd>/);
});

describe('FullCourtDraftView', () => {
  test('renders a 10-card positionless round offer sorted by overall with Cap Rush card actions', () => {
    const { state, index } = setup();
    const body = renderView(state, index);
    const firstPlayer = state.offer?.cards[0]?.player;
    if (firstPlayer === undefined) throw new Error('Expected a player on the opening round offer');

    expect(body).toContain('Round 1');
    expect(body).toContain(`aria-label="Show ${firstPlayer.displayName} playstyle"`);
    expect(body).toContain(`aria-label="Sign ${firstPlayer.displayName}"`);
    expect(body).toContain(`aria-label="${firstPlayer.displayName} details"`);
    expect(body).toContain('Legal finish');
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
    expect(body).toContain('Locked');
  });

  test('gates Show playstyle behind the scouting perk on every card', () => {
    const { state, index } = setup();
    const body = renderView(state, index, () => undefined);
    const firstPlayer = state.offer?.cards[0]?.player;
    if (firstPlayer === undefined) throw new Error('Expected a player on the opening round offer');

    expect(body).toContain(`aria-label="Show ${firstPlayer.displayName} playstyle"`);
    expect(body).toContain(`disabled="" title="Buy the $5M Scouting perk to unlock playstyle"`);
    expect(body).toContain(`aria-label="${firstPlayer.displayName} details"`);
  });

  test('renders Open catalog for legacy saves without an offer or pool', () => {
    const { state, index } = setup();
    const body = renderView({ ...state, offer: undefined, pool: undefined }, index);

    expect(body).toContain('Open catalog');
    expect(body).toContain('Salary');
  });

  test('gates Show playstyle in the selected player panel until scouting is owned', () => {
    const { state, index } = setup();
    const body = renderView(
      { ...state, offer: undefined, pool: undefined },
      index,
      () => undefined,
    );

    expect(body).toContain('Show playstyle');
    expect(body).toContain('disabled="" title="Buy the $5M Scouting perk to unlock playstyle"');
  });

  test('offers one $5M scouting report instead of per-player scouting', () => {
    const { state, index } = setup();
    const body = renderView(state, index, () => undefined);

    expect(body).toContain('Scouting report');
    expect(body).toContain('Buy · $5M');
    expect(body).toContain('aria-label="Buy the $5M scouting report"');
    expect(body).not.toContain('Scout $2M');
  });

  test('unlocks the paid read and Show playstyle across the draft after the report is bought', () => {
    const { state, index } = setup();
    const body = renderView(scoutingReportState(index, state), index, () => undefined);
    const firstPlayer = state.offer?.cards[0]?.player;
    if (firstPlayer === undefined) throw new Error('Expected a player on the opening round offer');

    expect(body).toContain('Scouting report active');
    expect(body).not.toContain('aria-label="Buy the $5M scouting report"');
    expect(body).not.toContain('Scout $2M');
    expect(body).toContain(`aria-label="Show ${firstPlayer.displayName} playstyle"`);
    expect(body).not.toContain('Buy the $5M Scouting perk to unlock playstyle');
  });

  test('disables the scouting report when the budget cannot cover the cheapest legal finish', () => {
    const { state, index } = lowWarChestSetup();
    const body = renderView(state, index, () => undefined);

    expect(body).toContain('Scouting report');
    expect(body).toContain('disabled=""');
  });
});

describe('FullCourtScoutReport', () => {
  test('quotes the paid role, shot profile, and findings with real evidence', () => {
    const { index } = setup();
    const player = index.catalog.candidates.find((candidate) => candidate.displayName === 'PG 97');
    if (player === undefined) throw new Error('missing test player PG 97');
    const body = render(FullCourtScoutReport, {
      props: { report: fullCourtScoutPlayer(player) },
    }).body;

    expect(body).toContain('aria-label="Usage read"');
    expect(body).toContain('aria-label="Role read"');
    expect(body).toContain('aria-label="Shot profile"');
    expect(body).toContain('Secondary creator');
    expect(body).toContain('Perimeter stopper');
    expect(body).toContain('Perimeter');
    expect(body).toContain('68');
    expect(body).toContain('Poor free throw');
  });
});
