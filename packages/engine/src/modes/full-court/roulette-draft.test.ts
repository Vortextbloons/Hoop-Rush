import { describe, expect, it } from 'bun:test';
import type { FullCourtDraftState } from '@hoop-rush/data-contracts';
import {
  CAP_RUSH_FRANCHISE_ALIGNMENT,
  FULL_COURT_DEFAULT_MONEY,
  commandIdSchema,
  franchiseIdSchema,
  fullCourtDraftStateSchema,
  playerVersionId,
  seedSchema,
} from '@hoop-rush/data-contracts';
import { DEFAULT_ERA_SIM_PROFILE, capRushTestCatalogSource } from '@hoop-rush/test-fixtures';
import { createEngineContext } from '../../sim/kernel.ts';
import {
  drawCapRushSpin,
  CapRushSpinDrawUnavailableError,
  capRushSpinDefinitionsForTier,
} from '../cap-rush/spin.ts';
import { HAVOC_MUTATION_DEFINITIONS, teamExclusiveMutationIdsOf } from '../havoc/mutations.ts';
import { applyFullCourtCommand, createFullCourtDraftState } from './draft-commands.ts';
import { fullCourtDraftIndexOf } from './draft-catalog.ts';
import { fullCourtPayrollDollars, fullCourtPayrollStatus } from './draft-economy.ts';
import { fullCourtTestSetup, type FullCourtTestSetup } from './draft-test-support.ts';
import { checkFullCourtGameResult } from './game.ts';
import {
  buildFullCourtRegularSeason,
  fullCourtRegularSeasonGameInput,
  simulateFullCourtRegularSeasonGame,
} from './regular-season.ts';
import { lockFullCourtRegularSeason } from './season-slot.ts';
import {
  fullCourtRouletteReceipts,
  fullCourtSpinEligibility,
  fullCourtSpinPayrollDollars,
} from './roulette-draft.ts';

function commandId(prefix: string, revision: number) {
  return commandIdSchema.parse(`${prefix}-${String(revision)}`);
}

function pick(
  setup: FullCourtTestSetup,
  state: FullCourtDraftState,
  slot = 'PG',
  overall = 60,
): FullCourtDraftState {
  const player = (setup.index.bySlot.get(slot as never) ?? []).find(
    (entry) => entry.originalOverall === overall,
  );
  if (player === undefined) throw new Error(`missing ${slot} ${String(overall)}`);
  const outcome = applyFullCourtCommand(
    state,
    {
      command: 'pick-full-court-player',
      commandId: commandId(`pick-${String(state.revision)}`, state.revision),
      runId: state.runId,
      expectedRevision: state.revision,
      playerVersionId: player.playerVersionId,
    },
    { index: setup.index },
  );
  expect(outcome.result.status).toBe('accepted');
  return outcome.state;
}

function rouletteDraft(setup: FullCourtTestSetup, money = FULL_COURT_DEFAULT_MONEY) {
  let state = createFullCourtDraftState(
    { ...setup.createCommand, variant: 'roulette', money },
    setup.index,
  );
  for (const entry of [
    { slot: 'PG', overall: 60 },
    { slot: 'SG', overall: 60 },
    { slot: 'SF', overall: 60 },
    { slot: 'PF', overall: 60 },
    { slot: 'C', overall: 60 },
    { slot: 'PG', overall: 62 },
  ]) {
    state = pick(setup, state, entry.slot, entry.overall);
  }
  const outcome = applyFullCourtCommand(
    state,
    {
      command: 'finish-full-court-draft',
      commandId: commandId(`finish-${String(state.revision)}`, state.revision),
      runId: state.runId,
      expectedRevision: state.revision,
    },
    { index: setup.index },
  );
  expect(outcome.result.status).toBe('accepted');
  return outcome.state;
}

function buy(
  setup: FullCourtTestSetup,
  state: FullCourtDraftState,
  targetPlayerVersionId: string,
  purchase: 'standard' | 'surge' = 'standard',
  id = `buy-${String(state.revision)}`,
) {
  return applyFullCourtCommand(
    state,
    {
      command: 'purchase-full-court-spin',
      commandId: commandId(id, state.revision),
      runId: state.runId,
      expectedRevision: state.revision,
      purchase,
      targetPlayerVersionId,
    },
    { index: setup.index },
  );
}

