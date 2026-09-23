import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import {
  COLLECTION_CATALOG_VERSION,
  COLLECTION_CHALLENGE_REWARD_VERSION,
  COLLECTION_CHALLENGE_VERSION,
  COLLECTION_ECONOMY_VERSION,
  COLLECTION_PACK_RULES_VERSION,
  COLLECTION_PROGRESSION_TARGETS_VERSION,
  COLLECTION_PROGRESSION_VERSION,
  COLLECTION_RARITY_ORDER,
  COLLECTION_SET_REWARD_VERSION,
  COLLECTION_TARGETING_VERSION,
  COLLECTION_TARGET_BASE_WEIGHT_BP,
  COLLECTION_ACTIVE_TEAM_GAME_MINUTES,
  canonicalJson,
  collectionCommandSchema,
  collectionLedgerEntrySchema,
  collectionProgressionTargetsGateFailure,
  collectionProgressionTargetsSchema,
  collectionPullRecordSchema,
  collectionScaleRewardCoins,
  type CollectionActiveTeam,
  type CollectionCatalog,
  type CollectionCatalogCard,
  type CollectionChallengeDefinition,
  type CollectionCommand,
  type CollectionGameRules,
  type CollectionLedgerEntry,
  type CollectionPackDefinition,
  type CollectionProgressionRules,
  type CollectionProgressionTargets,
  type CollectionPullRecord,
  type CollectionRarity,
  type CollectionState,
} from '@hoop-rush/data-contracts';
import {
  ENGINE_VERSION,
  allocateDefaultMinutes,
  applyCollectionCommand,
  auditCollectionState,
  canPlay,
  challengeRequirementMatchingCards,
  checkCollectionChallengeFeasibility,
  collectionSetProgress,
  collectionStateDigest,
  collectionStateFactsOf,
  compileTargetSnapshot,
  describeCollectionPackOdds,
  describeCollectionTargetOdds,
  drawCollectionPackSlots,
  drawCollectionPackSlotsTargeted,
  initializeCollectionState,
  reproduceCollectionPull,
  slotRarityDistribution,
  validateCollectionActiveTeam,
  validateCollectionChallengeTeam,
  validateCollectionProgressionRules,
  type SlotGroup,
} from '@hoop-rush/engine';
import { makeReport, type CliReport } from '../report.ts';
import { collectionProgressionCalibrateReportSchema } from '../report-schemas.ts';
import { runWorkerChunks, validateTargetsArtifact } from '../artifact.ts';
import { DEFAULT_MANIFEST, readJsonFile, sha256Hex } from './season-data.ts';
import { loadCollectionCatalog } from './collection.ts';
import { loadCollectionGameRules } from './collection-game.ts';
import { loadCollectionProgressionRules } from './collection-progression.ts';
import {
  PROGRESSION_ACQUISITION_PULL_CAP,
  PROGRESSION_ACQUISITION_SEEDS,
  PROGRESSION_CALIBRATION_HELD_OUT_SEED_OFFSET,
  PROGRESSION_CALIBRATION_TUNING_SEED_OFFSET,
  PROGRESSION_FREQUENCY_SIGMA,
  PROGRESSION_PURCHASE_PULLS,
  PROGRESSION_PURCHASE_SEEDS,
  PROGRESSION_TARGETING_PULLS_PER_JOB,
  PROGRESSION_TARGETING_PULLS_PER_PACK,
  PROGRESSION_TARGETS_GENERATED_AT_ISO,
  progressionCalibrationSeed,
  progressionHeldOutSeed,
  progressionTuningSeed,
  type ProgressionChallengeJob,
  type ProgressionDrawJob,
  type ProgressionDrawResult,
  type ProgressionGameResult,
  type ProgressionPurchaseJob,
  type ProgressionPurchaseResult,
  type ProgressionStandardJob,
} from '../collection-progression-calibration.ts';

export const COLLECTION_PROGRESSION_CALIBRATE_OPTIONS: Record<string, boolean> = {
  workers: true,
  'calibration-seeds': true,
  'validation-seeds': true,
  out: true,
  manifest: true,
  validate: true,
  format: true,
};

export const DEFAULT_COLLECTION_PROGRESSION_TARGETS = resolve(
  dirname(DEFAULT_MANIFEST),
  'collection/progression-targets.json',
);

const TARGET_ARTIFACT_URL = 'collection/progression-targets.json';
const CALIBRATION_COMMAND = 'collection progression-calibrate';
const AT_ISO = PROGRESSION_TARGETS_GENERATED_AT_ISO;
const MAX_LAUNCH_TARGET_PROBABILITY = 0.6;
const ENVELOPE_ALLOWANCE = 1.05;
const COHORT_ROSTER_SIZE = 12;
const GENESIS_COMMAND_ID = 'progression-calibration-genesis';

interface ProgressionCohortDefinition {
  cohortId: string;
  maxOverall: number;
}

export const PROGRESSION_COHORTS: readonly ProgressionCohortDefinition[] = [
  { cohortId: 'starter', maxOverall: 70 },
  { cohortId: 'developing', maxOverall: 78 },
  { cohortId: 'strong', maxOverall: 86 },
  { cohortId: 'elite', maxOverall: 99 },
];

function overallOf(card: CollectionCatalogCard): number {
  return card.summarySource?.overallRating ?? 60;
}

function compareCards(a: CollectionCatalogCard, b: CollectionCatalogCard): number {
  const byOverall = overallOf(b) - overallOf(a);
  if (byOverall !== 0) return byOverall;
  return a.cardId < b.cardId ? -1 : 1;
}

function bestCardPerPlayer(cards: readonly CollectionCatalogCard[]): CollectionCatalogCard[] {
  const byPlayer = new Map<string, CollectionCatalogCard>();
  for (const card of [...cards].sort(compareCards)) {
    if (!byPlayer.has(card.playerId)) byPlayer.set(card.playerId, card);
  }
  return [...byPlayer.values()].sort(compareCards);
}

function frequencyGate(
  observed: number,
  expected: number,
  samples: number,
): { pass: boolean; allowed: number } {
  if (samples === 0) return { pass: false, allowed: 0 };
  const variance = (expected * (1 - expected)) / samples;
  const allowed = PROGRESSION_FREQUENCY_SIGMA * Math.sqrt(Math.max(0, variance)) + 1 / samples;
  return { pass: Math.abs(observed - expected) <= allowed, allowed };
}

function quantile(sorted: readonly number[], fraction: number): number {
  if (sorted.length === 0) return 0;
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(fraction * sorted.length) - 1));
  return sorted[index] ?? 0;
}

function medianOf(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[middle] ?? 0;
  return ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2;
}

function genesisRecords(input: {
  catalog: CollectionCatalog;
  catalogHash: string;
  rootSeed: string;
  ownedCardIds: readonly string[];
  progressionHash: string;
  coins: number;
  exchange: number;
}): {
  state: CollectionState;
  pulls: CollectionPullRecord[];
  ledger: CollectionLedgerEntry[];
} {
  const sorted = [...input.ownedCardIds].sort();
  const byId = new Map(input.catalog.cards.map((card) => [card.cardId, card]));
  const pulls: CollectionPullRecord[] = [];
  const owned: CollectionState['owned'] = [];
  const CHUNK = 10;
  for (let chunk = 0; chunk * CHUNK < sorted.length; chunk += 1) {
    const members = sorted.slice(chunk * CHUNK, chunk * CHUNK + CHUNK);
    const slots = members.map((cardId, slotIndex) => {
      const card = byId.get(cardId);
      if (card === undefined) throw new Error(`genesis references unknown card ${cardId}`);
      owned.push({
        cardId: card.cardId,
        acquiredPullSequence: chunk,
        acquiredSlotIndex: slotIndex,
        acquiredAtIso: AT_ISO,
      });
      return {
        slotIndex,
        cardId: card.cardId,
        rarity: card.rarity,
        kept: true,
        conversionAmount: 0,
      };
    });
    pulls.push(
      collectionPullRecordSchema.parse({
        pullSequence: chunk,
        kind: 'pack',
        packId: input.catalog.packs[0]?.packId ?? 'tip-off',
        packRulesVersion: COLLECTION_PACK_RULES_VERSION,
        economyVersion: COLLECTION_ECONOMY_VERSION,
        catalogVersion: COLLECTION_CATALOG_VERSION,
        catalogHash: input.catalogHash,
        commandId: GENESIS_COMMAND_ID,
        seedPath: ['collection', 'calibration', 'genesis', String(chunk)],
        slots,
        replayVersion: 'collection-replay-v2',
        targeting: null,
      }),
    );
  }
  const ledger: CollectionLedgerEntry[] = [
    collectionLedgerEntrySchema.parse({
      transactionId: `txn-${sha256Hex(`${GENESIS_COMMAND_ID}\u0000Coins`).slice(0, 32)}`,
      commandId: GENESIS_COMMAND_ID,
      pullSequence: 0,
      currency: 'Coins',
      amount: input.coins,
      reason: 'welcome-grant',
    }),
  ];
  if (input.exchange > 0) {
    ledger.push(
      collectionLedgerEntrySchema.parse({
        transactionId: `txn-${sha256Hex(`${GENESIS_COMMAND_ID}\u0000Exchange`).slice(0, 32)}`,
        commandId: GENESIS_COMMAND_ID,
        pullSequence: 0,
        currency: 'Exchange',
        amount: input.exchange,
        reason: 'welcome-grant',
      }),
    );
  }
  const chunks = pulls.length;
  const base = initializeCollectionState({
    collectionId: 'progression-calibration',
    rootSeed: input.rootSeed,
    progressionHash: input.progressionHash,
  });
  const draft: CollectionState = {
    ...base,
    revision: chunks,
    claimedWelcome: true,
    owned,
    balances: { Coins: input.coins, Exchange: input.exchange },
    nextPullSequence: chunks,
  };
  return {
    state: { ...draft, digest: collectionStateDigest(collectionStateFactsOf(draft)) },
    pulls,
    ledger,
  };
}

interface BuiltCohortTeam {
  cohortId: string;
  team: CollectionActiveTeam;
  owned: string[];
  cardIds: string[];
  meanOverall: number;
  failures: string[];
}

const STARTER_SLOT_ORDER: SlotGroup[] = ['G', 'G', 'F', 'F', 'C'];
const STARTER_SLOT_CANDIDATES = 8;

function dedupePlayers(cards: readonly CollectionCatalogCard[]): CollectionCatalogCard[] {
  const seen = new Set<string>();
  const result: CollectionCatalogCard[] = [];
  for (const card of cards) {
    if (seen.has(card.playerId)) continue;
    seen.add(card.playerId);
    result.push(card);
  }
  return result;
}

function findLegalFive(input: {
  candidates: readonly CollectionCatalogCard[];
  matchingPlayerIds: ReadonlySet<string>;
  minimumStarterCount: number;
}): { combo: string[]; matching: number; score: number } | null {
  const lists = STARTER_SLOT_ORDER.map((slot) =>
    input.candidates
      .filter((card) => canPlay(card.positions, slot))
      .slice(0, STARTER_SLOT_CANDIDATES),
  );
  let best: { combo: string[]; matching: number; score: number } | null = null;
  const used = new Set<string>();
  const chosen: CollectionCatalogCard[] = [];
  const search = (slotIndex: number, matching: number): void => {
    if (slotIndex === STARTER_SLOT_ORDER.length) {
      if (matching < input.minimumStarterCount) return;
      const score = chosen.reduce((sum, card) => sum + overallOf(card), 0);
      const combo = chosen.map((card) => card.cardId);
      const candidate = { combo, matching, score };
      const better =
        best === null ||
        candidate.score > best.score ||
        (candidate.score === best.score && candidate.matching > best.matching) ||
        (candidate.score === best.score &&
          candidate.matching === best.matching &&
          canonicalJson(candidate.combo) < canonicalJson(best.combo));
      if (better) best = candidate;
      return;
    }
    for (const card of lists[slotIndex] ?? []) {
      if (used.has(card.playerId)) continue;
      used.add(card.playerId);
      chosen.push(card);
      search(slotIndex + 1, matching + (input.matchingPlayerIds.has(card.playerId) ? 1 : 0));
      chosen.pop();
      used.delete(card.playerId);
    }
  };
  search(0, 0);
  return best;
}

