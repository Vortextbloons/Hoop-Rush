import { afterEach, describe, expect, it } from 'vitest';
import {
  SEASON_RUN_SCHEMA_VERSION,
  normalizeSponsorGearState,
  type SeasonRun,
  type SeasonRunCommand,
} from '@hoop-rush/data-contracts';
import { createInitialSponsorGearState, handleSeasonRunCommand } from '@hoop-rush/engine';
import { SEASON_RUN_RECORD_ID } from '../schemas/season-run-record.ts';
import { DexieSeasonRunRepository } from './season-run-dexie.ts';
import {
  TestDatabase,
  resetIndexedDb,
  restoreIndexedDb,
  testDatabaseName,
} from '../testing/repo-test-support.ts';
import {
  buildFixtureEffectsState,
  buildFixtureStateDigest,
  buildFixtureStoredDraft,
  buildStubSeasonEngineSeam,
} from '../testing/season-run-fixture.ts';
import { buildFullSeasonDataset } from '../benchmark/season-run.ts';
import { SeasonRunCommandDuplicateError } from './season-run.ts';

const HUMAN = 'lakers';

function makeAdapters() {
  const db = new TestDatabase(testDatabaseName('season-run-sponsors'));
  const seam = buildStubSeasonEngineSeam();
  const dataset = buildFullSeasonDataset({
    seam,
    runId: 'season-run-sponsors-test',
  });
  const repo = new DexieSeasonRunRepository(db, {
    schedule: dataset.schedule,
    seam,
  });
  return { db, repo, ...dataset };
}

function sponsoredRun(run: SeasonRun): SeasonRun {
  const next = { ...run, sponsors: createInitialSponsorGearState(run.rootSeed) };
  return { ...next, stateDigest: buildFixtureStateDigest(next) };
}

async function promote(adapters: ReturnType<typeof makeAdapters>, run: SeasonRun): Promise<void> {
  await adapters.repo.promoteSeasonDraftToRun(buildFixtureStoredDraft(run), run);
}

function buySponsor(
  run: SeasonRun,
  instanceId: string,
  commandId: string,
): { command: SeasonRunCommand; output: ReturnType<typeof handleSeasonRunCommand> } {
  const command = {
    schemaVersion: SEASON_RUN_SCHEMA_VERSION,
    command: 'buy-sponsor',
    commandId,
    runId: run.runId,
    expectedStateRevision: run.stateRevision,
    expectedStateDigest: run.stateDigest,
    instanceId,
  } as unknown as SeasonRunCommand;
  const output = handleSeasonRunCommand(command, {
    run,
    pending: null,
    humanFranchiseId: HUMAN,
    effects: buildFixtureEffectsState(run.rosters),
  });
  return { command, output };
}

function applySponsor(
  run: SeasonRun,
  instanceId: string,
  playerVersionId: string,
  slot: 'shoe' | 'apparel' | 'fuel',
  commandId: string,
): { command: SeasonRunCommand; output: ReturnType<typeof handleSeasonRunCommand> } {
  const command = {
    schemaVersion: SEASON_RUN_SCHEMA_VERSION,
    command: 'apply-sponsor',
    commandId,
    runId: run.runId,
    expectedStateRevision: run.stateRevision,
    expectedStateDigest: run.stateDigest,
    instanceId,
    playerVersionId,
    slot,
  } as unknown as SeasonRunCommand;
  const output = handleSeasonRunCommand(command, {
    run,
    pending: null,
    humanFranchiseId: HUMAN,
    effects: buildFixtureEffectsState(run.rosters),
  });
  return { command, output };
}

function acceptedResult(output: ReturnType<typeof handleSeasonRunCommand>, command: string) {
  if (output.result.command !== command) throw new Error(`wrong command ${output.result.command}`);
  if (output.result.result.status !== 'accepted') {
    throw new Error(`expected acceptance: ${JSON.stringify(output.result.result)}`);
  }
  return output.run;
}

describe('sponsor gear persistence', () => {
  afterEach(async () => {
    await resetIndexedDb();
    restoreIndexedDb();
  });

  it('persists the dealt board through promote and reload', async () => {
    const adapters = makeAdapters();
    const run = sponsoredRun(adapters.run);
    await promote(adapters, run);
    const stored = await adapters.db.seasonRuns.get(SEASON_RUN_RECORD_ID);
    expect(stored?.sponsors?.boards.boards).toHaveLength(1);
    expect(stored?.run.sponsors?.boards.boards).toHaveLength(1);
    const snapshot = await adapters.repo.loadActiveRun();
    const boards = normalizeSponsorGearState(snapshot?.run.sponsors).boards.boards;
    expect(boards).toHaveLength(1);
    expect(boards[0]?.offers).toHaveLength(5);
  });

  it('commits a sponsor purchase and application atomically with reload', async () => {
    const adapters = makeAdapters();
    const run = sponsoredRun(adapters.run);
    await promote(adapters, run);
    const board = normalizeSponsorGearState(run.sponsors).boards.boards[0];
    const offer = board?.offers.find((candidate) => candidate.price === 1);
    if (board === undefined || offer === undefined) throw new Error('no BUZZ offer dealt');
    const bought = buySponsor(run, offer.instanceId, 'cmd-spon-buy-1');
    const boughtRun = acceptedResult(bought.output, 'buy-sponsor');
    await adapters.repo.applySeasonRunCommand({
      runId: run.runId,
      command: bought.command,
      run: boughtRun,
      pending: null,
    });
    const player = boughtRun.rosters.find((entry) => entry.franchiseId === HUMAN)?.players[0]
      ?.playerVersionId;
    if (player === undefined) throw new Error('human roster is empty');
    const applied = applySponsor(
      boughtRun,
      offer.instanceId,
      player,
      offer.slot,
      'cmd-spon-apply-1',
    );
    const appliedRun = acceptedResult(applied.output, 'apply-sponsor');
    await adapters.repo.applySeasonRunCommand({
      runId: run.runId,
      command: applied.command,
      run: appliedRun,
      pending: null,
    });
    const snapshot = await adapters.repo.loadActiveRun();
    const sponsors = normalizeSponsorGearState(snapshot?.run.sponsors);
    expect(sponsors.vault.items).toHaveLength(0);
    expect(sponsors.players.slots[player]?.[offer.slot]?.instanceId).toBe(offer.instanceId);
    expect(sponsors.boards.boards[0]?.purchasedInstanceIds).toEqual([offer.instanceId]);
    await expect(
      adapters.repo.applySeasonRunCommand({
        runId: run.runId,
        command: {
          ...applied.command,
          expectedStateRevision: appliedRun.stateRevision,
          expectedStateDigest: appliedRun.stateDigest,
        },
        run: appliedRun,
        pending: null,
      }),
    ).rejects.toThrow(SeasonRunCommandDuplicateError);
  });

  it('backfills empty sponsor state for runs stored before gear', async () => {
    const adapters = makeAdapters();
    await promote(adapters, adapters.run);
    const snapshot = await adapters.repo.loadActiveRun();
    expect(snapshot?.run.sponsors).toBeUndefined();
    expect(normalizeSponsorGearState(snapshot?.run.sponsors)).toEqual(
      normalizeSponsorGearState(undefined),
    );
  });
});
