import { describe, expect, it } from 'bun:test';
import type { FullCourtDraftState } from '@hoop-rush/data-contracts';
import {
  FULL_COURT_DEFAULT_MONEY,
  POSITIONS,
  commandIdSchema,
  fullCourtMoneyConfigSchema,
} from '@hoop-rush/data-contracts';
import { applyFullCourtCommand, createFullCourtDraftState } from './draft-commands.ts';
import {
  fullCourtAssessPick,
  fullCourtDepthForecast,
  fullCourtPayrollDollars,
} from './draft-economy.ts';
import {
  fullCourtDraftIndexOf,
  fullCourtEligibleCandidates,
  fullCourtPlayerOf,
  fullCourtSalaryDollarsOf,
} from './draft-catalog.ts';
import { fullCourtStateDigest } from './state-digest.ts';
import { fullCourtTestSetup, type FullCourtTestSetup } from './draft-test-support.ts';

function commandId(prefix: string, revision: number) {
  return commandIdSchema.parse(`${prefix}-${String(revision)}`);
}

function cheapest(setup: FullCourtTestSetup, overall = 60, slot = 'PG') {
  const player = (setup.index.bySlot.get(slot as never) ?? []).find(
    (entry) => entry.originalOverall === overall,
  );
  if (player === undefined) throw new Error(`missing ${slot} ${String(overall)}`);
  return { player, salaryDollars: fullCourtSalaryDollarsOf(player) };
}

function pick(
  setup: FullCourtTestSetup,
  state: FullCourtDraftState,
  overall = 60,
  slot = 'PG',
): FullCourtDraftState {
  const { player } = cheapest(setup, overall, slot);
  const outcome = applyFullCourtCommand(
    state,
    {
      command: 'pick-full-court-player',
      commandId: commandId(`cmd-pick-${String(state.revision)}`, state.revision),
      runId: state.runId,
      expectedRevision: state.revision,
      playerVersionId: player.playerVersionId,
    },
    { index: setup.index },
  );
  expect(outcome.result.status).toBe('accepted');
  return outcome.state;
}

function sixPickState(setup: FullCourtTestSetup, money = FULL_COURT_DEFAULT_MONEY) {
  let state = createFullCourtDraftState({ ...setup.createCommand, money }, setup.index);
  const entries: Array<{ slot: string; overall: number }> = [
    { slot: 'PG', overall: 60 },
    { slot: 'SG', overall: 60 },
    { slot: 'SF', overall: 60 },
    { slot: 'PF', overall: 60 },
    { slot: 'C', overall: 60 },
    { slot: 'PG', overall: 62 },
  ];
  for (const entry of entries) state = pick(setup, state, entry.overall, entry.slot);
  return state;
}

describe('full court create', () => {
  it('creates a drafting state with no picks and no spending', () => {
    const setup = fullCourtTestSetup();
    expect(setup.state.revision).toBe(1);
    expect(setup.state.stage).toBe('drafting');
    expect(setup.state.picks).toEqual([]);
    expect(setup.state.spending).toEqual([]);
    expect(setup.state.variant).toBe('standard');
    expect(setup.state.money).toEqual(FULL_COURT_DEFAULT_MONEY);
  });

  it('preserves the requested variant and money config', () => {
    const setup = fullCourtTestSetup();
    const money = fullCourtMoneyConfigSchema.parse({
      ...FULL_COURT_DEFAULT_MONEY,
      startingWarChestDollars: 123_000_000,
    });
    const state = createFullCourtDraftState({ ...setup.createCommand, money }, setup.index);
    expect(state.variant).toBe('standard');
    expect(state.money).toEqual(money);
  });

  it('rejects a catalog mismatch instead of creating a state', () => {
    const setup = fullCourtTestSetup();
    const differentSource = { ...setup.source, catalogHash: 'f'.repeat(64) };
    expect(() =>
      createFullCourtDraftState({ ...setup.createCommand, catalog: differentSource }, setup.index),
    ).toThrow(/catalog source mismatch/);
    expect(() => fullCourtDraftIndexOf(setup.catalog, differentSource)).toThrow(
      /catalog source mismatch/,
    );
  });

  it('rejects a budget that cannot afford the starting roster', () => {
    const setup = fullCourtTestSetup();
    const money = fullCourtMoneyConfigSchema.parse({
      ...FULL_COURT_DEFAULT_MONEY,
      startingWarChestDollars: 1,
    });
    expect(() => createFullCourtDraftState({ ...setup.createCommand, money }, setup.index)).toThrow(
      'cannot fill a legal six-player roster',
    );
  });

  it('rejects a second create for the same run', () => {
    const setup = fullCourtTestSetup();
    const outcome = applyFullCourtCommand(setup.state, setup.createCommand, {
      index: setup.index,
    });
    expect(outcome.result.status).toBe('rejected');
    expect(outcome.result.rejection?.code).toBe('phase-mismatch');
    expect(outcome.state).toBe(setup.state);
  });
});