function finalize(setup: FullCourtTestSetup, state: FullCourtDraftState) {
  const outcome = applyFullCourtCommand(
    state,
    {
      command: 'finalize-full-court-roulette',
      commandId: commandId(`finalize-${String(state.revision)}`, state.revision),
      runId: state.runId,
      expectedRevision: state.revision,
    },
    { index: setup.index },
  );
  expect(outcome.result.status).toBe('accepted');
  return outcome.state;
}

function denseRouletteSetup(overalls: readonly number[] = [70, 71, 72, 73, 74, 75]) {
  const setup = fullCourtTestSetup({ overalls });
  const field = CAP_RUSH_FRANCHISE_ALIGNMENT.map(({ franchiseId }) => ({
    teamId: franchiseId,
    displayName: franchiseId,
  }));
  const catalog = {
    ...setup.catalog,
    candidates: field.flatMap(({ teamId }) =>
      setup.catalog.candidates.map((player) => ({
        ...player,
        franchiseId: franchiseIdSchema.parse(teamId),
        playerVersionId: playerVersionId(player.playerId, teamId, player.eraId, player.seasonKey),
      })),
    ),
  };
  const catalogSource = capRushTestCatalogSource(catalog);
  const index = fullCourtDraftIndexOf(catalog, catalogSource);
  return { setup, field, catalog, catalogSource, index };
}

function pickSix(
  setup: FullCourtTestSetup,
  index: FullCourtTestSetup['index'],
  runSeed = setup.createCommand.runSeed,
): FullCourtDraftState {
  let draft = createFullCourtDraftState(
    {
      ...setup.createCommand,
      variant: 'roulette',
      catalog: index.catalog.source,
      runSeed,
      money: FULL_COURT_DEFAULT_MONEY,
    },
    index,
  );
  for (const candidate of setup.catalog.candidates
    .filter((player) => player.positions.primary === 'PG')
    .slice(0, 6)) {
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
      commandId: commandIdSchema.parse('finish-season'),
      runId: draft.runId,
      expectedRevision: draft.revision,
    },
    { index },
  ).state;
  return draft;
}

