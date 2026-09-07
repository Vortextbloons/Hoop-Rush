import { describe, expect, it } from 'vitest';
import {
  SEASON_RUN_SCHEMA_VERSION,
  normalizeSponsorGearState,
  sponsorGearPriceOf,
  sponsorGearTierConfigOf,
  type SeasonDraftCatalog,
  type SeasonRun,
  type SeasonRunCommandContext,
} from '@hoop-rush/data-contracts';
import { expandSeasonRunRosters } from './block.ts';
import { buildEconomyTestRun, zeroEffectsOf } from './season-economy-test-support.ts';
import { handleSeasonRunCommand } from './season-commands.ts';
import {
  applySponsorBoosts,
  createInitialSponsorGearState,
  resolveAiSponsorKit,
  seasonSponsorOffersForBlock,
  sponsorsWithBlockCommit,
} from './sponsors.ts';

const HUMAN = 'lakers';

function hexSeed(tag: number): string {
  return `face${tag.toString(16).padStart(12, '0')}abcdef`;
}

function runContext(run: SeasonRun): SeasonRunCommandContext {
  return { run, pending: null, humanFranchiseId: HUMAN, effects: zeroEffectsOf(run) };
}

function buyCommand(run: SeasonRun, instanceId: string, commandId: string) {
  return {
    schemaVersion: SEASON_RUN_SCHEMA_VERSION,
    command: 'buy-sponsor',
    commandId,
    runId: run.runId,
    expectedStateRevision: run.stateRevision,
    expectedStateDigest: run.stateDigest,
    instanceId,
  } as never;
}

function applyCommand(
  run: SeasonRun,
  instanceId: string,
  playerVersionId: string,
  slot: string,
  commandId: string,
) {
  return {
    schemaVersion: SEASON_RUN_SCHEMA_VERSION,
    command: 'apply-sponsor',
    commandId,
    runId: run.runId,
    expectedStateRevision: run.stateRevision,
    expectedStateDigest: run.stateDigest,
    instanceId,
    playerVersionId,
    slot,
  } as never;
}

function sponsoredRun(seed: string): { run: SeasonRun; catalog: SeasonDraftCatalog } {
  const { run, catalog } = buildEconomyTestRun({ seed });
  return {
    run: { ...run, sponsors: createInitialSponsorGearState(run.rootSeed) },
    catalog,
  };
}

function humanPlayer(run: SeasonRun): string {
  const roster = run.rosters.find((entry) => entry.franchiseId === HUMAN);
  const player = roster?.players[0];
  if (player === undefined) throw new Error('human roster is empty');
  return player.playerVersionId;
}

function resultOf(output: ReturnType<typeof handleSeasonRunCommand>, command: string) {
  if (output.result.command !== command) throw new Error(`wrong command ${output.result.command}`);
  return output.result.result;
}

