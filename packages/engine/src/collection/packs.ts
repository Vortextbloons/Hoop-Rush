import {
  canonicalJson,
  seasonDigestHex,
  type CollectionBalances,
  type CollectionCatalog,
  type CollectionCatalogCard,
  type CollectionCommand,
  type CollectionLedgerEntry,
  type CollectionPackDefinition,
  type CollectionPullRecord,
  type CollectionRarity,
  type CollectionState,
  type PositionUnion,
  type SlotIndex,
} from '@hoop-rush/data-contracts';
import {
  COLLECTION_CATALOG_VERSION,
  COLLECTION_ECONOMY_VERSION,
  COLLECTION_PACK_RULES_VERSION,
  COLLECTION_RARITY_ORDER,
  COLLECTION_SCHEMA_VERSION,
  COLLECTION_VERSION,
} from '@hoop-rush/data-contracts';
import { canFillSlot } from '../domain/lineup.ts';
import { assignLineup } from '../domain/lineup.ts';
import { createRng, swapAt } from '../sim/rng.ts';
import { collectionStateDigest, collectionStateFactsOf } from './cards.ts';
import { collectionPullSeed, collectionStarterSeed } from './seeds.ts';

export const WELCOME_COIN_GRANT = 3000;

export class CollectionCommandError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

function seedPathOf(parts: string[]): string[] {
  return parts;
}

export function eligiblePackCards(
  catalog: CollectionCatalog,
  pack: CollectionPackDefinition,
): CollectionCatalogCard[] {
  return catalog.cards.filter((card) =>
    pack.eligibleScope === 'specials-only' ? card.family !== 'Base' : true,
  );
}

export function validateCollectionPackDef(
  pack: CollectionPackDefinition,
  catalog: CollectionCatalog,
): void {
  const eligible = eligiblePackCards(catalog, pack);
  if (eligible.length === 0) {
    throw new CollectionCommandError(
      'invalid-definition',
      `pack ${pack.packId} has no eligible cards`,
    );
  }
  const byRarity = new Map<CollectionRarity, CollectionCatalogCard[]>();
  for (const card of eligible) {
    const list = byRarity.get(card.rarity) ?? [];
    list.push(card);
    byRarity.set(card.rarity, list);
  }
  for (const rarity of COLLECTION_RARITY_ORDER) {
    if (pack.rarityWeights[rarity] <= 0) continue;
    const reachable = pack.slots.some((slot) => {
      const floor = slot.kind === 'guaranteed' ? (slot.floorRarity ?? 'Ember') : 'Ember';
      return COLLECTION_RARITY_ORDER.indexOf(rarity) >= COLLECTION_RARITY_ORDER.indexOf(floor);
    });
    if (reachable && (byRarity.get(rarity) ?? []).length === 0) {
      throw new CollectionCommandError(
        'invalid-definition',
        `pack ${pack.packId} weights reachable ${rarity} with no eligible cards`,
      );
    }
  }
  for (const slot of pack.slots) {
    if (slot.kind === 'guaranteed') {
      const floor = slot.floorRarity ?? 'Ember';
      const floorIndex = COLLECTION_RARITY_ORDER.indexOf(floor);
      const covered = COLLECTION_RARITY_ORDER.slice(floorIndex).some(
        (rarity) => (byRarity.get(rarity) ?? []).length > 0,
      );
      if (!covered) {
        throw new CollectionCommandError(
          'invalid-definition',
          `pack ${pack.packId} guarantees ${floor}+ with no eligible cards`,
        );
      }
    }
  }
}

