import { parentPort, workerData } from 'node:worker_threads';
import {
  COLLECTION_CATALOG_VERSION,
  COLLECTION_ECONOMY_VERSION,
  COLLECTION_PACK_RULES_VERSION,
  COLLECTION_RARITY_ORDER,
  COLLECTION_REPLAY_VERSION,
  COLLECTION_TARGETING_VERSION,
  canonicalJson,
  collectionCommandSchema,
  collectionLedgerEntrySchema,
  collectionPullRecordSchema,
  type CollectionCatalog,
  type CollectionCommand,
  type CollectionDifficultyProfile,
  type CollectionGameRecordV3,
  type CollectionGameResultV2,
  type CollectionGameRules,
  type CollectionLedgerEntry,
  type CollectionObjectiveDefinition,
  type CollectionProgressionRules,
  type CollectionPullRecord,
  type CollectionState,
  type CollectionTargetSnapshot,
  type EraSimulationProfile,
} from '@hoop-rush/data-contracts';
import {
  applyCollectionCommand,
  auditCollectionState,
  buildCollectionObjectiveFacts,
  checkCollectionGameRecord,
  checkCollectionGameResult,
  collectionChallengeEvaluationFor,
  collectionChallengeRewardReceiptFor,
  collectionGameEventDigest,
  collectionGameResultDigest,
  collectionGameRewardReceiptFor,
  collectionObjectiveDefinitionsFromRules,
  collectionPreparedInputDigest,
  collectionStateDigest,
  collectionStateFactsOf,
  collectionTargetingSeedPath,
  compileTargetEligibility,
  drawCollectionPackSlotsTargeted,
  evaluateCollectionObjective,
  initializeCollectionState,
  prepareCollectionBasicGameV2,
  prepareCollectionChallengeGame,
  reproduceCollectionPull,
  resolveCollectionChallenge,
  simulateCollectionGame,
} from '@hoop-rush/engine';
import { sha256Hex } from './io.ts';
import { loadCollectionCatalog } from './commands/collection.ts';
import { loadCollectionGameProfile, loadCollectionGameRules } from './commands/collection-game.ts';
import { loadCollectionProgressionRules } from './commands/collection-progression.ts';
import type {
  ProgressionChallengeJob,
  ProgressionDrawJob,
  ProgressionDrawResult,
  ProgressionGameJob,
  ProgressionGameResult,
  ProgressionPurchaseJob,
  ProgressionPurchaseResult,
  ProgressionStandardJob,
  ProgressionWorkerInput,
} from './collection-progression-calibration.ts';
import { PROGRESSION_TARGETS_GENERATED_AT_ISO } from './collection-progression-calibration.ts';

const GENESIS_COMMAND_ID = 'progression-calibration-genesis';