describe('sponsor offer generation', () => {
  it('deals byte-identical offers for the same seed and block', () => {
    for (let i = 0; i < 100; i += 1) {
      const seed = `sponsor-det-${String(i).padStart(3, '0')}abcdef0123456789`;
      for (let block = 0; block < 8; block += 1) {
        expect(seasonSponsorOffersForBlock(seed, block)).toEqual(
          seasonSponsorOffersForBlock(seed, block),
        );
      }
    }
  });

  it('deals 5 offers in canonical instance order and nothing for block 8', () => {
    const offers = seasonSponsorOffersForBlock('a1b2c3d4e5f60718293a4b5c6d7e8f9a0', 3);
    expect(offers).toHaveLength(5);
    expect(offers.map((offer) => offer.instanceId)).toEqual([
      'sponsor-3-0',
      'sponsor-3-1',
      'sponsor-3-2',
      'sponsor-3-3',
      'sponsor-3-4',
    ]);
    expect(seasonSponsorOffersForBlock('a1b2c3d4e5f60718293a4b5c6d7e8f9a0', 8)).toEqual([]);
  });

  it('covers every slot in every block', () => {
    for (let i = 0; i < 20; i += 1) {
      const seed = `sponsor-slot-${String(i).padStart(3, '0')}abcdef0123456789`;
      for (let block = 0; block < 8; block += 1) {
        const slots = new Set(seasonSponsorOffersForBlock(seed, block).map((o) => o.slot));
        expect(slots.has('shoe')).toBe(true);
        expect(slots.has('apparel')).toBe(true);
        expect(slots.has('fuel')).toBe(true);
      }
    }
  });

  it('draws tiers near 55/32/13 over a large sample', () => {
    const counts = { BUZZ: 0, PRIME: 0, ICON: 0 };
    let total = 0;
    for (let i = 0; i < 2000; i += 1) {
      const seed = `sponsor-tier-${String(i).padStart(4, '0')}abcdef01234567`;
      for (const offer of seasonSponsorOffersForBlock(seed, i % 8)) {
        counts[offer.tier] += 1;
        total += 1;
      }
    }
    expect(counts.BUZZ / total).toBeGreaterThan(0.5);
    expect(counts.BUZZ / total).toBeLessThan(0.6);
    expect(counts.PRIME / total).toBeGreaterThan(0.27);
    expect(counts.PRIME / total).toBeLessThan(0.37);
    expect(counts.ICON / total).toBeGreaterThan(0.09);
    expect(counts.ICON / total).toBeLessThan(0.17);
  });

  it('rolls pools inside tier rails with spread tax and caps held', () => {
    for (let i = 0; i < 500; i += 1) {
      const seed = `sponsor-roll-${String(i).padStart(4, '0')}abcdef0123456`;
      for (const offer of seasonSponsorOffersForBlock(seed, i % 8)) {
        const tier = sponsorGearTierConfigOf(offer.tier);
        const pool = offer.boosts.reduce((sum, boost) => sum + boost.points, 0);
        expect(pool).toBeGreaterThanOrEqual(tier.poolMin - (offer.boosts.length - 1));
        expect(pool).toBeLessThanOrEqual(tier.poolMax - (offer.boosts.length - 1));
        expect(offer.boosts.length).toBeGreaterThanOrEqual(tier.statMin);
        expect(offer.boosts.length).toBeLessThanOrEqual(tier.statMax);
        for (const boost of offer.boosts) {
          expect(boost.points).toBeGreaterThanOrEqual(1);
          expect(boost.points).toBeLessThanOrEqual(tier.singleKeyCap);
        }
        expect(offer.price).toBe(sponsorGearPriceOf(offer.tier));
        const keys = offer.boosts.map((boost) => boost.key);
        expect([...keys].sort()).toEqual(keys);
        expect(new Set(keys).size).toBe(keys.length);
      }
    }
  });
});

describe('applySponsorBoosts', () => {
  it('sums all three slots and clamps at 100', () => {
    const { catalog } = buildEconomyTestRun({ seed: hexSeed(101) });
    const base = catalog.candidates[0]?.detailedRatings;
    if (base === undefined) throw new Error('catalog is empty');
    const floor = { ...base, speed: 98, strength: 3 };
    const boosted = applySponsorBoosts(floor, {
      shoe: {
        instanceId: 'sponsor-0-0',
        entryId: 'nike-icon',
        brandFamily: 'nike',
        slot: 'shoe',
        tier: 'ICON',
        boosts: [{ key: 'speed', points: 6 }],
        appliedBlock: 0,
        appliedByCommandId: 'cmd-00000000000000000000000000000001',
      },
      apparel: null,
      fuel: {
        instanceId: 'sponsor-0-1',
        entryId: 'gatorade-icon',
        brandFamily: 'gatorade',
        slot: 'fuel',
        tier: 'ICON',
        boosts: [{ key: 'strength', points: 4 }],
        appliedBlock: 0,
        appliedByCommandId: 'cmd-00000000000000000000000000000002',
      },
    });
    expect(boosted.speed).toBe(100);
    expect(boosted.strength).toBe(7);
    expect(boosted.vertical).toBe(base.vertical);
  });

  it('copies ratings when nothing is applied', () => {
    const { catalog } = buildEconomyTestRun({ seed: hexSeed(102) });
    const base = catalog.candidates[0]?.detailedRatings;
    if (base === undefined) throw new Error('catalog is empty');
    expect(applySponsorBoosts(base, undefined)).toEqual(base);
    expect(applySponsorBoosts(base, null)).toEqual(base);
  });
});