export function slotRarityDistribution(
  pack: CollectionPackDefinition,
  slotIndex: number,
  catalog: CollectionCatalog,
): Record<CollectionRarity, number> {
  const slot = pack.slots[slotIndex];
  if (slot === undefined)
    throw new CollectionCommandError('invalid-definition', 'slot out of range');
  const eligible = eligiblePackCards(catalog, pack);
  const counts = new Map<CollectionRarity, number>();
  for (const card of eligible) counts.set(card.rarity, (counts.get(card.rarity) ?? 0) + 1);
  const floor = slot.kind === 'guaranteed' ? (slot.floorRarity ?? 'Ember') : 'Ember';
  const floorIndex = COLLECTION_RARITY_ORDER.indexOf(floor);
  let total = 0;
  for (const rarity of COLLECTION_RARITY_ORDER.slice(floorIndex)) {
    if ((counts.get(rarity) ?? 0) > 0) total += pack.rarityWeights[rarity];
  }
  const distribution = {} as Record<CollectionRarity, number>;
  for (const rarity of COLLECTION_RARITY_ORDER) {
    if (COLLECTION_RARITY_ORDER.indexOf(rarity) < floorIndex || (counts.get(rarity) ?? 0) === 0) {
      distribution[rarity] = 0;
    } else {
      distribution[rarity] = total > 0 ? pack.rarityWeights[rarity] / total : 0;
    }
  }
  return distribution;
}

function drawRarity(
  distribution: Record<CollectionRarity, number>,
  roll: number,
): CollectionRarity {
  let cursor = roll;
  for (const rarity of COLLECTION_RARITY_ORDER) {
    cursor -= distribution[rarity];
    if (cursor < 0) return rarity;
  }
  for (let i = COLLECTION_RARITY_ORDER.length - 1; i >= 0; i -= 1) {
    const rarity = COLLECTION_RARITY_ORDER[i];
    if (rarity !== undefined && distribution[rarity] > 0) return rarity;
  }
  throw new CollectionCommandError('invalid-definition', 'empty rarity distribution');
}

function sortedEligibleIds(
  catalog: CollectionCatalog,
  pack: CollectionPackDefinition,
  rarity: CollectionRarity,
): string[] {
  return eligiblePackCards(catalog, pack)
    .filter((card) => card.rarity === rarity)
    .map((card) => card.cardId)
    .sort();
}

export interface StarterResult {
  cardIds: string[];
  assignment: Array<{ slotIndex: SlotIndex; playerId: string }>;
  seedPath: string[];
}

function slotsFeasible(
  remainingSlots: SlotIndex[],
  candidates: Array<{ playerId: string; positions: PositionUnion }>,
  usedPlayers: Set<string>,
): boolean {
  const pool = candidates.filter((candidate) => !usedPlayers.has(candidate.playerId));
  function search(index: number, taken: Set<string>): boolean {
    if (index === remainingSlots.length) return true;
    const slot = remainingSlots[index];
    if (slot === undefined) return false;
    for (const candidate of pool) {
      if (taken.has(candidate.playerId)) continue;
      if (!canFillSlot(candidate.positions, slot)) continue;
      taken.add(candidate.playerId);
      if (search(index + 1, taken)) return true;
      taken.delete(candidate.playerId);
    }
    return false;
  }
  return search(0, new Set());
}

export function generateCollectionStarter(
  catalog: CollectionCatalog,
  rootSeed: string,
): StarterResult {
  const seed = collectionStarterSeed(rootSeed);
  const rng = createRng(seed);
  const emberBase = catalog.cards
    .filter((card) => card.family === 'Base' && card.rarity === 'Ember')
    .sort((a, b) => (a.cardId < b.cardId ? -1 : 1));
  if (emberBase.length === 0) {
    throw new CollectionCommandError('no-feasible-starter', 'no Ember base cards in catalog');
  }
  const order = [...emberBase];
  for (let i = order.length - 1; i > 0; i -= 1) {
    swapAt(order, i, rng.nextInt(0, i));
  }
  const slots: SlotIndex[] = [0, 1, 2, 3, 4];
  const chosen: CollectionCatalogCard[] = [];
  const usedPlayers = new Set<string>();
  const candidates = order.map((card) => ({
    playerId: card.playerId,
    positions: card.positions,
    card,
  }));
  for (const [slotPosition, slot] of slots.entries()) {
    let picked: CollectionCatalogCard | null = null;
    for (const candidate of candidates) {
      if (usedPlayers.has(candidate.playerId)) continue;
      if (chosen.some((entry) => entry.cardId === candidate.card.cardId)) continue;
      if (!canFillSlot(candidate.positions, slot)) continue;
      const probeUsed = new Set(usedPlayers);
      probeUsed.add(candidate.playerId);
      if (!slotsFeasible(slots.slice(slotPosition + 1), candidates, probeUsed)) continue;
      picked = candidate.card;
      break;
    }
    if (picked === null) {
      throw new CollectionCommandError(
        'no-feasible-starter',
        `no completion-aware Ember candidate fills slot ${String(slot)}`,
      );
    }
    chosen.push(picked);
    usedPlayers.add(picked.playerId);
  }
  const assignment = assignLineup(
    chosen.map((card) => ({ playerId: card.playerId, positions: card.positions })),
  );
  if (assignment === null) {
    throw new CollectionCommandError('no-feasible-starter', 'starter cannot fill G/G/F/F/C');
  }
  return {
    cardIds: chosen.map((card) => card.cardId),
    assignment: assignment.map((entry) => ({
      slotIndex: entry.slotIndex,
      playerId: entry.playerId,
    })),
    seedPath: seedPathOf(['collection', 'starter']),
  };
}

