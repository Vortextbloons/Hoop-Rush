import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { z } from 'zod';
import {
  COLLECTION_CATALOG_VERSION,
  collectionCommandSchema,
  collectionGameRecordUnionSchema,
  collectionLedgerEntrySchema,
  collectionPlayStateUnionSchema,
  collectionProgressionRulesSchema,
  collectionPullRecordSchema,
  collectionStateUnionSchema,
  type CollectionCatalog,
  type CollectionProgressionRules,
} from '@hoop-rush/data-contracts';
import {
  auditCollectionFirstClearState,
  auditCollectionState,
  challengeRequirementMatchingCards,
  checkCollectionChallengeFeasibility,
  collectionSetProgress,
  collectionSetRewardTransactionId,
  describeCollectionTargetOdds,
  validateCollectionProgressionRules,
} from '@hoop-rush/engine';
import { makeReport, EXIT_USAGE_OR_DATA_ERROR, type CliReport } from '../report.ts';
import { collectionProgressionAuditReportSchema } from '../report-schemas.ts';
import { DEFAULT_MANIFEST, readJsonFile, sha256Hex } from './season-data.ts';
import { loadCollectionCatalog } from './collection.ts';

export const COLLECTION_PROGRESSION_AUDIT_OPTIONS: Record<string, boolean> = {
  manifest: true,
  player: true,
  input: true,
  format: true,
};

export const COLLECTION_PROGRESSION_AUDIT_PLAYER_SAMPLES = 8;

export function loadCollectionProgressionRules(manifestPath: string = DEFAULT_MANIFEST): {
  progression: CollectionProgressionRules;
  progressionHash: string;
} {
  const manifest = readJsonFile(manifestPath) as {
    collection?: {
      progressionRules?: { url?: string; contentHash?: string };
    };
  };
  const ref = manifest.collection?.progressionRules;
  if (ref?.url === undefined || ref.contentHash === undefined) {
    throw new Error(
      'manifest is missing collection.progressionRules; run gen-collection-progression-rules first',
    );
  }
  const resolved = resolve(dirname(manifestPath), ref.url);
  const content = readFileSync(resolved);
  const actual = sha256Hex(content);
  if (actual !== ref.contentHash) {
    throw new Error(
      `collection progression rules content hash mismatch: expected ${ref.contentHash}, got ${actual}`,
    );
  }
  const parsed = collectionProgressionRulesSchema.safeParse(
    JSON.parse(content.toString('utf8')) as unknown,
  );
  if (!parsed.success) {
    throw new Error(
      `collection progression rules fail the schema: ${parsed.error.issues[0]?.message ?? 'unknown'}`,
    );
  }
  return { progression: parsed.data, progressionHash: actual };
}

export const collectionProgressionAuditInputSchema = z.object({
  state: collectionStateUnionSchema,
  pulls: z.array(collectionPullRecordSchema).default([]),
  ledger: z.array(collectionLedgerEntrySchema).default([]),
  commands: z.array(collectionCommandSchema).default([]),
  gameRecords: z.array(collectionGameRecordUnionSchema).default([]),
  playState: collectionPlayStateUnionSchema.nullable().default(null),
  catalogHash: z
    .string()
    .regex(/^[0-9a-f]{64}$/)
    .optional(),
});
export type CollectionProgressionAuditInput = z.infer<typeof collectionProgressionAuditInputSchema>;

function samplePlayerIds(playerIds: readonly string[], count: number): string[] {
  if (playerIds.length <= count) return [...playerIds];
  const picked: string[] = [];
  for (let index = 0; index < count; index += 1) {
    const position = Math.floor((index * playerIds.length) / count);
    const playerId = playerIds[position];
    if (playerId !== undefined) picked.push(playerId);
  }
  return picked;
}