describe('buy-sponsor command', () => {
  it('accepts a current-block offer into the vault with a ledger entry', () => {
    const { run } = sponsoredRun(hexSeed(103));
    const board = normalizeSponsorGearState(run.sponsors).boards.boards[0];
    const offer = board?.offers.find((candidate) => candidate.price === 1);
    if (board === undefined || offer === undefined) throw new Error('no BUZZ offer dealt');
    const output = handleSeasonRunCommand(
      buyCommand(run, offer.instanceId, 'cmd-buy-1'),
      runContext(run),
    );
    const result = resultOf(output, 'buy-sponsor');
    if (result.status !== 'accepted')
      throw new Error(`expected acceptance: ${JSON.stringify(result)}`);
    expect(result.entryId).toBe(offer.entryId);
    expect(result.price).toBe(1);
    const sponsors = normalizeSponsorGearState(output.run.sponsors);
    expect(sponsors.vault.items).toHaveLength(1);
    expect(sponsors.boards.boards[0]?.purchasedInstanceIds).toEqual([offer.instanceId]);
    expect(output.run.influence.balances[HUMAN]).toBe(1);
    const ledger = output.run.influence.ledger[output.run.influence.ledger.length - 1];
    expect(ledger?.source).toBe('sponsor-purchase');
    expect(ledger?.commandId).toBe('cmd-buy-1');
    expect(output.run.stateRevision).toBe(run.stateRevision + 1);
  });

  it('rejects unknown, expired, repurchased, and unaffordable offers', () => {
    const { run } = sponsoredRun(hexSeed(105));
    const unknown = resultOf(
      handleSeasonRunCommand(buyCommand(run, 'sponsor-0-9', 'cmd-buy-x1'), runContext(run)),
      'buy-sponsor',
    );
    if (unknown.status !== 'rejected') throw new Error('expected rejection');
    expect(unknown.rejection.code).toBe('sponsor-not-offered');

    const board = normalizeSponsorGearState(run.sponsors).boards.boards[0];
    const offer = board?.offers[0];
    if (board === undefined || offer === undefined) throw new Error('no offer dealt');
    const first = handleSeasonRunCommand(
      buyCommand(run, offer.instanceId, 'cmd-buy-x2'),
      runContext(run),
    );
    const accepted = resultOf(first, 'buy-sponsor');
    if (accepted.status !== 'accepted') throw new Error('expected acceptance');
    const second = resultOf(
      handleSeasonRunCommand(
        buyCommand(first.run, offer.instanceId, 'cmd-buy-x3'),
        runContext(first.run),
      ),
      'buy-sponsor',
    );
    if (second.status !== 'rejected') throw new Error('expected rejection');
    expect(second.rejection.code).toBe('sponsor-already-purchased');

    const expiredRun = { ...run, cursor: { ...run.cursor, completedRounds: 10 } };
    const expired = resultOf(
      handleSeasonRunCommand(
        buyCommand(expiredRun, offer.instanceId, 'cmd-buy-x4'),
        runContext(expiredRun),
      ),
      'buy-sponsor',
    );
    if (expired.status !== 'rejected') throw new Error('expected rejection');
    expect(expired.rejection.code).toBe('sponsor-expired');

    const broke = {
      ...run,
      influence: { ...run.influence, balances: { ...run.influence.balances, [HUMAN]: 0 } },
    };
    const poor = resultOf(
      handleSeasonRunCommand(buyCommand(broke, offer.instanceId, 'cmd-buy-x5'), runContext(broke)),
      'buy-sponsor',
    );
    if (poor.status !== 'rejected') throw new Error('expected rejection');
    expect(poor.rejection.code).toBe('insufficient-balance');
  });

  it('returns duplicate-command for a replayed purchase', () => {
    const { run } = sponsoredRun(hexSeed(109));
    const board = normalizeSponsorGearState(run.sponsors).boards.boards[0];
    const offer = board?.offers.find((candidate) => candidate.price === 1);
    if (board === undefined || offer === undefined) throw new Error('no BUZZ offer dealt');
    const first = handleSeasonRunCommand(
      buyCommand(run, offer.instanceId, 'cmd-buy-dup'),
      runContext(run),
    );
    if (resultOf(first, 'buy-sponsor').status !== 'accepted')
      throw new Error('expected acceptance');
    const replay = resultOf(
      handleSeasonRunCommand(
        buyCommand(run, offer.instanceId, 'cmd-buy-dup'),
        runContext(first.run),
      ),
      'buy-sponsor',
    );
    if (replay.status !== 'rejected') throw new Error('expected rejection');
    expect(replay.rejection.code).toBe('duplicate-command');
  });
});