function buildCohortTeam(input: {
  catalog: CollectionCatalog;
  cohort: ProgressionCohortDefinition;
  matchingCards: readonly CollectionCatalogCard[] | null;
  minimumRosterCount: number;
  minimumStarterCount: number;
}): BuiltCohortTeam {
  const { catalog, cohort } = input;
  const byId = new Map(catalog.cards.map((card) => [card.cardId, card]));
  const resolve = (cardId: string): CollectionCatalogCard | undefined => byId.get(cardId);
  const failures: string[] = [];
  const pool = catalog.cards.filter((card) => overallOf(card) <= cohort.maxOverall);
  const poolBest = bestCardPerPlayer(pool);
  const matchingInBand = bestCardPerPlayer(
    (input.matchingCards ?? []).filter((card) => overallOf(card) <= cohort.maxOverall),
  );
  const matchingAboveBand = bestCardPerPlayer(
    (input.matchingCards ?? []).filter((card) => overallOf(card) > cohort.maxOverall),
  ).sort((a, b) => overallOf(a) - overallOf(b) || (a.cardId < b.cardId ? -1 : 1));
  const matchingOrdered = [...matchingInBand, ...matchingAboveBand];
  const matchingPlayerIds = new Set(matchingOrdered.map((card) => card.playerId));
  const positionCoverage = (slot: SlotGroup, count: number): CollectionCatalogCard[] =>
    poolBest.filter((card) => canPlay(card.positions, slot)).slice(0, count);
  const candidates = dedupePlayers([
    ...matchingOrdered.slice(0, 60),
    ...poolBest.slice(0, 60),
    ...positionCoverage('C', 20),
    ...positionCoverage('F', 20),
    ...positionCoverage('G', 20),
  ]);
  const five = findLegalFive({
    candidates,
    matchingPlayerIds,
    minimumStarterCount: input.minimumStarterCount,
  });
  if (five === null) {
    failures.push(`${cohort.cohortId}: no legal five with the required matching starters`);
  }
  const starterList = five?.combo ?? [];
  const starterSet = new Set(starterList);
  const selected: CollectionCatalogCard[] =
    five === null ? [] : [...five.combo].map((cardId) => byId.get(cardId) as CollectionCatalogCard);
  const usedPlayers = new Set(selected.map((card) => card.playerId));
  let matchingSelected = selected.filter((card) => matchingPlayerIds.has(card.playerId)).length;
  for (const card of matchingOrdered) {
    if (matchingSelected >= input.minimumRosterCount) break;
    if (usedPlayers.has(card.playerId)) continue;
    selected.push(card);
    usedPlayers.add(card.playerId);
    matchingSelected += 1;
  }
  if (matchingSelected < input.minimumRosterCount) {
    failures.push(
      `${cohort.cohortId}: only ${String(matchingSelected)} of ${String(input.minimumRosterCount)} matching players`,
    );
  }
  for (const card of poolBest) {
    if (selected.length >= COHORT_ROSTER_SIZE) break;
    if (usedPlayers.has(card.playerId)) continue;
    selected.push(card);
    usedPlayers.add(card.playerId);
  }
  if (selected.length < 5) failures.push(`${cohort.cohortId}: fewer than five legal cards`);
  const bench = selected
    .filter((card) => !starterSet.has(card.cardId))
    .slice(0, COHORT_ROSTER_SIZE - starterList.length)
    .map((card) => card.cardId);
  const rosterIds = [...starterList, ...bench];
  const team: CollectionActiveTeam = {
    teamVersion: 'collection-team-v1',
    starters: starterList,
    bench,
    targetMinutes: allocateDefaultMinutes(
      rosterIds.map((cardId) => ({ cardId, starter: starterSet.has(cardId) })),
    ),
  };
  const check = validateCollectionActiveTeam(team, resolve, new Set(rosterIds));
  for (const issue of check.issues) {
    failures.push(`${cohort.cohortId}: ${issue.code} ${issue.message}`);
  }
  const meanOverall =
    rosterIds.reduce(
      (sum, cardId) => sum + overallOf(byId.get(cardId) as CollectionCatalogCard),
      0,
    ) / Math.max(1, rosterIds.length);
  return {
    cohortId: cohort.cohortId,
    team,
    owned: rosterIds,
    cardIds: rosterIds,
    meanOverall,
    failures,
  };
}

interface PackAnalytic {
  pack: CollectionPackDefinition;
  distributions: Array<Record<CollectionRarity, number>>;
  eligibleCounts: Record<CollectionRarity, number>;
  targetCountsByPlayer: Map<string, Record<CollectionRarity, number>>;
}

function buildPackAnalytics(catalog: CollectionCatalog): PackAnalytic[] {
  return catalog.packs.map((pack) => {
    const eligible = catalog.cards.filter((card) =>
      pack.eligibleScope === 'specials-only' ? card.family !== 'Base' : true,
    );
    const eligibleCounts = {} as Record<CollectionRarity, number>;
    for (const rarity of COLLECTION_RARITY_ORDER) eligibleCounts[rarity] = 0;
    const targetCountsByPlayer = new Map<string, Record<CollectionRarity, number>>();
    for (const card of eligible) {
      eligibleCounts[card.rarity] = eligibleCounts[card.rarity] + 1;
      let counts = targetCountsByPlayer.get(card.playerId);
      if (counts === undefined) {
        counts = {} as Record<CollectionRarity, number>;
        for (const rarity of COLLECTION_RARITY_ORDER) counts[rarity] = 0;
        targetCountsByPlayer.set(card.playerId, counts);
      }
      counts[card.rarity] = counts[card.rarity] + 1;
    }
    const distributions = pack.slots.map((_slot, slotIndex) =>
      slotRarityDistribution(pack, slotIndex, catalog),
    );
    return { pack, distributions, eligibleCounts, targetCountsByPlayer };
  });
}

function analyticTargetProbabilities(
  analytic: PackAnalytic,
  playerId: string,
  multiplierBp: number,
): { perSlot: number[]; atLeastOne: number; eligibleCount: number } {
  const counts = analytic.targetCountsByPlayer.get(playerId);
  const perSlot: number[] = [];
  let none = 1;
  for (const distribution of analytic.distributions) {
    let probability = 0;
    for (const rarity of COLLECTION_RARITY_ORDER) {
      const share = distribution[rarity];
      if (share <= 0) continue;
      const target = counts?.[rarity] ?? 0;
      if (target === 0) continue;
      const total = analytic.eligibleCounts[rarity];
      const weighted = target * multiplierBp;
      probability +=
        share * (weighted / (weighted + (total - target) * COLLECTION_TARGET_BASE_WEIGHT_BP));
    }
    perSlot.push(probability);
    none *= 1 - probability;
  }
  let eligibleCount = 0;
  for (const rarity of COLLECTION_RARITY_ORDER) eligibleCount += counts?.[rarity] ?? 0;
  return { perSlot, atLeastOne: 1 - none, eligibleCount };
}

function analyticPlainProbability(analytic: PackAnalytic, playerId: string): number {
  const counts = analytic.targetCountsByPlayer.get(playerId);
  if (counts === undefined) return 0;
  let none = 1;
  for (const distribution of analytic.distributions) {
    let probability = 0;
    for (const rarity of COLLECTION_RARITY_ORDER) {
      const share = distribution[rarity];
      const target = counts[rarity];
      const total = analytic.eligibleCounts[rarity];
      if (share <= 0 || target === 0 || total === 0) continue;
      probability += share * (target / total);
    }
    none *= 1 - probability;
  }
  return 1 - none;
}

function expectedFullDuplicateExchange(
  pack: CollectionPackDefinition,
  odds: ReturnType<typeof describeCollectionPackOdds>,
): number {
  let total = 0;
  for (const slot of odds.perSlot) {
    for (const rarity of COLLECTION_RARITY_ORDER) {
      total += slot.distribution[rarity] * pack.duplicateExchange[rarity];
    }
  }
  return total;
}

function maxDuplicatePayout(pack: CollectionPackDefinition, catalog: CollectionCatalog): number {
  const eligible = catalog.cards.filter((card) =>
    pack.eligibleScope === 'specials-only' ? card.family !== 'Base' : true,
  );
  const bySlot = pack.slots.map((slot) => {
    const floor = slot.kind === 'guaranteed' ? (slot.floorRarity ?? 'Ember') : 'Ember';
    const floorIndex = COLLECTION_RARITY_ORDER.indexOf(floor);
    let best = 0;
    for (const card of eligible) {
      if (COLLECTION_RARITY_ORDER.indexOf(card.rarity) < floorIndex) continue;
      best = Math.max(best, pack.duplicateExchange[card.rarity]);
    }
    return best;
  });
  return bySlot.reduce((sum, value) => sum + value, 0);
}

function eligibleTargetPlayerIds(analytic: PackAnalytic): string[] {
  const counts = [...analytic.targetCountsByPlayer.entries()].map(([playerId, byRarity]) => ({
    playerId,
    count: COLLECTION_RARITY_ORDER.reduce((sum, rarity) => sum + byRarity[rarity], 0),
  }));
  counts.sort((a, b) => a.count - b.count || (a.playerId < b.playerId ? -1 : 1));
  if (counts.length === 0) return [];
  const medianCount = medianOf(counts.map((entry) => entry.count));
  const medianEntry = [...counts].sort(
    (a, b) =>
      Math.abs(a.count - medianCount) - Math.abs(b.count - medianCount) ||
      (a.playerId < b.playerId ? -1 : 1),
  )[0];
  const picks = [counts[0], medianEntry, counts[counts.length - 1]]
    .filter((entry): entry is { playerId: string; count: number } => entry !== undefined)
    .map((entry) => entry.playerId);
  const unique: string[] = [];
  for (const playerId of picks) if (!unique.includes(playerId)) unique.push(playerId);
  for (const entry of counts) {
    if (unique.length >= 3) break;
    if (!unique.includes(entry.playerId)) unique.push(entry.playerId);
  }
  return unique;
}

interface DrawAggregate {
  slots: Map<string, { observed: number; samples: number }>;
  hits: Map<string, { pulls: number; hits: number }>;
  ordinarySlots: number;
  guaranteedSlots: number;
  pulls: number;
}

function emptyDrawAggregate(): DrawAggregate {
  return { slots: new Map(), hits: new Map(), ordinarySlots: 0, guaranteedSlots: 0, pulls: 0 };
}

function aggregateDrawResults(results: readonly ProgressionDrawResult[]): DrawAggregate {
  const aggregate = emptyDrawAggregate();
  for (const result of results) {
    aggregate.ordinarySlots += result.ordinarySlots;
    aggregate.guaranteedSlots += result.guaranteedSlots;
    aggregate.pulls += result.pullCount;
    for (let index = 0; index < result.rarityCounts.length; index += 1) {
      const slotIndex = Math.floor(index / COLLECTION_RARITY_ORDER.length);
      const rarityIndex = index % COLLECTION_RARITY_ORDER.length;
      const rarity = COLLECTION_RARITY_ORDER[rarityIndex];
      if (rarity === undefined) continue;
      const key = `${result.packId}/${String(slotIndex)}/${rarity}`;
      const entry = aggregate.slots.get(key) ?? { observed: 0, samples: 0 };
      entry.observed += result.rarityCounts[index] ?? 0;
      entry.samples += result.pullCount;
      aggregate.slots.set(key, entry);
    }
    const hitKey = `${result.packId}/${result.targetPlayerId}`;
    const hit = aggregate.hits.get(hitKey) ?? { pulls: 0, hits: 0 };
    hit.pulls += result.pullCount;
    hit.hits += result.pullsWithTarget;
    aggregate.hits.set(hitKey, hit);
  }
  return aggregate;
}