export interface PackDraw {
  slotIndex: number;
  cardId: string;
  rarity: CollectionRarity;
}

export function drawCollectionPackSlots(
  catalog: CollectionCatalog,
  pack: CollectionPackDefinition,
  rootSeed: string,
  pullSequence: number,
): { draws: PackDraw[]; seedPath: string[] } {
  validateCollectionPackDef(pack, catalog);
  const seed = collectionPullSeed(rootSeed, pack.packId, pack.packRulesVersion, pullSequence);
  const rng = createRng(seed);
  const draws: PackDraw[] = [];
  for (const [slotIndex] of pack.slots.entries()) {
    const distribution = slotRarityDistribution(pack, slotIndex, catalog);
    const rarity = drawRarity(distribution, rng.next());
    const ids = sortedEligibleIds(catalog, pack, rarity);
    if (ids.length === 0) {
      throw new CollectionCommandError(
        'invalid-definition',
        `pack ${pack.packId} slot ${String(slotIndex)} has no ${rarity} cards`,
      );
    }
    draws.push({ slotIndex, cardId: rng.pick(ids), rarity });
  }
  return {
    draws,
    seedPath: seedPathOf([
      'collection',
      'pulls',
      pack.packId,
      pack.packRulesVersion,
      String(pullSequence),
    ]),
  };
}

export interface PackOdds {
  packId: string;
  priceCurrency: string;
  priceAmount: number;
  cardCount: number;
  perSlot: Array<{
    slotIndex: number;
    kind: string;
    distribution: Record<CollectionRarity, number>;
  }>;
  atLeastOne: Record<CollectionRarity, number>;
  eligibleCounts: Record<CollectionRarity, number>;
  duplicateExchange: Record<CollectionRarity, number>;
}

export function describeCollectionPackOdds(
  catalog: CollectionCatalog,
  pack: CollectionPackDefinition,
): PackOdds {
  validateCollectionPackDef(pack, catalog);
  const eligible = eligiblePackCards(catalog, pack);
  const eligibleCounts = {} as Record<CollectionRarity, number>;
  for (const rarity of COLLECTION_RARITY_ORDER) {
    eligibleCounts[rarity] = eligible.filter((card) => card.rarity === rarity).length;
  }
  const perSlot = pack.slots.map((slot, slotIndex) => ({
    slotIndex,
    kind: slot.kind,
    distribution: slotRarityDistribution(pack, slotIndex, catalog),
  }));
  const atLeastOne = {} as Record<CollectionRarity, number>;
  for (const rarity of COLLECTION_RARITY_ORDER) {
    let none = 1;
    for (const slot of perSlot) none *= 1 - slot.distribution[rarity];
    atLeastOne[rarity] = 1 - none;
  }
  return {
    packId: pack.packId,
    priceCurrency: pack.priceCurrency,
    priceAmount: pack.priceAmount,
    cardCount: pack.slots.length,
    perSlot,
    atLeastOne,
    eligibleCounts,
    duplicateExchange: { ...pack.duplicateExchange },
  };
}

