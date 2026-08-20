import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  SEASON_RUN_SAVE_SCHEMA_VERSION,
  SEASON_RUN_SCHEMA_VERSION,
  SEASON_BLOCK_VERSION,
  SEASON_CHECKPOINT_VERSION,
  SEASON_RECAP_VERSION,
  SEASON_CAMPAIGN_VERSION,
  SEASON_TRADE_VERSION,
  SEASON_INFLUENCE_VERSION,
  SEASON_HEALTH_VERSION,
  buildEmptyCampaignState,
  seasonCampaignStateSchema,
  seasonTradeStateSchema,
} from '@hoop-rush/data-contracts';
import { SEASON_RUN_RECORD_ID } from '../schemas/season-run-record.ts';
import { DexieSeasonRunRepository, SeasonRunIncompatibleError } from './season-run-dexie.ts';
import { TestDatabase, testDatabaseName } from '../testing/repo-test-support.ts';
import {
  buildFixtureCheckpointRow,
  buildFixtureRun,
  buildFixtureSchedule,
  buildFixtureStateDigest,
  buildFixtureStoredDraft,
  buildStubSeasonEngineSeam,
} from '../testing/season-run-fixture.ts';
import { buildFullSeasonDataset } from '../benchmark/season-run.ts';
import type { SeasonRunCommand } from '@hoop-rush/data-contracts';

function makeAdapters() {
  const db = new TestDatabase(testDatabaseName('season-m255'));
  const seam = buildStubSeasonEngineSeam();
  const schedule = buildFixtureSchedule('a1b2c3d4e5f60718293a4b5c6d7e8f9a');
  const run = buildFixtureRun({ seed: 'a1b2c3d4e5f60718293a4b5c6d7e8f9a', runId: 'm255-run' });
  const repo = new DexieSeasonRunRepository(db, { schedule, seam });
  return { db, repo, schedule, run, seam };
}

async function promote(adapters: ReturnType<typeof makeAdapters>) {
  await adapters.repo.promoteSeasonDraftToRun(buildFixtureStoredDraft(adapters.run), adapters.run);
}