describe('full court picking', () => {
  it('adds a pick with its salary ledger entry and bumps the revision', () => {
    const setup = fullCourtTestSetup();
    const { player, salaryDollars } = cheapest(setup, 60, 'PG');
    const outcome = applyFullCourtCommand(
      setup.state,
      {
        command: 'pick-full-court-player',
        commandId: commandId('cmd-pick', setup.state.revision),
        runId: setup.state.runId,
        expectedRevision: setup.state.revision,
        playerVersionId: player.playerVersionId,
      },
      { index: setup.index },
    );
    expect(outcome.result.status).toBe('accepted');
    expect(outcome.state.revision).toBe(2);
    expect(outcome.state.picks).toHaveLength(1);
    expect(outcome.state.picks[0]?.player.playerVersionId).toBe(player.playerVersionId);
    expect(outcome.state.picks[0]?.salaryDollars).toBe(salaryDollars);
    expect(outcome.state.spending).toHaveLength(1);
    expect(outcome.state.spending[0]?.playerVersionId).toBe(player.playerVersionId);
    expect(fullCourtPayrollDollars(outcome.state.picks)).toBe(salaryDollars);
  });

  it('rejects a second pick for the same player in both preview and execution', () => {
    const setup = fullCourtTestSetup();
    const state = pick(setup, setup.state, 60, 'PG');
    const second = cheapest(setup, 62, 'PG');
    const outcome = applyFullCourtCommand(
      state,
      {
        command: 'pick-full-court-player',
        commandId: commandId('cmd-dupe', state.revision),
        runId: state.runId,
        expectedRevision: state.revision,
        playerVersionId: second.player.playerVersionId,
      },
      { index: setup.index },
    );
    expect(outcome.result.status).toBe('accepted');
    const firstPlayer = state.picks[0]?.player;
    if (firstPlayer === undefined) throw new Error('missing first pick');
    expect(
      fullCourtAssessPick({
        index: setup.index,
        state,
        playerId: firstPlayer.playerId,
        salaryDollars: fullCourtSalaryDollarsOf(firstPlayer),
      }).reason,
    ).toBe('duplicate-player');
    const repeat = applyFullCourtCommand(
      state,
      {
        command: 'pick-full-court-player',
        commandId: commandId('cmd-repeat', state.revision),
        runId: state.runId,
        expectedRevision: state.revision,
        playerVersionId: firstPlayer.playerVersionId,
      },
      { index: setup.index },
    );
    expect(repeat.result.status).toBe('rejected');
    expect(repeat.result.rejection?.code).toBe('duplicate-player');
  });

  it('returns a rejection when a new pick reuses a charged command ID', () => {
    const setup = fullCourtTestSetup();
    const state = pick(setup, setup.state);
    const charge = state.spending[0];
    if (charge === undefined) throw new Error('Missing first pick charge');
    const outcome = applyFullCourtCommand(
      state,
      {
        command: 'pick-full-court-player',
        commandId: charge.commandId,
        runId: state.runId,
        expectedRevision: state.revision,
        playerVersionId: cheapest(setup, 62).player.playerVersionId,
      },
      { index: setup.index },
    );
    expect(outcome.result.rejection?.code).toBe('command-conflict');
    expect(outcome.state).toBe(state);
  });

  it('rejects a player version that is not in the loaded catalog', () => {
    const setup = fullCourtTestSetup();
    const outcome = applyFullCourtCommand(
      setup.state,
      {
        command: 'pick-full-court-player',
        commandId: commandId('cmd-unknown', setup.state.revision),
        runId: setup.state.runId,
        expectedRevision: setup.state.revision,
        playerVersionId: `pv-${'f'.repeat(32)}`,
      },
      { index: setup.index },
    );
    expect(outcome.result.rejection?.code).toBe('player-unavailable');
    expect(outcome.state).toBe(setup.state);
  });

  it('rejects a stale revision without changing state', () => {
    const setup = fullCourtTestSetup();
    const { player } = cheapest(setup);
    const outcome = applyFullCourtCommand(
      setup.state,
      {
        command: 'pick-full-court-player',
        commandId: commandId('cmd-stale', setup.state.revision),
        runId: setup.state.runId,
        expectedRevision: setup.state.revision - 1,
        playerVersionId: player.playerVersionId,
      },
      { index: setup.index },
    );
    expect(outcome.result.rejection?.code).toBe('stale-revision');
    expect(outcome.state).toBe(setup.state);
  });

  it('rejects a pick that cannot complete a legal six-player roster', () => {
    const setup = fullCourtTestSetup();
    const money = fullCourtMoneyConfigSchema.parse({
      ...FULL_COURT_DEFAULT_MONEY,
      capLineDollars: 80_000_000,
      firstApronDollars: 82_000_000,
      hardLimitDollars: 85_000_000,
    });
    const state = createFullCourtDraftState({ ...setup.createCommand, money }, setup.index, {
      pool: 'open',
    });
    const star = cheapest(setup, 99, 'PG').player;
    const outcome = applyFullCourtCommand(
      state,
      {
        command: 'pick-full-court-player',
        commandId: commandId('cmd-broke', state.revision),
        runId: state.runId,
        expectedRevision: state.revision,
        playerVersionId: star.playerVersionId,
      },
      { index: setup.index },
    );
    expect(outcome.result.status).toBe('rejected');
    expect(outcome.result.rejection?.code).toBe('budget-rejected');
    expect(outcome.state).toBe(state);
  });

  it('drafts twelve players and rejects a thirteenth', () => {
    const setup = fullCourtTestSetup();
    const money = fullCourtMoneyConfigSchema.parse({
      ...FULL_COURT_DEFAULT_MONEY,
      startingWarChestDollars: 500_000_000,
    });
    let state = createFullCourtDraftState({ ...setup.createCommand, money }, setup.index);
    const overalls = [60, 60, 60, 60, 60, 62, 62, 62, 62, 62, 65, 65];
    for (const [ordinal, overall] of overalls.entries()) {
      state = pick(setup, state, overall, POSITIONS[ordinal % POSITIONS.length] ?? 'PG');
    }
    expect(state.picks).toHaveLength(12);
    expect(state.picks.every((entry, index) => entry.pickOrdinal === index)).toBe(true);
    const extra = cheapest(setup, 65, 'C');
    expect(
      fullCourtAssessPick({
        index: setup.index,
        state,
        playerId: extra.player.playerId,
        salaryDollars: extra.salaryDollars,
      }).reason,
    ).toBe('roster-full');
    expect(fullCourtDepthForecast({ index: setup.index, state })).toEqual({
      missingPlayers: 0,
      costDollars: null,
    });
    expect(state.picks.some((entry) => entry.player.playerId === extra.player.playerId)).toBe(
      false,
    );
    const outcome = applyFullCourtCommand(
      state,
      {
        command: 'pick-full-court-player',
        commandId: commandId('cmd-13', state.revision),
        runId: state.runId,
        expectedRevision: state.revision,
        playerVersionId: extra.player.playerVersionId,
      },
      { index: setup.index },
    );
    expect(outcome.result.rejection?.code).toBe('roster-full');
  });
});