describe('apply-sponsor command', () => {
  function boughtRun(seed: string): { run: SeasonRun; instanceId: string; slot: string } {
    const { run } = sponsoredRun(seed);
    const board = normalizeSponsorGearState(run.sponsors).boards.boards[0];
    const offer = board?.offers.find((candidate) => candidate.price === 1);
    if (board === undefined || offer === undefined) throw new Error('no BUZZ offer dealt');
    const output = handleSeasonRunCommand(
      buyCommand(run, offer.instanceId, 'cmd-buy-a1'),
      runContext(run),
    );
    if (resultOf(output, 'buy-sponsor').status !== 'accepted') throw new Error('buy failed');
    return { run: output.run, instanceId: offer.instanceId, slot: offer.slot };
  }

  it('applies a vault item irreversibly and consumes it', () => {
    const { run, instanceId, slot } = boughtRun(hexSeed(110));
    const player = humanPlayer(run);
    const output = handleSeasonRunCommand(
      applyCommand(run, instanceId, player, slot, 'cmd-apply-1'),
      runContext(run),
    );
    const result = resultOf(output, 'apply-sponsor');
    if (result.status !== 'accepted')
      throw new Error(`expected acceptance: ${JSON.stringify(result)}`);
    const sponsors = normalizeSponsorGearState(output.run.sponsors);
    expect(sponsors.vault.items).toHaveLength(0);
    const filled = sponsors.players.slots[player]?.[slot as 'shoe' | 'apparel' | 'fuel'];
    expect(filled?.instanceId).toBe(instanceId);
    const again = resultOf(
      handleSeasonRunCommand(
        applyCommand(output.run, instanceId, player, slot, 'cmd-apply-2'),
        runContext(output.run),
      ),
      'apply-sponsor',
    );
    if (again.status !== 'rejected') throw new Error('expected rejection');
    expect(again.rejection.code).toBe('sponsor-not-owned');
    const replay = resultOf(
      handleSeasonRunCommand(
        applyCommand(run, instanceId, player, slot, 'cmd-apply-1'),
        runContext(output.run),
      ),
      'apply-sponsor',
    );
    if (replay.status !== 'rejected') throw new Error('expected rejection');
    expect(replay.rejection.code).toBe('duplicate-command');
  });

  it('rejects mismatch, occupied, off-roster, and brand-duplicate applies', () => {
    const { run, instanceId, slot } = boughtRun(hexSeed(112));
    const player = humanPlayer(run);
    const otherSlot = (['shoe', 'apparel', 'fuel'] as const).find((s) => s !== slot);
    if (otherSlot === undefined) throw new Error('slot missing');
    const mismatch = resultOf(
      handleSeasonRunCommand(
        applyCommand(run, instanceId, player, otherSlot, 'cmd-m1'),
        runContext(run),
      ),
      'apply-sponsor',
    );
    if (mismatch.status !== 'rejected') throw new Error('expected rejection');
    expect(mismatch.rejection.code).toBe('sponsor-slot-mismatch');

    const otherRoster = run.rosters.find((entry) => entry.franchiseId !== HUMAN);
    const outsider = otherRoster?.players[0]?.playerVersionId;
    if (outsider === undefined) throw new Error('no away roster');
    const offRoster = resultOf(
      handleSeasonRunCommand(
        applyCommand(run, instanceId, outsider, slot, 'cmd-m2'),
        runContext(run),
      ),
      'apply-sponsor',
    );
    if (offRoster.status !== 'rejected') throw new Error('expected rejection');
    expect(offRoster.rejection.code).toBe('sponsor-not-on-roster');

    const applied = handleSeasonRunCommand(
      applyCommand(run, instanceId, player, slot, 'cmd-m3'),
      runContext(run),
    );
    if (resultOf(applied, 'apply-sponsor').status !== 'accepted') throw new Error('apply failed');
    const filled = normalizeSponsorGearState(applied.run.sponsors).players.slots[player];
    const family = filled?.[slot as 'shoe' | 'apparel' | 'fuel']?.brandFamily ?? 'missing';
    const dupeSlot = (['shoe', 'apparel', 'fuel'] as const).find((s) => s !== slot);
    if (dupeSlot === undefined) throw new Error('slot missing');
    const board = normalizeSponsorGearState(applied.run.sponsors).boards.boards[0];
    const sameFamily = board?.offers.find(
      (candidate) => candidate.brandFamily === family && candidate.slot === dupeSlot,
    );
    if (sameFamily !== undefined) {
      const withDupe = {
        ...applied.run,
        sponsors: {
          ...normalizeSponsorGearState(applied.run.sponsors),
          vault: {
            ...normalizeSponsorGearState(applied.run.sponsors).vault,
            items: [
              {
                instanceId: sameFamily.instanceId,
                entryId: sameFamily.entryId,
                acquiredBlock: 0,
                acquiredByCommandId: 'cmd-dupe-seed',
              },
            ],
          },
        },
      };
      const dupe = resultOf(
        handleSeasonRunCommand(
          applyCommand(withDupe, sameFamily.instanceId, player, dupeSlot, 'cmd-m4'),
          runContext(withDupe),
        ),
        'apply-sponsor',
      );
      if (dupe.status !== 'rejected') throw new Error('expected rejection');
      expect(dupe.rejection.code).toBe('sponsor-brand-duplicate');
    }
    const occupied = resultOf(
      handleSeasonRunCommand(
        applyCommand(applied.run, instanceId, player, slot, 'cmd-m5'),
        runContext(applied.run),
      ),
      'apply-sponsor',
    );
    if (occupied.status !== 'rejected') throw new Error('expected rejection');
    expect(occupied.rejection.code).toBe('sponsor-not-owned');
  });
});