function ledgerTxnId(commandId: string, pullSequence: number, index: number): string {
  return `txn-${seasonDigestHex(`collection-txn\u0000${commandId}\u0000${String(pullSequence)}\u0000${String(index)}`)}`;
}

function addChecked(a: number, b: number, what: string): number {
  const sum = a + b;
  if (!Number.isSafeInteger(sum)) {
    throw new CollectionCommandError('arithmetic-overflow', `${what} overflows safe integers`);
  }
  return sum;
}

export interface AcceptedCollectionResult {
  status: 'accepted';
  state: CollectionState;
  pull: CollectionPullRecord;
  ledgerEntries: CollectionLedgerEntry[];
}

export interface RejectedCollectionResult {
  status: 'rejected';
  rejection: { code: string; [key: string]: unknown };
}

export type CollectionCommandResult = AcceptedCollectionResult | RejectedCollectionResult;

function reject(code: string, extra: Record<string, unknown> = {}): RejectedCollectionResult {
  return { status: 'rejected', rejection: { code, ...extra } };
}

export function applyCollectionCommand(
  state: CollectionState,
  command: CollectionCommand,
  catalog: CollectionCatalog,
  pulls: readonly CollectionPullRecord[],
  ledger: readonly CollectionLedgerEntry[],
  priorCommands: readonly CollectionCommand[],
  catalogHash: string,
): CollectionCommandResult {
  if (command.collectionId !== state.collectionId) {
    return reject('collection-mismatch', { expectedCollectionId: state.collectionId });
  }
  const prior = priorCommands.find((entry) => entry.commandId === command.commandId);
  if (prior !== undefined) {
    if (canonicalJson(prior) === canonicalJson(command)) {
      return reject('duplicate-command', { commandId: command.commandId });
    }
    return reject('conflicting-command-reuse', { commandId: command.commandId });
  }
  for (const pull of pulls) {
    if (pull.commandId === command.commandId) {
      return reject('duplicate-command', { commandId: command.commandId });
    }
  }
  for (const entry of ledger) {
    if (entry.commandId === command.commandId) {
      return reject('duplicate-command', { commandId: command.commandId });
    }
  }
  const currentDigest = collectionStateDigest(collectionStateFactsOf(state));
  if (command.expectedRevision !== state.revision || command.expectedDigest !== currentDigest) {
    return reject('stale-state', {
      expectedRevision: command.expectedRevision,
      expectedDigest: command.expectedDigest,
      currentRevision: state.revision,
      currentDigest,
    });
  }
  try {
    if (command.command === 'claim-welcome') {
      return applyClaimWelcome(state, command, catalog, catalogHash);
    }
    return applyOpenPack(state, command, catalog, catalogHash);
  } catch (error) {
    if (error instanceof CollectionCommandError) {
      return reject(error.code, { detail: error.message });
    }
    throw error;
  }
}

function commitState(
  state: CollectionState,
  owned: CollectionState['owned'],
  balances: CollectionBalances,
  claimedWelcome: boolean,
): CollectionState {
  const next: CollectionState = {
    schemaVersion: COLLECTION_SCHEMA_VERSION,
    collectionVersion: COLLECTION_VERSION,
    catalogVersion: COLLECTION_CATALOG_VERSION,
    economyVersion: COLLECTION_ECONOMY_VERSION,
    collectionId: state.collectionId,
    rootSeed: state.rootSeed,
    revision: state.revision + 1,
    digest: '0'.repeat(32),
    claimedWelcome,
    owned,
    balances,
    nextPullSequence: state.nextPullSequence + 1,
  };
  return { ...next, digest: collectionStateDigest(collectionStateFactsOf(next)) };
}