describe('full court roulette draft commands', () => {
  it('opens roulette after confirmation and keeps Standard drafts free of the sentinel field', () => {
    const setup = fullCourtTestSetup();
    let standard = createFullCourtDraftState(setup.createCommand, setup.index);
    standard = pick(setup, standard, 'PG', 60);
    standard = pick(setup, standard, 'SG', 60);
    standard = pick(setup, standard, 'SF', 60);
    standard = pick(setup, standard, 'PF', 60);
    standard = pick(setup, standard, 'C', 60);
    standard = pick(setup, standard, 'PG', 62);
    standard = applyFullCourtCommand(
      standard,
      {
        command: 'finish-full-court-draft',
        commandId: commandIdSchema.parse('standard-finish'),
        runId: standard.runId,
        expectedRevision: standard.revision,
      },
      { index: setup.index },
    ).state;
    expect(standard.roulette).toBeUndefined();

    const roulette = rouletteDraft(setup);
    expect(roulette.roulette).toEqual({ status: 'open', receipts: [] });
  });

  it('buys a deterministic bench spin and keeps the apron on locked payroll', () => {
    const setup = fullCourtTestSetup();
    const state = rouletteDraft(setup);
    const bench = state.picks[5]?.player;
    if (bench === undefined) throw new Error('expected a bench target');
    const payroll = fullCourtPayrollDollars(state.picks);
    const apron = fullCourtPayrollStatus(payroll, state.money);
    const outcome = buy(setup, state, bench.playerVersionId);
    expect(outcome.result.status).toBe('accepted');
    expect(outcome.state.revision).toBe(state.revision + 1);
    const benchSlot = bench.positions[0];
    if (benchSlot === undefined) throw new Error('expected a bench position');
    const receipt = fullCourtRouletteReceipts(outcome.state)[0];
    if (receipt === undefined) throw new Error('expected a spin receipt');
    expect(receipt.target).toEqual({
      playerId: bench.playerId,
      playerVersionId: bench.playerVersionId,
      slot: benchSlot,
    });
    expect(receipt.payrollDollars).toBe(payroll);
    expect(fullCourtSpinPayrollDollars(outcome.state)).toBe(payroll + receipt.priceDollars);
    expect(fullCourtPayrollStatus(fullCourtPayrollDollars(outcome.state.picks), state.money)).toBe(
      apron,
    );
    expect(outcome.state.spending).toContainEqual({
      entryId: `fcs-${receipt.receiptDigest}`,
      kind: 'spin',
      dollars: receipt.priceDollars,
      commandId: commandId(`buy-${String(state.revision)}`, state.revision),
    });

    const replay = buy(setup, state, bench.playerVersionId);
    expect(replay.state).toEqual(outcome.state);
  });

  it('adds earlier spins to cap eligibility while leaving the apron unchanged', () => {
    const setup = fullCourtTestSetup();
    let state = rouletteDraft(setup);
    const first = state.picks[0]?.player;
    const second = state.picks[5]?.player;
    if (first === undefined || second === undefined) throw new Error('expected two targets');
    const payroll = fullCourtPayrollDollars(state.picks);
    state = buy(setup, state, first.playerVersionId).state;
    const firstReceipt = state.roulette?.receipts[0];
    const secondReceipt = buy(setup, state, second.playerVersionId).state.roulette?.receipts[1];
    expect(secondReceipt?.payrollDollars).toBe(payroll + (firstReceipt?.priceDollars ?? 0));
    expect(fullCourtSpinEligibility(state, 'standard').payrollDollars).toBe(
      payroll + (firstReceipt?.priceDollars ?? 0),
    );
  });

  it('rejects cap, cash, duplicate-target, Standard, and unfinalized season starts', () => {
    const setup = fullCourtTestSetup();
    const state = rouletteDraft(setup);
    const target = state.picks[0]?.player;
    if (target === undefined) throw new Error('expected a target');

    const tightCap = fullCourtDraftStateSchema.parse({
      ...state,
      money: { ...state.money, capLineDollars: fullCourtPayrollDollars(state.picks) - 1 },
    });
    expect(buy(setup, tightCap, target.playerVersionId).result.rejection?.code).toBe(
      'spin-ineligible',
    );

    const emptyWarChest = fullCourtDraftStateSchema.parse({
      ...state,
      money: {
        ...state.money,
        startingWarChestDollars: fullCourtPayrollDollars(state.picks) + 1,
      },
    });
    expect(buy(setup, emptyWarChest, target.playerVersionId).result.rejection?.code).toBe(
      'spin-ineligible',
    );

    const bought = buy(setup, state, target.playerVersionId).state;
    expect(buy(setup, bought, target.playerVersionId).result.rejection?.code).toBe('spin-owned');

    const standard = { ...state, variant: 'standard' as const, roulette: undefined };
    expect(buy(setup, standard, target.playerVersionId).result.rejection?.code).toBe(
      'spin-unavailable',
    );

    const field = CAP_RUSH_FRANCHISE_ALIGNMENT.map(({ franchiseId }) => ({
      teamId: franchiseId,
      displayName: franchiseId,
    }));
    expect(() =>
      buildFullCourtRegularSeason({
        draft: state,
        field,
        catalog: setup.catalog,
        catalogSource: setup.source,
        profile: DEFAULT_ERA_SIM_PROFILE,
      }),
    ).toThrow('Finalize Full Court Roulette');
  });

  it('binds the receipt to the pinned player version and rejects tampered targets', () => {
    const setup = fullCourtTestSetup();
    const state = rouletteDraft(setup);
    const target = state.picks[0];
    const other = state.picks[1];
    if (target === undefined || other === undefined) throw new Error('expected two picks');
    const bought = buy(setup, state, target.player.playerVersionId).state;
    const receipt = fullCourtRouletteReceipts(bought)[0];
    if (receipt === undefined) throw new Error('expected a receipt');

    expect(
      fullCourtDraftStateSchema.safeParse({
        ...bought,
        roulette: {
          ...bought.roulette,
          receipts: [
            {
              ...receipt,
              target: {
                ...receipt.target,
                playerVersionId: other.player.playerVersionId,
              },
            },
          ],
        },
      }).success,
    ).toBe(false);
  });

  it('is idempotent for one command and rejects a stale retry after the charge', () => {
    const setup = fullCourtTestSetup();
    const state = rouletteDraft(setup);
    const target = state.picks[0]?.player;
    if (target === undefined) throw new Error('expected a target');
    const first = buy(setup, state, target.playerVersionId, 'standard', 'same-command');
    const second = buy(setup, state, target.playerVersionId, 'standard', 'same-command');
    expect(second.state).toEqual(first.state);
    expect(second.result).toEqual(first.result);
    expect(second.state.spending.filter((entry) => entry.kind === 'spin')).toHaveLength(1);

    const retry = applyFullCourtCommand(
      first.state,
      {
        command: 'purchase-full-court-spin',
        commandId: commandId('same-command', state.revision),
        runId: first.state.runId,
        expectedRevision: state.revision,
        purchase: 'standard',
        targetPlayerVersionId: target.playerVersionId,
      },
      { index: setup.index },
    );
    expect(retry.result.rejection?.code).toBe('stale-revision');
    expect(retry.state).toBe(first.state);
  });

  it('resolves the live team-exclusive collision before charging and locks the season', () => {
    const runSeed = seedSchema.parse('20f44adea05b67ca695151ec2a0d192e');
    const { setup, field, catalog, catalogSource, index } = denseRouletteSetup([
      60, 62, 65, 68, 70, 71,
    ]);
    let draft = pickSix({ ...setup, index }, index, runSeed);
    const targets = draft.picks.slice(0, 5).map((pick) => pick.player);
    expect(targets).toHaveLength(5);

    const exclusive = teamExclusiveMutationIdsOf(HAVOC_MUTATION_DEFINITIONS);
    const rawExclusive = targets.flatMap((_, ordinal) =>
      drawCapRushSpin({ runSeed, purchase: 'surge', spinOrdinal: ordinal })
        .entries.map((entry) => entry.mutationId)
        .filter((mutationId) => exclusive.has(mutationId)),
    );
    expect(rawExclusive.length).toBeGreaterThan(new Set(rawExclusive).size);

    for (const target of targets) {
      const outcome = buy(
        { ...setup, index },
        draft,
        target.playerVersionId,
        'surge',
        `surge-${String(draft.revision)}`,
      );
      expect(outcome.result.status).toBe('accepted');
      draft = outcome.state;
    }
    const receipts = fullCourtRouletteReceipts(draft);
    expect(receipts).toHaveLength(5);
    const playedExclusive = receipts
      .flatMap((receipt) => [receipt.entry, ...(receipt.additionalEntries ?? [])])
      .map((entry) => entry.mutationId)
      .filter((mutationId) => exclusive.has(mutationId));
    expect(new Set(playedExclusive).size).toBe(playedExclusive.length);

    draft = finalize({ ...setup, index }, draft);
    const season = buildFullCourtRegularSeason({
      draft,
      field,
      catalog,
      catalogSource,
      profile: DEFAULT_ERA_SIM_PROFILE,
    });
    const user = season.teams.find((team) => team.teamId === season.userTeamId);
    expect(user?.roulette?.attachments).toHaveLength(5);
    expect(() => lockFullCourtRegularSeason(season)).not.toThrow();
  });

  it('raises a typed draw error when no legal mutation remains at the drawn tier', () => {
    const tierThree = capRushSpinDefinitionsForTier(3);
    expect(() =>
      drawCapRushSpin({
        runSeed: seedSchema.parse('20f44adea05b67ca695151ec2a0d192e'),
        purchase: 'surge',
        spinOrdinal: 3,
        excludedMutationIds: new Set(tierThree),
      }),
    ).toThrow(CapRushSpinDrawUnavailableError);
  });

  it('rejects a tampered receipt profile at the season trust boundary', () => {
    const setup = fullCourtTestSetup();
    const target = rouletteDraft(setup).picks[0]?.player;
    if (target === undefined) throw new Error('expected a target');
    const bought = buy(setup, rouletteDraft(setup), target.playerVersionId).state;
    const receipt = fullCourtRouletteReceipts(bought)[0];
    if (receipt === undefined) throw new Error('expected a receipt');
    const tampered = fullCourtDraftStateSchema.parse({
      ...bought,
      roulette: {
        status: 'finalized',
        receipts: [
          {
            ...receipt,
            effective: {
              ...receipt.effective,
              ratings: { ...receipt.effective.ratings, threePoint: 99 },
            },
          },
        ],
      },
    });
    expect(() =>
      buildFullCourtRegularSeason({
        draft: tampered,
        field: [{ teamId: 'lakers', displayName: 'Lakers' }],
        catalog: setup.catalog,
        catalogSource: setup.source,
        profile: DEFAULT_ERA_SIM_PROFILE,
      }),
    ).toThrow('does not match its profile');
  });

  it('starts a roulette season with pinned attachments and plays the user fixture', () => {
    const setup = fullCourtTestSetup({ overalls: [70, 71, 72, 73, 74, 75] });
    const field = CAP_RUSH_FRANCHISE_ALIGNMENT.map(({ franchiseId }) => ({
      teamId: franchiseId,
      displayName: franchiseId,
    }));
    const catalog = {
      ...setup.catalog,
      candidates: field.flatMap(({ teamId }) =>
        setup.catalog.candidates.map((player) => ({
          ...player,
          franchiseId: franchiseIdSchema.parse(teamId),
          playerVersionId: playerVersionId(player.playerId, teamId, player.eraId, player.seasonKey),
        })),
      ),
    };
    const catalogSource = capRushTestCatalogSource(catalog);
    const index = fullCourtDraftIndexOf(catalog, catalogSource);
    let draft = createFullCourtDraftState(
      {
        ...setup.createCommand,
        variant: 'roulette',
        catalog: catalogSource,
        money: FULL_COURT_DEFAULT_MONEY,
      },
      index,
    );
    const chosen = setup.catalog.candidates.filter((player) => player.positions.primary === 'PG');
    for (const candidate of chosen.slice(0, 6)) {
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
        commandId: commandIdSchema.parse('finish-season'),
        runId: draft.runId,
        expectedRevision: draft.revision,
      },
      { index },
    ).state;
    const bench = draft.picks[5]?.player;
    if (bench === undefined) throw new Error('expected a bench target');
    draft = buy({ ...setup, index }, draft, bench.playerVersionId).state;
    expect(draft.roulette?.receipts).toHaveLength(1);
    draft = finalize({ ...setup, index }, draft);

    const season = buildFullCourtRegularSeason({
      draft,
      field,
      catalog,
      catalogSource,
      profile: DEFAULT_ERA_SIM_PROFILE,
    });
    const user = season.teams.find((team) => team.teamId === season.userTeamId);
    expect(user?.roulette?.attachments).toHaveLength(1);
    expect(user?.roulette?.attachments[0]?.playerVersionId).toBe(bench.playerVersionId);

    const fixture = season.games.find(
      (game) => game.homeTeamId === season.userTeamId || game.awayTeamId === season.userTeamId,
    );
    if (fixture === undefined) throw new Error('missing user fixture');
    const input = fullCourtRegularSeasonGameInput(season, fixture.gameId);
    const userSide = input.home.teamId === season.userTeamId ? 'home' : 'away';
    expect(input[userSide].roulette?.attachments).toHaveLength(1);
    const outcome = simulateFullCourtRegularSeasonGame(
      season,
      fixture.gameId,
      createEngineContext(),
    );
    if (outcome.kind !== 'played') throw new Error('expected the user fixture to play');
    expect(checkFullCourtGameResult(outcome.result)).toEqual([]);
  });
});