describe('full court removing picks', () => {
  it('removes a pick, refunds its salary, and renumbers the ordinals', () => {
    const setup = fullCourtTestSetup();
    let state = pick(setup, setup.state, 60, 'PG');
    state = pick(setup, state, 60, 'SG');
    const removed = state.picks[0];
    if (removed === undefined) throw new Error('missing pick');
    const outcome = applyFullCourtCommand(
      state,
      {
        command: 'remove-full-court-player',
        commandId: commandId('cmd-remove', state.revision),
        runId: state.runId,
        expectedRevision: state.revision,
        playerVersionId: removed.player.playerVersionId,
      },
      { index: setup.index },
    );
    expect(outcome.result.status).toBe('accepted');
    expect(outcome.state.picks).toHaveLength(1);
    expect(outcome.state.picks[0]?.pickOrdinal).toBe(0);
    expect(outcome.state.spending).toHaveLength(1);
    expect(outcome.state.spending[0]?.playerVersionId).toBe(
      outcome.state.picks[0]?.player.playerVersionId,
    );
    expect(fullCourtPayrollDollars(outcome.state.picks)).toBe(
      outcome.state.spending.reduce((total, entry) => total + entry.dollars, 0),
    );
  });

  it('rejects removing a player who is not rostered', () => {
    const setup = fullCourtTestSetup();
    const { player } = cheapest(setup);
    const outcome = applyFullCourtCommand(
      setup.state,
      {
        command: 'remove-full-court-player',
        commandId: commandId('cmd-remove-missing', setup.state.revision),
        runId: setup.state.runId,
        expectedRevision: setup.state.revision,
        playerVersionId: player.playerVersionId,
      },
      { index: setup.index },
    );
    expect(outcome.result.rejection?.code).toBe('player-not-rostered');
  });

  it('never charges a player twice when re-added after removal', () => {
    const setup = fullCourtTestSetup();
    let state = pick(setup, setup.state, 60, 'PG');
    const added = state.picks[0];
    if (added === undefined) throw new Error('missing pick');
    const firstEntry = state.spending[0];
    if (firstEntry === undefined) throw new Error('missing salary entry');
    state = applyFullCourtCommand(
      state,
      {
        command: 'remove-full-court-player',
        commandId: commandId('cmd-remove', state.revision),
        runId: state.runId,
        expectedRevision: state.revision,
        playerVersionId: added.player.playerVersionId,
      },
      { index: setup.index },
    ).state;
    expect(state.spending).toEqual([]);
    state = pick(setup, state, 60, 'PG');
    expect(state.spending).toHaveLength(1);
    expect(state.spending[0]?.entryId).toBe(firstEntry.entryId);
    expect(fullCourtPayrollDollars(state.picks)).toBe(added.salaryDollars);
  });
});