function auditProgressionState(input: {
  bundle: CollectionProgressionAuditInput;
  progression: CollectionProgressionRules;
  progressionHash: string;
  catalogHash: string;
}): {
  state: {
    collectionId: string;
    revision: number;
    activeTargetPlayerId: string | null;
    claimedSetIds: string[];
    sets: Array<{
      setId: string;
      title: string;
      ownedCount: number;
      requiredCount: number;
      complete: boolean;
      claimed: boolean;
      missingCardIds: string[];
      rewardCurrency: 'Exchange';
      rewardAmount: number;
    }>;
    failures: string[];
    firstClearFailures: string[];
  } | null;
  failures: string[];
  details: string[];
} {
  const { bundle, progression, progressionHash, catalogHash } = input;
  const stateFailures: string[] = [];
  const details: string[] = [];
  if (bundle.catalogHash !== undefined && bundle.catalogHash !== catalogHash) {
    stateFailures.push(
      `bundle catalogHash ${bundle.catalogHash} does not match the pinned catalog`,
    );
  }
  if (bundle.state.schemaVersion === 1) {
    stateFailures.push('bundle collection state is legacy schema v1; migrate it before auditing');
    return { state: null, failures: stateFailures, details };
  }
  const state = bundle.state;
  if (state.progressionHash !== null && state.progressionHash !== progressionHash) {
    stateFailures.push('bundle collection state was created with different progression rules');
  }
  for (const failure of auditCollectionState(
    state,
    bundle.pulls,
    bundle.ledger,
    bundle.gameRecords,
    bundle.commands,
  )) {
    stateFailures.push(`${failure.code}: ${failure.message}`);
  }
  const owned = new Set(state.owned.map((entry) => entry.cardId));
  const sets = progression.setRewards.map((reward) => {
    const progress = collectionSetProgress({
      setId: reward.setId,
      title: reward.title,
      memberCardIds: reward.memberCardIds,
      ownedCardIds: owned,
    });
    const claimed = state.claimedSetIds.includes(reward.setId);
    if (claimed && !progress.complete) {
      stateFailures.push(`set ${reward.setId} is claimed but no longer complete`);
    }
    const claimCommands = bundle.commands.filter(
      (command) => command.command === 'claim-set-reward' && command.setId === reward.setId,
    );
    if (claimed && claimCommands.length !== 1) {
      stateFailures.push(
        `set ${reward.setId} is claimed with ${String(claimCommands.length)} accepted claim commands`,
      );
    }
    if (!claimed && claimCommands.length > 0) {
      stateFailures.push(`set ${reward.setId} has a claim command but is not claimed`);
    }
    const claimCommand = claimCommands[0];
    if (claimed && claimCommand !== undefined) {
      const transactionId = collectionSetRewardTransactionId({
        collectionId: state.collectionId,
        setId: reward.setId,
        setRewardVersion: reward.setRewardVersion,
        commandId: claimCommand.commandId,
      });
      const entries = bundle.ledger.filter((entry) => entry.transactionId === transactionId);
      if (entries.length !== 1) {
        stateFailures.push(
          `set ${reward.setId} claim ${transactionId} has ${String(entries.length)} ledger entries`,
        );
      }
      const entry = entries[0];
      if (
        entry !== undefined &&
        (entry.currency !== 'Exchange' ||
          entry.amount !== reward.amount ||
          entry.reason !== 'set-completion-reward' ||
          entry.pullSequence !== null)
      ) {
        stateFailures.push(`set ${reward.setId} claim ledger entry does not match the reward`);
      }
    }
    if (!claimed && progress.complete) {
      details.push(`set ${reward.setId}: complete and unclaimed`);
    }
    return {
      setId: reward.setId,
      title: reward.title,
      ownedCount: progress.ownedCount,
      requiredCount: progress.requiredCount,
      complete: progress.complete,
      claimed,
      missingCardIds: [...progress.missingCardIds],
      rewardCurrency: reward.currency,
      rewardAmount: reward.amount,
    };
  });
  const firstClearAuditFailures: string[] = [];
  if (bundle.playState === null) {
    details.push('bundle has no play state; first-clear audit skipped');
  } else if (!('clearedChallengeIds' in bundle.playState)) {
    stateFailures.push(
      'bundle play state is legacy with no cleared challenge ids; migrate it before the first-clear audit',
    );
  } else {
    if (bundle.playState.collectionId !== state.collectionId) {
      stateFailures.push('bundle play state belongs to a different collection');
    }
    for (const failure of auditCollectionFirstClearState(
      bundle.playState,
      bundle.gameRecords,
      bundle.ledger,
    )) {
      firstClearAuditFailures.push(`${failure.code}: ${failure.message}`);
    }
  }
  details.push(
    `bundle state: revision ${String(state.revision)} · ${String(state.owned.length)} owned cards · ${String(sets.length)} sets · ${String(state.claimedSetIds.length)} claimed`,
  );
  return {
    state: {
      collectionId: state.collectionId,
      revision: state.revision,
      activeTargetPlayerId: state.activeTargetPlayerId,
      claimedSetIds: [...state.claimedSetIds],
      sets,
      failures: stateFailures,
      firstClearFailures: firstClearAuditFailures,
    },
    failures: [...stateFailures, ...firstClearAuditFailures],
    details,
  };
}