function genesisTransactionId(currency: string): string {
  return `txn-${sha256Hex(`progression-calibration-genesis\u0000${currency}`).slice(0, 32)}`;
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
        acquiredAtIso: PROGRESSION_TARGETS_GENERATED_AT_ISO,
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
        replayVersion: COLLECTION_REPLAY_VERSION,
        targeting: null,
      }),
    );
  }
  const ledger: CollectionLedgerEntry[] = [
    collectionLedgerEntrySchema.parse({
      transactionId: genesisTransactionId('Coins'),
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
        transactionId: genesisTransactionId('Exchange'),
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

function runDrawJob(catalog: CollectionCatalog, job: ProgressionDrawJob): ProgressionDrawResult {
  const pack = catalog.packs.find((entry) => entry.packId === job.packId);
  if (pack === undefined) throw new Error(`unknown pack ${job.packId}`);
  const eligibility = compileTargetEligibility(catalog, pack, job.targetPlayerId);
  const rarityCounts = new Array<number>(pack.slots.length * COLLECTION_RARITY_ORDER.length).fill(
    0,
  );
  const targetCardIds = new Set(eligibility.flatMap((entry) => entry.cardIds));
  const rarityIndex = new Map<string, number>();
  COLLECTION_RARITY_ORDER.forEach((rarity, index) => rarityIndex.set(rarity, index));
  let ordinarySlots = 0;
  let guaranteedSlots = 0;
  let pullsWithTarget = 0;
  let targetSlots = 0;
  for (let pull = 0; pull < job.pullCount; pull += 1) {
    const pullSequence = job.pullStart + pull;
    const draws = drawCollectionPackSlotsTargeted({
      catalog,
      pack,
      rootSeed: job.rootSeed,
      pullSequence,
      target: {
        targetingVersion: COLLECTION_TARGETING_VERSION,
        targetPlayerId: job.targetPlayerId as CollectionTargetSnapshot['targetPlayerId'],
        multiplierBp: job.multiplierBp,
        packId: pack.packId,
        packRulesVersion: pack.packRulesVersion,
        eligibleByRarity: eligibility,
        eligibleCardCount: targetCardIds.size,
        seedPath: collectionTargetingSeedPath(pack.packId, pack.packRulesVersion, pullSequence),
      },
    });
    let hit = false;
    for (const draw of draws) {
      const slot = pack.slots[draw.slotIndex];
      if (slot?.kind === 'ordinary') ordinarySlots += 1;
      else guaranteedSlots += 1;
      const rarity = rarityIndex.get(draw.rarity) ?? 0;
      const key = draw.slotIndex * COLLECTION_RARITY_ORDER.length + rarity;
      rarityCounts[key] = (rarityCounts[key] ?? 0) + 1;
      if (targetCardIds.has(draw.cardId)) {
        hit = true;
        targetSlots += 1;
      }
    }
    if (hit) pullsWithTarget += 1;
  }
  return {
    packId: pack.packId,
    targetPlayerId: job.targetPlayerId,
    rootSeed: job.rootSeed,
    pullCount: job.pullCount,
    ordinarySlots,
    guaranteedSlots,
    pullsWithTarget,
    targetSlots,
    rarityCounts,
  };
}

function runPurchaseJob(
  catalog: CollectionCatalog,
  catalogHash: string,
  progression: CollectionProgressionRules,
  progressionHash: string,
  job: ProgressionPurchaseJob,
): ProgressionPurchaseResult {
  const pack = catalog.packs.find((entry) => entry.packId === job.packId);
  if (pack === undefined) throw new Error(`unknown pack ${job.packId}`);
  const byId = new Map(catalog.cards.map((card) => [card.cardId, card]));
  const ownedCardIds = job.ownedTarget
    ? compileTargetEligibility(catalog, pack, job.targetPlayerId).flatMap((entry) => entry.cardIds)
    : [];
  const genesis = genesisRecords({
    catalog,
    catalogHash,
    rootSeed: job.rootSeed,
    ownedCardIds,
    progressionHash,
    coins: 10_000_000,
    exchange: 10_000_000,
  });
  let state = genesis.state;
  const pulls = [...genesis.pulls];
  const ledger = [...genesis.ledger];
  const commands: CollectionCommand[] = [];
  const result: ProgressionPurchaseResult = {
    packId: pack.packId,
    rootSeed: job.rootSeed,
    targetPlayerId: job.targetPlayerId,
    ownedTarget: job.ownedTarget,
    pulls: 0,
    hitPull: null,
    targetSlots: 0,
    kept: 0,
    duplicates: 0,
    exchangeEarned: 0,
    accepted: 0,
    rejected: [],
    auditFailures: 0,
    reproductionFailures: 0,
    conversionMismatches: 0,
    finalRevision: state.revision,
    finalDigest: state.digest,
  };
  for (let index = 0; index < job.pullCap; index += 1) {
    const command = collectionCommandSchema.parse({
      schemaVersion: 2,
      commandVersion: 'collection-command-v2',
      commandId: `progression-purchase-${job.packId}-${job.rootSeed.slice(-8)}-${String(index)}`,
      collectionId: state.collectionId,
      expectedRevision: state.revision,
      expectedDigest: state.digest,
      command: 'open-pack',
      packId: pack.packId,
      acquiredAtIso: PROGRESSION_TARGETS_GENERATED_AT_ISO,
    });
    const outcome = applyCollectionCommand(
      state,
      command,
      catalog,
      pulls,
      ledger,
      commands,
      catalogHash,
      progression,
      progressionHash,
    );
    if (outcome.status !== 'accepted') {
      result.rejected.push(outcome.rejection.code);
      break;
    }
    result.accepted += 1;
    result.pulls += 1;
    if (outcome.pull === null) {
      result.rejected.push('missing-pull');
      break;
    }
    let hit = false;
    for (const slot of outcome.pull.slots) {
      const card = byId.get(slot.cardId);
      if (card !== undefined && card.playerId === job.targetPlayerId) {
        hit = true;
        result.targetSlots += 1;
      }
      if (slot.kept) {
        result.kept += 1;
      } else {
        result.duplicates += 1;
        result.exchangeEarned += slot.conversionAmount;
        if (slot.conversionAmount !== pack.duplicateExchange[slot.rarity]) {
          result.conversionMismatches += 1;
        }
      }
    }
    if (hit && result.hitPull === null) result.hitPull = index + 1;
    state = outcome.state;
    pulls.push(outcome.pull);
    ledger.push(...outcome.ledgerEntries);
    commands.push(command);
    result.auditFailures += auditCollectionState(state, pulls, ledger, [], commands).length;
    const reproduced = reproduceCollectionPull(catalog, outcome.pull, job.rootSeed);
    if (!reproduced.ok) result.reproductionFailures += 1;
    if (hit) break;
  }
  result.finalRevision = state.revision;
  result.finalDigest = state.digest;
  return result;
}

function repeatCoinsOf(receipt: {
  components: ReadonlyArray<{ kind: string; amount: number }>;
  total: number;
}): number {
  let firstClear = 0;
  for (const component of receipt.components) {
    if (component.kind === 'first-clear' || component.kind === 'challenge-first-clear') {
      firstClear += component.amount;
    }
  }
  return receipt.total - firstClear;
}

function emptyGameResult(job: ProgressionGameJob): ProgressionGameResult {
  return {
    kind: job.kind,
    cohortId: job.cohortId,
    challengeId: job.kind === 'challenge' ? job.challengeId : null,
    difficultyId: job.kind === 'challenge' ? 'pro' : job.difficultyId,
    rootSeed: job.rootSeed,
    gameSequence: job.gameSequence,
    mode: job.kind === 'challenge' ? job.mode : 'standard',
    failure: null,
    checkFailures: [],
    outcome: null,
    winner: null,
    eventDigest: null,
    resultDigest: null,
    overtimePeriods: 0,
    objectiveSelected: null,
    objectiveEvaluated: false,
    objectivePassed: false,
    difficultyFirstClearGranted: false,
    challengeFirstClearGranted: false,
    rewardTotal: 0,
    repeatCoins: 0,
    challengeComponentCoins: 0,
    homeSeconds: 0,
  };
}

function runChallengeJob(input: {
  catalog: CollectionCatalog;
  rules: CollectionGameRules;
  progression: CollectionProgressionRules;
  profile: EraSimulationProfile;
  objectives: readonly CollectionObjectiveDefinition[];
  catalogHash: string;
  rulesHash: string;
  profileHash: string;
  job: ProgressionChallengeJob;
}): ProgressionGameResult {
  const { catalog, rules, progression, profile, objectives, job } = input;
  const base = emptyGameResult(job);
  const definition = resolveCollectionChallenge(progression, job.challengeId);
  if (definition === undefined) return { ...base, failure: `unknown challenge ${job.challengeId}` };
  const difficulty: CollectionDifficultyProfile | undefined = rules.difficulties.find(
    (entry) => entry.difficultyId === definition.difficultyId,
  );
  if (difficulty === undefined) {
    return { ...base, failure: `unknown difficulty ${definition.difficultyId}` };
  }
  const ownedCardIds = new Set([...job.team.starters, ...job.team.bench]);
  try {
    const offers = buildCollectionObjectiveFacts({
      definitions: objectives,
      rootSeed: job.rootSeed,
      difficultyId: definition.difficultyId,
      gameSequence: job.gameSequence,
      team: job.team,
      selectedObjectiveId: null,
    });
    const selectedObjectiveId = offers.offers[0]?.objectiveId ?? null;
    const preparedFirst = prepareCollectionChallengeGame({
      collectionId: 'progression-calibration',
      rootSeed: job.rootSeed,
      gameSequence: job.gameSequence,
      ownedCardIds,
      team: job.team,
      catalog,
      challengeId: definition.challengeId,
      difficultyProfiles: rules.difficulties,
      objectiveDefinitions: objectives,
      selectedObjectiveId,
      clearedDifficultyIds: [],
      clearedChallengeIds: [],
      progression,
      profileVersion: profile.profileVersion,
      profileHash: input.profileHash,
      catalogHash: input.catalogHash,
      rulesHash: input.rulesHash,
    });
    const prepared =
      job.mode === 'repeat'
        ? (() => {
            const draft = {
              ...preparedFirst,
              firstClearEligible: false,
              challenge: { ...preparedFirst.challenge, firstClearEligible: false },
            };
            return { ...draft, inputDigest: collectionPreparedInputDigest(draft) };
          })()
        : preparedFirst;
    const simulated = simulateCollectionGame(prepared, catalog, profile);
    const result = simulated.result as CollectionGameRecordV3['result'];
    const evaluation = evaluateCollectionObjective({ prepared, result });
    const challengeEvaluation = collectionChallengeEvaluationFor({
      prepared,
      result,
    });
    const reward = collectionChallengeRewardReceiptFor({
      gameId: prepared.gameId,
      prepared,
      result,
      evaluation,
      challengeEvaluation,
    });
    const record: CollectionGameRecordV3 = {
      gameVersion: 'collection-game-v3',
      collectionId: prepared.collectionId,
      gameId: prepared.gameId,
      gameSequence: prepared.gameSequence,
      prepared,
      result,
      events: simulated.events,
      eventDigest: collectionGameEventDigest(simulated.events),
      resultDigest: collectionGameResultDigest(result),
      objectiveEvaluation: evaluation,
      challengeEvaluation,
      reward,
      completedAtIso: PROGRESSION_TARGETS_GENERATED_AT_ISO,
    };
    const checkFailures = checkCollectionGameRecord(record, catalog, profile);
    const challengeComponent = reward.components.find(
      (component) =>
        component.kind === 'challenge-first-clear' || component.kind === 'challenge-repeat-win',
    );
    const homeSeconds =
      result.outcome === 'completed'
        ? result.home.players.reduce((sum, player) => sum + player.seconds, 0)
        : 0;
    return {
      ...base,
      difficultyId: definition.difficultyId,
      checkFailures,
      outcome: result.outcome,
      winner: result.winner,
      eventDigest: record.eventDigest,
      resultDigest: record.resultDigest,
      overtimePeriods: result.outcome === 'completed' ? result.overtimePeriods : 0,
      objectiveSelected: selectedObjectiveId,
      objectiveEvaluated: evaluation.kind === 'evaluated',
      objectivePassed: evaluation.kind === 'evaluated' && evaluation.success,
      difficultyFirstClearGranted: reward.firstClearGranted,
      challengeFirstClearGranted: reward.challengeFirstClearGranted,
      rewardTotal: reward.total,
      repeatCoins: repeatCoinsOf(reward),
      challengeComponentCoins: challengeComponent?.amount ?? 0,
      homeSeconds,
    };
  } catch (error) {
    return { ...base, failure: (error as Error).message };
  }
}

function runStandardJob(input: {
  catalog: CollectionCatalog;
  rules: CollectionGameRules;
  profile: EraSimulationProfile;
  objectives: readonly CollectionObjectiveDefinition[];
  catalogHash: string;
  rulesHash: string;
  profileHash: string;
  job: ProgressionStandardJob;
}): ProgressionGameResult {
  const { catalog, rules, profile, objectives, job } = input;
  const base = emptyGameResult(job);
  const difficulty = rules.difficulties.find((entry) => entry.difficultyId === job.difficultyId);
  if (difficulty === undefined) {
    return { ...base, failure: `unknown difficulty ${job.difficultyId}` };
  }
  const ownedCardIds = new Set([...job.team.starters, ...job.team.bench]);
  try {
    const offers = buildCollectionObjectiveFacts({
      definitions: objectives,
      rootSeed: job.rootSeed,
      difficultyId: difficulty.difficultyId,
      gameSequence: job.gameSequence,
      team: job.team,
      selectedObjectiveId: null,
    });
    const selectedObjectiveId = offers.offers[0]?.objectiveId ?? null;
    const prepared = prepareCollectionBasicGameV2({
      collectionId: 'progression-calibration',
      rootSeed: job.rootSeed,
      gameSequence: job.gameSequence,
      ownedCardIds,
      team: job.team,
      catalog,
      difficulty,
      objectiveDefinitions: objectives,
      selectedObjectiveId,
      clearedDifficultyIds: [difficulty.difficultyId],
      profileVersion: profile.profileVersion,
      profileHash: input.profileHash,
      catalogHash: input.catalogHash,
      rulesHash: input.rulesHash,
    });
    const simulated = simulateCollectionGame(prepared, catalog, profile);
    const result = simulated.result as CollectionGameResultV2;
    const checkFailures = checkCollectionGameResult(
      result,
      simulated.events,
      prepared,
      catalog,
      profile,
    );
    const evaluation = evaluateCollectionObjective({ prepared, result });
    const reward = collectionGameRewardReceiptFor({
      gameId: prepared.gameId,
      prepared,
      result,
      evaluation,
    });
    const again = collectionGameRewardReceiptFor({
      gameId: prepared.gameId,
      prepared,
      result,
      evaluation,
    });
    if (canonicalJson(again) !== canonicalJson(reward)) {
      checkFailures.push('reward receipt does not reproduce from the prepared input');
    }
    const homeSeconds =
      result.outcome === 'completed'
        ? result.home.players.reduce((sum, player) => sum + player.seconds, 0)
        : 0;
    return {
      ...base,
      checkFailures,
      outcome: result.outcome,
      winner: result.winner,
      eventDigest: collectionGameEventDigest(simulated.events),
      resultDigest: collectionGameResultDigest(result),
      overtimePeriods: result.outcome === 'completed' ? result.overtimePeriods : 0,
      objectiveSelected: selectedObjectiveId,
      objectiveEvaluated: evaluation.kind === 'evaluated',
      objectivePassed: evaluation.kind === 'evaluated' && evaluation.success,
      difficultyFirstClearGranted: reward.firstClearGranted,
      rewardTotal: reward.total,
      repeatCoins: reward.total,
      homeSeconds,
    };
  } catch (error) {
    return { ...base, failure: (error as Error).message };
  }
}

function main(): void {
  const input = workerData as ProgressionWorkerInput;
  const { catalog, catalogHash } = loadCollectionCatalog(input.manifestPath);
  if (input.kind === 'draws') {
    const results = (input.jobs as ProgressionDrawJob[]).map((job) => runDrawJob(catalog, job));
    parentPort?.postMessage({ results });
    return;
  }
  if (input.kind === 'purchases') {
    const { progression, progressionHash } = loadCollectionProgressionRules(input.manifestPath);
    const results = (input.jobs as ProgressionPurchaseJob[]).map((job) =>
      runPurchaseJob(catalog, catalogHash, progression, progressionHash, job),
    );
    parentPort?.postMessage({ results });
    return;
  }
  const { rules, rulesHash } = loadCollectionGameRules(input.manifestPath);
  const { progression } = loadCollectionProgressionRules(input.manifestPath);
  const { profile, profileHash } = loadCollectionGameProfile(input.manifestPath);
  const objectives = collectionObjectiveDefinitionsFromRules(rules);
  const results = (input.jobs as ProgressionGameJob[]).map((job) => {
    return job.kind === 'challenge'
      ? runChallengeJob({
          catalog,
          rules,
          progression,
          profile,
          objectives,
          catalogHash,
          rulesHash,
          profileHash,
          job,
        })
      : runStandardJob({
          catalog,
          rules,
          profile,
          objectives,
          catalogHash,
          rulesHash,
          profileHash,
          job,
        });
  });
  parentPort?.postMessage({ results });
}

main();