describe('sponsor block commit', () => {
  it('deals the next board and kits AI teams deterministically', () => {
    const { run, catalog } = sponsoredRun(hexSeed(117));
    const ratings = new Map(
      catalog.candidates.map((candidate) => [candidate.playerVersionId, candidate.detailedRatings]),
    );
    const aiIds = run.league.teams.map((team) => team.franchiseId).filter((id) => id !== HUMAN);
    const first = sponsorsWithBlockCommit({
      rootSeed: run.rootSeed,
      acceptedBlockIndex: 0,
      sponsors: normalizeSponsorGearState(run.sponsors),
      rotations: run.rotations,
      ratings,
      humanFranchiseId: HUMAN,
      aiFranchiseIds: aiIds,
    });
    expect(first.boards.boards.map((board) => board.blockIndex)).toEqual([0, 1]);
    expect(first.boards.boards[1]?.offers).toHaveLength(5);
    const filled = Object.values(first.players.slots).flatMap((slots) =>
      [slots.shoe, slots.apparel, slots.fuel].filter((slot) => slot !== null),
    );
    expect(filled.length).toBeGreaterThan(0);
    expect(filled.length).toBeLessThanOrEqual(aiIds.length);
    const second = sponsorsWithBlockCommit({
      rootSeed: run.rootSeed,
      acceptedBlockIndex: 0,
      sponsors: normalizeSponsorGearState(run.sponsors),
      rotations: run.rotations,
      ratings,
      humanFranchiseId: HUMAN,
      aiFranchiseIds: aiIds,
    });
    expect(second).toEqual(first);
    const humanSlots = Object.entries(first.players.slots).filter(([player]) =>
      run.ownership.some((row) => row.playerVersionId === player && row.ownerFranchiseId === HUMAN),
    );
    expect(humanSlots).toHaveLength(0);
  });

  it('resolves AI kits for the neediest starter slot only', () => {
    const { run, catalog } = sponsoredRun(hexSeed(118));
    const ratings = new Map(
      catalog.candidates.map((candidate) => [candidate.playerVersionId, candidate.detailedRatings]),
    );
    const aiId = run.league.teams.map((team) => team.franchiseId).find((id) => id !== HUMAN);
    if (aiId === undefined) throw new Error('no AI franchise');
    const rotation = run.rotations.find((entry) => entry.franchiseId === aiId);
    const kit = resolveAiSponsorKit({
      rootSeed: run.rootSeed,
      blockIndex: 0,
      franchiseId: aiId,
      rotation,
      ratings,
      applied: new Map(),
    });
    expect(kit).not.toBeNull();
    expect(rotation?.starters).toContain(kit?.playerVersionId);
    const again = resolveAiSponsorKit({
      rootSeed: run.rootSeed,
      blockIndex: 0,
      franchiseId: aiId,
      rotation,
      ratings,
      applied: new Map(),
    });
    expect(again).toEqual(kit);
  });
});