function gateDrawAggregate(input: {
  label: string;
  catalog: CollectionCatalog;
  aggregate: DrawAggregate;
  multiplierBp: number;
}): {
  gates: Record<string, boolean>;
  measured: Record<string, number>;
  failures: string[];
  details: string[];
} {
  const gates: Record<string, boolean> = {};
  const measured: Record<string, number> = {};
  const failures: string[] = [];
  const details: string[] = [];
  let slotChecks = 0;
  let slotFailures = 0;
  for (const pack of input.catalog.packs) {
    for (const slotIndex of pack.slots.keys()) {
      const distribution = slotRarityDistribution(pack, slotIndex, input.catalog);
      for (const rarity of COLLECTION_RARITY_ORDER) {
        const key = `${pack.packId}/${String(slotIndex)}/${rarity}`;
        const tally = input.aggregate.slots.get(key);
        if (tally === undefined || tally.samples === 0) continue;
        slotChecks += 1;
        const gate = frequencyGate(
          tally.observed / tally.samples,
          distribution[rarity],
          tally.samples,
        );
        if (!gate.pass) {
          slotFailures += 1;
          failures.push(
            `${input.label} ${key}: observed ${(tally.observed / tally.samples).toFixed(6)} expected ${distribution[rarity].toFixed(6)} allowed ±${gate.allowed.toFixed(6)} n=${String(tally.samples)}`,
          );
        }
      }
    }
  }
  gates[`targeting.${input.label}-slot-frequencies`] = slotFailures === 0 && slotChecks > 0;
  measured[`draws/${input.label}/slot-checks`] = slotChecks;
  measured[`draws/${input.label}/slot-failures`] = slotFailures;
  details.push(
    `${input.label} slot frequencies: ${String(slotChecks - slotFailures)}/${String(slotChecks)} pack/slot/rarity checks within ${String(PROGRESSION_FREQUENCY_SIGMA)}σ`,
  );
  let hitChecks = 0;
  let hitFailures = 0;
  let maxObservedHit = 0;
  for (const [key, tally] of input.aggregate.hits) {
    const [packId = '', playerId = ''] = key.split('/');
    if (packId === '' || playerId === '') continue;
    const pack = input.catalog.packs.find((entry) => entry.packId === packId);
    if (pack === undefined) continue;
    const odds = describeCollectionTargetOdds({
      catalog: input.catalog,
      pack,
      targetPlayerId: playerId,
      multiplierBp: input.multiplierBp,
    });
    if (odds.eligibleCardIds.length === 0) continue;
    hitChecks += 1;
    const observed = tally.hits / Math.max(1, tally.pulls);
    maxObservedHit = Math.max(maxObservedHit, observed);
    const gate = frequencyGate(observed, odds.atLeastOneTarget, tally.pulls);
    if (!gate.pass) {
      hitFailures += 1;
      failures.push(
        `${input.label} target ${packId}/${playerId}: observed ${observed.toFixed(6)} expected ${odds.atLeastOneTarget.toFixed(6)} allowed ±${gate.allowed.toFixed(6)} n=${String(tally.pulls)}`,
      );
    }
  }
  gates[`targeting.${input.label}-target-hit-rates`] = hitFailures === 0 && hitChecks > 0;
  measured[`draws/${input.label}/hit-checks`] = hitChecks;
  measured[`draws/${input.label}/hit-failures`] = hitFailures;
  measured[`draws/${input.label}/max-observed-hit-rate`] = maxObservedHit;
  details.push(
    `${input.label} target hit rates: ${String(hitChecks - hitFailures)}/${String(hitChecks)} pack/target checks within ${String(PROGRESSION_FREQUENCY_SIGMA)}σ`,
  );
  return { gates, measured, failures, details };
}

interface ChallengeAggregate {
  games: number;
  wins: number;
  losses: number;
  forfeits: number;
  objectivesEvaluated: number;
  objectivesPassed: number;
  firstClearGranted: number;
  repeatCoins: number;
  challengeComponentCoins: number;
  seconds: number;
  checkFailures: number;
  failures: number;
}

function emptyChallengeAggregate(): ChallengeAggregate {
  return {
    games: 0,
    wins: 0,
    losses: 0,
    forfeits: 0,
    objectivesEvaluated: 0,
    objectivesPassed: 0,
    firstClearGranted: 0,
    repeatCoins: 0,
    challengeComponentCoins: 0,
    seconds: 0,
    checkFailures: 0,
    failures: 0,
  };
}

function accumulateChallenge(aggregate: ChallengeAggregate, result: ProgressionGameResult): void {
  aggregate.games += 1;
  if (result.failure !== null) aggregate.failures += 1;
  aggregate.checkFailures += result.checkFailures.length;
  if (result.winner === 'home') aggregate.wins += 1;
  if (result.winner === 'away') aggregate.losses += 1;
  if (result.outcome === 'forfeit') aggregate.forfeits += 1;
  if (result.objectiveEvaluated) aggregate.objectivesEvaluated += 1;
  if (result.objectivePassed) aggregate.objectivesPassed += 1;
  if (result.challengeFirstClearGranted) aggregate.firstClearGranted += 1;
  aggregate.repeatCoins += result.repeatCoins;
  aggregate.challengeComponentCoins += result.challengeComponentCoins;
  aggregate.seconds += result.homeSeconds;
}

function accumulateInto(
  map: Map<string, ChallengeAggregate>,
  key: string,
  result: ProgressionGameResult,
): void {
  const aggregate = map.get(key) ?? emptyChallengeAggregate();
  accumulateChallenge(aggregate, result);
  map.set(key, aggregate);
}

function challengeRateOf(aggregate: ChallengeAggregate): {
  winRate: number;
  objectivePassRate: number;
  coinsPerGame: number;
  coinsPerMinute: number;
} {
  return {
    winRate: aggregate.games === 0 ? 0 : aggregate.wins / aggregate.games,
    objectivePassRate:
      aggregate.objectivesEvaluated === 0
        ? 0
        : aggregate.objectivesPassed / aggregate.objectivesEvaluated,
    coinsPerGame: aggregate.games === 0 ? 0 : aggregate.repeatCoins / aggregate.games,
    coinsPerMinute: aggregate.seconds === 0 ? 0 : aggregate.repeatCoins / (aggregate.seconds / 60),
  };
}

async function runJobs<TResult>(input: {
  manifestPath: string;
  kind: 'draws' | 'purchases' | 'games';
  jobs: readonly unknown[];
  workers: number;
}): Promise<TResult[]> {
  if (input.jobs.length === 0) return [];
  return runWorkerChunks<unknown, TResult>({
    workerUrl: new URL('../collection-progression-calibration-worker.ts', import.meta.url),
    workerData: (chunk) => ({ manifestPath: input.manifestPath, kind: input.kind, jobs: chunk }),
    items: input.jobs,
    workers: input.workers,
    payloadKey: 'results',
  });
}

function runSetReport(input: {
  catalog: CollectionCatalog;
  catalogHash: string;
  progression: CollectionProgressionRules;
  progressionHash: string;
}): {
  gates: Record<string, boolean>;
  measured: Record<string, number>;
  details: string[];
  failures: string[];
} {
  const { catalog, catalogHash, progression, progressionHash } = input;
  const gates: Record<string, boolean> = {};
  const measured: Record<string, number> = {};
  const details: string[] = [];
  const failures: string[] = [];
  const collectionId = 'progression-calibration';
  const rootSeed = progressionTuningSeed(0);
  const commandFor = (
    state: CollectionState,
    setId: string,
    commandId: string,
  ): CollectionCommand =>
    collectionCommandSchema.parse({
      schemaVersion: 2,
      commandVersion: 'collection-command-v2',
      commandId,
      collectionId,
      expectedRevision: state.revision,
      expectedDigest: state.digest,
      command: 'claim-set-reward',
      setId,
      claimedAtIso: AT_ISO,
    });
  let incompleteRejected = 0;
  let completeGranted = 0;
  let alreadyClaimedRejected = 0;
  let concurrentExactlyOnce = 0;
  let noCardConsumption = 0;
  let exactBalanceFold = 0;
  let auditFailures = 0;
  let totalClaimExchange = 0;
  let claimCount = 0;
  for (const reward of progression.setRewards) {
    const catalogSet = catalog.sets.find((entry) => entry.setId === reward.setId);
    if (catalogSet === undefined) {
      failures.push(`set ${reward.setId}: missing from the pinned catalog`);
      continue;
    }
    const members = [...catalogSet.memberCardIds].sort();
    const progress = collectionSetProgress({
      setId: catalogSet.setId,
      title: catalogSet.title,
      memberCardIds: members,
      ownedCardIds: new Set(members),
    });
    if (progress.requiredCount !== members.length) {
      failures.push(`set ${reward.setId}: progress does not cover every member`);
    }
    const incompleteGenesis = genesisRecords({
      catalog,
      catalogHash,
      rootSeed,
      ownedCardIds: members.slice(0, Math.max(0, members.length - 1)),
      progressionHash,
      coins: 0,
      exchange: 0,
    });
    const incompleteState = incompleteGenesis.state;
    const incomplete = applyCollectionCommand(
      incompleteState,
      commandFor(incompleteState, reward.setId, `progression-set-${reward.setId}-incomplete`),
      catalog,
      incompleteGenesis.pulls,
      incompleteGenesis.ledger,
      [],
      catalogHash,
      progression,
      progressionHash,
    );
    if (
      incomplete.status === 'rejected' &&
      incomplete.rejection.code === 'set-incomplete' &&
      Array.isArray(incomplete.rejection.missingCardIds) &&
      incomplete.rejection.missingCardIds.length === 1
    ) {
      incompleteRejected += 1;
    } else {
      failures.push(`set ${reward.setId}: incomplete claim was not rejected precisely`);
    }
    const completeGenesis = genesisRecords({
      catalog,
      catalogHash,
      rootSeed,
      ownedCardIds: members,
      progressionHash,
      coins: 0,
      exchange: 0,
    });
    const completeState = completeGenesis.state;
    const claimCommand = commandFor(
      completeState,
      reward.setId,
      `progression-set-${reward.setId}-claim`,
    );
    const claimed = applyCollectionCommand(
      completeState,
      claimCommand,
      catalog,
      completeGenesis.pulls,
      completeGenesis.ledger,
      [],
      catalogHash,
      progression,
      progressionHash,
    );
    if (claimed.status !== 'accepted' || claimed.setReceipt === undefined) {
      failures.push(`set ${reward.setId}: complete claim was not accepted`);
      continue;
    }
    claimCount += 1;
    totalClaimExchange += claimed.setReceipt.amount;
    if (claimed.setReceipt.amount === reward.amount) completeGranted += 1;
    else failures.push(`set ${reward.setId}: claim amount does not match the reward`);
    const claimedState = claimed.state;
    if (!claimedState.claimedSetIds.includes(reward.setId)) {
      failures.push(`set ${reward.setId}: claimed set id missing from state`);
    }
    const ownedAfter = new Set(claimedState.owned.map((entry) => entry.cardId));
    if (members.every((cardId) => ownedAfter.has(cardId))) noCardConsumption += 1;
    else failures.push(`set ${reward.setId}: claim consumed member cards`);
    const ledger = [...completeGenesis.ledger, ...claimed.ledgerEntries];
    const commands = [claimCommand];
    const claimAudit = auditCollectionState(
      claimedState,
      completeGenesis.pulls,
      ledger,
      [],
      commands,
    );
    auditFailures += claimAudit.length;
    if (claimAudit.length > 0) {
      failures.push(
        `set ${reward.setId}: ${claimAudit[0]?.code ?? 'audit'} ${claimAudit[0]?.message ?? ''}`,
      );
    }
    if (
      claimedState.balances.Exchange === reward.amount &&
      claimed.ledgerEntries.length === 1 &&
      claimed.ledgerEntries[0]?.currency === 'Exchange' &&
      claimed.ledgerEntries[0].reason === 'set-completion-reward' &&
      claimed.ledgerEntries[0].pullSequence === null
    ) {
      exactBalanceFold += 1;
    } else {
      failures.push(`set ${reward.setId}: Exchange balance/ledger fold is not exact`);
    }
    const repeat = applyCollectionCommand(
      claimedState,
      commandFor(claimedState, reward.setId, `progression-set-${reward.setId}-again`),
      catalog,
      completeGenesis.pulls,
      ledger,
      commands,
      catalogHash,
      progression,
      progressionHash,
    );
    if (repeat.status === 'rejected' && repeat.rejection.code === 'set-already-claimed') {
      alreadyClaimedRejected += 1;
    } else {
      failures.push(`set ${reward.setId}: repeat claim was not rejected`);
    }
    const concurrentCommandA = commandFor(
      completeState,
      reward.setId,
      `progression-set-${reward.setId}-concurrent-a`,
    );
    const concurrentCommandB = commandFor(
      completeState,
      reward.setId,
      `progression-set-${reward.setId}-concurrent-b`,
    );
    const firstConcurrent = applyCollectionCommand(
      completeState,
      concurrentCommandA,
      catalog,
      completeGenesis.pulls,
      completeGenesis.ledger,
      [],
      catalogHash,
      progression,
      progressionHash,
    );
    const concurrentLedger =
      firstConcurrent.status === 'accepted'
        ? [...completeGenesis.ledger, ...firstConcurrent.ledgerEntries]
        : completeGenesis.ledger;
    const concurrentState =
      firstConcurrent.status === 'accepted' ? firstConcurrent.state : completeState;
    const secondConcurrent = applyCollectionCommand(
      concurrentState,
      concurrentCommandB,
      catalog,
      completeGenesis.pulls,
      concurrentLedger,
      firstConcurrent.status === 'accepted' ? [concurrentCommandA] : [],
      catalogHash,
      progression,
      progressionHash,
    );
    if (
      firstConcurrent.status === 'accepted' &&
      secondConcurrent.status === 'rejected' &&
      secondConcurrent.rejection.code === 'stale-state' &&
      firstConcurrent.ledgerEntries.length === 1
    ) {
      concurrentExactlyOnce += 1;
    } else {
      failures.push(`set ${reward.setId}: concurrent claims were not exactly-once`);
    }
    details.push(
      `set ${reward.setId}: incomplete rejected · complete +${String(reward.amount)} Exchange · repeat rejected · concurrent exactly-once`,
    );
  }
  const allThreeGenesis = genesisRecords({
    catalog,
    catalogHash,
    rootSeed,
    ownedCardIds: progression.setRewards.flatMap((reward) => {
      const set = catalog.sets.find((entry) => entry.setId === reward.setId);
      return set === undefined ? [] : [...set.memberCardIds];
    }),
    progressionHash,
    coins: 0,
    exchange: 0,
  });
  let maxState = allThreeGenesis.state;
  const maxLedger: CollectionLedgerEntry[] = [...allThreeGenesis.ledger];
  const maxCommands: CollectionCommand[] = [];
  for (const [index, reward] of progression.setRewards.entries()) {
    const command = commandFor(maxState, reward.setId, `progression-set-max-${String(index)}`);
    const outcome = applyCollectionCommand(
      maxState,
      command,
      catalog,
      allThreeGenesis.pulls,
      maxLedger,
      maxCommands,
      catalogHash,
      progression,
      progressionHash,
    );
    if (outcome.status !== 'accepted') {
      failures.push(`sets max: claim ${reward.setId} rejected with ${outcome.rejection.code}`);
      break;
    }
    maxState = outcome.state;
    maxLedger.push(...outcome.ledgerEntries);
    maxCommands.push(command);
  }
  const maxExchange = maxState.balances.Exchange;
  const maxLedgerEntries = maxLedger.filter(
    (entry) => entry.reason === 'set-completion-reward',
  ).length;
  const maxAudit = auditCollectionState(
    maxState,
    allThreeGenesis.pulls,
    maxLedger,
    [],
    maxCommands,
  );
  if (maxAudit.length > 0) {
    failures.push(`sets max: audit reported ${String(maxAudit.length)} failures`);
  }
  const expectedMax = progression.setRewards.reduce((sum, reward) => sum + reward.amount, 0);
  gates['sets.incomplete-rejected'] = incompleteRejected === progression.setRewards.length;
  gates['sets.complete-granted'] = completeGranted === progression.setRewards.length;
  gates['sets.already-claimed-rejected'] = alreadyClaimedRejected === progression.setRewards.length;
  gates['sets.concurrent-exactly-once'] = concurrentExactlyOnce === progression.setRewards.length;
  gates['sets.no-card-consumption'] = noCardConsumption === progression.setRewards.length;
  gates['sets.exact-balance-fold'] = exactBalanceFold === progression.setRewards.length;
  gates['sets.audit-no-divergence'] = auditFailures === 0 && maxAudit.length === 0;
  gates['sets.max-finite-6000'] =
    expectedMax === 6000 &&
    maxExchange === 6000 &&
    maxLedgerEntries === 3 &&
    progression.setRewards.length === 3;
  const spotlight = catalog.packs.find((entry) => entry.packId === 'spotlight');
  let spotlightMaxPayout = 0;
  let spotlightExpected = 0;
  if (spotlight !== undefined) {
    spotlightMaxPayout = maxDuplicatePayout(spotlight, catalog);
    spotlightExpected = expectedFullDuplicateExchange(
      spotlight,
      describeCollectionPackOdds(catalog, spotlight),
    );
  }
  gates['sets.spotlight-duplicate-below-price'] =
    spotlight !== undefined && spotlightMaxPayout < spotlight.priceAmount;
  measured['sets/claim-amount-total'] = totalClaimExchange;
  measured['sets/claims-verified'] = claimCount;
  measured['sets/max-finite-exchange'] = maxExchange;
  measured['sets/max-finite-ledger-entries'] = maxLedgerEntries;
  measured['sets/spotlight-max-duplicate-payout'] = spotlightMaxPayout;
  measured['sets/spotlight-expected-duplicate-exchange'] = spotlightExpected;
  details.push(
    `sets: ${String(claimCount)} claims · ${String(totalClaimExchange)} Exchange claimed · max finite ${String(maxExchange)} Exchange · spotlight duplicate payout ${String(spotlightMaxPayout)} < ${String(spotlight?.priceAmount ?? 0)}`,
  );
  return { gates, measured, details, failures };
}