function applyClaimWelcome(
  state: CollectionState,
  command: Extract<CollectionCommand, { command: 'claim-welcome' }>,
  catalog: CollectionCatalog,
  catalogHash: string,
): CollectionCommandResult {
  if (state.claimedWelcome) return reject('already-claimed');
  const welcomeCatalogVersion: string = catalog.catalogVersion;
  if (welcomeCatalogVersion !== state.catalogVersion) {
    return reject('incompatible-content', { detail: welcomeCatalogVersion });
  }
  let starter: StarterResult;
  try {
    starter = generateCollectionStarter(catalog, state.rootSeed);
  } catch (error) {
    if (error instanceof CollectionCommandError)
      return reject(error.code, { detail: error.message });
    throw error;
  }
  const pullSequence = state.nextPullSequence;
  const byId = new Map(catalog.cards.map((card) => [card.cardId, card]));
  const slots = starter.cardIds.map((cardId, slotIndex) => {
    const card = byId.get(cardId);
    if (card === undefined) throw new CollectionCommandError('missing-content', cardId);
    return { slotIndex, cardId, rarity: card.rarity, kept: true, conversionAmount: 0 };
  });
  const owned: CollectionState['owned'] = starter.cardIds.map((cardId, slotIndex) => ({
    cardId,
    acquiredPullSequence: pullSequence,
    acquiredSlotIndex: slotIndex,
    acquiredAtIso: command.acquiredAtIso,
  }));
  const balances: CollectionBalances = {
    Coins: addChecked(state.balances.Coins, WELCOME_COIN_GRANT, 'welcome grant'),
    Exchange: state.balances.Exchange,
  };
  const pull: CollectionPullRecord = {
    pullSequence,
    kind: 'welcome',
    packId: undefined,
    packRulesVersion: catalog.packs[0]?.packRulesVersion ?? COLLECTION_PACK_RULES_VERSION,
    economyVersion: COLLECTION_ECONOMY_VERSION,
    catalogVersion: COLLECTION_CATALOG_VERSION,
    catalogHash: catalogHash as CollectionPullRecord['catalogHash'],
    commandId: command.commandId,
    seedPath: starter.seedPath,
    slots,
  };
  const ledgerEntries: CollectionLedgerEntry[] = [
    {
      transactionId: ledgerTxnId(command.commandId, pullSequence, 0),
      commandId: command.commandId,
      pullSequence,
      currency: 'Coins',
      amount: WELCOME_COIN_GRANT,
      reason: 'welcome-grant',
    },
  ];
  return {
    status: 'accepted',
    state: commitState(state, owned, balances, true),
    pull,
    ledgerEntries,
  };
}