describe('full court finishing', () => {
  it('rejects finishing with fewer than six picks', () => {
    const setup = fullCourtTestSetup();
    const state = pick(setup, setup.state, 60, 'PG');
    const outcome = applyFullCourtCommand(
      state,
      {
        command: 'finish-full-court-draft',
        commandId: commandId('cmd-finish-early', state.revision),
        runId: state.runId,
        expectedRevision: state.revision,
      },
      { index: setup.index },
    );
    expect(outcome.result.rejection?.code).toBe('roster-too-small');
    expect(outcome.state).toBe(state);
  });

  it('confirms six players at the same position and then refuses roster edits', () => {
    const setup = fullCourtTestSetup();
    let state = setup.state;
    for (const overall of [60, 62, 65, 68, 70, 71]) state = pick(setup, state, overall, 'PG');
    const finished = applyFullCourtCommand(
      state,
      {
        command: 'finish-full-court-draft',
        commandId: commandId('cmd-finish', state.revision),
        runId: state.runId,
        expectedRevision: state.revision,
      },
      { index: setup.index },
    );
    expect(finished.result.status).toBe('accepted');
    expect(finished.state.stage).toBe('complete');
    const extra = cheapest(setup, 65, 'C');
    const rejectedPick = applyFullCourtCommand(
      finished.state,
      {
        command: 'pick-full-court-player',
        commandId: commandId('cmd-after-finish', finished.state.revision),
        runId: finished.state.runId,
        expectedRevision: finished.state.revision,
        playerVersionId: extra.player.playerVersionId,
      },
      { index: setup.index },
    );
    expect(rejectedPick.result.rejection?.code).toBe('phase-mismatch');
    const removed = finished.state.picks[0];
    if (removed === undefined) throw new Error('missing pick');
    const rejectedRemove = applyFullCourtCommand(
      finished.state,
      {
        command: 'remove-full-court-player',
        commandId: commandId('cmd-remove-after-finish', finished.state.revision),
        runId: finished.state.runId,
        expectedRevision: finished.state.revision,
        playerVersionId: removed.player.playerVersionId,
      },
      { index: setup.index },
    );
    expect(rejectedRemove.result.rejection?.code).toBe('phase-mismatch');
  });

  it('rejects a second finish', () => {
    const setup = fullCourtTestSetup();
    const state = sixPickState(setup);
    const finished = applyFullCourtCommand(
      state,
      {
        command: 'finish-full-court-draft',
        commandId: commandId('cmd-finish', state.revision),
        runId: state.runId,
        expectedRevision: state.revision,
      },
      { index: setup.index },
    ).state;
    const again = applyFullCourtCommand(
      finished,
      {
        command: 'finish-full-court-draft',
        commandId: commandId('cmd-finish-again', finished.revision),
        runId: finished.runId,
        expectedRevision: finished.revision,
      },
      { index: setup.index },
    );
    expect(again.result.rejection?.code).toBe('phase-mismatch');
  });
});

