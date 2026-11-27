import { describe, expect, it } from 'bun:test';
import {
  HAVOC_MUTATION_IDS,
  capRushCardSchema,
  capRushOfferIdSchema,
  capRushSourcePlayerSchema,
  playerIdSchema,
  playerVersionId,
  type CapRushDraftPick,
  type HavocMutationEntry,
  type HavocMutationId,
  type Position,
  type SimulationPlayer,
} from '@hoop-rush/data-contracts';
import { buildSimulationPlayer } from '@hoop-rush/test-fixtures';
import { createEngineContext } from '../../sim/kernel.ts';
import { createRng } from '../../sim/rng.ts';
import { HAVOC_MUTATION_DEFINITIONS, teamExclusiveMutationIdsOf } from '../havoc/mutations.ts';
import { materializeHavocBundle } from '../havoc/offers.ts';
import { applyHavocMutationPackage } from '../havoc/transform.ts';
import { capRushEffectiveProfileOf } from '../cap-rush/effective-profile.ts';
import { buildCapRushSpinReceipt } from '../cap-rush/spin.ts';
import { fullCourtEffectiveRatings } from './draft-economy.ts';
import {
  FULL_COURT_REGULATION_SECONDS,
  FULL_COURT_REGULATION_TEAM_SECONDS,
  FullCourtSetupError,
  checkFullCourtGameResult,
  fullCourtGameDigest,
  simulateFullCourtGame,
  type FullCourtGameResult,
} from './game.ts';
import { runFullCourtGameWithHealth } from './health.ts';
import { buildFullCourtGameLineups } from './report.ts';
import {
  SUPPORTED_FULL_COURT_ROULETTE_MUTATION_IDS,
  adaptCapRushSpinsToFullCourt,
  applyFullCourtRouletteMutations,
  assertSupportedFullCourtRouletteMutations,
  isFullCourtRouletteMutationSupported,
  resolveFullCourtRouletteTeam,
  type FullCourtRouletteSpinReceiptLike,
} from './roulette.ts';
import { fullCourtTestInput, fullCourtTestRoster, fullCourtTestSeed } from './game-test-support.ts';

const ctx = createEngineContext();
const DEFINITIONS_BY_ID = new Map(
  HAVOC_MUTATION_DEFINITIONS.map((definition) => [definition.mutationId, definition]),
);
const TEAM_EXCLUSIVE_IDS = teamExclusiveMutationIdsOf(HAVOC_MUTATION_DEFINITIONS);

function at<T>(items: readonly T[], index: number): T {
  const value = items[index];
  if (value === undefined) throw new Error(`expected element at index ${String(index)}`);
  return value;
}

function versionOf(player: SimulationPlayer): NonNullable<SimulationPlayer['playerVersionId']> {
  if (player.playerVersionId === undefined) {
    throw new Error(`player ${player.playerId} must have playerVersionId`);
  }
  return player.playerVersionId;
}

function entryFor(mutationId: HavocMutationId, seedTag = 'entry'): HavocMutationEntry {
  const definition = DEFINITIONS_BY_ID.get(mutationId);
  if (definition === undefined) throw new Error(`missing definition for ${mutationId}`);
  const [entry] = materializeHavocBundle(
    { tier: definition.tier, mutationIds: [mutationId] },
    createRng(`${seedTag}:phys:${mutationId}`),
    createRng(`${seedTag}:spec:${mutationId}`),
    HAVOC_MUTATION_DEFINITIONS,
  );
  if (entry === undefined) throw new Error(`failed to materialize ${mutationId}`);
  return entry;
}