function applyOpenPack(
  state: CollectionState,
  command: Extract<CollectionCommand, { command: 'open-pack' }>,
  catalog: CollectionCatalog,
  catalogHash: string,
): CollectionCommandResult {
  const pack = catalog.packs.find((entry) => entry.packId === command.packId);
  if (pack === undefined) return reject('missing-content', { detail: command.packId });
  const packCatalogVersion: string = catalog.catalogVersion;
  if (packCatalogVersion !== state.catalogVersion) {
    return reject('incompatible-content', { detail: packCatalogVersion });
  }
  try {
    validateCollectionPackDef(pack, catalog);
  } catch (error) {
    if (error instanceof CollectionCommandError)
      return reject(error.code, { detail: error.message });
    throw error;
  }
  const priceKey = pack.priceCurrency;
  if (state.balances[priceKey] < pack.priceAmount) {
    return reject('insufficient-funds', { currency: priceKey });
  }
  const pullSequence = state.nextPullSequence;
  const { draws, seedPath } = drawCollectionPackSlots(catalog, pack, state.rootSeed, pullSequence);
  const byId = new Map(catalog.cards.map((card) => [card.cardId, card]));
  const ownedIds = new Set(state.owned.map((entry) => entry.cardId));
  const owned: CollectionState['owned'] = [...state.owned];
  const slots: CollectionPullRecord['slots'] = [];
  const entries: CollectionLedgerEntry[] = [];
  let entryIndex = 0;
  const debit: CollectionLedgerEntry = {
    transactionId: ledgerTxnId(command.commandId, pullSequence, entryIndex),
    commandId: command.commandId,
    pullSequence,
    currency: priceKey,
    amount: -pack.priceAmount,
    reason: 'pack-purchase',
  };
  entryIndex += 1;
  entries.push(debit);
  const balances: CollectionBalances = { ...state.balances };
  balances[priceKey] = addChecked(balances[priceKey], -pack.priceAmount, 'purchase debit');
  if (balances[priceKey] < 0) return reject('insufficient-funds', { currency: priceKey });
  for (const draw of draws) {
    const card = byId.get(draw.cardId);
    if (card === undefined) return reject('missing-content', { detail: draw.cardId });
    if (ownedIds.has(draw.cardId)) {
      const amount = pack.duplicateExchange[card.rarity];
      balances.Exchange = addChecked(balances.Exchange, amount, 'duplicate credit');
      entries.push({
        transactionId: ledgerTxnId(command.commandId, pullSequence, entryIndex),
        commandId: command.commandId,
        pullSequence,
        currency: 'Exchange',
        amount,
        reason: 'duplicate-conversion',
      });
      entryIndex += 1;
      slots.push({
        slotIndex: draw.slotIndex,
        cardId: draw.cardId,
        rarity: draw.rarity,
        kept: false,
        conversionAmount: amount,
      });
    } else {
      ownedIds.add(draw.cardId);
      owned.push({
        cardId: draw.cardId,
        acquiredPullSequence: pullSequence,
        acquiredSlotIndex: draw.slotIndex,
        acquiredAtIso: command.acquiredAtIso,
      });
      slots.push({
        slotIndex: draw.slotIndex,
        cardId: draw.cardId,
        rarity: draw.rarity,
        kept: true,
        conversionAmount: 0,
      });
    }
  }
  const pull: CollectionPullRecord = {
    pullSequence,
    kind: 'pack',
    packId: pack.packId,
    packRulesVersion: pack.packRulesVersion,
    economyVersion: COLLECTION_ECONOMY_VERSION,
    catalogVersion: COLLECTION_CATALOG_VERSION,
    catalogHash: catalogHash as CollectionPullRecord['catalogHash'],
    commandId: command.commandId,
    seedPath,
    slots,
  };
  return {
    status: 'accepted',
    state: commitState(state, owned, balances, state.claimedWelcome),
    pull,
    ledgerEntries: entries,
  };
}

export function reproduceCollectionPull(
  catalog: CollectionCatalog,
  pull: CollectionPullRecord,
  rootSeed: string,
): { ok: boolean; failures: string[] } {
  if (pull.kind === 'welcome') {
    const starter = generateCollectionStarter(catalog, rootSeed);
    const failures: string[] = [];
    const ordered = [...pull.slots].sort((a, b) => a.slotIndex - b.slotIndex);
    if (ordered.length !== starter.cardIds.length) {
      return { ok: false, failures: ['starter slot count mismatch'] };
    }
    for (const [index, cardId] of starter.cardIds.entries()) {
      if (ordered[index]?.cardId !== cardId)
        failures.push(`starter slot ${String(index)} mismatch`);
    }
    return { ok: failures.length === 0, failures };
  }
  const failures: string[] = [];
  const pack = catalog.packs.find((entry) => entry.packId === pull.packId);
  if (pack === undefined) {
    return { ok: false, failures: [`unknown pack ${String(pull.packId)}`] };
  }
  const { draws } = drawCollectionPackSlots(catalog, pack, rootSeed, pull.pullSequence);
  if (draws.length !== pull.slots.length) {
    return {
      ok: false,
      failures: [`slot count ${String(pull.slots.length)} != ${String(draws.length)}`],
    };
  }
  const ordered = [...pull.slots].sort((a, b) => a.slotIndex - b.slotIndex);
  for (const [index, draw] of draws.entries()) {
    const slot = ordered[index];
    if (slot === undefined || slot.cardId !== draw.cardId) {
      failures.push(`slot ${String(draw.slotIndex)} mismatch`);
    }
  }
  return { ok: failures.length === 0, failures };
}