describe('full court command determinism', () => {
  it('replays identical commands to an identical state and digest', () => {
    const setup = fullCourtTestSetup();
    const left = sixPickState(setup);
    const right = sixPickState(setup);
    expect(right).toEqual(left);
    expect(fullCourtStateDigest(right)).toBe(fullCourtStateDigest(left));
  });

  it('keeps catalog-loaded player records intact across a pick', () => {
    const setup = fullCourtTestSetup();
    const { player } = cheapest(setup);
    const state = pick(setup, setup.state);
    const signed = state.picks[0]?.player;
    if (signed === undefined) throw new Error('missing pick');
    const catalogued = fullCourtPlayerOf(setup.index, player.playerVersionId);
    if (catalogued === null) throw new Error('missing catalogued player');
    expect(signed).toEqual(catalogued);
    expect(state.spending[0]?.commandId).toBe(commandId('cmd-pick-1', 1));
  });
});

describe('full court seeded finite draft pool', () => {
  it('assigns a versioned deterministic pool to standard drafts', () => {
    const setup = fullCourtTestSetup();
    const standard = createFullCourtDraftState(setup.createCommand, setup.index);

    expect(standard.pool).toBeDefined();
    expect(standard.pool?.playerVersionIds.length ?? 0).toBeGreaterThanOrEqual(60);
    expect(standard.pool?.playerVersionIds.length ?? 0).toBeLessThanOrEqual(90);
  });

  it('rejects picks and player scouting outside the draft pool', () => {
    const setup = fullCourtTestSetup();
    const poolSet = new Set(setup.state.pool?.playerVersionIds ?? []);
    const outside = setup.index.catalog.candidates.find(
      (candidate) => !poolSet.has(candidate.playerVersionId),
    );
    expect(outside).toBeDefined();
    if (outside === undefined) return;

    const pickOutcome = applyFullCourtCommand(
      setup.state,
      {
        command: 'pick-full-court-player',
        commandId: commandId('cmd-outside-pick', setup.state.revision),
        runId: setup.state.runId,
        expectedRevision: setup.state.revision,
        playerVersionId: outside.playerVersionId,
      },
      { index: setup.index },
    );
    expect(pickOutcome.result.status).toBe('rejected');
    expect(pickOutcome.result.rejection?.code).toBe('player-unavailable');

    const scoutOutcome = applyFullCourtCommand(
      setup.state,
      {
        command: 'purchase-full-court-report',
        commandId: commandId('cmd-outside-scout', setup.state.revision),
        runId: setup.state.runId,
        expectedRevision: setup.state.revision,
        target: { kind: 'player-scouting', playerVersionId: outside.playerVersionId },
      },
      { index: setup.index },
    );
    expect(scoutOutcome.result.status).toBe('rejected');
    expect(scoutOutcome.result.rejection?.code).toBe('player-unavailable');
  });

  it('preserves open catalog behavior for legacy saves without a pool', () => {
    const setup = fullCourtTestSetup();
    const legacy = createFullCourtDraftState(setup.createCommand, setup.index, { pool: 'open' });
    expect(legacy.pool).toBeUndefined();

    const anyCandidate = setup.index.catalog.candidates[0];
    if (anyCandidate === undefined) throw new Error('Expected a candidate in the legacy catalog');
    const pickOutcome = applyFullCourtCommand(
      legacy,
      {
        command: 'pick-full-court-player',
        commandId: commandId('cmd-legacy-pick', legacy.revision),
        runId: legacy.runId,
        expectedRevision: legacy.revision,
        playerVersionId: anyCandidate.playerVersionId,
      },
      { index: setup.index },
    );
    expect(pickOutcome.result.status).toBe('accepted');
  });

  it('computes minimum completion and depth forecast from the pool rather than excluded catalog players', () => {
    const setup = fullCourtTestSetup();
    const poolVersion = setup.state.pool?.poolVersion;
    if (poolVersion === undefined) throw new Error('Expected a seeded draft pool');

    // A pool of only the 6 most expensive players in the pool cannot be cheaper than the global catalog.
    const poolPlayers = fullCourtEligibleCandidates(setup.index, setup.state)
      .slice()
      .sort((a, b) => b.originalOverall - a.originalOverall)
      .slice(0, 6);
    const restrictedState = {
      ...setup.state,
      pool: {
        poolVersion,
        playerVersionIds: poolPlayers.map((p) => p.playerVersionId),
      },
    };
    const poolForecast = fullCourtDepthForecast({ index: setup.index, state: restrictedState });
    const openForecast = fullCourtDepthForecast({
      index: setup.index,
      state: { ...setup.state, pool: undefined },
    });
    expect(poolForecast.costDollars).not.toBeNull();
    expect(openForecast.costDollars).not.toBeNull();
    expect(poolForecast.costDollars ?? 0).toBeGreaterThan(openForecast.costDollars ?? 0);
  });
});