function validateProgressionTargets(input: { path: string; manifestPath: string }): CliReport {
  const failures: string[] = [];
  let catalogHash: string | null = null;
  let rulesHash: string | null = null;
  let progressionHash: string | null = null;
  try {
    catalogHash = loadCollectionCatalog(input.manifestPath).catalogHash;
  } catch (error) {
    failures.push((error as Error).message);
  }
  try {
    rulesHash = loadCollectionGameRules(input.manifestPath).rulesHash;
  } catch (error) {
    failures.push((error as Error).message);
  }
  try {
    progressionHash = loadCollectionProgressionRules(input.manifestPath).progressionHash;
  } catch (error) {
    failures.push((error as Error).message);
  }
  const manifest = (() => {
    try {
      return readJsonFile(input.manifestPath) as {
        collection?: { progressionTargets?: { url?: string; contentHash?: string } };
      };
    } catch (error) {
      failures.push((error as Error).message);
      return {};
    }
  })();
  const pinned = manifest.collection?.progressionTargets;
  if (pinned?.contentHash === undefined) {
    failures.push('manifest has no collection.progressionTargets pin for the packaged targets');
  } else {
    try {
      const actual = sha256Hex(readFileSync(resolve(input.path)));
      if (actual !== pinned.contentHash) {
        failures.push(
          `collection progression targets content hash mismatch: expected ${pinned.contentHash}, got ${actual}`,
        );
      }
    } catch {
      failures.push(`collection progression targets asset is missing (${input.path})`);
    }
  }
  return validateTargetsArtifact({
    outPath: input.path,
    schema: collectionProgressionTargetsSchema,
    command: CALIBRATION_COMMAND,
    extraChecks: (parsed) => {
      const details: string[] = [];
      const checkFailures: string[] = [...failures];
      if (parsed.catalogHash !== catalogHash) {
        checkFailures.push('targets catalogHash does not match the packaged catalog');
      }
      if (parsed.rulesHash !== rulesHash) {
        checkFailures.push('targets rulesHash does not match the packaged game rules');
      }
      if (parsed.progressionRulesHash !== progressionHash) {
        checkFailures.push(
          'targets progressionRulesHash does not match the packaged progression rules',
        );
      }
      if (parsed.engineVersion !== ENGINE_VERSION) {
        checkFailures.push(`targets engineVersion ${parsed.engineVersion} != ${ENGINE_VERSION}`);
      }
      if (parsed.cohorts.ordinarySlotDraws < 1_000_000) {
        checkFailures.push(
          `targets recorded only ${String(parsed.cohorts.ordinarySlotDraws)} ordinary targeted slot draws`,
        );
      }
      if (parsed.fixtures.length < 4) {
        checkFailures.push('targets must cover at least four cohort fixtures');
      }
      const gateFailure = collectionProgressionTargetsGateFailure(parsed);
      if (gateFailure !== null) checkFailures.push(gateFailure);
      details.push(
        `${parsed.targetsVersion} · ${String(parsed.cohorts.calibrationSeeds)} calibration / ${String(parsed.cohorts.validationSeeds)} held-out seeds · ${String(parsed.cohorts.ordinarySlotDraws)} ordinary targeted slot draws · ${String(parsed.fixtures.length)} fixtures · ${String(Object.keys(parsed.gates).length)} gates`,
      );
      return { details, failures: checkFailures };
    },
  });
}

function writeProgressionTargetsArtifact(input: {
  outPath: string;
  manifestPath: string;
  content: CollectionProgressionTargets;
}): { written: boolean; path: string; error: string | null; pinned: boolean } {
  try {
    const target = resolve(input.outPath);
    mkdirSync(dirname(target), { recursive: true });
    const serialized = `${JSON.stringify(input.content)}\n`;
    const tmp = `${target}.tmp-${String(Date.now())}-${String(Math.random()).slice(2)}`;
    writeFileSync(tmp, serialized);
    renameSync(tmp, target);
    let pinned = false;
    if (target === resolve(DEFAULT_COLLECTION_PROGRESSION_TARGETS)) {
      const manifestPath = resolve(input.manifestPath);
      const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as {
        collection?: Record<string, unknown>;
      };
      manifest.collection = {
        ...manifest.collection,
        progressionTargets: {
          url: TARGET_ARTIFACT_URL,
          contentHash: sha256Hex(readFileSync(target)),
        },
      };
      const manifestTmp = `${manifestPath}.tmp-${String(Date.now())}-${String(Math.random()).slice(2)}`;
      writeFileSync(manifestTmp, `${JSON.stringify(manifest, null, 2)}\n`);
      renameSync(manifestTmp, manifestPath);
      pinned = true;
    }
    return { written: true, path: target, error: null, pinned };
  } catch (error) {
    return {
      written: false,
      path: resolve(input.outPath),
      error: (error as Error).message,
      pinned: false,
    };
  }
}

export function collectionProgressionCalibrate(args: {
  workers?: string;
  calibrationSeeds?: string;
  validationSeeds?: string;
  out?: string;
  manifest?: string;
  validate?: string | null;
}): Promise<CliReport> | CliReport {
  const manifestPath = args.manifest ?? DEFAULT_MANIFEST;
  if (typeof args.validate === 'string') {
    return validateProgressionTargets({ path: args.validate, manifestPath });
  }
  return generateProgressionTargets({
    manifestPath,
    workers: args.workers,
    calibrationSeeds: args.calibrationSeeds,
    validationSeeds: args.validationSeeds,
    out: args.out,
  });
}

interface GenerateInput {
  manifestPath: string;
  workers?: string;
  calibrationSeeds?: string;
  validationSeeds?: string;
  out?: string;
}