describe('sponsor sim hookup', () => {
  it('boosts expanded ratings through the existing ratings path', () => {
    const { run, catalog } = sponsoredRun(hexSeed(119));
    const player = humanPlayer(run);
    const board = normalizeSponsorGearState(run.sponsors).boards.boards[0];
    const offer = board?.offers[0];
    if (board === undefined || offer === undefined) throw new Error('no offer dealt');
    const bought = handleSeasonRunCommand(
      buyCommand(
        {
          ...run,
          influence: {
            ...run.influence,
            balances: { ...run.influence.balances, [HUMAN]: 8 },
          },
        },
        offer.instanceId,
        'cmd-sim-buy',
      ),
      runContext({
        ...run,
        influence: {
          ...run.influence,
          balances: { ...run.influence.balances, [HUMAN]: 8 },
        },
      }),
    );
    if (resultOf(bought, 'buy-sponsor').status !== 'accepted') throw new Error('buy failed');
    const applied = handleSeasonRunCommand(
      applyCommand(bought.run, offer.instanceId, player, offer.slot, 'cmd-sim-apply'),
      runContext(bought.run),
    );
    if (resultOf(applied, 'apply-sponsor').status !== 'accepted') throw new Error('apply failed');
    const expanded = expandSeasonRunRosters(applied.run, catalog);
    const base = catalog.candidates.find(
      (candidate) => candidate.playerVersionId === player,
    )?.detailedRatings;
    const boosted = expanded.get(player)?.ratings;
    if (base === undefined || boosted === undefined) throw new Error('expansion failed');
    for (const boost of offer.boosts) {
      expect(boosted[boost.key]).toBe(Math.min(100, base[boost.key] + boost.points));
    }
  });
});