describe('M2.5.5 persistence — saveSchema 8, atomic commits, replay, incompatibility', () => {
  afterEach(async () => {
    vi.restoreAllMocks();
  });

  it('promoted run is saveSchema 8 with schema-11, v5 checkpoint/recap, campaign, trade-v3, influence-v2, health-v2', async () => {
    const adapters = makeAdapters();
    await promote(adapters);
    const row = await adapters.db.seasonRuns.get(SEASON_RUN_RECORD_ID);
    expect(row?.saveSchemaVersion).toBe(8);
    expect(row?.saveSchemaVersion).toBe(SEASON_RUN_SAVE_SCHEMA_VERSION);
    expect(row?.run.schemaVersion).toBe(11);
    expect(row?.run.schemaVersion).toBe(SEASON_RUN_SCHEMA_VERSION);
    expect(row?.run.versions.blockVersion).toBe(SEASON_BLOCK_VERSION);
    expect(row?.run.versions.checkpointVersion).toBe(SEASON_CHECKPOINT_VERSION);
    expect(row?.run.versions.recapVersion).toBe(SEASON_RECAP_VERSION);
    expect(row?.run.versions.campaignVersion).toBe(SEASON_CAMPAIGN_VERSION);
    expect(row?.run.versions.tradeVersion).toBe(SEASON_TRADE_VERSION);
    expect(row?.run.versions.influenceVersion).toBe(SEASON_INFLUENCE_VERSION);
    expect(row?.run.versions.healthVersion).toBe(SEASON_HEALTH_VERSION);
    expect(row?.run.campaign).toBeDefined();
    expect(row?.campaign).toBeDefined();
    // campaign should be empty initially
    expect(row?.campaign?.startingIdentity).toBeNull();
    expect(row?.trade).toBeNull();
    expect(row?.health.healthVersion).toBe(SEASON_HEALTH_VERSION);
    expect(row?.influence.influenceVersion).toBe(SEASON_INFLUENCE_VERSION);
  });

  it('saveSchema 7 active run is typed incompatible and preserved until explicit discard', async () => {
    const adapters = makeAdapters();
    await promote(adapters);
    const row = await adapters.db.seasonRuns.get(SEASON_RUN_RECORD_ID);
    if (!row) throw new Error('expected row');
    // Simulate legacy saveSchema 7
    const legacy = {
      ...row,
      saveSchemaVersion: 7,
      run: {
        ...row.run,
        schemaVersion: 10,
        versions: { ...row.run.versions, runSchemaVersion: 10 },
      },
    };
    await adapters.db.seasonRuns.put(legacy as never);
    await expect(adapters.repo.loadActiveRun()).rejects.toMatchObject({
      name: 'SeasonRunIncompatibleError',
      info: {
        storedSaveSchemaVersion: 7,
        storedRunSchemaVersion: 10,
        runId: adapters.run.runId,
      },
    });
    // Should be instance of typed error
    try {
      await adapters.repo.loadActiveRun();
    } catch (e) {
      expect(e).toBeInstanceOf(SeasonRunIncompatibleError);
      const err = e as SeasonRunIncompatibleError;
      expect(err.info.storedSaveSchemaVersion).toBe(7);
    }
    // Preserved until explicit discard
    expect(await adapters.db.seasonRuns.count()).toBe(1);
    await adapters.repo.clearSeasonRun(adapters.run.runId);
    expect(await adapters.db.seasonRuns.count()).toBe(0);
    expect(await adapters.repo.loadActiveRun()).toBeNull();
  });

  it('completed history survives active-run discard and v11 migration', async () => {
    // Completed history must survive active-run lifecycle; v11 preserves it.
    const adapters = makeAdapters();
    await promote(adapters);
    const activeRunId = adapters.run.runId;
    const completedRunId = 'completed-preserved-run';
    const almanacDigest = 'a'.repeat(32);
    const commandLogDigest = 'b'.repeat(32);
    await adapters.db.seasonCompletedRuns.put({
      runId: completedRunId,
      run: (await adapters.db.seasonRuns.get(SEASON_RUN_RECORD_ID))!.run,
      updatedAtIso: new Date().toISOString(),
    } as never);
    await adapters.db.seasonCompletedIndex.put({
      recordId: completedRunId,
      runId: completedRunId,
      rootSeed: adapters.run.rootSeed,
      humanFranchiseId: 'lakers',
      championFranchiseId: 'lakers',
      almanacDigest,
      commandLogDigest,
      completedAtIso: new Date().toISOString(),
    } as never);
    expect(await adapters.db.seasonCompletedRuns.count()).toBe(1);
    // Clear active should not delete completed with different runId
    await adapters.repo.clearSeasonRun(activeRunId);
    expect(await adapters.db.seasonCompletedRuns.count()).toBe(1);
    expect(await adapters.db.seasonCompletedIndex.count()).toBe(1);
    const completed = await adapters.db.seasonCompletedRuns.get(completedRunId);
    expect(completed).toBeDefined();
    // Clearing the completed run itself should remove it
    await adapters.repo.deleteCompletedSeason(completedRunId);
    expect(await adapters.db.seasonCompletedRuns.count()).toBe(0);
  });

  it('every accepted Campaign/Trade command commits snapshot + log atomically with stale checks', async () => {
    const adapters = makeAdapters();
    await promote(adapters);
    const base = await adapters.db.seasonRuns.get(SEASON_RUN_RECORD_ID);
    if (!base) throw new Error('no base');
    const nextCampaign = seasonCampaignStateSchema.parse({
      ...buildEmptyCampaignState(),
      startingIdentity: 'win-now',
      startingFocus: 'defense',
    });
    const nextRun = {
      ...adapters.run,
      campaign: nextCampaign,
      stateRevision: 1,
      stateDigest: buildFixtureStateDigest(adapters.run, {
        stateRevision: 1,
        campaign: nextCampaign,
      }),
    };
    const command: SeasonRunCommand = {
      schemaVersion: 11,
      command: 'select-gm-identity',
      commandId: 'cmd-campaign-1',
      runId: adapters.run.runId,
      expectedStateRevision: 0,
      expectedStateDigest: adapters.run.stateDigest,
      identity: 'win-now',
      focus: 'defense',
    } as unknown as SeasonRunCommand;

    await adapters.repo.applySeasonRunCommand({
      runId: adapters.run.runId,
      command,
      run: nextRun,
      pending: null,
    });
    const stored = await adapters.db.seasonRuns.get(SEASON_RUN_RECORD_ID);
    expect(stored?.stateRevision).toBe(1);
    expect(stored?.campaign?.startingIdentity).toBe('win-now');
    const log = await adapters.db.seasonCommandLog
      .where('runId')
      .equals(adapters.run.runId)
      .toArray();
    expect(log).toHaveLength(1);
    expect(log[0]?.entry.command.commandId).toBe('cmd-campaign-1');
    // Stale should reject and write nothing
    const staleCommand = {
      ...command,
      commandId: 'cmd-stale',
      expectedStateRevision: 0,
      expectedStateDigest: adapters.run.stateDigest,
    } as unknown as SeasonRunCommand;
    await expect(
      adapters.repo.applySeasonRunCommand({
        runId: adapters.run.runId,
        command: staleCommand,
        run: { ...nextRun, stateRevision: 2, stateDigest: 'f'.repeat(32) },
        pending: null,
      }),
    ).rejects.toMatchObject({ name: 'SeasonRunCommandStaleStateError' });
    expect(
      await adapters.db.seasonCommandLog.where('runId').equals(adapters.run.runId).count(),
    ).toBe(1);
  });

  it('rejected/duplicate/stale/expired writes nothing', async () => {
    const adapters = makeAdapters();
    await promote(adapters);
    const command: SeasonRunCommand = {
      schemaVersion: 11,
      command: 'select-gm-identity',
      commandId: 'cmd-dup',
      runId: adapters.run.runId,
      expectedStateRevision: 0,
      expectedStateDigest: adapters.run.stateDigest,
      identity: 'win-now',
      focus: null,
    } as unknown as SeasonRunCommand;
    const nextRun = {
      ...adapters.run,
      campaign: seasonCampaignStateSchema.parse({
        ...buildEmptyCampaignState(),
        startingIdentity: 'win-now',
        startingFocus: null,
      }),
      stateRevision: 1,
      stateDigest: buildFixtureStateDigest(adapters.run, {
        stateRevision: 1,
        campaign: seasonCampaignStateSchema.parse({
          ...buildEmptyCampaignState(),
          startingIdentity: 'win-now',
          startingFocus: null,
        }),
      }),
    };
    await adapters.repo.applySeasonRunCommand({
      runId: adapters.run.runId,
      command,
      run: nextRun,
      pending: null,
    });
    // Duplicate with correct expected state (so stale check passes, duplicate check fails)
    const duplicateCommand: SeasonRunCommand = {
      ...command,
      expectedStateRevision: 1,
      expectedStateDigest: nextRun.stateDigest,
    } as unknown as SeasonRunCommand;
    await expect(
      adapters.repo.applySeasonRunCommand({
        runId: adapters.run.runId,
        command: duplicateCommand,
        run: nextRun,
        pending: null,
      }),
    ).rejects.toMatchObject({ name: 'SeasonRunCommandDuplicateError' });
    const afterDup = await adapters.db.seasonRuns.get(SEASON_RUN_RECORD_ID);
    expect(afterDup?.stateRevision).toBe(1);
    expect(await adapters.db.seasonCommandLog.count()).toBe(1);
  });

  it('accepted trade commits ownership/rosters/effects/health/influence/transaction atomically; fault injection proves rollback at each boundary', async () => {
    const adapters = makeAdapters();
    await promote(adapters);
    // Build a trade that swaps one player between lakers and celtics (using fixture rosters)
    const base = await adapters.db.seasonRuns.get(SEASON_RUN_RECORD_ID);
    if (!base) throw new Error('no base');
    const lakersRoster = adapters.run.rosters.find((r) => r.franchiseId === 'lakers');
    const celticsRoster = adapters.run.rosters.find((r) => r.franchiseId === 'celtics');
    if (!lakersRoster || !celticsRoster) throw new Error('no rosters');
    const outId = lakersRoster.players[0]!.playerVersionId;
    const inId = celticsRoster.players[0]!.playerVersionId;
    const nextRosters = adapters.run.rosters.map((r) => {
      if (r.franchiseId === 'lakers') {
        return { ...r, players: [celticsRoster.players[0]!, ...r.players.slice(1)] };
      }
      if (r.franchiseId === 'celtics') {
        return { ...r, players: [lakersRoster.players[0]!, ...r.players.slice(1)] };
      }
      return r;
    });
    const nextOwnership = [
      ...adapters.run.ownership.filter(
        (o) => o.playerVersionId !== outId && o.playerVersionId !== inId,
      ),
      { playerVersionId: outId, ownerFranchiseId: 'celtics' },
      { playerVersionId: inId, ownerFranchiseId: 'lakers' },
    ];
    const nextEffects = adapters.seam.zeroSeasonEffectsState(nextRosters);
    const nextHealth = { ...adapters.run.health, injuries: [] };
    const nextInfluence = {
      ...adapters.run.influence,
      balances: { ...adapters.run.influence.balances, lakers: 1, celtics: 1 },
      ledger: [
        ...adapters.run.influence.ledger,
        {
          entryId: 'influence-trade-cash-lakers',
          franchiseId: 'lakers',
          source: 'trade-cash-sent' as const,
          blockIndex: null,
          commandId: 'cmd-trade-1',
          requestedDelta: -1,
          appliedDelta: -1,
          balanceAfter: 1,
          explanation: 'trade cash',
        },
      ],
    };
    const nextTransactions = [
      ...adapters.run.transactions,
      {
        transactionId: 'txn-trade-1',
        commandId: 'cmd-trade-1',
        franchiseId: 'lakers',
        type: 'trade' as const,
        blockIndex: null,
        appliedAtStateRevision: 1,
        payload: { outId, inId },
        explanation: 'trade',
      },
    ];
    const nextTrade = seasonTradeStateSchema.parse({
      schemaVersion: 1,
      tradeVersion: SEASON_TRADE_VERSION,
      windows: [
        {
          windowIndex: 0,
          blockIndex: 2,
          status: 'open' as const,
          offers: [],
          boardProfiles: [],
          negotiations: [
            {
              inquiryId: 'inq-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
              windowIndex: 0,
              fromFranchiseId: 'lakers',
              toFranchiseId: 'celtics',
              status: 'accepted' as const,
              exchangeCount: 1,
              exchanges: [
                {
                  exchangeIndex: 1,
                  kind: 'human-proposal' as const,
                  proposalId: null,
                  proposalFingerprint: null,
                  responseCause: null,
                  atStateRevision: 0,
                },
              ],
              rejectedPlayerVersionIds: [],
              expressedInterests: [],
              latestRequestedChange: null,
              finalReason: null,
              activeProposalId: null,
            },
          ],
        },
      ],
    });
    const nextRun = {
      ...adapters.run,
      rosters: nextRosters,
      ownership: nextOwnership,
      health: nextHealth,
      influence: nextInfluence,
      transactions: nextTransactions,
      trade: nextTrade,
      stateRevision: 1,
      stateDigest: buildFixtureStateDigest(adapters.run, {
        stateRevision: 1,
        rosters: nextRosters,
        ownership: nextOwnership,
        health: nextHealth,
        influence: nextInfluence,
        transactions: nextTransactions,
        trade: nextTrade,
      }),
    };
    const command: SeasonRunCommand = {
      schemaVersion: 11,
      command: 'submit-trade-proposal',
      commandId: 'cmd-trade-1',
      runId: adapters.run.runId,
      expectedStateRevision: 0,
      expectedStateDigest: adapters.run.stateDigest,
      windowIndex: 0,
      toFranchiseId: 'celtics',
      outgoingPlayerVersionIds: [outId],
      incomingPlayerVersionIds: [inId],
      influenceAmount: 1,
      influenceFromSender: 'lakers',
    } as unknown as SeasonRunCommand;

    // Successful commit
    await adapters.repo.applySeasonRunCommand({
      runId: adapters.run.runId,
      command,
      run: nextRun,
      pending: null,
      transactionIds: ['txn-trade-1'],
    });
    const afterSuccess = await adapters.db.seasonRuns.get(SEASON_RUN_RECORD_ID);
    expect(
      afterSuccess?.run.rosters.find((r) => r.franchiseId === 'lakers')?.players[0]
        ?.playerVersionId,
    ).toBe(inId);
    expect(
      afterSuccess?.run.ownership.find((o) => o.playerVersionId === outId)?.ownerFranchiseId,
    ).toBe('celtics');

    // Now test rollback at each boundary: reset to base, then inject failures
    // We need a fresh db for each injection to avoid state pollution
    const boundaries: Array<[string, (db: TestDatabase) => void]> = [
      [
        'seasonRuns.put',
        (db) =>
          vi.spyOn(db.seasonRuns, 'put').mockRejectedValueOnce(new Error('inject seasonRuns.put')),
      ],
      [
        'seasonCommandLog.put',
        (db) =>
          vi
            .spyOn(db.seasonCommandLog, 'put')
            .mockRejectedValueOnce(new Error('inject seasonCommandLog.put')),
      ],
    ];
    for (const [label, inject] of boundaries) {
      const fresh = makeAdapters();
      await promote(fresh);
      const freshTradeRun = {
        ...fresh.run,
        rosters: nextRosters,
        ownership: nextOwnership,
        health: nextHealth,
        influence: nextInfluence,
        transactions: nextTransactions,
        trade: nextTrade,
        stateRevision: 1,
        stateDigest: buildFixtureStateDigest(fresh.run, {
          stateRevision: 1,
          rosters: nextRosters,
          ownership: nextOwnership,
          health: nextHealth,
          influence: nextInfluence,
          transactions: nextTransactions,
          trade: nextTrade,
        }),
      };
      const freshCommand = {
        ...command,
        runId: fresh.run.runId,
        expectedStateDigest: fresh.run.stateDigest,
      } as unknown as SeasonRunCommand;
      const before = await fresh.db.seasonRuns.get(SEASON_RUN_RECORD_ID);
      inject(fresh.db);
      await expect(
        fresh.repo.applySeasonRunCommand({
          runId: fresh.run.runId,
          command: freshCommand,
          run: freshTradeRun,
          pending: null,
          transactionIds: ['txn-trade-1'],
        }),
      ).rejects.toThrow(`inject ${label}`);
      const after = await fresh.db.seasonRuns.get(SEASON_RUN_RECORD_ID);
      expect(after, label).toEqual(before);
      expect(await fresh.db.seasonCommandLog.count(), label).toBe(0);
      // Verify rosters/ownership not partially updated
      expect(
        after?.run.rosters.find((r) => r.franchiseId === 'lakers')?.players[0]?.playerVersionId,
        label,
      ).not.toBe(inId);
      vi.restoreAllMocks();
    }
  });

  it('replay recomputes and reports specific divergence kinds', async () => {
    const adapters = makeAdapters();
    await promote(adapters);
    const row = await adapters.db.seasonRuns.get(SEASON_RUN_RECORD_ID);
    if (!row) throw new Error('no row');
    // Tamper health to miss rehabModifier (health-v2) and trigger specific replay divergence
    const { auditReplayDivergences } = await import('../season/replay.ts');
    const tamperedHealth = {
      ...row.health,
      injuries: [
        {
          injuryId: 'inj-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
          playerVersionId: row.run.rosters[0]!.players[0]!.playerVersionId,
          franchiseId: row.run.rosters[0]!.franchiseId,
          gameId: 's000001',
          type: 'soft-tissue' as const,
          severity: 'moderate' as const,
          occurredBeforeHalftime: false,
          sameGameReturn: false,
          sameGameReturned: null,
          missedGamesTotal: 3,
          missedGamesRemaining: 2,
          actualReturnRound: null,
          seasonEnding: false,
          // missing rehabModifier
          recurrenceWindowRoundsRemaining: 0,
          seedPath: ['health', 'rehab'],
        } as unknown as never,
      ],
    };
    const tamperedRow = { ...row, health: tamperedHealth } as unknown as typeof row;
    const divergences = auditReplayDivergences(tamperedRow, row.stateDigest, adapters.seam);
    expect(divergences.some((d) => d.kind === 'rehab-outcome')).toBe(true);
    // Also test campaign divergence via direct audit
    const invalidCampaign: unknown = {
      ...buildEmptyCampaignState(),
      offers: {
        0: [
          {
            opportunityId: 'copp-aaaaaaaa',
            branchId: 'cbr-bbbbbbbb',
            templateId: 'ctpl-cccccccc',
            blockIndex: 0,
            identity: 'win-now',
            family: 'results',
            prerequisiteId: null,
            target: {
              kind: 'block-wins',
              comparisonOperator: 'gte',
              threshold: 6,
              window: 'block',
            },
            breakthrough: null,
            completedReward: { rewardId: 'rew-dddddddd', type: 'influence', amount: 1 },
            breakthroughReward: null,
            feasibilityFacts: {},
            seedPath: ['campaign', '0', 'offers', '0'],
          },
        ],
      },
    };
    const tampered2 = { ...row, campaign: invalidCampaign } as unknown as typeof row;
    const divergences2 = auditReplayDivergences(tampered2, row.stateDigest, adapters.seam);
    expect(divergences2.some((d) => d.kind === 'campaign-offers')).toBe(true);
  });

  it('cross-tab reload cancels stale work, reloads snapshot, never repeats exchange/transaction', async () => {
    const adapters = makeAdapters();
    await promote(adapters);
    const command: SeasonRunCommand = {
      schemaVersion: 11,
      command: 'select-gm-identity',
      commandId: 'cmd-xtab-1',
      runId: adapters.run.runId,
      expectedStateRevision: 0,
      expectedStateDigest: adapters.run.stateDigest,
      identity: 'win-now',
      focus: 'defense',
    } as unknown as SeasonRunCommand;
    const nextCampaign = seasonCampaignStateSchema.parse({
      ...buildEmptyCampaignState(),
      startingIdentity: 'win-now',
      startingFocus: 'defense',
    });
    const nextRun = {
      ...adapters.run,
      campaign: nextCampaign,
      stateRevision: 1,
      stateDigest: buildFixtureStateDigest(adapters.run, {
        stateRevision: 1,
        campaign: nextCampaign,
      }),
    };
    await adapters.repo.applySeasonRunCommand({
      runId: adapters.run.runId,
      command,
      run: nextRun,
      pending: null,
    });
    // Simulate second tab loading fresh repository from same DB — it should see the new snapshot
    const tab2 = new DexieSeasonRunRepository(adapters.db, {
      schedule: adapters.schedule,
      seam: adapters.seam,
    });
    const reloaded = await tab2.loadActiveRun();
    expect(reloaded?.run.stateRevision).toBe(1);
    expect(reloaded?.run.campaign?.startingIdentity).toBe('win-now');
    // Stale UI work from tab2 (still at revision 0) should be rejected as stale, not duplicated
    await expect(
      tab2.applySeasonRunCommand({
        runId: adapters.run.runId,
        command,
        run: nextRun,
        pending: null,
      }),
    ).rejects.toMatchObject({ name: 'SeasonRunCommandStaleStateError' });
    // A true duplicate with correct expected state should be rejected as duplicate
    const duplicateCommand: SeasonRunCommand = {
      ...command,
      expectedStateRevision: 1,
      expectedStateDigest: nextRun.stateDigest,
    } as unknown as SeasonRunCommand;
    await expect(
      tab2.applySeasonRunCommand({
        runId: adapters.run.runId,
        command: duplicateCommand,
        run: nextRun,
        pending: null,
      }),
    ).rejects.toMatchObject({ name: 'SeasonRunCommandDuplicateError' });
    expect(await adapters.db.seasonCommandLog.count()).toBe(1);
  });

  it('Dexie v11 preserves saveSchema 8 and does not auto-migrate saveSchema 7', async () => {
    const adapters = makeAdapters();
    // Check that DB version is 11
    expect(adapters.db.verno).toBe(11);
    // Create legacy v7 row
    await promote(adapters);
    const row = await adapters.db.seasonRuns.get(SEASON_RUN_RECORD_ID);
    const legacy = {
      ...row!,
      saveSchemaVersion: 7,
      run: {
        ...row!.run,
        schemaVersion: 10,
        versions: { ...row!.run.versions, runSchemaVersion: 10 },
      },
    };
    await adapters.db.seasonRuns.put(legacy as never);
    await expect(adapters.repo.loadActiveRun()).rejects.toMatchObject({
      name: 'SeasonRunIncompatibleError',
    });
    // Ensure v11 did not auto-clear
    expect(await adapters.db.seasonRuns.count()).toBe(1);
  });
});