function receiptFor(
  player: SimulationPlayer,
  slot: Position,
  entries: readonly HavocMutationEntry[],
): FullCourtRouletteSpinReceiptLike {
  const sourcePlayer = buildSimulationPlayer({ ...player });
  const effective = applyHavocMutationPackage(
    {
      playerId: sourcePlayer.playerId,
      playerVersionId: sourcePlayer.playerVersionId ?? null,
      displayName: sourcePlayer.displayName,
      franchiseId: null,
      eraId: null,
      seasonKey: null,
      positions: [...sourcePlayer.positions],
      originalOverall: sourcePlayer.overall ?? 75,
      overallSource: 'catalog',
      profile: {
        ratings: sourcePlayer.ratings,
        tendencies: sourcePlayer.tendencies,
        ...(sourcePlayer.anchors === undefined ? {} : { anchors: sourcePlayer.anchors }),
      },
      physical: {
        heightInches: sourcePlayer.heightInches,
        weightLbs: sourcePlayer.weightLbs,
      },
    },
    [...entries],
    { slot },
  );
  const [head, ...rest] = entries;
  if (head === undefined) throw new Error('expected at least one entry');
  return {
    target: {
      slot,
      playerVersionId: versionOf(player),
      playerId: player.playerId,
    },
    entry: head,
    ...(rest.length > 0 ? { additionalEntries: rest } : {}),
    effective,
  };
}