export function collectionProgressionAudit(args: {
  manifest: string | null;
  player: string | null;
  input: string | null;
}): CliReport {
  const manifestPath = args.manifest ?? DEFAULT_MANIFEST;
  let catalog: CollectionCatalog;
  let catalogHash: string;
  let progression: CollectionProgressionRules;
  let progressionHash: string;
  try {
    ({ catalog, catalogHash } = loadCollectionCatalog(manifestPath));
    ({ progression, progressionHash } = loadCollectionProgressionRules(manifestPath));
  } catch (error) {
    return makeReport(
      'collection progression-audit',
      { manifest: manifestPath },
      { failures: [(error as Error).message], exitCode: EXIT_USAGE_OR_DATA_ERROR },
    );
  }
  const failures: string[] = [];
  const details: string[] = [];
  if (progression.sourceCatalogHash !== catalogHash) {
    failures.push('progression rules do not match the pinned catalog hash');
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

  const challenges = progression.challenges.map((challenge) => {
    const feasibility = checkCollectionChallengeFeasibility(challenge, catalog);
    const matchingCards = challengeRequirementMatchingCards(challenge.requirement, catalog);
    for (const failure of feasibility.failures) failures.push(failure);
    const requirement = challenge.requirement;
    const requirementId =
      requirement.kind === 'era-core'
        ? requirement.eraId
        : requirement.kind === 'franchise-core'
          ? requirement.franchiseId
          : requirement.setId;
    details.push(
      `challenge ${challenge.challengeId}: ${requirement.kind} ${requirementId} · >=${String(requirement.minimumRosterCount)} roster / >=${String(requirement.minimumStarterCount)} starters · ${challenge.difficultyId} · ${String(feasibility.matchingPlayerCount)} matching players · ${String(matchingCards.length)} matching cards · first clear ${String(challenge.firstClearCoins)} Coins / repeat ${String(challenge.repeatWinCoins)} Coins`,
    );
    return {
      challengeId: challenge.challengeId,
      displayName: challenge.displayName,
      difficultyId: challenge.difficultyId,
      requirementKind: requirement.kind,
      requirementId,
      minimumRosterCount: requirement.minimumRosterCount,
      minimumStarterCount: requirement.minimumStarterCount,
      firstClearCoins: challenge.firstClearCoins,
      repeatWinCoins: challenge.repeatWinCoins,
      matchingPlayerCount: feasibility.matchingPlayerCount,
      matchingCardCount: matchingCards.length,
      feasible: feasibility.ok,
      feasibilityFailures: feasibility.failures,
    };
  });

  const uniquePlayers: string[] = [
    ...new Set<string>(catalog.cards.map((card) => card.playerId)),
  ].sort();
  let players: string[];
  if (args.player !== null) {
    if (!uniquePlayers.includes(args.player)) {
      return makeReport(
        'collection progression-audit',
        { manifest: manifestPath, player: args.player },
        { failures: [`unknown catalog player ${args.player}`], exitCode: EXIT_USAGE_OR_DATA_ERROR },
      );
    }
    players = [args.player];
  } else {
    players = samplePlayerIds(uniquePlayers, COLLECTION_PROGRESSION_AUDIT_PLAYER_SAMPLES);
  }
  const targets = players.map((playerId) => {
    const packs = catalog.packs.map((pack) => {
      const odds = describeCollectionTargetOdds({
        catalog,
        pack,
        targetPlayerId: playerId,
        multiplierBp: progression.targetMultiplierBp,
      });
      const eligibleCardCount = odds.eligibleCardIds.length;
      if (eligibleCardCount > 0 && odds.atLeastOneTarget <= 0) {
        failures.push(
          `target ${playerId}/${pack.packId}: eligible versions exist but the target probability is zero`,
        );
      }
      if (odds.atLeastOneTarget >= 1) {
        failures.push(`target ${playerId}/${pack.packId}: target probability is guaranteed`);
      }
      if (eligibleCardCount === 0 && odds.atLeastOneTarget !== 0) {
        failures.push(`target ${playerId}/${pack.packId}: ineligible target shows nonzero odds`);
      }
      return {
        packId: pack.packId,
        eligibleCardCount,
        atLeastOneTarget: odds.atLeastOneTarget,
        perSlot: odds.perSlot.map((slot) => slot.targetProbability),
      };
    });
    details.push(
      `target ${playerId}: ${packs
        .map(
          (entry) =>
            `${entry.packId} ${(entry.atLeastOneTarget * 100).toFixed(2)}% (${String(entry.eligibleCardCount)} versions)`,
        )
        .join(' · ')}`,
    );
    return { playerId, packs };
  });

  let stateAudit: ReturnType<typeof auditProgressionState>['state'] = null;
  if (args.input !== null) {
    const parsedInput = collectionProgressionAuditInputSchema.safeParse(readJsonFile(args.input));
    if (!parsedInput.success) {
      return makeReport(
        'collection progression-audit',
        { manifest: manifestPath, input: args.input },
        {
          failures: [
            `bundle input fails the schema: ${parsedInput.error.issues[0]?.message ?? 'unknown'}`,
          ],
          exitCode: EXIT_USAGE_OR_DATA_ERROR,
        },
      );
    }
    const audited = auditProgressionState({
      bundle: parsedInput.data,
      progression,
      progressionHash,
      catalogHash,
    });
    stateAudit = audited.state;
    failures.push(...audited.failures);
    details.push(...audited.details);
  }

  details.unshift(
    `progression ${progression.progressionVersion} · catalog ${catalog.catalogVersion} · ${String(challenges.length)} challenges · ${String(targets.length)} sampled players · ${String(progression.setRewards.length)} set rewards`,
  );
  const payload = collectionProgressionAuditReportSchema.parse({
    schemaVersion: 1,
    command: 'collection progression-audit',
    catalogVersion: COLLECTION_CATALOG_VERSION,
    catalogHash,
    progressionVersion: progression.progressionVersion,
    progressionHash,
    targetMultiplierBp: progression.targetMultiplierBp,
    challenges,
    targets,
    state: stateAudit,
    pass: failures.length === 0,
  });
  return makeReport(
    'collection progression-audit',
    {
      manifest: manifestPath,
      player: args.player,
      input: args.input,
    },
    { details, failures, payload },
  );
}