async function generateProgressionTargets(input: GenerateInput): Promise<CliReport> {
  const startedAt = Date.now();
  const failures: string[] = [];
  const details: string[] = [];
  const workers = Math.max(1, Number.parseInt(input.workers ?? '8', 10) || 8);
  const calibrationSeeds = Math.max(1, Number.parseInt(input.calibrationSeeds ?? '6', 10) || 6);
  const validationSeeds = Math.max(1, Number.parseInt(input.validationSeeds ?? '4', 10) || 4);
  let catalog: CollectionCatalog;
  let catalogHash: string;
  let progression: CollectionProgressionRules;
  let progressionHash: string;
  let rules: CollectionGameRules;
  let rulesHash: string;
  try {
    ({ catalog, catalogHash } = loadCollectionCatalog(input.manifestPath));
    ({ progression, progressionHash } = loadCollectionProgressionRules(input.manifestPath));
    ({ rules, rulesHash } = loadCollectionGameRules(input.manifestPath));
  } catch (error) {
    return makeReport(
      CALIBRATION_COMMAND,
      { manifest: input.manifestPath },
      { failures: [(error as Error).message], exitCode: 2 },
    );
  }
  try {
    validateCollectionProgressionRules({
      progression,
      progressionHash,
      catalog,
      verifyFeasibility: true,
    });
  } catch (error) {
    failures.push((error as Error).message);
  }
  const multiplierBp = progression.targetMultiplierBp;
  const gates: Record<string, boolean> = {};
  const measured: Record<string, number> = {};
  measured['targetMultiplierBp'] = multiplierBp;
  measured['cohorts/calibration-seeds'] = calibrationSeeds;
  measured['cohorts/validation-seeds'] = validationSeeds;
  measured['seeds/tuning-offset'] = PROGRESSION_CALIBRATION_TUNING_SEED_OFFSET;
  measured['seeds/held-out-offset'] = PROGRESSION_CALIBRATION_HELD_OUT_SEED_OFFSET;
  measured['draws/pulls-per-pack'] = PROGRESSION_TARGETING_PULLS_PER_PACK;
  for (const challenge of progression.challenges) {
    measured[`tuning/challenge/${challenge.challengeId}/first-clear-coins`] =
      challenge.firstClearCoins;
    measured[`tuning/challenge/${challenge.challengeId}/repeat-win-coins`] =
      challenge.repeatWinCoins;
  }
  for (const reward of progression.setRewards) {
    measured[`tuning/set/${reward.setId}/amount`] = reward.amount;
  }

  // Targeting report — analytic sweep over every catalog player × pack.
  const analytics = buildPackAnalytics(catalog);
  const playerIds = [...new Set(catalog.cards.map((card) => card.playerId))].sort();
  let eligiblePairs = 0;
  let ineligiblePairs = 0;
  let strictFailures = 0;
  let guaranteedTargets = 0;
  let aboveCapTargets = 0;
  let maxAtLeastOne = 0;
  let maxEligibleVersions = 0;
  for (const analytic of analytics) {
    for (const playerId of playerIds) {
      const targeted = analyticTargetProbabilities(analytic, playerId, multiplierBp);
      if (targeted.eligibleCount === 0) {
        ineligiblePairs += 1;
        if (targeted.atLeastOne !== 0) {
          strictFailures += 1;
          failures.push(`target ${playerId}/${analytic.pack.packId}: ineligible target shows odds`);
        }
        continue;
      }
      eligiblePairs += 1;
      const plain = analyticPlainProbability(analytic, playerId);
      if (!(targeted.atLeastOne > plain)) strictFailures += 1;
      if (targeted.atLeastOne >= 1) guaranteedTargets += 1;
      if (targeted.atLeastOne > MAX_LAUNCH_TARGET_PROBABILITY) aboveCapTargets += 1;
      maxAtLeastOne = Math.max(maxAtLeastOne, targeted.atLeastOne);
      maxEligibleVersions = Math.max(maxEligibleVersions, targeted.eligibleCount);
    }
  }
  gates['targeting.every-eligible-target-higher'] = strictFailures === 0 && eligiblePairs > 0;
  gates['targeting.no-target-guaranteed'] = guaranteedTargets === 0;
  gates['targeting.no-launch-combo-above-60pct'] = aboveCapTargets === 0;
  measured['targeting/players'] = playerIds.length;
  measured['targeting/pairs'] = playerIds.length * analytics.length;
  measured['targeting/eligible-pairs'] = eligiblePairs;
  measured['targeting/ineligible-pairs'] = ineligiblePairs;
  measured['targeting/strict-failures'] = strictFailures;
  measured['targeting/max-at-least-one'] = maxAtLeastOne;
  measured['targeting/max-eligible-versions'] = maxEligibleVersions;
  details.push(
    `targeting sweep: ${String(playerIds.length)} canonical players (${String(catalog.cards.length)} cards) × ${String(analytics.length)} packs · ${String(eligiblePairs)} eligible and ${String(ineligiblePairs)} ineligible pairs · max P(at least one) ${maxAtLeastOne.toFixed(4)} · max eligible versions ${String(maxEligibleVersions)}`,
  );

  let sweepMismatches = 0;
  const sweepSample: string[] = [];
  for (let index = 0; index < 40; index += 1) {
    const playerId = playerIds[Math.floor((index * playerIds.length) / 40)];
    if (playerId !== undefined) sweepSample.push(playerId);
  }
  for (const analytic of analytics) {
    for (const playerId of sweepSample) {
      const odds = describeCollectionTargetOdds({
        catalog,
        pack: analytic.pack,
        targetPlayerId: playerId,
        multiplierBp,
      });
      const fast = analyticTargetProbabilities(analytic, playerId, multiplierBp);
      if (fast.atLeastOne !== odds.atLeastOneTarget) sweepMismatches += 1;
      for (const [slotIndex, probability] of fast.perSlot.entries()) {
        if (probability !== (odds.perSlot[slotIndex]?.targetProbability ?? -1))
          sweepMismatches += 1;
      }
    }
  }
  gates['targeting.sweep-matches-engine'] = sweepMismatches === 0;
  measured['targeting/sweep-mismatches'] = sweepMismatches;
  measured['targeting/sweep-samples'] = sweepSample.length * analytics.length;

  // Rarity draws must be bit-identical with and without an active target.
  let rarityPairs = 0;
  let rarityMismatches = 0;
  let targetedReplayFailures = 0;
  for (const analytic of analytics) {
    const targetPlayerId = eligibleTargetPlayerIds(analytic)[0];
    if (targetPlayerId === undefined) continue;
    for (let index = 0; index < 32; index += 1) {
      const seed = progressionCalibrationSeed(800_000 + index);
      const plain = drawCollectionPackSlots(catalog, analytic.pack, seed, 0);
      const snapshot = compileTargetSnapshot({
        catalog,
        pack: analytic.pack,
        targetPlayerId,
        multiplierBp,
        pullSequence: 0,
      });
      const targeted = drawCollectionPackSlotsTargeted({
        catalog,
        pack: analytic.pack,
        rootSeed: seed,
        pullSequence: 0,
        target: snapshot,
      });
      rarityPairs += 1;
      if (plain.draws.length !== targeted.length) {
        rarityMismatches += 1;
        continue;
      }
      for (const [slotIndex, draw] of plain.draws.entries()) {
        if (targeted[slotIndex]?.rarity !== draw.rarity) rarityMismatches += 1;
      }
      const pull = collectionPullRecordSchema.parse({
        pullSequence: 0,
        kind: 'pack',
        packId: analytic.pack.packId,
        packRulesVersion: analytic.pack.packRulesVersion,
        economyVersion: COLLECTION_ECONOMY_VERSION,
        catalogVersion: COLLECTION_CATALOG_VERSION,
        catalogHash,
        commandId: `progression-targeted-replay-${analytic.pack.packId}`,
        seedPath: [
          'collection',
          'pulls',
          analytic.pack.packId,
          analytic.pack.packRulesVersion,
          '0',
        ],
        slots: targeted.map((draw) => ({
          slotIndex: draw.slotIndex,
          cardId: draw.cardId,
          rarity: draw.rarity,
          kept: true,
          conversionAmount: 0,
        })),
        replayVersion: 'collection-replay-v2',
        targeting: snapshot,
      });
      if (!reproduceCollectionPull(catalog, pull, seed).ok) targetedReplayFailures += 1;
    }
  }
  gates['targeting.rarity-draws-unchanged'] = rarityMismatches === 0 && rarityPairs > 0;
  gates['targeting.targeted-replay'] = targetedReplayFailures === 0;
  measured['targeting/rarity-pairs'] = rarityPairs;
  measured['targeting/rarity-mismatches'] = rarityMismatches;
  measured['targeting/targeted-replay-failures'] = targetedReplayFailures;
  details.push(
    `targeting rarity draws: ${String(rarityPairs)} paired pack draws · ${String(rarityMismatches)} rarity mismatches · ${String(targetedReplayFailures)} targeted replay failures`,
  );

  // No-target draws must remain byte-identical to the M4.1 path.
  let noTargetSamples = 0;
  let noTargetFailures = 0;
  for (const pack of catalog.packs) {
    for (let index = 0; index < 16; index += 1) {
      const seed = progressionCalibrationSeed(900_000 + index);
      const first = drawCollectionPackSlots(catalog, pack, seed, 0);
      const second = drawCollectionPackSlots(catalog, pack, seed, 0);
      noTargetSamples += 1;
      if (canonicalJson(first.draws) !== canonicalJson(second.draws)) noTargetFailures += 1;
      const pull = collectionPullRecordSchema.parse({
        pullSequence: 0,
        kind: 'pack',
        packId: pack.packId,
        packRulesVersion: pack.packRulesVersion,
        economyVersion: COLLECTION_ECONOMY_VERSION,
        catalogVersion: COLLECTION_CATALOG_VERSION,
        catalogHash,
        commandId: `progression-no-target-${pack.packId}`,
        seedPath: ['collection', 'pulls', pack.packId, pack.packRulesVersion, '0'],
        slots: first.draws.map((draw) => ({
          slotIndex: draw.slotIndex,
          cardId: draw.cardId,
          rarity: draw.rarity,
          kept: true,
          conversionAmount: 0,
        })),
        replayVersion: 'collection-replay-v2',
        targeting: null,
      });
      if (!reproduceCollectionPull(catalog, pull, seed).ok) noTargetFailures += 1;
    }
  }
  gates['targeting.no-target-byte-identical'] = noTargetFailures === 0 && noTargetSamples > 0;
  measured['targeting/no-target-samples'] = noTargetSamples;
  measured['targeting/no-target-failures'] = noTargetFailures;

  // Full-ownership duplicate Exchange must equal the frozen M4.1 expectation.
  let exchangeMismatches = 0;
  let exchangeComparisons = 0;
  const packTargetsPath = resolve(dirname(input.manifestPath), 'collection/pack-targets.json');
  let packTargetsArtifact: { measured?: Record<string, number> } | null = null;
  try {
    packTargetsArtifact = readJsonFile(packTargetsPath) as { measured?: Record<string, number> };
  } catch {
    packTargetsArtifact = null;
  }
  for (const pack of catalog.packs) {
    const expected = expectedFullDuplicateExchange(pack, describeCollectionPackOdds(catalog, pack));
    measured[`targeting/exchange/${pack.packId}`] = expected;
    const recorded =
      packTargetsArtifact?.measured?.[`${pack.packId}/expected-exchange-full-duplicate`];
    if (recorded !== undefined) {
      exchangeComparisons += 1;
      if (recorded !== expected) {
        exchangeMismatches += 1;
        failures.push(
          `full-ownership Exchange for ${pack.packId}: computed ${String(expected)} != M4.1 ${String(recorded)}`,
        );
      }
    }
  }
  gates['targeting.full-ownership-exchange-m41'] = exchangeMismatches === 0;
  measured['targeting/exchange-comparisons'] = exchangeComparisons;
  measured['targeting/exchange-mismatches'] = exchangeMismatches;
  details.push(
    `full-ownership Exchange: ${String(exchangeComparisons)} pack expectations matched the M4.1 artifact`,
  );

  // Simulated targeted slot draws across tuning and disjoint held-out seeds.
  // Jobs are ordered pull-block first so contiguous worker chunks mix every pack
  // and stay balanced regardless of worker count.
  const tuningDrawSeeds = Array.from({ length: calibrationSeeds }, (_value, index) =>
    progressionTuningSeed(index),
  );
  const heldOutDrawSeeds = Array.from({ length: validationSeeds }, (_value, index) =>
    progressionHeldOutSeed(index),
  );
  const drawJobsFor = (seeds: readonly string[]): ProgressionDrawJob[] => {
    const jobs: ProgressionDrawJob[] = [];
    for (
      let pullStart = 0;
      pullStart < PROGRESSION_TARGETING_PULLS_PER_PACK;
      pullStart += PROGRESSION_TARGETING_PULLS_PER_JOB
    ) {
      for (const [seedIndex, rootSeed] of seeds.entries()) {
        for (const analytic of analytics) {
          const targets = eligibleTargetPlayerIds(analytic);
          const targetPlayerId = targets[seedIndex % Math.max(1, targets.length)];
          if (targetPlayerId === undefined) continue;
          jobs.push({
            packId: analytic.pack.packId,
            rootSeed,
            targetPlayerId,
            multiplierBp,
            pullStart,
            pullCount: Math.min(
              PROGRESSION_TARGETING_PULLS_PER_JOB,
              PROGRESSION_TARGETING_PULLS_PER_PACK - pullStart,
            ),
          });
        }
      }
    }
    return jobs;
  };
  const tuningDrawJobs = drawJobsFor(tuningDrawSeeds);
  const heldOutDrawJobs = drawJobsFor(heldOutDrawSeeds);
  let tuningDraws: ProgressionDrawResult[];
  let heldOutDraws: ProgressionDrawResult[];
  try {
    tuningDraws = await runJobs<ProgressionDrawResult>({
      manifestPath: input.manifestPath,
      kind: 'draws',
      jobs: tuningDrawJobs,
      workers,
    });
    heldOutDraws = await runJobs<ProgressionDrawResult>({
      manifestPath: input.manifestPath,
      kind: 'draws',
      jobs: heldOutDrawJobs,
      workers,
    });
  } catch (error) {
    return makeReport(
      CALIBRATION_COMMAND,
      { manifest: input.manifestPath },
      { failures: [`targeted draw cohort failed: ${(error as Error).message}`], exitCode: 2 },
    );
  }
  const tuningAggregate = aggregateDrawResults(tuningDraws);
  const heldOutAggregate = aggregateDrawResults(heldOutDraws);
  const tuningDrawGates = gateDrawAggregate({
    label: 'tuning',
    catalog,
    aggregate: tuningAggregate,
    multiplierBp,
  });
  const heldOutDrawGates = gateDrawAggregate({
    label: 'held-out',
    catalog,
    aggregate: heldOutAggregate,
    multiplierBp,
  });
  Object.assign(gates, tuningDrawGates.gates, heldOutDrawGates.gates);
  Object.assign(measured, tuningDrawGates.measured, heldOutDrawGates.measured);
  failures.push(...tuningDrawGates.failures, ...heldOutDrawGates.failures);
  details.push(...tuningDrawGates.details, ...heldOutDrawGates.details);
  const ordinarySlotDraws = tuningAggregate.ordinarySlots + heldOutAggregate.ordinarySlots;
  measured['draws/tuning-ordinary-slots'] = tuningAggregate.ordinarySlots;
  measured['draws/held-out-ordinary-slots'] = heldOutAggregate.ordinarySlots;
  measured['draws/tuning-guaranteed-slots'] = tuningAggregate.guaranteedSlots;
  measured['draws/held-out-guaranteed-slots'] = heldOutAggregate.guaranteedSlots;
  measured['draws/tuning-pulls'] = tuningAggregate.pulls;
  measured['draws/held-out-pulls'] = heldOutAggregate.pulls;
  details.push(
    `targeted draws: ${String(tuningAggregate.ordinarySlots)} tuning + ${String(heldOutAggregate.ordinarySlots)} held-out ordinary targeted slot draws (${String(ordinarySlotDraws)} total) across ${String(tuningAggregate.pulls + heldOutAggregate.pulls)} pulls`,
  );

  // Acquisition quantiles and ownership independence through the production purchase path.
  const acquisitionPacks = catalog.packs
    .filter((pack) => pack.priceCurrency === 'Coins')
    .slice(0, 2);
  const acquisitionSeeds = Array.from({ length: PROGRESSION_ACQUISITION_SEEDS }, (_value, index) =>
    progressionCalibrationSeed(1_000_000 + index),
  );
  const purchaseKey = (packId: string, playerId: string, owned: boolean): string =>
    `${packId}/${playerId}/${owned ? 'owned' : 'unowned'}`;
  const acquisitionTargets = new Map<string, string[]>();
  const acquisitionJobs: ProgressionPurchaseJob[] = [];
  for (const analytic of analytics) {
    if (!acquisitionPacks.some((pack) => pack.packId === analytic.pack.packId)) continue;
    const targets = eligibleTargetPlayerIds(analytic);
    acquisitionTargets.set(analytic.pack.packId, targets);
    for (const targetPlayerId of targets) {
      for (const ownedTarget of [false, true]) {
        for (const rootSeed of acquisitionSeeds) {
          acquisitionJobs.push({
            packId: analytic.pack.packId,
            rootSeed,
            targetPlayerId,
            multiplierBp,
            ownedTarget,
            pullCap: PROGRESSION_ACQUISITION_PULL_CAP,
          });
        }
      }
    }
  }
  const divergenceJobs: ProgressionPurchaseJob[] = [];
  for (const analytic of analytics) {
    const targetPlayerId = eligibleTargetPlayerIds(analytic)[0];
    if (targetPlayerId === undefined) continue;
    for (let index = 0; index < PROGRESSION_PURCHASE_SEEDS; index += 1) {
      for (const ownedTarget of [false, true]) {
        divergenceJobs.push({
          packId: analytic.pack.packId,
          rootSeed: progressionCalibrationSeed(2_000_000 + index),
          targetPlayerId,
          multiplierBp,
          ownedTarget,
          pullCap: PROGRESSION_PURCHASE_PULLS,
        });
      }
    }
  }
  let acquisitionResults: ProgressionPurchaseResult[];
  let divergenceResults: ProgressionPurchaseResult[];
  try {
    acquisitionResults = await runJobs<ProgressionPurchaseResult>({
      manifestPath: input.manifestPath,
      kind: 'purchases',
      jobs: acquisitionJobs,
      workers,
    });
    divergenceResults = await runJobs<ProgressionPurchaseResult>({
      manifestPath: input.manifestPath,
      kind: 'purchases',
      jobs: divergenceJobs,
      workers,
    });
  } catch (error) {
    return makeReport(
      CALIBRATION_COMMAND,
      { manifest: input.manifestPath },
      { failures: [`targeted purchase cohort failed: ${(error as Error).message}`], exitCode: 2 },
    );
  }
  const purchaseResults = [...acquisitionResults, ...divergenceResults];
  let purchaseAuditFailures = 0;
  let purchaseReproductionFailures = 0;
  let purchaseConversionMismatches = 0;
  let purchaseRejections = 0;
  for (const result of purchaseResults) {
    purchaseAuditFailures += result.auditFailures;
    purchaseReproductionFailures += result.reproductionFailures;
    purchaseConversionMismatches += result.conversionMismatches;
    purchaseRejections += result.rejected.length;
  }
  gates['targeting.purchase-no-divergence'] =
    purchaseAuditFailures === 0 &&
    purchaseReproductionFailures === 0 &&
    purchaseConversionMismatches === 0 &&
    purchaseRejections === 0;
  measured['targeting/purchase-jobs'] = purchaseResults.length;
  measured['targeting/purchase-audit-failures'] = purchaseAuditFailures;
  measured['targeting/purchase-reproduction-failures'] = purchaseReproductionFailures;
  measured['targeting/purchase-conversion-mismatches'] = purchaseConversionMismatches;
  measured['targeting/purchase-rejections'] = purchaseRejections;
  const acquisitionByKey = new Map<string, ProgressionPurchaseResult>();
  for (const result of acquisitionResults) {
    acquisitionByKey.set(
      purchaseKey(result.packId, result.targetPlayerId, result.ownedTarget),
      result,
    );
  }
  let acquisitionPairs = 0;
  let acquisitionMismatches = 0;
  let acquisitionHits = 0;
  let acquisitionCensored = 0;
  for (const [packId, targets] of acquisitionTargets) {
    for (const [targetIndex, targetPlayerId] of targets.entries()) {
      const owned = acquisitionByKey.get(purchaseKey(packId, targetPlayerId, true));
      const unowned = acquisitionByKey.get(purchaseKey(packId, targetPlayerId, false));
      if (owned === undefined || unowned === undefined) continue;
      acquisitionPairs += 1;
      if (owned.hitPull !== unowned.hitPull || owned.pulls !== unowned.pulls) {
        acquisitionMismatches += 1;
        failures.push(
          `acquisition ${packId}/${targetPlayerId}: owned and unowned runs diverge (${String(owned.hitPull)} vs ${String(unowned.hitPull)})`,
        );
      }
      const hits = acquisitionResults
        .filter(
          (entry) =>
            entry.packId === packId &&
            entry.targetPlayerId === targetPlayerId &&
            !entry.ownedTarget,
        )
        .map((entry) => entry.hitPull)
        .filter((value): value is number => value !== null)
        .sort((a, b) => a - b);
      acquisitionHits += hits.length;
      acquisitionCensored += acquisitionSeeds.length - hits.length;
      const classLabel = ['low', 'median', 'high'][targetIndex] ?? `class-${String(targetIndex)}`;
      const analytic = analytics.find((entry) => entry.pack.packId === packId);
      const counts = analytic?.targetCountsByPlayer.get(targetPlayerId);
      const versionCount =
        counts === undefined
          ? 0
          : COLLECTION_RARITY_ORDER.reduce((sum, rarity) => sum + counts[rarity], 0);
      const label = `targeting/acquisition/${packId}/${classLabel}`;
      measured[`${label}/eligible-versions`] = versionCount;
      measured[`${label}/samples`] = hits.length;
      measured[`${label}/censored`] = acquisitionSeeds.length - hits.length;
      measured[`${label}/p10`] = quantile(hits, 0.1);
      measured[`${label}/p50`] = quantile(hits, 0.5);
      measured[`${label}/p90`] = quantile(hits, 0.9);
      measured[`${label}/mean`] =
        hits.length === 0 ? 0 : hits.reduce((sum, value) => sum + value, 0) / hits.length;
      details.push(
        `acquisition ${packId} ${classLabel} target (${String(versionCount)} eligible versions): pulls-to-first-target p10 ${String(quantile(hits, 0.1))} · p50 ${String(quantile(hits, 0.5))} · p90 ${String(quantile(hits, 0.9))} · mean ${(hits.length === 0 ? 0 : hits.reduce((sum, value) => sum + value, 0) / hits.length).toFixed(1)} over ${String(acquisitionSeeds.length)} seeds (${String(acquisitionSeeds.length - hits.length)} censored at cap ${String(PROGRESSION_ACQUISITION_PULL_CAP)})`,
      );
    }
  }
  gates['targeting.acquisition-ownership-independent'] =
    acquisitionMismatches === 0 && acquisitionPairs > 0;
  measured['targeting/acquisition-pairs'] = acquisitionPairs;
  measured['targeting/acquisition-mismatches'] = acquisitionMismatches;
  measured['targeting/acquisition-hits'] = acquisitionHits;
  measured['targeting/acquisition-censored'] = acquisitionCensored;
  details.push(
    `acquisition: ${String(acquisitionPairs)} pack/target classes · ${String(acquisitionMismatches)} owned/unowned divergences · ${String(acquisitionHits)} hits / ${String(acquisitionCensored)} censored`,
  );

  // Challenge report — deterministic legal cohort teams for all nine challenges.
  const challengeTeams = new Map<string, BuiltCohortTeam>();
  const cohortBaseTeams = new Map<string, BuiltCohortTeam>();
  let teamFailures = 0;
  let feasibilityFailures = 0;
  for (const cohort of PROGRESSION_COHORTS) {
    const base = buildCohortTeam({
      catalog,
      cohort,
      matchingCards: null,
      minimumRosterCount: 0,
      minimumStarterCount: 0,
    });
    cohortBaseTeams.set(cohort.cohortId, base);
    teamFailures += base.failures.length;
    failures.push(...base.failures);
    for (const challenge of progression.challenges) {
      const feasibility = checkCollectionChallengeFeasibility(challenge, catalog);
      if (!feasibility.ok) {
        feasibilityFailures += 1;
        failures.push(...feasibility.failures);
      }
      const built = buildCohortTeam({
        catalog,
        cohort,
        matchingCards: challengeRequirementMatchingCards(challenge.requirement, catalog),
        minimumRosterCount: challenge.requirement.minimumRosterCount,
        minimumStarterCount: challenge.requirement.minimumStarterCount,
      });
      const check = validateCollectionChallengeTeam({
        definition: challenge,
        team: built.team,
        catalog,
        ownedCardIds: new Set(built.owned),
      });
      if (!check.facts.success) {
        teamFailures += 1;
        failures.push(
          `challenge team ${cohort.cohortId}/${challenge.challengeId}: ${check.facts.failureCode ?? 'invalid'}`,
        );
      }
      challengeTeams.set(`${cohort.cohortId}/${challenge.challengeId}`, built);
      details.push(
        `team ${cohort.cohortId}/${challenge.challengeId}: mean overall ${built.meanOverall.toFixed(1)} · matching roster ${String(check.facts.rosterCount)}/${String(check.facts.requiredRosterCount)} · starters ${String(check.facts.starterCount)}/${String(check.facts.requiredStarterCount)}`,
      );
    }
  }
  gates['challenge.catalog-feasible'] = feasibilityFailures === 0;
  gates['challenge.teams-legal'] = teamFailures === 0;
  measured['challenge/feasibility-failures'] = feasibilityFailures;
  measured['challenge/team-failures'] = teamFailures;

  const gameSeeds = [...tuningDrawSeeds, ...heldOutDrawSeeds];
  const gameSequence = 0;
  const tuningSeedSet = new Set(tuningDrawSeeds);
  const heldOutSeedSet = new Set(heldOutDrawSeeds);
  const challengeJobs: ProgressionChallengeJob[] = [];
  for (const cohort of PROGRESSION_COHORTS) {
    for (const challenge of progression.challenges) {
      const built = challengeTeams.get(`${cohort.cohortId}/${challenge.challengeId}`);
      if (built === undefined) continue;
      for (const rootSeed of gameSeeds) {
        for (const mode of ['first', 'repeat'] as const) {
          challengeJobs.push({
            kind: 'challenge',
            cohortId: cohort.cohortId,
            challengeId: challenge.challengeId,
            rootSeed,
            gameSequence,
            team: built.team,
            mode,
          });
        }
      }
    }
  }
  const standardJobs: ProgressionStandardJob[] = [];
  for (const cohort of PROGRESSION_COHORTS) {
    const built = cohortBaseTeams.get(cohort.cohortId);
    if (built === undefined) continue;
    for (const difficultyId of ['pro', 'legend'] as const) {
      for (const rootSeed of gameSeeds) {
        standardJobs.push({
          kind: 'standard',
          cohortId: cohort.cohortId,
          difficultyId,
          rootSeed,
          gameSequence,
          team: built.team,
        });
      }
    }
  }
  let challengeResults: ProgressionGameResult[];
  let standardResults: ProgressionGameResult[];
  try {
    challengeResults = await runJobs<ProgressionGameResult>({
      manifestPath: input.manifestPath,
      kind: 'games',
      jobs: challengeJobs,
      workers,
    });
    standardResults = await runJobs<ProgressionGameResult>({
      manifestPath: input.manifestPath,
      kind: 'games',
      jobs: standardJobs,
      workers,
    });
  } catch (error) {
    return makeReport(
      CALIBRATION_COMMAND,
      { manifest: input.manifestPath },
      { failures: [`challenge game cohort failed: ${(error as Error).message}`], exitCode: 2 },
    );
  }
  const challengeByKey = new Map<string, ProgressionGameResult>();
  for (const result of challengeResults) {
    challengeByKey.set(
      `${result.cohortId}/${String(result.challengeId)}/${result.rootSeed}/${result.mode}`,
      result,
    );
  }
  let twinMismatches = 0;
  let firstClearExclusionFailures = 0;
  let tuningCheckFailures = 0;
  let tuningGameFailures = 0;
  let heldOutCheckFailures = 0;
  let heldOutGameFailures = 0;
  const tuningRepeatAggregates = new Map<string, ChallengeAggregate>();
  const heldOutRepeatAggregates = new Map<string, ChallengeAggregate>();
  const firstAggregates = new Map<string, ChallengeAggregate>();
  const tuningFirstAggregates = new Map<string, ChallengeAggregate>();
  const heldOutFirstAggregates = new Map<string, ChallengeAggregate>();
  for (const result of challengeResults) {
    const isTuning = tuningSeedSet.has(result.rootSeed);
    if (result.failure !== null) {
      if (isTuning) tuningGameFailures += 1;
      else heldOutGameFailures += 1;
      failures.push(
        `challenge game ${result.cohortId}/${String(result.challengeId)} ${result.rootSeed}: ${result.failure}`,
      );
      continue;
    }
    if (result.checkFailures.length > 0) {
      if (isTuning) tuningCheckFailures += result.checkFailures.length;
      else heldOutCheckFailures += result.checkFailures.length;
      for (const checkFailure of result.checkFailures) {
        failures.push(
          `challenge game ${result.cohortId}/${String(result.challengeId)} ${result.rootSeed} ${result.mode}: ${checkFailure}`,
        );
      }
    }
    if (result.mode === 'repeat') {
      accumulateInto(
        isTuning ? tuningRepeatAggregates : heldOutRepeatAggregates,
        String(result.challengeId),
        result,
      );
    } else {
      accumulateInto(firstAggregates, String(result.challengeId), result);
      accumulateInto(
        isTuning ? tuningFirstAggregates : heldOutFirstAggregates,
        String(result.challengeId),
        result,
      );
      const twin = challengeByKey.get(
        `${result.cohortId}/${String(result.challengeId)}/${result.rootSeed}/repeat`,
      );
      if (twin !== undefined) {
        if (twin.resultDigest !== result.resultDigest || twin.eventDigest !== result.eventDigest) {
          twinMismatches += 1;
        }
        if (twin.challengeFirstClearGranted || twin.difficultyFirstClearGranted) {
          firstClearExclusionFailures += 1;
        }
        const firstFirstClear = result.rewardTotal - result.repeatCoins;
        const twinFirstClear = twin.rewardTotal - twin.repeatCoins;
        if (firstFirstClear <= 0 && result.winner === 'home') {
          firstClearExclusionFailures += 1;
        }
        if (twinFirstClear !== 0) firstClearExclusionFailures += 1;
      }
      if (result.winner === 'home' && !result.challengeFirstClearGranted) {
        firstClearExclusionFailures += 1;
      }
      if (result.winner !== 'home' && result.challengeFirstClearGranted) {
        firstClearExclusionFailures += 1;
      }
    }
  }
  gates['challenge.tuning-zero-failures'] = tuningGameFailures === 0 && tuningCheckFailures === 0;
  gates['challenge.held-out-zero-failures'] =
    heldOutGameFailures === 0 && heldOutCheckFailures === 0;
  gates['challenge.twin-determinism'] = twinMismatches === 0;
  gates['challenge.first-clear-exclusion'] = firstClearExclusionFailures === 0;
  measured['challenge/twin-mismatches'] = twinMismatches;
  measured['challenge/first-clear-exclusion-failures'] = firstClearExclusionFailures;
  measured['challenge/tuning-game-failures'] = tuningGameFailures;
  measured['challenge/tuning-check-failures'] = tuningCheckFailures;
  measured['challenge/held-out-game-failures'] = heldOutGameFailures;
  measured['challenge/held-out-check-failures'] = heldOutCheckFailures;
  for (const challenge of progression.challenges) {
    const tuning = tuningRepeatAggregates.get(challenge.challengeId) ?? emptyChallengeAggregate();
    const heldOut = heldOutRepeatAggregates.get(challenge.challengeId) ?? emptyChallengeAggregate();
    const first = firstAggregates.get(challenge.challengeId) ?? emptyChallengeAggregate();
    const tuningRate = challengeRateOf(tuning);
    const heldOutRate = challengeRateOf(heldOut);
    const firstRate = challengeRateOf(first);
    measured[`challenge/${challenge.challengeId}/tuning/games`] = tuning.games;
    measured[`challenge/${challenge.challengeId}/tuning/win-rate`] = tuningRate.winRate;
    measured[`challenge/${challenge.challengeId}/tuning/objective-pass-rate`] =
      tuningRate.objectivePassRate;
    measured[`challenge/${challenge.challengeId}/tuning/repeat-coins-per-game`] =
      tuningRate.coinsPerGame;
    measured[`challenge/${challenge.challengeId}/tuning/repeat-coins-per-minute`] =
      tuningRate.coinsPerMinute;
    measured[`challenge/${challenge.challengeId}/held-out/games`] = heldOut.games;
    measured[`challenge/${challenge.challengeId}/held-out/win-rate`] = heldOutRate.winRate;
    measured[`challenge/${challenge.challengeId}/held-out/objective-pass-rate`] =
      heldOutRate.objectivePassRate;
    measured[`challenge/${challenge.challengeId}/held-out/repeat-coins-per-game`] =
      heldOutRate.coinsPerGame;
    measured[`challenge/${challenge.challengeId}/held-out/repeat-coins-per-minute`] =
      heldOutRate.coinsPerMinute;
    measured[`challenge/${challenge.challengeId}/tuning/first-clears`] = (
      tuningFirstAggregates.get(challenge.challengeId) ?? emptyChallengeAggregate()
    ).firstClearGranted;
    measured[`challenge/${challenge.challengeId}/held-out/first-clears`] = (
      heldOutFirstAggregates.get(challenge.challengeId) ?? emptyChallengeAggregate()
    ).firstClearGranted;
    measured[`challenge/${challenge.challengeId}/all/win-rate`] = firstRate.winRate;
    measured[`challenge/${challenge.challengeId}/first-clear-coins`] = challenge.firstClearCoins;
    measured[`challenge/${challenge.challengeId}/repeat-win-coins`] = challenge.repeatWinCoins;
    details.push(
      `challenge ${challenge.challengeId}: ${challenge.difficultyId} · tuning win ${(tuningRate.winRate * 100).toFixed(1)}% · held-out win ${(heldOutRate.winRate * 100).toFixed(1)}% · held-out repeat ${heldOutRate.coinsPerGame.toFixed(1)} Coins/game · ${heldOutRate.coinsPerMinute.toFixed(2)} Coins/min`,
    );
  }
  for (const cohort of PROGRESSION_COHORTS) {
    const built = cohortBaseTeams.get(cohort.cohortId);
    if (built !== undefined) {
      measured[`challenge/cohort/${cohort.cohortId}/mean-overall`] = built.meanOverall;
      details.push(
        `cohort ${cohort.cohortId}: base team mean overall ${built.meanOverall.toFixed(1)}`,
      );
    }
  }

  // M4.3 standard envelope, frozen from the tuning cohort before the held-out
  // rates are read. The envelope is the best *allowed* standard repeat reward:
  // win + objective + margin cap scaled by each challenge difficulty's reward
  // multiplier (the M4.3 reward table), converted to a per-minute ceiling with
  // the 240-minute regulation game. Standard pro/legend games are still run
  // with the same cohort teams; their observed rates are recorded and must stay
  // at or below the allowed ceiling.
  let standardFailures = 0;
  const observedStandardByGroup = new Map<string, ChallengeAggregate>();
  for (const result of standardResults) {
    if (result.failure !== null) {
      standardFailures += 1;
      failures.push(
        `standard game ${result.cohortId}/${result.difficultyId} ${result.rootSeed}: ${result.failure}`,
      );
      continue;
    }
    if (result.checkFailures.length > 0) {
      standardFailures += 1;
      for (const checkFailure of result.checkFailures) {
        failures.push(
          `standard game ${result.cohortId}/${result.difficultyId} ${result.rootSeed}: ${checkFailure}`,
        );
      }
    }
    if (!tuningSeedSet.has(result.rootSeed)) continue;
    accumulateInto(observedStandardByGroup, `${result.cohortId}/${result.difficultyId}`, result);
  }
  let envelopeCoinsPerGame = 0;
  let envelopeCoinsPerMinute = 0;
  const challengeDifficultyIds = [
    ...new Set(progression.challenges.map((challenge) => challenge.difficultyId)),
  ];
  for (const difficultyId of challengeDifficultyIds) {
    const difficulty = rules.difficulties.find((entry) => entry.difficultyId === difficultyId);
    if (difficulty === undefined) continue;
    const maxRepeat =
      collectionScaleRewardCoins(rules.rewardTable.winCoins, difficulty.rewardMultiplierBp) +
      collectionScaleRewardCoins(rules.rewardTable.objectiveCoins, difficulty.rewardMultiplierBp) +
      collectionScaleRewardCoins(
        rules.rewardTable.marginCoinPerPoint * rules.rewardTable.marginCapPoints,
        difficulty.rewardMultiplierBp,
      );
    measured[`challenge/envelope/${difficultyId}/max-repeat-coins-per-game`] = maxRepeat;
    measured[`challenge/envelope/${difficultyId}/max-repeat-coins-per-minute`] =
      maxRepeat / COLLECTION_ACTIVE_TEAM_GAME_MINUTES;
    envelopeCoinsPerGame = Math.max(envelopeCoinsPerGame, maxRepeat);
    envelopeCoinsPerMinute = Math.max(
      envelopeCoinsPerMinute,
      maxRepeat / COLLECTION_ACTIVE_TEAM_GAME_MINUTES,
    );
  }
  let observedAboveEnvelope = 0;
  for (const [key, aggregate] of observedStandardByGroup) {
    const rate = challengeRateOf(aggregate);
    measured[`challenge/standard-observed/${key}/games`] = aggregate.games;
    measured[`challenge/standard-observed/${key}/repeat-coins-per-game`] = rate.coinsPerGame;
    measured[`challenge/standard-observed/${key}/repeat-coins-per-minute`] = rate.coinsPerMinute;
    if (rate.coinsPerGame > envelopeCoinsPerGame) observedAboveEnvelope += 1;
  }
  gates['challenge.standard-envelope-healthy'] =
    standardFailures === 0 &&
    observedStandardByGroup.size === PROGRESSION_COHORTS.length * challengeDifficultyIds.length &&
    observedAboveEnvelope === 0;
  measured['challenge/envelope/coins-per-game'] = envelopeCoinsPerGame;
  measured['challenge/envelope/coins-per-minute'] = envelopeCoinsPerMinute;
  measured['challenge/envelope/observed-above'] = observedAboveEnvelope;
  measured['challenge/standard-games'] = standardResults.length;
  measured['challenge/standard-failures'] = standardFailures;
  details.push(
    `M4.3 envelope (tuning, no first clears): best allowed ${envelopeCoinsPerGame.toFixed(1)} Coins/game · ${envelopeCoinsPerMinute.toFixed(2)} Coins/min across ${String(observedStandardByGroup.size)} cohort/difficulty groups`,
  );
  let envelopeViolations = 0;
  for (const challenge of progression.challenges) {
    const heldOut = heldOutRepeatAggregates.get(challenge.challengeId) ?? emptyChallengeAggregate();
    const rate = challengeRateOf(heldOut);
    if (rate.coinsPerGame > envelopeCoinsPerGame * ENVELOPE_ALLOWANCE) envelopeViolations += 1;
    if (rate.coinsPerMinute > envelopeCoinsPerMinute * ENVELOPE_ALLOWANCE) envelopeViolations += 1;
  }
  gates['challenge.held-out-repeat-envelope'] = envelopeViolations === 0;
  measured['challenge/envelope-violations'] = envelopeViolations;

  // Risk/reward ordering: harder family challenges pay more per win and stay harder.
  const idsFor = (kind: 'era-core' | 'franchise-core' | 'set-family-core'): string[] =>
    progression.challenges
      .filter((challenge) => challenge.requirement.kind === kind)
      .map((challenge) => challenge.challengeId);
  const eraIds = idsFor('era-core');
  const franchiseIds = idsFor('franchise-core');
  const familyIds = idsFor('set-family-core');
  const challengeOf = (challengeId: string): CollectionChallengeDefinition | undefined =>
    progression.challenges.find((challenge) => challenge.challengeId === challengeId);
  const minNominal = (ids: readonly string[], key: 'firstClearCoins' | 'repeatWinCoins'): number =>
    ids.reduce(
      (min, id) => Math.min(min, challengeOf(id)?.[key] ?? Number.POSITIVE_INFINITY),
      Number.POSITIVE_INFINITY,
    );
  const maxNominal = (ids: readonly string[], key: 'firstClearCoins' | 'repeatWinCoins'): number =>
    ids.reduce((max, id) => Math.max(max, challengeOf(id)?.[key] ?? 0), 0);
  const combinedWinRate = (ids: readonly string[]): number => {
    let games = 0;
    let wins = 0;
    for (const id of ids) {
      const aggregate = firstAggregates.get(id);
      if (aggregate === undefined) continue;
      games += aggregate.games;
      wins += aggregate.wins;
    }
    return games === 0 ? 0 : wins / games;
  };
  const combinedCoinsPerWin = (ids: readonly string[]): number => {
    let wins = 0;
    let coins = 0;
    for (const id of ids) {
      const aggregate = firstAggregates.get(id);
      if (aggregate === undefined) continue;
      wins += aggregate.wins;
      coins += aggregate.challengeComponentCoins;
    }
    return wins === 0 ? 0 : coins / wins;
  };
  const nominalOrdering =
    minNominal(familyIds, 'repeatWinCoins') > maxNominal(franchiseIds, 'repeatWinCoins') &&
    minNominal(franchiseIds, 'repeatWinCoins') > maxNominal(eraIds, 'repeatWinCoins') &&
    minNominal(familyIds, 'firstClearCoins') > maxNominal(franchiseIds, 'firstClearCoins') &&
    minNominal(franchiseIds, 'firstClearCoins') > maxNominal(eraIds, 'firstClearCoins');
  const measuredPerWinOrdering =
    combinedCoinsPerWin(familyIds) > combinedCoinsPerWin(franchiseIds) &&
    combinedCoinsPerWin(franchiseIds) > combinedCoinsPerWin(eraIds);
  const familyHarder =
    combinedWinRate(familyIds) <= combinedWinRate(eraIds) &&
    combinedWinRate(familyIds) <= combinedWinRate(franchiseIds);
  gates['challenge.risk-reward-ordering'] =
    nominalOrdering && measuredPerWinOrdering && familyHarder;
  measured['challenge/ordering/era-win-rate'] = combinedWinRate(eraIds);
  measured['challenge/ordering/franchise-win-rate'] = combinedWinRate(franchiseIds);
  measured['challenge/ordering/family-win-rate'] = combinedWinRate(familyIds);
  measured['challenge/ordering/era-coins-per-win'] = combinedCoinsPerWin(eraIds);
  measured['challenge/ordering/franchise-coins-per-win'] = combinedCoinsPerWin(franchiseIds);
  measured['challenge/ordering/family-coins-per-win'] = combinedCoinsPerWin(familyIds);
  details.push(
    `risk/reward: family win ${(combinedWinRate(familyIds) * 100).toFixed(1)}% vs era ${(combinedWinRate(eraIds) * 100).toFixed(1)}% · repeat coins/win family ${combinedCoinsPerWin(familyIds).toFixed(1)} > franchise ${combinedCoinsPerWin(franchiseIds).toFixed(1)} > era ${combinedCoinsPerWin(eraIds).toFixed(1)}`,
  );

  // Set report.
  const setReport = runSetReport({ catalog, catalogHash, progression, progressionHash });
  Object.assign(gates, setReport.gates);
  Object.assign(measured, setReport.measured);
  failures.push(...setReport.failures);
  details.push(...setReport.details);

  // Worker/chunk invariance: the artifact content is a pure fold over job results.
  const drawSampleJobs = tuningDrawJobs.slice(0, 8).map((job) => ({
    ...job,
    pullCount: Math.min(job.pullCount, 25),
  }));
  const gameSampleJobs = challengeJobs
    .filter((job) => job.mode === 'first' && job.rootSeed === tuningDrawSeeds[0])
    .slice(0, 36);
  let chunkDrawEqual = true;
  let chunkGameEqual = true;
  let chunkOrderEqual = true;
  try {
    const drawOne = aggregateDrawResults(
      await runJobs<ProgressionDrawResult>({
        manifestPath: input.manifestPath,
        kind: 'draws',
        jobs: drawSampleJobs,
        workers: 1,
      }),
    );
    const drawMany = aggregateDrawResults(
      await runJobs<ProgressionDrawResult>({
        manifestPath: input.manifestPath,
        kind: 'draws',
        jobs: drawSampleJobs,
        workers,
      }),
    );
    chunkDrawEqual = canonicalJson(drawOne) === canonicalJson(drawMany);
    const gameOne = await runJobs<ProgressionGameResult>({
      manifestPath: input.manifestPath,
      kind: 'games',
      jobs: gameSampleJobs,
      workers: 1,
    });
    const gameMany = await runJobs<ProgressionGameResult>({
      manifestPath: input.manifestPath,
      kind: 'games',
      jobs: gameSampleJobs,
      workers,
    });
    chunkGameEqual = canonicalJson(gameOne) === canonicalJson(gameMany);
    chunkOrderEqual =
      canonicalJson(aggregateDrawResults(tuningDraws)) ===
      canonicalJson(aggregateDrawResults([...tuningDraws].reverse()));
  } catch (error) {
    chunkDrawEqual = false;
    failures.push(`worker chunk invariance probe failed: ${(error as Error).message}`);
  }
  const chunkInvariant = chunkDrawEqual && chunkGameEqual && chunkOrderEqual;
  gates['workerChunkInvariant'] = chunkInvariant;
  measured['workerChunkInvariant/draw-jobs'] = drawSampleJobs.length;
  measured['workerChunkInvariant/game-jobs'] = gameSampleJobs.length;
  measured['workerChunkInvariant/draws-equal'] = chunkDrawEqual ? 1 : 0;
  measured['workerChunkInvariant/games-equal'] = chunkGameEqual ? 1 : 0;
  measured['workerChunkInvariant/order-equal'] = chunkOrderEqual ? 1 : 0;
  details.push(
    `worker chunk invariance: draws ${chunkDrawEqual ? 'equal' : 'DIVERGED'} · games ${chunkGameEqual ? 'equal' : 'DIVERGED'} · order ${chunkOrderEqual ? 'equal' : 'DIVERGED'} with ${String(workers)} workers`,
  );

  // Held-out seeds are frozen and disjoint from the tuning range.
  const tuningSeedIntersection = [...tuningSeedSet].filter((seed) => heldOutSeedSet.has(seed));
  gates['calibration.held-out-disjoint'] =
    tuningSeedIntersection.length === 0 &&
    PROGRESSION_CALIBRATION_HELD_OUT_SEED_OFFSET >= calibrationSeeds;
  measured['calibration/held-out-intersection'] = tuningSeedIntersection.length;
  details.push(
    `seed ranges: tuning [${String(PROGRESSION_CALIBRATION_TUNING_SEED_OFFSET)}, ${String(calibrationSeeds)}) · held-out [${String(PROGRESSION_CALIBRATION_HELD_OUT_SEED_OFFSET)}, ${String(PROGRESSION_CALIBRATION_HELD_OUT_SEED_OFFSET + validationSeeds)})`,
  );

  const fixtures = PROGRESSION_COHORTS.flatMap((cohort) => {
    const built = cohortBaseTeams.get(cohort.cohortId);
    if (built === undefined) return [];
    const genesis = genesisRecords({
      catalog,
      catalogHash,
      rootSeed: progressionTuningSeed(0),
      ownedCardIds: built.cardIds,
      progressionHash,
      coins: 0,
      exchange: 0,
    });
    return [{ fixtureId: `cohort-${cohort.cohortId}`, collectionHash: genesis.state.digest }];
  });

  for (const [name, pass] of Object.entries(gates)) {
    if (!pass) failures.push(`gate ${name} failed`);
  }
  const content = collectionProgressionTargetsSchema.parse({
    schemaVersion: 1,
    targetsVersion: COLLECTION_PROGRESSION_TARGETS_VERSION,
    progressionVersion: COLLECTION_PROGRESSION_VERSION,
    targetingVersion: COLLECTION_TARGETING_VERSION,
    challengeVersion: COLLECTION_CHALLENGE_VERSION,
    challengeRewardVersion: COLLECTION_CHALLENGE_REWARD_VERSION,
    setRewardVersion: COLLECTION_SET_REWARD_VERSION,
    catalogHash,
    progressionRulesHash: progressionHash,
    rulesHash,
    engineVersion: ENGINE_VERSION,
    cohorts: {
      calibrationSeeds,
      validationSeeds,
      ordinarySlotDraws,
      generatedAtIso: AT_ISO,
    },
    gates,
    measured,
    fixtures,
  });
  const outPath = input.out ?? DEFAULT_COLLECTION_PROGRESSION_TARGETS;
  const written = writeProgressionTargetsArtifact({
    outPath,
    manifestPath: input.manifestPath,
    content,
  });
  if (written.error !== null) failures.push(`cannot write progression targets: ${written.error}`);
  const payload = collectionProgressionCalibrateReportSchema.parse({
    schemaVersion: 1,
    command: CALIBRATION_COMMAND,
    catalogHash,
    progressionRulesHash: progressionHash,
    rulesHash,
    engineVersion: ENGINE_VERSION,
    workers,
    calibrationSeeds,
    validationSeeds,
    ordinarySlotDraws,
    gates,
    fixtures,
    targetsWritten: written.written,
    targetsPath: written.written ? written.path : null,
    pinned: written.pinned,
    durationMs: Date.now() - startedAt,
  });
  details.unshift(
    `progression targets: ${String(Object.keys(gates).length)} gates · ${String(Object.values(gates).filter(Boolean).length)} passing · ${String(fixtures.length)} fixtures · artifact ${written.written ? written.path : 'not written'}`,
  );
  return makeReport(
    CALIBRATION_COMMAND,
    { manifest: input.manifestPath },
    { details, failures, payload },
  );
}