describe('full court roulette adapter and validation', () => {
  it('supports all shipped Havoc/Cap Rush mutation IDs without gaps', () => {
    expect(SUPPORTED_FULL_COURT_ROULETTE_MUTATION_IDS).toEqual(HAVOC_MUTATION_IDS);
    for (const id of HAVOC_MUTATION_IDS) {
      expect(isFullCourtRouletteMutationSupported(id)).toBe(true);
    }
    expect(() => assertSupportedFullCourtRouletteMutations(HAVOC_MUTATION_IDS)).not.toThrow();
    expect(isFullCourtRouletteMutationSupported('not-a-mutation' as HavocMutationId)).toBe(false);
    expect(() =>
      assertSupportedFullCourtRouletteMutations(['not-a-mutation' as HavocMutationId]),
    ).toThrow(FullCourtSetupError);
  });

  it('adapts persisted Cap Rush spin receipts on starters and bench players preserving pinned targets across rotation changes', () => {
    const roster = fullCourtTestRoster('spin', 8, (index) => ({
      rating: index === 5 ? 82 : 72,
    }));
    const starter = at(roster, 0);
    const bench = at(roster, 5);
    const benchSource = capRushSourcePlayerSchema.parse({
      playerId: bench.playerId,
      playerVersionId: versionOf(bench),
      displayName: bench.displayName,
      franchiseId: 'test-franchise',
      eraId: '1990s',
      seasonKey: '1995-96',
      positions: [...bench.positions],
      originalOverall: bench.overall ?? 82,
      overallSource: 'catalog',
      profile: {
        ratings: bench.ratings,
        tendencies: bench.tendencies,
        ...(bench.anchors === undefined ? {} : { anchors: bench.anchors }),
      },
      physical: {
        heightInches: bench.heightInches,
        weightLbs: bench.weightLbs,
      },
    });
    const pick: CapRushDraftPick = {
      pickOrdinal: 0,
      slot: 'PG',
      card: capRushCardSchema.parse({
        cardId: `crc-${'5'.repeat(32)}`,
        offerId: capRushOfferIdSchema.parse(`cro-${'0'.repeat(32)}`),
        cardIndex: 0,
        slot: 'PG',
        bucket: 'budget',
        source: benchSource,
        salaryDollars: 10,
      }),
    };
    const capReceipt = buildCapRushSpinReceipt({
      runSeed: fullCourtTestSeed('spin-run'),
      purchase: 'standard',
      spinOrdinal: 0,
      payrollDollars: 80,
      pick,
    });
    const expectedCapEffective = capRushEffectiveProfileOf({
      player: benchSource,
      slot: capReceipt.target.slot,
      mutationPackage: [capReceipt.entry],
      payrollStatus: 'second-apron',
    });

    const starterReceipt = receiptFor(starter, 'PG', [entryFor('sniper-gene', 'starter')]);
    const adapted = adaptCapRushSpinsToFullCourt({
      roster,
      sourceRoster: [benchSource],
      payrollStatus: 'second-apron',
      receipts: [starterReceipt, capReceipt],
    });
    expect(adapted.payrollStatus).toBe('second-apron');
    expect(adapted.attachments).toHaveLength(2);
    const benchAttachment = at(adapted.attachments, 1);
    expect(benchAttachment.playerId).toBe(bench.playerId);
    expect(benchAttachment.slot).toBe(capReceipt.target.slot);

    const resolved = resolveFullCourtRouletteTeam({
      teamId: 'home',
      displayName: 'Home',
      roster,
      roulette: adapted,
    });
    const resolvedBench = at(resolved.roster, 5);
    expect(resolvedBench.ratings).toEqual(
      fullCourtEffectiveRatings(capReceipt.effective.ratings, 'second-apron'),
    );
    expect(resolvedBench.ratings).toEqual(expectedCapEffective.ratings);

    const reorderedBase = fullCourtTestInput({
      seed: 'pinned-reorder',
      homeRoster: roster,
      homeRotation: {
        startingFive: [
          bench.playerId,
          at(roster, 1).playerId,
          at(roster, 2).playerId,
          at(roster, 3).playerId,
          at(roster, 4).playerId,
        ],
      },
    });
    const reorderedGame = simulateFullCourtGame(
      {
        ...reorderedBase,
        home: {
          ...reorderedBase.home,
          roulette: adapted,
        },
      },
      ctx,
    );
    expect(checkFullCourtGameResult(reorderedGame)).toEqual([]);
    const benchRollup = reorderedGame.home.mutationRollups?.find(
      (entry) => entry.playerId === bench.playerId,
    );
    expect(benchRollup?.mutationId).toBe(capReceipt.entry.mutationId);
  });

  it('keeps applyFullCourtRouletteMutations idempotent across game simulation', () => {
    const roster = fullCourtTestRoster('idem', 8, (index) => ({
      rating: index === 0 ? 80 : 72,
    }));
    const roulette = adaptCapRushSpinsToFullCourt({
      roster,
      payrollStatus: 'second-apron',
      receipts: [
        receiptFor(at(roster, 0), 'PG', [
          entryFor('sniper-gene', 'idem'),
          entryFor('heat-check', 'idem'),
        ]),
        receiptFor(at(roster, 5), 'PG', [entryFor('walking-bucket', 'idem')]),
      ],
    });
    const baseInput = fullCourtTestInput({ seed: 'idem-game', homeRoster: roster });
    const direct = simulateFullCourtGame(
      {
        ...baseInput,
        home: { ...baseInput.home, roulette },
      },
      ctx,
    );
    const preApplied = simulateFullCourtGame(
      {
        ...baseInput,
        home: applyFullCourtRouletteMutations(baseInput.home, roulette),
      },
      ctx,
    );
    expect(fullCourtGameDigest(preApplied)).toBe(fullCourtGameDigest(direct));
    expect(preApplied.home.mutationRollups).toEqual(direct.home.mutationRollups);
  });

  it('rejects duplicate players, team-exclusive conflicts, mismatched versions, empty packages, and illegal payroll', () => {
    const roster = fullCourtTestRoster('val', 6);
    const p0 = at(roster, 0);
    const p1 = at(roster, 1);

    expect(() =>
      adaptCapRushSpinsToFullCourt({
        roster,
        receipts: [
          {
            target: {
              slot: 'PG',
              playerVersionId: playerVersionId('missing', 'missing', '1990s', '1995-96'),
            },
            entry: entryFor('sniper-gene'),
          },
        ],
      }),
    ).toThrow(FullCourtSetupError);

    expect(() =>
      adaptCapRushSpinsToFullCourt({
        roster,
        receipts: [
          {
            target: {
              slot: 'PG',
              playerVersionId: versionOf(p0),
              playerId: playerIdSchema.parse('wrong-player-id'),
            },
            entry: entryFor('sniper-gene'),
          },
        ],
      }),
    ).toThrow(FullCourtSetupError);

    expect(() =>
      adaptCapRushSpinsToFullCourt({
        roster,
        receipts: [
          receiptFor(p0, 'PG', [entryFor('sniper-gene')]),
          receiptFor(p0, 'PG', [entryFor('heat-check')]),
        ],
      }),
    ).toThrow(FullCourtSetupError);

    expect(() =>
      adaptCapRushSpinsToFullCourt({
        roster,
        receipts: [
          receiptFor(p0, 'PG', [entryFor('fusion-dance')]),
          receiptFor(p1, 'SG', [entryFor('fusion-dance')]),
        ],
      }),
    ).toThrow(FullCourtSetupError);

    expect(() =>
      resolveFullCourtRouletteTeam({
        teamId: 'home',
        displayName: 'Home',
        roster,
        roulette: {
          payrollStatus: 'illegal',
          attachments: [
            {
              playerId: p0.playerId,
              playerVersionId: versionOf(p0),
              slot: 'PG',
              mutationPackage: [entryFor('sniper-gene')],
            },
          ],
        },
      }),
    ).toThrow(FullCourtSetupError);

    expect(() =>
      resolveFullCourtRouletteTeam({
        teamId: 'home',
        displayName: 'Home',
        roster,
        roulette: {
          attachments: [
            {
              playerId: p0.playerId,
              playerVersionId: versionOf(p0),
              slot: 'PG',
              mutationPackage: [],
            },
          ],
        },
      }),
    ).toThrow(FullCourtSetupError);
  });
});

