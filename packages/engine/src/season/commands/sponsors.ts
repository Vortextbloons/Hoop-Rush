import type { SeasonApplySponsorCommand, SeasonBuySponsorCommand } from '@hoop-rush/data-contracts';
import {
  SEASON_SPONSOR_SLOTS,
  franchiseIdSchema,
  normalizeSponsorGearState,
  sponsorGearEntryOf,
} from '@hoop-rush/data-contracts';
import { seasonNextBlockIndex } from '../block.ts';
import { SEASON_INFLUENCE_FLOOR, applySeasonInfluenceSpend } from '../influence.ts';
import type { SeasonEconomyRun } from '../trades.ts';
import { seasonTransactionEntry } from '../transactions.ts';
import {
  acceptedCommand,
  advanceRunState,
  baseValidation,
  economyRunOf,
  rejectedCommand,
  type SeasonRunCommandContext,
  type SeasonRunCommandOutput,
} from './shared.ts';
function sponsorHumanFranchiseId(run: SeasonEconomyRun, context: SeasonRunCommandContext): string {
  return (
    context.humanFranchiseId ??
    run.league.teams.find((t) => t.control === 'human')?.franchiseId ??
    ''
  );
}
export function handleBuySponsor(
  command: SeasonBuySponsorCommand,
  context: SeasonRunCommandContext,
): SeasonRunCommandOutput {
  const base = baseValidation(command, context.run, context.pending, context);
  if (base !== null) return base;
  const run = economyRunOf(context);
  const humanFid = franchiseIdSchema.parse(sponsorHumanFranchiseId(run, context));
  const sponsors = normalizeSponsorGearState(run.sponsors);
  const currentBlock = seasonNextBlockIndex(run.cursor.completedRounds);
  const board = sponsors.boards.boards.find((entry) => entry.blockIndex === currentBlock);
  const offer = board?.offers.find((candidate) => candidate.instanceId === command.instanceId);
  if (board === undefined || offer === undefined) {
    const stale = sponsors.boards.boards
      .flatMap((entry) => entry.offers)
      .find((candidate) => candidate.instanceId === command.instanceId);
    if (stale !== undefined) {
      return rejectedCommand(
        command,
        {
          code: 'sponsor-expired',
          instanceId: command.instanceId,
          blockIndex: stale.blockIndex,
        },
        run,
      );
    }
    return rejectedCommand(
      command,
      { code: 'sponsor-not-offered', instanceId: command.instanceId, blockIndex: currentBlock },
      run,
    );
  }
  const owned =
    sponsors.vault.items.some((item) => item.instanceId === command.instanceId) ||
    Object.values(sponsors.players.slots).some(
      (slots) =>
        slots.shoe?.instanceId === command.instanceId ||
        slots.apparel?.instanceId === command.instanceId ||
        slots.fuel?.instanceId === command.instanceId,
    );
  if (board.purchasedInstanceIds.includes(command.instanceId) || owned) {
    return rejectedCommand(
      command,
      {
        code: 'sponsor-already-purchased',
        instanceId: command.instanceId,
        blockIndex: board.blockIndex,
      },
      run,
    );
  }
  const balance = run.influence.balances[humanFid] ?? 0;
  if (balance - offer.price < SEASON_INFLUENCE_FLOOR) {
    return rejectedCommand(
      command,
      {
        code: 'insufficient-balance',
        franchiseId: humanFid,
        balance,
        requestedDelta: -offer.price,
        floor: SEASON_INFLUENCE_FLOOR,
      },
      run,
    );
  }
  const spend = applySeasonInfluenceSpend({
    influence: run.influence,
    franchiseId: humanFid,
    source: 'sponsor-purchase',
    requestedDelta: -offer.price,
    blockIndex: board.blockIndex,
    commandId: command.commandId,
    explanation: `Sponsor ${offer.brandFamily} ${offer.tier} (${offer.slot})`,
  });
  const nextSponsors = {
    ...sponsors,
    vault: {
      ...sponsors.vault,
      items: [
        ...sponsors.vault.items,
        {
          instanceId: offer.instanceId,
          entryId: offer.entryId,
          acquiredBlock: board.blockIndex,
          acquiredByCommandId: command.commandId,
        },
      ],
    },
    boards: {
      ...sponsors.boards,
      boards: sponsors.boards.boards.map((entry) =>
        entry.blockIndex === board.blockIndex
          ? { ...entry, purchasedInstanceIds: [...entry.purchasedInstanceIds, offer.instanceId] }
          : entry,
      ),
    },
  };
  const nextRunBase = {
    ...run,
    sponsors: nextSponsors,
    influence: spend.influence,
    transactions: [
      ...run.transactions,
      seasonTransactionEntry({
        transactionId: `txn-sponsor-purchase-${command.commandId}`,
        commandId: command.commandId,
        franchiseId: humanFid,
        type: 'sponsor-purchase',
        blockIndex: board.blockIndex,
        appliedAtStateRevision: run.stateRevision + 1,
        payload: { instanceId: offer.instanceId, entryId: offer.entryId, price: offer.price },
        explanation: `Sponsor purchase ${offer.brandFamily} ${offer.tier} (${offer.slot})`,
      }),
    ],
  };
  const next = advanceRunState(nextRunBase);
  return acceptedCommand(
    command,
    {
      instanceId: offer.instanceId,
      entryId: offer.entryId,
      price: offer.price,
    },
    next,
    null,
  );
}
export function handleApplySponsor(
  command: SeasonApplySponsorCommand,
  context: SeasonRunCommandContext,
): SeasonRunCommandOutput {
  const base = baseValidation(command, context.run, context.pending, context);
  if (base !== null) return base;
  const run = economyRunOf(context);
  const humanFid = franchiseIdSchema.parse(sponsorHumanFranchiseId(run, context));
  const sponsors = normalizeSponsorGearState(run.sponsors);
  const vaultIndex = sponsors.vault.items.findIndex(
    (item) => item.instanceId === command.instanceId,
  );
  if (vaultIndex === -1) {
    return rejectedCommand(
      command,
      { code: 'sponsor-not-owned', instanceId: command.instanceId },
      run,
    );
  }
  const vaultItem = sponsors.vault.items[vaultIndex];
  if (vaultItem === undefined) {
    return rejectedCommand(
      command,
      { code: 'sponsor-not-owned', instanceId: command.instanceId },
      run,
    );
  }
  const entry = sponsorGearEntryOf(vaultItem.entryId);
  if (entry.slot !== command.slot) {
    return rejectedCommand(
      command,
      {
        code: 'sponsor-slot-mismatch',
        instanceId: command.instanceId,
        expectedSlot: entry.slot,
        slot: command.slot,
      },
      run,
    );
  }
  const owner = run.ownership.find(
    (row) => row.playerVersionId === command.playerVersionId,
  )?.ownerFranchiseId;
  if (owner !== humanFid) {
    return rejectedCommand(
      command,
      { code: 'sponsor-not-on-roster', playerVersionId: command.playerVersionId },
      run,
    );
  }
  const slots = sponsors.players.slots[command.playerVersionId] ?? {
    shoe: null,
    apparel: null,
    fuel: null,
  };
  if (slots[command.slot] !== null) {
    return rejectedCommand(
      command,
      {
        code: 'sponsor-slot-occupied',
        playerVersionId: command.playerVersionId,
        slot: command.slot,
      },
      run,
    );
  }
  for (const slot of SEASON_SPONSOR_SLOTS) {
    if (slots[slot]?.brandFamily === entry.brandFamily) {
      return rejectedCommand(
        command,
        {
          code: 'sponsor-brand-duplicate',
          playerVersionId: command.playerVersionId,
          brandFamily: entry.brandFamily,
        },
        run,
      );
    }
  }
  const offer = sponsors.boards.boards
    .flatMap((board) => board.offers)
    .find((candidate) => candidate.instanceId === command.instanceId);
  if (offer === undefined) {
    throw new Error(`sponsor vault item ${command.instanceId} has no dealt offer`);
  }
  const currentBlock = seasonNextBlockIndex(run.cursor.completedRounds);
  const nextSponsors = {
    ...sponsors,
    vault: {
      ...sponsors.vault,
      items: sponsors.vault.items.filter((_, index) => index !== vaultIndex),
    },
    players: {
      ...sponsors.players,
      slots: {
        ...sponsors.players.slots,
        [command.playerVersionId]: {
          ...slots,
          [command.slot]: {
            instanceId: offer.instanceId,
            entryId: offer.entryId,
            brandFamily: offer.brandFamily,
            slot: command.slot,
            tier: offer.tier,
            boosts: offer.boosts,
            appliedBlock: currentBlock ?? 8,
            appliedByCommandId: command.commandId,
          },
        },
      },
    },
  };
  const next = advanceRunState({ ...run, sponsors: nextSponsors });
  return acceptedCommand(
    command,
    {
      instanceId: offer.instanceId,
      playerVersionId: command.playerVersionId,
      slot: command.slot,
    },
    next,
    null,
  );
}