describe('full court roulette simulation parity, accounting, and mechanics', () => {
  it('preserves default seeded parity when no roulette attachments are present', () => {
    const baseInput = fullCourtTestInput({
      seed: 'parity-default',
      homeRoster: fullCourtTestRoster('home-default', 8),
    });
    const baseline = simulateFullCourtGame(baseInput, ctx);
    const withEmptyRoulette = simulateFullCourtGame(
      {
        ...baseInput,
        home: { ...baseInput.home, roulette: { attachments: [] } },
        away: { ...baseInput.away, roulette: { attachments: [] } },
      },
      ctx,
    );
    expect(fullCourtGameDigest(withEmptyRoulette)).toBe(fullCourtGameDigest(baseline));
    expect(withEmptyRoulette.home.mutationRollups).toBeUndefined();
    expect(withEmptyRoulette.home.teamBonusPoints).toBeUndefined();
  });

  it('runs every shipped Havoc/Cap Rush mutation deterministically with clean Full Court accounting', () => {
    const homeRoster = fullCourtTestRoster('all-home', 9, (index) => ({
      rating: index === 0 ? 84 : index === 5 ? 79 : 73,
      foulRate: 1.5,
    }));
    const awayRoster = fullCourtTestRoster('all-away', 9, (index) => ({
      rating: index === 0 ? 81 : 73,
    }));

    const nonExclusive = HAVOC_MUTATION_IDS.filter((id) => !TEAM_EXCLUSIVE_IDS.has(id));
    for (let offset = 0; offset < nonExclusive.length; offset += 6) {
      const batch = nonExclusive.slice(offset, offset + 6);
      const receipts = batch.map((mutationId, idx) => {
        const targetIndex = idx % 2 === 0 ? idx % 5 : 5 + (idx % 3);
        const player = at(homeRoster, targetIndex);
        const slot = player.positions[0] ?? 'SF';
        return receiptFor(player, slot, [entryFor(mutationId, `batch-${String(offset)}`)]);
      });
      const input = fullCourtTestInput({
        seed: `sweep-${String(offset)}`,
        homeRoster,
        awayRoster,
      });
      const gameInput = {
        ...input,
        home: {
          ...input.home,
          roulette: adaptCapRushSpinsToFullCourt({ roster: homeRoster, receipts }),
        },
      };
      const first = simulateFullCourtGame(gameInput, ctx);
      const replay = simulateFullCourtGame(gameInput, ctx);
      expect(checkFullCourtGameResult(first)).toEqual([]);
      expect(fullCourtGameDigest(replay)).toBe(fullCourtGameDigest(first));
    }

    for (const exclusiveId of TEAM_EXCLUSIVE_IDS) {
      const targetPlayer = at(homeRoster, exclusiveId === 'clone-army' ? 5 : 0);
      const slot = targetPlayer.positions[0] ?? 'PG';
      const input = fullCourtTestInput({
        seed: `excl-${exclusiveId}`,
        homeRoster,
        awayRoster,
      });
      const gameInput = {
        ...input,
        home: {
          ...input.home,
          roulette: adaptCapRushSpinsToFullCourt({
            roster: homeRoster,
            receipts: [receiptFor(targetPlayer, slot, [entryFor(exclusiveId, 'excl')])],
          }),
        },
      };
      const first = simulateFullCourtGame(gameInput, ctx);
      const replay = simulateFullCourtGame(gameInput, ctx);
      expect(checkFullCourtGameResult(first)).toEqual([]);
      expect(fullCourtGameDigest(replay)).toBe(fullCourtGameDigest(first));
    }
  });

  it('activates clone-army and hostile-takeover on bench players when they enter and ignores unavailable bench players', () => {
    const homeRoster = fullCourtTestRoster('bench-dyn', 8, (index) => ({
      rating: index === 5 ? 85 : 72,
    }));
    const awayRoster = fullCourtTestRoster('away-dyn', 8, () => ({ rating: 72 }));
    const benchStar = at(homeRoster, 5);

    const inactiveInput = fullCourtTestInput({
      seed: 'bench-inactive',
      homeRoster,
      awayRoster,
      homeAvailability: homeRoster.map((player) => ({
        playerId: player.playerId,
        available: player.playerId !== benchStar.playerId,
      })),
    });
    const inactiveResult = simulateFullCourtGame(
      {
        ...inactiveInput,
        home: {
          ...inactiveInput.home,
          roulette: adaptCapRushSpinsToFullCourt({
            roster: homeRoster,
            receipts: [
              receiptFor(benchStar, 'PG', [
                entryFor('clone-army', 'inactive'),
                entryFor('hostile-takeover', 'inactive'),
              ]),
            ],
          }),
        },
      },
      ctx,
    );
    expect(checkFullCourtGameResult(inactiveResult)).toEqual([]);
    expect(inactiveResult.home.players.some((player) => player.kind === 'clone')).toBe(false);
    expect(inactiveResult.home.mutationRollups?.every((entry) => entry.triggers === 0)).toBe(true);

    const activeBase = fullCourtTestInput({
      seed: 'bench-active',
      homeRoster,
      awayRoster,
      homeRotation: {
        startingFive: homeRoster.slice(0, 5).map((player) => player.playerId),
        minuteTargets: {
          [benchStar.playerId]: 22,
        },
      },
    });
    const activeInput = {
      ...activeBase,
      home: {
        ...activeBase.home,
        roulette: adaptCapRushSpinsToFullCourt({
          roster: homeRoster,
          receipts: [receiptFor(benchStar, 'PG', [entryFor('clone-army', 'bench-clone')])],
        }),
      },
    };
    const healthOut = runFullCourtGameWithHealth(activeInput, 0, ctx, { record: true });
    expect(healthOut.kind).toBe('played');
    if (healthOut.kind !== 'played') throw new Error('expected played game');
    const result = healthOut.result;
    expect(checkFullCourtGameResult(result)).toEqual([]);
    const clone = result.home.players.find((player) => player.kind === 'clone');
    expect(clone).toBeDefined();
    if (clone === undefined) throw new Error('expected spawned clone');
    expect(clone.startedGame).toBe(false);
    expect(clone.ownerPlayerId).toBe(benchStar.playerId);
    expect(clone.seconds).toBeGreaterThan(0);
    expect(clone.stints).toBeGreaterThan(0);
    expect(result.home.teamSeconds).toBe(result.home.liveSeconds * 5 + clone.seconds);
    expect(healthOut.health.home.players[clone.playerId]).toBeUndefined();
    const benchOwnerLine = result.home.players.find(
      (player) => player.playerId === benchStar.playerId,
    );
    expect(benchOwnerLine).toBeDefined();
    if (benchOwnerLine !== undefined) {
      expect(clone.seconds).toBeLessThanOrEqual(benchOwnerLine.seconds);
    }

    if (healthOut.tape === null) throw new Error('expected recorded tape');
    const compact = buildFullCourtGameLineups({
      kind: 'played',
      gameId: 'fc-clone-lineups',
      userSide: 'home',
      result,
      tape: healthOut.tape,
    });
    const cloneLineup = compact.lineups.find((lineup) => lineup.playerIds.includes(clone.playerId));
    if (cloneLineup === undefined) throw new Error('expected a clone lineup');
    expect(cloneLineup.playerIds).toEqual([...cloneLineup.playerIds].sort());
    expect(compact.lineups.reduce((total, lineup) => total + lineup.pointsFor, 0)).toBe(
      result.home.box.points,
    );
  });

  it('tracks foul-thief relief, rebound-loop extra possessions, and teamBonusPoints accounting', () => {
    const foulRoster = fullCourtTestRoster('fouls', 7, (index) => ({
      rating: index === 0 ? 84 : 74,
      foulRate: index === 0 ? 6.0 : 1.0,
    }));
    const foulStar = at(foulRoster, 0);
    const awayRoster = fullCourtTestRoster('away-foul', 7, () => ({ rating: 74 }));
    let sawFoulRelief = false;
    for (let attempt = 0; attempt < 15 && !sawFoulRelief; attempt += 1) {
      const base = fullCourtTestInput({
        seed: `foul-thief-${String(attempt)}`,
        homeRoster: foulRoster,
        awayRoster,
        homeRotation: {
          minuteTargets: { [foulStar.playerId]: 38 },
        },
      });
      const result = simulateFullCourtGame(
        {
          ...base,
          home: {
            ...base.home,
            roulette: adaptCapRushSpinsToFullCourt({
              roster: foulRoster,
              receipts: [receiptFor(foulStar, 'PG', [entryFor('foul-thief', 'ft')])],
            }),
          },
        },
        ctx,
      );
      expect(checkFullCourtGameResult(result)).toEqual([]);
      const rollup = result.home.mutationRollups?.find(
        (entry) => entry.mutationId === 'foul-thief',
      );
      const thief = at(result.home.players, 0);
      if (
        (rollup?.triggers ?? 0) > 0 &&
        thief.chargedFouls !== undefined &&
        thief.chargedFouls < thief.fouls
      ) {
        sawFoulRelief = true;
      }
    }
    expect(sawFoulRelief).toBe(true);

    const reboundRoster = fullCourtTestRoster('reb', 8, (index) => ({
      rating: index === 4 ? 92 : 76,
    }));
    const rebBase = fullCourtTestInput({
      seed: 'reb-double',
      homeRoster: reboundRoster,
      awayRoster,
    });
    const rebResult: FullCourtGameResult = simulateFullCourtGame(
      {
        ...rebBase,
        home: {
          ...rebBase.home,
          roulette: adaptCapRushSpinsToFullCourt({
            roster: reboundRoster,
            receipts: [
              receiptFor(at(reboundRoster, 4), 'C', [entryFor('rebound-loop', 'reb')]),
              receiptFor(at(reboundRoster, 0), 'PG', [
                entryFor('double-or-nothing', 'don'),
                entryFor('golden-assist', 'ga'),
              ]),
              receiptFor(at(reboundRoster, 5), 'PG', [entryFor('the-bounty', 'bounty')]),
            ],
          }),
        },
      },
      ctx,
    );
    expect(checkFullCourtGameResult(rebResult)).toEqual([]);
    const loopRollup = rebResult.home.mutationRollups?.find(
      (entry) => entry.mutationId === 'rebound-loop',
    );
    expect(loopRollup?.triggers ?? 0).toBeGreaterThan(0);
    expect(rebResult.home.teamSeconds).toBe(
      FULL_COURT_REGULATION_TEAM_SECONDS + rebResult.overtimePeriods * 25 * 60,
    );
    expect(rebResult.home.liveSeconds).toBe(
      FULL_COURT_REGULATION_SECONDS + rebResult.overtimePeriods * 300,
    );
  });
});
